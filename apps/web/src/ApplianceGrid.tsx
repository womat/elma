import type { Appliance } from "./appliances.ts";
import { formatPower } from "./format.ts";

interface Props {
  /** aktueller Überschuss in Watt, null = keine aktuellen Daten */
  watts: number | null;
  appliances: Appliance[];
  /** IDs der Geräte mit Push-Nachricht */
  notify: string[];
  onEdit: () => void;
}

/** Zeigt anhand der eigenen Geräte, was mit dem Überschuss gerade betrieben werden kann. */
export function ApplianceGrid({ watts, appliances, notify, onEdit }: Props) {
  const surplus = Math.max(0, watts ?? 0);
  const fitting = appliances.filter((a) => a.watts <= surplus).length;

  return (
    <div className="appliances">
      <div className="appliances-head">
        <p className="appliances-summary">
          {watts === null
            ? "Keine aktuellen Daten"
            : appliances.length === 0
              ? "Noch keine Geräte ausgewählt"
              : fitting === 0
                ? "Gerade reicht es für keines deiner Geräte"
                : fitting === appliances.length
                  ? "Alles geht – jetzt ist die beste Zeit!"
                  : `${fitting} von ${appliances.length} Geräten gehen jetzt`}
        </p>
        <button className="link small" onClick={onEdit}>
          ⚙️ Meine Geräte
        </button>
      </div>
      {appliances.length === 0 ? (
        <button className="secondary" onClick={onEdit}>
          Geräte auswählen
        </button>
      ) : (
        <ul className="appliance-grid">
          {appliances.map((a) => {
            const ratio = watts === null ? 0 : Math.min(1, surplus / a.watts);
            const ok = ratio >= 1;
            return (
              <li key={a.id} className={ok ? "ok" : "no"} title={`${a.name}: ca. ${formatPower(a.watts)}`}>
                {notify.includes(a.id) && (
                  <span className="bell" title="Benachrichtigung aktiv">
                    🔔
                  </span>
                )}
                <span className="appliance-icon" aria-hidden>
                  {a.icon}
                </span>
                <span className="appliance-name">{a.name}</span>
                <span className="appliance-meter" aria-hidden>
                  <span style={{ width: `${ratio * 100}%` }} />
                </span>
                <span className="appliance-state">
                  {ok ? "✓ geht" : watts === null ? "–" : `noch ${formatPower(a.watts - surplus)}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
