# Digitalisierungsplanung

Zustand macht Geschäftsprozesse sichtbar, prüfbar und ausführbar. Ein Ablauf wird als Zustandsdiagramm gebaut: Zustände, Übergänge, Auslöser, Bedingungen, Daten und Darstellung liegen in einem gemeinsamen JSON-Modell.

Der wichtigste Gedanke: Nur verstandene Prozesse lassen sich sauber digitalisieren.

![Vorschau](assets/share-card.png)

## Einstieg

| Ziel | Adresse |
| --- | --- |
| Öffentliche Startseite | `https://digitalisierungsplanung.de/` |
| Werkzeug öffnen | `https://digitalisierungsplanung.de/state.html` |
| Beispielablauf im Werkzeug laden | `https://digitalisierungsplanung.de/state.html?demo=zustand` |
| Werkzeug mit Echtzeit-Raum | `https://digitalisierungsplanung.de/state.html?room=<raum-id>` |
| Realtime Admin Hub | `https://realtime.digitalisierungsplanung.de/` |
| Echtzeit-Konsole | `https://realtime.digitalisierungsplanung.de/console.html?room=<raum-id>` |
| Echtzeit-Event-Designer | `https://realtime.digitalisierungsplanung.de/events-admin.html` |
| Ereigniskatalog | `https://realtime.digitalisierungsplanung.de/events` |
| Release-ID | `https://realtime.digitalisierungsplanung.de/version` |
| WebSocket | `wss://realtime.digitalisierungsplanung.de/ws` |

## Grundvertrag

Es gibt zwei fachliche Wahrheiten mit einer festen Grenze:

```text
normalisiertes JSON-Modell = persistierte Struktur
globaler JSON-Daten-/Ereignisbus = veränderliche Laufzeit
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

Der normative Kernvertrag steht in [`docs/state-contract.md`](docs/state-contract.md).
Der ausführliche Architektur- und Auditkontext steht in
[`statereadme.md`](statereadme.md).

## Hauptdateien

- [`index.html`](index.html): veröffentlichte Startseite, aus dem Werkzeug exportiert
- [`state.html`](state.html): das komplette Werkzeug
- [`docs/state-contract.md`](docs/state-contract.md): normativer Kernvertrag
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
npm run build:release-version
```

CI führt denselben Schritt erst nach allen Verträgen aus. Die Datei enthält
danach die aktuelle `release-N`-ID; `/version` und `/healthz` melden exakt
dieselbe ID für den Backend-Prozess.

Die App registriert keinen Service Worker. `disable-sw.js` und der
`sw.js`-Tombstone melden noch vorhandene alte Worker ab und löschen ausschließlich
alte Cache-Storage-Bestände; es gibt keinen Fetch-Interceptor und keinen Cache.

## Echtzeit

Der Server in [`server/`](server/) ist nur Transport. Er speichert keine fachlichen Daten und besitzt kein zweites Modell.

| Route | Zweck |
| --- | --- |
| `GET /` | zentraler Realtime Admin Hub |
| `GET /admin.html` | gleicher Admin Hub als explizite Route |
| `GET /admin/routes` | JSON-Index aller sichtbaren Realtime-Tools und Endpunkte |
| `GET /healthz` | Gesundheitsprüfung |
| `GET /version` | gemeinsame Frontend-/Backend-Release-ID |
| `GET /contract` | zentraler Product Contract: Trigger-Typen, Datentypen, Datasets, Quellen, Presets, Preset-Pakete, Abo-Pläne und State-Beiträge |
| `GET /events` | kanonischer Realtime-Katalog mit Ereignissen, Emittern, Datentypen und State-Beiträgen |
| `GET /token` | signiertes Raum-Token für den Browser |
| `GET /console.html` | Testoberfläche für Ereignisse |
| `GET /events-admin.html` | einfacher Designer für Event-Type, Datensatz und Felder |
| `GET/POST /events-admin/catalog` | validieren, committen und pushen von `server/event-catalog.json` |
| `GET /presets-admin.html` | Designer für offizielle DaisyUI-Snippets, Presets, Kategorien und Pakete |
| `GET/POST /presets-admin/catalog` | vollständige Preset-Library laden, validieren, committen und pushen |
| `POST /presets-admin/parse` | DaisyUI-Markup ohne Persistenz in eine strukturierte Preset-Definition übersetzen |
| `POST /presets-admin/import` | kanonische Preset-Definition von einer öffentlichen HTTPS-API als Entwurf importieren |
| `POST /assets/inline-image` | öffentliches Bild ohne Persistenz als Data URI für einen eigenständigen HTML-Export laden |
| `POST /emit` | authentifiziertes Ereignis von außen |
| `WSS /ws` | WebSocket-Verbindung |

Der harte Contract kommt aus [`server/event-catalog.json`](server/event-catalog.json)
und wird vom Server unter `/contract` als Product Contract ausgeliefert:
Trigger-Typen, Value-Types mit Constraints, `realtime.*`-Datasets, Quellen,
Standard-Presets aus `server/preset-catalog.js`, verwaltete Presets und
Kategorien aus `server/preset-library.json`, Preset-Pakete,
Abo-Pläne und kollisionsfreie State-Beiträge. Jedes Contract-Feld liefert neben `fieldTypes`
auch `fieldSchemas` mit `type`, `jsonType`, `default` und `constraints`
wie `min`, `max`, `maxLength`, `format`, `protocols`, `maxDepth` oder
`maxItems`. `/emit` und WebSocket-Runtime-Events prüfen dieselben Schemas,
bevor ein Event in den Raum darf. `/events` bleibt der schlanke Live-Katalog
für Realtime-Events. Der Canvas speichert keine Katalogkopie, sondern nur
konkrete Referenzen wie `triggerType: realtime` und `triggerEvent`.
`state.html` lädt `/contract` beim Start mit `no-store`; wenn der Product
Contract nicht erreichbar ist, startet der Editor nicht mit lokalen
Fallback-Typen oder lokalen Preset-Definitionen.

Preset-Pakete sind reine Server-Metadaten für Verkauf, Anzeige und spätere
Freischaltung. Der Canvas speichert keine Paketkopie; ein Preset schreibt
weiter nur seinen eindeutigen `stateContribution` in den globalen JSON-State.
Die drei Standard-Abos sind `starter`, `business` und `scale`. Zusatzpakete
wie `bi.analytics`, `sales.crm`, `knowledge.portal` und
`integration.automation` bleiben auch neben dem größten Paket separat
zubuchbar.

Im Editor liegen alle mitgelieferten Vorlagen zunächst gemeinsam unter
**Websuite Builder**. Der Preset Designer kann weitere Kategorien und Pakete
anlegen. Ein eingefügtes DaisyUI-v5.6.18-Beispiel wird serverseitig strukturell
geparst; gespeichert werden ausschließlich Variante und Defaultdaten, niemals
der HTML-Snippet. `Definition erzeugen` verändert den Contract noch nicht.
Alternativ lädt `Webhook/API-URL` eine exakte Preset-Definition als Entwurf.
URL und Rohantwort werden nicht gespeichert.
Erst `In Contract speichern` validiert die gesamte Library, schreibt
`server/preset-library.json`, erhöht die gemeinsame Release-ID und pusht den
Commit nach `main`.

Verwaltete Presets enthalten keine fertigen Transition-IDs. Der Canvas erzeugt
beim Einfügen für jede fachliche Aktion eine eigene ID und bindet sie genau
einmal. Eine explizite UI-Bindung bleibt beim Wechsel des Trigger-Typs eindeutig,
rendert aber ausschließlich für `button` ein Control; Timer, Change, Event,
Realtime, API und Auto erhalten weder Ersatzbutton noch lokale Fallback-Aktion.
Ein UI-Aktionsslot besitzt entweder genau eine Transition-ID oder genau eine
URL, niemals beides.

Trigger bleiben Eigentum der Transition. Pro effektiver aktiver Quelle darf
dieselbe Triggeridentität nur einmal vorkommen. Conditions gehören nicht zur
Identität und dürfen keinen mehrfach belegten Event priorisieren. Ein Timer ist einmal
zulässig, `auto` ist exklusiv. Der Editor speichert keinen Konflikt, Import/API/MCP
lehnen ihn ab und die gemeinsame Preview-/Export-Runtime bleibt bei Fremdmodellen
fail-closed. Zulässige fachliche Typen sind ausschließlich `button`, `change`,
`event`, `realtime`, `api`, `timer` und `auto`; internes `flow` dient nur der
Child-Führung. Unbekannte Werte werden nicht als Alias akzeptiert oder
normalisiert. Server-getriebene Condition-Pfade unter `events.*`, `realtime.*`
und `emitters.*` müssen exakt im Product Contract deklariert sein.

Der Designer arbeitet in der gleichen Reihenfolge wie der Canvas-Vertrag:
Event-Type, Dataset-Key, Felder, Quelle. Das Admin-Secret bleibt lokal im
Browser gespeichert; beim Speichern validiert der Server den Contract, committet
`server/event-catalog.json` und `release-version.js` als eine Einheit und pusht
nach GitHub. Es gibt kein Pinning alter Contract-Versionen: Runtime und
Frontend verwenden immer den aktuellen `release-N`-Stand.

Ein Ereignis von außen senden:

```bash
curl -X POST https://realtime.digitalisierungsplanung.de/emit \
  -H "authorization: Bearer $REALTIME_EMIT_SECRET" \
  -H "content-type: application/json" \
  -d '{"roomId":"demo","emitterId":"sip.threecx","name":"realtime.sip.call.incoming","detail":{"caller":"+491234","callee":"100","callId":"abc-123"}}'
```

Dazu passender Übergang im Werkzeug:

```text
triggerType: realtime
triggerEvent: realtime.sip.call.incoming
```

Der Browser-Ursprung ist produktiv auf `https://digitalisierungsplanung.de` begrenzt.

## Server-Veröffentlichung

Der Echtzeit-Server läuft auf dem Droplet lokal unter `127.0.0.1:8788`. Nginx veröffentlicht ihn unter `realtime.digitalisierungsplanung.de`.
`index.html`, `state.html`, Assets und `release-version.js` bleiben auf der Root-Domain `digitalisierungsplanung.de` und werden nicht vom Droplet ausgeliefert.

Wichtige Dateien:

- [`server/server.js`](server/server.js): Server
- [`server/ecosystem.config.cjs`](server/ecosystem.config.cjs): PM2-Prozess
- [`server/deploy.sh`](server/deploy.sh): Veröffentlichung auf dem Droplet
- [`server/auto-deploy.sh`](server/auto-deploy.sh): atomare automatische Aktualisierung
- [`server/nginx/realtime.digitalisierungsplanung.de.conf`](server/nginx/realtime.digitalisierungsplanung.de.conf): produktive Nginx-Datei
- [`server/nginx/realtime.digitalisierungsplanung.de.bootstrap.conf`](server/nginx/realtime.digitalisierungsplanung.de.bootstrap.conf): erste HTTP-Konfiguration für Zertifikate

Server deployen und automatische Aktualisierung installieren oder auffrischen:

```bash
cd /var/www/digitalisierungsplanung.de
git fetch --prune --force origin +refs/heads/main:refs/remotes/origin/main
git reset --hard origin/main
git clean -ffd
sudo bash server/deploy.sh
```

`deploy.sh` installiert oder aktualisiert den Systemd-Timer am Ende automatisch.
Danach prüft der Timer jede Minute `origin/main`. Er reagiert erst auf
eine nach vollständigem CI-Lauf hochgezählte `release-N`-ID, verwirft lokale
Änderungen im Server-Checkout, deployt exakt den freigegebenen Commit und prüft
PM2, Nginx sowie die gleiche ID in `/healthz`. Bei einem Fehlschlag wird der
Marker nicht weitergeschrieben; der Timer versucht denselben neuesten grünen
Release erneut. Nicht freigegebene `main`-Zwischenstände werden nicht deployed.

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

Der MCP-Workspace hat genau eine Form:
`state-blueprint.workspace` mit `schemaVersion: 1`. Formale `.state.json`-Dateien
werden über das Importwerkzeug eingelesen. Nackte Modelle, alte Feldnamen und
Aliasbefehle werden nicht migriert. Preview, Editor-Export und MCP-Export nutzen
dieselbe eingebettete Runtime.

Start:

```bash
STATE_BLUEPRINT_MODEL_PATH=./state-blueprint.workspace.json npm run mcp:state
```

Wichtige Werkzeuge:

- `state_blueprint_get_model`
- `state_blueprint_replace_model`
- `state_blueprint_apply_actions`
- `state_blueprint_apply_commands`
- `state_blueprint_plan_prompt`
- `state_blueprint_apply_prompt`
- `state_blueprint_validate`
- `state_blueprint_export_definition`
- `state_blueprint_export_html`
- `state_blueprint_import_definition`
- `state_blueprint_action_catalog`
- `state_blueprint_command_catalog`

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

`npm test` führt die Server-Tests und die wichtigsten Playwright-Abläufe aus. `npm run test:full` führt den vollständigen Bestand lokal aus. GitHub Actions verteilt dieselben Browserfälle vollständig auf vier parallele Shards, führt die Serverfälle einmal aus und erhöht nach jedem Gesamterfolg auf `main` die gemeinsame Release-Sequenz in `release-version.js`.

## Ordner

```text
.
|-- index.html
|-- state.html
|-- manifest.webmanifest
|-- disable-sw.js
|-- sw.js
|-- release-version.js
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
3. Nach grünem Lauf wird die gemeinsame `release-N`-ID in `release-version.js` inkrementiert.
4. GitHub Pages veröffentlicht die Root-Domain-Dateien.
5. Der Droplet-Timer erkennt die neue ID, synchronisiert den Remote-Stand mit Force und deployt/verifiziert nur `realtime.digitalisierungsplanung.de`.

Anspruch: ein schlanker Kern, ein Modell, ein Datenbus, eine ausführbare Oberfläche.
