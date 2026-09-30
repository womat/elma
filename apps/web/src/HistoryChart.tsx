import type { HistoryPoint } from "@elma/shared";
import { formatPower, formatTime } from "./format.ts";

const W = 300;
const H = 80;

/** Überschuss der letzten 24 h als Flächendiagramm (Minutenmittel, nur positive Werte). */
export function HistoryChart({ points }: { points: HistoryPoint[] }) {
  if (points.length < 2) return <p className="muted chart-empty">Verlauf erscheint nach ein paar Minuten.</p>;

  const t0 = points[0]!.t;
  const t1 = points.at(-1)!.t;
  const max = Math.max(100, ...points.map((p) => p.watts));
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const y = (w: number) => H - (Math.max(0, w) / max) * H;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.watts).toFixed(1)}`).join(" ");

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Überschuss-Verlauf">
        <path d={`${line} L${W},${H} L0,${H} Z`} className="area" />
        <path d={line} className="line" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption>
        <span>{formatTime(t0)}</span>
        <span>max. {formatPower(max)}</span>
        <span>{formatTime(t1)}</span>
      </figcaption>
    </figure>
  );
}
