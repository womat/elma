import { BatteryReading } from "@elma/shared";
import type { BridgeConfig } from "./config.ts";

type NormalizeOptions = Pick<BridgeConfig, "payloadPath" | "payloadUnit" | "payloadInvert">;

/**
 * Converts an MQTT payload to watts.
 * Supports plain numbers ("1234", "1.2") and JSON with a path (e.g. PAYLOAD_PATH="data.surplus").
 * Returns null if no numeric value is found.
 */
export function normalizePayload(payload: string, opts: NormalizeOptions): number | null {
  const raw = extract(payload.trim(), opts.payloadPath);
  if (raw === null) return null;

  let watts = opts.payloadUnit === "kW" ? raw * 1000 : raw;
  if (opts.payloadInvert) watts = -watts;
  return Math.round(watts);
}

/**
 * Reads a telegram from ecoflowd (`myhome/ecoflow/state`): `battery` in W (positive = charging), `soc` in %,
 * `timestamp` as the device's measurement time (RFC 3339). The field names are fixed, there is only this one source.
 * Without a valid timestamp the receive time applies. Null if it contains no valid battery value.
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
