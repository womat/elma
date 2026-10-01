import { describe, expect, it } from "vitest";
import { redactUrl } from "../src/app.ts";
import { parseShellyFrame } from "../src/shelly.ts";

// Aufbau wie vom Shelly Pro 3EM über Outbound WebSocket gesendet
const notify = (em: Record<string, unknown>, method = "NotifyStatus") =>
  JSON.stringify({ src: "shellypro3em-abc123", dst: "ws", method, params: { ts: 1759320000.12, "em:0": em } });

describe("parseShellyFrame", () => {
  it("Einspeisung wird zu positivem Überschuss", () => {
    expect(parseShellyFrame(notify({ id: 0, total_act_power: -1840.4 }))).toBe(1840);
  });

  it("Netzbezug wird negativ", () => {
    expect(parseShellyFrame(notify({ id: 0, total_act_power: 312.6 }, "NotifyFullStatus"))).toBe(-313);
  });

  it("ohne Gesamtwert werden die Phasen summiert", () => {
    expect(parseShellyFrame(notify({ id: 0, a_act_power: -500, b_act_power: -400, c_act_power: 100 }))).toBe(800);
  });

  it("ignoriert andere Nachrichten und kaputte Daten", () => {
    expect(parseShellyFrame(notify({ id: 0, a_act_power: -500 }))).toBeNull();
    expect(parseShellyFrame(JSON.stringify({ method: "NotifyEvent", params: { events: [] } }))).toBeNull();
    expect(parseShellyFrame(JSON.stringify({ method: "NotifyStatus", params: { "switch:0": { apower: 5 } } }))).toBeNull();
    expect(parseShellyFrame("kein json")).toBeNull();
    expect(parseShellyFrame(notify({ total_act_power: 0 }))).toBe(0);
    expect(Object.is(parseShellyFrame(notify({ total_act_power: 0.2 })), -0)).toBe(false);
  });
});

describe("redactUrl", () => {
  it("entfernt das Token aus dem Shelly-Pfad", () => {
    expect(redactUrl("/ingest/shelly/geheim123")).toBe("/ingest/shelly/***");
    expect(redactUrl("/ingest/shelly/geheim123?x=1")).toBe("/ingest/shelly/***?x=1");
    expect(redactUrl("/api/producers")).toBe("/api/producers");
  });
});
