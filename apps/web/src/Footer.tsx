import { useEffect, useState } from "react";
import { api } from "./api.ts";

/** Address of the source code; can be overridden at build time via VITE_SOURCE_URL (e.g. for a fork). */
const SOURCE_URL = import.meta.env.VITE_SOURCE_URL ?? "https://github.com/womat/elma";
/** Version of this frontend, set at build time (see vite.config.ts) */
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? "dev";

export function Footer() {
  // If the server already runs a newer version, the phone may still have the old app cached
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  useEffect(() => {
    api.health().then((h) => setServerVersion(h.version), () => undefined);
  }, []);
  const outdated = serverVersion !== null && serverVersion !== "dev" && serverVersion !== APP_VERSION;

  return (
    <footer className="footer muted small">
      {outdated && (
        <p>
          <button className="secondary" onClick={() => location.reload()}>
            Neue Version {serverVersion} verfügbar – neu laden
          </button>
        </p>
      )}
      ELMA {APP_VERSION} · <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">Quellcode</a> ·{" "}
      <a href={`${SOURCE_URL}/blob/HEAD/LICENSE.md`} target="_blank" rel="noopener noreferrer">
        Lizenz (PolyForm Noncommercial)
      </a>
    </footer>
  );
}
