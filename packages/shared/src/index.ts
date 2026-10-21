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
  /** Reservierung (ELISA-Modus), aus Sicht des jeweiligen Users; kommt nach ready und bei jeder Änderung */
  | { type: "reservation"; producerId: string; state: ReservationStateDto }
  | { type: "error"; message: string };

export interface ProducerDto {
  id: string;
  name: string;
  /** Name des Erzeugers für Texte wie „Wolfgang bekommt nur eine Info“ (siehe {@link displayNameOf}) */
  ownerName: string;
  isOwner: boolean;
  current: SurplusReading | null;
  reservation: ReservationStateDto;
}

// ---------- Reservierung (ELISA-Modus, docs/elisa.md) ----------

/** So viele Minuten darf ein Empfänger pro Tag (Europe/Vienna) und Erzeuger reservieren, beliebig aufgeteilt. */
export const RESERVATION_DAILY_MINUTES = 60;
/** Dauer-Chips im Blatt „Strom reservieren“ */
export const RESERVATION_DURATIONS = [15, 30, 45, 60] as const;

/** Eine laufende Reservierung. */
export interface ReservationDto {
  producerId: string;
  /** Anzeigename des Reservierenden, nie die E-Mail */
  userName: string;
  startsAt: number;
  endsAt: number;
  /** true = der angemeldete User hat selbst reserviert */
  mine: boolean;
}

/** Warum gerade nicht reserviert werden kann: Was läuft, ist im angezeigten Überschuss schon abgezogen. */
export type BlockedReason = "heatpump" | "wallbox";

/** Stand der Reservierung eines Erzeugers aus Sicht eines Users. */
export interface ReservationStateDto {
  active: ReservationDto | null;
  /** der User darf bei diesem Erzeuger reservieren (Recht pro Freigabe) */
  canReserve: boolean;
  /** heute noch frei; eine laufende Reservierung zählt mit ihrer ganzen geplanten Dauer */
  minutesLeft: number;
  /** Node-RED hat sich in den letzten 60 s gemeldet; sonst wirkt die Sperre nicht */
  controlConnected: boolean;
  blockedReason: BlockedReason | null;
}

/** Reservierung anfordern */
export const ReservationBody = z.object({
  minutes: z.number().int("Ganze Minuten angeben").min(1, "Mindestens 1 Minute").max(RESERVATION_DAILY_MINUTES, `Höchstens ${RESERVATION_DAILY_MINUTES} Minuten`),
});
export type ReservationBody = z.infer<typeof ReservationBody>;

/** Gerätezustand, den Node-RED alle 15 s an POST /api/control/status schickt. */
export const ControlStatus = z.object({
  compressorRunning: z.boolean(),
  /** jede Ladung: von Hand, per Preis-Freigabe oder per Abfahrtsplanung */
  wallboxCharging: z.boolean(),
  /** Handbedienung aktiv; nur zur Information, ELMA entscheidet nicht danach */
  wallboxManual: z.boolean().default(false),
});
export type ControlStatus = z.infer<typeof ControlStatus>;

/** Antwort an Node-RED: Ist gerade reserviert, und bis wann (Unix-ms, Uhr des Backends)? */
export interface ControlResponse {
  active: boolean;
  until: number | null;
  by?: string;
}

/** Empfänger eines Erzeugers, für die Liste im Blatt „Einladen“ (nur der Erzeuger sieht sie). */
export interface RecipientDto {
  userId: string;
  name: string;
  email: string;
  canReserve: boolean;
}

export const CanReserveBody = z.object({ canReserve: z.boolean() });

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
