import { useState, type FormEvent } from "react";
import type { ApplianceSettings, CustomAppliance } from "@elma/shared";
import { CATALOG, CUSTOM_ICONS } from "./appliances.ts";
import { formatPower } from "./format.ts";
import { PushToggle } from "./PushToggle.tsx";

interface Props {
  initial: ApplianceSettings;
  onSave: (settings: ApplianceSettings) => Promise<void>;
  onClose: () => void;
}

/** Vollbild-Dialog: Geräte aus dem Katalog an-/abwählen und eigene Geräte anlegen. */
export function ApplianceEditor({ initial, onSave, onClose }: Props) {
  const [selected, setSelected] = useState(() => new Set(initial.selected));
  const [custom, setCustom] = useState<CustomAppliance[]>(initial.custom);
  const [notify, setNotify] = useState(() => new Set(initial.notify));
  const [icon, setIcon] = useState(CUSTOM_ICONS[0]!);
  const [name, setName] = useState("");
  const [watts, setWatts] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const flip = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };
  const toggle = (id: string) => setSelected((prev) => flip(prev, id));
  const toggleNotify = (id: string) => setNotify((prev) => flip(prev, id));

  // Benachrichtigen kann man nur für Geräte, die auch ausgewählt sind
  const chosen = [...CATALOG.filter((a) => selected.has(a.id)), ...custom].sort((a, b) => a.watts - b.watts);

  const addCustom = (e: FormEvent) => {
    e.preventDefault();
    const w = Math.round(Number(watts.replace(",", ".")));
    if (!name.trim() || !Number.isFinite(w) || w < 1 || w > 50_000) {
      setError("Bitte Namen und Leistung (1–50 000 W) angeben");
      return;
    }
    setCustom((prev) => [...prev, { id: `custom-${crypto.randomUUID().slice(0, 8)}`, icon, name: name.trim(), watts: w }]);
    setName("");
    setWatts("");
    setError(null);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      // Reihenfolge des Katalogs beibehalten, unbekannte IDs verwerfen
      await onSave({
        selected: CATALOG.filter((a) => selected.has(a.id)).map((a) => a.id),
        custom,
        notify: chosen.filter((a) => notify.has(a.id)).map((a) => a.id),
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const count = selected.size + custom.length;

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="editor-title">
      <div className="sheet-body">
        <header className="sheet-head">
          <button className="link" onClick={onClose}>
            Abbrechen
          </button>
          <h2 id="editor-title">Meine Geräte</h2>
          <button onClick={save} disabled={busy}>
            {busy ? "…" : "Fertig"}
          </button>
        </header>

        <p className="muted">Tippe auf die Geräte, die du hast. Angezeigt wird dann, welche davon mit dem Überschuss laufen können.</p>

        <ul className="appliance-grid pick">
          {CATALOG.map((a) => {
            const on = selected.has(a.id);
            return (
              <li key={a.id}>
                <button type="button" className={on ? "on" : ""} aria-pressed={on} onClick={() => toggle(a.id)}>
                  <span className="appliance-icon" aria-hidden>
                    {a.icon}
                  </span>
                  <span className="appliance-name">{a.name}</span>
                  <span className="appliance-state">{formatPower(a.watts)}</span>
                  <span className="check" aria-hidden>
                    {on ? "✓" : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <h3>Eigene Geräte</h3>
        {custom.length > 0 && (
          <ul className="custom-list">
            {custom.map((c) => (
              <li key={c.id}>
                <span className="appliance-icon" aria-hidden>
                  {c.icon}
                </span>
                <span className="grow">{c.name}</span>
                <span className="muted">{formatPower(c.watts)}</span>
                <button
                  className="link"
                  aria-label={`${c.name} entfernen`}
                  onClick={() => setCustom((prev) => prev.filter((x) => x.id !== c.id))}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <form className="custom-form" onSubmit={addCustom}>
          <div className="icon-picker" role="radiogroup" aria-label="Symbol">
            {CUSTOM_ICONS.map((i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={i === icon}
                className={i === icon ? "on" : ""}
                onClick={() => setIcon(i)}
              >
                {i}
              </button>
            ))}
          </div>
          <div className="custom-inputs">
            <input placeholder="Name, z. B. Poolpumpe" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
            <input
              placeholder="Watt"
              inputMode="numeric"
              value={watts}
              onChange={(e) => setWatts(e.target.value)}
              aria-label="Leistung in Watt"
            />
          </div>
          <p className="muted small">Die Leistung steht meist auf dem Typenschild oder in der Anleitung (z. B. „800 W“).</p>
          <button type="submit" className="secondary">
            + Gerät hinzufügen
          </button>
        </form>

        <h3>🔔 Benachrichtigungen</h3>
        <div className="custom-form">
          <PushToggle notifyCount={chosen.filter((a) => notify.has(a.id)).length} />
          <p className="muted small">
            Benachrichtige mich, wenn eines dieser Geräte mit dem Überschuss laufen kann (mindestens 2 Minuten lang):
          </p>
          {chosen.length === 0 ? (
            <p className="muted small">Wähle oben zuerst deine Geräte aus.</p>
          ) : (
            <div className="chips">
              {chosen.map((a) => {
                const on = notify.has(a.id);
                return (
                  <button key={a.id} type="button" className={on ? "chip on" : "chip"} aria-pressed={on} onClick={() => toggleNotify(a.id)}>
                    {on ? "🔔" : "🔕"} {a.icon} {a.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {error && <p className="error">{error}</p>}
        <p className="muted small center-text">{count} Geräte ausgewählt</p>
      </div>
    </div>
  );
}
