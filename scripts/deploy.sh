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
BACKUP_DIR="${DEPLOY_BACKUP_DIR:-elma-backups}"
KEEP_BACKUPS=10

cd "$(git rev-parse --show-toplevel)"

if [ -n "$(git status --porcelain)" ]; then
  echo "Abbruch: Es gibt nicht committete Änderungen." >&2
  exit 1
fi
git fetch -q origin
# funktioniert auch in einem zweiten Arbeitsordner (git worktree) ohne eigenen Branch
if [ -z "$(git branch -r --contains HEAD)" ]; then
  echo "Abbruch: HEAD ist noch nicht gepusht." >&2
  exit 1
fi

# z. B. v0.2.0 oder v0.2.0-3-g1a2b3c4 für Stände nach dem letzten Tag
VERSION="$(git describe --tags --always)"
echo "==> Rolle ELMA $VERSION auf $HOST:~/$DIR aus"

if ! ssh "$HOST" "test -f ~/$DIR/.env"; then
  echo "Abbruch: ~/$DIR/.env fehlt auf $HOST (siehe README, Abschnitt 'Produktiv im Heimnetz')." >&2
  exit 1
fi

# Datenbank sichern, solange die bisherige Version noch läuft.
# VACUUM INTO liefert trotz WAL-Modus eine konsistente Kopie und funktioniert mit jeder ELMA-Version.
# Die Sicherungen liegen außerhalb von ~/$DIR, weil der nächste Schritt dort alles außer .env löscht.
# Das Skript kommt über stdin, deshalb bekommt jeder docker-Aufruf </dev/null – sonst liest er den Rest mit.
echo "==> Sichere die Datenbank nach $HOST:~/$BACKUP_DIR"
ssh "$HOST" "bash -s" <<EOF
set -euo pipefail
cd ~/$DIR
mkdir -p ~/$BACKUP_DIR
running="\$(docker compose ps --status running --services </dev/null 2>/dev/null || true)"
if ! grep -qx backend <<<"\$running"; then
  echo "    kein laufendes Backend, nichts zu sichern"
  exit 0
fi
old="\$(docker compose exec -T backend printenv ELMA_VERSION </dev/null 2>/dev/null || echo unbekannt)"
file="elma-\$(date +%Y%m%d-%H%M%S)-\$old.db"
docker compose exec -T backend sh -c 'rm -f /data/backup.db && node -e "new (require(\"node:sqlite\").DatabaseSync)(process.env.DB_PATH).exec(\"VACUUM INTO \x27/data/backup.db\x27\")"' </dev/null
docker compose cp backend:/data/backup.db ~/$BACKUP_DIR/"\$file" </dev/null >/dev/null 2>&1
docker compose exec -T backend rm -f /data/backup.db </dev/null
echo "    gesichert: ~/$BACKUP_DIR/\$file"
# nur die letzten $KEEP_BACKUPS Sicherungen behalten
ls -1t ~/$BACKUP_DIR/elma-*.db | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm --
EOF

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
