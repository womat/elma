import { KeyRound, LogOut, Trash2, UserRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { displayNameOf, type MeDto, type PasskeyDto } from "@elma/shared";
import { api } from "./api.ts";
import { addPasskey, PasskeyCancelled } from "./passkey.ts";

interface Props {
  me: MeDto;
  passkeys: PasskeyDto[];
  onChange: (passkeys: PasskeyDto[]) => void;
  onMeChange: (me: MeDto) => void;
  onSignOut: () => void;
  onClose: () => void;
}

const date = (t: number) => new Date(t).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Full-screen sheet: change display name, view, add and delete own passkeys, log out. */
export function AccountSheet({ me, passkeys, onChange, onMeChange, onSignOut, onClose }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState(me.displayName ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);
  const nameChanged = name.trim() !== (me.displayName ?? "");

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    setNameError(null);
    setNameSaved(false);
    try {
      // an empty field clears the name; then the part of the e-mail before the @ applies again
      const next = await api.setDisplayName(name.trim() || null);
      onMeChange(next);
      setName(next.displayName ?? "");
      setNameSaved(true);
    } catch (err) {
      setNameError((err as Error).message);
    }
  };

  const act = async (action: () => Promise<PasskeyDto[]>) => {
    setBusy(true);
    setError(null);
    setHint(null);
    try {
      onChange(await action());
    } catch (err) {
      if (err instanceof PasskeyCancelled) setHint(err.message);
      else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = (p: PasskeyDto) => {
    if (confirm(`Passkey „${p.name}“ löschen? Mit diesem Gerät kannst du dich dann nicht mehr anmelden.`)) {
      void act(() => api.deletePasskey(p.id));
    }
  };

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="account-title">
      <div className="sheet-body">
        <header className="sheet-head">
          <span />
          <h2 id="account-title">Konto</h2>
          <button onClick={onClose}>Fertig</button>
        </header>

        <div className="profile">
          <span className="avatar large" aria-hidden>
            {displayNameOf(me).charAt(0).toUpperCase()}
          </span>
          <span>
            <strong>{displayNameOf(me)}</strong>
            <br />
            <span className="muted small">{me.email}</span>
          </span>
        </div>

        <h3>
          <UserRound size={18} className="ui-icon" aria-hidden /> Dein Name
        </h3>
        <form className="custom-form" onSubmit={saveName}>
          <div className="name-inputs">
            <input
              aria-label="Dein Name"
              placeholder={displayNameOf({ displayName: null, email: me.email })}
              maxLength={40}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameSaved(false);
              }}
            />
            <button type="submit" className="secondary" disabled={!nameChanged}>
              Speichern
            </button>
          </div>
          <p className="muted small">
            Andere sehen diesen Namen statt deiner E-Mail-Adresse. Ohne Namen steht dort „{displayNameOf({ displayName: null, email: me.email })}“.
          </p>
          {nameSaved && <p className="muted small">Gespeichert.</p>}
          {nameError && <p className="error">{nameError}</p>}
        </form>

        <h3>
          <KeyRound size={18} className="ui-icon" aria-hidden /> Deine Passkeys
        </h3>
        {passkeys.length === 0 ? (
          <p className="push-warning small">Noch kein Passkey – richte jetzt einen ein, sonst kommst du nach dem Abmelden nicht mehr hinein.</p>
        ) : (
          <ul className="custom-list">
            {passkeys.map((p) => (
              <li key={p.id}>
                <span className="grow">
                  {p.name}
                  <br />
                  <span className="muted small">
                    angelegt {date(p.createdAt)}
                    {p.lastUsedAt ? ` · zuletzt benutzt ${date(p.lastUsedAt)}` : ""}
                  </span>
                </span>
                <button
                  className="link"
                  aria-label={`Passkey ${p.name} löschen`}
                  title={passkeys.length <= 1 ? "Der letzte Passkey kann nicht gelöscht werden" : "Löschen"}
                  disabled={busy || passkeys.length <= 1}
                  onClick={() => remove(p)}
                >
                  <Trash2 size={18} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        <button className="secondary" disabled={busy} onClick={() => void act(addPasskey)}>
          + {passkeys.length === 0 ? "Passkey einrichten" : "Weiteren Passkey hinzufügen"}
        </button>
        <p className="muted small">
          Passkeys werden über dein Google- bzw. Apple-Konto auf deine anderen Geräte übertragen. Für ein Gerät ohne diese
          Synchronisation (z. B. einen Windows-PC) kannst du dort einen weiteren hinzufügen – oder beim Anmelden am PC den
          QR-Code mit dem Handy scannen.
        </p>
        {hint && <p className="muted small">{hint}</p>}
        {error && <p className="error">{error}</p>}

        <button className="secondary danger sign-out" onClick={onSignOut}>
          <LogOut size={18} className="ui-icon" aria-hidden /> Auf diesem Gerät abmelden
        </button>
      </div>
    </div>
  );
}
