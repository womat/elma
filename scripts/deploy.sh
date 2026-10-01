#!/usr/bin/env bash
# ELMA auf den Raspberry Pi ausrollen – mit korrekt vergebener Version.
#
#   scripts/deploy.sh
#
# Voraussetzungen: sauberes Arbeitsverzeichnis, HEAD ist gepusht, auf dem Ziel liegt ~/elma/.env.
# Einstellbar über DEPLOY_HOST (Standard mysmarthome), DEPLOY_DIR (elma), DEPLOY_URL (https://my-elma.net).
set -euo pipefail

HOST="${DEPLOY_HOST:-mysmarthome}"
DIR="${DEPLOY_DIR:-elma}"
URL="${DEPLOY_URL:-https://my-elma.net}"

cd "$(git rev-parse --show-toplevel)"

if [ -n "$(git status --porcelain)" ]; then
  echo "Abbruch: Es gibt nicht committete Änderungen." >&2
  exit 1
fi
git fetch -q origin
BRANCH="$(git branch --show-current)"
if ! git merge-base --is-ancestor HEAD "origin/$BRANCH"; then
  echo "Abbruch: HEAD ist nicht nach origin/$BRANCH gepusht." >&2
  exit 1
fi

# z. B. v0.2.0 oder v0.2.0-3-g1a2b3c4 für Stände nach dem letzten Tag
VERSION="$(git describe --tags --always)"
echo "==> Rolle ELMA $VERSION auf $HOST:~/$DIR aus"

if ! ssh "$HOST" "test -f ~/$DIR/.env"; then
  echo "Abbruch: ~/$DIR/.env fehlt auf $HOST (siehe README, Abschnitt 'Produktiv im Heimnetz')." >&2
  exit 1
fi

# Code ersetzen, .env behalten (Daten liegen im Docker-Volume und bleiben unberührt)
git archive --format=tar HEAD |
  ssh "$HOST" "cd ~/$DIR && find . -mindepth 1 -maxdepth 1 ! -name .env -exec rm -rf {} + && tar -xf -"

ssh "$HOST" "cd ~/$DIR && ELMA_VERSION='$VERSION' docker compose --profile bridge --profile tunnel up -d --build --remove-orphans && docker image prune -f >/dev/null"

echo "==> Prüfe $URL/api/health"
got=""
for _ in $(seq 1 30); do
  got="$(curl -fsS -m 5 "$URL/api/health" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' || true)"
  if [ "$got" = "$VERSION" ]; then
    echo "OK: ELMA $VERSION läuft unter $URL"
    exit 0
  fi
  sleep 2
done
echo "FEHLER: erwartet $VERSION, erreichbar ist: ${got:-nichts}" >&2
exit 1
