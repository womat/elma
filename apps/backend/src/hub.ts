import type { SurplusReading } from "@elma/shared";
import type { Repo } from "./repo.ts";

type Listener = (producerId: string, reading: SurplusReading) => void;

interface MinuteBucket {
  minute: number;
  sum: number;
  count: number;
}

const MINUTE = 60_000;

/**
 * Hält den aktuellen Wert je Erzeuger im Speicher, verteilt ihn an Live-Clients
 * und schreibt Minutenmittel in die Datenbank.
 */
export class LiveHub {
  private readonly current = new Map<string, SurplusReading>();
  private readonly buckets = new Map<string, MinuteBucket>();
  private readonly listeners = new Set<Listener>();
  private readonly repo: Repo;

  constructor(repo: Repo) {
    this.repo = repo;
  }

  publish(producerId: string, reading: SurplusReading): void {
    this.current.set(producerId, reading);
    this.aggregate(producerId, reading);
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
