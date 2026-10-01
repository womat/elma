import type { SurplusReading } from "@elma/shared";
import type { Repo } from "./repo.ts";

type Listener = (producerId: string, reading: SurplusReading) => void;

interface MinuteBucket {
  minute: number;
  sum: number;
  count: number;
}

const MINUTE = 60_000;
export const DEFAULT_SMOOTH_WINDOW_MS = 2 * MINUTE;

/**
 * Hält den aktuellen Wert je Erzeuger im Speicher, verteilt ihn an Live-Clients
 * und schreibt Minutenmittel in die Datenbank.
 *
 * Angezeigt und verteilt wird ein über `smoothWindowMs` geglätteter Wert, damit kurze Regelspitzen
 * (z. B. der Batterie) die Anzeige nicht springen lassen. Die Minutenmittel nutzen die Rohwerte.
 */
export class LiveHub {
  private readonly current = new Map<string, SurplusReading>();
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
    this.current.set(producerId, reading);
    for (const listener of this.listeners) listener(producerId, reading);
  }

  get(producerId: string): SurplusReading | null {
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
   */
  private smooth(producerId: string, raw: SurplusReading): SurplusReading {
    if (this.smoothWindowMs <= 0) return raw;
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
    return { watts: duration > 0 ? Math.round(sum / duration) : raw.watts, timestamp: raw.timestamp };
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
