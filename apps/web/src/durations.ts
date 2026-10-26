import { RESERVATION_DURATIONS } from "@elma/shared";

/**
 * Duration chips in the „Strom reservieren“ sheet; above the remaining budget they are locked. If less than 15 min
 * remain, the remainder is offered instead of „15 min“, otherwise the button would be active but nothing selectable.
 */
export function durationsFor(minutesLeft: number): number[] {
  const shortest = RESERVATION_DURATIONS[0];
  return minutesLeft > 0 && minutesLeft < shortest ? [minutesLeft, ...RESERVATION_DURATIONS.slice(1)] : [...RESERVATION_DURATIONS];
}
