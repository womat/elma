# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

ELMA zeigt Empfängern im Peer-to-Peer-Stromnetz live den PV-Überschuss eines Erzeugers. Hintergrund,
Betrieb und Deployment stehen im [README](README.md); Hosting-Konzept in [docs/hosting.md](docs/hosting.md).

## Befehle

```bash
pnpm install
pnpm test                                       # vitest, alle Pakete (Root-vitest.config.ts)
pnpm vitest run apps/backend/test/hub.test.ts   # eine Testdatei
pnpm vitest run -t "Teil des Testnamens"        # einzelner Test
pnpm typecheck                                  # tsc je App, kein Emit
pnpm dev:backend | dev:bridge | dev:web
pnpm audit --audit-level high                   # läuft in CI, ab "high" rot
```

CI (`.github/workflows/ci.yml`) = install --frozen-lockfile, audit, test, typecheck. Vor einem Commit dieselben drei Prüfungen laufen lassen.

## Kein Build-Schritt für Node-Code

Backend, Bridge und Push-Proxy laufen als `.ts` direkt unter Node ≥ 24 (Type Stripping); `tsc` prüft nur.
Daraus folgt (`tsconfig.base.json`: `erasableSyntaxOnly`, `verbatimModuleSyntax`):
- Relative Imports mit `.ts`-Endung (`./repo.ts`), reine Typ-Imports als `import type`.
- Nur löschbare TS-Syntax: keine `enum`, `namespace`, Parameter-Properties im Konstruktor.
- `@elma/shared` exportiert direkt `src/index.ts`, wird also nie gebaut.

Nur `apps/web` (React-PWA, Vite) wird gebaut. Im Dev-Modus proxied Vite `/api` und `/live` an `BACKEND_DEV_URL` (Standard `localhost:3000`).

## Architektur

Datenfluss: MQTT-Broker → **bridge** (normalisiert auf Watt, drosselt via `shared/throttle.ts`) → WS `/ingest` → **backend** → WS `/live` → **web**.
Shelly Pro 3EM sendet alternativ direkt an `/ingest/shelly/:token` (`backend/src/shelly.ts`). Vertrag zwischen den Teilen: Zod-Schemas und DTOs in `packages/shared/src/index.ts`.

Backend (`apps/backend/src`):
- `app.ts` `buildApp(opts)` baut die komplette Fastify-App aus Optionen ohne Umgebungsvariablen; `server.ts` liest die Env, hängt Timer (Minuten-Flush, 30-Tage-Retention) und Signale an. Tests rufen `buildApp` mit `openDb(":memory:")` und `smoothWindowMs: 0` auf und lauschen auf Port 0.
- `hub.ts` `LiveHub`: aktueller Wert je Erzeuger im Speicher. Verteilt wird ein **geglätteter** Wert (Standard 2 min), die Minutenmittel in der DB entstehen aus den **Rohwerten**.
- `repo.ts` kapselt alle SQL-Zugriffe (`node:sqlite`, synchron).
- `db.ts` legt das Schema mit `CREATE TABLE IF NOT EXISTS` an. Es gibt kein Migrations-Framework: Schemaänderungen an bestehenden DBs brauchen ein eigenes idempotentes Statement in `openDb` (Beispiel: Passwort-Hashes → `'passkey-only'`, die Spalte `users.password_hash` ist ein Altbestand und bleibt NOT NULL).
- Anmeldung nur per Passkey (`passkeys.ts`, `@simplewebauthn`), danach JWT. Konten entstehen nur über Einladungslink oder Einrichtungslink aus der CLI (`cli.ts`).
- `push.ts`: Web-Push mit Stabilitäts- und Mindestabstandsregeln (im README unter „Push-Benachrichtigungen“ beschrieben). VAPID-Schlüssel erzeugt das Backend selbst und legt sie in `meta` ab.
- Shares (`producer_id`, `recipient_id`) sind schon n:m angelegt, genutzt wird heute 1:1.

**Abgeschottetes Backend:** Im Docker-Betrieb hängt das Backend nur in einem internen Netz, ohne Internet und ohne LAN. Ausgehend kommt es nur über `apps/push-proxy` zu den Push-Diensten (Allowlist `isPushHost` in `shared/push.ts`). Neue Funktionen, die vom Backend aus externe Dienste aufrufen, funktionieren produktiv deshalb nicht. Das ist eine bewusste Sicherheitsentscheidung, also nicht als Fehler behandeln.

**ELISA-Modus** (Empfänger reserviert Überschuss, Node-RED lässt Wallbox/WP nicht anspringen, MAGGIE zeigt es an): umgesetzt seit 0.8.0/0.9.0, Regeln in `reservations.ts`. Plan, Entscheidungen, Abweichungen und Stand stehen in [docs/elisa.md](docs/elisa.md); vor Änderungen dort nachlesen und neue Entscheidungen dort festhalten. Betrifft auch die Repos myhome (Node-RED, `KONZEPT-ELISA.md`) und maggie (Strom-Ampel, `docs/KONZEPT.md`).

Ein `Dockerfile` mit Zielen `backend`, `bridge`, `push-proxy`. `docker-compose.yml` ist der Produktiv-Stack (Profile `bridge`, `tunnel`), `dev/docker-compose.dev.yml` der lokale Test mit Mosquitto, `deploy/box/` die eigenständige ELMA-Box für weitere Erzeuger.

## Konventionen

- Code-Kommentare, UI-Texte, Fehlermeldungen, Doku und Commit-Messages auf Deutsch. Bezeichner englisch.
- Commit-Messages im Stil `Bereich: Was` (z. B. `Doku: …`, `CI: …`), Releases als `Release X.Y.Z: Kurzfassung`.
- Neue Funktionen mit Vitest-Tests; größere Änderungen mit Eintrag in `CHANGELOG.md` (erklärend formuliert, nicht nur Stichworte).
- Begründungen für Entscheidungen stehen als Kommentar am Code bzw. in CHANGELOG/docs. Dort auch neue Entscheidungen festhalten.
- Release: Version in **allen** `package.json` (Root, `apps/*`, `packages/*`) erhöhen, CHANGELOG ergänzen, annotierten Tag `git tag -a vX.Y.Z` anlegen (ohne `-a` überträgt `--follow-tags` ihn nicht). Ablauf siehe README „Neue Version ausrollen“.
- GitHub Actions sind auf Commit-SHAs festgenagelt (Version im Kommentar). Bei Änderungen so beibehalten.
