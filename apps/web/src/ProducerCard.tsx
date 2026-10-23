import { Activity, AudioWaveform, Battery, BatteryCharging, BatteryFull, Pencil, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import {
  BATTERY_CHARGING_WATTS,
  BATTERY_FULL_SOC,
  LEVEL_LOTS_WATTS,
  LEVEL_SOME_WATTS,
  STALE_AFTER_MS,
  type HistoryPoint,
  type ProducerDto,
  type BatteryReading,
  type LiveReading,
  type ReservationStateDto,
} from "@elma/shared";
import { api } from "./api.ts";
import { formatPower } from "./format.ts";
import { HistoryChart } from "./HistoryChart.tsx";
import { ApplianceGrid } from "./ApplianceGrid.tsx";
import { ApplianceTimeline } from "./ApplianceTimeline.tsx";
import { ApplianceIcon } from "./icons.tsx";
import { InviteSheet } from "./InviteSheet.tsx";
import { ReservationBanner, ReserveButton, ReserveSheet } from "./Reservation.tsx";
import { biggestFitting, type Appliance } from "./appliances.ts";

export type View = "power" | "appliances";

interface Props {
  producer: ProducerDto;
  reading: LiveReading | null;
  reservation: ReservationStateDto;
  onReservation: (state: ReservationStateDto) => void;
  /** darf bei irgendeinem Erzeuger reservieren (für den Glocken-Hinweis) */
  canReserveAny: boolean;
  now: number;
  view: View;
  appliances: Appliance[];
  notify: string[];
  pushOn: boolean;
  onEditAppliances: () => void;
}

type Level = "offline" | "none" | "some" | "lots";

function levelOf(reading: LiveReading | null, now: number): Level {
  if (!reading || now - reading.timestamp > STALE_AFTER_MS) return "offline";
  if (reading.watts >= LEVEL_LOTS_WATTS) return "lots";
  if (reading.watts > LEVEL_SOME_WATTS) return "some";
  return "none";
}

const LABELS: Record<Level, string> = {
  offline: "Keine aktuellen Daten",
  none: "Gerade kein Überschuss",
  some: "Etwas Überschuss verfügbar",
  lots: "Viel Überschuss – jetzt verbrauchen!",
};

/** Ampel: ist der Überschuss der letzten Minuten gleichmäßig? Ohne `stable` (kein Überschuss, zu wenig Daten) nichts. */
function Stability({ stable }: { stable: boolean | undefined }) {
  if (stable === undefined) return null;
  return stable ? (
    <div className="live-box stable">
      <Activity size={20} aria-hidden />
      <span><strong>Stabil</strong> · seit Minuten gleichmäßig</span>
    </div>
  ) : (
    <div className="live-box unsteady">
      <AudioWaveform size={20} aria-hidden />
      <span><strong>Schwankt stark</strong> · kann sinken</span>
    </div>
  );
}

/** Akku des Erzeugers, immer wenn ein aktueller Wert da ist: Laden geht vor "voll", sonst nur der Ladestand. */
function BatteryBox({ battery }: { battery: BatteryReading }) {
  const soc = Math.round(battery.soc);
  const charging = battery.watts >= BATTERY_CHARGING_WATTS;
  const full = !charging && battery.soc >= BATTERY_FULL_SOC;
  return (
    <div className={`live-box battery ${charging ? "charging" : full ? "full" : ""}`}>
      <div className="battery-line">
        {charging ? (
          <>
            <BatteryCharging size={20} aria-hidden />
            <span><strong>Lädt</strong> {formatPower(battery.watts)} · {soc} %</span>
          </>
        ) : full ? (
          <>
            <BatteryFull size={20} aria-hidden />
            <strong>Akku voll</strong>
          </>
        ) : (
          <>
            <Battery size={20} aria-hidden />
            <span><strong>Akku</strong> · {soc} %</span>
          </>
        )}
      </div>
      <div className="battery-bar" role="img" aria-label={`Ladestand ${soc} %`}>
        <div style={{ width: `${full ? 100 : soc}%` }} />
      </div>
    </div>
  );
}

export function ProducerCard({
  producer,
  reading,
  reservation,
  onReservation,
  canReserveAny,
  now,
  view,
  appliances,
  notify,
  pushOn,
  onEditAppliances,
}: Props) {
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [inviting, setInviting] = useState(false);
  const [reserving, setReserving] = useState(false);
  const [name, setName] = useState(producer.name);
  const level = levelOf(reading, now);
  const liveWatts = reading && level !== "offline" ? Math.max(0, reading.watts) : null;
  const hint = liveWatts !== null ? biggestFitting(liveWatts, appliances) : null;

  useEffect(() => {
    const load = () => api.history(producer.id).then(setHistory, () => undefined);
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [producer.id]);

  const rename = async () => {
    const next = prompt("Name des Erzeugers", name)?.trim();
    if (!next || next === name) return;
    try {
      setName((await api.renameProducer(producer.id, next)).name);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  return (
    <section className={`card producer level-${level}`}>
      <div className="producer-head">
        <h2>{name}</h2>
        {producer.isOwner && (
          <>
            <button className="icon-button" onClick={rename} aria-label="Erzeuger umbenennen" title="Umbenennen">
              <Pencil size={17} aria-hidden />
            </button>
            <button className="icon-button framed" onClick={() => setInviting(true)} aria-label="Personen einladen" title="Einladen">
              <UserPlus size={19} aria-hidden />
            </button>
          </>
        )}
      </div>

      <ReservationBanner
        state={reservation}
        isOwner={producer.isOwner}
        ownerName={producer.ownerName}
        now={now}
        producerId={producer.id}
        onChange={onReservation}
      />

      {view === "power" ? (
        <>
          <div className="value" aria-live="polite">
            {liveWatts !== null ? formatPower(liveWatts) : "–"}
          </div>
          {liveWatts !== null && <div className="value-note">Mittel der letzten Minuten</div>}
          <div className="status">{LABELS[level]}</div>
          {liveWatts !== null && <Stability stable={reading?.stable} />}
          {liveWatts !== null && reading?.battery && <BatteryBox battery={reading.battery} />}
          {hint && (
            <p className="hint">
              Reicht z. B. für <ApplianceIcon icon={hint.icon} size={22} /> {hint.name}
            </p>
          )}
          <ReserveButton state={reservation} onOpen={() => setReserving(true)} />
        </>
      ) : (
        <>
          <ApplianceGrid
            watts={liveWatts}
            appliances={appliances}
            notify={notify}
            pushOn={pushOn}
            canReserve={canReserveAny}
            onEdit={onEditAppliances}
          />
          {/* auch hier, weil manche die App in der Geräte-Ansicht offen haben */}
          <ReserveButton state={reservation} onOpen={() => setReserving(true)} />
          <ApplianceTimeline points={history} appliances={appliances} now={now} />
        </>
      )}

      {view === "power" && <HistoryChart points={history} />}

      {inviting && <InviteSheet producerId={producer.id} producerName={name} onClose={() => setInviting(false)} />}
      {reserving && (
        <ReserveSheet
          producerId={producer.id}
          ownerName={producer.ownerName}
          state={reservation}
          onDone={onReservation}
          onClose={() => setReserving(false)}
        />
      )}
    </section>
  );
}
