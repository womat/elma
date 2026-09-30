import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { disablePush, enablePush, getPushState, type PushState } from "./push.ts";

const HINTS: Partial<Record<PushState, string>> = {
  unsupported: "Dieser Browser unterstützt keine Benachrichtigungen. Am Handy bitte Chrome (Android) oder Safari (iPhone) verwenden.",
  "ios-install": "Am iPhone gehen Benachrichtigungen nur, wenn ELMA installiert ist: Teilen → „Zum Home-Bildschirm“, dann ELMA von dort öffnen.",
  denied: "Benachrichtigungen sind blockiert. Bitte in den Einstellungen des Browsers bzw. Handys für ELMA erlauben.",
};

/** Push auf diesem Gerät ein-/ausschalten und testen. */
export function PushToggle() {
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
          🔔 Benachrichtigungen aktivieren
        </button>
      )}
      {state === "on" && (
        <>
          <p className="push-on">✓ Auf diesem Gerät aktiv</p>
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
