const kw = new Intl.NumberFormat("de-AT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const w = new Intl.NumberFormat("de-AT", { maximumFractionDigits: 0 });

export function formatPower(watts: number): string {
  return Math.abs(watts) >= 1000 ? `${kw.format(watts / 1000)} kW` : `${w.format(watts)} W`;
}

export function formatAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `vor ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} min`;
  return `vor ${Math.round(m / 60)} h`;
}

export function formatTime(t: number): string {
  return new Date(t).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
}
