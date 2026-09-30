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
  ({ app, repo } = await buildApp({ db: openDb(":memory:"), jwtSecret: "x".repeat(32), publicUrl: "https://elma.test" }));
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("keine Adresse");
  baseUrl = `127.0.0.1:${address.port}`;
});

afterEach(() => app.close());

async function login(email: string, password: string): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return res.json().token;
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
  const owner = await repo.createUser("erzeuger@elma.test", "passwort123");
  const { producer, deviceToken } = repo.createProducer("PV Dach", owner.id);
  return { owner, producer, deviceToken };
}

describe("Einladung und Freigabe", () => {
  it("Empfänger registriert sich per Einladung und sieht den Erzeuger", async () => {
    const { producer } = await setup();
    const ownerToken = await login("erzeuger@elma.test", "passwort123");

    const invite = await app.inject({
      method: "POST",
      url: `/api/producers/${producer.id}/invites`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(invite.statusCode).toBe(200);
    expect(invite.json().url).toContain("https://elma.test/?invite=");

    const reg = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "empfaenger@elma.test", password: "passwort456", inviteCode: invite.json().code },
    });
    expect(reg.statusCode).toBe(200);

    const list = await app.inject({ url: "/api/producers", headers: { authorization: `Bearer ${reg.json().token}` } });
    expect(list.json()).toMatchObject([{ id: producer.id, name: "PV Dach", isOwner: false }]);

    // Einladung ist nur einmal verwendbar
    const again = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "dritter@elma.test", password: "passwort789", inviteCode: invite.json().code },
    });
    expect(again.statusCode).toBe(400);
  });

  it("Registrierung ohne gültige Einladung ist nicht möglich", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "x@elma.test", password: "passwort123", inviteCode: "falsch" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("nur der Eigentümer darf einladen, Fremde sehen keinen Verlauf", async () => {
    const { producer } = await setup();
    await repo.createUser("fremd@elma.test", "passwort123");
    const token = await login("fremd@elma.test", "passwort123");
    const headers = { authorization: `Bearer ${token}` };
    expect((await app.inject({ method: "POST", url: `/api/producers/${producer.id}/invites`, headers })).statusCode).toBe(403);
    expect((await app.inject({ url: `/api/producers/${producer.id}/history`, headers })).statusCode).toBe(404);
  });
});

describe("Live-Daten", () => {
  it("Werte der Bridge kommen beim berechtigten Empfänger an, nicht bei Fremden", async () => {
    const { producer, deviceToken } = await setup();
    const recipient = await repo.createUser("empfaenger@elma.test", "passwort123");
    repo.acceptInvite(repo.createInvite(producer.id).code, recipient.id);
    await repo.createUser("fremd@elma.test", "passwort123");

    const allowed = await openLive(await login("empfaenger@elma.test", "passwort123"));
    const stranger = await openLive(await login("fremd@elma.test", "passwort123"));
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
      headers: { authorization: `Bearer ${await login("empfaenger@elma.test", "passwort123")}` },
    });
    expect(list.json()[0].current).toEqual(reading);

    for (const ws of [bridge, allowed.ws, stranger.ws]) ws.close();
  });

  it("Bridge mit falschem Token wird abgewiesen", async () => {
    const bridge = new WebSocket(`ws://${baseUrl}/ingest`, { headers: { authorization: "Bearer falsch" } });
    const code = await new Promise<number>((r) => bridge.once("close", (c) => r(c)));
    expect(code).toBe(4401);
  });

  it("Live-Verbindung mit ungültigem JWT wird abgewiesen", async () => {
    const { messages } = await openLive("kein.gueltiges.jwt");
    expect(messages[0]).toEqual({ type: "error", message: "Anmeldung fehlgeschlagen" });
  });
});

describe("Geräteauswahl", () => {
  it("ist anfangs leer, lässt sich speichern und ist pro User getrennt", async () => {
    await repo.createUser("a@elma.test", "passwort123");
    await repo.createUser("b@elma.test", "passwort123");
    const a = { authorization: `Bearer ${await login("a@elma.test", "passwort123")}` };
    const b = { authorization: `Bearer ${await login("b@elma.test", "passwort123")}` };

    expect((await app.inject({ url: "/api/me/appliances", headers: a })).json()).toEqual({ settings: null });

    const settings = { selected: ["tv", "coffee"], custom: [{ id: "c1", icon: "🏊", name: "Poolpumpe", watts: 800 }] };
    const put = await app.inject({ method: "PUT", url: "/api/me/appliances", headers: a, payload: settings });
    expect(put.statusCode).toBe(200);
    expect((await app.inject({ url: "/api/me/appliances", headers: a })).json()).toEqual({ settings: { ...settings, notify: [] } });
    expect((await app.inject({ url: "/api/me/appliances", headers: b })).json()).toEqual({ settings: null });
  });

  it("lehnt ungültige Geräte ab", async () => {
    await repo.createUser("a@elma.test", "passwort123");
    const headers = { authorization: `Bearer ${await login("a@elma.test", "passwort123")}` };
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
