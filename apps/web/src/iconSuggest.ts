/**
 * Stichwort -> Icon. Reihenfolge zählt: spezifische Begriffe zuerst
 * (z. B. "Poolpumpe" -> Pool statt Pumpe, "Handy laden" -> Handy statt Wallbox).
 */
const KEYWORDS: [string[], string][] = [
  [["wärmepumpe", "waermepumpe", "infrarot", "heizlüfter", "heizstab", "heizung", "heiz"], "heater"],
  [["whirlpool", "badewanne"], "bath"],
  [["pool"], "waves-ladder"],
  [["aquarium", "teich"], "fish-symbol"],
  [["gefrier", "tiefkühl"], "thermometer-snowflake"],
  [["kühlschrank", "kühl"], "refrigerator"],
  [["klima"], "air-vent"],
  [["ventilator", "entfeucht", "lüfter"], "fan"],
  [["boiler", "warmwasser", "durchlauferhitzer", "dusche"], "shower-head"],
  [["sauna", "kamin"], "flame"],
  [["pumpe"], "droplets"],
  [["waschmaschine", "trockner", "wasch"], "washing-machine"],
  [["geschirr", "spül"], "bubbles"],
  [["staubsaug", "saugrobot", "sauger"], "robot-vacuum"],
  [["bügel"], "shirt"],
  [["föhn", "fön", "haartrockner"], "wind"],
  [["mikrowelle", "mikro"], "microwave"],
  [["backofen", "ofen", "back"], "chef-hat"],
  [["kaffee", "espresso"], "coffee"],
  [["toast"], "sandwich"],
  [["mixer", "küchenmaschine", "thermomix"], "blender"],
  [["herd", "koch", "induktion"], "cooking-pot"],
  [["handy", "smartphone", "telefon"], "smartphone"],
  [["tablet", "ipad"], "tablet-smartphone"],
  [["laptop", "notebook"], "laptop"],
  [["computer", "pc", "monitor", "bildschirm"], "monitor"],
  [["fernseh", "tv"], "tv"],
  [["beamer", "projektor"], "projector"],
  [["drucker"], "printer"],
  [["router", "wlan", "modem"], "router"],
  [["server", "nas"], "server"],
  [["konsole", "playstation", "xbox", "switch"], "gamepad-2"],
  [["wallbox", "ladestation", "e-auto", "elektroauto"], "ev-charger"],
  [["lautsprech", "soundbar", "box"], "speaker"],
  [["radio"], "radio"],
  [["musik", "stereo", "verstärker"], "music"],
  [["kamera", "überwachung"], "cctv"],
  [["bohr"], "drill"],
  [["säge", "werkzeug", "werkstatt", "kompressor", "schleif"], "wrench"],
  [["holzspalter", "spalter"], "axe"],
  [["rasen", "mäher", "garten", "bewässer"], "sprout"],
  [["laufband", "fitness", "ergometer", "heimtrainer"], "dumbbell"],
  [["auto"], "car"],
  [["e-bike", "ebike", "fahrrad", "rad"], "bike"],
  [["roller", "scooter"], "scooter"],
  [["wohnwagen", "wohnmobil", "camper"], "caravan"],
  [["akku", "batterie", "speicher"], "battery-charging"],
  [["lampe", "leuchte", "licht"], "lamp"],
];

/** Passendes Icon zum Gerätenamen, oder null, wenn nichts passt. */
export function suggestIcon(name: string): string | null {
  const n = name.toLowerCase();
  if (!n.trim()) return null;
  for (const [words, icon] of KEYWORDS) if (words.some((w) => n.includes(w))) return icon;
  return null;
}
