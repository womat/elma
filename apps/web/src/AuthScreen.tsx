import { KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { MeDto } from "@elma/shared";
import { api, type AuthResponse } from "./api.ts";
import { Footer } from "./Footer.tsx";
import { PasskeyCancelled, passkeysSupported, registerPasskey, signInWithPasskey } from "./passkey.ts";

interface Props {
  inviteCode: string | null;
  /** Einrichtungslink vom Betreiber (?setup=…): Passkey für ein bestehendes Konto anlegen */
  setupToken: string | null;
  onSignedIn: (token: string, user: MeDto) => void;
}

type Mode = "login" | "register" | "setup";

/** Anmeldung nur mit Passkey: Fingerabdruck, Gesicht oder Geräte-PIN, kein Passwort. */
export function AuthScreen({ inviteCode, setupToken, onSignedIn }: Props) {
  const [mode, setMode] = useState<Mode>(setupToken ? "setup" : inviteCode ? "register" : "login");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<AuthResponse>) => {
    setBusy(true);
    setError(null);
    setHint(null);
    try {
      const res = await action();
      // mit bestehendem Konto angemeldet und Einladungslink geöffnet -> Einladung gleich annehmen
      if (mode === "login" && inviteCode) await api.acceptInvite(inviteCode).catch(() => undefined);
      onSignedIn(res.token, res.user);
    } catch (err) {
      if (err instanceof PasskeyCancelled) setHint(err.message);
      else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitRegister = (e: FormEvent) => {
    e.preventDefault();
    if (inviteCode) void run(() => registerPasskey({ inviteCode, email }));
  };

  return (
    <main className="auth">
      <img src="/icon.svg" alt="" width={72} height={72} />
      <h1>ELMA</h1>
      <p className="muted">Energie Lokal Miteinander Austauschen</p>

      {!passkeysSupported ? (
        <p className="card error">
          Dieser Browser unterstützt keine Passkeys. Bitte öffne ELMA in einem aktuellen Chrome (Android) oder Safari (iPhone).
        </p>
      ) : (
        <div className="card form">
          {mode === "login" && (
            <>
              <p className="muted">Melde dich mit deinem Passkey an – per Fingerabdruck, Gesicht oder Geräte-PIN.</p>
              <button onClick={() => void run(signInWithPasskey)} disabled={busy}>
                <KeyRound size={18} className="ui-icon" aria-hidden /> {busy ? "…" : "Mit Passkey anmelden"}
              </button>
              {inviteCode ? (
                <button type="button" className="link" onClick={() => setMode("register")}>
                  Neu hier? Konto anlegen
                </button>
              ) : (
                <p className="muted small">Noch kein Zugang? Lass dir einen Einladungslink schicken.</p>
              )}
            </>
          )}

          {mode === "register" && (
            <form onSubmit={submitRegister} className="form">
              <p className="notice">Du wurdest eingeladen. Leg dein Konto an, um den Überschuss zu sehen.</p>
              <label>
                E-Mail
                <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <button type="submit" disabled={busy}>
                <KeyRound size={18} className="ui-icon" aria-hidden /> {busy ? "…" : "Passkey anlegen"}
              </button>
              <p className="muted small">
                Dein Gerät speichert einen Schlüssel für ELMA. Ein Passwort brauchst du nicht – angemeldet wird per
                Fingerabdruck, Gesicht oder Geräte-PIN.
              </p>
              <button type="button" className="link" onClick={() => setMode("login")}>
                Schon ein Konto? Mit Passkey anmelden
              </button>
            </form>
          )}

          {mode === "setup" && setupToken && (
            <>
              <p className="notice">Richte deinen Passkey ein. Danach meldest du dich nur noch damit an.</p>
              <button onClick={() => void run(() => registerPasskey({ setupToken }))} disabled={busy}>
                <KeyRound size={18} className="ui-icon" aria-hidden /> {busy ? "…" : "Passkey einrichten"}
              </button>
              <button type="button" className="link" onClick={() => setMode("login")}>
                Ich habe schon einen Passkey
              </button>
            </>
          )}

          {hint && <p className="muted small">{hint}</p>}
          {error && <p className="error">{error}</p>}
        </div>
      )}
      <Footer />
    </main>
  );
}
