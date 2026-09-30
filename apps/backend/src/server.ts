import { resolve } from "node:path";
import { buildApp } from "./app.ts";
import { openDb } from "./db.ts";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  console.error("JWT_SECRET fehlt oder ist kürzer als 32 Zeichen (z. B. `openssl rand -hex 32`)");
  process.exit(1);
}

const db = openDb(process.env.DB_PATH ?? resolve("data/elma.db"));
const { app, hub, repo } = await buildApp({
  db,
  jwtSecret,
  publicUrl: process.env.PUBLIC_URL ?? "http://localhost:3000",
  webDir: process.env.WEB_DIR ?? resolve(import.meta.dirname, "../../web/dist"),
  logger: true,
  vapidSubject: process.env.VAPID_SUBJECT,
});

const timer = setInterval(() => {
  hub.flushCompleted(Date.now());
  repo.pruneReadings(Date.now() - RETENTION_MS);
}, 60_000);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    clearInterval(timer);
    hub.flush();
    await app.close();
    db.close();
    process.exit(0);
  });
}

await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 3000) });
