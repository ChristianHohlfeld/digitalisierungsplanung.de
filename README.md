# Digitalisierungsplanung

Zustand ist ein visueller State-Machine-Editor für digitalisierbare Geschäftsprozesse. Der Kern ist ein gemeinsames JSON-Modell: States, Transitionen, Trigger, Conditions, UI-Komponenten und Daten liegen in einer Struktur und laufen über denselben globalen JSON-State/Event-Bus.

Die öffentliche Root-Seite `index.html` ist die exportierte Zustand Demo. Der Editor liegt in `state.html` und kann genau diese Demo als bearbeitbaren Flow laden.

## Einstieg

| Ziel | URL / Datei |
| --- | --- |
| Öffentliche Demo | `https://digitalisierungsplanung.de/` |
| Editor | `https://digitalisierungsplanung.de/state.html` |
| Editor mit Demo | `https://digitalisierungsplanung.de/state.html?demo=zustand` |
| Editor mit Realtime-Room | `https://digitalisierungsplanung.de/state.html?room=<room-id>` |
| Realtime-Konsole | `https://realtime.digitalisierungsplanung.de/console.html?room=<room-id>` |
| Realtime-Events | `https://realtime.digitalisierungsplanung.de/events` |
| Realtime-WSS | `wss://realtime.digitalisierungsplanung.de/ws` |

## Contract

Es gibt genau eine fachliche Wahrheit:

```text
globaler JSON-State/Event-Bus
```

Regeln:

- States sind Sichten auf relevante Daten im globalen JSON-Baum.
- Transitionen sind echte Kanten zwischen existierenden States.
- Trigger, Conditions, Timer und `set`-Patches sind Modelldaten.
- Render liest aus Modell und Bus. Render ist nicht die Wahrheit.
- Labels sind Anzeige. IDs sind Bindung.
- Widgets und Presets erzeugen Daten erst, wenn sie als echte Canvas-States genutzt werden.
- Nested States laufen über Boundary-Proxies und echte Drähte.
- Wenn kein echter Out existiert, stoppt die Maschine.
- Realtime-Events schreiben erst in den globalen Bus und können erst danach Transitionen bewegen.

Der ausführliche Produkt- und Architekturvertrag steht in [`statereadme.md`](statereadme.md).

## App

`state.html` enthält die komplette Hauptanwendung:

- visueller FSM-Canvas,
- State-Inspector für Flow, Trigger, Render, Daten und Widgets,
- generierte App-Vorschau,
- DaisyUI-Widget- und State-Presets,
- Nested-State-Layers mit Boundary-Proxies,
- Fetch-on-enter als State-Effekt,
- Save/Load/Import/Export,
- Realtime-Event-Auswahl aus `/events`,
- PWA-Registrierung und statischer Export.

`index.html` ist ein exportierter Stand derselben Demo, die im Editor über `state.html?demo=zustand` geladen werden kann.

Root-Demo neu exportieren:

```bash
npm run build:index
```

PWA-Assets neu bauen:

```bash
npm run build:pwa-assets
```

Service-Worker-Version lokal schreiben:

```bash
npm run build:sw-version
```

## Realtime

Der Realtime-Server in `server/` ist schlank gehalten. Er ist Transport und Event-Katalog, nicht Modell-API und nicht fachlicher Speicher.

Core-Routen:

| Route | Zweck |
| --- | --- |
| `GET /healthz` | Healthcheck |
| `GET /events` | angebotene `realtime.*` Events |
| `GET /token` | signiertes Room-Token für Browser |
| `GET /console.html` | manuelles Test-Emit im Browser |
| `POST /emit` | authentifiziertes Server-to-server Event |
| `WSS /ws` | WebSocket Relay |

Der Server persistiert keine fachlichen Objekte. `/emit` akzeptiert nur Events aus `/events`, broadcastet sie in den angegebenen Room und bleibt stateless.

Externes Event feuern:

```bash
curl -X POST https://realtime.digitalisierungsplanung.de/emit \
  -H "authorization: Bearer $REALTIME_EMIT_SECRET" \
  -H "content-type: application/json" \
  -d '{"roomId":"demo","name":"realtime.sip.call.incoming","detail":{"caller":"+491234","callee":"100","callId":"abc-123"}}'
```

Passende Transition im Editor:

```text
triggerType: realtime
triggerEvent: realtime.sip.call.incoming
```

Browser-Origin ist in Production auf `https://digitalisierungsplanung.de` begrenzt. Details stehen in [`docs/realtime-api.md`](docs/realtime-api.md).

## Realtime Deploy

Der Droplet-Prozess läuft lokal auf `127.0.0.1:8788` und wird durch Nginx auf `realtime.digitalisierungsplanung.de` veröffentlicht.

Wichtige Dateien:

- [`server/server.js`](server/server.js): Realtime-Server
- [`server/ecosystem.config.cjs`](server/ecosystem.config.cjs): PM2-Prozess
- [`server/deploy.sh`](server/deploy.sh): Droplet-Deploy
- [`server/nginx/realtime.digitalisierungsplanung.de.conf`](server/nginx/realtime.digitalisierungsplanung.de.conf): produktive Nginx-Konfiguration
- [`server/nginx/realtime.digitalisierungsplanung.de.bootstrap.conf`](server/nginx/realtime.digitalisierungsplanung.de.bootstrap.conf): HTTP-Bootstrap für erstes Zertifikat

Update auf dem Droplet:

```bash
cd /var/www/digitalisierungsplanung.de
git pull --ff-only origin main
bash server/deploy.sh
```

`server/deploy.sh`:

- installiert Runtime-Pakete inklusive `certbot`, `nginx`, `git`, `openssl`,
- zieht `main`,
- führt `npm ci --omit=dev` aus,
- legt `/etc/digitalisierungsplanung-realtime.env` an, falls es fehlt,
- ergänzt `REALTIME_EMIT_SECRET`, falls es fehlt,
- startet oder reloadet PM2 per `startOrReload`,
- speichert PM2 für Reboots,
- aktiviert `certbot.timer`, wenn vorhanden,
- installiert die passende Nginx-Konfiguration,
- lädt Nginx neu,
- prüft lokal `/healthz`.

Wenn nur statische Frontend-Dateien geändert wurden, reicht der Push nach `main`; der Droplet-Deploy ist nur für Server-, Nginx-, Dependency- oder Env-Änderungen nötig.

Produktions-Smokes:

```bash
npm run server:smoke:wss:prod
npm run server:smoke:emit:prod
```

Die Smoke-Skripte lesen `/etc/digitalisierungsplanung-realtime.env`, wenn die Datei existiert.

## MCP/API

Die MCP-Schicht bearbeitet dasselbe kanonische Modell wie der Editor. Sie hält keinen parallelen Laufzeit-Store und klickt nicht die UI.

Start:

```bash
STATE_BLUEPRINT_MODEL_PATH=./state-blueprint.workspace.json npm run mcp:state
```

Wichtige Tools:

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

Nützliche fokussierte Testgruppen:

```bash
npm run test:state-explorer
npm run test:state-render
```

`npm test` führt die Server-Tests und alle `@smoke` Playwright-Flows aus. In CI läuft der Deploy-Workflow mit `npm test` und schreibt nach grünem Lauf automatisch einen neuen `sw-version.js`-Stamp.

## Repository

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
|   |-- realtime-api.md
|   |-- state-blueprint-api.md
|   `-- state-blueprint-mcp.md
|-- mcp/
|   |-- state-blueprint-core.js
|   |-- state-blueprint-intents.js
|   `-- state-blueprint-server.js
|-- scripts/
|   |-- build-index.mjs
|   |-- build-pwa-assets.mjs
|   `-- write-sw-version.mjs
|-- server/
|   |-- server.js
|   |-- deploy.sh
|   |-- run.sh
|   |-- ecosystem.config.cjs
|   |-- emit-smoke.js
|   |-- wss-smoke.js
|   |-- server.test.js
|   `-- nginx/
|-- tests/
|-- .github/workflows/deploy.yml
`-- .gitea/workflows/test.yml
```

## Release Flow

1. Änderungen auf `main` pushen.
2. GitHub Action `Deploy` läuft `npm test`.
3. Nach grünem Lauf schreibt die Action einen neuen `sw-version.js`-Deploy-Stamp.
4. GitHub Pages veröffentlicht die statische App.
5. Für Realtime-Server-Änderungen zusätzlich auf dem Droplet `git pull --ff-only origin main && bash server/deploy.sh` ausführen.

Aktueller Anspruch: Lean Core, eine Root-Demo, ein Editor, ein Realtime-Transport, ein globaler JSON-State/Event-Bus.
