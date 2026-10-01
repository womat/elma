import { createServer, type Server } from "node:http";
import { connect, type Socket } from "node:net";
import { isPushHost } from "@elma/shared";

export interface ProxyOptions {
  /** Baut die Verbindung zum Ziel auf; in Tests ersetzbar. */
  dial?: (host: string, port: number) => Socket;
  /** Verbindungen ohne Datenverkehr werden nach dieser Zeit getrennt. */
  idleMs?: number;
  log?: (msg: string) => void;
}

/** „host:port“ aus einer CONNECT-Anfrage; IPv6-Adressen und Unsinn ergeben null. */
export function parseTarget(authority: string | undefined): { host: string; port: number } | null {
  const m = /^([a-z0-9.-]+):(\d{1,5})$/i.exec(authority ?? "");
  if (!m) return null;
  const port = Number(m[2]);
  return port > 0 && port < 65536 ? { host: m[1]!.toLowerCase(), port } : null;
}

/**
 * Ausgangs-Proxy für das Backend: lässt nur verschlüsselte Verbindungen (CONNECT auf Port 443) zu den Push-Diensten
 * der Browser durch. Den Inhalt sieht er nicht, TLS bleibt zwischen Backend und Push-Dienst.
 */
export function createPushProxy({ dial = (host, port) => connect({ host, port }), idleMs = 60_000, log = () => {} }: ProxyOptions = {}): Server {
  const server = createServer((_req, res) => {
    res.writeHead(405, { "content-type": "text/plain; charset=utf-8" }).end("Nur CONNECT zu Push-Diensten\n");
  });

  server.on("connect", (req, client: Socket, head: Buffer) => {
    const target = parseTarget(req.url);
    if (!target || target.port !== 443 || !isPushHost(target.host)) {
      log(`abgelehnt: ${req.url ?? "?"}`);
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }

    let established = false;
    const upstream = dial(target.host, target.port);
    const close = () => {
      client.destroy();
      upstream.destroy();
    };
    client.setTimeout(idleMs, close);
    upstream.setTimeout(idleMs, close);
    client.on("error", close);
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
    upstream.on("error", (err) => {
      log(`Fehler ${target.host}: ${err.message}`);
      if (established) close();
      else client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    });
    upstream.once("connect", () => {
      established = true;
      log(`erlaubt: ${target.host}`);
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
  });

  return server;
}
