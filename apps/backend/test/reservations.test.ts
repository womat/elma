import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PushPayload } from "@elma/shared";
import { buildApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { Repo } from "../src/repo.ts";
import { formatTime, ReservationError, ReservationService, viennaDayStart } from "../src/reservations.ts";

const MIN = 60_000;
/** Dienstag, 21.10.2026, 13:52 in Wien (Sommerzeit, UTC+2) */
const T0 = Date.UTC(2026, 9, 21, 11, 52);

let repo: Repo;
let service: ReservationService;
let pushes: { userIds: string[]; payload: PushPayload }[];
let ownerId: string;
let elisaId: string;
let producerId: string;

const idle = { compressorRunning: false, wallboxCharging: false, wallboxManual: false };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(T0);
  repo = new Repo(openDb(":memory:"));
  pushes = [];
  service = new ReservationService(repo, { notifyUsers: async (userIds, payload) => void pushes.push({ userIds, payload }) });
  const owner = repo.createUser("wolfgang@elma.test");
  repo.setDisplayName(owner.id, "Wolfgang");
  ownerId = owner.id;
  producerId = repo.createProducer("PV Dach", ownerId).producer.id;
  const elisa = repo.createUser("elisa@elma.test");
  repo.setDisplayName(elisa.id, "Elisa");
  elisaId = elisa.id;
  repo.acceptInvite(repo.createInvite(producerId).code, elisaId);
  repo.setCanReserve(producerId, elisaId, true);
});

afterEach(() => {
  service.stop();
  vi.useRealTimers();
});

/** Erwartet, dass fn mit diesem Status und (Teil-)Text abgelehnt wird. */
function rejects(fn: () => unknown, status: number, text?: string) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ReservationError);
    expect((err as ReservationError).status).toBe(status);
    if (text) expect((err as Error).message).toContain(text);
    return;
  }
  throw new Error("wurde nicht abgelehnt");
}

const left = (userId = elisaId) => service.stateFor(producerId, userId).minutesLeft;

describe("Recht und Grenzen", () => {
  it("ohne Recht 403, auch für den Erzeuger selbst", () => {
    repo.setCanReserve(producerId, elisaId, false);
    rejects(() => service.reserve(producerId, elisaId, 30), 403);
    rejects(() => service.reserve(producerId, ownerId, 30), 403);
  });

  it("ein zweiter Berechtigter bekommt 409 mit Name und Endzeit", () => {
    const anna = repo.createUser("anna@elma.test");
    repo.acceptInvite(repo.createInvite(producerId).code, anna.id);
    repo.setCanReserve(producerId, anna.id, true);
    service.reserve(producerId, elisaId, 30);
    rejects(() => service.reserve(producerId, anna.id, 15), 409, `Gerade reserviert von Elisa bis ${formatTime(T0 + 30 * MIN)}`);
    // Anna sieht die Reservierung, aber nicht als ihre
    expect(service.stateFor(producerId, anna.id).active).toMatchObject({ userName: "Elisa", mine: false });
    rejects(() => service.end(producerId, anna.id), 403);
  });
});

describe("Budget", () => {
  it("2× 30 min gehen, danach ist Schluss", () => {
    service.reserve(producerId, elisaId, 30);
    vi.advanceTimersByTime(30 * MIN);
    expect(left()).toBe(30);
    service.reserve(producerId, elisaId, 30);
    vi.advanceTimersByTime(30 * MIN);
    expect(left()).toBe(0);
    rejects(() => service.reserve(producerId, elisaId, 15), 409, "Heute schon 60 min reserviert, morgen wieder");
  });

  it("zählt nur die genutzte Zeit: nach 10 von 30 min beendet bleiben 50", () => {
    service.reserve(producerId, elisaId, 30);
    // während sie läuft, zählt die ganze geplante Dauer
    expect(left()).toBe(30);
    vi.advanceTimersByTime(10 * MIN);
    service.end(producerId, elisaId);
    expect(left()).toBe(50);
    rejects(() => service.reserve(producerId, elisaId, 60), 409, "nur noch 50 min");
  });

  it("ab Mitternacht in Wien gibt es wieder 60 min", () => {
    // 23:30 Wiener Zeit = 21:30 UTC
    vi.setSystemTime(Date.UTC(2026, 9, 21, 21, 30));
    service.reserve(producerId, elisaId, 60);
    vi.advanceTimersByTime(25 * MIN); // 23:55
    service.end(producerId, elisaId);
    expect(left()).toBe(35);
    vi.advanceTimersByTime(10 * MIN); // 00:05 Wiener Zeit, in UTC noch derselbe Tag
    expect(left()).toBe(60);
  });

  it("Mitternacht in Wien stimmt auch in der Winterzeit und über die Umstellung", () => {
    expect(viennaDayStart(Date.UTC(2026, 9, 21, 11, 52))).toBe(Date.UTC(2026, 9, 20, 22, 0));
    expect(viennaDayStart(Date.UTC(2026, 11, 24, 23, 30))).toBe(Date.UTC(2026, 11, 24, 23, 0));
    expect(viennaDayStart(Date.UTC(2026, 11, 24, 22, 59))).toBe(Date.UTC(2026, 11, 23, 23, 0));
    // Sonntag 25.10.2026: Umstellung auf Winterzeit, Mitternacht war noch Sommerzeit
    expect(viennaDayStart(Date.UTC(2026, 9, 25, 12, 0))).toBe(Date.UTC(2026, 9, 24, 22, 0));
  });
});

describe("Ablehnung nach dem Status von Node-RED", () => {
  it("laufender Kompressor oder ladendes Auto: 409, ohne Budget zu verbrauchen", () => {
    service.reportStatus(producerId, { ...idle, compressorRunning: true });
    expect(service.stateFor(producerId, elisaId)).toMatchObject({ controlConnected: true, blockedReason: "heatpump" });
    rejects(() => service.reserve(producerId, elisaId, 30), 409, "Wärmepumpe läuft");

    service.reportStatus(producerId, { ...idle, wallboxCharging: true });
    rejects(() => service.reserve(producerId, elisaId, 30), 409, "das Auto lädt");
    expect(left()).toBe(60);
  });

  it("ein veralteter Status lehnt nicht ab, und controlConnected fällt nach 60 s", () => {
    service.reportStatus(producerId, { ...idle, compressorRunning: true });
    const changes: string[] = [];
    service.subscribe((id) => changes.push(id));
    vi.advanceTimersByTime(60_000);
    expect(changes).toEqual([producerId]);
    expect(service.stateFor(producerId, elisaId)).toMatchObject({ controlConnected: false, blockedReason: null });
    service.reserve(producerId, elisaId, 15);
  });
});

describe("Ende", () => {
  it("eine beginnende Ladung beendet die Reservierung, mit Push an beide", async () => {
    service.reserve(producerId, elisaId, 30);
    vi.advanceTimersByTime(20 * MIN);
    expect(service.reportStatus(producerId, idle)).toEqual({ active: true, until: T0 + 30 * MIN, by: "Elisa" });
    expect(service.reportStatus(producerId, { ...idle, wallboxCharging: true })).toEqual({ active: false, until: null });
    await service.settled();
    const ends = pushes.filter((p) => p.payload.title.startsWith("⚡"));
    expect(ends.map((p) => p.userIds).flat().sort()).toEqual([elisaId, ownerId].sort());
    expect(ends.find((p) => p.userIds[0] === elisaId)!.payload).toMatchObject({
      title: "⚡ Das Auto lädt, Reservierung beendet",
      body: "Heute noch 40 min übrig",
    });
    expect(left()).toBe(40);
  });

  it("Entzug des Rechts beendet sie sofort, mit Push an beide", async () => {
    service.reserve(producerId, elisaId, 30);
    vi.advanceTimersByTime(5 * MIN);
    service.setCanReserve(producerId, elisaId, false);
    await service.settled();
    expect(service.stateFor(producerId, elisaId)).toMatchObject({ active: null, canReserve: false });
    const ends = pushes.filter((p) => p.payload.title === "🔓 ELISA-Modus beendet");
    expect(ends.map((p) => p.userIds).flat().sort()).toEqual([elisaId, ownerId].sort());
  });

  it("läuft automatisch ab", async () => {
    service.reserve(producerId, elisaId, 15);
    vi.advanceTimersByTime(15 * MIN - 1);
    expect(service.stateFor(producerId, elisaId).active).not.toBeNull();
    vi.advanceTimersByTime(1);
    await service.settled();
    expect(service.stateFor(producerId, elisaId).active).toBeNull();
    expect(pushes.at(-1)!.payload.title).toBe("🔓 ELISA-Modus zu Ende");
    expect(left()).toBe(45);
  });

  it("der Erzeuger kann beenden, andere nicht", async () => {
    service.reserve(producerId, elisaId, 30);
    service.end(producerId, ownerId);
    await service.settled();
    expect(pushes.at(-1)!.payload.title).toBe("🔓 Wolfgang hat den ELISA-Modus beendet");
    rejects(() => service.end(producerId, ownerId), 404);
  });

  it("nach einem Neustart läuft der Timer weiter; Abgelaufenes endet ohne Push", async () => {
    service.reserve(producerId, elisaId, 30);
    service.stop();
    const restarted = new ReservationService(repo, { notifyUsers: async (userIds, payload) => void pushes.push({ userIds, payload }) });
    restarted.start();
    vi.advanceTimersByTime(30 * MIN);
    await restarted.settled();
    expect(restarted.stateFor(producerId, elisaId).active).toBeNull();
    expect(pushes.at(-1)!.payload.title).toBe("🔓 ELISA-Modus zu Ende");

    restarted.reserve(producerId, elisaId, 15);
    restarted.stop();
    const count = pushes.length;
    vi.setSystemTime(Date.now() + 20 * MIN);
    const late = new ReservationService(repo, { notifyUsers: async (userIds, payload) => void pushes.push({ userIds, payload }) });
    late.start();
    expect(late.stateFor(producerId, elisaId)).toMatchObject({ active: null, minutesLeft: 15 });
    expect(pushes).toHaveLength(count);
  });
});

describe("Push beim Start", () => {
  it("geht nur an den Erzeuger, mit Name und Endzeit", async () => {
    service.reserve(producerId, elisaId, 30);
    await service.settled();
    expect(pushes).toEqual([
      {
        userIds: [ownerId],
        payload: {
          title: "🔒 Elisa reserviert den Überschuss",
          body: `bis ${formatTime(T0 + 30 * MIN)} – keine großen Verbraucher einschalten`,
          tag: "elma-reservation",
          url: "/",
        },
      },
    ]);
    expect(formatTime(T0 + 30 * MIN)).toBe("14:22");
  });
});

describe("HTTP", () => {
  it("prüft die Dauer, das Recht und wer beenden darf", async () => {
    vi.useRealTimers();
    const built = await buildApp({ db: openDb(":memory:"), jwtSecret: "x".repeat(32), publicUrl: "https://elma.test", pushSender: async () => {} });
    const r = built.repo;
    const owner = r.createUser("wolfgang@elma.test");
    const { producer } = r.createProducer("PV Dach", owner.id);
    const elisa = r.createUser("elisa@elma.test");
    r.acceptInvite(r.createInvite(producer.id).code, elisa.id);
    r.createUser("fremd@elma.test");
    const auth = (id: string) => ({ authorization: `Bearer ${built.app.jwt.sign({ sub: id })}` });
    const reserve = (id: string, payload: unknown) =>
      built.app.inject({ method: "POST", url: `/api/producers/${producer.id}/reservation`, headers: auth(id), payload: payload as object });

    expect((await reserve(elisa.id, { minutes: 30 })).statusCode).toBe(403);
    r.setCanReserve(producer.id, elisa.id, true);
    expect((await reserve(elisa.id, { minutes: 61 })).statusCode).toBe(400);
    expect((await reserve(elisa.id, { minutes: 0 })).statusCode).toBe(400);
    expect((await reserve(r.userByEmail("fremd@elma.test")!.id, { minutes: 30 })).statusCode).toBe(404);

    const ok = await reserve(elisa.id, { minutes: 30 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ active: { mine: true, userName: "elisa" }, minutesLeft: 30, controlConnected: false });
    expect((await reserve(elisa.id, { minutes: 15 })).statusCode).toBe(409);

    const list = await built.app.inject({ url: "/api/producers", headers: auth(owner.id) });
    expect(list.json()[0]).toMatchObject({ ownerName: "wolfgang", reservation: { active: { mine: false }, canReserve: false } });

    const end = await built.app.inject({ method: "DELETE", url: `/api/producers/${producer.id}/reservation`, headers: auth(owner.id) });
    expect(end.statusCode).toBe(200);
    expect(end.json().active).toBeNull();
    await built.app.close();
  });
});
