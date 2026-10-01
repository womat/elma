import { ApplianceSettings, type PasskeyDto, type PushSubscriptionBody } from "@elma/shared";
import type { Db } from "./db.ts";
import { hashToken, newId, newInviteCode, newToken } from "./crypto.ts";

export interface UserRow {
  id: string;
  email: string;
}

export interface PasskeyRow {
  id: string;
  user_id: string;
  public_key: Uint8Array<ArrayBuffer>;
  counter: number;
  transports: string[];
}

export interface ProducerRow {
  id: string;
  name: string;
  owner_id: string;
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SETUP_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Platzhalter für die alte Spalte password_hash (NOT NULL). Versionen vor 0.5.0 erkennen das Format nicht
 * und lehnen jede Passwort-Anmeldung ab.
 */
const NO_PASSWORD = "passkey-only";

/** Datenzugriff an einer Stelle, damit Berechtigungsregeln nicht in den Routen verstreut sind. */
export class Repo {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  createUser(email: string, id: string = newId()): UserRow {
    const user = { id, email: email.trim().toLowerCase() };
    this.db
      .prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .run(user.id, user.email, NO_PASSWORD, Date.now());
    return user;
  }

  userByEmail(email: string): UserRow | undefined {
    return this.db.prepare("SELECT id, email FROM users WHERE email = ?").get(email.trim().toLowerCase()) as UserRow | undefined;
  }

  userById(id: string): UserRow | undefined {
    return this.db.prepare("SELECT id, email FROM users WHERE id = ?").get(id) as UserRow | undefined;
  }

  /** Alle User mit Anzahl ihrer Passkeys, z. B. um zu sehen, wer noch umstellen muss. */
  usersWithPasskeyCount(): { email: string; passkeys: number }[] {
    return this.db
      .prepare(
        `SELECT u.email, (SELECT COUNT(*) FROM passkeys k WHERE k.user_id = u.id) AS passkeys
         FROM users u ORDER BY u.email`,
      )
      .all() as { email: string; passkeys: number }[];
  }

  // ---------- Passkeys ----------

  savePasskey(p: { id: string; userId: string; publicKey: Uint8Array; counter: number; transports?: string[]; name: string }): void {
    this.db
      .prepare(
        "INSERT INTO passkeys (id, user_id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(p.id, p.userId, p.publicKey, p.counter, JSON.stringify(p.transports ?? []), p.name, Date.now());
  }

  passkeyById(id: string): PasskeyRow | undefined {
    const row = this.db.prepare("SELECT id, user_id, public_key, counter, transports FROM passkeys WHERE id = ?").get(id) as
      | (Omit<PasskeyRow, "transports"> & { transports: string | null })
      | undefined;
    if (!row) return undefined;
    return { ...row, public_key: new Uint8Array(row.public_key), transports: JSON.parse(row.transports ?? "[]") as string[] };
  }

  /** Nach erfolgreicher Anmeldung: Zähler (Schutz gegen geklonte Schlüssel) und Zeitpunkt merken. */
  touchPasskey(id: string, counter: number): void {
    this.db.prepare("UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?").run(counter, Date.now(), id);
  }

  passkeysOf(userId: string): PasskeyDto[] {
    return this.db
      .prepare(
        "SELECT id, name, created_at AS createdAt, last_used_at AS lastUsedAt FROM passkeys WHERE user_id = ? ORDER BY created_at",
      )
      .all(userId) as unknown as PasskeyDto[];
  }

  /** IDs und Transportwege der Passkeys eines Users, damit dasselbe Gerät nicht doppelt registriert wird. */
  passkeyDescriptorsOf(userId: string): { id: string; transports: string[] }[] {
    const rows = this.db.prepare("SELECT id, transports FROM passkeys WHERE user_id = ?").all(userId) as {
      id: string;
      transports: string | null;
    }[];
    return rows.map((r) => ({ id: r.id, transports: JSON.parse(r.transports ?? "[]") as string[] }));
  }

  deletePasskey(id: string, userId: string): boolean {
    return this.db.prepare("DELETE FROM passkeys WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
  }

  // ---------- Einrichtungslinks ----------

  /** Erzeugt einen Einmal-Link zum Einrichten eines Passkeys; das Token gibt es nur jetzt im Klartext. */
  createSetupLink(userId: string): { token: string; expiresAt: number } {
    const token = newToken();
    const expiresAt = Date.now() + SETUP_LINK_TTL_MS;
    this.db.prepare("INSERT INTO setup_links (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(hashToken(token), userId, expiresAt);
    return { token, expiresAt };
  }

  /** User zu einem noch gültigen Einrichtungslink, ohne ihn zu verbrauchen. */
  userBySetupToken(token: string): UserRow | undefined {
    return this.db
      .prepare(
        `SELECT u.id, u.email FROM setup_links l JOIN users u ON u.id = l.user_id
         WHERE l.token_hash = ? AND l.used_at IS NULL AND l.expires_at > ?`,
      )
      .get(hashToken(token), Date.now()) as UserRow | undefined;
  }

  /** Verbraucht den Einrichtungslink; false, wenn er inzwischen benutzt oder abgelaufen ist. */
  useSetupLink(token: string): boolean {
    return (
      this.db
        .prepare("UPDATE setup_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?")
        .run(Date.now(), hashToken(token), Date.now()).changes > 0
    );
  }

  /** Legt einen Erzeuger an und gibt das Geräte-Token einmalig im Klartext zurück. */
  createProducer(name: string, ownerId: string): { producer: ProducerRow; deviceToken: string } {
    const deviceToken = newToken();
    const producer = { id: newId(), name, owner_id: ownerId };
    this.db
      .prepare("INSERT INTO producers (id, name, owner_id, device_token_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(producer.id, name, ownerId, hashToken(deviceToken), Date.now());
    return { producer, deviceToken };
  }

  /** Ersetzt das Geräte-Token (z. B. wenn die Shelly-URL weitergegeben wurde); das alte ist sofort ungültig. */
  rotateDeviceToken(producerId: string): string | undefined {
    const deviceToken = newToken();
    const { changes } = this.db
      .prepare("UPDATE producers SET device_token_hash = ? WHERE id = ?")
      .run(hashToken(deviceToken), producerId);
    return changes > 0 ? deviceToken : undefined;
  }

  producerByDeviceToken(token: string): ProducerRow | undefined {
    return this.db
      .prepare("SELECT id, name, owner_id FROM producers WHERE device_token_hash = ?")
      .get(hashToken(token)) as ProducerRow | undefined;
  }

  /** Alle Erzeuger, die ein User sehen darf: eigene und freigegebene. */
  visibleProducers(userId: string): ProducerRow[] {
    return this.db
      .prepare(
        `SELECT p.id, p.name, p.owner_id FROM producers p
         WHERE p.owner_id = ?1
            OR EXISTS (SELECT 1 FROM shares s WHERE s.producer_id = p.id AND s.recipient_id = ?1)
         ORDER BY p.name`,
      )
      .all(userId) as unknown as ProducerRow[];
  }

  canView(userId: string, producerId: string): boolean {
    return this.visibleProducers(userId).some((p) => p.id === producerId);
  }

  isOwner(userId: string, producerId: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM producers WHERE id = ? AND owner_id = ?").get(producerId, userId);
  }

  createInvite(producerId: string): { code: string; expiresAt: number } {
    const code = newInviteCode();
    const expiresAt = Date.now() + INVITE_TTL_MS;
    this.db.prepare("INSERT INTO invites (code, producer_id, expires_at) VALUES (?, ?, ?)").run(code, producerId, expiresAt);
    return { code, expiresAt };
  }

  /** Prüft, ob ein Einladungscode noch einlösbar ist, ohne ihn zu verbrauchen. */
  validInvite(code: string): { producer_id: string } | undefined {
    return this.db
      .prepare("SELECT producer_id FROM invites WHERE code = ? AND used_by IS NULL AND expires_at > ?")
      .get(code, Date.now()) as { producer_id: string } | undefined;
  }

  /** Löst eine Einladung ein und legt die Freigabe an. Gibt die producerId zurück oder null. */
  acceptInvite(code: string, userId: string): string | null {
    const invite = this.validInvite(code);
    if (!invite) return null;
    this.db.exec("BEGIN");
    try {
      this.db.prepare("UPDATE invites SET used_by = ? WHERE code = ?").run(userId, code);
      this.db
        .prepare("INSERT OR IGNORE INTO shares (producer_id, recipient_id, created_at) VALUES (?, ?, ?)")
        .run(invite.producer_id, userId, Date.now());
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return invite.producer_id;
  }

  /** Geräteauswahl, null = noch nichts gespeichert (Standardauswahl). */
  applianceSettings(userId: string): ApplianceSettings | null {
    const row = this.db.prepare("SELECT appliances FROM user_settings WHERE user_id = ?").get(userId) as
      | { appliances: string | null }
      | undefined;
    if (!row?.appliances) return null;
    // parse ergänzt Felder, die in älteren Einträgen fehlen (z. B. notify)
    const parsed = ApplianceSettings.safeParse(JSON.parse(row.appliances));
    return parsed.success ? parsed.data : null;
  }

  saveApplianceSettings(userId: string, settings: ApplianceSettings): void {
    this.db
      .prepare(
        `INSERT INTO user_settings (user_id, appliances) VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET appliances = excluded.appliances`,
      )
      .run(userId, JSON.stringify(settings));
  }

  renameProducer(id: string, name: string): void {
    this.db.prepare("UPDATE producers SET name = ? WHERE id = ?").run(name, id);
  }

  producerById(id: string): ProducerRow | undefined {
    return this.db.prepare("SELECT id, name, owner_id FROM producers WHERE id = ?").get(id) as ProducerRow | undefined;
  }

  /** Alle User, die einen Erzeuger sehen dürfen (Eigentümer + Empfänger). */
  viewersOf(producerId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT owner_id AS id FROM producers WHERE id = ?1
         UNION SELECT recipient_id AS id FROM shares WHERE producer_id = ?1`,
      )
      .all(producerId) as { id: string }[];
    return rows.map((r) => r.id);
  }

  savePushSubscription(userId: string, sub: PushSubscriptionBody): void {
    this.db
      .prepare(
        `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
      )
      .run(sub.endpoint, userId, sub.keys.p256dh, sub.keys.auth, Date.now());
  }

  deletePushSubscription(endpoint: string, userId?: string): void {
    if (userId) this.db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").run(endpoint, userId);
    else this.db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
  }

  pushSubscriptions(userId: string): PushSubscriptionBody[] {
    const rows = this.db
      .prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?")
      .all(userId) as { endpoint: string; p256dh: string; auth: string }[];
    return rows.map((r) => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }));
  }

  getMeta(key: string): string | undefined {
    return (this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined)?.value;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
  }

  saveMinute(producerId: string, minute: number, avgWatts: number): void {
    this.db
      .prepare("INSERT OR REPLACE INTO readings (producer_id, minute, avg_watts) VALUES (?, ?, ?)")
      .run(producerId, minute, avgWatts);
  }

  history(producerId: string, sinceMs: number): { t: number; watts: number }[] {
    return this.db
      .prepare("SELECT minute AS t, avg_watts AS watts FROM readings WHERE producer_id = ? AND minute >= ? ORDER BY minute")
      .all(producerId, sinceMs) as unknown as { t: number; watts: number }[];
  }

  pruneReadings(olderThanMs: number): void {
    this.db.prepare("DELETE FROM readings WHERE minute < ?").run(olderThanMs);
  }
}
