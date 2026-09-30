# ELMA – Energie Lokal Miteinander Austauschen

ELMA zeigt einem Empfänger live den Stromüberschuss eines Erzeugers.
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
docker compose -f dev/docker-compose.dev.yml exec backend node src/cli.ts create-user ich@example.com 'mein-passwort'
```

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

Dann http://localhost:3000 öffnen und anmelden.

## Produktiv im Heimnetz

1. Das Repo auf das Gerät im LAN kopieren und `cp .env.example .env` ausführen.
   Danach `MQTT_TOPIC`, das Payload-Format (siehe unten) und `JWT_SECRET` setzen, z. B. mit `openssl rand -hex 32`.
2. Das Backend starten und die Zugänge anlegen:
   ```bash
   docker compose up -d --build backend
   ```
   ```bash
   docker compose exec backend node src/cli.ts create-user ich@example.com 'mein-passwort'
   ```
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
4. **Cloudflare Tunnel** einrichten (kostenlos, braucht eine Domain bei Cloudflare):
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
