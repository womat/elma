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

describe("RESERVATION_TOPIC", () => {
  const env = { MQTT_URL: "mqtt://x", MQTT_TOPIC: "t", BACKEND_URL: "ws://b", DEVICE_TOKEN: "d" };
  it("hat einen Standard, auch wenn die Variable leer ist", () => {
    expect(loadConfig(env).reservationTopic).toBe("elma/reservation");
    expect(loadConfig({ ...env, RESERVATION_TOPIC: "" }).reservationTopic).toBe("elma/reservation");
    expect(loadConfig({ ...env, RESERVATION_TOPIC: "haus2/elma/reservation" }).reservationTopic).toBe("haus2/elma/reservation");
  });
});
