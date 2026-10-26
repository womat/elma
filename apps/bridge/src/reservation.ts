import { IngestServerMessage } from "@elma/shared";

/** Reads a message from the backend; null if it is not valid JSON or unknown. */
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
 * Payload for the retained topic that MAGGIE reads: `{"active":true,"until":<Unix-ms>,"by":"Elisa"}`
 * or `{"active":false}`. MAGGIE checks `until` itself, so a leftover message
 * (bridge or backend gone) does not stay in effect forever.
 */
export function reservationPayload(msg: ReservationMessage): string {
  if (msg.until === null) return JSON.stringify({ active: false });
  return JSON.stringify(msg.by ? { active: true, until: msg.until, by: msg.by } : { active: true, until: msg.until });
}
