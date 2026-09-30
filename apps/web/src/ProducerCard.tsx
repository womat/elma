import { useEffect, useState } from "react";
import { STALE_AFTER_MS, type HistoryPoint, type ProducerDto, type SurplusReading } from "@elma/shared";
import { api } from "./api.ts";
import { formatAgo, formatPower } from "./format.ts";
import { HistoryChart } from "./HistoryChart.tsx";
import { ApplianceGrid } from "./ApplianceGrid.tsx";
import { biggestFitting, type Appliance } from "./appliances.ts";

export type View = "power" | "appliances";

interface Props {
  producer: ProducerDto;
  reading: SurplusReading | null;
  now: number;
  view: View;
  appliances: Appliance[];
  notify: string[];
  onEditAppliances: () => void;
}

type Level = "offline" | "none" | "some" | "lots";

function levelOf(reading: SurplusReading | null, now: number): Level {
  if (!reading || now - reading.timestamp > STALE_AFTER_MS) return "offline";
  if (reading.watts >= 1000) return "lots";
  if (reading.watts > 50) return "some";
  return "none";
}

const LABELS: Record<Level, string> = {
  offline: "Keine aktuellen Daten",
  none: "Gerade kein Überschuss",
  some: "Etwas Überschuss verfügbar",
  lots: "Viel Überschuss – jetzt verbrauchen!",
};

export function ProducerCard({ producer, reading, now, view, appliances, notify, onEditAppliances }: Props) {
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [invite, setInvite] = useState<string | null>(null);
  const level = levelOf(reading, now);
  const liveWatts = reading && level !== "offline" ? Math.max(0, reading.watts) : null;
  const hint = liveWatts !== null ? biggestFitting(liveWatts, appliances) : null;

  useEffect(() => {
    const load = () => api.history(producer.id).then(setHistory, () => undefined);
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [producer.id]);

  const createInvite = async () => {
    const { url } = await api.createInvite(producer.id);
    setInvite(url);
    if (navigator.share) navigator.share({ title: "ELMA Einladung", text: "Sieh dir meinen Stromüberschuss an:", url }).catch(() => undefined);
  };

  return (
    <section className={`card producer level-${level}`}>
      <div className="producer-head">
        <h2>{producer.name}</h2>
        {reading && <span className="muted">{formatAgo(now - reading.timestamp)}</span>}
      </div>

      {view === "power" ? (
        <>
          <div className="value" aria-live="polite">
            {liveWatts !== null ? formatPower(liveWatts) : "–"}
          </div>
          <div className="status">{LABELS[level]}</div>
          {hint && (
            <p className="hint">
              Reicht z. B. für {hint.icon} {hint.name}
            </p>
          )}
        </>
      ) : (
        <ApplianceGrid watts={liveWatts} appliances={appliances} notify={notify} onEdit={onEditAppliances} />
      )}

      <HistoryChart points={history} />

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
