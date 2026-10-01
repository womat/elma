import { describe, expect, it } from "vitest";
import { CATALOG, type Appliance } from "@elma/shared";
import { bestSpan, bucketByHour, levelFor } from "../src/timeline.ts";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 1, 14, 30); // 14:30 UTC
const pick = (...ids: string[]): Appliance[] => CATALOG.filter((a) => ids.includes(a.id));
const mine = pick("tv", "washer", "kettle"); // 100 W, 500 W, 2000 W

describe("levelFor", () => {
  it("passt die Stufe an die eigenen Geräte an", () => {
    expect(levelFor(50, mine)).toEqual({ level: "none", biggest: null });
    expect(levelFor(600, mine).level).toBe("some");
    expect(levelFor(600, mine).biggest?.id).toBe("washer");
    expect(levelFor(2100, mine).level).toBe("lots");
    // ohne großes Gerät bleibt auch viel Überschuss "ein wenig"
    expect(levelFor(5000, pick("tv", "washer")).level).toBe("some");
  });
});

describe("bucketByHour", () => {
  it("liefert 24 Stunden bis zur laufenden und mittelt je Stunde", () => {
    const thisHour = Math.floor(NOW / HOUR) * HOUR;
    const points = [
      { t: thisHour - 2 * HOUR, watts: 400 },
      { t: thisHour - 2 * HOUR + 60_000, watts: 800 },
      { t: thisHour, watts: 2500 },
      { t: thisHour - 30 * HOUR, watts: 9999 }, // zu alt
    ];
    const buckets = bucketByHour(points, NOW, mine);
    expect(buckets).toHaveLength(24);
    expect(buckets.at(-1)).toMatchObject({ start: thisHour, watts: 2500, level: "lots" });
    expect(buckets.at(-3)).toMatchObject({ watts: 600, level: "some" });
    expect(buckets.at(-2)).toMatchObject({ watts: null, level: null });
    expect(buckets.filter((b) => b.watts !== null)).toHaveLength(2);
  });
});

describe("bestSpan", () => {
  it("findet die längste Spanne der höchsten Stufe", () => {
    const thisHour = Math.floor(NOW / HOUR) * HOUR;
    const at = (h: number, watts: number) => ({ t: thisHour - h * HOUR, watts });
    // vor 6 h: viel; vor 4-2 h: viel (3 Stunden am Stück); vor 1 h: wenig
    const buckets = bucketByHour([at(6, 2500), at(4, 2500), at(3, 2200), at(2, 2100), at(1, 600)], NOW, mine);
    expect(bestSpan(buckets)).toEqual({ from: thisHour - 4 * HOUR, to: thisHour - 1 * HOUR, level: "lots" });
  });

  it("liefert null, wenn nie ein Gerät ging", () => {
    expect(bestSpan(bucketByHour([{ t: NOW, watts: 10 }], NOW, mine))).toBeNull();
  });
});
