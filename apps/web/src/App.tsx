import { useEffect, useState } from "react";
import type { MeDto } from "@elma/shared";
import { api, ApiError, getToken, setToken } from "./api.ts";
import { AuthScreen } from "./AuthScreen.tsx";
import { Dashboard } from "./Dashboard.tsx";

/** Einladungscode aus ?invite=... lesen und aus der Adresszeile entfernen. */
function takeInviteFromUrl(): string | null {
  const url = new URL(location.href);
  const code = url.searchParams.get("invite");
  if (code) {
    url.searchParams.delete("invite");
    history.replaceState(null, "", url.pathname + url.search);
  }
  return code;
}

export function App() {
  const [token, setTokenState] = useState(getToken);
  const [me, setMe] = useState<MeDto | null>(null);
  const [invite, setInvite] = useState(takeInviteFromUrl);
  const [notice, setNotice] = useState<string | null>(null);

  const signIn = (newToken: string, user: MeDto) => {
    setToken(newToken);
    setTokenState(newToken);
    setMe(user);
  };
  const signOut = () => {
    setToken(null);
    setTokenState(null);
    setMe(null);
  };

  useEffect(() => {
    if (!token) return;
    api.me().then(setMe, (err) => {
      if (err instanceof ApiError && err.status === 401) signOut();
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

  if (!token) return <AuthScreen inviteCode={invite} onSignedIn={(t, u) => { setInvite(null); signIn(t, u); }} />;
  if (!me) return <div className="center muted">Lade …</div>;
  return <Dashboard key={notice ?? ""} token={token} me={me} notice={notice} onSignOut={signOut} />;
}
