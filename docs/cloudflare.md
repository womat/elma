# Cloudflare Tunnel einrichten

Mit dem Cloudflare Tunnel ist ELMA aus dem Internet erreichbar (z. B. unter `https://my-elma.net`), ohne dass am Router ein Port geöffnet wird.
Diese Anleitung beschreibt die Einrichtung von Grund auf, etwa nach einer Neuinstallation oder für einen zweiten Pi.

## Das Prinzip

1. **Domain:** Cloudflare verwaltet die Domain (`my-elma.net`) und darf deshalb entscheiden, wohin Anfragen gehen.
2. **Tunnel:** Ein Tunnel ist bei Cloudflare ein benannter Eingang mit einem geheimen **Token**.
   Wer das Token hat, darf sich als dieser Tunnel anmelden. Bei uns ist das der Container `cloudflared` auf dem Pi.
3. **Weiterleitungsregel (Public Hostname):** „Anfragen an `my-elma.net` → durch diesen Tunnel → dort an `http://backend:3000`.“

```
Handy ──HTTPS/WSS──▶ Cloudflare ══Tunnel══▶ cloudflared ──HTTP──▶ backend:3000
                     (TLS endet hier)       (Container auf dem Pi, baut die Verbindung von innen auf)
```

- **Ausgehende Verbindung:** `cloudflared` baut die Verbindung **von innen nach außen** auf und hält sie offen.
  Deshalb sind weder Portweiterleitung noch feste IP noch DynDNS nötig, und die Heim-IP bleibt verborgen.
- **Wo die Verschlüsselung endet:** TLS endet bei Cloudflare, Cloudflare könnte den Verkehr also technisch mitlesen.
  Durch den Tunnel geht es wieder verschlüsselt zum Pi.
  Nur innerhalb des Docker-Netzes auf dem Pi läuft es unverschlüsselt per HTTP.
- **Keine ELMA-Software bei Cloudflare:** Bei Cloudflare liegt nur die Konfiguration.
  App, Datenbank und Konten sind vollständig auf dem Pi.

## Schritt für Schritt

### 1. Domain zu Cloudflare bringen (einmalig)

Dafür gibt es zwei Wege:

- **Domain direkt bei Cloudflare kaufen:** unter *Domain Registration*. Sie ist dann automatisch richtig eingerichtet.
- **Domain woanders gekauft** (z. B. World4You, easyname):
  1. In Cloudflare *Add a site* aufrufen, die Domain eintragen und den Plan **Free** wählen.
  2. Cloudflare nennt zwei **Nameserver** (z. B. `xxx.ns.cloudflare.com`). Diese beim Domain-Anbieter eintragen.
  3. Nach einigen Minuten bis Stunden zeigt Cloudflare die Domain als *Active*.

Nur wer die Nameserver einer Domain kontrolliert, darf festlegen, wohin sie zeigt.

### 2. Tunnel anlegen

1. Im Dashboard links **Zero Trust** öffnen.
   Beim ersten Mal fragt Cloudflare nach einem Teamnamen und dem Plan. Hier **Free** wählen.
   Eventuell will Cloudflare eine Zahlungsmethode hinterlegt haben, berechnet aber nichts.
2. **Networks → Tunnels → Create a tunnel** aufrufen.
3. Als Typ **Cloudflared** wählen und einen Namen vergeben, z. B. `elma-pi`.
4. Cloudflare zeigt einen Installationsbefehl mit einem langen Token (`eyJhIjoi…`).
   Nur dieses **Token** übernehmen. Den Rest der Installationsanleitung ignorieren,
   denn `cloudflared` steht bei uns schon als Container in der `docker-compose.yml`.

### 3. Token auf den Pi

In `~/elma/.env` auf dem Pi eintragen:

```
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoi…
PUBLIC_URL=https://my-elma.net
```

`PUBLIC_URL` braucht ELMA für die Einladungslinks.

Starten:

```bash
docker compose --profile bridge --profile tunnel up -d
```

Im Dashboard sollte der Tunnel nach wenigen Sekunden auf **Healthy** springen. Dann hat sich `cloudflared` angemeldet.

### 4. Weiterleitungsregel (Public Hostname)

Im Tunnel unter **Public Hostname → Add a public hostname**:

| Feld | Wert |
|---|---|
| Subdomain | leer, oder z. B. `elma` für `elma.deine-domain.at` |
| Domain | `my-elma.net` |
| Service Type | `HTTP` |
| URL | `backend:3000` |

**Warum `backend:3000`** und nicht `localhost` oder die IP des Pi?
`cloudflared` läuft als Container im selben Docker-Netz wie das Backend, und dort heißt das Backend einfach `backend`.
Einen Port am Pi gibt es für ELMA gar nicht: Das Backend hängt nur in einem internen Docker-Netz.

Beim Speichern legt Cloudflare automatisch den passenden DNS-Eintrag an, einen CNAME auf `<tunnel-id>.cfargotunnel.com`.

### 5. Testen

https://my-elma.net/api/health aufrufen. Dort muss `{"ok":true,"version":"…"}` erscheinen.

## Stolperfallen

- **Tunnel bleibt „Inactive“ oder „Down“:**
  - Das Token ist falsch oder unvollständig kopiert, oder der Container läuft nicht.
  - Prüfen mit:
    ```bash
    docker compose logs cloudflared
    ```
- **Fehler 502 (Bad Gateway):** Der Tunnel steht, aber die URL in der Weiterleitungsregel stimmt nicht, oder das Backend läuft nicht.
  Prüfen mit `docker compose ps`.
- **„DNS record already exists“:** Für die Domain gibt es schon einen alten Eintrag.
  Diesen unter *DNS → Records* löschen und die Regel erneut speichern.

## Sicherheit

- **Das Token ist geheim:** Wer es hat, kann einen eigenen Rechner als diesen Tunnel ausgeben und Anfragen an die Domain abfangen.
  Es steht nur in der `.env` auf dem Pi und gehört **nie ins Repo** oder in einen Chat.
- **Bei Verlust:** Ist das Token bekannt geworden, im Dashboard den Tunnel löschen und neu anlegen (oder das Token rotieren).
  Danach das neue Token in die `.env` eintragen und `cloudflared` neu starten.
- **Was Cloudflare abfängt:** Massenangriffe (DDoS) treffen Cloudflare und nicht den Pi.
  Gegen Fehler in ELMA selbst hilft Cloudflare nicht, weil Anfragen an Anmeldung und API bis zum Pi durchgehen.
- **Echte Absender-Adresse:** ELMA bremst die Anmeldung auf 10 Anfragen pro Minute und Adresse.
  Als Adresse dient `CF-Connecting-IP`, das Cloudflare selbst setzt. `X-Forwarded-For` kann der Client dagegen fälschen.

### Optional: Rate-Limiting-Regel bei Cloudflare

Damit fängt Cloudflare Fluten auf die Anmeldung schon ab, bevor sie den Pi erreichen.
Der Gratis-Tarif erlaubt eine solche Regel, mit festen Werten (Zeitraum und Sperre je 10 Sekunden).

1. Im Dashboard die Domain öffnen (nicht Zero Trust), dann **Security → Security rules → Create rule → Rate limiting rule**.
   In der älteren Ansicht heißt es *Security → WAF → Rate limiting rules → Create rule*.
2. Name, z. B. `ELMA Anmeldung`.
3. Bedingung: *URI Path* · *starts with* · `/api/auth/`
4. Gezählt wird pro IP (Standard). Grenze z. B. **10 Anfragen pro 10 Sekunden**.
5. Aktion **Block** für 10 Sekunden, dann **Deploy**.

Für normale Nutzer ändert sich nichts: Eine Anmeldung braucht nur zwei Anfragen.

## Kosten

Tunnel, DNS, Zertifikat und DDoS-Schutz sind im Gratis-Tarif enthalten.

**Warum gratis?**
- **Freemium:** Cloudflare verdient an Firmen mit bezahlten Plänen. Der Gratis-Tarif bringt Entwickler und Bastler auf die Plattform.
- **Geringe Kosten:** Das weltweite Netz betreibt Cloudflare ohnehin, kleine Seiten wie ELMA fallen kaum ins Gewicht.
- **Daten als Gegenleistung:** Je mehr Verkehr durchläuft, desto besser erkennt Cloudflare Angriffsmuster.
  Ein Stück weit bezahlt man mit den Verkehrsdaten.

**Was trotzdem anfällt:** die **Domain**, je nach Endung ca. 10–15 € im Jahr.

**Einschränkungen:**
- **Kein Service:** keine zugesagte Verfügbarkeit und kein Support. Fällt der Tunnel aus, hilft nur Abwarten.
- **Nutzungsbedingungen:** Große Mengen an Video oder Downloads sind nicht erwünscht. Für ELMA spielt das keine Rolle.
- **Änderbare Bedingungen:** Cloudflare kann die Bedingungen ändern.
  ELMA hängt aber nicht von Cloudflare ab, ein Wechsel betrifft nur den Weg von außen.

## Alternativen

Der Sammelbegriff für solche Dienste ist **Tunneling-Dienst** bzw. **Reverse Tunnel**.
Gesucht wird oft nach „ngrok alternative“ oder „self-hosted tunnel“.
Cloudflare selbst ordnet den Tunnel unter **Zero Trust** bzw. ZTNA (Zero Trust Network Access) ein.
Eine gepflegte Übersicht ist die Liste [awesome-tunneling](https://github.com/anderspitman/awesome-tunneling) auf GitHub.

| Alternative | Kosten | Besonderheit |
|---|---|---|
| **Tailscale Funnel** | gratis | TLS endet auf dem Pi (Ende-zu-Ende), aber keine eigene Domain (`*.ts.net`) |
| **ngrok** | gratis eingeschränkt, eigene Domain kostet | der Klassiker |
| **Pangolin, frp, rathole** mit eigenem VPS | ca. 3–5 €/Monat für den VPS | selbst gehostet, kein Dritter sieht mit |
| **Portweiterleitung** mit Caddy und Let's Encrypt | gratis | ohne Tunnel, Port am Router offen, braucht DynDNS |
