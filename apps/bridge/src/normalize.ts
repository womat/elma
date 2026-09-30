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
