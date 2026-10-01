import { useEffect, useState } from "react";
import { api } from "./api.ts";

/** Adresse des Quellcodes; beim Build über VITE_SOURCE_URL überschreibbar (z. B. für einen Fork). */
const SOURCE_URL = import.meta.env.VITE_SOURCE_URL ?? "https://github.com/womat/elma";
/** Version dieses Frontends, beim Build gesetzt (siehe vite.config.ts) */
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? "dev";

export function Footer() {
  // Läuft am Server schon eine neuere Version, hat das Handy evtl. noch die alte App im Cache
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
      <a href={`${SOURCE_URL}/blob/master/LICENSE.md`} target="_blank" rel="noopener noreferrer">
        Lizenz (PolyForm Noncommercial)
      </a>
    </footer>
  );
}
