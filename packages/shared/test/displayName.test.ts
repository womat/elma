import { describe, expect, it } from "vitest";
import { DisplayNameBody, displayNameOf } from "../src/index.ts";

describe("displayNameOf", () => {
  it("nimmt den Anzeigenamen, sonst den Teil der E-Mail vor dem @", () => {
    expect(displayNameOf({ displayName: "Elisa", email: "e.m@example.com" })).toBe("Elisa");
    expect(displayNameOf({ displayName: null, email: "e.m@example.com" })).toBe("e.m");
  });
});

describe("DisplayNameBody", () => {
  it("trimmt und erlaubt null zum Löschen", () => {
    expect(DisplayNameBody.parse({ displayName: " Elisa " })).toEqual({ displayName: "Elisa" });
    expect(DisplayNameBody.parse({ displayName: null })).toEqual({ displayName: null });
    expect(DisplayNameBody.safeParse({ displayName: " " }).success).toBe(false);
  });
});
