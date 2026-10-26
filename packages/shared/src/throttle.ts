/**
 * Decides whether a new value should be sent:
 * immediately on a change >= deltaWatts, otherwise at most every minIntervalMs.
 */
export class Throttle {
  private lastSentAt = 0;
  private lastSentWatts: number | null = null;
  private readonly minIntervalMs: number;
  private readonly deltaWatts: number;

  constructor(minIntervalMs: number, deltaWatts: number) {
    this.minIntervalMs = minIntervalMs;
    this.deltaWatts = deltaWatts;
  }

  shouldSend(watts: number, now: number): boolean {
    if (this.lastSentWatts === null) return true;
    if (Math.abs(watts - this.lastSentWatts) >= this.deltaWatts) return true;
    return now - this.lastSentAt >= this.minIntervalMs;
  }

  markSent(watts: number, now: number): void {
    this.lastSentAt = now;
    this.lastSentWatts = watts;
  }
}
