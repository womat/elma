import { BellRing, Check, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { disablePush, enablePush, getPushState, type PushState } from "./push.ts";

const HINTS: Partial<Record<PushState, string>> = {
  unsupported: "Dieser Browser unterstützt keine Benachrichtigungen. Am Handy bitte Chrome (Android) oder Safari (iPhone) verwenden.",
  "ios-install": "Am iPhone gehen Benachrichtigungen nur, wenn ELMA installiert ist: Teilen → „Zum Home-Bildschirm“, dann ELMA von dort öffnen.",
  denied: "Benachrichtigungen sind blockiert. Bitte in den Einstellungen des Browsers bzw. Handys für ELMA erlauben.",
};

export const NO_BELL_RESERVE_HINT = "Ohne Glocke bekommst du nur die Nachrichten zu deinen Reservierungen.";

/**
 * Switch push on/off on this device and test it.
 * notifyCount = number of appliances with a bell (for the hint when none is marked).
 * canReserve: whoever may reserve gets the reservation notifications even without a bell; the warning is then wrong.
 */
export function PushToggle({ notifyCount, canReserve }: { notifyCount: number; canReserve: boolean }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    getPushState().then(setState, () => setState("unsupported"));
  }, []);

  const run = async (action: () => Promise<PushState | void>, success?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const next = await action();
      if (next) setState(next);
      if (success) setMessage(success);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (state === null) return null;

  return (
    <div className="push-toggle">
      {HINTS[state] && <p className="muted small">{HINTS[state]}</p>}
      {state === "off" && (
        <button type="button" disabled={busy} onClick={() => run(enablePush)}>
          <BellRing size={17} className="ui-icon" aria-hidden /> Benachrichtigungen aktivieren
        </button>
      )}
      {state === "on" && (
        <>
          <p className="push-on">
            <Check size={16} strokeWidth={3} className="ui-icon" aria-hidden /> Auf diesem Gerät aktiv
          </p>
          {notifyCount === 0 && canReserve && <p className="muted small">{NO_BELL_RESERVE_HINT}</p>}
          {notifyCount === 0 && !canReserve && (
            <p className="push-warning small">
              <TriangleAlert size={15} className="ui-icon" aria-hidden /> Markiere unten Geräte mit der Glocke – sonst kommen keine
              automatischen Nachrichten.
            </p>
          )}
          <div className="push-actions">
            <button type="button" className="secondary" disabled={busy} onClick={() => run(async () => void (await api.pushTest()), "Testnachricht verschickt")}>
              Testnachricht
            </button>
            <button type="button" className="link" disabled={busy} onClick={() => run(disablePush)}>
              Ausschalten
            </button>
          </div>
        </>
      )}
      {message && <p className="muted small">{message}</p>}
    </div>
  );
}
