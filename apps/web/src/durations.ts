import { RESERVATION_DURATIONS } from "@elma/shared";

/**
 * Dauer-Chips im Blatt „Strom reservieren“; über dem Restbudget sind sie gesperrt. Bleiben weniger als 15 min, steht statt
 * „15 min“ der Rest zur Wahl, sonst wäre der Knopf aktiv, aber im Blatt nichts wählbar.
 */
export function durationsFor(minutesLeft: number): number[] {
  const shortest = RESERVATION_DURATIONS[0];
  return minutesLeft > 0 && minutesLeft < shortest ? [minutesLeft, ...RESERVATION_DURATIONS.slice(1)] : [...RESERVATION_DURATIONS];
}
