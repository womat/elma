import { useState, type FormEvent } from "react";
import type { MeDto } from "@elma/shared";
import { api } from "./api.ts";

interface Props {
  inviteCode: string | null;
  onSignedIn: (token: string, user: MeDto) => void;
}

export function AuthScreen({ inviteCode, onSignedIn }: Props) {
  const [mode, setMode] = useState<"login" | "register">(inviteCode ? "register" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === "register" && inviteCode ? await api.register(email, password, inviteCode) : await api.login(email, password);
      if (mode === "login" && inviteCode) await api.acceptInvite(inviteCode).catch(() => undefined);
      onSignedIn(res.token, res.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <img src="/icon.svg" alt="" width={72} height={72} />
      <h1>ELMA</h1>
      <p className="muted">Energie Lokal Miteinander Austauschen</p>
      {inviteCode && <p className="notice">Du wurdest eingeladen. Leg ein Konto an oder melde dich an, um den Überschuss zu sehen.</p>}
      <form onSubmit={submit} className="card form">
        <label>
          E-Mail
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Passwort
          <input
            type="password"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "…" : mode === "register" ? "Konto anlegen" : "Anmelden"}
        </button>
        {inviteCode && (
          <button type="button" className="link" onClick={() => setMode(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "Noch kein Konto? Registrieren" : "Schon ein Konto? Anmelden"}
          </button>
        )}
      </form>
    </main>
  );
}
