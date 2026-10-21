import { Lock, Pause } from "lucide-react";
import { useState } from "react";
import { RESERVATION_DAILY_MINUTES, type BlockedReason, type ReservationStateDto } from "@elma/shared";
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

/** Der gelbe Knopf unter Status und Hinweis; nur für Empfänger mit Recht, grau mit Grund, wenn es gerade nicht geht. */
export function ReserveButton({ state, onOpen }: { state: ReservationStateDto; onOpen: () => void }) {
  if (!state.canReserve || state.active) return null;
  const used = state.minutesLeft === 0;
  return (
    <div className="reserve">
      <button className="reserve-main" disabled={used || !!state.blockedReason} onClick={onOpen}>
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

/** Vollbild-Blatt wie „Konto“: Dauer wählen und bestätigen. */
export function ReserveSheet({ producerId, ownerName, state, onDone, onClose }: SheetProps) {
  const left = state.minutesLeft;
  const durations = durationsFor(left);
  const allowed = durations.filter((d) => d <= left);
  const [pick, setPick] = useState(() => (allowed.includes(30) ? 30 : (allowed.at(-1) ?? durations[0]!)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await api.reserve(producerId, pick));
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

        <h3>Wie lange brauchst du den Überschuss?</h3>
        <div className="duration-chips" role="radiogroup" aria-label="Dauer">
          {durations.map((d) => (
            <button key={d} role="radio" aria-checked={pick === d} disabled={d > left} onClick={() => setPick(d)}>
              {d} min
            </button>
          ))}
        </div>
        <p className="muted small reserve-info">
          {state.controlConnected ? "Solange du reservierst, bleibt der Überschuss für dich frei." : noLockHint(ownerName)} Heute noch{" "}
          {left} min übrig.
        </p>
        <button className="reserve-confirm" disabled={busy || pick > left} onClick={() => void start()}>
          {busy ? "…" : `${pick} min reservieren, bis ${formatTime(Date.now() + pick * MIN)}`}
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
