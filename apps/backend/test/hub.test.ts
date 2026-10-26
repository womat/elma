import { describe, expect, it } from "vitest";
import { BATTERY_STALE_MS, type BatteryReading, type LiveReading, type SurplusReading } from "@elma/shared";
import { LiveHub } from "../src/hub.ts";
import { openDb } from "../src/db.ts";
import { Repo } from "../src/repo.ts";

const S = 1000;
const T0 = 1_800_000_000_000;

/** Schickt Rohwerte [Sekunde, Watt] durch einen Hub und liefert die geglätteten Werte. */
async function run(samples: [number, number][], windowMs = 120 * S): Promise<number[]> {
  const repo = new Repo(openDb(":memory:"));
  const owner = repo.createUser("a@elma.test");
  const { producer } = repo.createProducer("P", owner.id);
  const hub = new LiveHub(repo, windowMs);
  const out: number[] = [];
  hub.subscribe((_id, r: SurplusReading) => out.push(r.watts));
  for (const [sec, watts] of samples) hub.publish(producer.id, { watts, timestamp: T0 + sec * S });
  return out;
}

describe("Glättung", () => {
  it("ein konstanter Wert bleibt konstant", async () => {
    expect(await run([[0, 500], [5, 500], [10, 500], [15, 500]])).toEqual([500, 500, 500, 500]);
  });

  it("eine kurze Spitze bewegt das 2-Minuten-Mittel kaum", async () => {
    // 2 min lang 0 W alle 5 s, dann 5 s lang 680 W, dann wieder 0
    const samples: [number, number][] = [];
    for (let s = 0; s <= 120; s += 5) samples.push([s, 0]);
    samples.push([125, 680], [130, 0], [135, 0]);
    const out = await run(samples);
    expect(Math.max(...out)).toBeLessThanOrEqual(30); // 680 W * 5 s / 120 s ≈ 28 W
    expect(out.at(-1)).toBe(28);
  });

  it("gewichtet nach Dauer, nicht nach Anzahl der Werte", async () => {
    // 100 s lang 1000 W, dann viele schnelle Werte mit 0 W innerhalb von 20 s
    const samples: [number, number][] = [[0, 1000]];
    for (let s = 100; s <= 120; s += 1) samples.push([s, 0]);
    // 100 s * 1000 W + 20 s * 0 W über 120 s
    expect((await run(samples)).at(-1)).toBe(Math.round((100 * 1000) / 120));
  });

  it("vergisst Werte, die älter als das Fenster sind", async () => {
    const samples: [number, number][] = [[0, 2000]];
    for (let s = 10; s <= 300; s += 10) samples.push([s, 100]);
    expect((await run(samples)).at(-1)).toBe(100);
  });

  it("beginnt nach einer langen Lücke neu", async () => {
    expect((await run([[0, 2000], [5, 2000], [600, 300]])).at(-1)).toBe(300);
  });

  it("beginnt neu, wenn die Zeit rückwärts läuft (z. B. Uhr der Bridge gestellt)", async () => {
    expect((await run([[0, 2000], [5, 2000], [10, 2000], [3, 300]])).at(-1)).toBe(300);
  });

  it("Fenster 0 schaltet die Glättung ab", async () => {
    expect(await run([[0, 0], [5, 680], [10, 0]], 0)).toEqual([0, 680, 0]);
  });
});

/** Wie run, liefert aber die ganzen verteilten Werte (mit stable und battery). */
function runFull(samples: [number, number][], windowMs = 120 * S, battery?: BatteryReading): LiveReading[] {
  const repo = new Repo(openDb(":memory:"));
  const owner = repo.createUser("a@elma.test");
  const { producer } = repo.createProducer("P", owner.id);
  const hub = new LiveHub(repo, windowMs);
  const out: LiveReading[] = [];
  hub.subscribe((_id, r) => out.push(r));
  if (battery) hub.publishBattery(producer.id, battery);
  for (const [sec, watts] of samples) hub.publish(producer.id, { watts, timestamp: T0 + sec * S });
  return out;
}

function every(seconds: number, step: number, watts: (s: number) => number): [number, number][] {
  const samples: [number, number][] = [];
  for (let s = 0; s <= seconds; s += step) samples.push([s, watts(s)]);
  return samples;
}

describe("Stabilitätsampel", () => {
  it("ein gleichmäßiger Wert ist stabil", () => {
    expect(runFull(every(120, 5, () => 1000)).at(-1)!.stable).toBe(true);
  });

  it("ein Wert, der zwischen 0 und 4000 W springt, schwankt", () => {
    const last = runFull(every(120, 10, (s) => (s % 20 === 0 ? 4000 : 0))).at(-1)!;
    expect(last.watts).toBeGreaterThan(1500);
    expect(last.stable).toBe(false);
  });

  it("kurze Einbrüche unter 20 % der Zeit lassen ihn stabil", () => {
    // alle 60 s für 10 s auf 0 W: 1/6 der Zeit
    expect(runFull(every(120, 10, (s) => (s % 60 === 50 ? 0 : 2000))).at(-1)!.stable).toBe(true);
  });

  it("ohne Überschuss gibt es keine Ampel", () => {
    expect(runFull(every(120, 5, () => 30)).at(-1)!.stable).toBeUndefined();
  });

  it("deckt die Historie nicht das ganze Fenster ab, gibt es keine Ampel", () => {
    expect(runFull(every(110, 5, () => 1000)).at(-1)!.stable).toBeUndefined();
    expect(runFull(every(120, 5, () => 1000)).at(-1)!.stable).toBe(true);
  });

  it("ist die Spitze gerade vorbei, schwankt er, auch wenn sie den Großteil des Fensters ausmachte", () => {
    const samples = every(120, 5, (s) => (s < 100 ? 2000 : 0));
    // 100 von 120 s über 70 % des Mittels, aber der aktuelle Wert ist 0
    expect(runFull(samples).at(-1)!.stable).toBe(false);
  });

  it("Fenster 0 schaltet auch die Ampel ab", () => {
    expect(runFull(every(120, 5, () => 1000), 0).at(-1)).toEqual({ watts: 1000, timestamp: T0 + 120 * S });
  });
});

describe("Akku", () => {
  const battery = { watts: 1200, soc: 92, timestamp: T0 };

  it("der letzte Akkuwert geht mit dem nächsten Überschusswert hinaus", () => {
    expect(runFull([[5, 800]], 0, battery).at(-1)!.battery).toEqual(battery);
  });

  it("ein veralteter Akkuwert wird weggelassen", () => {
    const late = BATTERY_STALE_MS / S + 1;
    const out = runFull([[late - 2, 800], [late, 800]], 0, battery);
    expect(out[0]!.battery).toEqual(battery);
    expect(out[1]!.battery).toBeUndefined();
  });
});
