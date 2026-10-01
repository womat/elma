import { House, KeyRound, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ApplianceSettings, MeDto, PasskeyDto, ProducerDto } from "@elma/shared";
import { api } from "./api.ts";
import { useLive } from "./useLive.ts";
import { ProducerCard, type View } from "./ProducerCard.tsx";
import { ApplianceEditor } from "./ApplianceEditor.tsx";
import { defaultSettings, resolveAppliances } from "./appliances.ts";
import { getPushState, syncPushSubscription } from "./push.ts";
import { Footer } from "./Footer.tsx";
import { AccountSheet } from "./AccountSheet.tsx";

const VIEW_KEY = "elma.view";

function loadView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "appliances" ? "appliances" : "power";
  } catch {
    return "power";
  }
}

interface Props {
  token: string;
  me: MeDto;
  notice: string | null;
  onSignOut: () => void;
}

export function Dashboard({ token, me, notice, onSignOut }: Props) {
  const [producers, setProducers] = useState<ProducerDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>(loadView);
  const changeView = (next: View) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Ansicht wird dann nur nicht gemerkt
    }
  };

  const [applianceSettings, setApplianceSettings] = useState<ApplianceSettings>(defaultSettings);
  const [editing, setEditing] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const appliances = useMemo(() => resolveAppliances(applianceSettings), [applianceSettings]);
  // null = noch nicht geladen; [] = Konto noch aus der Passwort-Zeit, Passkey fehlt
  const [passkeys, setPasskeys] = useState<PasskeyDto[] | null>(null);
  const [account, setAccount] = useState(false);

  useEffect(() => {
    api.producers().then(setProducers, (err: Error) => setError(err.message));
    api.myPasskeys().then(setPasskeys, () => undefined);
    api.appliances().then(({ settings }) => settings && setApplianceSettings(settings), () => undefined);
    void syncPushSubscription();
    getPushState().then((s) => setPushOn(s === "on"), () => undefined);
  }, []);

  const saveAppliances = async (settings: ApplianceSettings) => {
    const res = await api.saveAppliances(settings);
    setApplianceSettings(res.settings);
  };

  const initial = useMemo(() => Object.fromEntries((producers ?? []).map((p) => [p.id, p.current])), [producers]);
  const { readings, status } = useLive(token, initial);

  // Tick für die Offline-Erkennung (keine neuen Werte mehr)
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <main className="dashboard">
      <header>
        <div className="brand">
          <img src="/icon.svg" alt="" width={32} height={32} />
          <strong>ELMA</strong>
        </div>
        <span className={`dot ${status}`} title={status === "open" ? "Live verbunden" : "Verbinde …"} />
        <button className="link account" onClick={() => setAccount(true)} title={me.email} aria-label="Anmeldung und Passkeys">
          <KeyRound size={18} aria-hidden />
        </button>
        <button className="link" onClick={onSignOut} title={me.email}>
          Abmelden
        </button>
      </header>

      {passkeys?.length === 0 && (
        <p className="notice">
          <KeyRound size={16} className="ui-icon" aria-hidden /> Die Anmeldung mit Passwort entfällt. Richte jetzt deinen Passkey
          ein, damit du auch nach dem Abmelden wieder hineinkommst.{" "}
          <button className="link small inline" onClick={() => setAccount(true)}>
            Passkey einrichten
          </button>
        </p>
      )}

      <div className="view-switch" role="tablist" aria-label="Ansicht">
        <button role="tab" aria-selected={view === "power"} onClick={() => changeView("power")}>
          <Zap size={17} className="ui-icon" aria-hidden /> Leistung
        </button>
        <button role="tab" aria-selected={view === "appliances"} onClick={() => changeView("appliances")}>
          <House size={17} className="ui-icon" aria-hidden /> Geräte
        </button>
      </div>

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}
      {producers === null && !error && <p className="muted center">Lade …</p>}
      {producers?.length === 0 && (
        <p className="muted center">Noch keine Erzeuger freigegeben. Bitte lass dir einen Einladungslink schicken.</p>
      )}
      {producers?.map((p) => (
        <ProducerCard
          key={p.id}
          producer={p}
          reading={readings[p.id] ?? null}
          now={now}
          view={view}
          appliances={appliances}
          notify={applianceSettings.notify}
          pushOn={pushOn}
          onEditAppliances={() => setEditing(true)}
        />
      ))}

      <Footer />

      {account && passkeys && (
        <AccountSheet me={me} passkeys={passkeys} onChange={setPasskeys} onSignOut={onSignOut} onClose={() => setAccount(false)} />
      )}

      {editing && (
        <ApplianceEditor
          initial={applianceSettings}
          onSave={saveAppliances}
          onClose={() => {
            setEditing(false);
            // Push kann im Editor ein- oder ausgeschaltet worden sein
            getPushState().then((s) => setPushOn(s === "on"), () => undefined);
          }}
        />
      )}
    </main>
  );
}
