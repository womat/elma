import { describe, expect, it } from "vitest";
import { parseServerMessage, reservationPayload } from "../src/reservation.ts";
import { loadConfig } from "../src/config.ts";

describe("parseServerMessage", () => {
  it("liest Reservierung und Fehler des Backends", () => {
    expect(parseServerMessage('{"type":"reservation","until":1761136920000,"by":"Elisa"}')).toEqual({
      type: "reservation",
      until: 1761136920000,
      by: "Elisa",
    });
    expect(parseServerMessage('{"type":"reservation","until":null}')).toEqual({ type: "reservation", until: null });
    expect(parseServerMessage('{"type":"error","message":"Ungültige Nachricht"}')).toEqual({ type: "error", message: "Ungültige Nachricht" });
  });
  it("lehnt Unbekanntes und Kaputtes ab", () => {
    expect(parseServerMessage("kein json")).toBeNull();
    expect(parseServerMessage('{"type":"neu"}')).toBeNull();
    expect(parseServerMessage('{"type":"reservation","until":"bald"}')).toBeNull();
    expect(parseServerMessage('{"type":"reservation"}')).toBeNull();
  });
});

describe("reservationPayload", () => {
  it("baut die Payload für MAGGIE", () => {
    expect(JSON.parse(reservationPayload({ type: "reservation", until: 1761136920000, by: "Elisa" }))).toEqual({
      active: true,
      until: 1761136920000,
      by: "Elisa",
    });
    expect(JSON.parse(reservationPayload({ type: "reservation", until: null }))).toEqual({ active: false });
  });
});

const env = { MQTT_URL: "mqtt://x", MQTT_TOPIC: "t", BACKEND_URL: "ws://b", DEVICE_TOKEN: "d" };

describe("RESERVATION_TOPIC", () => {
  it("hat einen Standard, auch wenn die Variable leer ist", () => {
    expect(loadConfig(env).reservationTopic).toBe("elma/reservation");
    expect(loadConfig({ ...env, RESERVATION_TOPIC: "" }).reservationTopic).toBe("elma/reservation");
    expect(loadConfig({ ...env, RESERVATION_TOPIC: "haus2/elma/reservation" }).reservationTopic).toBe("haus2/elma/reservation");
  });
});

describe("Zahlen aus der Umgebung", () => {
  it("bricht bei Unsinn ab, statt mit NaN still nur noch bei Sprüngen zu senden", () => {
    expect(() => loadConfig({ ...env, MIN_INTERVAL_MS: "abc" })).toThrow(/MIN_INTERVAL_MS/);
    expect(() => loadConfig({ ...env, DELTA_WATTS: "-5" })).toThrow(/DELTA_WATTS/);
  });

  it("nimmt gültige Werte und bei leerer Variable den Standard", () => {
    expect(loadConfig({ ...env, MIN_INTERVAL_MS: "1000", DELTA_WATTS: "20" })).toMatchObject({ minIntervalMs: 1000, deltaWatts: 20 });
    expect(loadConfig({ ...env, MIN_INTERVAL_MS: "", DELTA_WATTS: " " })).toMatchObject({ minIntervalMs: 5000, deltaWatts: 50 });
  });
});
