import { useEffect, useState } from "react";
import type { LiveServerMessage, ReservationStateDto, LiveReading } from "@elma/shared";

export type LiveStatus = "connecting" | "open" | "closed";

/**
 * Live values and reservation state via WebSocket, with automatic reconnect.
 * onUnauthorized: the backend rejects the token (4401, e.g. JWT expired); reconnecting does not help then.
 */
export function useLive(
  token: string,
  initial: Record<string, LiveReading | null>,
  initialReservations: Record<string, ReservationStateDto>,
  onUnauthorized: () => void,
) {
  const [readings, setReadings] = useState<Record<string, LiveReading | null>>(initial);
  const [reservations, setReservations] = useState<Record<string, ReservationStateDto>>(initialReservations);
  const [status, setStatus] = useState<LiveStatus>("connecting");

  useEffect(() => setReadings((prev) => ({ ...initial, ...stripNull(prev) })), [initial]);
  // what already came via /live is newer than the list of producers
  useEffect(() => setReservations((prev) => ({ ...initialReservations, ...prev })), [initialReservations]);
  /** apply the response to one's own reserve/end at once, without waiting for /live */
  const setReservation = (producerId: string, state: ReservationStateDto) =>
    setReservations((prev) => ({ ...prev, [producerId]: state }));

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
        } else if (msg.type === "reservation") {
          setReservation(msg.producerId, msg.state);
        }
      };
      ws.onclose = (event) => {
        setStatus("closed");
        if (stopped) return;
        // otherwise the app would reconnect endlessly and show „Getrennt“ instead of going to the login
        if (event.code === 4401) {
          stopped = true;
          onUnauthorized();
          return;
        }
        retryTimer = setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 30_000);
      };
    };

    // Reconnect immediately when returning to the app (phone waking from standby)
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

  return { readings, reservations, setReservation, status };
}

function stripNull(obj: Record<string, LiveReading | null>) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null));
}
