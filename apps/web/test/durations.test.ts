import { describe, expect, it } from "vitest";
import { durationsFor } from "../src/durations.ts";

describe("Dauer-Chips", () => {
  it("zeigt sonst immer 15/30/45/60, auch wenn nicht alle ins Budget passen", () => {
    expect(durationsFor(60)).toEqual([15, 30, 45, 60]);
    expect(durationsFor(50)).toEqual([15, 30, 45, 60]);
    expect(durationsFor(15)).toEqual([15, 30, 45, 60]);
    expect(durationsFor(0)).toEqual([15, 30, 45, 60]);
  });

  it("bietet einen Rest unter 15 min an Stelle von 15 min an", () => {
    expect(durationsFor(10)).toEqual([10, 30, 45, 60]);
    expect(durationsFor(1)).toEqual([1, 30, 45, 60]);
  });
});
