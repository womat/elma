import { useMemo, useState } from "react";
import type { Appliance, HistoryPoint } from "@elma/shared";
import { formatPower } from "./format.ts";
import { ApplianceIcon } from "./icons.tsx";
import { bestSpan, bucketByHour, type HourLevel } from "./timeline.ts";

interface Props {
  points: HistoryPoint[];
  appliances: Appliance[];
  now: number;
}

const LEVEL_LABEL: Record<HourLevel, string> = { none: "nix", some: "ein wenig", lots: "viel" };

const hour = (t: number) => new Date(t).getHours();

/** Verlauf der letzten 24 h als Stunden-Balken in den Stufen nix / ein wenig / viel – passend zu den eigenen Geräten. */
export function ApplianceTimeline({ points, appliances, now }: Props) {
  // nur einmal pro Minute neu rechnen, nicht bei jedem Sekunden-Tick
  const minute = Math.floor(now / 60_000);
  const buckets = useMemo(() => bucketByHour(points, now, appliances), [points, appliances, minute]);
  const span = useMemo(() => bestSpan(buckets), [buckets]);
  const [selected, setSelected] = useState<number | null>(null);
  const sel = selected !== null ? buckets[selected] : undefined;

  if (!buckets.some((b) => b.watts !== null)) {
    return <p className="muted chart-empty">Der Verlauf erscheint nach ein paar Minuten.</p>;
  }

  return (
    <figure className="timeline">
      <figcaption className="timeline-summary">
        {span
          ? `Am meisten Überschuss: ${hour(span.from)}–${hour(span.to)} Uhr`
          : "In den letzten 24 Stunden reichte es für keines deiner Geräte"}
      </figcaption>

      <div className="timeline-bars" role="list" aria-label="Überschuss der letzten 24 Stunden">
        {buckets.map((b, i) => (
          <button
            key={b.start}
            type="button"
            role="listitem"
            className={`bar ${b.level ?? "empty"}${i === selected ? " selected" : ""}`}
            aria-label={`${hour(b.start)} Uhr: ${b.level ? LEVEL_LABEL[b.level] : "keine Daten"}`}
            onClick={() => setSelected(i === selected ? null : i)}
          >
            <span />
          </button>
        ))}
      </div>
      <div className="timeline-axis" aria-hidden>
        {buckets.map((b, i) => (
          <span key={b.start}>{i % 6 === 0 ? `${hour(b.start)}h` : ""}</span>
        ))}
      </div>

      <p className="timeline-detail">
        {sel
          ? sel.watts === null
            ? `${hour(sel.start)}–${hour(sel.start + 3_600_000)} Uhr · keine Daten`
            : (
              <>
                {hour(sel.start)}–{hour(sel.start + 3_600_000)} Uhr · Ø {formatPower(Math.max(0, sel.watts))} ·{" "}
                {sel.biggest ? (
                  <>
                    reicht für <ApplianceIcon icon={sel.biggest.icon} size={16} /> {sel.biggest.name}
                  </>
                ) : (
                  "reicht für keines deiner Geräte"
                )}
              </>
            )
          : "Tippe auf einen Balken für Details."}
      </p>

      <div className="timeline-legend" aria-hidden>
        <span className="none">nix</span>
        <span className="some">ein wenig</span>
        <span className="lots">viel</span>
      </div>
    </figure>
  );
}
