import { ApplianceSettings, type PasskeyDto, type PushSubscriptionBody } from "@elma/shared";
import type { Db } from "./db.ts";
import { hashToken, newId, newInviteCode, newToken } from "./crypto.ts";

export interface UserRow {
  id: string;
  email: string;
  displayName: string | null;
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

export interface ReservationRow {
  id: string;
  producerId: string;
  userId: string;
  startsAt: number;
  endsAt: number;
}

/**
 * expired = time ran out, user/owner = ended early, wallbox = charging started, revoked = permission withdrawn,
 * cancelled = planned one called off before its start
 */
export type ReservationEndReason = "expired" | "user" | "owner" | "wallbox" | "revoked" | "cancelled";

const RESERVATION_SELECT =
  "SELECT id, producer_id AS producerId, user_id AS userId, starts_at AS startsAt, ends_at AS endsAt FROM reservations";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SETUP_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Placeholder for the old column password_hash (NOT NULL). Versions before 0.5.0 don't recognize the format
 * and reject every password login.
 */
const NO_PASSWORD = "passkey-only";

/** Data access in one place so permission rules are not scattered across the routes. */
export class Repo {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  createUser(email: string, id: string = newId()): UserRow {
    const user = { id, email: email.trim().toLowerCase(), displayName: null };
    this.db
      .prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .run(user.id, user.email, NO_PASSWORD, Date.now());
    return user;
  }

  userByEmail(email: string): UserRow | undefined {
    return this.db.prepare("SELECT id, email, display_name AS displayName FROM users WHERE email = ?").get(email.trim().toLowerCase()) as UserRow | undefined;
  }

  userById(id: string): UserRow | undefined {
    return this.db.prepare("SELECT id, email, display_name AS displayName FROM users WHERE id = ?").get(id) as UserRow | undefined;
  }

  /** null deletes the name; then the part of the email before the @ applies again. */
  setDisplayName(userId: string, displayName: string | null): void {
    this.db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(displayName, userId);
  }

  /** All users with the number of their passkeys, e.g. to see who still has to switch over. */
  usersWithPasskeyCount(): { email: string; displayName: string | null; passkeys: number }[] {
    return this.db
      .prepare(
        `SELECT u.email, u.display_name AS displayName, (SELECT COUNT(*) FROM passkeys k WHERE k.user_id = u.id) AS passkeys
         FROM users u ORDER BY u.email`,
      )
      .all() as { email: string; displayName: string | null; passkeys: number }[];
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

  /** After a successful login: remember counter (protection against cloned keys) and time. */
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

  /** IDs and transports of a user's passkeys so the same device is not registered twice. */
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

  // ---------- Setup links ----------

  /** Creates a one-time link to set up a passkey; the token is available in plain text only now. */
  createSetupLink(userId: string): { token: string; expiresAt: number } {
    const token = newToken();
    const expiresAt = Date.now() + SETUP_LINK_TTL_MS;
    this.db.prepare("INSERT INTO setup_links (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(hashToken(token), userId, expiresAt);
    return { token, expiresAt };
  }

  /** User of a still valid setup link, without consuming it. */
  userBySetupToken(token: string): UserRow | undefined {
    return this.db
      .prepare(
        `SELECT u.id, u.email, u.display_name AS displayName FROM setup_links l JOIN users u ON u.id = l.user_id
         WHERE l.token_hash = ? AND l.used_at IS NULL AND l.expires_at > ?`,
      )
      .get(hashToken(token), Date.now()) as UserRow | undefined;
  }

  /** Consumes the setup link; false if it has been used or has expired in the meantime. */
  useSetupLink(token: string): boolean {
    return (
      this.db
        .prepare("UPDATE setup_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?")
        .run(Date.now(), hashToken(token), Date.now()).changes > 0
    );
  }

  /** Creates a producer and returns the device token once in plain text. */
  createProducer(name: string, ownerId: string): { producer: ProducerRow; deviceToken: string } {
    const deviceToken = newToken();
    const producer = { id: newId(), name, owner_id: ownerId };
    this.db
      .prepare("INSERT INTO producers (id, name, owner_id, device_token_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(producer.id, name, ownerId, hashToken(deviceToken), Date.now());
    return { producer, deviceToken };
  }

  /** Replaces the device token (e.g. if the Shelly URL was passed on); the old one is invalid immediately. */
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

  /** All producers a user may see: own and shared ones. */
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

  /** displayName: name of the invited person, goes into the account on redemption (see acceptInvite). */
  createInvite(producerId: string, displayName: string | null = null): { code: string; expiresAt: number } {
    const code = newInviteCode();
    const expiresAt = Date.now() + INVITE_TTL_MS;
    this.db
      .prepare("INSERT INTO invites (code, producer_id, expires_at, display_name) VALUES (?, ?, ?, ?)")
      .run(code, producerId, expiresAt, displayName);
    return { code, expiresAt };
  }

  /** Checks whether an invite code can still be redeemed, without consuming it. */
  validInvite(code: string): { producer_id: string; display_name: string | null } | undefined {
    return this.db
      .prepare("SELECT producer_id, display_name FROM invites WHERE code = ? AND used_by IS NULL AND expires_at > ?")
      .get(code, Date.now()) as { producer_id: string; display_name: string | null } | undefined;
  }

  /**
   * Redeems an invite and creates the share. Returns the producerId or null.
   * The name from the invite only goes into an account without a name: an invite never overrides what someone chose
   * themselves.
   */
  acceptInvite(code: string, userId: string): string | null {
    const invite = this.validInvite(code);
    if (!invite) return null;
    this.db.exec("BEGIN");
    try {
      this.db.prepare("UPDATE invites SET used_by = ? WHERE code = ?").run(userId, code);
      this.db
        .prepare("INSERT OR IGNORE INTO shares (producer_id, recipient_id, created_at) VALUES (?, ?, ?)")
        .run(invite.producer_id, userId, Date.now());
      if (invite.display_name) {
        this.db.prepare("UPDATE users SET display_name = ? WHERE id = ? AND display_name IS NULL").run(invite.display_name, userId);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return invite.producer_id;
  }

  /** Appliance selection, null = nothing saved yet (default selection). */
  applianceSettings(userId: string): ApplianceSettings | null {
    const row = this.db.prepare("SELECT appliances FROM user_settings WHERE user_id = ?").get(userId) as
      | { appliances: string | null }
      | undefined;
    if (!row?.appliances) return null;
    // parse fills in fields missing in older entries (e.g. notify)
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

  /** All users who may see a producer (owner + recipients). */
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

  // ---------- Reservation (ELISA mode) ----------

  /** Only recipients with a share and the permission set; the owner does not reserve on their own producer. */
  canReserve(producerId: string, userId: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM shares WHERE producer_id = ? AND recipient_id = ? AND can_reserve = 1").get(producerId, userId);
  }

  /** false if there is no share for this recipient. */
  setCanReserve(producerId: string, recipientId: string, canReserve: boolean): boolean {
    return (
      this.db
        .prepare("UPDATE shares SET can_reserve = ? WHERE producer_id = ? AND recipient_id = ?")
        .run(canReserve ? 1 : 0, producerId, recipientId).changes > 0
    );
  }

  recipientsOf(producerId: string): { id: string; email: string; displayName: string | null; canReserve: boolean }[] {
    const rows = this.db
      .prepare(
        `SELECT u.id, u.email, u.display_name AS displayName, s.can_reserve AS canReserve
         FROM shares s JOIN users u ON u.id = s.recipient_id WHERE s.producer_id = ? ORDER BY s.created_at`,
      )
      .all(producerId) as { id: string; email: string; displayName: string | null; canReserve: number }[];
    return rows.map((r) => ({ ...r, canReserve: r.canReserve === 1 }));
  }

  /** Running and planned reservations of a producer, sorted by start. */
  openReservations(producerId: string): ReservationRow[] {
    return this.db
      .prepare(`${RESERVATION_SELECT} WHERE producer_id = ? AND ended_at IS NULL ORDER BY starts_at`)
      .all(producerId) as unknown as ReservationRow[];
  }

  /** All reservations not yet ended, e.g. to set the timers again after a restart. */
  activeReservations(): ReservationRow[] {
    return this.db.prepare(`${RESERVATION_SELECT} WHERE ended_at IS NULL`).all() as unknown as ReservationRow[];
  }

  /**
   * Milliseconds used by a recipient at a producer since dayStart. Ended ones count with the time actually used,
   * a running or planned one with its full duration (it may still run until its end).
   */
  reservedMsSince(producerId: string, userId: string, dayStart: number): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(MIN(COALESCE(ended_at, ends_at), ends_at) - starts_at), 0) AS ms FROM reservations
         WHERE producer_id = ? AND user_id = ? AND starts_at >= ?`,
      )
      .get(producerId, userId, dayStart) as { ms: number };
    return row.ms;
  }

  /** The rules (overlap, budget) are checked by ReservationService beforehand. */
  createReservation(producerId: string, userId: string, startsAt: number, endsAt: number): ReservationRow {
    const id = newId();
    this.db
      .prepare("INSERT INTO reservations (id, producer_id, user_id, starts_at, ends_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, producerId, userId, startsAt, endsAt);
    return { id, producerId, userId, startsAt, endsAt };
  }

  /** false if it had already ended. */
  endReservation(id: string, endedAt: number, reason: ReservationEndReason): boolean {
    return (
      this.db
        .prepare("UPDATE reservations SET ended_at = ?, end_reason = ? WHERE id = ? AND ended_at IS NULL")
        .run(endedAt, reason, id).changes > 0
    );
  }

  /** New control token for Node-RED; a previous one of the producer becomes invalid. Plain text only now. */
  createControlToken(producerId: string): string {
    const token = newToken();
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM control_tokens WHERE producer_id = ?").run(producerId);
      this.db.prepare("INSERT INTO control_tokens (token_hash, producer_id, created_at) VALUES (?, ?, ?)").run(hashToken(token), producerId, Date.now());
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return token;
  }

  controlTokenProducer(token: string): ProducerRow | undefined {
    return this.db
      .prepare("SELECT p.id, p.name, p.owner_id FROM control_tokens t JOIN producers p ON p.id = t.producer_id WHERE t.token_hash = ?")
      .get(hashToken(token)) as ProducerRow | undefined;
  }

  /** Records the last use, at most once per hour: Node-RED polls every 15 s, that would be needlessly many writes. */
  touchControlToken(token: string, now = Date.now()): void {
    this.db
      .prepare("UPDATE control_tokens SET last_used_at = ?1 WHERE token_hash = ?2 AND (last_used_at IS NULL OR last_used_at < ?1 - 3600000)")
      .run(now, hashToken(token));
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
