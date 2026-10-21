import {
  displayNameOf,
  RESERVATION_DAILY_MINUTES,
  type BlockedReason,
  type ControlResponse,
  type ControlStatus,
  type PushPayload,
  type ReservationStateDto,
} from "@elma/shared";
import type { Repo, ReservationEndReason, ReservationRow } from "./repo.ts";

const MINUTE = 60_000;
/** Der Tag fürs Budget zählt fest nach dieser Zeitzone, unabhängig von der des Containers. */
export const TIME_ZONE = "Europe/Vienna";
/** So lange gilt der letzte Status von Node-RED; danach wirkt die Sperre nicht und es wird nichts mehr abgelehnt. */
export const CONTROL_STALE_MS = 60_000;

const BLOCKED_TEXT: Record<BlockedReason, string> = {
  heatpump: "Gerade nicht möglich: Wärmepumpe läuft",
  wallbox: "Gerade nicht möglich: das Auto lädt",
};

export interface ReservationNotifier {
  notifyUsers(userIds: string[], payload: PushPayload): Promise<void>;
}

/** Abgelehnte Anfrage; status wird 1:1 zum HTTP-Status. */
export class ReservationError extends Error {
  readonly status: 403 | 404 | 409;
  constructor(status: 403 | 404 | 409, message: string) {
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

/** Uhrzeit für Push und Fehlermeldungen, z. B. „14:22“ */
export function formatTime(t: number): string {
  return timeFormat.format(t);
}

/** Wie weit die Uhr in Wien zum Zeitpunkt t der UTC voraus ist (1 oder 2 Stunden). */
function viennaOffsetMs(t: number): number {
  const p = Object.fromEntries(partsFormat.formatToParts(t).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - Math.floor(t / 1000) * 1000;
}

/** Mitternacht in Wien des Tages, in dem t liegt (Unix-ms). Die Zeitumstellung liegt nachts um 2–3 Uhr, nie um Mitternacht. */
export function viennaDayStart(t: number): number {
  const local = t + viennaOffsetMs(t);
  const midnightAsUtc = local - (((local % 86_400_000) + 86_400_000) % 86_400_000);
  return midnightAsUtc - viennaOffsetMs(midnightAsUtc - viennaOffsetMs(t));
}

/**
 * Regeln und Ablauf des ELISA-Modus: Recht, Tagesbudget, höchstens eine Reservierung pro Erzeuger, Ablehnung bei laufenden
 * Geräten, automatisches Ende. Der letzte Status von Node-RED liegt nur im Speicher; nach einem Neustart meldet es sich
 * nach spätestens 15 s wieder. Begründungen der Regeln: docs/elisa.md.
 */
export class ReservationService {
  private readonly repo: Repo;
  private readonly notifier: ReservationNotifier;
  private readonly endTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly control = new Map<string, { status: ControlStatus; at: number }>();
  private readonly staleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly listeners = new Set<(producerId: string) => void>();
  private sends: Promise<void>[] = [];

  constructor(repo: Repo, notifier: ReservationNotifier) {
    this.repo = repo;
    this.notifier = notifier;
  }

  /** Stellt die Timer laufender Reservierungen wieder. Was während des Neustarts abgelaufen ist, endet ohne Push. */
  start(now = Date.now()): void {
    for (const r of this.repo.activeReservations()) {
      if (r.endsAt <= now) this.repo.endReservation(r.id, r.endsAt, "expired");
      else this.scheduleEnd(r, now);
    }
  }

  stop(): void {
    for (const timer of [...this.endTimers.values(), ...this.staleTimers.values()]) clearTimeout(timer);
    this.endTimers.clear();
    this.staleTimers.clear();
  }

  /** Wird bei jeder Änderung eines Erzeugers aufgerufen; den Stand holt sich jeder Abonnent mit stateFor. */
  subscribe(listener: (producerId: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Wartet auf alle bisher verschickten Push-Nachrichten (für Tests). */
  async settled(): Promise<void> {
    await Promise.all(this.sends);
  }

  stateFor(producerId: string, userId: string, now = Date.now()): ReservationStateDto {
    const active = this.repo.activeReservation(producerId);
    return {
      active: active
        ? { producerId, userName: this.nameOf(active.userId), startsAt: active.startsAt, endsAt: active.endsAt, mine: active.userId === userId }
        : null,
      canReserve: this.repo.canReserve(producerId, userId),
      minutesLeft: this.minutesLeft(producerId, userId, now),
      controlConnected: this.isConnected(producerId, now),
      blockedReason: this.blockedReason(producerId, now),
    };
  }

  reserve(producerId: string, userId: string, minutes: number, now = Date.now()): ReservationRow {
    if (!this.repo.canReserve(producerId, userId)) throw new ReservationError(403, "Du darfst hier keinen Strom reservieren");
    const active = this.repo.activeReservation(producerId);
    if (active) {
      throw new ReservationError(
        409,
        active.userId === userId ? "Du hast schon reserviert" : `Gerade reserviert von ${this.nameOf(active.userId)} bis ${formatTime(active.endsAt)}`,
      );
    }
    const left = this.minutesLeft(producerId, userId, now);
    if (minutes > left) {
      throw new ReservationError(
        409,
        left === 0 ? `Heute schon ${RESERVATION_DAILY_MINUTES} min reserviert, morgen wieder` : `Heute sind nur noch ${left} min frei`,
      );
    }
    // Was gerade läuft, ist im Überschuss schon abgezogen: Die Reservierung würde nur Budget kosten, ohne etwas zu schützen
    const blocked = this.blockedReason(producerId, now);
    if (blocked) throw new ReservationError(409, BLOCKED_TEXT[blocked]);

    let row: ReservationRow;
    try {
      row = this.repo.createReservation(producerId, userId, now, now + minutes * MINUTE);
    } catch {
      // zwei Anfragen gleichzeitig: der eindeutige Index lässt nur eine durch
      throw new ReservationError(409, "Gerade hat schon jemand reserviert");
    }
    this.scheduleEnd(row, now);
    const producer = this.repo.producerById(producerId);
    if (producer) {
      this.push([producer.owner_id], {
        title: `🔒 ${this.nameOf(userId)} reserviert den Überschuss`,
        body: `bis ${formatTime(row.endsAt)} – keine großen Verbraucher einschalten`,
      });
    }
    this.emit(producerId);
    return row;
  }

  /** Beenden dürfen der Reservierende und der Erzeuger. */
  end(producerId: string, userId: string, now = Date.now()): void {
    const active = this.repo.activeReservation(producerId);
    if (!active) throw new ReservationError(404, "Gerade ist nichts reserviert");
    if (active.userId === userId) this.finish(active, "user", now);
    else if (this.repo.isOwner(userId, producerId)) this.finish(active, "owner", now);
    else throw new ReservationError(403, "Nur wer reserviert hat und der Erzeuger können beenden");
  }

  /** Recht setzen oder entziehen. Ein entzogenes Recht beendet eine laufende Reservierung sofort, nicht erst nach bis zu einer Stunde. */
  setCanReserve(producerId: string, recipientId: string, canReserve: boolean, now = Date.now()): void {
    if (!this.repo.setCanReserve(producerId, recipientId, canReserve)) throw new ReservationError(404, "Kein Empfänger dieses Erzeugers");
    const active = this.repo.activeReservation(producerId);
    if (!canReserve && active?.userId === recipientId) this.finish(active, "revoked", now);
    else this.emit(producerId);
  }

  /** Status von Node-RED übernehmen und zurückmelden, ob gerade reserviert ist. */
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

    let active = this.repo.activeReservation(producerId);
    // Die Handbedienung des Erzeugers hat Vorrang; die Reservierung schützt dann nichts mehr
    if (active && status.wallboxCharging) {
      this.finish(active, "wallbox", now);
      active = undefined;
    } else if (before !== this.controlSummary(producerId, now)) {
      this.emit(producerId);
    }
    return active ? { active: true, until: active.endsAt, by: this.nameOf(active.userId) } : { active: false, until: null };
  }

  private finish(row: ReservationRow, reason: ReservationEndReason, now: number): void {
    clearTimeout(this.endTimers.get(row.producerId));
    this.endTimers.delete(row.producerId);
    if (!this.repo.endReservation(row.id, Math.min(now, row.endsAt), reason)) return;

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

  private scheduleEnd(row: ReservationRow, now: number): void {
    clearTimeout(this.endTimers.get(row.producerId));
    const timer = setTimeout(() => this.finish(row, "expired", Date.now()), Math.max(0, row.endsAt - now));
    timer.unref?.();
    this.endTimers.set(row.producerId, timer);
  }

  private minutesLeft(producerId: string, userId: string, now: number): number {
    const used = this.repo.reservedMsSince(producerId, userId, viennaDayStart(now));
    return Math.max(0, Math.floor((RESERVATION_DAILY_MINUTES * MINUTE - used) / MINUTE));
  }

  private isConnected(producerId: string, now: number): boolean {
    const c = this.control.get(producerId);
    return !!c && now - c.at < CONTROL_STALE_MS;
  }

  /** Nur ein frischer Status lehnt ab; ohne Kontakt zu Node-RED bleibt Reservieren möglich. */
  private blockedReason(producerId: string, now: number): BlockedReason | null {
    if (!this.isConnected(producerId, now)) return null;
    const { status } = this.control.get(producerId)!;
    if (status.compressorRunning) return "heatpump";
    if (status.wallboxCharging) return "wallbox";
    return null;
  }

  /** Was die App vom Status sieht; nur wenn sich das ändert, bekommen die Abonnenten eine Nachricht. */
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
