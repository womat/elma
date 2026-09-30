import { useEffect, useState } from "react";
import type { LiveServerMessage, SurplusReading } from "@elma/shared";

export type LiveStatus = "connecting" | "open" | "closed";

/** Live-Werte über WebSocket, mit automatischem Neuverbinden. */
export function useLive(token: string, initial: Record<string, SurplusReading | null>) {
  const [readings, setReadings] = useState<Record<string, SurplusReading | null>>(initial);
  const [status, setStatus] = useState<LiveStatus>("connecting");

  useEffect(() => setReadings((prev) => ({ ...initial, ...stripNull(prev) })), [initial]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retryMs = 1000;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = () => {
      setStatus("connecting");
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${protocol}//${location.host}/live`);
      ws.onopen = () => ws?.send(JSON.stringify({ type: "auth", token }));
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data) as LiveServerMessage;
        if (msg.type === "ready") {
          setStatus("open");
          retryMs = 1000;
        } else if (msg.type === "reading") {
          setReadings((prev) => ({ ...prev, [msg.producerId]: msg.reading }));
        }
      };
      ws.onclose = () => {
        setStatus("closed");
        if (stopped) return;
        retryTimer = setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 30_000);
      };
    };

    // Beim Zurückkehren in die App (Handy aus dem Standby) sofort neu verbinden
    const onVisible = () => {
      if (document.visibilityState === "visible" && ws?.readyState === WebSocket.CLOSED) {
        clearTimeout(retryTimer);
        retryMs = 1000;
        connect();
      }
    };

    connect();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisible);
      ws?.close();
    };
  }, [token]);

  return { readings, status };
}

function stripNull(obj: Record<string, SurplusReading | null>) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null));
}
