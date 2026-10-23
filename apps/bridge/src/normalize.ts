import { BatteryReading } from "@elma/shared";
import type { BridgeConfig } from "./config.ts";

type NormalizeOptions = Pick<BridgeConfig, "payloadPath" | "payloadUnit" | "payloadInvert">;

/**
 * Wandelt eine MQTT-Payload in Watt um.
 * Unterstützt reine Zahlen ("1234", "1.2") und JSON mit Pfad (z. B. PAYLOAD_PATH="data.surplus").
 * Gibt null zurück, wenn kein Zahlenwert gefunden wird.
 */
export function normalizePayload(payload: string, opts: NormalizeOptions): number | null {
  const raw = extract(payload.trim(), opts.payloadPath);
  if (raw === null) return null;

  let watts = opts.payloadUnit === "kW" ? raw * 1000 : raw;
  if (opts.payloadInvert) watts = -watts;
  return Math.round(watts);
}

/**
 * Liest ein Telegramm von ecoflowd (`myhome/ecoflow/state`): `battery` in W (positiv = lädt), `soc` in %, `timestamp`
 * als Messzeit des Geräts (RFC 3339). Die Feldnamen sind fest, es gibt nur diese eine Quelle. Ohne gültigen
 * Zeitstempel gilt die Empfangszeit. Null, wenn kein gültiger Akkuwert drinsteht.
 */
export function parseBattery(payload: string, now: number): BatteryReading | null {
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return null;
  }
  if (json === null || typeof json !== "object") return null;
  const { battery, soc, timestamp } = json as Record<string, unknown>;
  const measured = typeof timestamp === "string" ? Date.parse(timestamp) : NaN;
  const parsed = BatteryReading.safeParse({ watts: battery, soc, timestamp: Number.isFinite(measured) ? measured : now });
  return parsed.success ? parsed.data : null;
}

function extract(payload: string, path: string | undefined): number | null {
  if (!path) return toNumber(payload);

  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  for (const key of path.split(".")) {
    if (value === null || typeof value !== "object") return null;
    value = (value as Record<string, unknown>)[key];
  }
  return toNumber(value);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number(value.trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
