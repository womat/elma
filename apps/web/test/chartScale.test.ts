import { describe, expect, it } from "vitest";
import { niceScale } from "../src/chartScale.ts";

describe("niceScale", () => {
  it.each([
    [0, 100],
    [80, 100],
    [100, 100],
    [130, 150],
    [1380, 1500],
    [2100, 3000],
    [2500, 3000],
    [2600, 3000],
    [3500, 4000],
    [9200, 10000],
  ])("%d W -> %d W", (input, max) => {
    expect(niceScale(input).max).toBe(max);
  });

  it("liefert die Teilstriche 0, Hälfte und Maximum", () => {
    expect(niceScale(1380).ticks).toEqual([0, 750, 1500]);
  });

  it("die Mittellinie ist immer mit höchstens einer Nachkommastelle in kW darstellbar", () => {
    for (let w = 0; w <= 50_000; w += 37) {
      const half = niceScale(w).ticks[1]!;
      const kw = half / 1000;
      expect(half < 1000 || Math.round(kw * 10) / 10 === kw, `${w} W -> ${half}`).toBe(true);
    }
  });
});
