# Changelog

Alle Versionen folgen [Semantic Versioning](https://semver.org/lang/de/). Zu jeder Version gibt es einen Git-Tag `vX.Y.Z`.

## 0.10.1 – 2026-10-23

- **Akku-Kästchen nur noch, wenn der Akku lädt oder voll ist.** In 0.10.0 stand sonst „Akku · 23 %“. Ein Akku, der steht
  oder entlädt, erklärt aber nichts am Überschuss, das Kästchen hat den Empfänger nur verwirrt (Wolfgang, nach dem ersten Tag).

## 0.10.0 – 2026-10-23

- **Stabilitätsampel und Akku beim Empfänger.** Empfänger sahen z. B. „2 kW“, schalteten etwas ein, und kurz danach war der
  Überschuss weg, oft weil der Akku des Erzeugers wieder voll lud. Ob es die nächsten Minuten reicht, ließ sich nicht einschätzen.
  - **Ruhigere Zahl:** Das Mittel läuft jetzt über 5 statt 2 Minuten (`SMOOTH_WINDOW_MS`). Unter der Zahl steht „Mittel der letzten Minuten“.
  - **Ampel „Stabil“ / „Schwankt stark · kann sinken“** über dasselbe Fenster. Stabil heißt: Der Rohwert lag mindestens 80 % der Zeit
    bei wenigstens 70 % des angezeigten Mittels. Ein vorsichtigerer Wert (z. B. das Minimum) als Hauptzahl war die Alternative;
    gewählt wurde Mittel plus Ampel (Wolfgang, 23.10.2026). Ohne Überschuss und solange die Werte weniger als das halbe Fenster
    abdecken (nach dem Start, nach einer Lücke), gibt es keine Ampel.
  - **Push nur bei „stabil“:** Schwankt der Wert, gilt ein Gerät als „passt nicht“, die 2 Minuten Wartezeit beginnen neu.
    So kommt kein „Jetzt reicht's“, während der Wert wackelt.
  - **Akku des Erzeugers**, immer wenn ein aktueller Wert da ist: „Lädt 1,2 kW · 92 %“ ab 200 W Ladeleistung, sonst „Akku voll“
    ab 98 % (der EcoFlow erreicht oben nicht sicher 100 %), sonst nur der Ladestand, jeweils mit Balken. Die Bridge liest dafür
    das neue `BATTERY_TOPIC` (bei uns `myhome/ecoflow/state` von ecoflowd) und schickt `{type:"battery"}` über `/ingest`. Der Wert
    geht mit dem nächsten Überschusswert an die App, nicht in die Datenbank. Älter als 5 Minuten wird er weggelassen, weil ecoflowd
    einfrieren kann. Erzeuger mit Shelly haben keinen Akkuwert, bei ihnen fehlt der Hinweis.
  - Ausrollen: erst das Backend, dann die Bridge. Ein altes Backend antwortet auf Akkuwerte mit „Ungültige Nachricht“.
  - Mockup: <https://claude.ai/artifact/EnJCj4Qu1d8dNSKdRRzLJo> (privat)

## 0.9.0 – 2026-10-22

- **ELISA-Modus für MAGGIE** (ELMA-Teil von Phase 4 aus [docs/elisa.md](docs/elisa.md)). Das Backend schickt der Bridge über `/ingest`
  beim Verbinden und bei jeder Änderung die Reservierung (`{type:"reservation", until, by}`), die Bridge veröffentlicht sie retained auf
  `elma/reservation`: `{"active":true,"until":<Unix-ms>,"by":"Elisa"}` bzw. `{"active":false}`. So kann die Strom-Ampel MAGGIE im Haus
  des Erzeugers zeigen, dass gerade reserviert ist, und Margit benachrichtigen. ELMA selbst schreibt Margit keine Push-Nachricht.
  - Nur zur Anzeige: Node-RED liest das Topic nicht und bekommt die Reservierung weiter über `POST /api/control/status` (unverändert).
    Der Broker ist offen, eine gefälschte Nachricht ändert so höchstens die Ampel.
  - Ein Statusbericht von Node-RED erzeugt keine Nachricht an die Bridge, nur eine echte Änderung der Reservierung.
  - Das Topic lässt sich mit `RESERVATION_TOPIC` ändern. Ist der Broker gerade weg, puffert die Bridge die Nachricht.
    Bleibt eine alte Nachricht liegen (Bridge oder Backend aus), wirkt sie nicht ewig: MAGGIE prüft `until` selbst.
  - Die Bridge versteht jetzt die Nachrichten des Backends und schreibt Fehlermeldungen lesbar ins Log statt als rohes JSON.

## 0.8.0 – 2026-10-21

- **ELISA-Modus: Strom reservieren** (Phase 2 aus [docs/elisa.md](docs/elisa.md)). Bisher kam die Nachricht „viel Überschuss“,
  der Empfänger schaltete etwas ein, und genau dann sprang beim Erzeuger die Wallbox oder die Wärmepumpe an. Jetzt kann ein Empfänger
  mit Recht den Überschuss für bis zu 60 min am Tag reservieren, beliebig aufgeteilt (z. B. 2× 30 min).
  - **Knopf „Strom reservieren · ELISA-Modus“** unter dem Überschuss, darunter „heute noch X min frei“. Ein Tipp öffnet ein Blatt
    mit 15/30/45/60 min; was über dem Restbudget liegt, ist gesperrt. Bleiben weniger als 15 min, ist der Rest wählbar.
  - **Banner oben in der Karte**, solange reserviert ist, mit Restzeit und Fortschrittsbalken, für alle, die den Erzeuger sehen.
    „Beenden“ haben der Reservierende und der Erzeuger. Gezählt wird nur die genutzte Zeit: Wer nach 10 von 30 min beendet, hat noch 50 min.
  - **Keine Freigabe durch den Erzeuger nötig**, der Überschuss ist meist nur kurz da. Das Recht vergibt er pro Empfänger:
    Im Blatt „Einladen“ gibt es jetzt die Liste der Empfänger mit einem Schalter „ELISA-Modus“. Ausschalten beendet eine laufende Reservierung sofort.
  - **Push-Nachrichten** beim Start an den Erzeuger („🔒 Elisa reserviert den Überschuss, bis 14:22 – keine großen Verbraucher einschalten“),
    beim Ende an beide, mit dem restlichen Budget. Sie kommen unabhängig von den Glocken. Wer reservieren darf, sieht deshalb ohne Glocke
    keine gelbe Warnung mehr, sondern „Ohne Glocke bekommst du nur die Nachrichten zu deinen Reservierungen.“
  - Höchstens eine Reservierung pro Erzeuger zur gleichen Zeit. Der Tag zählt nach Wiener Zeit, egal wie der Container eingestellt ist.
- **Schnittstelle für Node-RED:** `POST /api/control/status` mit eigenem Steuer-Token. Node-RED meldet alle 15 s, ob der Kompressor
  der Wärmepumpe läuft und ob das Auto lädt, und bekommt zurück, ob und bis wann reserviert ist. Läuft gerade eines davon, ist der Knopf grau
  („Gerade nicht möglich: Wärmepumpe läuft“ bzw. „… das Auto lädt“) und der Server lehnt ab, ohne Budget zu verbrauchen: Was läuft,
  ist im angezeigten Überschuss schon abgezogen. Beginnt während der Reservierung eine Ladung, endet sie, die Handbedienung des Erzeugers hat Vorrang.
  - Node-RED fragt von innen nach außen statt über MQTT: Der Broker ist offen, eine gefälschte Nachricht könnte sonst die Wallbox blockieren,
    und das Backend erreicht das LAN ohnehin nicht.
  - Meldet sich Node-RED 60 s nicht, bleibt Reservieren möglich, mit dem Hinweis „Die Sperre wirkt gerade nicht, Wolfgang bekommt nur eine Info“.
    So ist es auch, bis Node-RED angebunden ist (Phase 3).
  - Terminal: `node src/cli.ts control-token <producerId>` gibt das Steuer-Token einmal aus, ein vorheriges wird ungültig.
    Das Token kann nur den Status melden, aber keine Messwerte einspeisen. Das Geräte-Token der Bridge gilt dort nicht.
- Datenbank: neue Spalte `shares.can_reserve` (kommt beim Start automatisch dazu), neue Tabellen `reservations` und `control_tokens`.
  Beendete Reservierungen bleiben stehen, darüber läuft das Tagesbudget.
- Was bei der Umsetzung vom Plan abweicht, steht in [docs/elisa.md](docs/elisa.md) unter „Umgesetzt in 0.8.0“.

## 0.7.2 – 2026-10-21

- **Einladen im eigenen Blatt:** Das Namensfeld und der Knopf „Empfänger einladen“ standen bisher unten in jeder Erzeuger-Karte,
  in „Leistung“ und in „Geräte“. Man lädt nur selten jemanden ein, das Formular nahm aber bei jedem Blick Platz weg und sah aus
  wie ein Teil der Stromanzeige. Jetzt sitzt neben dem Namen des Erzeugers ein Personen-Symbol mit Plus, gleich neben dem Bleistift
  zum Umbenennen. Es öffnet das Blatt „Einladen“: Name (optional), „Einladungslink erstellen“, danach der Link mit „Teilen“ und „Kopieren“
  und dem Datum, bis zu dem er gilt. Beide Symbole sieht nur der Besitzer des Erzeugers.
- **Teilen erst auf Tippen:** Bisher ging das Teilen-Fenster des Handys sofort beim Erstellen auf. Jetzt sieht man zuerst, dass der
  Link erstellt wurde, und teilt oder kopiert ihn dann selbst.
- Das Symbol sitzt am Erzeuger und nicht im Konto-Blatt, weil eine Einladung genau für diesen Erzeuger gilt. Bei mehreren Erzeugern
  müsste man im Konto-Blatt sonst erst einen auswählen (Wolfgang, 2026-10-21, nach Mockup).

## 0.7.1 – 2026-10-21

- **Aufgeräumte Kopfzeile:** Rechts oben standen bisher ein grüner Punkt, ein Schlüssel-Symbol und das Wort „Abmelden“,
  jedes in einer anderen Form und Größe. Jetzt stehen dort nur noch zwei Dinge:
  - **„● Live“**: Der Punkt bekommt ein Wort („Live“, „Verbinde …“ oder „Getrennt“). Vorher war nicht zu erkennen, was er bedeutet.
  - **ein Kreis mit dem Anfangsbuchstaben des Namens**, z. B. „W“. Er öffnet das Konto-Blatt, das jetzt „Konto“ heißt statt „Anmeldung“.
    Oben im Blatt stehen Name und E-Mail.
- **Abmelden nur noch im Konto-Blatt**, ganz unten als rot umrandeter Knopf. Man braucht es selten, und in der Kopfzeile
  war es leicht aus Versehen angetippt. Im Blatt stand es ohnehin schon, die Kopfzeile hatte es doppelt.
- Gewählt aus drei Entwürfen (Kreis mit Buchstabe, Knopf mit ganzem Namen, drei gleiche Symbole). Der Kreis braucht am wenigsten Platz
  und ist aus anderen Apps vertraut (Wolfgang, 2026-10-21).

## 0.7.0 – 2026-10-21

- **Anzeigename im Konto:** Im Blatt „Anmeldung“ (Schlüssel-Symbol oben, seit 0.7.1 „Konto“ hinter dem Kreis oben rechts) gibt es das neue Feld „Dein Name“, z. B. „Elisa“.
  Er ist 1 bis 40 Zeichen lang, Leerzeichen am Rand fallen weg. Ein leeres Feld löscht den Namen wieder.
  Ohne Namen gilt der Teil der E-Mail vor dem @. Wo andere den Namen sehen, soll also nie die ganze E-Mail-Adresse stehen.
  Das ist Phase 1 des geplanten ELISA-Modus ([docs/elisa.md](docs/elisa.md)): Banner, Push-Nachrichten und die Strom-Ampel MAGGIE
  zeigen später, wer gerade reserviert. Sonst zeigt die App den Namen noch nirgends an.
  - Terminal: `node src/cli.ts set-name <email> <Name>` setzt den Namen für einen User, `""` löscht ihn. `list-users` zeigt die Namen mit an.
    Damit trägt der Betreiber die Namen bestehender Konten nach dem Update selbst ein. In die Datenbank-Umstellung kommen sie
    bewusst nicht: Das Repo ist öffentlich, die E-Mail-Adressen stünden sonst im Code, und die ELMA-Box anderer Erzeuger führt dieselbe Umstellung aus.
  - **Name gleich bei der Einladung:** Über dem Knopf „Empfänger einladen“ gibt es ein Feld für den Namen der Person, im Terminal
    `invite <producerId> <Name>`. Legt sie über den Link ihr Konto an, steht der Name schon drin.
    Löst jemand mit bestehendem Konto die Einladung ein, wird der Name nur übernommen, wenn noch keiner gesetzt ist.
    Einen selbst gewählten Namen überschreibt eine Einladung nie.
  - API: `GET /api/me` und die Anmeldeantwort liefern zusätzlich `displayName` (oder `null`). `PUT /api/me` mit `{ displayName }` setzt ihn, `null` löscht ihn.
  - Datenbank: neue Spalten `users.display_name` und `invites.display_name`. Bestehende Datenbanken bekommen sie beim Start automatisch (`ALTER TABLE`, nur wenn sie noch fehlen).
    Der Hilfsbaustein dafür (`addColumn` in `db.ts`) ist für die weiteren Spalten des ELISA-Modus gedacht.
- **Sicherheitsupdate:** `vite` 8.3.2 → 8.3.5. Die alte Version meldete `pnpm audit` als „high“: Über `launch-editor` ließ sich
  unter Windows eine Existenzprüfung von Dateien umgehen. Das betrifft nur den Entwicklungsserver, nicht die ausgelieferte App,
  hätte die CI aber rot gemacht.

## 0.6.3 – 2026-10-08

- **Sicherheitslücke behoben:** `@fastify/static` von 8.3 auf 10.1.5 gehoben. Die alte Version ließ sich über
  umgebogene Pfade an Zugriffsprüfungen vorbei austricksen ([GHSA-83w8-p2f5-377r](https://github.com/advisories/GHSA-83w8-p2f5-377r) und drei weitere).
  Die Auslieferung der PWA ist unverändert.
- **Abhängigkeiten:** `@fastify/rate-limit` 10.3 → 11.2 (Sicherheits-Release, die Login-Begrenzung bleibt gleich),
  `@fastify/websocket` 11.3.3, `lucide-react` 1.52.
- **Prüfung auf bekannte Lücken:** `pnpm audit` läuft jetzt in `ci` und im Release-Workflow; ab Stufe „high“ schlägt der Lauf fehl.
  Die Testwerkzeuge (vitest) sind dafür ebenfalls aktualisiert.
- **Workflows abgesichert:** Alle GitHub-Bausteine sind auf den Commit-SHA ihres Releases festgenagelt statt auf
  verschiebbare Tags wie `@v5`. Neu ist `.github/dependabot.yml`: einmal pro Woche Update-PRs für npm-Pakete,
  das Basis-Image im `Dockerfile` und die Actions.
- **Release-Workflow:** GitHub-Bausteine auf die ersten Versionen mit Node 24 gehoben (checkout/setup-node v5, Docker-Actions v4/v6/v7).
  Die Warnung „Node.js 20 is deprecated“ entfällt; getestet wird das beim nächsten Release-Lauf.
- **Release-Workflow testen ohne Veröffentlichen:** Beim Start lässt sich das Häkchen „Images hochladen“ entfernen.
  Dann wird alles getestet und gebaut, aber nichts auf ghcr.io hochgeladen.
- **Repo öffentlich vorbereitet:**
  - README mit Screenshots, Badges und Schnellstart, dazu eine englische Kurzfassung (`README.en.md`).
  - `CONTRIBUTING.md`, `SECURITY.md` und Issue-Vorlagen.
  - Neuer Workflow `ci`: Tests und Typprüfung bei jedem Push und Pull Request.
  - Beispiele verwenden neutrale Adressen (`elma.example.com`, `192.168.1.10`) statt der eigenen.
  - `scripts/deploy.sh` liest die Adresse für die Prüfung am Ende aus `PUBLIC_URL` in der `.env` auf dem Ziel. `DEPLOY_URL` überschreibt sie weiterhin.

## 0.6.2 – 2026-10-01

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
