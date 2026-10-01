import { z } from "zod";

/** Ein normalisierter Messwert: aktueller Überschuss eines Erzeugers in Watt (>= 0 heißt Überschuss). */
export const SurplusReading = z.object({
  watts: z.number().finite(),
  timestamp: z.number().int().positive(), // Unix-Millisekunden
});
export type SurplusReading = z.infer<typeof SurplusReading>;

/** Nachrichten Bridge -> Backend über WS /ingest */
export const IngestMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reading"), reading: SurplusReading }),
]);
export type IngestMessage = z.infer<typeof IngestMessage>;

/** Nachrichten App -> Backend über WS /live */
export const LiveClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth"), token: z.string().min(1) }),
]);
export type LiveClientMessage = z.infer<typeof LiveClientMessage>;

/** Nachrichten Backend -> App über WS /live */
export type LiveServerMessage =
  | { type: "ready"; producerIds: string[] }
  | { type: "reading"; producerId: string; reading: SurplusReading }
  | { type: "error"; message: string };

export interface ProducerDto {
  id: string;
  name: string;
  isOwner: boolean;
  current: SurplusReading | null;
}

export interface HistoryPoint {
  /** Minutenbeginn, Unix-Millisekunden */
  t: number;
  /** Mittelwert der Minute in Watt */
  watts: number;
}

export interface MeDto {
  id: string;
  email: string;
}

export const Credentials = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "Passwort muss mindestens 8 Zeichen haben"),
});

export const RegisterBody = Credentials.extend({
  inviteCode: z.string().min(1),
});

/** Ab dieser Leistung gilt es als "etwas Überschuss" (Ampel gelb, Balken "ein wenig"). */
export const LEVEL_SOME_WATTS = 50;
/** Ab dieser Leistung gilt es als "viel Überschuss" (Ampel grün, Balken "viel"). */
export const LEVEL_LOTS_WATTS = 1000;

/** Nach so vielen Millisekunden ohne neuen Wert gilt ein Erzeuger als "offline". */
export const STALE_AFTER_MS = 60_000;

/** Ein selbst angelegtes Gerät des Empfängers. */
export const CustomAppliance = z.object({
  id: z.string().min(1).max(40),
  icon: z.string().min(1).max(40), // Lucide-Icon-Name, ältere Einträge: Emoji
  name: z.string().trim().min(1).max(40),
  watts: z.number().int().min(1).max(50_000),
});
export type CustomAppliance = z.infer<typeof CustomAppliance>;

/** Geräteauswahl eines Users: IDs aus dem Standard-Katalog plus eigene Geräte, dazu die Geräte mit Push-Nachricht. */
export const ApplianceSettings = z.object({
  selected: z.array(z.string().min(1).max(40)).max(100),
  custom: z.array(CustomAppliance).max(50),
  notify: z.array(z.string().min(1).max(40)).max(100).default([]),
});
export type ApplianceSettings = z.infer<typeof ApplianceSettings>;

/** Web-Push-Abo, wie es der Browser liefert (PushSubscription.toJSON()). */
export const PushSubscriptionBody = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});
export type PushSubscriptionBody = z.infer<typeof PushSubscriptionBody>;

/** Inhalt einer Push-Nachricht, den der Service Worker anzeigt. */
export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}

export * from "./appliances.ts";

export { Throttle } from "./throttle.ts";
