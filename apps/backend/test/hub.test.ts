import { describe, expect, it } from "vitest";
import type { SurplusReading } from "@elma/shared";
import { LiveHub } from "../src/hub.ts";
import { openDb } from "../src/db.ts";
import { Repo } from "../src/repo.ts";

const S = 1000;
const T0 = 1_800_000_000_000;

/** Schickt Rohwerte [Sekunde, Watt] durch einen Hub und liefert die geglätteten Werte. */
async function run(samples: [number, number][], windowMs = 120 * S): Promise<number[]> {
  const repo = new Repo(openDb(":memory:"));
  const owner = await repo.createUser("a@elma.test", "passwort123");
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

  it("Fenster 0 schaltet die Glättung ab", async () => {
    expect(await run([[0, 0], [5, 680], [10, 0]], 0)).toEqual([0, 680, 0]);
  });
});
