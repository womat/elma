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

    -- Share producer -> recipient. 1:1 is one row today, n:m later without restructuring.
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

    -- Personal settings, e.g. appliance selection (JSON)
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      appliances TEXT
    );

    -- Web push subscriptions (a user can have several devices)
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint   TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      p256dh     TEXT NOT NULL,
      auth       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- Internal keys/values, e.g. VAPID keys
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Passkeys (WebAuthn): only the public key, the private one stays on the device
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

    -- One-time links to set up a passkey (migration, lost phone); stored only as SHA-256
    CREATE TABLE IF NOT EXISTS setup_links (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      used_at    INTEGER
    );

    -- Per-minute average of the surplus
    CREATE TABLE IF NOT EXISTS readings (
      producer_id TEXT NOT NULL REFERENCES producers(id) ON DELETE CASCADE,
      minute      INTEGER NOT NULL,
      avg_watts   REAL NOT NULL,
      PRIMARY KEY (producer_id, minute)
    );

    -- Reservations (ELISA mode, docs/elisa.md). Ended ones are kept, the daily budget is computed from them.
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

    -- Control token for Node-RED (POST /api/control/status), separate from the device token; stored only as SHA-256
    CREATE TABLE IF NOT EXISTS control_tokens (
      token_hash   TEXT PRIMARY KEY,
      producer_id  TEXT NOT NULL REFERENCES producers(id) ON DELETE CASCADE,
      created_at   INTEGER NOT NULL,
      last_used_at INTEGER
    );
  `);
  // Passkeys only since 0.5.0: delete old password hashes (placeholder as in Repo.createUser, column is NOT NULL)
  db.exec("UPDATE users SET password_hash = 'passkey-only' WHERE password_hash LIKE 'scrypt:%'");
  // 0.7.0: display name so banner and push show „Elisa“ instead of the email (docs/elisa.md)
  addColumn(db, "users", "display_name", "TEXT");
  addColumn(db, "invites", "display_name", "TEXT");
  // 0.8.0: permission to reserve per share, granted by the producer (docs/elisa.md)
  addColumn(db, "shares", "can_reserve", "INTEGER NOT NULL DEFAULT 0");
  // 0.11.0: A planned and a running reservation can be open at the same time, which the unique index cannot
  // express. Two concurrent requests still cannot both get through: node:sqlite is synchronous, checking and
  // inserting in ReservationService.reserve run without interruption.
  db.exec("DROP INDEX IF EXISTS reservations_one_active");
  return db;
}

/** New column in an existing DB; CREATE TABLE IF NOT EXISTS does not change existing tables. */
function addColumn(db: Db, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
