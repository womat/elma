import { Check, Copy, Link2, Lock, Share, UsersRound } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { RESERVATION_DAILY_MINUTES, type RecipientDto } from "@elma/shared";
import { api } from "./api.ts";

interface Props {
  producerId: string;
  producerName: string;
  onClose: () => void;
}

const date = (t: number) => new Date(t).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });

/**
 * Vollbild-Blatt zum Einladen, geöffnet über das Personen-Symbol am Erzeuger.
 * Früher stand das Formular unten in jeder Erzeuger-Karte; dort nahm es bei jedem Blick Platz weg,
 * obwohl man nur selten jemanden einlädt.
 */
export function InviteSheet({ producerId, producerName, onClose }: Props) {
  const [name, setName] = useState("");
  const [invite, setInvite] = useState<{ url: string; expiresAt: number; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { url, expiresAt } = await api.createInvite(producerId, name.trim() || undefined);
      setInvite({ url, expiresAt, name: name.trim() });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Das Teilen-Fenster öffnet sich erst auf Tippen, nicht schon beim Erstellen: So sieht man vorher, dass der Link da ist
  const share = () => {
    if (!invite) return;
    navigator.share({ title: "ELMA Einladung", text: "Sieh dir meinen Stromüberschuss an:", url: invite.url }).catch(() => undefined);
  };

  const copy = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
    } catch {
      setError("Kopieren ging nicht – bitte den Link oben markieren und kopieren.");
    }
  };

  const again = () => {
    setInvite(null);
    setName("");
    setCopied(false);
    setError(null);
  };

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="invite-title">
      <div className="sheet-body">
        <header className="sheet-head">
          <span />
          <h2 id="invite-title">Einladen</h2>
          <button onClick={onClose}>Fertig</button>
        </header>

        <div className="profile invite-intro">
          <strong>{producerName} teilen</strong>
          <span className="muted small">
            Wer den Link öffnet, sieht den Überschuss von {producerName} live und meldet sich mit einem Passkey an.
          </span>
        </div>

        {invite ? (
          <>
            <h3>{invite.name ? `Einladung für ${invite.name}` : "Einladung"}</h3>
            <div className="custom-form">
              <p className="push-on">
                <Check size={18} className="ui-icon" aria-hidden /> Link erstellt
              </p>
              <input readOnly value={invite.url} onFocus={(e) => e.currentTarget.select()} aria-label="Einladungslink" />
              <div className="invite-actions">
                {"share" in navigator && (
                  <button onClick={share}>
                    <Share size={18} className="ui-icon" aria-hidden /> Teilen
                  </button>
                )}
                <button className="secondary" onClick={() => void copy()}>
                  <Copy size={18} className="ui-icon" aria-hidden /> {copied ? "Kopiert" : "Kopieren"}
                </button>
              </div>
            </div>
            <p className="muted small center-text">Gilt bis {date(invite.expiresAt)} und nur für eine Person.</p>
            <button className="secondary invite-again" onClick={again}>
              Weitere Person einladen
            </button>
          </>
        ) : (
          <form onSubmit={create}>
            <h3>Wen lädst du ein?</h3>
            <div className="custom-form">
              <label className="field">
                <span className="muted small">Name (optional)</span>
                <input placeholder="z. B. Margit" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <p className="muted small">Der Name steht dann gleich im neuen Konto und lässt sich später selbst ändern.</p>
            </div>
            <button type="submit" className="invite-create" disabled={busy}>
              <Link2 size={18} className="ui-icon" aria-hidden /> {busy ? "…" : "Einladungslink erstellen"}
            </button>
            <p className="muted small center-text">Jeder Link gilt nur für eine Person.</p>
          </form>
        )}
        {error && <p className="error">{error}</p>}

        <RecipientList producerId={producerId} />
      </div>
    </div>
  );
}

/** Wer den Erzeuger schon sieht, mit dem Schalter für das Recht zum Reservieren (ELISA-Modus). */
function RecipientList({ producerId }: { producerId: string }) {
  const [recipients, setRecipients] = useState<RecipientDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.recipients(producerId).then(setRecipients, (err: Error) => setError(err.message));
  }, [producerId]);

  const toggle = async (r: RecipientDto) => {
    setError(null);
    try {
      const { canReserve } = await api.setCanReserve(producerId, r.userId, !r.canReserve);
      setRecipients((list) => list?.map((x) => (x.userId === r.userId ? { ...x, canReserve } : x)) ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!recipients?.length && !error) return null;
  return (
    <>
      <h3 className="recipients-head">
        <span>
          <UsersRound size={18} className="ui-icon" aria-hidden /> Empfänger
        </span>
        <span className="muted small">
          <Lock size={14} className="ui-icon" aria-hidden /> ELISA-Modus
        </span>
      </h3>
      <ul className="custom-list">
        {recipients?.map((r) => (
          <li key={r.userId} className="recipient">
            <span className="grow">
              {r.name}
              <br />
              <span className="muted small">{r.email}</span>
            </span>
            <button
              className="switch"
              role="switch"
              aria-checked={r.canReserve}
              aria-label={`ELISA-Modus für ${r.name}`}
              onClick={() => void toggle(r)}
            />
          </li>
        ))}
      </ul>
      <p className="muted small">
        Mit ELISA-Modus darf die Person bis zu {RESERVATION_DAILY_MINUTES} min am Tag den Überschuss für sich reservieren, ohne
        dass du zustimmen musst. Du bekommst dann eine Nachricht. Ausschalten beendet eine laufende Reservierung sofort.
      </p>
      {error && <p className="error">{error}</p>}
    </>
  );
}
