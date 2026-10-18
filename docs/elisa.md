# ELISA-Modus: Überschuss reservieren

> **Status:** geplant (2026-10-18), noch nicht umgesetzt.
> Klickbares Mockup: [elisa-mockup.html](elisa-mockup.html). Zum Ansehen die Datei im Browser öffnen.

**ELISA** = **E**nergie für die **L**ieblingstochter: **I**hr **S**onnenstrom-**A**nteil.
Der Name gehört zur Widmung von ELMA an Elisa. Sie hat sich die Funktion gewünscht.
In der App steht auf dem Knopf „🔒 Strom reservieren“ mit dem Untertitel „ELISA-Modus“.
Im Code heißt alles neutral (`reservation`, `can_reserve`), damit das Recht auch andere Empfänger bekommen können.

## Problem

Ein Empfänger bekommt die Push-Nachricht „viel Überschuss“ und schaltet etwas ein.
Genau dann schaltet beim Erzeuger aber oft das Lastmanagement in Node-RED (LM von isem/aWATTar) die Wallbox oder die Wärmepumpe ein.
Die Einspeisung fällt auf 0, und der Empfänger bekommt doch keinen geteilten Strom.

Solange die Batterie lädt, lässt sich nichts machen. Das sieht der Empfänger aber, weil dann kein Überschuss angezeigt wird.
Ärgerlich ist der Fall, wenn die Batterie voll ist: Die Nachricht kommt, und gleichzeitig nimmt der Eigenbedarf den Überschuss weg.

## Entscheidungen

| Entscheidung | Begründung |
|---|---|
| **Tagesbudget 60 min** pro Empfänger und Erzeuger, beliebig aufteilbar (z. B. 2× 30 min) | Der Erzeuger gibt seinen Eigenverbrauch nur begrenzt auf. Dauerblockaden sind so ausgeschlossen. |
| Gezählt wird die **tatsächlich genutzte** Zeit. Wer nach 10 von 30 min beendet, hat noch 50 min übrig. | Vorzeitiges Beenden soll sich lohnen, sonst lässt man die Reservierung einfach weiterlaufen. |
| **Keine Freigabe** durch den Erzeuger nötig | Der Überschuss ist meist nur kurz da. Eine Rückfrage käme zu spät. |
| Reservieren dürfen nur Empfänger, denen der Erzeuger das **Recht pro Freigabe** gibt (`shares.can_reserve`) | Das ist ein Sonderrecht, nicht jeder Empfänger soll fremde Geräte blockieren können. |
| **Push** beim Start an den Erzeuger, beim Ende an beide | Der Erzeuger soll wissen, warum Wallbox oder WP nicht anspringen. Der Empfänger erfährt beim Ende, wie viel Budget noch übrig ist. |
| Knopf **nur in der App** (unter Status und Hinweis, vor dem Verlauf), nicht in der Push-Nachricht | Knöpfe in Web-Push zeigt nur Android an, das iPhone nicht. Also gibt es überall denselben Weg. |
| Node-RED unterdrückt nur das **automatische Einschalten** (LM), es gibt **keine EVU-Sperre** | Was schon läuft, läuft weiter. Eine laufende Ladung oder Heizung wird nicht abgebrochen. Die WP kann per Thermostat trotzdem anlaufen, das wird in Kauf genommen. |
| Steuerweg **Backend → WS `/ingest` → Bridge → MQTT → Node-RED** | Das Backend ist bewusst ohne LAN-Zugang (siehe CLAUDE.md). Die Bridge hängt ohnehin am lokalen Broker und hat schon eine WS-Verbindung zum Backend. |
| MQTT-Nachricht **retained**, Node-RED prüft `until` **selbst** | Nach einem Neustart von Node-RED liegt der Zustand sofort vor. Geht ein „Ende“ verloren (Bridge oder Backend weg), läuft die Sperre trotzdem von selbst ab. |
| Der Tag zählt nach **Europe/Vienna**, fest eingestellt. Eine Reservierung über Mitternacht zählt zum Starttag. | Die Container-Zeitzone soll keine Rolle spielen. Um Mitternacht gibt es keinen PV-Überschuss, die Vereinfachung ist also harmlos. |
| Erzeuger nur mit Shelly-Direktanschluss: Dort wirkt nur die Push-Nachricht | Ohne Bridge gibt es keinen Weg ins LAN des Erzeugers. |

## Ablauf in der App

Die einzelnen Bildschirme zeigt das [Mockup](elisa-mockup.html).

1. Der Empfänger mit Recht sieht unter dem Überschuss den gelben Knopf „🔒 Strom reservieren · ELISA-Modus“ und darunter „heute noch X min frei“.
2. Ein Tipp öffnet ein Bottom-Sheet (wie `AccountSheet`). Es enthält die Langform des Namens, die Dauer-Chips 15/30/45/60 min (über dem Restbudget gesperrt) und den Hinweis „Wallbox und Wärmepumpe schalten sich in der Zeit nicht automatisch ein“. Der Bestätigungsknopf zeigt die Endzeit, z. B. „30 min reservieren, bis 14:22“.
3. Während die Reservierung läuft, sehen alle Betrachter oben in der Karte ein Banner: „🔒 ELISA-Modus aktiv · Reserviert von … · bis 14:22 · noch 17 min“, mit Fortschrittsbalken. Reservierender und Erzeuger haben dort „Beenden“.
4. Ist das Budget verbraucht, ist der Knopf grau und nicht tippbar, mit dem Hinweis „Heute schon 60 min reserviert, morgen wieder“.
5. Der Erzeuger hat unter „Empfänger einladen“ eine Liste der Empfänger mit je einem Schalter „ELISA-Modus“.

Push-Texte:
- Start (an den Erzeuger): „🔒 … reserviert den Überschuss bis 14:22“
- Ende (an beide): „🔓 ELISA-Modus zu Ende, heute noch 30 min übrig“ bzw. „… vorzeitig beendet“

Offen: ELMA kennt von Nutzern nur die E-Mail-Adresse. Für „Elisa“ statt `elisa@…` bräuchte es einen Anzeigenamen.

## Umsetzung

### Shared (`packages/shared/src/index.ts`)
- `ReservationDto { producerId, userEmail, startsAt, endsAt }`, `RESERVATION_DAILY_MINUTES = 60`, `RESERVATION_DURATIONS = [15, 30, 45, 60]`.
- `IngestServerMessage` (Backend → Bridge): `{ type: "reservation", until: number | null, by?: string }`.
- `LiveServerMessage` zusätzlich: `{ type: "reservation", producerId, reservation: ReservationDto | null }`.
- `ProducerDto` zusätzlich: `reservation`, `canReserve`, `reserveMinutesLeft`.

### Backend
- `db.ts`:
  - `shares.can_reserve INTEGER NOT NULL DEFAULT 0` als idempotentes `ALTER TABLE` mit Prüfung über `PRAGMA table_info`.
  - Neue Tabelle `reservations (id, producer_id, user_id, starts_at, ends_at, ended_at)`. Die Historie bleibt, darüber läuft das Tagesbudget.
- `repo.ts`: `canReserve`, `setCanReserve`, `recipientsOf`, `activeReservation`, `usedMinutesOnDay` (Summe über `min(ended_at ?? ends_at, now) - starts_at`), `createReservation`, `endReservation`.
- Neu `reservations.ts` mit `ReservationService`:
  - Regeln: Recht vorhanden, Budget reicht, höchstens eine aktive Reservierung pro Erzeuger.
  - Ein Timer beendet die Reservierung bei `endsAt`. Beim Start lädt der Service aktive Reservierungen aus der DB.
  - Abonnenten sind `/live` und `/ingest`.
- `app.ts`:
  - `POST /api/producers/:id/reservation` mit `{ minutes }` (1–60): 403 ohne Recht, 409 bei zu wenig Budget oder wenn schon eine Reservierung läuft.
  - `DELETE /api/producers/:id/reservation`: für den Reservierenden und den Erzeuger.
  - `GET /api/producers/:id/recipients`, `PUT /api/producers/:id/recipients/:userId` mit `{ canReserve }`: nur für den Erzeuger.
  - `/ingest` sendet beim Verbinden und bei jeder Änderung `{type:"reservation", until, by}`.
  - `/live` sendet nach `ready` den aktuellen Stand und danach jede Änderung.
- `push.ts`: `notifyUsers(userIds, payload)` auf Basis von `sendToUser`.

### Bridge
- `backend-link.ts`: eingehende Nachrichten mit `IngestServerMessage` parsen und an einen `onReservation`-Callback geben.
- `index.ts`: retained auf `RESERVATION_TOPIC` (Standard `elma/reservation`) veröffentlichen.
  - Aktiv: `{"active":true,"until":<Unix-ms>,"by":"…"}`
  - Inaktiv: `{"active":false}`
- `config.ts` und `.env.example`: optionale Variable `RESERVATION_TOPIC`.

### Web
- `ProducerCard.tsx`: Knopf, Sheet, Banner und Empfängerliste wie oben.
- `useLive.ts`: Nachricht `reservation` verarbeiten.
- `api.ts`: neue Aufrufe.

### Doku
- README: Abschnitt unter „Was die App kann“.
- CHANGELOG: Eintrag mit den Begründungen aus der Tabelle oben.

## Node-RED (beim Erzeuger, nicht in diesem Repo)

Die Anleitung beruht auf dem Flow-Stand aus dem Backup vom 2026-02-22 (Tab „aWATTar Control“, Objekt `flow.actuators`).
Vor dem Einbau mit den aktuellen Flows abgleichen.

1. `mqtt in` auf `elma/reservation`, Ausgabe als JSON. Eine Function-Node speichert die Nachricht als `flow.set("elmaReservation", msg.payload)`.
2. Prüfung, ob eine Reservierung gilt. Sie läuft bei jedem LM-Ereignis und zusätzlich per Inject alle 5 s:
   ```js
   const r = flow.get("elmaReservation");
   const locked = !!(r && r.active && r.until > Date.now());
   ```
3. In „set LM and switch Actuator on/off“ für `wallbox` und `heatpump`: Ein LM-„on“ wird verworfen, solange `locked` gilt. Ein LM-„off“ geht wie bisher durch.
   EVU-Logik und manuelles Schalten bleiben unverändert.
4. Läuft die Reservierung ab (`until` vorbei oder `active:false`), wird der zuletzt gewünschte LM-Zustand nachgeholt. Sonst bleibt ein inzwischen fälliges Einschalten aus.

## Tests

- `apps/backend/test/reservations.test.ts`:
  - Ohne Recht → 403. 61 min → 400.
  - 2× 30 min → ok, danach 15 min → 409.
  - 30 min gestartet, nach 10 min beendet → noch 50 min frei.
  - Neuer Tag nach Europe/Vienna → wieder 60 min.
  - Automatischer Ablauf mit Fake-Timern.
  - Push beim Start nur an den Erzeuger, beim Ende an beide.
- `apps/backend/test/app.test.ts`:
  - `/ingest` bekommt den Stand nach dem Verbinden.
  - `/live` bekommt Start und Ende.
  - Nur der Erzeuger kann `can_reserve` setzen.
- `apps/bridge/test/`: Parser für `IngestServerMessage` und MQTT-Payload.
- End-to-End mit `dev/docker-compose.dev.yml`: `mosquitto_sub -t elma/reservation -v` zeigt die retained Nachricht, nach Ablauf oder „Beenden“ dann `active:false`.
