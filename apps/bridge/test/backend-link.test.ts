import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import type { IngestMessage } from "@elma/shared";
import { BackendLink } from "../src/backend-link.ts";

// Ein echter WebSocket-Server statt des Backends; nur die Timer für das Neuverbinden laufen künstlich.
let server: WebSocketServer;
let url: string;
let link: BackendLink | undefined;
/** Verbindungen beim Server, mit Authorization-Header und allem, was über sie ankam */
const clients: { ws: WebSocket; auth: string | undefined; messages: unknown[] }[] = [];

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  clients.length = 0;
  server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  server.on("connection", (ws, req) => {
    const client = { ws, auth: req.headers.authorization, messages: [] as unknown[] };
    ws.on("message", (data) => client.messages.push(JSON.parse(data.toString())));
    clients.push(client);
  });
  await new Promise((r) => server.once("listening", r));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ingest`;
});

afterEach(async () => {
  link?.stop();
  link = undefined;
  for (const c of clients) c.ws.terminate();
  await new Promise((r) => server.close(r));
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Wartet auf echte Netzwerk-Ereignisse; setTimeout ist hier gefälscht, setImmediate nicht. */
async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timeout");
    await new Promise((r) => setImmediate(r));
  }
}

const reading = (watts: number): IngestMessage => ({ type: "reading", reading: { watts, timestamp: 1_800_000_000_000 } });
const battery = (watts: number): IngestMessage => ({ type: "battery", battery: { watts, soc: 50, timestamp: 1_800_000_000_000 } });
const retries = () =>
  vi.mocked(console.warn).mock.calls.map((c) => String(c[0])).filter((m) => m.includes("neuer Versuch"));

describe("BackendLink", () => {
  it("meldet sich mit dem Geräte-Token an und schickt nach dem Verbinden nur den letzten Wert je Typ", async () => {
    link = new BackendLink(url, "geheim", () => {});
    link.send(reading(100));
    link.send(battery(50));
    link.send(reading(200));
    link.start();
    await waitFor(() => clients[0]?.messages.length === 2);
    expect(clients[0]!.auth).toBe("Bearer geheim");
    expect(clients[0]!.messages).toEqual([reading(200), battery(50)]);
  });

  it("gibt Reservierungen des Backends weiter, anderes nicht", async () => {
    const seen: unknown[] = [];
    link = new BackendLink(url, "geheim", (msg) => seen.push(msg));
    link.start();
    await waitFor(() => clients.length === 1);
    clients[0]!.ws.send(JSON.stringify({ type: "error", message: "Ungültige Nachricht" }));
    clients[0]!.ws.send(JSON.stringify({ type: "reservation", until: 1_800_000_900_000, by: "Elisa" }));
    await waitFor(() => seen.length === 1);
    expect(seen).toEqual([{ type: "reservation", until: 1_800_000_900_000, by: "Elisa" }]);
  });

  it("verbindet nach einer Trennung neu, holt Verpasstes nach und beginnt den Backoff wieder bei 1 s", async () => {
    link = new BackendLink(url, "geheim", () => {});
    link.start();
    await waitFor(() => clients.length === 1);

    clients[0]!.ws.terminate();
    await waitFor(() => retries().length === 1);
    link.send(reading(300)); // während der Trennung
    await vi.advanceTimersByTimeAsync(999);
    expect(clients).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await waitFor(() => clients[1]?.messages.length === 1);
    expect(clients[1]!.messages).toEqual([reading(300)]);

    // nach einer geglückten Verbindung wieder 1 s, nicht 2 s
    clients[1]!.ws.terminate();
    await waitFor(() => retries().length === 2);
    expect(retries()).toEqual([expect.stringContaining("in 1s"), expect.stringContaining("in 1s")]);
  });
});
