import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS producers (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      owner_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_token_hash TEXT NOT NULL UNIQUE,
      created_at        INTEGER NOT NULL
    );

    -- Freigabe Erzeuger -> Empfänger. 1:1 ist heute ein Datensatz, n:m später ohne Umbau.
    CREATE TABLE IF NOT EXISTS shares (
      producer_id  TEXT NOT NULL REFERENCES producers(id) ON DELETE CASCADE,
      recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at   INTEGER NOT NULL,
      PRIMARY KEY (producer_id, recipient_id)
    );

    CREATE TABLE IF NOT EXISTS invites (
      code        TEXT PRIMARY KEY,
      producer_id TEXT NOT NULL REFERENCES producers(id) ON DELETE CASCADE,
      expires_at  INTEGER NOT NULL,
      used_by     TEXT REFERENCES users(id)
    );

    -- Persönliche Einstellungen, z. B. Geräteauswahl (JSON)
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      appliances TEXT
    );

    -- Web-Push-Abos (ein User kann mehrere Geräte haben)
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint   TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      p256dh     TEXT NOT NULL,
      auth       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- Interne Schlüssel/Werte, z. B. VAPID-Schlüssel
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Passkeys (WebAuthn): nur der öffentliche Schlüssel, der private bleibt auf dem Gerät
    CREATE TABLE IF NOT EXISTS passkeys (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      public_key   BLOB NOT NULL,
      counter      INTEGER NOT NULL,
      transports   TEXT,
      name         TEXT NOT NULL,
      created_at   INTEGER NOT NULL,
      last_used_at INTEGER
    );

    -- Einmal-Links zum Einrichten eines Passkeys (Umstellung, verlorenes Handy); nur als SHA-256 gespeichert
    CREATE TABLE IF NOT EXISTS setup_links (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      used_at    INTEGER
    );

    -- Minutenmittel des Überschusses
    CREATE TABLE IF NOT EXISTS readings (
      producer_id TEXT NOT NULL REFERENCES producers(id) ON DELETE CASCADE,
      minute      INTEGER NOT NULL,
      avg_watts   REAL NOT NULL,
      PRIMARY KEY (producer_id, minute)
    );

    -- Reservierungen (ELISA-Modus, docs/elisa.md). Beendete bleiben stehen, darüber läuft das Tagesbudget.
    CREATE TABLE IF NOT EXISTS reservations (
      id          TEXT PRIMARY KEY,
      producer_id TEXT NOT NULL REFERENCES producers(id) ON DELETE CASCADE,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      starts_at   INTEGER NOT NULL,
      ends_at     INTEGER NOT NULL,
      ended_at    INTEGER,
      end_reason  TEXT
    );
    CREATE INDEX IF NOT EXISTS reservations_budget ON reservations (producer_id, user_id, starts_at);

    -- Steuer-Token für Node-RED (POST /api/control/status), getrennt vom Geräte-Token; nur als SHA-256 gespeichert
    CREATE TABLE IF NOT EXISTS control_tokens (
      token_hash   TEXT PRIMARY KEY,
      producer_id  TEXT NOT NULL REFERENCES producers(id) ON DELETE CASCADE,
      created_at   INTEGER NOT NULL,
      last_used_at INTEGER
    );
  `);
  // Seit 0.5.0 nur Passkeys: alte Passwort-Hashes löschen (Platzhalter wie in Repo.createUser, Spalte ist NOT NULL)
  db.exec("UPDATE users SET password_hash = 'passkey-only' WHERE password_hash LIKE 'scrypt:%'");
  // 0.7.0: Anzeigename, damit in Banner und Push „Elisa“ steht statt der E-Mail (docs/elisa.md)
  addColumn(db, "users", "display_name", "TEXT");
  addColumn(db, "invites", "display_name", "TEXT");
  // 0.8.0: Recht zum Reservieren pro Freigabe, vergibt der Erzeuger (docs/elisa.md)
  addColumn(db, "shares", "can_reserve", "INTEGER NOT NULL DEFAULT 0");
  // 0.11.0: Eine geplante und eine laufende Reservierung können gleichzeitig offen sein, das kann der eindeutige Index
  // nicht ausdrücken. Zwei gleichzeitige Anfragen kommen trotzdem nicht beide durch: node:sqlite ist synchron, Prüfen und
  // Einfügen in ReservationService.reserve laufen ohne Unterbrechung.
  db.exec("DROP INDEX IF EXISTS reservations_one_active");
  return db;
}

/** Neue Spalte in einer bestehenden DB; CREATE TABLE IF NOT EXISTS ändert vorhandene Tabellen nicht. */
function addColumn(db: Db, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
