import mqtt from "mqtt";
import { loadConfig } from "./config.ts";
import { normalizePayload } from "./normalize.ts";
import { Throttle } from "./throttle.ts";
import { BackendLink } from "./backend-link.ts";

const config = loadConfig();
console.log(`[elma] Bridge ${process.env.ELMA_VERSION ?? "dev"} startet`);
const throttle = new Throttle(config.minIntervalMs, config.deltaWatts);
const backend = new BackendLink(`${config.backendUrl.replace(/\/$/, "")}/ingest`, config.deviceToken);
backend.start();

const client = mqtt.connect(config.mqttUrl, {
  username: config.mqttUsername,
  password: config.mqttPassword,
  reconnectPeriod: 5000,
});

client.on("connect", () => {
  console.log(`[mqtt] verbunden mit ${config.mqttUrl}, abonniere "${config.mqttTopic}"`);
  client.subscribe(config.mqttTopic, (err) => {
    if (err) console.error(`[mqtt] Abo fehlgeschlagen: ${err.message}`);
  });
});
client.on("error", (err) => console.warn(`[mqtt] Fehler: ${err.message}`));
client.on("offline", () => console.warn("[mqtt] offline, versuche erneut ..."));

client.on("message", (topic, message) => {
  const payload = message.toString();
  const watts = normalizePayload(payload, config);
  if (watts === null) {
    console.warn(`[mqtt] ${topic}: kein Zahlenwert in Payload ${JSON.stringify(payload.slice(0, 200))}`);
    return;
  }
  const now = Date.now();
  if (!throttle.shouldSend(watts, now)) return;
  throttle.markSent(watts, now);
  console.log(`[mqtt] ${topic}: ${watts} W`);
  backend.send({ watts, timestamp: now });
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    backend.stop();
    client.end(false, {}, () => process.exit(0));
  });
}
