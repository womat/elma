// Stufen, deren Hälfte mit höchstens einer Nachkommastelle darstellbar ist (z. B. 3 kW -> 1,5 kW; nicht 2,5 -> 1,25)
const STEPS = [1, 1.5, 2, 3, 4, 5, 6, 8, 10];

/**
 * Glatte Y-Skala für den Leistungs-Verlauf: rundet den Höchstwert auf eine glatte Stufe × 10ⁿ auf
 * (mindestens 100 W) und liefert die Teilstriche 0, Hälfte und Maximum.
 */
export function niceScale(maxWatts: number): { max: number; ticks: number[] } {
  const value = Math.max(100, maxWatts);
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const max = STEPS.map((s) => s * magnitude).find((v) => v >= value) ?? 10 * magnitude;
  return { max, ticks: [0, max / 2, max] };
}
