import { z } from "zod";
import { isPushHost } from "./push.ts";

/** A normalized reading: current surplus of a producer in watts (>= 0 means surplus). */
export const SurplusReading = z.object({
  watts: z.number().finite(),
  timestamp: z.number().int().positive(), // Unix milliseconds
});
export type SurplusReading = z.infer<typeof SurplusReading>;

/** State of the producer's home battery (in our setup from `myhome/ecoflow/state`), display only. */
export const BatteryReading = z.object({
  watts: z.number().finite(), // positive = charging
  soc: z.number().min(0).max(100), // state of charge in %
  timestamp: z.number().int().positive(), // measurement time, Unix milliseconds
});
export type BatteryReading = z.infer<typeof BatteryReading>;

/**
 * Distributed live value: the smoothed surplus, whether it was stable within this window, and the latest battery value.
 * `stable` is missing when there is no stability indicator (no surplus, too little data, smoothing off); `battery` when
 * there is no current battery value.
 */
export interface LiveReading extends SurplusReading {
  stable?: boolean;
  battery?: BatteryReading;
}

/** Messages bridge -> backend over WS /ingest */
export const IngestMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reading"), reading: SurplusReading }),
  z.object({ type: z.literal("battery"), battery: BatteryReading }),
]);
export type IngestMessage = z.infer<typeof IngestMessage>;

/**
 * Messages backend -> bridge over WS /ingest. The reservation (ELISA mode) comes on connect and on every change;
 * the bridge only passes it on to MAGGIE (retained MQTT), nothing is switched by it (docs/elisa.md).
 */
export const IngestServerMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("reservation"),
    /** End of the running reservation (Unix ms, backend clock), null = nothing reserved */
    until: z.number().int().positive().nullable(),
    /** Display name of the person reserving */
    by: z.string().optional(),
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type IngestServerMessage = z.infer<typeof IngestServerMessage>;

/** Messages app -> backend over WS /live */
export const LiveClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth"), token: z.string().min(1) }),
]);
export type LiveClientMessage = z.infer<typeof LiveClientMessage>;

/** Messages backend -> app over WS /live */
export type LiveServerMessage =
  | { type: "ready"; producerIds: string[] }
  | { type: "reading"; producerId: string; reading: LiveReading }
  /** Reservation (ELISA mode), from the respective user's point of view; comes after ready and on every change */
  | { type: "reservation"; producerId: string; state: ReservationStateDto }
  | { type: "error"; message: string };

export interface ProducerDto {
  id: string;
  name: string;
  /** Producer's name for texts like „Wolfgang bekommt nur eine Info“ (see {@link displayNameOf}) */
  ownerName: string;
  isOwner: boolean;
  current: LiveReading | null;
  reservation: ReservationStateDto;
}

// ---------- Reservation (ELISA mode, docs/elisa.md) ----------

/** Minutes a recipient may reserve per day (Europe/Vienna) and producer, split up as they like. */
export const RESERVATION_DAILY_MINUTES = 60;
/** Duration chips in the „Strom reservieren“ sheet */
export const RESERVATION_DURATIONS = [15, 30, 45, 60] as const;
/**
 * How long before a planned reservation Node-RED already holds back the heat pump, so that it is not running right at
 * the start. The wallbox needs no lead time. Rationale: docs/elisa.md, „Vorreservieren“.
 */
export const HEATPUMP_LEAD_MINUTES = 60;

/** A running reservation. */
export interface ReservationDto {
  producerId: string;
  /** Display name of the person reserving, never the email */
  userName: string;
  startsAt: number;
  endsAt: number;
  /** true = the signed-in user made the reservation */
  mine: boolean;
}

/** Why reserving is not possible right now: whatever is running is already subtracted from the shown surplus. */
export type BlockedReason = "heatpump" | "wallbox";

/** Text for the block, as the backend's error message and as a hint in the app */
export const BLOCKED_TEXT: Record<BlockedReason, string> = {
  heatpump: "Gerade nicht möglich: Wärmepumpe läuft",
  wallbox: "Gerade nicht möglich: das Auto lädt",
};

/** A producer's reservation state from a user's point of view. */
export interface ReservationStateDto {
  active: ReservationDto | null;
  /** planned for later today (at most one per producer); already counts against the budget with its full duration */
  planned: ReservationDto | null;
  /** the user may reserve with this producer (permission per share) */
  canReserve: boolean;
  /** still free today; a running reservation counts with its full planned duration */
  minutesLeft: number;
  /** Node-RED has reported within the last 60 s; otherwise the block has no effect */
  controlConnected: boolean;
  blockedReason: BlockedReason | null;
}

/** Request a reservation */
export const ReservationBody = z.object({
  minutes: z.number().int("Ganze Minuten angeben").min(1, "Mindestens 1 Minute").max(RESERVATION_DAILY_MINUTES, `Höchstens ${RESERVATION_DAILY_MINUTES} Minuten`),
  /** Start (Unix ms) of a planned reservation, today only; if missing, it starts immediately */
  startsAt: z.number().int("Ungültiger Beginn").optional(),
});
export type ReservationBody = z.infer<typeof ReservationBody>;

/** Device state that Node-RED sends to POST /api/control/status every 15 s. */
export const ControlStatus = z.object({
  compressorRunning: z.boolean(),
  /** any charging: manual, by price release or by departure planning */
  wallboxCharging: z.boolean(),
  /** manual control active; informational only, ELMA does not decide based on it */
  wallboxManual: z.boolean().default(false),
});
export type ControlStatus = z.infer<typeof ControlStatus>;

/** Response to Node-RED: is a reservation running right now, and until when (Unix ms, backend clock)? */
export interface ControlResponse {
  /** only the running reservation: holds back the wallbox, MAGGIE displays it */
  active: boolean;
  until: number | null;
  by?: string;
  /**
   * Until when the heat pump is held back: during a running reservation and already HEATPUMP_LEAD_MINUTES before
   * a planned one, in each case until its end. Node-RED stops a running compressor only after 60 min of runtime.
   */
  heatpumpUntil: number | null;
}

/** Recipients of a producer, for the list in the „Einladen“ sheet (only the producer sees it). */
export interface RecipientDto {
  userId: string;
  name: string;
  email: string;
  canReserve: boolean;
}

export const CanReserveBody = z.object({ canReserve: z.boolean() });

export interface HistoryPoint {
  /** Start of the minute, Unix milliseconds */
  t: number;
  /** Mean of the minute in watts */
  watts: number;
}

export interface MeDto {
  id: string;
  email: string;
  /** self-chosen name; null = not set, {@link displayNameOf} is shown instead */
  displayName: string | null;
}

/** Display name in the account, e.g. „Elisa“: 1–40 characters, trimmed. */
const DisplayName = z.string().trim().min(1, "Name darf nicht leer sein").max(40, "Name darf höchstens 40 Zeichen haben");

/** Change the display name; null clears it. */
export const DisplayNameBody = z.object({ displayName: DisplayName.nullable() });
export type DisplayNameBody = z.infer<typeof DisplayNameBody>;

/** Create an invite; on redemption the name is copied into the account if none is set there yet. */
export const InviteBody = z.object({ displayName: DisplayName.optional() });
export type InviteBody = z.infer<typeof InviteBody>;

/** Name for banner and push: the chosen display name, else the email part before the @, never the full address. */
export function displayNameOf(user: { displayName: string | null; email: string }): string {
  return user.displayName ?? user.email.split("@")[0]!;
}

/** A passkey of the signed-in user (without key material). */
export interface PasskeyDto {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
}

/** Start passkey registration: new account via invite or existing account via setup link. */
export const PasskeyRegisterStart = z.union([
  z.object({ inviteCode: z.string().min(1).max(100), email: z.string().trim().toLowerCase().email("Bitte eine gültige E-Mail angeben") }),
  z.object({ setupToken: z.string().min(1).max(100) }),
]);
export type PasskeyRegisterStart = z.infer<typeof PasskeyRegisterStart>;

/** The browser's response to a challenge; the WebAuthn library checks the content. */
export const PasskeyFinish = z.object({
  challengeId: z.string().min(1).max(100),
  response: z.looseObject({ id: z.string().min(1).max(1000) }),
});
export type PasskeyFinish = z.infer<typeof PasskeyFinish>;

/** From this power on it counts as "some surplus" (traffic light yellow, bar "ein wenig"). */
export const LEVEL_SOME_WATTS = 50;
/** From this power on it counts as "lots of surplus" (traffic light green, bar "viel"). */
export const LEVEL_LOTS_WATTS = 1000;

/** After this many milliseconds without a new value a producer counts as "offline". */
export const STALE_AFTER_MS = 60_000;

/**
 * Stability indicator (Wolfgang, 23.10.2026): "stable" if the raw value in the smoothing window was at least
 * STABLE_LEVEL_RATIO of the displayed mean for at least STABLE_TIME_SHARE of the time. A mean alone
 * shows "2 kW" for 0 ↔ 4 kW, and that is exactly what the recipient then relies on. Push only when "stable".
 * Since 26.10.2026 the current raw value must also be at STABLE_LEVEL_RATIO, and the window must be full
 * (rationale in `LiveHub.smooth`).
 */
export const STABLE_TIME_SHARE = 0.8;
export const STABLE_LEVEL_RATIO = 0.7;

/** An older battery value is no longer shown: ecoflowd can freeze (myhome, KONZEPT-ECOFLOW.md). */
export const BATTERY_STALE_MS = 5 * 60_000;
/** From this charging power on "Lädt" is shown; small top-ups explain no fluctuation (Wolfgang, 23.10.2026). */
export const BATTERY_CHARGING_WATTS = 200;
/** From this charge level on "Akku voll" is shown; the EcoFlow does not reliably reach 100 % (Wolfgang, 23.10.2026). */
export const BATTERY_FULL_SOC = 98;

/** A custom appliance created by the recipient. */
export const CustomAppliance = z.object({
  id: z.string().min(1).max(40),
  icon: z.string().min(1).max(40), // Lucide icon name, older entries: emoji
  name: z.string().trim().min(1).max(40),
  watts: z.number().int().min(1).max(50_000),
});
export type CustomAppliance = z.infer<typeof CustomAppliance>;

/** A user's appliance selection: IDs from the default catalog plus custom appliances, and those with push messages. */
export const ApplianceSettings = z.object({
  selected: z.array(z.string().min(1).max(40)).max(100),
  custom: z.array(CustomAppliance).max(50),
  notify: z.array(z.string().min(1).max(40)).max(100).default([]),
});
export type ApplianceSettings = z.infer<typeof ApplianceSettings>;

/** Web push subscription as the browser delivers it (PushSubscription.toJSON()). */
export const PushSubscriptionBody = z.object({
  // only real push services, otherwise one could make the backend send requests to any address (e.g. in the LAN)
  endpoint: z
    .string()
    .url()
    .max(1000)
    .refine((u) => {
      // also runs if url() has already failed; older iPhones do not know URL.parse yet
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

/** Content of a push message that the service worker displays. */
export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}

export * from "./appliances.ts";

export { Throttle } from "./throttle.ts";

export { isPushHost, PUSH_HOST_SUFFIXES } from "./push.ts";
