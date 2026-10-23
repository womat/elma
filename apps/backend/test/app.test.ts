import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { FastifyInstance } from "fastify";
import type { LiveServerMessage } from "@elma/shared";
import { buildApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { LiveHub } from "../src/hub.ts";
import type { Repo } from "../src/repo.ts";

let app: FastifyInstance;
let repo: Repo;
let baseUrl: string;

beforeEach(async () => {
  // ohne Glättung, damit Live-Werte 1:1 prüfbar sind (Glättung testet hub.test.ts)
  ({ app, repo } = await buildApp({
    db: openDb(":memory:"),
    jwtSecret: "x".repeat(32),
    publicUrl: "https://elma.test",
    smoothWindowMs: 0,
  }));
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("keine Adresse");
  baseUrl = `127.0.0.1:${address.port}`;
});

afterEach(() => app.close());

/** Anmeldung läuft über Passkeys (siehe passkeys.test.ts); hier reicht ein gültiges JWT. */
async function login(email: string): Promise<string> {
  const user = repo.userByEmail(email);
  if (!user) throw new Error(`kein User ${email}`);
  return app.jwt.sign({ sub: user.id });
}

/** Öffnet /live, meldet sich an und sammelt alle Nachrichten. */
async function openLive(token: string): Promise<{ messages: LiveServerMessage[]; ws: WebSocket }> {
  const ws = new WebSocket(`ws://${baseUrl}/live`);
  const messages: LiveServerMessage[] = [];
  ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
  await new Promise((r) => ws.once("open", r));
  ws.send(JSON.stringify({ type: "auth", token }));
  await waitFor(() => messages.some((m) => m.type === "ready" || m.type === "error"));
  return { messages, ws };
}

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function setup() {
  const owner = repo.createUser("erzeuger@elma.test");
  const { producer, deviceToken } = repo.createProducer("PV Dach", owner.id);
  return { owner, producer, deviceToken };
}

describe("Einladung und Freigabe", () => {
  it("Einladungslink zeigt auf die öffentliche Adresse", async () => {
    const { producer } = await setup();
    const invite = await app.inject({
      method: "POST",
      url: `/api/producers/${producer.id}/invites`,
      headers: { authorization: `Bearer ${await login("erzeuger@elma.test")}` },
    });
    expect(invite.statusCode).toBe(200);
    expect(invite.json().url).toContain("https://elma.test/?invite=");
  });

  it("Anmeldung und Registrierung mit Passwort gibt es nicht mehr", async () => {
    const oldLogin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "a@elma.test", password: "x" } });
    const register = await app.inject({ method: "POST", url: "/api/auth/register", payload: {} });
    expect(oldLogin.statusCode).toBe(404);
    expect(register.statusCode).toBe(404);
  });

  it("nur der Eigentümer darf einladen, Fremde sehen keinen Verlauf", async () => {
    const { producer } = await setup();
    repo.createUser("fremd@elma.test");
    const token = await login("fremd@elma.test");
    const headers = { authorization: `Bearer ${token}` };
    expect((await app.inject({ method: "POST", url: `/api/producers/${producer.id}/invites`, headers })).statusCode).toBe(403);
    expect((await app.inject({ url: `/api/producers/${producer.id}/history`, headers })).statusCode).toBe(404);
  });
});

describe("Live-Daten", () => {
  it("Werte der Bridge kommen beim berechtigten Empfänger an, nicht bei Fremden", async () => {
    const { producer, deviceToken } = await setup();
    const recipient = repo.createUser("empfaenger@elma.test");
    repo.acceptInvite(repo.createInvite(producer.id).code, recipient.id);
    repo.createUser("fremd@elma.test");

    const allowed = await openLive(await login("empfaenger@elma.test"));
    const stranger = await openLive(await login("fremd@elma.test"));
    expect(allowed.messages[0]).toEqual({ type: "ready", producerIds: [producer.id] });
    expect(stranger.messages[0]).toEqual({ type: "ready", producerIds: [] });

    const bridge = new WebSocket(`ws://${baseUrl}/ingest`, { headers: { authorization: `Bearer ${deviceToken}` } });
    await new Promise((r) => bridge.once("open", r));
    const reading = { watts: 2300, timestamp: Date.now() };
    bridge.send(JSON.stringify({ type: "reading", reading }));

    await waitFor(() => allowed.messages.some((m) => m.type === "reading"));
    expect(allowed.messages.at(-1)).toEqual({ type: "reading", producerId: producer.id, reading });
    await new Promise((r) => setTimeout(r, 50));
    expect(stranger.messages.filter((m) => m.type === "reading")).toHaveLength(0);

    const list = await app.inject({
      url: "/api/producers",
      headers: { authorization: `Bearer ${await login("empfaenger@elma.test")}` },
    });
    expect(list.json()[0].current).toEqual(reading);

    for (const ws of [bridge, allowed.ws, stranger.ws]) ws.close();
  });

  it("der Akkuwert der Bridge geht mit dem nächsten Überschusswert hinaus", async () => {
    const { producer, deviceToken } = await setup();
    const live = await openLive(await login("erzeuger@elma.test"));
    const bridge = new WebSocket(`ws://${baseUrl}/ingest`, { headers: { authorization: `Bearer ${deviceToken}` } });
    await new Promise((r) => bridge.once("open", r));
    const battery = { watts: 1200, soc: 92, timestamp: Date.now() };
    bridge.send(JSON.stringify({ type: "battery", battery }));
    const reading = { watts: 800, timestamp: Date.now() };
    bridge.send(JSON.stringify({ type: "reading", reading }));

    await waitFor(() => live.messages.some((m) => m.type === "reading"));
    expect(live.messages.at(-1)).toEqual({ type: "reading", producerId: producer.id, reading: { ...reading, battery } });
    for (const ws of [bridge, live.ws]) ws.close();
  });

  it("Bridge mit falschem Token wird abgewiesen", async () => {
    const bridge = new WebSocket(`ws://${baseUrl}/ingest`, { headers: { authorization: "Bearer falsch" } });
    const code = await new Promise<number>((r) => bridge.once("close", (c) => r(c)));
    expect(code).toBe(4401);
  });

  it("Shelly schickt Werte direkt, gedrosselt und mit gedrehtem Vorzeichen", async () => {
    const { producer, deviceToken } = await setup();
    const { messages, ws } = await openLive(await login("erzeuger@elma.test"));

    const shelly = new WebSocket(`ws://${baseUrl}/ingest/shelly/${deviceToken}`);
    await new Promise((r) => shelly.once("open", r));
    const frame = (power: number) =>
      JSON.stringify({ src: "shellypro3em-abc", dst: "ws", method: "NotifyStatus", params: { "em:0": { total_act_power: power } } });
    shelly.send(frame(-1840));
    shelly.send(frame(-1830)); // < 50 W Änderung innerhalb von 5 s: wird verworfen
    shelly.send(frame(-2500)); // Sprung: sofort

    await waitFor(() => messages.filter((m) => m.type === "reading").length >= 2);
    await new Promise((r) => setTimeout(r, 50));
    const watts = messages.flatMap((m) => (m.type === "reading" && m.producerId === producer.id ? [m.reading.watts] : []));
    expect(watts).toEqual([1840, 2500]);

    shelly.close();
    ws.close();
  });

  it("Shelly mit falschem Token wird abgewiesen", async () => {
    const shelly = new WebSocket(`ws://${baseUrl}/ingest/shelly/falsch`);
    const code = await new Promise<number>((r) => shelly.once("close", (c) => r(c)));
    expect(code).toBe(4401);
  });

  it("nach rotate-token gilt nur noch das neue Token", async () => {
    const { producer, deviceToken } = await setup();
    const fresh = repo.rotateDeviceToken(producer.id);
    expect(fresh).toBeDefined();
    expect(repo.producerByDeviceToken(deviceToken)).toBeUndefined();
    expect(repo.producerByDeviceToken(fresh!)?.id).toBe(producer.id);
    expect(repo.rotateDeviceToken("gibt-es-nicht")).toBeUndefined();
  });

  it("Live-Verbindung mit ungültigem JWT wird abgewiesen", async () => {
    const { messages } = await openLive("kein.gueltiges.jwt");
    expect(messages[0]).toEqual({ type: "error", message: "Anmeldung fehlgeschlagen" });
  });
});

describe("Erzeuger umbenennen", () => {
  it("nur der Eigentümer darf umbenennen", async () => {
    const { producer } = await setup();
    const recipient = repo.createUser("empfaenger@elma.test");
    repo.acceptInvite(repo.createInvite(producer.id).code, recipient.id);
    repo.createUser("fremd@elma.test");
    const auth = async (email: string) => ({ authorization: `Bearer ${await login(email)}` });
    const rename = async (email: string, name: string) =>
      app.inject({ method: "PATCH", url: `/api/producers/${producer.id}`, headers: await auth(email), payload: { name } });

    expect((await rename("empfaenger@elma.test", "Hack")).statusCode).toBe(403);
    expect((await rename("fremd@elma.test", "Hack")).statusCode).toBe(404);
    expect((await rename("erzeuger@elma.test", "   ")).statusCode).toBe(400);

    const ok = await rename("erzeuger@elma.test", "  Haus Wullersdorf ");
    expect(ok.json()).toEqual({ id: producer.id, name: "Haus Wullersdorf" });
    const list = await app.inject({ url: "/api/producers", headers: await auth("empfaenger@elma.test") });
    expect(list.json()[0].name).toBe("Haus Wullersdorf");
  });
});

describe("Anzeigename", () => {
  it("ist anfangs leer, lässt sich setzen, trimmen und wieder löschen", async () => {
    repo.createUser("elisa@elma.test");
    const headers = { authorization: `Bearer ${await login("elisa@elma.test")}` };
    const put = (displayName: unknown) => app.inject({ method: "PUT", url: "/api/me", headers, payload: { displayName } });

    expect((await app.inject({ url: "/api/me", headers })).json()).toMatchObject({ email: "elisa@elma.test", displayName: null });

    const ok = await put("  Elisa ");
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ displayName: "Elisa" });
    expect((await app.inject({ url: "/api/me", headers })).json()).toMatchObject({ displayName: "Elisa" });
    expect(repo.userByEmail("elisa@elma.test")?.displayName).toBe("Elisa");

    expect((await put(null)).json()).toMatchObject({ displayName: null });
  });

  it("lehnt leere, zu lange und falsche Namen ab und verlangt Anmeldung", async () => {
    repo.createUser("elisa@elma.test");
    const headers = { authorization: `Bearer ${await login("elisa@elma.test")}` };
    const put = (payload: unknown) => app.inject({ method: "PUT", url: "/api/me", headers, payload: payload as object });

    expect((await put({ displayName: "   " })).statusCode).toBe(400);
    expect((await put({ displayName: "x".repeat(41) })).statusCode).toBe(400);
    expect((await put({ displayName: 42 })).statusCode).toBe(400);
    expect((await put({})).statusCode).toBe(400);
    expect((await put({ displayName: "x".repeat(40) })).statusCode).toBe(200);
    expect((await app.inject({ method: "PUT", url: "/api/me", payload: { displayName: "Elisa" } })).statusCode).toBe(401);
  });
});

describe("Name in der Einladung", () => {
  it("landet beim Einlösen im Konto, überschreibt aber keinen selbst gewählten Namen", async () => {
    const { producer } = await setup();
    const owner = { authorization: `Bearer ${await login("erzeuger@elma.test")}` };
    const invite = (payload?: object) =>
      app.inject({ method: "POST", url: `/api/producers/${producer.id}/invites`, headers: owner, ...(payload ? { payload } : {}) });

    expect((await invite({ displayName: "x".repeat(41) })).statusCode).toBe(400);
    expect((await invite()).statusCode).toBe(200);

    const margit = repo.createUser("margit@elma.test");
    const named = (await invite({ displayName: " Margit " })).json();
    const headers = { authorization: `Bearer ${await login("margit@elma.test")}` };
    expect((await app.inject({ method: "POST", url: `/api/invites/${named.code}/accept`, headers })).statusCode).toBe(200);
    expect(repo.userById(margit.id)?.displayName).toBe("Margit");

    repo.setDisplayName(margit.id, "Mama");
    repo.acceptInvite(repo.createInvite(producer.id, "Margit").code, margit.id);
    expect(repo.userById(margit.id)?.displayName).toBe("Mama");
  });
});

describe("Version", () => {
  it("/api/health liefert die Version", async () => {
    const built = await buildApp({ db: openDb(":memory:"), jwtSecret: "x".repeat(32), publicUrl: "https://elma.test", version: "v0.2.0" });
    expect((await built.app.inject({ url: "/api/health" })).json()).toEqual({ ok: true, version: "v0.2.0" });
    expect((await app.inject({ url: "/api/health" })).json()).toEqual({ ok: true, version: "dev" });
  });
});

describe("Geräteauswahl", () => {
  it("ist anfangs leer, lässt sich speichern und ist pro User getrennt", async () => {
    repo.createUser("a@elma.test");
    repo.createUser("b@elma.test");
    const a = { authorization: `Bearer ${await login("a@elma.test")}` };
    const b = { authorization: `Bearer ${await login("b@elma.test")}` };

    expect((await app.inject({ url: "/api/me/appliances", headers: a })).json()).toEqual({ settings: null });

    const settings = { selected: ["tv", "coffee"], custom: [{ id: "c1", icon: "🏊", name: "Poolpumpe", watts: 800 }] };
    const put = await app.inject({ method: "PUT", url: "/api/me/appliances", headers: a, payload: settings });
    expect(put.statusCode).toBe(200);
    expect((await app.inject({ url: "/api/me/appliances", headers: a })).json()).toEqual({ settings: { ...settings, notify: [] } });
    expect((await app.inject({ url: "/api/me/appliances", headers: b })).json()).toEqual({ settings: null });
  });

  it("lehnt ungültige Geräte ab", async () => {
    repo.createUser("a@elma.test");
    const headers = { authorization: `Bearer ${await login("a@elma.test")}` };
    const bad = { selected: [], custom: [{ id: "c1", icon: "x", name: "", watts: -5 }] };
    expect((await app.inject({ method: "PUT", url: "/api/me/appliances", headers, payload: bad })).statusCode).toBe(400);
  });
});

describe("Minutenmittel", () => {
  it("schreibt abgeschlossene Minuten in den Verlauf", async () => {
    const { producer } = await setup();
    const hub = new LiveHub(repo);
    const t0 = 1_700_000_040_000;
    hub.publish(producer.id, { watts: 1000, timestamp: t0 + 1000 });
    hub.publish(producer.id, { watts: 2000, timestamp: t0 + 30_000 });
    hub.flushCompleted(t0 + 30_500);
    expect(repo.history(producer.id, 0)).toEqual([]);
    hub.flushCompleted(t0 + 61_000);
    expect(repo.history(producer.id, 0)).toEqual([{ t: t0, watts: 1500 }]);
  });
});

describe("ELISA-Modus", () => {
  async function withRecipient() {
    const { producer, deviceToken, owner } = await setup();
    const elisa = repo.createUser("elisa@elma.test");
    repo.setDisplayName(elisa.id, "Elisa");
    repo.acceptInvite(repo.createInvite(producer.id).code, elisa.id);
    return { producer, deviceToken, owner, elisa };
  }

  it("POST /api/control/status: nur mit Steuer-Token, nicht mit dem Geräte-Token", async () => {
    const { producer, deviceToken } = await withRecipient();
    const status = { compressorRunning: false, wallboxCharging: false, wallboxManual: false };
    const post = (authorization?: string, payload: object = status) =>
      app.inject({ method: "POST", url: "/api/control/status", headers: authorization ? { authorization } : {}, payload });

    expect((await post()).statusCode).toBe(401);
    expect((await post("Bearer falsch")).statusCode).toBe(401);
    expect((await post(`Bearer ${deviceToken}`)).statusCode).toBe(401);

    const old = repo.createControlToken(producer.id);
    const token = repo.createControlToken(producer.id);
    expect((await post(`Bearer ${old}`)).statusCode).toBe(401);
    expect((await post(`Bearer ${token}`, { compressorRunning: "ja" })).statusCode).toBe(400);
    const ok = await post(`Bearer ${token}`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ active: false, until: null });

    const list = await app.inject({ url: "/api/producers", headers: { authorization: `Bearer ${await login("elisa@elma.test")}` } });
    expect(list.json()[0].reservation).toMatchObject({ controlConnected: true, blockedReason: null, canReserve: false, minutesLeft: 60 });
  });

  it("/live bekommt den Stand nach ready, dann Start und Ende", async () => {
    const { producer, elisa } = await withRecipient();
    repo.setCanReserve(producer.id, elisa.id, true);
    const headers = { authorization: `Bearer ${await login("elisa@elma.test")}` };
    const owner = await openLive(await login("erzeuger@elma.test"));
    const reservationsSeen = () => owner.messages.filter((m) => m.type === "reservation");
    await waitFor(() => reservationsSeen().length === 1);
    expect(reservationsSeen()[0]).toMatchObject({ producerId: producer.id, state: { active: null } });

    await app.inject({ method: "POST", url: `/api/producers/${producer.id}/reservation`, headers, payload: { minutes: 15 } });
    await waitFor(() => reservationsSeen().length === 2);
    expect(reservationsSeen()[1]).toMatchObject({ state: { active: { userName: "Elisa", mine: false } } });

    await app.inject({ method: "DELETE", url: `/api/producers/${producer.id}/reservation`, headers });
    await waitFor(() => reservationsSeen().length === 3);
    expect(reservationsSeen()[2]).toMatchObject({ state: { active: null } });
    owner.ws.close();
  });

  it("/ingest bekommt den Stand nach dem Verbinden, dann Start und Ende, Node-RED-Status aber nicht", async () => {
    const { producer, deviceToken, elisa } = await withRecipient();
    repo.setCanReserve(producer.id, elisa.id, true);
    const headers = { authorization: `Bearer ${await login("elisa@elma.test")}` };
    const bridge = new WebSocket(`ws://${baseUrl}/ingest`, { headers: { authorization: `Bearer ${deviceToken}` } });
    const messages: unknown[] = [];
    bridge.on("message", (data) => messages.push(JSON.parse(data.toString())));
    await waitFor(() => messages.length === 1);
    expect(messages[0]).toEqual({ type: "reservation", until: null });

    const res = await app.inject({ method: "POST", url: `/api/producers/${producer.id}/reservation`, headers, payload: { minutes: 15 } });
    await waitFor(() => messages.length === 2);
    expect(messages[1]).toEqual({ type: "reservation", until: res.json().active.endsAt, by: "Elisa" });

    // Node-RED meldet sich: Für die App ändert sich etwas (controlConnected), für die Bridge nicht
    const token = repo.createControlToken(producer.id);
    const status = await app.inject({
      method: "POST",
      url: "/api/control/status",
      headers: { authorization: `Bearer ${token}` },
      payload: { compressorRunning: false, wallboxCharging: false },
    });
    expect(status.json()).toEqual({ active: true, until: res.json().active.endsAt, by: "Elisa" });

    await app.inject({ method: "DELETE", url: `/api/producers/${producer.id}/reservation`, headers });
    await waitFor(() => messages.length === 3);
    expect(messages[2]).toEqual({ type: "reservation", until: null });
    await new Promise((r) => setTimeout(r, 50));
    expect(messages).toHaveLength(3);
    bridge.close();
  });

  it("nur der Erzeuger sieht die Empfänger und vergibt das Recht", async () => {
    const { producer, elisa } = await withRecipient();
    const auth = async (email: string) => ({ authorization: `Bearer ${await login(email)}` });
    const put = async (email: string, userId: string, payload: object) =>
      app.inject({ method: "PUT", url: `/api/producers/${producer.id}/recipients/${userId}`, headers: await auth(email), payload });

    expect((await app.inject({ url: `/api/producers/${producer.id}/recipients`, headers: await auth("elisa@elma.test") })).statusCode).toBe(403);
    expect((await put("elisa@elma.test", elisa.id, { canReserve: true })).statusCode).toBe(403);
    expect((await put("erzeuger@elma.test", elisa.id, {})).statusCode).toBe(400);
    expect((await put("erzeuger@elma.test", "gibt-es-nicht", { canReserve: true })).statusCode).toBe(404);

    expect((await put("erzeuger@elma.test", elisa.id, { canReserve: true })).statusCode).toBe(200);
    const list = await app.inject({ url: `/api/producers/${producer.id}/recipients`, headers: await auth("erzeuger@elma.test") });
    expect(list.json()).toEqual([{ userId: elisa.id, name: "Elisa", email: "elisa@elma.test", canReserve: true }]);
    expect(repo.canReserve(producer.id, elisa.id)).toBe(true);
  });
});
