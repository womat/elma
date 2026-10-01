# ELMA – Energie Lokal Miteinander Austauschen

> *Dieses Projekt ist meiner Tochter Elisa gewidmet.*

**Wenn die Sonne scheint, produziert eine PV-Anlage oft mehr Strom, als der Haushalt gerade braucht.**
Dieser Überschuss wird meist für wenige Cent ins Netz eingespeist.
Gleich nebenan zahlen Nachbarn, Familie oder Freunde für ihren Strom den vollen Preis.
Sie wissen aber nicht, *wann* es sich lohnen würde, die Waschmaschine einzuschalten.

### Die Idee: Strom im Peer-to-Peer-Netz teilen

Auslöser für ELMA ist das **Peer-to-Peer-Teilen von Strom**.
Haushalte sind dabei nicht mehr nur Kunden eines Energieversorgers.
Sie geben ihren Strom direkt untereinander weiter, *von Nachbar zu Nachbar*.
Der Strom fließt weiter über das öffentliche Netz, verbraucht und verrechnet wird er aber zwischen den Teilnehmern selbst.

In Österreich gibt es dafür seit 1. Oktober 2026 die **[Peer-to-Peer-Verträge (P2P)](https://energiegemeinschaften.gv.at/peer-to-peer-vertraege/)** nach dem neuen Elektrizitätswirtschaftsgesetz (ElWG).
- Zwei oder mehr Personen schließen sich zusammen, um ihren selbst erzeugten Strom gemeinsam zu nutzen.
- Dafür reicht ein **Vertrag**. Anders als bei einer Energiegemeinschaft muss kein Verein und keine Genossenschaft gegründet werden.
- Es gibt Mustervorlagen für einen Erzeuger mit einem oder mehreren Abnehmern (1:1 / 1:n). Das ist genau der Fall, für den ELMA gebaut ist.

Laut der Seite ist die Umsetzung vorerst nur zwischen Zählpunkten beim selben Netzbetreiber möglich.
Vergünstigte Netzentgelte sollen ab 2027 gelten.
Der aktuelle Stand steht auf [energiegemeinschaften.gv.at](https://energiegemeinschaften.gv.at/peer-to-peer-vertraege/).
Dasselbe Prinzip gilt auch für Energiegemeinschaften (EEG/BEG).

Dabei fehlt eine Kleinigkeit: **Das Teilen funktioniert nur, wenn der Empfänger den Strom genau dann verbraucht, wenn er erzeugt wird.**
Strom lässt sich im Netz nicht „aufheben“.
Der Überschuss der PV-Anlage am Mittag ist nur dann geteilter Strom, wenn nebenan in diesem Moment die Waschmaschine läuft.
Ohne Information darüber wird dem Zufall überlassen, was man sich teilt.

ELMA schließt diese Lücke:
- Der **Erzeuger** teilt seinen aktuellen Stromüberschuss.
- Die **Empfänger** im Peer-to-Peer-Netz sehen ihn live am Handy und legen ihren Verbrauch gezielt in diese Zeit.
- So wird aus dem Teilen auf dem Papier tatsächlich geteilter Sonnenstrom.
  Mehr Strom bleibt lokal, das Netz wird entlastet, und beide Seiten profitieren.

ELMA übernimmt dabei nicht die Verrechnung. Die läuft wie bisher über die Energiegemeinschaft bzw. den Netzbetreiber.
ELMA liefert die Information, *wann* sich das Teilen lohnt.

### Was die App kann

- **Live-Anzeige des Überschusses:** eine große Zahl mit Ampel (viel / etwas / kein Überschuss) und dem Verlauf der letzten 24 Stunden.
- **Geräte statt Watt:** Viele können mit „1,4 kW“ wenig anfangen.
  Deshalb zeigt ELMA mit Symbolen, was gerade möglich ist, z. B. „✓ 🧺 Waschmaschine“ oder „noch 650 W bis 🫖 Wasserkocher“.
  Jeder wählt seine eigenen Geräte aus und kann auch eigene anlegen, z. B. eine Poolpumpe mit 800 W.
- **Push-Nachricht:** z. B. „Jetzt reicht's für 🧺 Waschmaschine“, sobald eines der eigenen Geräte mit dem Überschuss laufen kann.
  Das passiert erst nach 2 Minuten stabilem Überschuss, damit kurze Wolken keinen Fehlalarm auslösen.
- **Einladung per Link:** Der Erzeuger lädt Empfänger mit einem Link ein, z. B. über WhatsApp.
  Ohne Einladung kann sich niemand registrieren, die Daten bleiben also im kleinen Kreis.
- **Anmelden mit Passkey:** per Fingerabdruck, Gesicht oder Geräte-PIN. Ein Passwort gibt es nicht.
- **Wie eine App am Handy:** Die App lässt sich auf Android und iPhone über „Zum Startbildschirm hinzufügen“ installieren.
  Kein App Store ist nötig.
- **Läuft zuhause:** Die Daten kommen direkt vom eigenen Energiemanager, z. B. Smartfox über MQTT.
  ELMA läuft auf einem Raspberry Pi im Heimnetz und ist über einen Cloudflare Tunnel erreichbar.
  Es fallen keine Cloud-Kosten an, und es müssen keine Ports geöffnet werden.

## Aufbau

Der Überschuss wird aus einem MQTT-Topic des lokalen Brokers `mysmarthome` gelesen.

```
[Heimnetz, ein Docker-Gerät z. B. Raspberry Pi]
  mysmarthome (MQTT) ──▶ bridge ──WebSocket──▶ backend (API + App) ◀── cloudflared
                                                                          │ (ausgehender Tunnel)
[Internet]                                   https://elma.deine-domain.at ◀┘  ◀── Handy (PWA)
```

- **bridge** (`apps/bridge`): abonniert das Topic, rechnet den Wert auf Watt um und schickt ihn ans Backend.
  Es wird höchstens alle 5 s gesendet, bei Sprüngen ab 50 W sofort.
- **backend** (`apps/backend`): Fastify + SQLite (`node:sqlite`).
  Es verwaltet Login, Einladungen und Freigaben, verteilt Live-Werte per WebSocket, speichert Minutenmittel (30 Tage)
  und liefert die App aus.
- **web** (`apps/web`): React-PWA. Am Handy lässt sie sich über „Zum Startbildschirm hinzufügen“ wie eine App installieren.
- **shared** (`packages/shared`): gemeinsame Typen und Schemas.

Im Heimnetz müssen keine Ports geöffnet werden: Der Cloudflare Tunnel baut die Verbindung von innen nach außen auf.

## Lokal testen (ohne echten Broker)

Voraussetzung ist nur Docker.

```bash
docker compose -f dev/docker-compose.dev.yml up -d --build mosquitto backend
```

```bash
docker compose -f dev/docker-compose.dev.yml exec backend node src/cli.ts create-user ich@example.com
```

Das gibt einen Einrichtungslink aus. Darüber legst du im Browser deinen Passkey an.
Passkeys funktionieren auf `localhost` auch ohne HTTPS.

```bash
docker compose -f dev/docker-compose.dev.yml exec backend node src/cli.ts create-producer "PV Dach" ich@example.com
```

Das ausgegebene Token starten wir mit der Bridge:

```bash
DEVICE_TOKEN=<token> docker compose -f dev/docker-compose.dev.yml up -d bridge
```

Einen Testwert von 2300 W schicken:

```bash
docker compose -f dev/docker-compose.dev.yml exec mosquitto mosquitto_pub -t elma/test/surplus -m 2300
```

Dann den Einrichtungslink öffnen (http://localhost:3000/?setup=…) und den Passkey anlegen.

## Produktiv im Heimnetz

1. Das Repo auf das Gerät im LAN kopieren und `cp .env.example .env` ausführen.
   Danach `MQTT_TOPIC`, das Payload-Format (siehe unten) und `JWT_SECRET` setzen, z. B. mit `openssl rand -hex 32`.
2. Das Backend starten und die Zugänge anlegen:
   ```bash
   docker compose up -d --build backend
   ```
   ```bash
   docker compose exec backend node src/cli.ts create-user ich@example.com
   ```
   Das gibt einen **Einrichtungslink** aus. Damit legst du am Handy deinen Passkey an.
   Das geht erst über die öffentliche HTTPS-Adresse, also nach Schritt 4.
   ```bash
   docker compose exec backend node src/cli.ts create-producer "PV Dach" ich@example.com
   ```
   Das ausgegebene `DEVICE_TOKEN` in die `.env` eintragen.
3. Die Bridge starten und prüfen, ob Werte ankommen:
   ```bash
   docker compose --profile bridge up -d bridge
   ```
   ```bash
   docker compose logs -f bridge
   ```
4. **Cloudflare Tunnel** einrichten (kostenlos, braucht eine Domain bei Cloudflare).
   Ausführliche Anleitung mit Stolperfallen: [docs/cloudflare.md](docs/cloudflare.md).
   - Im Cloudflare-Dashboard unter *Zero Trust → Networks → Tunnels* einen Tunnel anlegen (Typ *Cloudflared*).
     Das Token kommt als `CLOUDFLARE_TUNNEL_TOKEN` in die `.env`.
   - Einen *Public Hostname* anlegen, z. B. `elma.deine-domain.at` → Service `http://backend:3000`.
   - `PUBLIC_URL=https://elma.deine-domain.at` in der `.env` setzen und dann starten:
     ```bash
     docker compose --profile bridge --profile tunnel up -d
     ```

   Ohne eigene Domain reicht zum Ausprobieren ein Quick-Tunnel mit einer zufälligen `*.trycloudflare.com`-Adresse:
   ```bash
   docker run --rm --network elma_default cloudflare/cloudflared tunnel --url http://backend:3000
   ```

## Neue Version ausrollen

Die Version steht in der Root-`package.json` (SemVer). Zu jedem Release gehört ein Git-Tag.

1. In `package.json` (und den Paketen unter `apps/*`, `packages/*`) die Version erhöhen und `CHANGELOG.md` ergänzen.
2. Committen und taggen:
   ```bash
   git tag v0.3.0
   ```
3. Pushen:
   ```bash
   git push --follow-tags
   ```
4. Auf den Pi ausrollen:
   ```bash
   scripts/deploy.sh
   ```

Das Skript bricht ab, wenn es nicht committete oder nicht gepushte Änderungen gibt.
Es vergibt die Version aus `git describe` (z. B. `v0.3.0`, oder `v0.3.0-2-gabc1234` für Zwischenstände) und ersetzt den Code auf dem Pi.
Die `.env` und die Daten bleiben dabei erhalten.
Danach baut es die Container neu und prüft über `https://my-elma.net/api/health`, dass die neue Version läuft.
Die laufende Version steht in der App ganz unten.

## Payload-Format einstellen

| Payload im Topic                | `.env`                                  |
| ------------------------------- | --------------------------------------- |
| `1234` (Watt)                   | `PAYLOAD_UNIT=W`                        |
| `1.23` (Kilowatt)               | `PAYLOAD_UNIT=kW`                       |
| `{"data":{"surplus": 1234}}`    | `PAYLOAD_PATH=data.surplus`             |
| `-1234` (Einspeisung negativ)   | `PAYLOAD_INVERT=true`                   |

Findet die Bridge keine Zahl, schreibt sie eine Warnung mit der Payload ins Log.
So lässt sich das Format schnell herausfinden.

## Empfänger einladen

Melde dich als Erzeuger in der App an und tippe auf **„Empfänger einladen“**.
Am Handy öffnet sich direkt „Teilen“ (WhatsApp, Signal, Mail usw.).
Der Link ist 7 Tage gültig und nur einmal verwendbar.
Der Empfänger legt damit sein Konto an; ohne Einladung ist keine Registrierung möglich.
Alternativ geht das auch per Kommandozeile:

```bash
docker compose exec backend node src/cli.ts invite <producerId>
```

## Anmeldung mit Passkey

ELMA kennt keine Passwörter. Angemeldet wird mit einem **Passkey**: Das Handy speichert einen Schlüssel für ELMA,
und man bestätigt per Fingerabdruck, Gesicht oder Geräte-PIN. Auf dem Server liegt nur der öffentliche Schlüssel.

- **Neues Konto:** über einen Einladungslink. Man gibt die E-Mail ein und tippt auf „Passkey anlegen“.
- **Erster Zugang** für den Betreiber: `create-user <email>` gibt einen Einrichtungslink aus.
- **Neues Handy, Passkey verloren oder Konto aus der Passwort-Zeit:** Einen neuen Einrichtungslink erzeugen.
  Er ist 7 Tage gültig und nur einmal verwendbar.
  Wer den Link hat, kann sich als dieser User anmelden, deshalb nur über einen sicheren Kanal weitergeben.
  ```bash
  docker compose exec backend node src/cli.ts setup-link <email>
  ```
- **Wer hat schon einen Passkey?**
  ```bash
  docker compose exec backend node src/cli.ts list-users
  ```
- **Weitere Geräte:** Über das Schlüssel-Symbol oben in der App lassen sich Passkeys ansehen, hinzufügen und löschen.
  Über das Google- bzw. Apple-Konto sind sie meist ohnehin auf allen eigenen Geräten.
  Am PC kann man sich auch anmelden, indem man den angezeigten QR-Code mit dem Handy scannt.
- Passkeys sind an die Domain gebunden (z. B. `my-elma.net`). Bei einem Umzug auf eine andere Domain müssen alle neu angelegt werden.
  Über die LAN-Adresse (`http://192.168.…`) funktionieren sie nicht, nur über HTTPS oder `localhost`.

## Datenbank sichern und wiederherstellen

`scripts/deploy.sh` sichert vor jedem Ausrollen die Datenbank nach `~/elma-backups/` auf dem Pi.
Die letzten 10 Sicherungen bleiben erhalten, der Dateiname enthält Datum und bisherige Version.

Wiederherstellen, z. B. nach einem Zurücksteigen auf eine ältere Version:

```bash
cd ~/elma && docker compose stop backend
```

```bash
docker compose cp ~/elma-backups/<datei>.db backend:/data/elma.db
```

```bash
docker compose run --rm --no-deps --entrypoint rm backend -f /data/elma.db-wal /data/elma.db-shm
```

```bash
docker compose start backend
```

## Push-Benachrichtigungen

Aktiviert werden sie in der App unter **Geräte → ⚙️ Meine Geräte → 🔔 Benachrichtigungen**.
Dort markiert man die Geräte, für die man benachrichtigt werden will, z. B. „Jetzt reicht's für 🧺 Waschmaschine“.

- Eine Nachricht kommt erst, wenn das Gerät **2 Minuten durchgehend** laufen könnte. Kurze Wolken lösen also nichts aus.
- Pro Überschuss-Phase kommt höchstens eine Nachricht, und frühestens nach 1 Stunde wieder.
  Eine neue Phase beginnt erst, wenn der Überschuss unter 80 % der Geräteleistung gefallen ist.
- Die Schlüssel (VAPID) erzeugt das Backend beim ersten Start selbst und speichert sie in der Datenbank.
  In der `.env` gehört nur `VAPID_SUBJECT=mailto:deine@email.at` gesetzt.
- Web-Push braucht HTTPS, also den Cloudflare Tunnel (oder `localhost` zum Testen).
- **Android:** funktioniert in Chrome direkt.
- **iPhone:** funktioniert erst, nachdem ELMA auf dem Home-Bildschirm installiert ist (iOS 16.4 oder neuer).

## Am Handy installieren

- **Android:** Den Link in Chrome öffnen, dann *Menü ⋮ → „App installieren“* bzw. „Zum Startbildschirm hinzufügen“ wählen.
- **iPhone:** Den Link in Safari öffnen, dann *Teilen → „Zum Home-Bildschirm“* wählen.

## Entwicklung

Node ≥ 24 und pnpm werden gebraucht; alternativ läuft alles im Container, siehe unten.

```bash
pnpm install
```

```bash
pnpm test
```

```bash
pnpm typecheck
```

Ohne lokales Node laufen die Tests so im Container:

```bash
docker run --rm -v "$PWD":/app -w /app node:24-alpine sh -c "corepack enable && pnpm install && pnpm test"
```

## Andere hosten / selbst betreiben

Auch andere Haushalte können als Erzeuger mitmachen: mit einem Shelly Pro 3EM, zentral auf deiner Instanz oder mit einer eigenen ELMA-Box.
Konzept, Diagramme und Checkliste stehen in **[docs/hosting.md](docs/hosting.md)**.

## Nächste Schritte

- Android-App im Play Store über Capacitor (gleicher Code)
- Mehrere Erzeuger/Empfänger (Energiegemeinschaft); das Datenmodell ist dafür schon vorbereitet

## Lizenz

Copyright © 2026 Wolfgang Mathe

ELMA steht unter der **PolyForm Noncommercial License 1.0.0**, siehe [LICENSE.md](LICENSE.md).
Der Quellcode ist einsehbar, ELMA ist aber **keine Open-Source-Software** im engeren Sinn: Kommerzielle Nutzung ist nicht erlaubt.

**Erlaubt**, jeweils nicht-kommerziell:
- private Nutzung, z. B. im eigenen Haushalt, mit Nachbarn oder Freunden
- Nutzung durch gemeinnützige Organisationen, Schulen und Hochschulen, öffentliche Forschung, Umweltschutzorganisationen und Behörden
- ändern und weitergeben, jeweils mit dieser Lizenz und dem Copyright-Hinweis

**Nicht erlaubt** ohne Zustimmung des Urhebers:
- kommerzielle Nutzung, z. B. durch Unternehmen, als bezahlter Dienst oder in einem verkauften Produkt

Für eine kommerzielle Nutzung bitte Kontakt aufnehmen; eine separate Lizenz ist möglich.

Das Programm wird ohne jede Gewährleistung bereitgestellt.
