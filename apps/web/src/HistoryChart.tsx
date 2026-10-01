import type { HistoryPoint } from "@elma/shared";
import { niceScale } from "./chartScale.ts";
import { formatPower, formatTime } from "./format.ts";

const W = 300;
const H = 96;

/** Überschuss der letzten 24 h als Flächendiagramm (Minutenmittel, nur positive Werte) mit beschrifteter Y-Achse. */
export function HistoryChart({ points }: { points: HistoryPoint[] }) {
  if (points.length < 2) return <p className="muted chart-empty">Verlauf erscheint nach ein paar Minuten.</p>;

  const t0 = points[0]!.t;
  const t1 = points.at(-1)!.t;
  const { max, ticks } = niceScale(Math.max(...points.map((p) => p.watts)));
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const y = (w: number) => H - (Math.min(max, Math.max(0, w)) / max) * H;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.watts).toFixed(1)}`).join(" ");

  return (
    <figure className="chart">
      <div className="chart-body">
        {/* Beschriftung als HTML, weil das SVG gestreckt wird und Text darin verzerren würde */}
        <div className="chart-y" aria-hidden>
          {[...ticks].reverse().map((t) => (
            <span key={t}>{formatPower(t)}</span>
          ))}
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Überschuss-Verlauf, Skala bis ${formatPower(max)}`}>
          {ticks.map((t) => (
            <line key={t} x1={0} x2={W} y1={y(t)} y2={y(t)} className="grid" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={`${line} L${W},${H} L0,${H} Z`} className="area" />
          <path d={line} className="line" vectorEffect="non-scaling-stroke" />
        </svg>
        <span />
        <div className="chart-x" aria-hidden>
          <span>{formatTime(t0)}</span>
          <span>{formatTime(t1)}</span>
        </div>
      </div>
    </figure>
  );
}
