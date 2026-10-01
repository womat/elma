import webpush from "web-push";
import {
  defaultSettings,
  notifyAppliances,
  type Appliance,
  type PushPayload,
  type PushSubscriptionBody,
  type SurplusReading,
} from "@elma/shared";
import type { Repo } from "./repo.ts";

/** Schickt eine Nachricht an ein Abo. Wirft bei Fehlern ein Objekt mit statusCode (wie web-push). */
export type PushSender = (sub: PushSubscriptionBody, payload: PushPayload) => Promise<void>;

export interface NotifierOptions {
  /** So lange muss ein Gerät durchgehend gehen, bevor benachrichtigt wird (gegen Wolken-Flackern). */
  holdMs?: number;
  /** Mindestabstand zwischen zwei Nachrichten für dasselbe Gerät. */
  cooldownMs?: number;
  /** Eine "Phase" endet erst, wenn der Überschuss unter diesen Anteil der Geräteleistung fällt. */
  resetRatio?: number;
}

interface ApplianceState {
  fitSince: number | null;
  notifiedThisPhase: boolean;
  lastNotifiedAt: number;
}

/**
 * Entscheidet bei jedem neuen Messwert, ob Empfänger benachrichtigt werden, dass eines ihrer Geräte jetzt geht.
 * Zustand liegt im Speicher – nach einem Neustart wird höchstens einmal zu viel benachrichtigt.
 */
export class PushNotifier {
  private readonly state = new Map<string, ApplianceState>();
  private readonly holdMs: number;
  private readonly cooldownMs: number;
  private readonly resetRatio: number;
  private readonly repo: Repo;
  private readonly send: PushSender;

  constructor(repo: Repo, send: PushSender, opts: NotifierOptions = {}) {
    this.repo = repo;
    this.send = send;
    this.holdMs = opts.holdMs ?? 2 * 60_000;
    this.cooldownMs = opts.cooldownMs ?? 60 * 60_000;
    this.resetRatio = opts.resetRatio ?? 0.8;
  }

  /** Liefert die Versprechen der gesendeten Nachrichten (für Tests); im Betrieb wird nicht darauf gewartet. */
  onReading(producerId: string, reading: SurplusReading): Promise<void>[] {
    const producer = this.repo.producerById(producerId);
    if (!producer) return [];
    const sends: Promise<void>[] = [];

    for (const userId of this.repo.viewersOf(producerId)) {
      const settings = this.repo.applianceSettings(userId) ?? defaultSettings();
      const due = notifyAppliances(settings).filter((a) => this.update(`${userId}|${producerId}|${a.id}`, a, reading));
      if (due.length === 0) continue;
      sends.push(this.sendToUser(userId, this.message(producer.name, reading.watts, due)));
    }
    return sends;
  }

  sendTest(userId: string): Promise<void> {
    return this.sendToUser(userId, {
      title: "ELMA Testnachricht",
      body: "Benachrichtigungen funktionieren. Wir melden uns, wenn eines deiner Geräte mit Überschuss laufen kann.",
      tag: "elma-test",
    });
  }

  /** true = für dieses Gerät jetzt benachrichtigen. */
  private update(key: string, appliance: Appliance, reading: SurplusReading): boolean {
    const now = reading.timestamp;
    const s = this.state.get(key) ?? { fitSince: null, notifiedThisPhase: false, lastNotifiedAt: 0 };
    this.state.set(key, s);

    if (reading.watts >= appliance.watts) {
      s.fitSince ??= now;
      if (!s.notifiedThisPhase && now - s.fitSince >= this.holdMs && now - s.lastNotifiedAt >= this.cooldownMs) {
        s.notifiedThisPhase = true;
        s.lastNotifiedAt = now;
        return true;
      }
    } else {
      s.fitSince = null;
      if (reading.watts < appliance.watts * this.resetRatio) s.notifiedThisPhase = false;
    }
    return false;
  }

  private message(producerName: string, watts: number, due: Appliance[]): PushPayload {
    const list = due.map((a) => a.name).join(", ");
    const kw = (watts / 1000).toLocaleString("de-AT", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
    return {
      title: due.length === 1 ? `Jetzt reicht's für ${list}` : `Jetzt geht: ${list}`,
      body: `${producerName} hat gerade ${kw} kW Überschuss.`,
      tag: "elma-surplus",
      url: "/",
    };
  }

  private async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    await Promise.all(
      this.repo.pushSubscriptions(userId).map(async (sub) => {
        try {
          await this.send(sub, payload);
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          // Abo abgelaufen oder vom Nutzer entfernt -> aufräumen
          if (status === 404 || status === 410) this.repo.deletePushSubscription(sub.endpoint);
          else console.warn(`[push] Senden fehlgeschlagen (${status ?? "?"}): ${(err as Error).message}`);
        }
      }),
    );
  }
}

/** Lädt die VAPID-Schlüssel aus der DB oder erzeugt sie beim ersten Start. */
export function loadVapidKeys(repo: Repo): { publicKey: string; privateKey: string } {
  const stored = repo.getMeta("vapid");
  if (stored) return JSON.parse(stored);
  const keys = webpush.generateVAPIDKeys();
  repo.setMeta("vapid", JSON.stringify(keys));
  return keys;
}

export function webPushSender(keys: { publicKey: string; privateKey: string }, subject: string): PushSender {
  return async (sub, payload) => {
    await webpush.sendNotification(sub, JSON.stringify(payload), {
      vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
      TTL: 15 * 60, // nach 15 min ist die Info veraltet
      urgency: "normal",
    });
  };
}
