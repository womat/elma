// Steps whose half can be shown with at most one decimal (e.g. 3 kW -> 1,5 kW; not 2,5 -> 1,25)
const STEPS = [1, 1.5, 2, 3, 4, 5, 6, 8, 10];

/**
 * Round Y scale for the power history: rounds the maximum up to a round step × 10ⁿ
 * (at least 100 W) and returns the ticks 0, half and maximum.
 */
export function niceScale(maxWatts: number): { max: number; ticks: number[] } {
  const value = Math.max(100, maxWatts);
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const max = STEPS.map((s) => s * magnitude).find((v) => v >= value) ?? 10 * magnitude;
  return { max, ticks: [0, max / 2, max] };
}
