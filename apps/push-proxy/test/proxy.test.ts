import { createServer as createNetServer, connect, type AddressInfo, type Server as NetServer, type Socket } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createPushProxy, parseTarget } from "../src/proxy.ts";

let proxy: Server;
let echo: NetServer;
const dialed: string[] = [];

/** Echo-Server statt echtem Push-Dienst: alles, was ankommt, geht zurück. */
async function start(): Promise<number> {
  echo = createNetServer((s) => s.pipe(s));
  await new Promise<void>((r) => echo.listen(0, "127.0.0.1", r));
  const echoPort = (echo.address() as AddressInfo).port;
  proxy = createPushProxy({
    dial: (host, port) => {
      dialed.push(`${host}:${port}`);
      return connect({ host: "127.0.0.1", port: echoPort });
    },
  });
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  return (proxy.address() as AddressInfo).port;
}

afterEach(async () => {
  dialed.length = 0;
  await new Promise((r) => proxy?.close(r));
  await new Promise((r) => echo?.close(r));
});

/** Schickt eine rohe Anfrage an den Proxy und liefert die Antwort, sobald sie vollständig oder die Verbindung zu ist. */
function raw(port: number, request: string, untilText?: string): Promise<{ text: string; socket: Socket }> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    let text = "";
    const done = () => resolve({ text, socket });
    socket.on("data", (d) => {
      text += d.toString();
      if (untilText && text.includes(untilText)) done();
    });
    socket.on("end", done);
    socket.on("error", reject);
    socket.write(request);
  });
}

describe("Push-Proxy", () => {
  it("lässt CONNECT zu einem Push-Dienst durch und leitet Daten in beide Richtungen", async () => {
    const port = await start();
    const { text, socket } = await raw(port, "CONNECT fcm.googleapis.com:443 HTTP/1.1\r\nHost: fcm.googleapis.com:443\r\n\r\n", "\r\n\r\n");
    expect(text).toMatch(/^HTTP\/1\.1 200/);
    expect(dialed).toEqual(["fcm.googleapis.com:443"]);

    const reply = new Promise<string>((r) => socket.once("data", (d) => r(d.toString())));
    socket.write("hallo");
    expect(await reply).toBe("hallo");
    socket.destroy();
  });

  it.each([
    ["anderer Host", "example.com:443"],
    ["Suffix-Trick", "fcm.googleapis.com.evil.example:443"],
    ["LAN-Adresse", "192.168.65.42:8086"],
    ["falscher Port", "fcm.googleapis.com:80"],
  ])("lehnt %s ab", async (_, target) => {
    const port = await start();
    const { text } = await raw(port, `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
    expect(text).toMatch(/^HTTP\/1\.1 403/);
    expect(dialed).toEqual([]);
  });

  it("normale HTTP-Anfragen werden nicht weitergeleitet", async () => {
    const port = await start();
    const { text } = await raw(port, "GET http://192.168.65.42:8086/query HTTP/1.1\r\nHost: 192.168.65.42\r\nConnection: close\r\n\r\n");
    expect(text).toMatch(/^HTTP\/1\.1 405/);
    expect(dialed).toEqual([]);
  });

  it("parseTarget", () => {
    expect(parseTarget("web.push.apple.com:443")).toEqual({ host: "web.push.apple.com", port: 443 });
    expect(parseTarget("[::1]:443")).toBeNull();
    expect(parseTarget("host")).toBeNull();
    expect(parseTarget("host:99999")).toBeNull();
  });
});
