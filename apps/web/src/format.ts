const kw = new Intl.NumberFormat("de-AT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const w = new Intl.NumberFormat("de-AT", { maximumFractionDigits: 0 });

export function formatPower(watts: number): string {
  return Math.abs(watts) >= 1000 ? `${kw.format(watts / 1000)} kW` : `${w.format(watts)} W`;
}

export function formatTime(t: number): string {
  return new Date(t).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
}
