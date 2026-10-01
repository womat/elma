# Changelog

Alle Versionen folgen [Semantic Versioning](https://semver.org/lang/de/). Zu jeder Version gibt es einen Git-Tag `vX.Y.Z`.

## 0.2.0 – 2026-10-01

- **Geglättete Anzeige:** Der Überschuss wird über 2 Minuten zeitgewichtet gemittelt (`SMOOTH_WINDOW_MS`).
  Kurze Regelspitzen lassen die Anzeige und die Push-Nachrichten nicht mehr springen.
- **Geräte-Verlauf:** In der Geräte-Ansicht zeigt ein Balkenverlauf der letzten 24 Stunden die Stufen *nix*, *ein wenig* und *viel*, passend zu den eigenen Geräten.
  Dazu kommt „Am meisten Überschuss: …“, und ein Antippen eines Balkens zeigt Details.
- **Push-Hinweis**, wenn Benachrichtigungen aktiv sind, aber kein Gerät 🔔 hat.
- **Erzeuger umbenennen** in der App (✏️, nur Eigentümer) und per CLI `rename-producer`.
- **Version** im Footer und in `/api/health`.
  Ist die App am Handy veraltet, erscheint „Neue Version verfügbar – neu laden“.
- **Deployment** mit `scripts/deploy.sh`: Die Version wird aus `git describe` vergeben, nach dem Start wird sie geprüft.
- Port im LAN einstellbar (`ELMA_PORT`), Broker am selben Gerät über `host.docker.internal`.
- `create-user` fragt das Passwort verdeckt ab.

## 0.1.0 – 2026-10-01

- Erste Version:
  - Bridge (MQTT → Backend)
  - Backend mit Login, Einladungen, Live-Werten, Verlauf und Web-Push
  - PWA mit Leistungs- und Geräte-Ansicht und eigenen Geräten
  - Docker-Compose mit Cloudflare Tunnel
