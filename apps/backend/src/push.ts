import webpush from "web-push";
import {
  defaultSettings,
  notifyAppliances,
  type Appliance,
  type LiveReading,
  type PushPayload,
  type PushSubscriptionBody,
} from "@elma/shared";
import type { Repo } from "./repo.ts";

/** Sends a message to a subscription. On errors throws an object with statusCode (like web-push). */
export type PushSender = (sub: PushSubscriptionBody, payload: PushPayload) => Promise<void>;

export interface NotifierOptions {
  /** How long an appliance must fit continuously before notifying (against cloud flicker). */
  holdMs?: number;
  /** Minimum interval between two messages for the same appliance. */
  cooldownMs?: number;
  /** A "phase" ends only when the surplus drops below this share of the appliance's power. */
  resetRatio?: number;
}

interface ApplianceState {
  fitSince: number | null;
  notifiedThisPhase: boolean;
  lastNotifiedAt: number;
}

/**
 * Decides on every new reading whether recipients are notified that one of their appliances can run now.
 * State is kept in memory – after a restart at most one extra notification is sent.
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

  /** Returns the promises of the sent messages (for tests); in production they are not awaited. */
  onReading(producerId: string, reading: LiveReading): Promise<void>[] {
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

  /** Message to specific users, regardless of the bells, e.g. about a reservation. */
  async notifyUsers(userIds: string[], payload: PushPayload): Promise<void> {
    await Promise.all([...new Set(userIds)].map((id) => this.sendToUser(id, payload)));
  }

  /** true = notify for this appliance now. */
  private update(key: string, appliance: Appliance, reading: LiveReading): boolean {
    const now = reading.timestamp;
    const s = this.state.get(key) ?? { fitSince: null, notifiedThisPhase: false, lastNotifiedAt: 0 };
    this.state.set(key, s);

    // If the value fluctuates, the appliance counts as "doesn't fit"; without the indicator (no stable) only watts count.
    if (reading.watts >= appliance.watts && reading.stable !== false) {
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
          // Subscription expired or removed by the user -> clean up
          if (status === 404 || status === 410) this.repo.deletePushSubscription(sub.endpoint);
          else console.warn(`[push] Senden fehlgeschlagen (${status ?? "?"}): ${(err as Error).message}`);
        }
      }),
    );
  }
}

/** Loads the VAPID keys from the DB or generates them on first start. */
export function loadVapidKeys(repo: Repo): { publicKey: string; privateKey: string } {
  const stored = repo.getMeta("vapid");
  if (stored) return JSON.parse(stored);
  const keys = webpush.generateVAPIDKeys();
  repo.setMeta("vapid", JSON.stringify(keys));
  return keys;
}

/** proxy: e.g. http://push-proxy:3128, if the backend may reach the internet only via the push proxy */
export function webPushSender(keys: { publicKey: string; privateKey: string }, subject: string, proxy?: string): PushSender {
  return async (sub, payload) => {
    await webpush.sendNotification(sub, JSON.stringify(payload), {
      vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
      TTL: 15 * 60, // after 15 min the info is stale
      urgency: "normal",
      ...(proxy ? { proxy } : {}),
    });
  };
}
