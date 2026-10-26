export interface BridgeConfig {
  mqttUrl: string;
  mqttTopic: string;
  mqttUsername?: string;
  mqttPassword?: string;
  payloadPath?: string;
  payloadUnit: "W" | "kW";
  payloadInvert: boolean;
  backendUrl: string;
  deviceToken: string;
  minIntervalMs: number;
  deltaWatts: number;
  /** retained topic with the reservation (ELISA mode) for MAGGIE */
  reservationTopic: string;
  /** topic with the battery telegram from ecoflowd; empty = no battery hint in the app */
  batteryTopic?: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Umgebungsvariable ${name} fehlt`);
  return value;
}

/** Empty means default. Nonsense aborts: with NaN the throttle would silently keep running and only send on jumps. */
function count(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} muss eine Zahl ab 0 sein, ist "${raw}"`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const unit = (env.PAYLOAD_UNIT ?? "W").trim();
  if (unit !== "W" && unit !== "kW") throw new Error(`PAYLOAD_UNIT muss "W" oder "kW" sein, ist "${unit}"`);
  return {
    mqttUrl: required(env, "MQTT_URL"),
    mqttTopic: required(env, "MQTT_TOPIC"),
    mqttUsername: env.MQTT_USERNAME || undefined,
    mqttPassword: env.MQTT_PASSWORD || undefined,
    payloadPath: env.PAYLOAD_PATH || undefined,
    payloadUnit: unit,
    payloadInvert: env.PAYLOAD_INVERT === "true",
    backendUrl: required(env, "BACKEND_URL"),
    deviceToken: required(env, "DEVICE_TOKEN"),
    minIntervalMs: count(env, "MIN_INTERVAL_MS", 5000),
    deltaWatts: count(env, "DELTA_WATTS", 50),
    reservationTopic: env.RESERVATION_TOPIC?.trim() || "elma/reservation",
    batteryTopic: env.BATTERY_TOPIC?.trim() || undefined,
  };
}
