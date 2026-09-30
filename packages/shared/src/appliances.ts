import type { ApplianceSettings } from "./index.ts";

export interface Appliance {
  id: string;
  icon: string;
  name: string;
  /** typische Leistung im Betrieb in Watt (Richtwerte) */
  watts: number;
}

/** Standard-Katalog mit Alltagsgeräten – aufsteigend nach Leistung sortiert. */
export const CATALOG: Appliance[] = [
  { id: "phone", icon: "📱", name: "Handy laden", watts: 15 },
  { id: "radio", icon: "📻", name: "Radio", watts: 20 },
  { id: "light", icon: "💡", name: "Licht (ganzes Haus)", watts: 60 },
  { id: "laptop", icon: "💻", name: "Laptop", watts: 65 },
  { id: "tv", icon: "📺", name: "Fernseher", watts: 100 },
  { id: "console", icon: "🎮", name: "Spielkonsole", watts: 180 },
  { id: "ebike", icon: "🚲", name: "E-Bike laden", watts: 250 },
  { id: "fridge", icon: "🧊", name: "Gefriertruhe", watts: 150 },
  { id: "washer", icon: "🧺", name: "Waschmaschine", watts: 500 },
  { id: "vacuum", icon: "🧹", name: "Staubsauger", watts: 700 },
  { id: "microwave", icon: "🍲", name: "Mikrowelle", watts: 800 },
  { id: "toaster", icon: "🍞", name: "Toaster", watts: 900 },
  { id: "coffee", icon: "☕", name: "Kaffeemaschine", watts: 1000 },
  { id: "dishwasher", icon: "🍽️", name: "Geschirrspüler", watts: 1200 },
  { id: "iron", icon: "👕", name: "Bügeln", watts: 1200 },
  { id: "hairdryer", icon: "💨", name: "Föhn", watts: 1500 },
  { id: "stove", icon: "🍳", name: "Kochen (1 Platte)", watts: 1500 },
  { id: "kettle", icon: "🫖", name: "Wasserkocher", watts: 2000 },
  { id: "dryer", icon: "🌀", name: "Wäschetrockner", watts: 2000 },
  { id: "oven", icon: "🥧", name: "Backofen", watts: 2500 },
  { id: "car", icon: "🚗", name: "E-Auto laden", watts: 3700 },
].sort((a, b) => a.watts - b.watts);

/** Vorauswahl, solange ein User noch nichts eingestellt hat. */
export const DEFAULT_SELECTED = ["phone", "radio", "tv", "laptop", "washer", "microwave", "coffee", "iron", "stove", "kettle"];

export function defaultSettings(): ApplianceSettings {
  return { selected: DEFAULT_SELECTED, custom: [], notify: [] };
}

/** Die Geräte, die ein User sehen will: ausgewählte Katalog-Geräte plus eigene, nach Leistung sortiert. */
export function resolveAppliances(settings: ApplianceSettings): Appliance[] {
  const selected = new Set(settings.selected);
  return [...CATALOG.filter((a) => selected.has(a.id)), ...settings.custom].sort((a, b) => a.watts - b.watts);
}

/** Die Geräte, für die ein User benachrichtigt werden will (nur solche, die er auch ausgewählt hat). */
export function notifyAppliances(settings: ApplianceSettings): Appliance[] {
  const notify = new Set(settings.notify);
  return resolveAppliances(settings).filter((a) => notify.has(a.id));
}

/** Das stärkste Gerät, das mit dem Überschuss betrieben werden kann. */
export function biggestFitting(watts: number, appliances: Appliance[]): Appliance | null {
  return appliances.findLast((a) => a.watts <= watts) ?? null;
}
