import { describe, expect, it } from "vitest";
import { isPushHost, PushSubscriptionBody } from "../src/index.ts";

describe("isPushHost", () => {
  it("erkennt die Push-Dienste der Browser", () => {
    expect(isPushHost("fcm.googleapis.com")).toBe(true);
    expect(isPushHost("web.push.apple.com")).toBe(true);
    expect(isPushHost("updates.push.services.mozilla.com")).toBe(true);
    expect(isPushHost("wns2-par02p.notify.windows.com")).toBe(true);
    expect(isPushHost("FCM.googleapis.com.")).toBe(true);
  });

  it("lehnt alles andere ab", () => {
    expect(isPushHost("fcm.googleapis.com.evil.example")).toBe(false);
    expect(isPushHost("evilfcm.googleapis.com")).toBe(false);
    expect(isPushHost("192.168.65.42")).toBe(false);
    expect(isPushHost("::1")).toBe(false);
    expect(isPushHost("")).toBe(false);
  });
});

describe("PushSubscriptionBody", () => {
  const keys = { p256dh: "x", auth: "y" };

  it("nimmt echte Abos an", () => {
    expect(PushSubscriptionBody.safeParse({ endpoint: "https://web.push.apple.com/abc", keys }).success).toBe(true);
  });

  it("lehnt Adressen im LAN und unverschlüsselte ab", () => {
    expect(PushSubscriptionBody.safeParse({ endpoint: "http://192.168.65.42:8086/write?db=pv", keys }).success).toBe(false);
    expect(PushSubscriptionBody.safeParse({ endpoint: "http://fcm.googleapis.com/fcm/send/1", keys }).success).toBe(false);
  });
});
