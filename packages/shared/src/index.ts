import { z } from "zod";
import { isPushHost } from "./push.ts";

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
  /** selbst gewählter Name; null = nicht gesetzt, angezeigt wird dann {@link displayNameOf} */
  displayName: string | null;
}

/** Anzeigename im Konto, z. B. „Elisa“: 1–40 Zeichen, getrimmt. */
const DisplayName = z.string().trim().min(1, "Name darf nicht leer sein").max(40, "Name darf höchstens 40 Zeichen haben");

/** Anzeigename ändern; null löscht ihn. */
export const DisplayNameBody = z.object({ displayName: DisplayName.nullable() });
export type DisplayNameBody = z.infer<typeof DisplayNameBody>;

/** Einladung erstellen; der Name wird beim Einlösen ins Konto übernommen, wenn dort noch keiner steht. */
export const InviteBody = z.object({ displayName: DisplayName.optional() });
export type InviteBody = z.infer<typeof InviteBody>;

/** Name für Banner und Push: der gewählte Anzeigename, sonst der Teil der E-Mail vor dem @ – nie die ganze Adresse. */
export function displayNameOf(user: { displayName: string | null; email: string }): string {
  return user.displayName ?? user.email.split("@")[0]!;
}

/** Ein Passkey des angemeldeten Users (ohne Schlüsselmaterial). */
export interface PasskeyDto {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
}

/** Passkey-Registrierung starten: neues Konto per Einladung oder bestehendes Konto per Einrichtungslink. */
export const PasskeyRegisterStart = z.union([
  z.object({ inviteCode: z.string().min(1).max(100), email: z.string().trim().toLowerCase().email("Bitte eine gültige E-Mail angeben") }),
  z.object({ setupToken: z.string().min(1).max(100) }),
]);
export type PasskeyRegisterStart = z.infer<typeof PasskeyRegisterStart>;

/** Antwort des Browsers auf eine Challenge; den Inhalt prüft die WebAuthn-Bibliothek. */
export const PasskeyFinish = z.object({
  challengeId: z.string().min(1).max(100),
  response: z.looseObject({ id: z.string().min(1).max(1000) }),
});
export type PasskeyFinish = z.infer<typeof PasskeyFinish>;

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
  // nur echte Push-Dienste, sonst könnte man das Backend Anfragen an beliebige Adressen (z. B. im LAN) schicken lassen
  endpoint: z
    .string()
    .url()
    .max(1000)
    .refine((u) => {
      // läuft auch, wenn url() schon fehlgeschlagen ist; URL.parse kennen ältere iPhones noch nicht
      try {
        const url = new URL(u);
        return url.protocol === "https:" && isPushHost(url.hostname);
      } catch {
        return false;
      }
    }, "Unbekannter Push-Dienst"),
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

export { isPushHost, PUSH_HOST_SUFFIXES } from "./push.ts";
