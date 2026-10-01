import { describe, expect, it } from "vitest";
import { CATALOG } from "@elma/shared";
import { suggestIcon } from "../src/iconSuggest.ts";
import { ICON_GROUPS, ICONS, LEGACY_EMOJI, iconTone, resolveIcon } from "../src/icons.tsx";

describe("suggestIcon", () => {
  it.each([
    ["Poolpumpe", "waves-ladder"],
    ["Infrarotheizung", "heater"],
    ["Wärmepumpe", "heater"],
    ["Wallbox", "ev-charger"],
    ["Gefriertruhe Keller", "thermometer-snowflake"],
    ["Kühlschrank", "refrigerator"],
    ["Teichpumpe", "fish-symbol"],
    ["Handy laden", "smartphone"],
    ["Radio Küche", "radio"],
    ["E-Bike", "bike"],
    ["Wasserkocher", "cooking-pot"],
    ["Geschirrspüler", "bubbles"],
    ["Rasenmäher", "sprout"],
    ["Soundbar", "speaker"],
  ])("%s -> %s", (name, icon) => {
    expect(suggestIcon(name)).toBe(icon);
  });

  it("liefert null, wenn nichts passt", () => {
    expect(suggestIcon("Xyz")).toBeNull();
    expect(suggestIcon("   ")).toBeNull();
  });
});

describe("Icon-Registry", () => {
  it("jedes Icon der Auswahl, jeder Vorschlag und jedes Katalog-Gerät ist registriert", () => {
    for (const g of ICON_GROUPS) for (const i of g.icons) expect(ICONS[i], i).toBeDefined();
    for (const a of CATALOG) expect(ICONS[a.icon], a.id).toBeDefined();
    for (const name of ["Poolpumpe", "Wallbox", "Laptop", "Drucker", "Sauna", "Akku"]) {
      expect(ICONS[suggestIcon(name)!], name).toBeDefined();
    }
  });

  it("bildet alte Emojis auf Icons ab", () => {
    for (const [emoji, icon] of Object.entries(LEGACY_EMOJI)) {
      expect(ICONS[icon], emoji).toBeDefined();
      expect(resolveIcon(emoji)).toBe(icon);
    }
    expect(resolveIcon("🔥")).toBe("flame");
    expect(resolveIcon("washing-machine")).toBe("washing-machine");
    expect(resolveIcon("🦄")).toBeNull();
  });
});

describe("Farbtöne", () => {
  it("jedes Icon der Auswahl und jedes Katalog-Gerät hat eine Gruppenfarbe", () => {
    for (const g of ICON_GROUPS) for (const i of g.icons) expect(iconTone(i), i).toBe(g.tone);
    for (const a of CATALOG) expect(iconTone(a.icon), a.id).not.toBe("neutral");
  });

  it("alte Emojis bekommen die Farbe ihres neuen Icons, Unbekanntes bleibt neutral", () => {
    expect(iconTone("🔥")).toBe("climate");
    expect(iconTone("🏊")).toBe("climate");
    expect(iconTone("🦄")).toBe("neutral");
  });
});
