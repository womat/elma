#!/usr/bin/env bash
# Richtet die ELMA-Box ein: .env schreiben, Stack starten, ersten Benutzer und Erzeuger anlegen.
#
#   ./setup.sh
#
# Voraussetzungen: Docker mit Compose-Plugin (curl -fsSL https://get.docker.com | sh).
# Eine vorhandene .env wird nie ohne Rückfrage überschrieben; die Daten liegen im Docker-Volume elma-data.
set -euo pipefail
cd "$(dirname "$0")"

ask() { # ask <Frage> [Vorgabe]
  local answer
  read -r -p "$1${2:+ [$2]}: " answer
  echo "${answer:-${2:-}}"
}
ask_secret() { # Eingabe wird nicht angezeigt
  local answer
  read -r -s -p "$1: " answer
  echo >&2
  echo "$answer"
}
yes_no() { # yes_no <Frage> <j|n>
  local answer
  answer="$(ask "$1 (j/n)" "$2")"
  [[ "$answer" =~ ^[jJyY] ]]
}
no_quote() { # Werte stehen in einfachen Anführungszeichen in der .env
  if [[ "$2" == *"'"* ]]; then
    echo "Abbruch: $1 darf kein ' enthalten." >&2
    exit 1
  fi
}
random_hex() { od -An -tx1 -N32 /dev/urandom | tr -d ' \n'; }

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker mit Compose-Plugin fehlt: curl -fsSL https://get.docker.com | sh" >&2
  exit 1
fi

echo "==> ELMA-Box einrichten"

if [ -f .env ] && ! yes_no ".env gibt es schon. Neu schreiben?" n; then
  echo "    .env bleibt unverändert."
else
  public_url="$(ask "Öffentliche Adresse (z. B. https://elma.meine-gemeinschaft.at)")"
  [[ "$public_url" =~ ^https?:// ]] || { echo "Abbruch: Adresse muss mit https:// beginnen." >&2; exit 1; }
  public_url="${public_url%/}"
  port="$(ask "Port im LAN" 3000)"
  vapid="$(ask "Kontakt-E-Mail für Push-Dienste" "")"
  version="$(ask "Image-Version" latest)"
  tunnel_token="$(ask_secret "Cloudflare-Tunnel-Token (leer = nur im LAN)")"

  profiles=()
  [ -n "$tunnel_token" ] && profiles+=(tunnel)

  mqtt_password="" mqtt_topic="" payload_path="" payload_invert=false
  if yes_no "Zusätzlich MQTT (Mosquitto + Bridge) für Smartfox, Shelly Gen1 o. Ä.?" n; then
    profiles+=(mqtt)
    mqtt_password="$(random_hex | cut -c1-24)"
    mqtt_topic="$(ask "MQTT-Topic mit dem Überschuss" "")"
    payload_path="$(ask "Pfad im JSON (leer = Payload ist eine Zahl)" "")"
    yes_no "Kommt Einspeisung als negativer Wert (z. B. Smartfox)?" j && payload_invert=true
  fi

  for value in "$public_url" "$vapid" "$version" "$tunnel_token" "$mqtt_topic" "$payload_path"; do
    no_quote "Eingabe" "$value"
  done

  umask 077
  cat >.env <<EOF
# erzeugt von setup.sh am $(date +%F)
COMPOSE_PROFILES='$(IFS=,; echo "${profiles[*]-}")'
ELMA_VERSION='$version'
ELMA_PORT='$port'
JWT_SECRET='$(random_hex)'
PUBLIC_URL='$public_url'
VAPID_SUBJECT='mailto:${vapid:-elma@example.com}'
CLOUDFLARE_TUNNEL_TOKEN='$tunnel_token'
MQTT_USERNAME='elma'
MQTT_PASSWORD='$mqtt_password'
MQTT_TOPIC='$mqtt_topic'
PAYLOAD_PATH='$payload_path'
PAYLOAD_INVERT='$payload_invert'
DEVICE_TOKEN=''
EOF
  echo "    .env geschrieben (nur für dich lesbar)."
fi

# Werte aus der .env lesen, ohne sie auszuführen
env_get() { sed -n "s/^$1='\{0,1\}\([^']*\)'\{0,1\}$/\1/p" .env | tail -1; }
env_set() { # ersetzt KEY=… in der .env
  local tmp
  tmp="$(mktemp .env.XXXXXX)"
  grep -v "^$1=" .env >"$tmp" || true
  echo "$1='$2'" >>"$tmp"
  mv "$tmp" .env
}
port="$(env_get ELMA_PORT)"
mqtt_enabled=false
[[ "$(env_get COMPOSE_PROFILES)" == *mqtt* ]] && mqtt_enabled=true

if $mqtt_enabled && [ ! -s mosquitto/passwd ]; then
  echo "==> Mosquitto-Passwort anlegen"
  docker run --rm -e MQ_PASS="$(env_get MQTT_PASSWORD)" -v "$PWD/mosquitto:/mosquitto/config" eclipse-mosquitto:2 \
    sh -c 'mosquitto_passwd -b -c /mosquitto/config/passwd elma "$MQ_PASS" && chown mosquitto:mosquitto /mosquitto/config/passwd && chmod 0600 /mosquitto/config/passwd'
fi

echo "==> Images laden und Backend starten"
docker compose pull --quiet --ignore-pull-failures # schon lokal vorhandene Images reichen
docker compose up -d backend

echo "==> Warte auf das Backend"
for _ in $(seq 1 60); do
  if docker compose exec -T backend node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" </dev/null 2>/dev/null; then
    break
  fi
  sleep 2
done

cli() { docker compose exec "$@"; }

if yes_no "Ersten Benutzer und Erzeuger jetzt anlegen?" j; then
  email="$(ask "E-Mail des Erzeugers")"
  name="$(ask "Name des Erzeugers (erscheint in der App)" "PV-Anlage")"
  if [ -t 0 ]; then
    cli backend node src/cli.ts create-user "$email" || echo "    (Benutzer gibt es vermutlich schon)" # fragt das Passwort verdeckt ab
  else
    cli -T backend node src/cli.ts create-user "$email" || echo "    (Benutzer gibt es vermutlich schon)"
  fi
  output="$(cli -T backend node src/cli.ts create-producer "$name" "$email" </dev/null)"
  echo "$output"
  token="$(echo "$output" | sed -n 's/^DEVICE_TOKEN=\([^ ]*\).*/\1/p')"
  if $mqtt_enabled && [ -n "$token" ]; then
    env_set DEVICE_TOKEN "$token"
    echo "    DEVICE_TOKEN für die Bridge in .env eingetragen."
  fi
fi

echo "==> Alle Dienste starten"
docker compose up -d

lan_ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
cat <<EOF

Fertig.
  App im LAN:   http://${lan_ip:-localhost}:$port
  Öffentlich:   $(env_get PUBLIC_URL)
  Shelly:       URL von oben unter Settings → Outbound WebSocket eintragen
  Update:       docker compose pull && docker compose up -d
  Backup:       docker compose stop backend && docker compose cp backend:/data/. ./backup/ && docker compose start backend
Weitere Erzeuger:
  docker compose exec backend node src/cli.ts create-user <email>
  docker compose exec backend node src/cli.ts create-producer "<Name>" <email>
EOF
