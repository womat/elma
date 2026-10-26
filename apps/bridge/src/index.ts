import mqtt from "mqtt";
import { loadConfig } from "./config.ts";
import { normalizePayload, parseBattery } from "./normalize.ts";
import { Throttle } from "@elma/shared";
import { BackendLink } from "./backend-link.ts";
import { reservationPayload } from "./reservation.ts";

const config = loadConfig();
console.log(`[elma] Bridge ${process.env.ELMA_VERSION ?? "dev"} startet`);
const throttle = new Throttle(config.minIntervalMs, config.deltaWatts);

const client = mqtt.connect(config.mqttUrl, {
  username: config.mqttUsername,
  password: config.mqttPassword,
  reconnectPeriod: 5000,
});

// Reservation (ELISA mode) retained for MAGGIE, display only. Node-RED deliberately does not read the topic, so
// a forged message on the open broker changes at most the traffic light. If MQTT is down, mqtt.js buffers the message.
const backend = new BackendLink(`${config.backendUrl.replace(/\/$/, "")}/ingest`, config.deviceToken, (msg) => {
  const payload = reservationPayload(msg);
  console.log(`[mqtt] ${config.reservationTopic}: ${payload}`);
  client.publish(config.reservationTopic, payload, { retain: true, qos: 1 }, (err) => {
    if (err) console.error(`[mqtt] Reservierung nicht veröffentlicht: ${err.message}`);
  });
});
backend.start();

client.on("connect", () => {
  const topics = config.batteryTopic ? [config.mqttTopic, config.batteryTopic] : [config.mqttTopic];
  console.log(`[mqtt] verbunden mit ${config.mqttUrl}, abonniere ${topics.map((t) => `"${t}"`).join(", ")}`);
  client.subscribe(topics, (err) => {
    if (err) console.error(`[mqtt] Abo fehlgeschlagen: ${err.message}`);
  });
});
client.on("error", (err) => console.warn(`[mqtt] Fehler: ${err.message}`));
client.on("offline", () => console.warn("[mqtt] offline, versuche erneut ..."));

client.on("message", (topic, message) => {
  const payload = message.toString();
  // Battery values unthrottled: they come rarely and only reach the app with the next surplus value.
  if (topic === config.batteryTopic) {
    const battery = parseBattery(payload, Date.now());
    if (battery) backend.send({ type: "battery", battery });
    else console.warn(`[mqtt] ${topic}: kein Akkuwert in Payload ${JSON.stringify(payload.slice(0, 200))}`);
    return;
  }
  const watts = normalizePayload(payload, config);
  if (watts === null) {
    console.warn(`[mqtt] ${topic}: kein Zahlenwert in Payload ${JSON.stringify(payload.slice(0, 200))}`);
    return;
  }
  const now = Date.now();
  if (!throttle.shouldSend(watts, now)) return;
  throttle.markSent(watts, now);
  console.log(`[mqtt] ${topic}: ${watts} W`);
  backend.send({ type: "reading", reading: { watts, timestamp: now } });
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    backend.stop();
    client.end(false, {}, () => process.exit(0));
  });
}
