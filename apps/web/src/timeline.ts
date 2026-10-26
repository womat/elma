import { LEVEL_LOTS_WATTS, biggestFitting, type Appliance, type HistoryPoint } from "@elma/shared";

const HOUR = 3_600_000;

export type HourLevel = "none" | "some" | "lots";

export interface HourBucket {
  /** start of the hour, Unix milliseconds */
  start: number;
  /** hourly average in watts, null = no data */
  watts: number | null;
  level: HourLevel | null;
  /** most powerful own appliance that would have run in this hour */
  biggest: Appliance | null;
}

/**
 * Level matched to the user's own appliances:
 * none runs -> "none", only small appliances -> "some", an appliance from LEVEL_LOTS_WATTS up -> "lots".
 */
export function levelFor(watts: number, appliances: Appliance[]): { level: HourLevel; biggest: Appliance | null } {
  const biggest = biggestFitting(Math.max(0, watts), appliances);
  if (!biggest) return { level: "none", biggest: null };
  return { level: biggest.watts >= LEVEL_LOTS_WATTS ? "lots" : "some", biggest };
}

/** The last 24 hours (incl. the current one) as hourly averages of the minute values. */
export function bucketByHour(points: HistoryPoint[], now: number, appliances: Appliance[]): HourBucket[] {
  const first = Math.floor(now / HOUR) * HOUR - 23 * HOUR;
  const sums = Array.from({ length: 24 }, () => ({ sum: 0, count: 0 }));
  for (const p of points) {
    const i = Math.floor((p.t - first) / HOUR);
    if (i < 0 || i >= 24) continue;
    sums[i]!.sum += p.watts;
    sums[i]!.count += 1;
  }
  return sums.map(({ sum, count }, i) => {
    const start = first + i * HOUR;
    if (count === 0) return { start, watts: null, level: null, biggest: null };
    const watts = sum / count;
    return { start, watts, ...levelFor(watts, appliances) };
  });
}

/** Longest contiguous span of the highest level reached – or null if nothing ever ran. */
export function bestSpan(buckets: HourBucket[]): { from: number; to: number; level: HourLevel } | null {
  const best: HourLevel | null = buckets.some((b) => b.level === "lots")
    ? "lots"
    : buckets.some((b) => b.level === "some")
      ? "some"
      : null;
  if (!best) return null;

  let bestFrom = -1;
  let bestLength = 0;
  let runStart = -1;
  for (let i = 0; i < buckets.length; i++) {
    if (buckets[i]!.level !== best) {
      runStart = -1;
      continue;
    }
    if (runStart < 0) runStart = i;
    if (i - runStart + 1 > bestLength) {
      bestFrom = runStart;
      bestLength = i - runStart + 1;
    }
  }
  return { from: buckets[bestFrom]!.start, to: buckets[bestFrom]!.start + bestLength * HOUR, level: best };
}
