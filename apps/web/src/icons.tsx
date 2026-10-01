import {
  AirVent,
  Axe,
  Bath,
  BatteryCharging,
  Bike,
  Blender,
  Bubbles,
  Car,
  Caravan,
  Cctv,
  ChefHat,
  Coffee,
  CookingPot,
  Drill,
  Droplets,
  Dumbbell,
  EvCharger,
  Fan,
  FishSymbol,
  Flame,
  Gamepad2,
  Hammer,
  Headphones,
  Heater,
  House,
  Lamp,
  LampCeiling,
  LampFloor,
  Laptop,
  Lightbulb,
  Microwave,
  Monitor,
  Music,
  PaintRoller,
  Plug,
  PlugZap,
  Power,
  Printer,
  Projector,
  Radio,
  Refrigerator,
  RobotVacuum,
  Router,
  Sandwich,
  Scooter,
  Server,
  Shirt,
  ShowerHead,
  Smartphone,
  Snowflake,
  SolarPanel,
  Speaker,
  SprayCan,
  Sprout,
  TabletSmartphone,
  Thermometer,
  ThermometerSnowflake,
  Trees,
  Tv,
  Utensils,
  WashingMachine,
  WavesLadder,
  Wind,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

interface IconInfo {
  Icon: LucideIcon;
  /** deutscher Name, für Tooltip und Screenreader */
  label: string;
}

/** Gruppen für die Icon-Auswahl im Editor; die Schlüssel sind Lucide-Namen und werden so gespeichert. */
/** Farbton einer Gerätegruppe; die Farben stehen als --tone-* in styles.css. */
export type Tone = "kitchen" | "home" | "climate" | "media" | "garden" | "energy" | "neutral";

export const ICON_GROUPS: { title: string; tone: Tone; icons: string[] }[] = [
  { title: "Küche", tone: "kitchen", icons: ["refrigerator", "thermometer-snowflake", "microwave", "cooking-pot", "chef-hat", "coffee", "blender", "sandwich", "utensils"] },
  { title: "Haushalt & Wäsche", tone: "home", icons: ["washing-machine", "shirt", "robot-vacuum", "bubbles", "spray-can", "wind", "lamp", "lamp-ceiling", "lamp-floor", "lightbulb"] },
  { title: "Heizen, Kühlen & Wasser", tone: "climate", icons: ["heater", "flame", "thermometer", "air-vent", "fan", "snowflake", "shower-head", "bath", "droplets", "waves-ladder"] },
  { title: "Unterhaltung & Büro", tone: "media", icons: ["tv", "monitor", "laptop", "smartphone", "tablet-smartphone", "printer", "router", "server", "gamepad-2", "speaker", "radio", "headphones", "music", "projector", "cctv"] },
  { title: "Werkstatt & Garten", tone: "garden", icons: ["drill", "hammer", "wrench", "paint-roller", "axe", "sprout", "trees", "fish-symbol", "dumbbell"] },
  { title: "Mobilität & Energie", tone: "energy", icons: ["car", "ev-charger", "bike", "scooter", "caravan", "battery-charging", "solar-panel", "plug", "plug-zap", "zap", "power"] },
];

export const ICONS: Record<string, IconInfo> = {
  "refrigerator": { Icon: Refrigerator, label: "Kühlschrank" },
  "thermometer-snowflake": { Icon: ThermometerSnowflake, label: "Gefriertruhe" },
  "microwave": { Icon: Microwave, label: "Mikrowelle" },
  "cooking-pot": { Icon: CookingPot, label: "Herd / Kochen" },
  "chef-hat": { Icon: ChefHat, label: "Backofen" },
  "coffee": { Icon: Coffee, label: "Kaffeemaschine" },
  "blender": { Icon: Blender, label: "Mixer" },
  "sandwich": { Icon: Sandwich, label: "Toaster" },
  "utensils": { Icon: Utensils, label: "Küchengerät" },
  "washing-machine": { Icon: WashingMachine, label: "Waschmaschine / Trockner" },
  "shirt": { Icon: Shirt, label: "Bügeleisen" },
  "robot-vacuum": { Icon: RobotVacuum, label: "Staubsauger" },
  "bubbles": { Icon: Bubbles, label: "Geschirrspüler" },
  "spray-can": { Icon: SprayCan, label: "Reinigungsgerät" },
  "wind": { Icon: Wind, label: "Föhn" },
  "lamp": { Icon: Lamp, label: "Lampe" },
  "lamp-ceiling": { Icon: LampCeiling, label: "Deckenlampe" },
  "lamp-floor": { Icon: LampFloor, label: "Stehlampe" },
  "lightbulb": { Icon: Lightbulb, label: "Licht" },
  "heater": { Icon: Heater, label: "Heizung / Heizlüfter" },
  "flame": { Icon: Flame, label: "Sauna / Ofen" },
  "thermometer": { Icon: Thermometer, label: "Thermostat" },
  "air-vent": { Icon: AirVent, label: "Klimaanlage" },
  "fan": { Icon: Fan, label: "Ventilator" },
  "snowflake": { Icon: Snowflake, label: "Kühlung" },
  "shower-head": { Icon: ShowerHead, label: "Warmwasser / Boiler" },
  "bath": { Icon: Bath, label: "Whirlpool / Bad" },
  "droplets": { Icon: Droplets, label: "Pumpe" },
  "waves-ladder": { Icon: WavesLadder, label: "Pool" },
  "tv": { Icon: Tv, label: "Fernseher" },
  "monitor": { Icon: Monitor, label: "Computer" },
  "laptop": { Icon: Laptop, label: "Laptop" },
  "smartphone": { Icon: Smartphone, label: "Handy" },
  "tablet-smartphone": { Icon: TabletSmartphone, label: "Tablet" },
  "printer": { Icon: Printer, label: "Drucker" },
  "router": { Icon: Router, label: "Router / WLAN" },
  "server": { Icon: Server, label: "Server / NAS" },
  "gamepad-2": { Icon: Gamepad2, label: "Spielkonsole" },
  "speaker": { Icon: Speaker, label: "Lautsprecher" },
  "radio": { Icon: Radio, label: "Radio" },
  "headphones": { Icon: Headphones, label: "Kopfhörer" },
  "music": { Icon: Music, label: "Musikanlage" },
  "projector": { Icon: Projector, label: "Beamer" },
  "cctv": { Icon: Cctv, label: "Kamera" },
  "drill": { Icon: Drill, label: "Bohrmaschine" },
  "hammer": { Icon: Hammer, label: "Werkzeug" },
  "wrench": { Icon: Wrench, label: "Werkstatt" },
  "paint-roller": { Icon: PaintRoller, label: "Heimwerken" },
  "axe": { Icon: Axe, label: "Holzspalter" },
  "sprout": { Icon: Sprout, label: "Garten / Rasen" },
  "trees": { Icon: Trees, label: "Gartengerät" },
  "fish-symbol": { Icon: FishSymbol, label: "Aquarium / Teich" },
  "dumbbell": { Icon: Dumbbell, label: "Fitnessgerät" },
  "car": { Icon: Car, label: "Auto" },
  "ev-charger": { Icon: EvCharger, label: "Wallbox" },
  "bike": { Icon: Bike, label: "E-Bike" },
  "scooter": { Icon: Scooter, label: "E-Roller" },
  "caravan": { Icon: Caravan, label: "Wohnwagen" },
  "battery-charging": { Icon: BatteryCharging, label: "Akku / Speicher" },
  "solar-panel": { Icon: SolarPanel, label: "Solar" },
  "plug": { Icon: Plug, label: "Steckdose" },
  "plug-zap": { Icon: PlugZap, label: "Stromverbraucher" },
  "zap": { Icon: Zap, label: "Strom" },
  "power": { Icon: Power, label: "Gerät" },
  house: { Icon: House, label: "Haus" },
};
/** Früher gespeicherte Emojis eigener Geräte -> passendes Icon (keine DB-Migration nötig). */
export const LEGACY_EMOJI: Record<string, string> = {
  "🔌": "plug",
  "🏊": "waves-ladder",
  "🛁": "bath",
  "🔥": "flame",
  "❄️": "snowflake",
  "🌡️": "thermometer",
  "🪚": "wrench",
  "🔧": "wrench",
  "🖨️": "printer",
  "🎵": "music",
  "🐠": "fish-symbol",
  "🌱": "sprout",
  "🚿": "shower-head",
  "🏠": "house",
  "⚡": "zap",
  "🔋": "battery-charging",
};

/** Lucide-Name zu einem gespeicherten Icon-Wert, oder null, wenn er weder ein Icon noch ein bekanntes altes Emoji ist. */
export function resolveIcon(icon: string): string | null {
  if (ICONS[icon]) return icon;
  return LEGACY_EMOJI[icon] ?? null;
}

export function iconLabel(icon: string): string {
  const name = resolveIcon(icon);
  return name ? ICONS[name]!.label : icon;
}

const TONE_BY_ICON: Record<string, Tone> = Object.fromEntries(
  ICON_GROUPS.flatMap((g) => g.icons.map((i) => [i, g.tone])),
);

/** Farbton zu einem gespeicherten Icon-Wert (Gruppe des Icons), sonst "neutral". */
export function iconTone(icon: string): Tone {
  const name = resolveIcon(icon);
  return (name && TONE_BY_ICON[name]) || "neutral";
}

interface ApplianceIconProps {
  icon: string;
  /** Durchmesser des Farbkreises in px */
  size?: number;
  /** grau statt Gruppenfarbe, z. B. wenn das Gerät gerade nicht geht */
  muted?: boolean;
}

/** Weißes Geräte-Icon auf einem Kreis in der Farbe seiner Gruppe; unbekannte Werte (z. B. ein Emoji) im neutralen Kreis. */
export function ApplianceIcon({ icon, size = 24, muted = false }: ApplianceIconProps) {
  const name = resolveIcon(icon);
  const tone = muted ? "muted" : iconTone(icon);
  const glyph = Math.round(size * 0.55);
  const Glyph = name ? ICONS[name]!.Icon : null;
  return (
    <span className={`icon-badge tone-${tone}`} style={{ width: size, height: size }} aria-hidden>
      {Glyph ? <Glyph size={glyph} strokeWidth={2} /> : <span style={{ fontSize: glyph }}>{icon}</span>}
    </span>
  );
}
