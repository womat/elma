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
/** 5 statt 2 min (Wolfgang, 23.10.2026): ruhigere Zahl, über dasselbe Fenster läuft die Stabilitätsampel. */
export const DEFAULT_SMOOTH_WINDOW_MS = 5 * MINUTE;

/**
 * Hält den aktuellen Wert je Erzeuger im Speicher, verteilt ihn an Live-Clients
 * und schreibt Minutenmittel in die Datenbank.
 *
 * Angezeigt und verteilt wird ein über `smoothWindowMs` geglätteter Wert, damit kurze Regelspitzen
 * (z. B. der Batterie) die Anzeige nicht springen lassen. Die Minutenmittel nutzen die Rohwerte.
 * Dazu kommen die Stabilitätsampel und der letzte Akkuwert; beide gehen nicht in die DB.
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
    // Kein eigener Broadcast für den Akku: Überschusswerte kommen ohnehin etwa alle 5 s.
    const battery = this.batteries.get(producerId);
    if (battery && raw.timestamp - battery.timestamp <= BATTERY_STALE_MS) reading.battery = battery;
    this.current.set(producerId, reading);
    for (const listener of this.listeners) listener(producerId, reading);
  }

  /** Merkt sich den letzten Akkuwert; er geht mit dem nächsten Überschusswert hinaus. */
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

  /** Schreibt abgeschlossene Minuten, auch wenn seither kein neuer Wert kam (Aufruf per Timer). */
  flushCompleted(now: number): void {
    const currentMinute = Math.floor(now / MINUTE) * MINUTE;
    for (const [producerId, bucket] of this.buckets) {
      if (bucket.minute < currentMinute) {
        this.repo.saveMinute(producerId, bucket.minute, bucket.sum / bucket.count);
        this.buckets.delete(producerId);
      }
    }
  }

  /** Schreibt alle offenen Minuten, z. B. beim Herunterfahren. */
  flush(): void {
    for (const [producerId, bucket] of this.buckets) this.repo.saveMinute(producerId, bucket.minute, bucket.sum / bucket.count);
    this.buckets.clear();
  }

  /**
   * Zeitgewichteter Mittelwert über das Fenster vor dem neuen Wert: Jeder Wert gilt bis zum nächsten.
   * Nötig, weil die Bridge unregelmäßig sendet (alle paar Sekunden, bei Sprüngen sofort).
   * `stable` nur, wenn es Überschuss gibt und die Werte das ganze Fenster abdecken (nach Start oder Lücke erst nach
   * `smoothWindowMs`). Stabil heißt zusätzlich: Auch der aktuelle Rohwert liegt noch beim Mittel. Sonst stand nach
   * einer kurzen Spitze noch eine Minute lang "Stabil", obwohl nichts mehr da war, und nach einem Start reichten gut
   * 2 min (Wolfgang, 26.10.2026). Das Fenster bleibt 5 min, ein längeres machte auch die Zahl träger.
   */
  private smooth(producerId: string, raw: SurplusReading): LiveReading {
    if (this.smoothWindowMs <= 0) return { ...raw };
    let list = this.samples.get(producerId) ?? [];
    const last = list.at(-1);
    // Lücke länger als das Fenster (z. B. Bridge war offline) oder Zeit läuft rückwärts -> neu beginnen
    if (!last || raw.timestamp - last.timestamp > this.smoothWindowMs || raw.timestamp < last.timestamp) list = [];
    list.push(raw);

    const start = raw.timestamp - this.smoothWindowMs;
    // den ältesten Wert behalten, der noch in das Fenster hineinreicht
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
