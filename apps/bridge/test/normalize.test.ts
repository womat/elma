import { describe, expect, it } from "vitest";
import { normalizePayload } from "../src/normalize.ts";
import { Throttle } from "../src/throttle.ts";

const base = { payloadPath: undefined, payloadUnit: "W" as const, payloadInvert: false };

describe("normalizePayload", () => {
  it("liest reine Zahlen", () => {
    expect(normalizePayload("1234", base)).toBe(1234);
    expect(normalizePayload(" 12,6 ", base)).toBe(13);
  });
  it("rechnet kW in W um und invertiert", () => {
    expect(normalizePayload("-2.5", { ...base, payloadUnit: "kW", payloadInvert: true })).toBe(2500);
  });
  it("liest JSON-Pfade", () => {
    const opts = { ...base, payloadPath: "data.surplus" };
    expect(normalizePayload('{"data":{"surplus":"800"}}', opts)).toBe(800);
    expect(normalizePayload('{"data":{}}', opts)).toBeNull();
    expect(normalizePayload("kein json", opts)).toBeNull();
  });
  it("lehnt Nicht-Zahlen ab", () => {
    expect(normalizePayload("", base)).toBeNull();
    expect(normalizePayload("abc", base)).toBeNull();
  });
});

describe("Throttle", () => {
  it("sendet den ersten Wert, große Sprünge sofort, sonst im Intervall", () => {
    const t = new Throttle(5000, 50);
    expect(t.shouldSend(100, 0)).toBe(true);
    t.markSent(100, 0);
    expect(t.shouldSend(120, 1000)).toBe(false);
    expect(t.shouldSend(200, 1000)).toBe(true);
    expect(t.shouldSend(120, 5000)).toBe(true);
  });
});
