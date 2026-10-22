# ELISA-Modus: Überschuss reservieren

> **Status:** Plan vollständig (2026-10-21). Phase 1 (Anzeigename) ist mit 0.7.0 umgesetzt, Phase 2 (Reservierung in ELMA) mit 0.8.0, der ELMA-Teil von Phase 4 (Bridge → `elma/reservation`) mit 0.9.0. Node-RED (Phase 3) ist gebaut und läuft im Probebetrieb. Offen sind das Scharfschalten in Node-RED und MAGGIE (siehe [Umsetzungsreihenfolge](#umsetzungsreihenfolge)).
> Was bei der Umsetzung vom Plan abweicht oder neu entschieden wurde, steht unter [Umgesetzt in 0.8.0](#umgesetzt-in-080-phase-2) und [Umgesetzt: Phase 4, ELMA-Teil](#umgesetzt-phase-4-elma-teil).
> Mockups (Datei im Browser öffnen):
> - [elisa-mockup.html](elisa-mockup.html): klickbarer Ablauf in ELMA
> - [elisa-szenarien.html](elisa-szenarien.html): sieben Szenarien nebeneinander für Elisa (ELMA), Wolfgang (ELMA) und Margit (MAGGIE)

**ELISA** = **E**nergie für die **L**ieblingstochter: **I**hr **S**onnenstrom-**A**nteil.
Der Name gehört zur Widmung von ELMA an Elisa. Sie hat sich die Funktion gewünscht.
In der App steht auf dem Knopf „🔒 Strom reservieren“ mit dem Untertitel „ELISA-Modus“.
Im Code heißt alles neutral (`reservation`, `can_reserve`), damit das Recht auch andere Empfänger bekommen können.

## Problem

Ein Empfänger bekommt die Push-Nachricht „viel Überschuss“ und schaltet etwas ein.
Genau dann springt beim Erzeuger aber oft die Wallbox oder die Wärmepumpe an. Die Einspeisung fällt auf 0, und der Empfänger bekommt doch keinen geteilten Strom.

Solange die Batterie lädt, lässt sich nichts machen. Das sieht der Empfänger aber, weil dann kein Überschuss angezeigt wird.
Ärgerlich ist der Fall, wenn die Batterie voll ist: Die Nachricht kommt, und gleichzeitig nimmt der Eigenbedarf den Überschuss weg.

## Beteiligte Systeme

| System | Rolle | Doku |
|---|---|---|
| **ELMA** (dieses Repo) | Reservierung anfordern, Regeln, Budget, Push an Empfänger und Erzeuger | dieses Dokument |
| **Node-RED** ([womat/myhome](https://github.com/womat/myhome)) | hält Wallbox und Wärmepumpe zurück, meldet den Gerätezustand an ELMA | `KONZEPT-ELISA.md` in myhome |
| **MAGGIE** ([womat/maggie](https://github.com/womat/maggie)) | Strom-Ampel im Haus des Erzeugers, zeigt die Reservierung an und benachrichtigt Margit | `docs/KONZEPT.md` in maggie, Abschnitt zu ELISA |

```
Handy (Elisa) ──HTTPS──► ELMA-Backend ◄──HTTPS, alle 15 s── Node-RED ──► Wallbox (Fritz!DECT), WP (relay2)
                              │           Status hin, Reservierung zurück
                              └──WS /ingest──► ELMA-Bridge ──MQTT retained elma/reservation──► MAGGIE (nur Anzeige)
```

## Entscheidungen

| Entscheidung | Begründung |
|---|---|
| **Tagesbudget 60 min** pro Empfänger und Erzeuger, beliebig aufteilbar (z. B. 2× 30 min) | Der Erzeuger gibt seinen Eigenverbrauch nur begrenzt auf. Dauerblockaden sind so ausgeschlossen. |
| Gezählt wird die **tatsächlich genutzte** Zeit. Wer nach 10 von 30 min beendet, hat noch 50 min übrig. | Vorzeitiges Beenden soll sich lohnen, sonst lässt man die Reservierung einfach weiterlaufen. |
| **Keine Freigabe** durch den Erzeuger nötig | Der Überschuss ist meist nur kurz da. Eine Rückfrage käme zu spät. |
| Reservieren dürfen nur Empfänger, denen der Erzeuger das **Recht pro Freigabe** gibt (`shares.can_reserve`) | Das ist ein Sonderrecht, nicht jeder Empfänger soll fremde Geräte blockieren können. |
| **Recht entzogen oder Freigabe gelöscht**, während eine Reservierung läuft: Sie endet sofort, und beide bekommen die Ende-Push. | Ein entzogenes Recht soll nicht noch bis zu einer Stunde weiterwirken. |
| **Höchstens eine aktive Reservierung pro Erzeuger.** Ein zweiter Berechtigter bekommt 409 („Gerade reserviert von … bis 14:22“) und sieht das Banner ohne „Beenden“. | Zwei Sperren für dieselben Geräte bringen nichts, und das Budget soll nicht doppelt laufen. |
| **Abgelehnt**, wenn beim Anfordern der **Kompressor der WP läuft** oder die **Wallbox lädt** (von Hand, per Preis-Freigabe oder per Abfahrtsplanung). Es wird kein Budget verbraucht. | Was läuft, ist im angezeigten Überschuss schon abgezogen. Eine Reservierung würde nur Budget kosten, ohne etwas zu schützen. Laufende Geräte werden nie abgebrochen. |
| Der Knopf ist dann **vorab grau mit Grund** („Gerade nicht möglich: Wärmepumpe läuft“ bzw. „… das Auto lädt“). Der Server prüft beim Anfordern trotzdem noch einmal. | Elisa soll nicht erst nach dem Tippen erfahren, dass es nicht geht. Der Status ist bis zu 15 s alt, daher die zweite Prüfung. |
| **Beginnt während der Reservierung eine Ladung** (z. B. der Erzeuger steckt das Auto von Hand an), endet die Reservierung sofort, mit Push an beide. Die ungenutzte Zeit geht zurück ins Budget. | Die Handbedienung des Erzeugers hat Vorrang. Die Reservierung schützt dann nichts mehr. |
| **Knopf auch bei 0 W benutzbar** | Eine Wolke zieht vorbei, der Überschuss kommt gleich wieder. |
| **Ohne Kontakt zu Node-RED** (seit 60 s kein Status) bleibt Reservieren möglich, mit dem Hinweis „Die Sperre wirkt gerade nicht, Wolfgang bekommt nur eine Info“. Ablehnungen gibt es dann nicht. | Ein Ausfall der Hausautomation soll ELMA nicht blockieren. Der Hinweis verhindert falsche Erwartungen. |
| **Elisa werden keine Geräte genannt**: „Solange du reservierst, bleibt der Überschuss für dich frei.“ Der Erzeuger liest „keine großen Verbraucher einschalten“. | Zugesagt wird mehr als die Automatik: Der Haushalt des Erzeugers schaltet in der Zeit auch von Hand nichts Großes ein, nicht nur Wallbox und WP (Wolfgang, 2026-10-21). Node-RED hält nur Wallbox und WP zurück, alles andere ist eine Absprache im Haus, dafür benachrichtigt MAGGIE Margit. |
| **Push** beim Start an den Erzeuger, beim Ende an beide | Der Erzeuger soll wissen, warum Wallbox oder WP nicht anspringen. Der Empfänger erfährt beim Ende, wie viel Budget noch übrig ist. |
| **Anzeigename im Konto** (`users.display_name`), Fallback: Teil der E-Mail vor dem @ | In Banner, Push und MAGGIE soll „Elisa“ stehen, nie die E-Mail-Adresse. |
| **Reservierungs-Push unabhängig von den Glocken.** Wer reservieren darf, sieht bei eingeschalteten Benachrichtigungen ohne Glocke keine gelbe Warnung, sondern den ruhigen Hinweis „Ohne Glocke bekommst du nur die Nachrichten zu deinen Reservierungen.“ | Elisa will nur die Nachrichten zur Reservierung, nicht die zum Überschuss. Die Warnung („… kein Gerät hat 🔔“ in `ApplianceGrid.tsx`, „Markiere unten Geräte …“ in `PushToggle.tsx`) stünde bei ihr sonst dauernd da, obwohl alles gewollt ist. Für Empfänger ohne Recht bleibt sie, dort stimmt sie (Wolfgang, 2026-10-21). |
| Knopf **nur in der App** (unter Status und Hinweis, vor dem Verlauf), nicht in der Push-Nachricht | Knöpfe in Web-Push zeigt nur Android an, das iPhone nicht. Also gibt es überall denselben Weg. |
| **Steuerweg: Node-RED fragt ELMA per HTTPS** mit eigenem Steuer-Token (alle 15 s), **nicht über MQTT** | In myhome gilt: „Keine eingehende MQTT-Nachricht schaltet etwas.“ Der Broker ist anonym, ohne ACL und TLS, eine gefälschte Reservierung könnte die Wallbox dauerhaft blockieren. Das Backend erreicht das LAN ohnehin nicht. Ein Abruf von innen nach außen über den vorhandenen Cloudflare-Tunnel braucht keine neue Öffnung. |
| Eigenes **Steuer-Token** pro Erzeuger, nicht das Geräte-Token der Bridge | Das Steuer-Token darf nur den Status austauschen und keine Messwerte einspeisen. |
| **Fail-open:** Antwortet ELMA nicht oder ist `until` vorbei, sperrt Node-RED nichts. | Ein Ausfall von Internet, Tunnel oder ELMA darf Wallbox und WP nie dauerhaft blockieren. |
| **Wärmepumpe über die EVU-Sperre (`relay2`)**, für die ganze Dauer | In myhome hat die WP kein LM, sie startet nach ihrer eigenen Regelung. Zurückhalten geht nur über EVU. Weil bei laufendem Kompressor abgelehnt wird, wird nie ein laufender Kompressor gestoppt. |
| **Wallbox:** Einschalten durch die Preis-Freigabe (LM) wird zurückgehalten. Ist die Steckdose beim Start per LM an, lädt aber nicht, wird sie für die Dauer ausgeschaltet. | Es wird keine laufende Ladung abgebrochen, aber ein angestecktes Auto soll nicht gleich lossaugen (Wolfgang, 2026-10-21). Nach dem Ende gilt wieder die Preis-Freigabe. |
| **Vorrang vor ELISA:** Handbedienung des Erzeugers und Abfahrtsplanung | Der Erzeuger entscheidet in seinem Haus selbst. Eine geplante Abfahrt soll nicht an einer Reservierung scheitern. |
| Gesperrt werden **nur Wallbox und WP** | Trockner und E-Bike hängen seit 2026-10-03 nicht mehr an Node-RED. Ein Heizstab am Smartfox ist laut Wolfgang nicht relevant. |
| **MAGGIE erfährt die Reservierung über die ELMA-Bridge**: retained `elma/reservation`, **nur zur Anzeige** | MAGGIE ist bewusst unabhängig von Node-RED und liest alles über MQTT. Node-RED liest dieses Topic nicht. Eine Fälschung ändert nur die Ampel, nichts wird geschaltet. |
| Der Tag zählt nach **Europe/Vienna**, fest eingestellt. Eine Reservierung über Mitternacht zählt zum Starttag. | Die Container-Zeitzone soll keine Rolle spielen. Um Mitternacht gibt es keinen PV-Überschuss, die Vereinfachung ist also harmlos. |
| Erzeuger nur mit Shelly-Direktanschluss oder ohne Node-RED: Dort wirkt nur die Push-Nachricht | Ohne Hausautomation gibt es nichts, was die Geräte zurückhält. Der Hinweis „Die Sperre wirkt gerade nicht“ erscheint dann immer. |

## Ablauf in der App

Die einzelnen Bildschirme zeigen die Mockups.

1. Der Empfänger mit Recht sieht unter dem Überschuss den gelben Knopf „🔒 Strom reservieren · ELISA-Modus“ und darunter „heute noch X min frei“.
2. Läuft gerade der Kompressor oder lädt das Auto, ist der Knopf grau: „Gerade nicht möglich: Wärmepumpe läuft“ bzw. „… das Auto lädt“.
3. Ein Tipp öffnet ein Bottom-Sheet (wie `AccountSheet`):
   - die Langform des Namens
   - die Dauer-Chips 15/30/45/60 min, über dem Restbudget gesperrt
   - der Hinweis „Solange du reservierst, bleibt der Überschuss für dich frei. Heute noch X min übrig.“, ohne Node-RED-Kontakt stattdessen „Die Sperre wirkt gerade nicht, Wolfgang bekommt nur eine Info.“
   - der Bestätigungsknopf mit Endzeit, z. B. „30 min reservieren, bis 14:22“
4. Während die Reservierung läuft, sehen alle Betrachter oben in der Karte ein Banner: „🔒 ELISA-Modus aktiv · noch 17 min · bis 14:22“, mit Fortschrittsbalken. Reservierender und Erzeuger haben dort „Beenden“.
   - Bei Elisa: „Du hast reserviert. Solange du reservierst, bleibt der Überschuss für dich frei.“
   - Beim Erzeuger: „Reserviert von Elisa. Solange Elisa reserviert, bleibt der Überschuss für sie frei.“
5. Ist das Budget verbraucht, ist der Knopf grau: „Heute schon 60 min reserviert, morgen wieder“.
6. Der Erzeuger hat unter „Empfänger einladen“ eine Liste der Empfänger (Name und E-Mail) mit je einem Schalter „ELISA-Modus“.

Push-Texte:
- Start (an den Erzeuger): „🔒 Elisa reserviert den Überschuss, bis 14:22 – keine großen Verbraucher einschalten“
- Ende (an beide): „🔓 ELISA-Modus zu Ende, heute noch 30 min übrig“ bzw. „… vorzeitig beendet“
- Ende, weil das Auto lädt (an beide): „⚡ Das Auto lädt, Reservierung beendet, heute noch 40 min übrig“

## Umsetzung in ELMA

### Shared (`packages/shared/src/index.ts`)
- Typen und Konstanten:
  - `ReservationDto { producerId, userName, startsAt, endsAt }`
  - `RESERVATION_DAILY_MINUTES = 60`, `RESERVATION_DURATIONS = [15, 30, 45, 60]`
- Nachrichten:
  - `IngestServerMessage` (Backend → Bridge, nur für MAGGIE): `{ type: "reservation", until: number | null, by?: string }`
  - `LiveServerMessage` zusätzlich: `{ type: "reservation", producerId, reservation: ReservationDto | null }`
- `ProducerDto` zusätzlich: `reservation`, `canReserve`, `reserveMinutesLeft`, `controlConnected`, `blockedReason: "heatpump" | "wallbox" | null`.
- `ControlStatus` (Node-RED → ELMA): `{ compressorRunning: boolean, wallboxCharging: boolean, wallboxManual: boolean }`.

### Backend
- `db.ts`, jeweils als idempotentes Statement in `openDb` (Spalten per `PRAGMA table_info` prüfen):
  - `shares.can_reserve INTEGER NOT NULL DEFAULT 0`
  - `users.display_name TEXT` *(Phase 1, umgesetzt)*
  - Neue Tabelle `reservations (id, producer_id, user_id, starts_at, ends_at, ended_at, end_reason)`. Die Historie bleibt, darüber läuft das Tagesbudget.
  - Neue Tabelle `control_tokens (token_hash PK, producer_id, created_at, last_used_at)`. Nur der SHA-256 wird gespeichert, wie bei `setup_links`.
- `repo.ts`:
  - Recht: `canReserve`, `setCanReserve`, `recipientsOf` (Name, E-Mail, Recht)
  - Reservierungen: `activeReservation`, `usedMinutesOnDay` (Summe über `min(ended_at ?? ends_at, now) - starts_at`), `createReservation`, `endReservation`
  - `setDisplayName`
  - Steuer-Token: `controlTokenProducer`, `touchControlToken`
- `cli.ts`: Befehl `control-token <Erzeuger>` gibt das Token einmal aus.
- Neu `reservations.ts` mit `ReservationService`:
  - Regeln: Recht, Budget, eine aktive Reservierung pro Erzeuger, Ablehnung nach frischem Status (unter 60 s)
  - Timer für `endsAt`. Beim Start lädt der Service aktive Reservierungen aus der DB.
  - Letzter Status von Node-RED je Erzeuger im Speicher. `wallboxCharging` während einer Reservierung beendet sie (`end_reason = "wallbox"`).
  - Abonnenten: `/live`, `/ingest` und `PushNotifier`
- `app.ts`:
  - `POST /api/producers/:id/reservation` mit `{ minutes }` (1–60), mit Rate-Limit:
    - 403 ohne Recht
    - 409 bei zu wenig Budget, laufender Reservierung oder laufendem Gerät
  - `DELETE /api/producers/:id/reservation`: für den Reservierenden und den Erzeuger.
  - `GET /api/producers/:id/recipients`, `PUT /api/producers/:id/recipients/:userId` mit `{ canReserve }`: nur für den Erzeuger. Entzug beendet eine laufende Reservierung.
  - `PUT /api/me` mit `{ displayName }` (1–40 Zeichen, getrimmt, `null` löscht ihn). `GET /api/me` liefert den Namen mit. *(Phase 1, umgesetzt)*
    Den Fallback auf den Teil vor dem @ liefert `displayNameOf()` aus `@elma/shared`. Das gilt für Banner, Push und MAGGIE.
    Neue Spalten legt `addColumn()` in `db.ts` an. Zusätzlich zum Plan kann der Erzeuger den Namen schon beim Einladen
    angeben (`invites.display_name`), und `cli.ts set-name` trägt ihn für bestehende Konten ein (Wolfgang, 2026-10-21).
  - `POST /api/control/status` mit `Authorization: Bearer <Steuer-Token>`, Body `ControlStatus`, Antwort `{ active, until, by }`, mit Rate-Limit.
    - Ohne Token, mit falschem Token oder mit dem Geräte-Token gibt es 401.
  - `/ingest` sendet beim Verbinden und bei jeder Änderung `{type:"reservation", until, by}`.
  - `/live` sendet nach `ready` den aktuellen Stand und danach jede Änderung.
- `push.ts`: `notifyUsers(userIds, payload)` auf Basis von `sendToUser`. Die Uhrzeit wird in Europe/Vienna formatiert.

### Bridge (nur für MAGGIE)
- `backend-link.ts`: eingehende Nachrichten mit `IngestServerMessage` parsen und an einen `onReservation`-Callback geben.
- `index.ts`: retained auf `RESERVATION_TOPIC` (Standard `elma/reservation`) veröffentlichen, Fehler beim Publish loggen.
  - Aktiv: `{"active":true,"until":<Unix-ms>,"by":"Elisa"}`
  - Inaktiv: `{"active":false}`
- `config.ts` und `.env.example`: optionale Variable `RESERVATION_TOPIC`.
- Kein ACL nötig. Das Topic dient nur der Anzeige, und Node-RED liest es ausdrücklich nicht.

### Web
- `ProducerCard.tsx`: Knopf (auch grau mit Grund), Sheet, Banner und Empfängerliste wie oben.
- `AccountSheet.tsx`: Feld „Name“. *(Phase 1, umgesetzt)*
- `ApplianceGrid.tsx`, `PushToggle.tsx`: Warnung „keine Glocke“ nicht bei Empfängern mit Recht, dort stattdessen „Ohne Glocke bekommst du nur die Nachrichten zu deinen Reservierungen.“ (siehe Entscheidungen).
- `useLive.ts`: Nachricht `reservation` verarbeiten.
- `api.ts`: neue Aufrufe.

### Release
- Version 0.8.0 in allen `package.json` (0.7.0 war Phase 1, der Anzeigename).
- CHANGELOG-Eintrag mit den Begründungen aus der Tabelle oben.
- README und `README.en.md` unter „Was die App kann“.

## Node-RED (womat/myhome)

Die Details stehen in `KONZEPT-ELISA.md` im Repo myhome, hier nur die Schnittstelle und die Kurzfassung:
- Ein neuer Tab *ELISA* ruft alle 15 s `POST <öffentliche ELMA-Adresse>/api/control/status` mit dem Steuer-Token auf (aus den Node-RED-Credentials).
  - Er schickt den Gerätezustand mit (Kompressor aus `myhome/heatpump/runtime`, Ladung über S0 > 1 kW).
  - Zurück kommt die Reservierung.
- Die Logik liegt in `lib/elisa.js`, mit Tests.
- In `lib/aktor.js` kommen dazu:
  - `ElisaEVU` als dritte EVU-Quelle der WP neben `PeakEVU` und `aWATTarEVU`
  - `ElisaHalt` für die Wallbox. Die LM-Freigabe schaltet dann nicht ein. Handbedienung und Abfahrtsplanung haben Vorrang, dafür bekommt das LM der Abfahrtsplanung ein Kennzeichen `abfahrt`.
- Einträge ins Schaltprotokoll.
- Fail-open: keine Antwort oder `until` vorbei heißt keine Sperre.
- Uhrzeit: `until` kommt aus der Backend-Uhr. Laufen ELMA und Node-RED auf demselben Gerät (im ersten Haus der Fall), ist die Uhr dieselbe, sonst reicht NTP.

## MAGGIE (womat/maggie)

Die Details stehen in `docs/KONZEPT.md` von maggie, hier nur die Kurzfassung:
- Neuer Zustand `reserved` 🟠 mit Schloss: „Strom ist für Elisa reserviert“ / „Bitte kein großes Gerät einschalten.“ / „seit … · bis 14:22“.
  - Er steht **vor `load`** und vor allen Grün-Zuständen.
  - Eingang ist `elma/reservation`. MAGGIE prüft `until` selbst.
- **Push an Margit beim Start**, denn ELMA schreibt nicht an Margit. Es gelten die Regeln von MAGGIE (Nachtruhe 22–7 Uhr, höchstens eine pro Stunde und Zustand).

## Umsetzungsreihenfolge

Festgelegt mit Wolfgang am 2026-10-21. Jede Phase ist für sich ausrollbar, ein eigenes Release und eine eigene Session, gestartet im jeweiligen Repo-Ordner (z. B. „Setz Phase 2 aus docs/elisa.md um“). Nach Abschluss hier abhaken.

| Phase | Repo | Inhalt | Wirkung danach | Stand |
|---|---|---|---|---|
| 0 | myhome, maggie | Nur Doku: `KONZEPT-ELISA.md` in myhome, ELISA-Abschnitt in `docs/KONZEPT.md` von maggie | Jedes Repo kennt seinen Teil | erledigt 2026-10-21 |
| 1 | elma | **Anzeigename** im Konto (`users.display_name`, `PUT /api/me`, Feld im Konto-Sheet) | Klein und auch ohne ELISA nützlich | erledigt 2026-10-21 (0.7.0) |
| 2 | elma | **Reservierung**: Recht, Budget, Knopf, Sheet, Banner, Push, `POST /api/control/status`, Steuer-Token per CLI | Elisa kann reservieren, der Erzeuger bekommt die Info. Ohne Node-RED steht „Die Sperre wirkt gerade nicht“ da | erledigt 2026-10-21 (0.8.0), ausgerollt |
| 3 | myhome | **Node-RED**: `lib/elisa.js`, `ElisaEVU`/`ElisaHalt` in `lib/aktor.js`, Tab *ELISA*. Zuerst **Probebetrieb** (nur Schaltprotokoll, was es tun würde), danach scharf | Wallbox und WP werden zurückgehalten | gebaut 2026-10-22, Probebetrieb; scharf offen (myhome `KONZEPT-ELISA.md`) |
| 4 | elma, maggie | Backend sendet `{type:"reservation"}` über `/ingest`, Bridge veröffentlicht `elma/reservation`. MAGGIE bekommt den Zustand `reserved` und die Push an Margit | Margit sieht die Reservierung | ELMA-Teil erledigt 2026-10-22 (0.9.0), MAGGIE offen |

Warum so: Node-RED und MAGGIE reagieren nur auf das, was ELMA liefert, deshalb kommt ELMA zuerst. Das Schalten im Haus greift in Wallbox und WP ein und kommt deshalb spät und zuerst im Probebetrieb, so wie es bei der Entladesperre eine Woche Probebetrieb gab.

## Umgesetzt in 0.8.0 (Phase 2)

Abweichungen vom Plan oben und Entscheidungen, die der Plan offenließ (Claude, 2026-10-21, zur Prüfung durch Wolfgang):

| Entscheidung | Begründung |
|---|---|
| Der Stand steckt gebündelt in `ReservationStateDto` (`active`, `canReserve`, `minutesLeft`, `controlConnected`, `blockedReason`), in `ProducerDto.reservation` und in der `/live`-Nachricht `{ type: "reservation", producerId, state }`. Dazu `ReservationDto.mine` und `ProducerDto.ownerName`. | Der Stand hängt vom User ab (Recht, Budget, „Du hast reserviert“). Das Backend berechnet ihn pro Verbindung, dann ist `/live` und `GET /api/producers` dasselbe Objekt. `ownerName` braucht der Hinweis „Wolfgang bekommt nur eine Info“. |
| `/live` meldet auch Änderungen am Status von Node-RED (verbunden, Grund für grau), auch das Wegfallen nach 60 s | Sonst bliebe der Knopf grau, obwohl die WP längst aus ist, bis die Seite neu geladen wird. Gesendet wird nur, wenn sich für die App etwas ändert, nicht alle 15 s. |
| `minutesLeft` zählt eine **laufende** Reservierung mit ihrer ganzen geplanten Dauer, eine beendete mit der genutzten Zeit | Damit ist die Zahl während der Reservierung fest („heute danach noch 30 min“). Für die Regeln ändert das nichts, weil nur eine Reservierung gleichzeitig laufen kann. Angezeigt wird abgerundet. |
| `/ingest` sendet die Reservierung **noch nicht** an die Bridge, das kommt mit Phase 4 | Die Bridge kennt die Nachricht noch nicht und schriebe sie nur als Warnung ins Log. Sender und Empfänger kommen besser zusammen. |
| Höchstens eine laufende Reservierung pro Erzeuger erzwingt zusätzlich ein eindeutiger Index (`reservations_one_active`) | Zwei gleichzeitige Anfragen kommen sonst beide durch die Prüfung. |
| Ein neues `control-token` macht das vorherige ungültig (ein Token pro Erzeuger, wie `rotate-token`) | Ein verlorenes Token lässt sich so einfach ersetzen. |
| `wallboxManual` ist optional (Standard `false`) und wird nur angenommen, nicht ausgewertet | Laut myhome nur für Text und Protokoll gedacht. |
| `last_used_at` des Steuer-Tokens wird höchstens einmal pro Stunde geschrieben | Node-RED fragt alle 15 s, das wären unnötig viele Schreibzugriffe auf die SD-Karte. |
| Bleiben **weniger als 15 min**, steht statt des Chips „15 min“ der Rest zur Wahl (z. B. „10 min“) | Sonst wäre der Knopf aktiv („heute noch 10 min frei“), im Blatt aber nichts wählbar. |
| Das Reservieren-Blatt ist ein Vollbild-Blatt wie „Konto“ und „Einladen“, kein Bottom-Sheet | So sehen alle Blätter der App gleich aus. Der Plan nannte `AccountSheet` als Vorbild, und das ist ein Vollbild-Blatt. |
| Knopf auch in der Ansicht „Geräte“ (unter dem Raster), nicht nur in „Leistung“ | Manche haben die App in „Geräte“ offen, die Ansicht wird gemerkt. |
| Die Empfängerliste mit Schalter steht im Blatt „Einladen“ (Personen-Symbol am Erzeuger) | Seit 0.7.2 gibt es den Knopf „Empfänger einladen“ in der Karte nicht mehr, sein Platz ist jetzt dieses Blatt. |
| Bannertext beim Erzeuger: „Reserviert von Elisa · bis 14:22. Bis dahin bitte keine großen Verbraucher einschalten.“ statt „… bleibt der Überschuss für sie frei“ | Das Recht können auch andere Empfänger bekommen, „für sie“ passt dann nicht immer. Der Satz entspricht außerdem der Zusage an den Haushalt. Andere Empfänger sehen nur „Reserviert von Elisa · bis 14:22.“ |
| Eigene Push-Titel für „Erzeuger hat beendet“ („🔓 Wolfgang hat den ELISA-Modus beendet“) und „Recht entzogen“ („🔓 ELISA-Modus beendet“, „Das Recht zum Reservieren wurde dir entzogen.“). Der Erzeuger liest „Elisa hat heute noch 30 min übrig“. | Der Plan legte nur Ablauf, vorzeitiges Ende und Ladung fest. |
| Reservierungen, die während eines Neustarts des Backends abgelaufen sind, enden ohne Push | Eine verspätete „zu Ende“-Nachricht wäre eher verwirrend. |
| Eine gelöschte Freigabe beendet die Reservierung noch nicht aktiv | Freigaben löschen kann man heute nirgends. Kommt das, muss es `ReservationService` aufrufen (wie `setCanReserve`). |

## Umgesetzt: Phase 4, ELMA-Teil

Entscheidungen, die der Plan offenließ (Claude, 2026-10-22, zur Prüfung durch Wolfgang). `POST /api/control/status` ist dabei unverändert geblieben, Phase 3 in myhome läuft parallel.

| Entscheidung | Begründung |
|---|---|
| Node-RED und Bridge bekommen denselben Stand aus `ReservationService.current()`. Die Bridge-Nachricht ist `{type:"reservation", until, by}` mit `until: null` für „nichts reserviert“, wie im Plan. | Eine Quelle für beide, damit Ampel und Sperre nie Verschiedenes zeigen. |
| `/ingest` schickt nur, wenn sich `until`/`by` gegenüber der letzten Nachricht an diese Bridge geändert haben | Der Service meldet auch Statusänderungen von Node-RED (für den Knopf in der App). Die Bridge soll das Topic nicht alle paar Sekunden neu schreiben, sonst schickt MAGGIE womöglich doppelt. |
| Nicht an `/ingest/shelly/:token` | Dort hängt ein Shelly, keine Bridge. Ohne Bridge gibt es kein MQTT und damit auch kein MAGGIE. |
| `IngestServerMessage` kennt zusätzlich `{type:"error", message}` | Das Backend schickt diese Nachricht schon bei ungültigen Eingaben. Die Bridge loggt sie jetzt lesbar, Unbekanntes als Warnung. |
| Veröffentlicht wird retained mit QoS 1. Die Bridge räumt das Topic beim Beenden oder bei Verbindungsverlust zum Backend **nicht** ab. | MAGGIE prüft `until` selbst, eine liegengebliebene Reservierung läuft also von allein aus. Beim Wiederverbinden schickt das Backend sofort den aktuellen Stand. Ist MQTT gerade weg, puffert mqtt.js die Nachricht. Bestätigt von Wolfgang, 2026-10-22. |
| **Bewusst nicht:** `{"active":false}` setzen, wenn die Bridge beendet wird oder die Verbindung zum Backend verliert, auch nicht per MQTT Last Will | Das tauscht den harmlosen Fehler „reserviert, obwohl frei“ gegen „frei, obwohl reserviert“. Verliert die Bridge während einer Reservierung kurz die Verbindung, hält Node-RED Wallbox und WP weiter zurück, MAGGIE zeigte aber „frei“. Margit schaltete dann vielleicht etwas Großes ein, und genau das soll der ELISA-Modus verhindern. Bei jedem Deploy oder Neustart spränge die Ampel kurz auf „frei“ und zurück, mit womöglich einer zweiten Push an Margit. Der Preis des Stehenlassens: Beendet Elisa vorzeitig, während die Bridge keine Verbindung hat, oder fällt ELMA aus (Node-RED gibt dann fail-open frei), zeigt MAGGIE noch „reserviert“, bis die Verbindung wieder steht, längstens bis `until` (höchstens 60 min). Margit wartet dann unnötig, das ist in Ordnung (Wolfgang, 2026-10-22). |
| `RESERVATION_TOPIC` steht in `docker-compose.yml` und `deploy/box/docker-compose.yml`, Standard `elma/reservation`, leer zählt als Standard | Weitere Erzeuger mit eigener ELMA-Box haben ihren eigenen Broker, dort stört das Topic nicht. Wer mehrere ELMA an einem Broker hat, kann es umbenennen. |
| Der ELMA-Teil geht allein als **0.9.0** raus, ohne auf MAGGIE zu warten (Wolfgang, 2026-10-22) | MAGGIE liest das Topic nur. Solange sie es nicht kennt, stört die retained Nachricht niemanden, und MAGGIE kann danach gegen einen echten Stand entwickelt werden. Neue Funktion, daher Minor statt Patch. |

## Vor der Umsetzung mitbringen

- Zugang zu den drei Repos (elma, myhome, maggie). Node-RED wird im Editor auf dem Pi geändert und danach exportiert, so beschreibt es myhome.
- Nach dem Ausrollen von ELMA einmal `control-token` erzeugen und in Node-RED eintragen. Das Token erzeugt Wolfgang selbst im Terminal, nicht über eine Claude-Sitzung.
- Prüfen, ob Node-RED die öffentliche ELMA-Adresse erreicht. Das ist erwartbar, weil auch der aWATTar-Abruf ins Internet geht.

## Tests

- `apps/backend/test/reservations.test.ts`:
  - Recht und Grenzen:
    - Ohne Recht → 403. 61 min → 400.
    - Zweiter Berechtigter, während eine Reservierung läuft → 409.
  - Budget:
    - 2× 30 min → ok, danach 15 min → 409.
    - 30 min gestartet, nach 10 min beendet → noch 50 min frei.
    - Neuer Tag nach Europe/Vienna → wieder 60 min.
  - Ablehnung:
    - Frischer Status mit laufendem Kompressor oder ladender Wallbox → 409, ohne Budgetverbrauch.
    - Ein veralteter Status lehnt nicht ab.
  - Ende:
    - `wallboxCharging` während der Reservierung beendet sie, Push an beide.
    - Entzug des Rechts beendet sie, Push an beide.
    - Automatischer Ablauf mit Fake-Timern.
  - Push beim Start nur an den Erzeuger.
- `apps/backend/test/app.test.ts`:
  - `POST /api/control/status`: ohne Token, mit falschem Token oder mit dem Geräte-Token → 401. Mit Steuer-Token kommt der Stand zurück, `controlConnected` ist danach true und nach 60 s ohne Abfrage wieder false.
  - `/ingest` bekommt den Stand nach dem Verbinden, `/live` bekommt Start und Ende.
  - Nur der Erzeuger kann `can_reserve` setzen.
  - `PUT /api/me` validiert `displayName`. *(Phase 1, umgesetzt)*
- `apps/bridge/test/`: Parser für `IngestServerMessage` und MQTT-Payload.
- End-to-End mit `dev/docker-compose.dev.yml`:
  - Ein Status per `curl` mit Steuer-Token liefert die Reservierung.
  - `mosquitto_sub -t elma/reservation -v` zeigt die retained Nachricht, nach Ablauf oder „Beenden“ dann `active:false`.
