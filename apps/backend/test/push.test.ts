import { beforeEach, describe, expect, it } from "vitest";
import type { PushPayload, PushSubscriptionBody } from "@elma/shared";
import { buildApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import type { PushNotifier } from "../src/push.ts";
import type { Repo } from "../src/repo.ts";

const MIN = 60_000;
const T0 = 1_800_000_000_000;

let repo: Repo;
let notifier: PushNotifier;
let sent: { sub: PushSubscriptionBody; payload: PushPayload }[];
let failWith: number | null;
let producerId: string;
let recipientId: string;

const sub = (n: number): PushSubscriptionBody => ({
  endpoint: `https://push.example/${n}`,
  keys: { p256dh: "p256dh", auth: "auth" },
});

beforeEach(async () => {
  sent = [];
  failWith = null;
  ({ repo, notifier } = await buildApp({
    db: openDb(":memory:"),
    jwtSecret: "x".repeat(32),
    publicUrl: "https://elma.test",
    pushSender: async (s, payload) => {
      if (failWith) throw Object.assign(new Error("fail"), { statusCode: failWith });
      sent.push({ sub: s, payload });
    },
  }));
  const owner = repo.createUser("erzeuger@elma.test");
  producerId = repo.createProducer("PV Dach", owner.id).producer.id;
  const recipient = repo.createUser("empfaenger@elma.test");
  recipientId = recipient.id;
  repo.acceptInvite(repo.createInvite(producerId).code, recipientId);
  repo.savePushSubscription(recipientId, sub(1));
  // Empfänger will bei Waschmaschine (500 W) und Wasserkocher (2000 W) benachrichtigt werden
  repo.saveApplianceSettings(recipientId, { selected: ["washer", "kettle", "tv"], custom: [], notify: ["washer", "kettle"] });
});

/** Schickt einen Messwert durch und wartet, bis alle Nachrichten verschickt sind. */
async function reading(watts: number, t: number) {
  await Promise.all(notifier.onReading(producerId, { watts, timestamp: t }));
}

describe("Push-Benachrichtigungen", () => {
  it("benachrichtigt erst, wenn das Gerät 2 Minuten durchgehend geht", async () => {
    await reading(600, T0);
    await reading(600, T0 + 1 * MIN);
    expect(sent).toHaveLength(0);
    await reading(600, T0 + 2 * MIN);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload.title).toBe("Jetzt reicht's für Waschmaschine");
    expect(sent[0]!.payload.body).toBe("PV Dach hat gerade 0,6 kW Überschuss.");
  });

  it("kurze Einbrüche (Wolke) setzen die Wartezeit zurück", async () => {
    await reading(600, T0);
    await reading(300, T0 + 1 * MIN);
    await reading(600, T0 + 2 * MIN);
    expect(sent).toHaveLength(0);
    await reading(600, T0 + 4 * MIN);
    expect(sent).toHaveLength(1);
  });

  it("benachrichtigt nur einmal pro Überschuss-Phase und frühestens nach dem Cooldown wieder", async () => {
    await reading(600, T0);
    await reading(600, T0 + 2 * MIN);
    await reading(600, T0 + 30 * MIN);
    expect(sent).toHaveLength(1);

    // leicht darunter (> 80 %) beendet die Phase nicht
    await reading(450, T0 + 31 * MIN);
    await reading(600, T0 + 33 * MIN);
    await reading(600, T0 + 70 * MIN);
    expect(sent).toHaveLength(1);

    // deutlich darunter beendet die Phase; nach dem Cooldown kommt die nächste Nachricht
    await reading(100, T0 + 71 * MIN);
    await reading(600, T0 + 72 * MIN);
    await reading(600, T0 + 74 * MIN);
    expect(sent).toHaveLength(2);
  });

  it("fasst mehrere Geräte in einer Nachricht zusammen", async () => {
    await reading(2500, T0);
    await reading(2500, T0 + 2 * MIN);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload.title).toBe("Jetzt geht: Waschmaschine, Wasserkocher");
  });

  it("benachrichtigt nur Geräte, die ausgewählt UND zum Benachrichtigen markiert sind", async () => {
    repo.saveApplianceSettings(recipientId, { selected: ["tv"], custom: [], notify: ["washer"] });
    await reading(600, T0);
    await reading(600, T0 + 2 * MIN);
    expect(sent).toHaveLength(0);
  });

  it("schickt an alle Geräte des Empfängers, aber nicht an Fremde", async () => {
    repo.savePushSubscription(recipientId, sub(2));
    const stranger = repo.createUser("fremd@elma.test");
    repo.savePushSubscription(stranger.id, sub(3));
    repo.saveApplianceSettings(stranger.id, { selected: ["washer"], custom: [], notify: ["washer"] });

    await reading(600, T0);
    await reading(600, T0 + 2 * MIN);
    expect(sent.map((s) => s.sub.endpoint).sort()).toEqual(["https://push.example/1", "https://push.example/2"]);
  });

  it("räumt abgelaufene Abos (410) auf", async () => {
    failWith = 410;
    await reading(600, T0);
    await reading(600, T0 + 2 * MIN);
    expect(repo.pushSubscriptions(recipientId)).toEqual([]);
  });

  it("eigene Geräte lösen ebenfalls aus", async () => {
    repo.saveApplianceSettings(recipientId, {
      selected: [],
      custom: [{ id: "pool", icon: "waves-ladder", name: "Poolpumpe", watts: 800 }],
      notify: ["pool"],
    });
    await reading(900, T0);
    await reading(900, T0 + 2 * MIN);
    expect(sent[0]!.payload.title).toBe("Jetzt reicht's für Poolpumpe");
  });
});

describe("Push-API", () => {
  it("liefert den öffentlichen Schlüssel, speichert Abos und schickt Testnachrichten", async () => {
    const built = await buildApp({
      db: openDb(":memory:"),
      jwtSecret: "x".repeat(32),
      publicUrl: "https://elma.test",
      pushSender: async (s, payload) => void sent.push({ sub: s, payload }),
    });
    const { app } = built;
    const user = built.repo.createUser("a@elma.test");
    const headers = { authorization: `Bearer ${app.jwt.sign({ sub: user.id })}` };

    const key = await app.inject({ url: "/api/push/key" });
    expect(key.json().publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);

    expect((await app.inject({ method: "POST", url: "/api/push/test", headers })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/push/subscribe", headers, payload: { endpoint: "kaputt" } })).statusCode).toBe(400);

    const subscribe = await app.inject({ method: "POST", url: "/api/push/subscribe", headers, payload: sub(9) });
    expect(subscribe.statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/push/test", headers })).statusCode).toBe(200);
    expect(sent.at(-1)!.payload.title).toBe("ELMA Testnachricht");

    await app.inject({ method: "POST", url: "/api/push/unsubscribe", headers, payload: { endpoint: sub(9).endpoint } });
    expect((await app.inject({ method: "POST", url: "/api/push/test", headers })).statusCode).toBe(400);
  });

  it("VAPID-Schlüssel bleiben über Neustarts gleich", async () => {
    const db = openDb(":memory:");
    const a = await buildApp({ db, jwtSecret: "x".repeat(32), publicUrl: "https://elma.test" });
    const b = await buildApp({ db, jwtSecret: "x".repeat(32), publicUrl: "https://elma.test" });
    const keyA = (await a.app.inject({ url: "/api/push/key" })).json().publicKey;
    const keyB = (await b.app.inject({ url: "/api/push/key" })).json().publicKey;
    expect(keyA).toBe(keyB);
  });
});
