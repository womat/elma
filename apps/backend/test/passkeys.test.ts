import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp, clientIp } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { ChallengeStore, deviceName } from "../src/passkeys.ts";
import type { Repo } from "../src/repo.ts";
import { verifyAuthenticationResponse, verifyRegistrationResponse } from "../src/webauthn.ts";

// Echte Signaturen gibt es nur mit einem echten Gerät; geprüft werden hier die Abläufe drumherum.
vi.mock("../src/webauthn.ts", () => ({
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)";

let app: FastifyInstance;
let repo: Repo;

beforeEach(async () => {
  vi.mocked(verifyRegistrationResponse).mockReset();
  vi.mocked(verifyAuthenticationResponse).mockReset();
  ({ app, repo } = await buildApp({ db: openDb(":memory:"), jwtSecret: "x".repeat(32), publicUrl: "https://elma.test" }));
});

afterEach(() => app.close());

/** Das Gerät bestätigt die Registrierung eines Passkeys mit dieser ID. */
function deviceRegisters(credentialId: string) {
  vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({
    verified: true,
    registrationInfo: { credential: { id: credentialId, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["internal"] } },
  } as never);
}

/** Das Gerät bestätigt die Anmeldung. */
function deviceSignsIn(newCounter = 1) {
  vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({ verified: true, authenticationInfo: { newCounter } } as never);
}

async function post(url: string, payload: unknown, headers: Record<string, string> = {}) {
  return app.inject({ method: "POST", url, payload: payload as object, headers: { "user-agent": IPHONE, ...headers } });
}

async function registerWithInvite(inviteCode: string, email: string, credentialId: string) {
  const start = await post("/api/auth/passkey/register/options", { inviteCode, email });
  if (start.statusCode !== 200) return start;
  deviceRegisters(credentialId);
  return post("/api/auth/passkey/register/verify", { challengeId: start.json().challengeId, response: { id: credentialId } });
}

async function signIn(credentialId: string) {
  const start = await post("/api/auth/passkey/login/options", {});
  deviceSignsIn();
  return post("/api/auth/passkey/login/verify", { challengeId: start.json().challengeId, response: { id: credentialId } });
}

function ownerWithInvite() {
  const owner = repo.createUser("erzeuger@elma.test");
  const { producer } = repo.createProducer("PV Dach", owner.id);
  return { owner, producer, invite: repo.createInvite(producer.id) };
}

describe("Registrierung per Einladung", () => {
  it("legt Konto und Passkey an, nimmt die Einladung an und meldet an", async () => {
    const { producer, invite } = ownerWithInvite();
    const res = await registerWithInvite(invite.code, "Empfaenger@elma.test", "cred-1");
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe("empfaenger@elma.test");

    const headers = { authorization: `Bearer ${res.json().token}` };
    const list = await app.inject({ url: "/api/producers", headers });
    expect(list.json()).toMatchObject([{ id: producer.id, isOwner: false }]);
    const passkeys = await app.inject({ url: "/api/me/passkeys", headers });
    expect(passkeys.json()).toMatchObject([{ id: "cred-1", name: "iPhone", lastUsedAt: null }]);
  });

  it("Optionen verlangen einen auffindbaren Schlüssel für die richtige Domain", async () => {
    const { invite } = ownerWithInvite();
    const start = await post("/api/auth/passkey/register/options", { inviteCode: invite.code, email: "e@elma.test" });
    const { options } = start.json();
    expect(options.rp).toEqual({ name: "ELMA", id: "elma.test" });
    expect(options.user.name).toBe("e@elma.test");
    expect(options.authenticatorSelection.residentKey).toBe("required");
  });

  it("Einladung ist nur einmal verwendbar", async () => {
    const { invite } = ownerWithInvite();
    expect((await registerWithInvite(invite.code, "a@elma.test", "cred-a")).statusCode).toBe(200);
    expect((await registerWithInvite(invite.code, "b@elma.test", "cred-b")).statusCode).toBe(400);
  });

  it("ungültige Einladung, vergebene E-Mail und abgelehnte Prüfung", async () => {
    const { invite } = ownerWithInvite();
    expect((await registerWithInvite("falsch", "x@elma.test", "c")).statusCode).toBe(400);
    expect((await registerWithInvite(invite.code, "erzeuger@elma.test", "c")).statusCode).toBe(409);

    const start = await post("/api/auth/passkey/register/options", { inviteCode: invite.code, email: "y@elma.test" });
    vi.mocked(verifyRegistrationResponse).mockRejectedValueOnce(new Error("falsche Origin"));
    const res = await post("/api/auth/passkey/register/verify", { challengeId: start.json().challengeId, response: { id: "c" } });
    expect(res.statusCode).toBe(400);
    // kein halbes Konto, die Einladung bleibt einlösbar
    expect(repo.userByEmail("y@elma.test")).toBeUndefined();
    expect(repo.validInvite(invite.code)).toBeDefined();
  });
});

describe("Anmeldung", () => {
  it("liefert ein JWT und merkt sich Zähler und Zeitpunkt", async () => {
    const { invite } = ownerWithInvite();
    await registerWithInvite(invite.code, "e@elma.test", "cred-1");
    const res = await signIn("cred-1");
    expect(res.statusCode).toBe(200);
    const me = await app.inject({ url: "/api/me", headers: { authorization: `Bearer ${res.json().token}` } });
    expect(me.json().email).toBe("e@elma.test");
    expect(repo.passkeyById("cred-1")?.counter).toBe(1);
    expect(repo.passkeysOf(me.json().id)[0]?.lastUsedAt).toBeTypeOf("number");
  });

  it("unbekannter Passkey und abgelehnte Signatur werden abgewiesen", async () => {
    const { invite } = ownerWithInvite();
    await registerWithInvite(invite.code, "e@elma.test", "cred-1");
    expect((await signIn("gibts-nicht")).statusCode).toBe(401);
    vi.mocked(verifyAuthenticationResponse).mockReset(); // die Prüfung lief gar nicht erst

    const start = await post("/api/auth/passkey/login/options", {});
    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({ verified: false } as never);
    const res = await post("/api/auth/passkey/login/verify", { challengeId: start.json().challengeId, response: { id: "cred-1" } });
    expect(res.statusCode).toBe(401);
  });

  it("eine Challenge gilt nur einmal", async () => {
    const { invite } = ownerWithInvite();
    await registerWithInvite(invite.code, "e@elma.test", "cred-1");
    const start = await post("/api/auth/passkey/login/options", {});
    const body = { challengeId: start.json().challengeId, response: { id: "cred-1" } };
    deviceSignsIn();
    expect((await post("/api/auth/passkey/login/verify", body)).statusCode).toBe(200);
    deviceSignsIn();
    expect((await post("/api/auth/passkey/login/verify", body)).statusCode).toBe(400);
  });
});

describe("Einrichtungslink", () => {
  it("richtet für ein bestehendes Konto einen Passkey ein und gilt nur einmal", async () => {
    const user = repo.createUser("alt@elma.test");
    const { token } = repo.createSetupLink(user.id);

    const start = await post("/api/auth/passkey/register/options", { setupToken: token });
    expect(start.json().email).toBe("alt@elma.test");
    deviceRegisters("cred-alt");
    const res = await post("/api/auth/passkey/register/verify", { challengeId: start.json().challengeId, response: { id: "cred-alt" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe(user.id);

    expect((await post("/api/auth/passkey/register/options", { setupToken: token })).statusCode).toBe(400);
  });

  it("abgelaufener Link wird abgelehnt", async () => {
    const user = repo.createUser("alt@elma.test");
    const { token } = repo.createSetupLink(user.id);
    vi.useFakeTimers({ now: Date.now() + 8 * 24 * 60 * 60 * 1000, toFake: ["Date"] });
    try {
      expect((await post("/api/auth/passkey/register/options", { setupToken: token })).statusCode).toBe(400);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Eigene Passkeys verwalten", () => {
  it("weiteren Passkey hinzufügen, löschen, aber nie den letzten", async () => {
    const { invite } = ownerWithInvite();
    const reg = await registerWithInvite(invite.code, "e@elma.test", "cred-1");
    const headers = { authorization: `Bearer ${reg.json().token}` };

    const start = await post("/api/me/passkeys/options", {}, headers);
    expect(start.json().options.excludeCredentials).toMatchObject([{ id: "cred-1" }]);
    deviceRegisters("cred-2");
    const added = await post("/api/me/passkeys", { challengeId: start.json().challengeId, response: { id: "cred-2" } }, headers);
    expect(added.json()).toHaveLength(2);

    const del = await app.inject({ method: "DELETE", url: "/api/me/passkeys/cred-1", headers });
    expect(del.json()).toMatchObject([{ id: "cred-2" }]);
    const last = await app.inject({ method: "DELETE", url: "/api/me/passkeys/cred-2", headers });
    expect(last.statusCode).toBe(400);
  });

  it("fremde Passkeys sind weder sichtbar noch löschbar", async () => {
    const { invite } = ownerWithInvite();
    await registerWithInvite(invite.code, "e@elma.test", "cred-1");
    const owner = repo.userByEmail("erzeuger@elma.test")!;
    const headers = { authorization: `Bearer ${app.jwt.sign({ sub: owner.id })}` };
    expect((await app.inject({ url: "/api/me/passkeys", headers })).json()).toEqual([]);
    expect((await app.inject({ method: "DELETE", url: "/api/me/passkeys/cred-1", headers })).statusCode).toBe(404);
  });

  it("die Challenge eines anderen Users wird nicht angenommen", async () => {
    const a = repo.createUser("a@elma.test");
    const b = repo.createUser("b@elma.test");
    const start = await post("/api/me/passkeys/options", {}, { authorization: `Bearer ${app.jwt.sign({ sub: a.id })}` });
    deviceRegisters("cred-x");
    const res = await post(
      "/api/me/passkeys",
      { challengeId: start.json().challengeId, response: { id: "cred-x" } },
      { authorization: `Bearer ${app.jwt.sign({ sub: b.id })}` },
    );
    expect(res.statusCode).toBe(400);
  });
});

describe("Rate-Limit", () => {
  const options = (headers: Record<string, string>) =>
    app.inject({ method: "POST", url: "/api/auth/passkey/login/options", payload: {}, headers });

  it("zählt pro CF-Connecting-IP, gefälschtes X-Forwarded-For hilft nicht", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await options({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": `198.51.100.${i}` });
      expect(res.statusCode).toBe(200);
    }
    expect((await options({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.99" })).statusCode).toBe(429);
    // andere echte Adresse hat ihr eigenes Kontingent
    expect((await options({ "cf-connecting-ip": "203.0.113.8" })).statusCode).toBe(200);
  });

  it("clientIp nimmt CF-Connecting-IP nur, wenn es eine gültige Adresse ist", () => {
    const req = (headers: Record<string, string>) => ({ headers, ip: "10.0.0.5" }) as never;
    expect(clientIp(req({ "cf-connecting-ip": "2001:db8::1" }))).toBe("2001:db8::1");
    expect(clientIp(req({ "cf-connecting-ip": "kein-ip" }))).toBe("10.0.0.5");
    expect(clientIp(req({}))).toBe("10.0.0.5");
  });
});

describe("Hilfsfunktionen", () => {
  it("alte Passwort-Hashes werden beim Start gelöscht", () => {
    const dir = mkdtempSync(join(tmpdir(), "elma-"));
    try {
      const path = join(dir, "elma.db");
      const before = openDb(path);
      before.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES ('u1', 'alt@elma.test', 'scrypt:aa:bb', 0)").run();
      before.close();
      const after = openDb(path);
      expect(after.prepare("SELECT password_hash FROM users WHERE id = 'u1'").get()).toEqual({ password_hash: "passkey-only" });
      after.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ChallengeStore: bei voller Liste fliegt die älteste Challenge raus", () => {
    const store = new ChallengeStore(3);
    const ids = ["a", "b", "c", "d"].map((c, i) => store.add(c, { kind: "login" }, i));
    expect(store.size).toBe(3);
    expect(store.take(ids[0]!, 10)).toBeUndefined();
    expect(store.take(ids[3]!, 10)?.challenge).toBe("d");
  });

  it("ChallengeStore: einmal verwendbar, läuft nach 5 Minuten ab", () => {
    const store = new ChallengeStore();
    const id = store.add("c1", { kind: "login" }, 0);
    expect(store.take(id, 1000)?.challenge).toBe("c1");
    expect(store.take(id, 1000)).toBeUndefined();
    const old = store.add("c2", { kind: "login" }, 0);
    expect(store.take(old, 5 * 60 * 1000)).toBeUndefined();
  });

  it("deviceName erkennt gängige Geräte", () => {
    expect(deviceName(IPHONE)).toBe("iPhone");
    expect(deviceName("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("Android");
    expect(deviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("Mac");
    expect(deviceName(undefined)).toBe("Passkey");
  });
});
