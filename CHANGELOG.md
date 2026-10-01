# Changelog

Alle Versionen folgen [Semantic Versioning](https://semver.org/lang/de/). Zu jeder Version gibt es einen Git-Tag `vX.Y.Z`.

## Unveröffentlicht

- **ELMA-Box abgeschottet** wie der Haupt-Stack:
  - Backend nur im internen Docker-Netz, Push über den Push-Proxy, kein Port im LAN.
  - Der Cloudflare Tunnel ist Pflicht; `setup.sh` fragt nicht mehr nach einem Port und verlangt Token und `https://`-Adresse.
    Ein reiner LAN-Betrieb ging seit den Passkeys ohnehin nicht mehr.
  - Mosquitto bleibt für Quellen im LAN erreichbar, das Backend kommt aber nicht an ihn heran.
- **Release-Workflow:** baut zusätzlich das Image `ghcr.io/womat/elma-push-proxy`.

## 0.6.1 – 2026-10-01

- **Push nach Kontowechsel:** Beim Abmelden wird das Push-Abo des Geräts jetzt abgemeldet.
  Vorher bekam ein Gerät nach einem Kontowechsel weiter die Nachrichten des alten Kontos.
  Nach dem nächsten Anmelden schaltet man die Benachrichtigungen unter *Meine Geräte* wieder ein.

## 0.6.0 – 2026-10-01

- **Abgeschottetes Backend:** Das Backend hängt nur noch in einem internen Docker-Netz.
  Es erreicht weder das Heimnetz noch das Internet, ein Eindringling käme also nicht an andere Dienste im LAN
  (z. B. InfluxDB, Node-RED-Dashboard, MQTT).
  - Neuer **Push-Proxy** (`apps/push-proxy`): lässt nur Verbindungen zu den Push-Diensten der Browser durch.
  - Push-Abos werden nur noch mit Adressen dieser Push-Dienste angenommen. Vorher konnte ein angemeldeter User
    das Backend Anfragen an beliebige Adressen schicken lassen.
  - ELMA hat keinen Port mehr am Gerät (`ELMA_PORT` entfällt), erreichbar ist es nur über den Tunnel.

## 0.5.1 – 2026-10-01

- **Anmeldung besser gegen Fluten geschützt:**
  - Das Rate-Limit zählt jetzt pro echter Absender-Adresse (`CF-Connecting-IP` von Cloudflare).
    Ein gefälschtes `X-Forwarded-For` hebelt es nicht mehr aus, im Log steht ebenfalls die echte Adresse.
  - Es gibt höchstens 1000 offene Anmelde-Challenges gleichzeitig, der Speicher bleibt also begrenzt.
  - In [docs/cloudflare.md](docs/cloudflare.md) steht, wie man zusätzlich eine kostenlose Rate-Limiting-Regel bei Cloudflare anlegt.

## 0.5.0 – 2026-10-01

- **Anmeldung nur mit Passkey:** per Fingerabdruck, Gesicht oder Geräte-PIN. Die Anmeldung mit E-Mail und Passwort entfällt.
  - Neue Konten gibt es weiterhin nur per Einladungslink. Man gibt die E-Mail ein und legt den Passkey an.
  - Wer noch angemeldet ist, aber keinen Passkey hat, sieht in der App den Hinweis „Passkey einrichten“.
  - Über das Schlüssel-Symbol in der Kopfzeile lassen sich die eigenen Passkeys ansehen, hinzufügen und löschen.
    Den letzten kann man nicht löschen.
  - Gespeichert wird nur der öffentliche Schlüssel. Die alten Passwort-Hashes werden beim ersten Start gelöscht.
  - Wer noch keinen Passkey hat, bekommt vom Betreiber einen Einrichtungslink (`setup-link <email>`).
- **CLI:**
  - `create-user <email>` gibt einen Einrichtungslink für den Passkey aus, statt ein Passwort abzufragen.
  - Neu `setup-link <email>` (neues Handy, Passkey verloren) und `list-users` (wer hat schon einen Passkey).
- **Sicherung beim Ausrollen:** `scripts/deploy.sh` sichert vorher die Datenbank nach `~/elma-backups/` auf dem Pi
  und behält die letzten 10 Sicherungen.

## 0.4.1 – 2026-10-01

- **Verlauf im Reiter Leistung** mit beschrifteter Y-Achse (z. B. 0 W / 1,5 kW / 3 kW) und dezenten Hilfslinien.
  Die Skala rundet auf glatte Werte auf.
- Widmung im README.

## 0.4.0 – 2026-10-01

- **Bunte Geräte-Icons:** Jedes Gerät zeigt sein Icon weiß auf einem Kreis in der Farbe seiner Gruppe.
  Küche ist orange, Haushalt blau, Heizen und Wasser rot, Unterhaltung lila, Werkstatt und Garten grün, Mobilität und Energie bernsteinfarben.
  Geht ein Gerät gerade nicht, ist der Kreis grau.
- **Einheitliche Oberfläche:** Die restlichen Emojis sind durch Linien-Icons ersetzt: Reiter, Glocke, Häkchen, Warnhinweise, Stift und Schließen.
  „Meine Geräte“ ist jetzt ein richtiger Button.
- **Andere Erzeuger hosten:** Das Konzept dafür steht in [docs/hosting.md](docs/hosting.md), mit Diagrammen und Checklisten.
  Es gibt zwei Modelle: zentral auf der eigenen Instanz oder als eigene ELMA-Box einer Gemeinschaft.
- **Shelly direkt anbinden:** Neuer Endpunkt `/ingest/shelly/<token>` für Shelly Gen2+ (z. B. Pro 3EM) über Outbound WebSocket.
  Beim Erzeuger braucht es dafür keinen Pi, keinen Broker und keine Bridge.
  Einspeisung zählt als Überschuss, die Werte werden wie bei der Bridge gedrosselt.
  Mit einem echten Shelly ist das noch nicht getestet.
- **Token nicht im Log:** Das Geräte-Token im Pfad erscheint im Log nur als `/ingest/shelly/***`.
- **CLI:**
  - `create-producer` gibt zusätzlich die Shelly-URL aus.
  - Neu ist `rotate-token <producerId>`: Es erzeugt ein neues Geräte-Token, das alte ist sofort ungültig.
  - Die Zeile `DEVICE_TOKEN=…` steht allein und lässt sich 1:1 in die `.env` kopieren.
- **ELMA-Box** (`deploy/box/`): eigene Instanz aus fertigen Images, ohne Build auf dem Gerät.
  - Compose-Datei mit optionalem Mosquitto (nur mit Passwort) und Bridge.
  - Einrichtung im Dialog mit `setup.sh`.
  - Gemessener Speicherbedarf unter 150 MB, damit läuft sie auch auf einem Pi Zero 2 W.
- **Release-Workflow** (`.github/workflows/release.yml`), nur von Hand zu starten: Er testet und baut dann die Images für amd64 und arm64 nach `ghcr.io/womat/elma-backend` und `-bridge`.
- Intern: Die Drossel (`Throttle`) liegt jetzt in `@elma/shared` und wird von Bridge und Backend gemeinsam genutzt.

## 0.3.0 – 2026-10-01

- **Geräte-Icons statt Emojis:** Alle Geräte nutzen jetzt einheitliche Linien-Icons ([Lucide](https://lucide.dev), Lizenz ISC).
  Geht ein Gerät, ist das Icon grün, sonst grau.
- **64 Icons für eigene Geräte** in sechs Gruppen: Küche, Haushalt & Wäsche, Heizen/Kühlen/Wasser, Unterhaltung & Büro, Werkstatt & Garten, Mobilität & Energie.
  Darunter sind Waschmaschine, Kühlschrank, Heizlüfter, Klimaanlage, Saugroboter, Wallbox, Pumpe, Pool und Solar.
- **Icon-Vorschlag nach Name:** z. B. „Infrarotheizung“ → Heizlüfter, „Wallbox“ → Wallbox, „Teichpumpe“ → Teich.
- Bestehende eigene Geräte mit Emoji werden automatisch auf passende Icons abgebildet. Eine Datenbank-Umstellung ist nicht nötig.
- Push-Nachrichten nennen nur noch den Gerätenamen, z. B. „Jetzt reicht's für Waschmaschine“.

## 0.2.1 – 2026-10-01

- Die Anzeige „vor x s“ in der Karte des Erzeugers ist entfernt.
  Die Offline-Erkennung prüft nur noch alle 10 s statt jede Sekunde.

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
