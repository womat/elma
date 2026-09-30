import WebSocket from "ws";
import type { IngestMessage, SurplusReading } from "@elma/shared";

/**
 * Hält eine ausgehende WebSocket-Verbindung zum Backend offen (mit Reconnect + Backoff).
 * Solange die Verbindung weg ist, wird nur der letzte Wert gepuffert.
 */
export class BackendLink {
  private ws: WebSocket | null = null;
  private pending: SurplusReading | null = null;
  private backoffMs = 1000;
  private closed = false;
  private readonly url: string;
  private readonly token: string;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  start(): void {
    this.connect();
  }

  stop(): void {
    this.closed = true;
    this.ws?.close();
  }

  send(reading: SurplusReading): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const msg: IngestMessage = { type: "reading", reading };
      this.ws.send(JSON.stringify(msg));
    } else {
      this.pending = reading;
    }
  }

  private connect(): void {
    const ws = new WebSocket(this.url, { headers: { Authorization: `Bearer ${this.token}` } });
    this.ws = ws;

    ws.on("open", () => {
      console.log(`[backend] verbunden mit ${this.url}`);
      this.backoffMs = 1000;
      if (this.pending) {
        const reading = this.pending;
        this.pending = null;
        this.send(reading);
      }
    });
    ws.on("message", (data) => console.warn(`[backend] ${data.toString()}`));
    ws.on("error", (err) => console.warn(`[backend] Fehler: ${err.message}`));
    ws.on("close", (code) => {
      if (this.closed) return;
      console.warn(`[backend] Verbindung getrennt (${code}), neuer Versuch in ${this.backoffMs / 1000}s`);
      setTimeout(() => this.connect(), this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, 60_000);
    });
  }
}
