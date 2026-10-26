import {
  BLOCKED_TEXT,
  displayNameOf,
  HEATPUMP_LEAD_MINUTES,
  RESERVATION_DAILY_MINUTES,
  type BlockedReason,
  type ControlResponse,
  type ControlStatus,
  type PushPayload,
  type ReservationDto,
  type ReservationStateDto,
} from "@elma/shared";
import type { Repo, ReservationEndReason, ReservationRow } from "./repo.ts";

const MINUTE = 60_000;
/** The budget day is always counted in this time zone, regardless of the container's. */
export const TIME_ZONE = "Europe/Vienna";
/** How long the last Node-RED status is valid; after that the block has no effect and nothing is rejected. */
export const CONTROL_STALE_MS = 60_000;

export interface ReservationNotifier {
  notifyUsers(userIds: string[], payload: PushPayload): Promise<void>;
}

/** Rejected request; status becomes the HTTP status 1:1. */
export class ReservationError extends Error {
  readonly status: 400 | 403 | 404 | 409;
  constructor(status: 400 | 403 | 404 | 409, message: string) {
    super(message);
    this.status = status;
  }
}

const timeFormat = new Intl.DateTimeFormat("de-AT", { hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE });
const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** Time of day for push and error messages, e.g. „14:22“ */
export function formatTime(t: number): string {
  return timeFormat.format(t);
}

/** How far the clock in Vienna is ahead of UTC at time t (1 or 2 hours). */
function viennaOffsetMs(t: number): number {
  const p = Object.fromEntries(partsFormat.formatToParts(t).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - Math.floor(t / 1000) * 1000;
}

/** Midnight in Vienna of the day containing t (Unix ms). DST changes happen at 2–3 a.m., never at midnight. */
export function viennaDayStart(t: number): number {
  const local = t + viennaOffsetMs(t);
  const midnightAsUtc = local - (((local % 86_400_000) + 86_400_000) % 86_400_000);
  return midnightAsUtc - viennaOffsetMs(midnightAsUtc - viennaOffsetMs(t));
}

/**
 * Rules and flow of the ELISA mode: permission, daily budget, at most one running and one planned reservation per
 * producer without overlap, rejection while appliances run, start and end by timer. The last Node-RED status is
 * kept in memory only; after a restart Node-RED reports again within 15 s at the latest. Rationale: docs/elisa.md.
 */
export class ReservationService {
  private readonly repo: Repo;
  private readonly notifier: ReservationNotifier;
  /** per reservation ID, because a planned and a running one can have timers at the same time */
  private readonly startTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly endTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly control = new Map<string, { status: ControlStatus; at: number }>();
  private readonly staleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly listeners = new Set<(producerId: string) => void>();
  private sends: Promise<void>[] = [];

  constructor(repo: Repo, notifier: ReservationNotifier) {
    this.repo = repo;
    this.notifier = notifier;
  }

  /**
   * Restores the timers of open reservations. Whatever started or expired during the restart gets no push.
   */
  start(now = Date.now()): void {
    for (const r of this.repo.activeReservations()) {
      if (r.endsAt <= now) this.repo.endReservation(r.id, r.endsAt, "expired");
      else this.schedule(r, now);
    }
  }

  stop(): void {
    for (const timer of [...this.startTimers.values(), ...this.endTimers.values(), ...this.staleTimers.values()]) clearTimeout(timer);
    this.startTimers.clear();
    this.endTimers.clear();
    this.staleTimers.clear();
  }

  /** Called on every change of a producer; each subscriber fetches the state with stateFor. */
  subscribe(listener: (producerId: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Waits for all push messages sent so far (for tests). */
  async settled(): Promise<void> {
    await Promise.all(this.sends);
  }

  stateFor(producerId: string, userId: string, now = Date.now()): ReservationStateDto {
    const running = this.running(producerId, now);
    const planned = this.planned(producerId, now);
    return {
      active: running ? this.toDto(running, userId) : null,
      planned: planned ? this.toDto(planned, userId) : null,
      canReserve: this.repo.canReserve(producerId, userId),
      minutesLeft: this.minutesLeft(producerId, userId, now),
      controlConnected: this.isConnected(producerId, now),
      blockedReason: this.blockedReason(producerId, now),
    };
  }

  /**
   * Without startsAt (or at most one minute ahead) the reservation starts immediately. Otherwise it is planned for
   * later today; then nobody checks the appliances, because hours may pass until the start.
   */
  reserve(producerId: string, userId: string, minutes: number, startsAt?: number, now = Date.now()): ReservationRow {
    if (!this.repo.canReserve(producerId, userId)) throw new ReservationError(403, "Du darfst hier keinen Strom reservieren");
    if (startsAt !== undefined && startsAt < now - MINUTE) throw new ReservationError(400, "Die Uhrzeit ist schon vorbei");
    const later = startsAt !== undefined && startsAt > now + MINUTE;
    const start = later ? startsAt : now;
    const end = start + minutes * MINUTE;
    const running = this.running(producerId, now);
    const planned = this.planned(producerId, now);

    if (later) {
      if (viennaDayStart(start) !== viennaDayStart(now)) throw new ReservationError(400, "Planen geht nur für heute");
      if (planned) {
        throw new ReservationError(
          409,
          planned.userId === userId
            ? `Du hast schon für ${formatTime(planned.startsAt)} geplant`
            : `Für ${formatTime(planned.startsAt)} hat schon ${this.nameOf(planned.userId)} reserviert`,
        );
      }
      if (running && start < running.endsAt) {
        throw new ReservationError(409, `Bis ${formatTime(running.endsAt)} ist schon reserviert, frühestens dann`);
      }
    } else {
      if (running) {
        throw new ReservationError(
          409,
          running.userId === userId ? "Du hast schon reserviert" : `Gerade reserviert von ${this.nameOf(running.userId)} bis ${formatTime(running.endsAt)}`,
        );
      }
      // Spontaneous reservations are allowed until the planned one starts, even in its lead hour: the heat pump
      // is blocked then anyway
      if (planned && end > planned.startsAt) {
        throw new ReservationError(409, `Um ${formatTime(planned.startsAt)} ist schon reserviert, höchstens bis dahin`);
      }
    }

    const left = this.minutesLeft(producerId, userId, now);
    if (minutes > left) {
      throw new ReservationError(
        409,
        left === 0 ? `Heute schon ${RESERVATION_DAILY_MINUTES} min reserviert, morgen wieder` : `Heute sind nur noch ${left} min frei`,
      );
    }
    if (!later) {
      // What is running now is already subtracted from the surplus: the reservation would only cost budget without
      // protecting anything
      const blocked = this.blockedReason(producerId, now);
      if (blocked) throw new ReservationError(409, BLOCKED_TEXT[blocked]);
    }

    const row = this.repo.createReservation(producerId, userId, start, end);
    this.schedule(row, now);
    const producer = this.repo.producerById(producerId);
    if (producer && later) {
      const lead = start - HEATPUMP_LEAD_MINUTES * MINUTE;
      this.push([producer.owner_id], {
        title: `📅 ${this.nameOf(userId)} reserviert heute ${formatTime(start)}–${formatTime(end)}`,
        body: `Die Wärmepumpe wird ${lead <= now ? "ab sofort" : `ab ${formatTime(lead)}`} zurückgehalten.`,
      });
    } else if (producer) {
      this.pushStart(row, producer.owner_id);
    }
    this.emit(producerId);
    return row;
  }

  /** The reserving user and the producer may end it. */
  end(producerId: string, userId: string, now = Date.now()): void {
    const running = this.running(producerId, now);
    if (!running) throw new ReservationError(404, "Gerade ist nichts reserviert");
    if (running.userId === userId) this.finish(running, "user", now);
    else if (this.repo.isOwner(userId, producerId)) this.finish(running, "owner", now);
    else throw new ReservationError(403, "Nur wer reserviert hat und der Erzeuger können beenden");
  }

  /** Cancel a planned one; the planner and the producer may. It uses no budget; the other party gets a push. */
  cancelPlanned(producerId: string, userId: string, now = Date.now()): void {
    const planned = this.planned(producerId, now);
    if (!planned) throw new ReservationError(404, "Es ist nichts geplant");
    const byOwner = planned.userId !== userId;
    if (byOwner && !this.repo.isOwner(userId, producerId)) {
      throw new ReservationError(403, "Nur wer geplant hat und der Erzeuger können absagen");
    }
    this.close(planned, planned.startsAt, "cancelled");

    const producer = this.repo.producerById(producerId);
    if (producer) {
      const range = `${formatTime(planned.startsAt)}–${formatTime(planned.endsAt)}`;
      if (byOwner) {
        this.push([planned.userId], {
          title: `📅 ${this.nameOf(producer.owner_id)} hat deine Reservierung abgesagt`,
          body: `${range} fällt weg, heute noch ${this.minutesLeft(producerId, planned.userId, now)} min übrig`,
        });
      } else {
        this.push([producer.owner_id], {
          title: `📅 ${this.nameOf(planned.userId)} hat abgesagt`,
          body: `Die Reservierung um ${formatTime(planned.startsAt)} fällt weg, die Wärmepumpe ist frei.`,
        });
      }
    }
    this.emit(producerId);
  }

  /** Grant or revoke the permission. Revoking ends running and planned reservations immediately. */
  setCanReserve(producerId: string, recipientId: string, canReserve: boolean, now = Date.now()): void {
    if (!this.repo.setCanReserve(producerId, recipientId, canReserve)) throw new ReservationError(404, "Kein Empfänger dieses Erzeugers");
    const own = canReserve ? [] : this.repo.openReservations(producerId).filter((r) => r.userId === recipientId);
    for (const r of own) this.finish(r, "revoked", now);
    if (own.length === 0) this.emit(producerId);
  }

  /** Take over the status from Node-RED and report back whether a reservation is running. */
  reportStatus(producerId: string, status: ControlStatus, now = Date.now()): ControlResponse {
    const before = this.controlSummary(producerId, now);
    this.control.set(producerId, { status, at: now });
    clearTimeout(this.staleTimers.get(producerId));
    const stale = setTimeout(() => {
      this.staleTimers.delete(producerId);
      this.emit(producerId);
    }, CONTROL_STALE_MS);
    stale.unref?.();
    this.staleTimers.set(producerId, stale);

    const running = this.running(producerId, now);
    // The producer's manual operation takes precedence; the reservation no longer protects anything then
    if (running && status.wallboxCharging) this.finish(running, "wallbox", now);
    else if (before !== this.controlSummary(producerId, now)) this.emit(producerId);
    return this.current(producerId, now);
  }

  /** Whether and until when reserved, without a user's view: for Node-RED and the bridge (MAGGIE). */
  current(producerId: string, now = Date.now()): ControlResponse {
    const open = this.repo.openReservations(producerId);
    // Hold back the heat pump HEATPUMP_LEAD_MINUTES before the start so it isn't running right at the start
    const held = open.filter((r) => r.startsAt - HEATPUMP_LEAD_MINUTES * MINUTE <= now);
    const heatpumpUntil = held.length > 0 ? Math.max(...held.map((r) => r.endsAt)) : null;
    const running = this.running(producerId, now);
    return running
      ? { active: true, until: running.endsAt, by: this.nameOf(running.userId), heatpumpUntil }
      : { active: false, until: null, heatpumpUntil };
  }

  /**
   * The most recently started open reservation. If a spontaneous one ends exactly when the planned one starts,
   * this is the planned one.
   */
  private running(producerId: string, now: number): ReservationRow | undefined {
    return this.repo.openReservations(producerId).findLast((r) => r.startsAt <= now && now < r.endsAt);
  }

  private planned(producerId: string, now: number): ReservationRow | undefined {
    return this.repo.openReservations(producerId).find((r) => r.startsAt > now);
  }

  private toDto(row: ReservationRow, userId: string): ReservationDto {
    return { producerId: row.producerId, userName: this.nameOf(row.userId), startsAt: row.startsAt, endsAt: row.endsAt, mine: row.userId === userId };
  }

  /** Start of a planned reservation. */
  private begin(row: ReservationRow, now: number): void {
    this.startTimers.delete(row.id);
    // If the car is already charging, the same rule applies as for charging that starts: manual operation wins
    if (this.isConnected(row.producerId, now) && this.control.get(row.producerId)!.status.wallboxCharging) {
      this.finish(row, "wallbox", now);
      return;
    }
    const producer = this.repo.producerById(row.producerId);
    if (producer) {
      this.pushStart(row, producer.owner_id);
      this.push([row.userId], { title: "🔒 Deine Reservierung läuft", body: `bis ${formatTime(row.endsAt)} – jetzt kannst du einschalten` });
    }
    this.emit(row.producerId);
  }

  private pushStart(row: ReservationRow, ownerId: string): void {
    this.push([ownerId], {
      title: `🔒 ${this.nameOf(row.userId)} reserviert den Überschuss`,
      body: `bis ${formatTime(row.endsAt)} – keine großen Verbraucher einschalten`,
    });
  }

  private finish(row: ReservationRow, reason: ReservationEndReason, now: number): void {
    // A planned one that ends before its start (permission revoked) uses nothing
    if (!this.close(row, Math.max(row.startsAt, Math.min(now, row.endsAt)), reason)) return;

    const producer = this.repo.producerById(row.producerId);
    if (producer) {
      const name = this.nameOf(row.userId);
      const left = this.minutesLeft(row.producerId, row.userId, now);
      const title = {
        expired: "🔓 ELISA-Modus zu Ende",
        user: "🔓 ELISA-Modus vorzeitig beendet",
        owner: `🔓 ${this.nameOf(producer.owner_id)} hat den ELISA-Modus beendet`,
        wallbox: "⚡ Das Auto lädt, Reservierung beendet",
        revoked: "🔓 ELISA-Modus beendet",
        cancelled: "📅 Reservierung abgesagt",
      }[reason];
      if (reason === "revoked") {
        this.push([row.userId], { title, body: "Das Recht zum Reservieren wurde dir entzogen." });
        this.push([producer.owner_id], { title, body: `${name} darf nicht mehr reservieren.` });
      } else {
        this.push([row.userId], { title, body: `Heute noch ${left} min übrig` });
        this.push([producer.owner_id], { title, body: `${name} hat heute noch ${left} min übrig` });
      }
    }
    this.emit(row.producerId);
  }

  /** Clear the timers and end it in the DB; false if it had already ended. */
  private close(row: ReservationRow, endedAt: number, reason: ReservationEndReason): boolean {
    for (const timers of [this.startTimers, this.endTimers]) {
      clearTimeout(timers.get(row.id));
      timers.delete(row.id);
    }
    return this.repo.endReservation(row.id, endedAt, reason);
  }

  private schedule(row: ReservationRow, now: number): void {
    if (row.startsAt > now) {
      const start = setTimeout(() => this.begin(row, Date.now()), row.startsAt - now);
      start.unref?.();
      this.startTimers.set(row.id, start);
    }
    const end = setTimeout(() => this.finish(row, "expired", Date.now()), Math.max(0, row.endsAt - now));
    end.unref?.();
    this.endTimers.set(row.id, end);
  }

  private minutesLeft(producerId: string, userId: string, now: number): number {
    const used = this.repo.reservedMsSince(producerId, userId, viennaDayStart(now));
    return Math.max(0, Math.floor((RESERVATION_DAILY_MINUTES * MINUTE - used) / MINUTE));
  }

  private isConnected(producerId: string, now: number): boolean {
    const c = this.control.get(producerId);
    return !!c && now - c.at < CONTROL_STALE_MS;
  }

  /** Only a fresh status rejects; without contact to Node-RED reserving stays possible. */
  private blockedReason(producerId: string, now: number): BlockedReason | null {
    if (!this.isConnected(producerId, now)) return null;
    const { status } = this.control.get(producerId)!;
    if (status.compressorRunning) return "heatpump";
    if (status.wallboxCharging) return "wallbox";
    return null;
  }

  /** What the app sees of the status; subscribers get a message only when this changes. */
  private controlSummary(producerId: string, now: number): string {
    return `${this.isConnected(producerId, now)}|${this.blockedReason(producerId, now)}`;
  }

  private nameOf(userId: string): string {
    const user = this.repo.userById(userId);
    return user ? displayNameOf(user) : "Jemand";
  }

  private push(userIds: string[], payload: Omit<PushPayload, "tag" | "url">): void {
    const send: Promise<void> = this.notifier
      .notifyUsers(userIds, { ...payload, tag: "elma-reservation", url: "/" })
      .catch((err: Error) => console.warn(`[push] Reservierung: ${err.message}`))
      .finally(() => (this.sends = this.sends.filter((s) => s !== send)));
    this.sends.push(send);
  }

  private emit(producerId: string): void {
    for (const listener of this.listeners) listener(producerId);
  }
}
