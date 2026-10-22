import { IngestServerMessage } from "@elma/shared";

/** Liest eine Nachricht des Backends; null, wenn sie kein gültiges JSON oder unbekannt ist. */
export function parseServerMessage(raw: string): IngestServerMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = IngestServerMessage.safeParse(json);
  return parsed.success ? parsed.data : null;
}

type ReservationMessage = Extract<IngestServerMessage, { type: "reservation" }>;

/**
 * Payload für das retained Topic, das MAGGIE liest: `{"active":true,"until":<Unix-ms>,"by":"Elisa"}` bzw. `{"active":false}`.
 * MAGGIE prüft `until` selbst, eine liegengebliebene Nachricht (Bridge oder Backend weg) wirkt also nicht ewig.
 */
export function reservationPayload(msg: ReservationMessage): string {
  if (msg.until === null) return JSON.stringify({ active: false });
  return JSON.stringify(msg.by ? { active: true, until: msg.until, by: msg.by } : { active: true, until: msg.until });
}
