/** Adresse des Quellcodes; beim Build über VITE_SOURCE_URL überschreibbar (z. B. für einen Fork). */
const SOURCE_URL = import.meta.env.VITE_SOURCE_URL ?? "https://github.com/womat/elma";

export function Footer() {
  return (
    <footer className="footer muted small">
      ELMA · <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">Quellcode</a> ·{" "}
      <a href={`${SOURCE_URL}/blob/master/LICENSE.md`} target="_blank" rel="noopener noreferrer">
        Lizenz (PolyForm Noncommercial)
      </a>
    </footer>
  );
}
