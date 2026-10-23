import { CalendarClock, Lock, Pause, Thermometer } from "lucide-react";
import { useState } from "react";
import {
  HEATPUMP_LEAD_MINUTES,
  RESERVATION_DAILY_MINUTES,
  type BlockedReason,
  type ReservationDto,
  type ReservationStateDto,
} from "@elma/shared";
import { api } from "./api.ts";
import { durationsFor } from "./durations.ts";
import { formatTime } from "./format.ts";

const MIN = 60_000;

const BLOCKED: Record<BlockedReason, string> = {
  heatpump: "Gerade nicht möglich: Wärmepumpe läuft",
  wallbox: "Gerade nicht möglich: das Auto lädt",
};

/** Hinweis, wenn Node-RED sich nicht meldet: Dann hält im Haus des Erzeugers nichts die Geräte zurück. */
const noLockHint = (ownerName: string) => `Die Sperre wirkt gerade nicht, ${ownerName} bekommt nur eine Info.`;

/** Ganze Minuten bis zum Beginn der geplanten; ohne geplante unbegrenzt. So lange darf eine spontane höchstens dauern. */
const minutesUntil = (planned: ReservationDto | null, now: number) =>
  planned ? Math.floor((planned.startsAt - now) / MIN) : Number.POSITIVE_INFINITY;

/** 30 min, wenn möglich, sonst die längste erlaubte Dauer */
function defaultPick(max: number): number {
  const durations = durationsFor(max);
  const allowed = durations.filter((d) => d <= max);
  return allowed.includes(30) ? 30 : (allowed.at(-1) ?? durations[0]!);
}

/** „HH:MM“ von heute als Unix-ms, NaN bei leerer Eingabe */
function todayAt(time: string): number {
  const [h, m] = time.split(":").map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return Number.NaN;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

interface BannerProps {
  state: ReservationStateDto;
  isOwner: boolean;
  ownerName: string;
  now: number;
  producerId: string;
  onChange: (state: ReservationStateDto) => void;
}

/** Oben in der Karte, solange reserviert ist; alle Betrachter sehen es, beenden können Reservierender und Erzeuger. */
export function ReservationBanner({ state, isOwner, ownerName, now, producerId, onChange }: BannerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const a = state.active;
  if (!a) return null;
  const rest = Math.max(0, Math.ceil((a.endsAt - now) / MIN));
  const pct = Math.min(100, Math.max(0, ((now - a.startsAt) / (a.endsAt - a.startsAt)) * 100));
  const until = formatTime(a.endsAt);

  const end = async () => {
    setBusy(true);
    setError(null);
    try {
      onChange(await api.endReservation(producerId));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="reservation-banner" role="status">
      <div className="reservation-title">
        <span>
          <Lock size={16} strokeWidth={2.5} className="ui-icon" aria-hidden /> ELISA-Modus aktiv
        </span>
        <span className="reservation-rest">noch {rest} min</span>
      </div>
      <p className="reservation-text">
        {a.mine
          ? `Du hast reserviert · bis ${until}. Solange du reservierst, bleibt der Überschuss für dich frei.`
          : isOwner
            ? `Reserviert von ${a.userName} · bis ${until}. Bis dahin bitte keine großen Verbraucher einschalten.`
            : `Reserviert von ${a.userName} · bis ${until}.`}
      </p>
      {a.mine && !state.controlConnected && <p className="reservation-text">{noLockHint(ownerName)}</p>}
      <div className="reservation-bar" aria-hidden>
        <i style={{ width: `${pct}%` }} />
      </div>
      {(a.mine || isOwner) && (
        <div className="reservation-row">
          <span className="reservation-text">{a.mine ? `heute danach noch ${state.minutesLeft} min` : ""}</span>
          <button className="secondary small" disabled={busy} onClick={() => void end()}>
            Beenden
          </button>
        </div>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

/**
 * Die geplante Reservierung unter dem Knopf, für alle Betrachter. Absagen können der Planende und der Erzeuger. Der
 * Erzeuger sieht, ab wann die Wärmepumpe zurückgehalten wird; Elisa werden keine Geräte genannt (docs/elisa.md).
 */
export function PlannedNote({ state, isOwner, now, producerId, onChange }: Omit<BannerProps, "ownerName">) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = state.planned;
  if (!p) return null;
  const range = `heute ${formatTime(p.startsAt)}–${formatTime(p.endsAt)}`;
  const lead = p.startsAt - HEATPUMP_LEAD_MINUTES * MIN;
  const holding = isOwner && now >= lead;

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      onChange(await api.cancelPlanned(producerId));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="reservation-planned" role="status">
      <strong>
        {holding ? <Thermometer size={16} className="ui-icon" aria-hidden /> : <CalendarClock size={16} className="ui-icon" aria-hidden />}
        {p.mine ? `Geplant: ${range}` : holding ? "Wärmepumpe zurückgehalten" : `${p.userName}: ${range}`}
      </strong>
      <div className="reservation-row">
        <span className="reservation-text">
          {p.mine
            ? "Du hast reserviert."
            : holding
              ? `${p.userName} reserviert ab ${formatTime(p.startsAt)}, bis ${formatTime(p.endsAt)}.`
              : isOwner
                ? `Die Wärmepumpe wird ab ${formatTime(lead)} zurückgehalten.`
                : ""}
        </span>
        {(p.mine || isOwner) && (
          <button className="secondary small" disabled={busy} onClick={() => void cancel()}>
            Absagen
          </button>
        )}
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

/**
 * Der gelbe Knopf unter Status und Hinweis; nur für Empfänger mit Recht. Grau, wenn weder „Jetzt“ (Gerät läuft, die geplante
 * beginnt gleich) noch „Später“ (schon eine geplant) geht.
 */
export function ReserveButton({ state, now, onOpen }: { state: ReservationStateDto; now: number; onOpen: () => void }) {
  if (!state.canReserve || state.active) return null;
  const used = state.minutesLeft === 0;
  const canNow = !state.blockedReason && minutesUntil(state.planned, now) >= 1;
  return (
    <div className="reserve">
      <button className="reserve-main" disabled={used || (!canNow && !!state.planned)} onClick={onOpen}>
        <span>
          <Lock size={18} strokeWidth={2.5} className="ui-icon" aria-hidden /> Strom reservieren
        </span>
        <small>ELISA-MODUS</small>
      </button>
      {state.blockedReason && (
        <span className="reserve-blocked">
          <Pause size={14} className="ui-icon" aria-hidden /> {BLOCKED[state.blockedReason]}
        </span>
      )}
      <span className="reserve-left">
        {used ? `Heute schon ${RESERVATION_DAILY_MINUTES} min reserviert, morgen wieder` : `heute noch ${state.minutesLeft} min frei`}
      </span>
    </div>
  );
}

interface SheetProps {
  producerId: string;
  ownerName: string;
  state: ReservationStateDto;
  onDone: (state: ReservationStateDto) => void;
  onClose: () => void;
}

/**
 * Vollbild-Blatt wie „Konto“: jetzt oder später heute, Dauer wählen und bestätigen. Eine spontane geht höchstens bis zum
 * Beginn der geplanten; „Jetzt“ ist gesperrt, solange ein Gerät läuft, „Später“, wenn schon eine geplant ist.
 */
export function ReserveSheet({ producerId, ownerName, state, onDone, onClose }: SheetProps) {
  const now = Date.now();
  const left = state.minutesLeft;
  const untilPlanned = minutesUntil(state.planned, now);
  const canNow = !state.blockedReason && untilPlanned >= 1;
  const maxFor = (later: boolean) => (later ? left : Math.min(left, untilPlanned));
  const [later, setLater] = useState(!canNow);
  // nächste volle halbe Stunde; die Zeitzonen-Abweichung von Wien ist eine ganze Stunde
  const [time, setTime] = useState(() => formatTime(Math.ceil(now / (30 * MIN)) * 30 * MIN));
  const max = maxFor(later);
  const durations = durationsFor(max);
  const [pick, setPick] = useState(() => defaultPick(maxFor(later)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startsAt = later ? todayAt(time) : now;
  const invalidTime = later && !(startsAt > now);

  const choose = (next: boolean) => {
    setLater(next);
    setPick(defaultPick(maxFor(next)));
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await api.reserve(producerId, pick, later ? startsAt : undefined));
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="reserve-title">
      <div className="sheet-body">
        <header className="sheet-head">
          <span />
          <h2 id="reserve-title">Strom reservieren</h2>
          <button className="link" onClick={onClose}>
            Abbrechen
          </button>
        </header>

        <div className="profile invite-intro">
          <strong>
            <Lock size={18} strokeWidth={2.5} className="ui-icon" aria-hidden /> ELISA-Modus
          </strong>
          <span className="muted small elisa-long">
            <b>E</b>nergie für die <b>L</b>ieblingstochter: <b>I</b>hr <b>S</b>onnenstrom-<b>A</b>nteil
          </span>
        </div>

        <h3>Wann?</h3>
        <div className="duration-chips when-chips" role="radiogroup" aria-label="Wann">
          <button role="radio" aria-checked={!later} disabled={!canNow} onClick={() => choose(false)}>
            Jetzt
          </button>
          <button role="radio" aria-checked={later} disabled={!!state.planned} onClick={() => choose(true)}>
            Später
          </button>
        </div>
        {state.blockedReason && (
          <p className="muted small reserve-info">
            <Pause size={14} className="ui-icon" aria-hidden /> {BLOCKED[state.blockedReason]}, später geht.
          </p>
        )}
        {later && (
          <label className="reserve-time">
            Beginn heute um
            <input type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        )}

        <h3>Wie lange brauchst du den Überschuss?</h3>
        <div className="duration-chips" role="radiogroup" aria-label="Dauer">
          {durations.map((d) => (
            <button key={d} role="radio" aria-checked={pick === d} disabled={d > max} onClick={() => setPick(d)}>
              {d} min
            </button>
          ))}
        </div>
        <p className="muted small reserve-info">
          {invalidTime
            ? "Die Uhrzeit ist schon vorbei."
            : !later && state.planned
              ? `Ab ${formatTime(state.planned.startsAt)} ist schon reserviert, höchstens bis dahin.`
              : state.controlConnected
                ? "Solange du reservierst, bleibt der Überschuss für dich frei."
                : noLockHint(ownerName)}{" "}
          Heute noch {left} min übrig.
        </p>
        <button className="reserve-confirm" disabled={busy || pick > max || invalidTime} onClick={() => void start()}>
          {busy
            ? "…"
            : later
              ? `${pick} min reservieren, ${invalidTime ? "–" : `${formatTime(startsAt)}–${formatTime(startsAt + pick * MIN)}`}`
              : `${pick} min reservieren, bis ${formatTime(now + pick * MIN)}`}
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
