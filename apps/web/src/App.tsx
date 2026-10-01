import { useEffect, useState } from "react";
import type { MeDto } from "@elma/shared";
import { api, ApiError, getToken, setToken } from "./api.ts";
import { AuthScreen } from "./AuthScreen.tsx";
import { Dashboard } from "./Dashboard.tsx";
import { disablePush } from "./push.ts";

/** Parameter (z. B. ?invite=...) lesen und aus der Adresszeile entfernen. */
function takeFromUrl(name: "invite" | "setup"): string | null {
  const url = new URL(location.href);
  const value = url.searchParams.get(name);
  if (value) {
    url.searchParams.delete(name);
    history.replaceState(null, "", url.pathname + url.search);
  }
  return value;
}

export function App() {
  const [token, setTokenState] = useState(getToken);
  const [me, setMe] = useState<MeDto | null>(null);
  const [invite, setInvite] = useState(() => takeFromUrl("invite"));
  const [setupToken, setSetupToken] = useState(() => takeFromUrl("setup"));
  const [notice, setNotice] = useState<string | null>(null);

  const signIn = (newToken: string, user: MeDto) => {
    setToken(newToken);
    setTokenState(newToken);
    setMe(user);
  };
  const signOut = async () => {
    // Push dieses Geräts abmelden, solange das JWT noch gilt – sonst bekäme das Gerät
    // nach einem Kontowechsel weiter die Nachrichten des alten Kontos
    await disablePush().catch(() => undefined);
    setToken(null);
    setTokenState(null);
    setMe(null);
  };

  useEffect(() => {
    if (!token) return;
    api.me().then(setMe, (err) => {
      if (err instanceof ApiError && err.status === 401) void signOut();
    });
  }, [token]);

  // Bereits angemeldet und Einladungslink geöffnet -> direkt annehmen
  useEffect(() => {
    if (!me || !invite) return;
    api.acceptInvite(invite).then(
      () => setNotice("Einladung angenommen – der neue Erzeuger wird jetzt angezeigt."),
      (err: Error) => setNotice(err.message),
    );
    setInvite(null);
  }, [me, invite]);

  if (!token) {
    return (
      <AuthScreen
        inviteCode={invite}
        setupToken={setupToken}
        onSignedIn={(t, u) => {
          setInvite(null);
          setSetupToken(null);
          signIn(t, u);
        }}
      />
    );
  }
  if (!me) return <div className="center muted">Lade …</div>;
  return <Dashboard key={notice ?? ""} token={token} me={me} notice={notice} onSignOut={signOut} />;
}
