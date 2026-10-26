import {
  BATTERY_STALE_MS,
  LEVEL_SOME_WATTS,
  STABLE_LEVEL_RATIO,
  STABLE_TIME_SHARE,
  type BatteryReading,
  type LiveReading,
  type SurplusReading,
} from "@elma/shared";
import type { Repo } from "./repo.ts";

type Listener = (producerId: string, reading: LiveReading) => void;

interface MinuteBucket {
  minute: number;
  sum: number;
  count: number;
}

const MINUTE = 60_000;
/** 5 instead of 2 min (Wolfgang, 23.10.2026): calmer number; the stability indicator uses the same window. */
export const DEFAULT_SMOOTH_WINDOW_MS = 5 * MINUTE;

/**
 * Keeps the current value per producer in memory, distributes it to live clients
 * and writes per-minute averages to the database.
 *
 * Displayed and distributed is a value smoothed over `smoothWindowMs`, so short control spikes
 * (e.g. from the battery) don't make the display jump. The per-minute averages use the raw values.
 * In addition there is the stability indicator and the latest battery value; neither goes into the DB.
 */
export class LiveHub {
  private readonly current = new Map<string, LiveReading>();
  private readonly batteries = new Map<string, BatteryReading>();
  private readonly samples = new Map<string, SurplusReading[]>();
  private readonly buckets = new Map<string, MinuteBucket>();
  private readonly listeners = new Set<Listener>();
  private readonly repo: Repo;
  private readonly smoothWindowMs: number;

  constructor(repo: Repo, smoothWindowMs = DEFAULT_SMOOTH_WINDOW_MS) {
    this.repo = repo;
    this.smoothWindowMs = smoothWindowMs;
  }

  publish(producerId: string, raw: SurplusReading): void {
    this.aggregate(producerId, raw);
    const reading = this.smooth(producerId, raw);
    // No separate broadcast for the battery: surplus values arrive about every 5 s anyway.
    const battery = this.batteries.get(producerId);
    if (battery && raw.timestamp - battery.timestamp <= BATTERY_STALE_MS) reading.battery = battery;
    this.current.set(producerId, reading);
    for (const listener of this.listeners) listener(producerId, reading);
  }

  /** Remembers the latest battery value; it goes out with the next surplus value. */
  publishBattery(producerId: string, battery: BatteryReading): void {
    this.batteries.set(producerId, battery);
  }

  get(producerId: string): LiveReading | null {
    return this.current.get(producerId) ?? null;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Writes completed minutes even if no new value has arrived since (called by a timer). */
  flushCompleted(now: number): void {
    const currentMinute = Math.floor(now / MINUTE) * MINUTE;
    for (const [producerId, bucket] of this.buckets) {
      if (bucket.minute < currentMinute) {
        this.repo.saveMinute(producerId, bucket.minute, bucket.sum / bucket.count);
        this.buckets.delete(producerId);
      }
    }
  }

  /** Writes all open minutes, e.g. on shutdown. */
  flush(): void {
    for (const [producerId, bucket] of this.buckets) this.repo.saveMinute(producerId, bucket.minute, bucket.sum / bucket.count);
    this.buckets.clear();
  }

  /**
   * Time-weighted average over the window before the new value: each value holds until the next one.
   * Needed because the bridge sends irregularly (every few seconds, immediately on jumps).
   * `stable` only if there is surplus and the values cover the whole window (after start or a gap only after
   * `smoothWindowMs`). Stable additionally means: the current raw value is still near the average. Otherwise "Stabil"
   * was still shown for a minute after a short spike although nothing was left, and after a start just over 2 min
   * sufficed (Wolfgang, 26.10.2026). The window stays 5 min; a longer one would also make the number more sluggish.
   */
  private smooth(producerId: string, raw: SurplusReading): LiveReading {
    if (this.smoothWindowMs <= 0) return { ...raw };
    let list = this.samples.get(producerId) ?? [];
    const last = list.at(-1);
    // Gap longer than the window (e.g. bridge was offline) or time runs backwards -> start over
    if (!last || raw.timestamp - last.timestamp > this.smoothWindowMs || raw.timestamp < last.timestamp) list = [];
    list.push(raw);

    const start = raw.timestamp - this.smoothWindowMs;
    // keep the oldest value that still reaches into the window
    while (list.length >= 2 && list[1]!.timestamp <= start) list.shift();
    this.samples.set(producerId, list);

    let sum = 0;
    let duration = 0;
    for (let i = 0; i < list.length - 1; i++) {
      const from = Math.max(list[i]!.timestamp, start);
      const to = list[i + 1]!.timestamp;
      if (to > from) {
        sum += list[i]!.watts * (to - from);
        duration += to - from;
      }
    }
    const watts = duration > 0 ? Math.round(sum / duration) : raw.watts;
    const reading: LiveReading = { watts, timestamp: raw.timestamp };
    if (watts <= LEVEL_SOME_WATTS || duration < this.smoothWindowMs) return reading;

    let steady = 0;
    for (let i = 0; i < list.length - 1; i++) {
      if (list[i]!.watts < watts * STABLE_LEVEL_RATIO) continue;
      steady += Math.max(0, list[i + 1]!.timestamp - Math.max(list[i]!.timestamp, start));
    }
    reading.stable = raw.watts >= watts * STABLE_LEVEL_RATIO && steady >= duration * STABLE_TIME_SHARE;
    return reading;
  }

  private aggregate(producerId: string, reading: SurplusReading): void {
    const minute = Math.floor(reading.timestamp / MINUTE) * MINUTE;
    const bucket = this.buckets.get(producerId);
    if (bucket && bucket.minute === minute) {
      bucket.sum += reading.watts;
      bucket.count += 1;
      return;
    }
    if (bucket) this.repo.saveMinute(producerId, bucket.minute, bucket.sum / bucket.count);
    this.buckets.set(producerId, { minute, sum: reading.watts, count: 1 });
  }
}
