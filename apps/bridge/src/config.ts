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
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Umgebungsvariable ${name} fehlt`);
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
    minIntervalMs: Number(env.MIN_INTERVAL_MS ?? 5000),
    deltaWatts: Number(env.DELTA_WATTS ?? 50),
  };
}
