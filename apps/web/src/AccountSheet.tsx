import { KeyRound, Trash2 } from "lucide-react";
import { useState } from "react";
import type { MeDto, PasskeyDto } from "@elma/shared";
import { api } from "./api.ts";
import { addPasskey, PasskeyCancelled } from "./passkey.ts";

interface Props {
  me: MeDto;
  passkeys: PasskeyDto[];
  onChange: (passkeys: PasskeyDto[]) => void;
  onSignOut: () => void;
  onClose: () => void;
}

const date = (t: number) => new Date(t).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Vollbild-Blatt: eigene Passkeys ansehen, hinzufügen und löschen. */
export function AccountSheet({ me, passkeys, onChange, onSignOut, onClose }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
          <h2 id="account-title">Anmeldung</h2>
          <button onClick={onClose}>Fertig</button>
        </header>

        <p className="muted">Angemeldet als {me.email}</p>

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

        <h3>Abmelden</h3>
        <button className="secondary" onClick={onSignOut}>
          Auf diesem Gerät abmelden
        </button>
      </div>
    </div>
  );
}
