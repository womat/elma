import { Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import {
  LEVEL_LOTS_WATTS,
  LEVEL_SOME_WATTS,
  STALE_AFTER_MS,
  type HistoryPoint,
  type ProducerDto,
  type SurplusReading,
} from "@elma/shared";
import { api } from "./api.ts";
import { formatPower } from "./format.ts";
import { HistoryChart } from "./HistoryChart.tsx";
import { ApplianceGrid } from "./ApplianceGrid.tsx";
import { ApplianceTimeline } from "./ApplianceTimeline.tsx";
import { ApplianceIcon } from "./icons.tsx";
import { biggestFitting, type Appliance } from "./appliances.ts";

export type View = "power" | "appliances";

interface Props {
  producer: ProducerDto;
  reading: SurplusReading | null;
  now: number;
  view: View;
  appliances: Appliance[];
  notify: string[];
  pushOn: boolean;
  onEditAppliances: () => void;
}

type Level = "offline" | "none" | "some" | "lots";

function levelOf(reading: SurplusReading | null, now: number): Level {
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

export function ProducerCard({ producer, reading, now, view, appliances, notify, pushOn, onEditAppliances }: Props) {
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [invite, setInvite] = useState<string | null>(null);
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

  const createInvite = async () => {
    const { url } = await api.createInvite(producer.id);
    setInvite(url);
    if (navigator.share) navigator.share({ title: "ELMA Einladung", text: "Sieh dir meinen Stromüberschuss an:", url }).catch(() => undefined);
  };

  return (
    <section className={`card producer level-${level}`}>
      <div className="producer-head">
        <h2>
          {name}
          {producer.isOwner && (
            <button className="link small rename" onClick={rename} aria-label="Erzeuger umbenennen" title="Umbenennen">
              <Pencil size={15} aria-hidden />
            </button>
          )}
        </h2>
      </div>

      {view === "power" ? (
        <>
          <div className="value" aria-live="polite">
            {liveWatts !== null ? formatPower(liveWatts) : "–"}
          </div>
          <div className="status">{LABELS[level]}</div>
          {hint && (
            <p className="hint">
              Reicht z. B. für <ApplianceIcon icon={hint.icon} size={22} /> {hint.name}
            </p>
          )}
        </>
      ) : (
        <>
          <ApplianceGrid watts={liveWatts} appliances={appliances} notify={notify} pushOn={pushOn} onEdit={onEditAppliances} />
          <ApplianceTimeline points={history} appliances={appliances} now={now} />
        </>
      )}

      {view === "power" && <HistoryChart points={history} />}

      {producer.isOwner && (
        <div className="owner">
          <button onClick={createInvite}>Empfänger einladen</button>
          {invite && (
            <input readOnly value={invite} onFocus={(e) => e.currentTarget.select()} aria-label="Einladungslink" />
          )}
        </div>
      )}
    </section>
  );
}
