# Digitalisierungsplanung

Zustand macht Geschäftsprozesse sichtbar, prüfbar und ausführbar. Ein Ablauf wird als Zustandsdiagramm gebaut: Zustände, Übergänge, Auslöser, Bedingungen, Daten und Darstellung liegen in einem gemeinsamen JSON-Modell.

Der wichtigste Gedanke: Nur verstandene Prozesse lassen sich sauber digitalisieren.

![Vorschau](assets/share-card.png)

## Einstieg

| Ziel | Adresse |
| --- | --- |
| Öffentliche Startseite | `https://digitalisierungsplanung.de/` |
| Werkzeug öffnen | `https://digitalisierungsplanung.de/state.html` |
| Beispiel im Werkzeug laden | `https://digitalisierungsplanung.de/state.html?demo=zustand` |
| Werkzeug mit Echtzeit-Raum | `https://digitalisierungsplanung.de/state.html?room=<raum-id>` |
| Echtzeit-Konsole | `https://realtime.digitalisierungsplanung.de/console.html?room=<raum-id>` |
| Ereigniskatalog | `https://realtime.digitalisierungsplanung.de/events` |
| Release-ID | `https://realtime.digitalisierungsplanung.de/version` |
| WebSocket | `wss://realtime.digitalisierungsplanung.de/ws` |

## Grundvertrag

Es gibt genau eine fachliche Wahrheit:

```text
globaler JSON-Datenbus
```

Regeln:

- Ein Zustand ist eine Sicht auf die Daten, die ihn betreffen.
- Ein Übergang verbindet zwei vorhandene Zustände.
- Ein Auslöser bewegt den Ablauf: Schaltfläche, Zeit, Datenänderung, API-Antwort oder Echtzeit-Ereignis.
- Bedingungen entscheiden, ob ein Übergang feuern darf.
- Darstellung liest Modell und Datenbus. Darstellung ist nie eigene Wahrheit.
- Text ist Anzeige. IDs sind Bindung.
- Vorlagen erzeugen erst Daten, wenn sie als echte Zustände genutzt werden.
- Verschachtelte Zustände laufen über echte Eingänge, Ausgänge und Verbindungen.
- Wenn kein echter Ausgang erreichbar ist, stoppt der Ablauf.
- Externe Ereignisse schreiben zuerst in den Datenbus. Erst danach kann ein Übergang reagieren.

Der ausführliche Vertrag steht in [`statereadme.md`](statereadme.md).

## Hauptdateien

- [`index.html`](index.html): veröffentlichte Startseite, aus dem Werkzeug exportiert
- [`state.html`](state.html): das komplette Werkzeug
- [`statereadme.md`](statereadme.md): Prinzipien, Architektur und Richtung
- [`docs/state-blueprint-api.md`](docs/state-blueprint-api.md): Programmierschnittstelle
- [`docs/state-blueprint-mcp.md`](docs/state-blueprint-mcp.md): MCP-Schnittstelle
- [`docs/realtime-api.md`](docs/realtime-api.md): Echtzeit-Schnittstelle

## Werkzeug

`state.html` enthält:

- Arbeitsfläche für Zustände und Übergänge
- Eigenschaften für Daten, Auslöser, Darstellung und Verbindungen
- App-Vorschau
- Vorlagen für häufige Oberflächenbausteine
- verschachtelte Zustände mit Eingang und Ausgang
- Datenladen beim Betreten eines Zustands
- Speichern, Laden, Einlesen und Ausgeben
- Echtzeit-Ereignisse aus `/events`
- PWA-Dateien und statische HTML-Ausgabe

Die öffentliche Startseite ist ein exportierter Ablauf. Im Werkzeug kann dieselbe Beispielseite über `state.html?demo=zustand` geöffnet werden.

Startseite neu erzeugen:

```bash
npm run build:index
```

PWA-Bilder neu erzeugen:

```bash
npm run build:pwa-assets
```

Gemeinsame Frontend-/Backend-Release-ID lokal um eins erhöhen:

```bash
npm run build:sw-version
```

CI führt denselben Schritt erst nach allen Verträgen aus. Die Datei enthält
danach beispielsweise `release-59`; `/version` und `/healthz` melden exakt
dieselbe ID für den Backend-Prozess.

Der Service Worker hält bewusst keinen App- oder Asset-Cache. Er entfernt
vorhandene Cache-Storage-Bestände und lädt gleich-originige Ressourcen mit
Cache-Buster und `no-store` aus dem Netz.

## Echtzeit

Der Server in [`server/`](server/) ist nur Transport. Er speichert keine fachlichen Daten und besitzt kein zweites Modell.

| Route | Zweck |
| --- | --- |
| `GET /healthz` | Gesundheitsprüfung |
| `GET /version` | gemeinsame Frontend-/Backend-Release-ID |
| `GET /events` | erlaubte Echtzeit-Ereignisse |
| `GET /token` | signiertes Raum-Token für den Browser |
| `GET /console.html` | Testoberfläche für Ereignisse |
| `POST /emit` | authentifiziertes Ereignis von außen |
| `WSS /ws` | WebSocket-Verbindung |

Ein Ereignis von außen senden:

```bash
curl -X POST https://realtime.digitalisierungsplanung.de/emit \
  -H "authorization: Bearer $REALTIME_EMIT_SECRET" \
  -H "content-type: application/json" \
  -d '{"roomId":"demo","name":"realtime.sip.call.incoming","detail":{"caller":"+491234","callee":"100","callId":"abc-123"}}'
```

Dazu passender Übergang im Werkzeug:

```text
triggerType: realtime
triggerEvent: realtime.sip.call.incoming
```

Der Browser-Ursprung ist produktiv auf `https://digitalisierungsplanung.de` begrenzt.

## Server-Veröffentlichung

Der Echtzeit-Server läuft auf dem Droplet lokal unter `127.0.0.1:8788`. Nginx veröffentlicht ihn unter `realtime.digitalisierungsplanung.de`.

Wichtige Dateien:

- [`server/server.js`](server/server.js): Server
- [`server/ecosystem.config.cjs`](server/ecosystem.config.cjs): PM2-Prozess
- [`server/deploy.sh`](server/deploy.sh): Veröffentlichung auf dem Droplet
- [`server/auto-deploy.sh`](server/auto-deploy.sh): atomare automatische Aktualisierung
- [`server/nginx/realtime.digitalisierungsplanung.de.conf`](server/nginx/realtime.digitalisierungsplanung.de.conf): produktive Nginx-Datei
- [`server/nginx/realtime.digitalisierungsplanung.de.bootstrap.conf`](server/nginx/realtime.digitalisierungsplanung.de.bootstrap.conf): erste HTTP-Konfiguration für Zertifikate

Automatische Aktualisierung einmalig installieren:

```bash
cd /var/www/digitalisierungsplanung.de
git fetch --prune --force origin +refs/heads/main:refs/remotes/origin/main
git reset --hard origin/main
git clean -ffd
sudo bash server/deploy.sh
sudo bash server/auto-deploy.sh --install
```

Danach prüft ein Systemd-Timer jede Minute `origin/main`. Er reagiert erst auf
eine nach vollständigem CI-Lauf hochgezählte `release-N`-ID, verwirft lokale
Änderungen im Server-Checkout, deployt exakt den freigegebenen Commit und prüft
PM2, Nginx sowie die gleiche ID in `/healthz`. Bei einem Fehlschlag bleibt
beziehungsweise wird der letzte verifizierte Stand wieder aktiv.

```bash
sudo bash server/auto-deploy.sh --once
sudo bash server/auto-deploy.sh --status
journalctl -u digitalisierungsplanung-auto-deploy.service -n 100 --no-pager
```

Secrets bleiben außerhalb des Repositories in
`/etc/digitalisierungsplanung-realtime.env`. `origin/main` gewinnt im
Anwendungsverzeichnis ausdrücklich gegen lokale Dateien und Änderungen.

Produktive Prüfungen:

```bash
npm run server:smoke:wss:prod
npm run server:smoke:emit:prod
```

## API und MCP

Die Schnittstellen bearbeiten dasselbe Modell wie das Werkzeug. Sie klicken nicht die Oberfläche und halten keinen zweiten Speicher.

Start:

```bash
STATE_BLUEPRINT_MODEL_PATH=./state-blueprint.workspace.json npm run mcp:state
```

Wichtige Werkzeuge:

- `state_blueprint_get_model`
- `state_blueprint_replace_model`
- `state_blueprint_apply_actions`
- `state_blueprint_plan_prompt`
- `state_blueprint_apply_prompt`
- `state_blueprint_validate`
- `state_blueprint_export_definition`
- `state_blueprint_export_html`
- `state_blueprint_import_definition`
- `state_blueprint_action_catalog`

Dokumentation:

- [`docs/state-blueprint-api.md`](docs/state-blueprint-api.md)
- [`docs/state-blueprint-mcp.md`](docs/state-blueprint-mcp.md)

## Entwicklung

Installieren:

```bash
npm install
```

Server lokal starten:

```bash
npm run server:start
```

Tests:

```bash
npm test
npm run test:server
npm run test:contracts
npm run test:full
```

Gezielte Prüfgruppen:

```bash
npm run test:state-explorer
npm run test:state-render
```

`npm test` führt die Server-Tests und die wichtigsten Playwright-Abläufe aus. `npm run test:full` führt den vollständigen Bestand lokal in einem Lauf aus. GitHub Actions verteilt dieselben 324 Browserfälle vollständig auf vier parallele Shards, führt die Serverfälle einmal aus und erhöht erst nach dem Gesamterfolg die gemeinsame Release-Sequenz in `sw-version.js`.

## Ordner

```text
.
|-- index.html
|-- state.html
|-- manifest.webmanifest
|-- register-sw.js
|-- sw.js
|-- sw-version.js
|-- package.json
|-- playwright.config.js
|-- statereadme.md
|-- CNAME
|-- assets/
|-- docs/
|-- mcp/
|-- scripts/
|-- server/
|-- tests/
|-- .github/workflows/deploy.yml
`-- .gitea/workflows/test.yml
```

## Veröffentlichung

1. Änderungen auf `main` pushen.
2. GitHub Actions führt alle Server- und Browserfälle in vier vollständigen Browser-Shards aus.
3. Nach grünem Lauf wird die gemeinsame `release-N`-ID in `sw-version.js` inkrementiert.
4. GitHub Pages veröffentlicht die statische Seite.
5. Der Droplet-Timer erkennt die neue ID, synchronisiert den Remote-Stand mit Force, deployt und verifiziert dieselbe ID über die API.

Anspruch: ein schlanker Kern, ein Modell, ein Datenbus, eine ausführbare Oberfläche.
