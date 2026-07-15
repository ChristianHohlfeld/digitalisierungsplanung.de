# Digitalisierungsplanung

Digitalisierungsplanung liefert in V1 einen abgegrenzten Unternehmensprozess
als bedienbare, testbare Web-Anwendung. Verkauft wird das messbare Ergebnis eines
betreuten Piloten – nicht der universelle Editor als Self-Service-Produkt.

Das interne Studio „Zustand“ macht Geschäftsprozesse sichtbar, prüfbar und
ausführbar. Zustände, Übergänge, Auslöser, Bedingungen, Daten und Darstellung
liegen in einem gemeinsamen JSON-Modell. Der wichtigste Gedanke bleibt: Nur
verstandene Prozesse lassen sich sauber digitalisieren.

![Vorschau](assets/share-card.png)

## Produktgrenze V1

- Ein Managed Pilot digitalisiert genau einen vereinbarten Prozess.
- Der öffentliche kommerzielle Rahmen beträgt einmalig **2.500–7.500 €** bei
  typischerweise **6–12 Wochen**; der verbindliche Festpreis folgt aus der
  Qualifizierung des Umfangs.
- Pilotnutzer arbeiten in der veröffentlichten Prozess-App.
- Das Studio, Composite-/Boundary-Interna, Realtime-Designer, Preset-Admin und
  MCP/API-Werkzeuge bleiben Operator- und Entwicklungswerkzeuge.
- Echtdaten werden erst nach geschlossenem Sicherheits-, Datenschutz-, Backup-
  und Betriebsgate verarbeitet.
- Erfolg wird gegen eine vorher erhobene Baseline gemessen; Demo und
  Funktionsmenge allein sind kein Abnahmenachweis.

Verbindlicher Umfang: [`docs/product/managed-pilot-v1.md`](docs/product/managed-pilot-v1.md).

Durchführung und Abnahme: [`docs/operations/pilot-runbook.md`](docs/operations/pilot-runbook.md).

Produktionsgate: [`docs/operations/production-readiness.md`](docs/operations/production-readiness.md).

## Einstieg für Entwicklung und Betrieb

Die technischen Studio-/Adminadressen sind nicht Teil des normalen
Kunden-Onboardings.

| Ziel | Adresse |
| --- | --- |
| Öffentliche Startseite | `https://digitalisierungsplanung.de/` |
| Operator-Studio (Anmeldung erforderlich) | `https://realtime.digitalisierungsplanung.de/studio.html` |
| Pilot-Onboarding/Login | `https://realtime.digitalisierungsplanung.de/pilot-admin.html` |
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

- [`index.html`](index.html): deterministisch erzeugte öffentliche Startseite; nicht von Hand ändern
- [`state.html`](state.html): internes Studio und kanonische Export-Runtime; kein öffentliches Pages-Artefakt
- [`docs/product/managed-pilot-v1.md`](docs/product/managed-pilot-v1.md): verkaufbarer V1-Umfang
- [`docs/operations/`](docs/operations): Release, Umgebungen, Pilot, Security, Backup, Support und Incidents
- [`docs/state-contract.md`](docs/state-contract.md): normativer Kernvertrag
- [`statereadme.md`](statereadme.md): Prinzipien, Architektur und Richtung
- [`docs/state-blueprint-api.md`](docs/state-blueprint-api.md): Programmierschnittstelle
- [`docs/state-blueprint-mcp.md`](docs/state-blueprint-mcp.md): MCP-Schnittstelle
- [`docs/realtime-api.md`](docs/realtime-api.md): Echtzeit-Schnittstelle
- [`docs/managed-pilot-api.md`](docs/managed-pilot-api.md): Anmeldung, Mandanten, Rollen, Projekte, Versionen und Backups

## Werkzeug

`state.html` enthält:

- Arbeitsfläche für Zustände und Übergänge
- Eigenschaften für Daten, Auslöser, Darstellung und Verbindungen
- App-Vorschau
- Vorlagen für häufige Oberflächenbausteine
- verschachtelte Zustände mit Eingang und Ausgang
- Datenladen beim Betreten eines Zustands
- Bild-URL oder lokaler Bild-Upload als direkt eingebettete Data-URI
- Speichern, Laden, Einlesen und Ausgeben
- Echtzeit-Ereignisse aus `/events`
- PWA-Dateien und statische HTML-Ausgabe

Die öffentliche Startseite ist ein exportierter Ablauf. Ihr kanonisches
Beispielmodell bleibt ausschließlich interne Buildquelle; die veröffentlichte
Runtime verlinkt weder Studio noch Demo-Editor.

Startseite neu erzeugen:

```bash
npm run build:index
npm run check:index
```

Der Build normalisiert den nichtfachlichen Exportzeitpunkt, markiert die Datei
als generiert und versieht ihren fachlichen Inhalt mit SHA-256. CI baut sie
separat erneut und vergleicht beide Dateien bytegenau.

PWA-Bilder neu erzeugen:

```bash
npm run build:pwa-assets
```

`release-version.js` wird nicht bei normalen Änderungen erhöht. Ausschließlich
der manuell gestartete, vollständig geprüfte Produktionsworkflow erzeugt die
nächste sequenzielle `release-N`-ID; `/version` und `/healthz` melden dieselbe
ID für den Backend-Prozess.

Die App registriert keinen Service Worker. `disable-sw.js` und der
`sw.js`-Tombstone melden noch vorhandene alte Worker ab und löschen ausschließlich
alte Cache-Storage-Bestände; es gibt keinen Fetch-Interceptor und keinen Cache.

## Echtzeit

Der Server in [`server/`](server/) hat zwei klar getrennte Aufgaben: Realtime ist
reiner Ereignistransport; die Managed-Pilot-API speichert Organisationen,
Benutzer, Rollen und versionierte Prozessmodelle. Sie erfindet kein zweites
FSM-Modell, sondern persistiert und versioniert den kanonischen JSON-Vertrag.
Der lokale JSON-Store ist eine V1-Implementierung und erst nach geschlossenem
Betriebs-, Backup- und Restore-Gate für Echtdaten freigegeben.

| Route | Zweck |
| --- | --- |
| `GET /` | zentraler Realtime Admin Hub |
| `GET /admin.html` | gleicher Admin Hub als explizite Route |
| `GET /admin/routes` | JSON-Index aller sichtbaren Realtime-Tools und Endpunkte |
| `GET /healthz` | Gesundheitsprüfung |
| `GET /readyz` | Readiness von Managed-Pilot-API und Speicher |
| `GET /version` | gemeinsame Frontend-/Backend-Release-ID |
| `/api/v1/*` | Managed-Pilot-API für Auth, Mandanten, Rollen, Projekte, Versionen, Audit und Backups |
| `GET /pilot-admin.html` | Provisioning-Onboarding; vor Produktion operatorseitig abzusichern |
| `GET /studio.html` | Studio-Einstieg; ohne nachgewiesene Zugriffssperre nicht produktionsreif |
| `GET /contract` | zentraler Product Contract: Trigger-Typen, Datentypen, Match-Operatoren, Datasets, Quellen, Preset-Typen, Presets, Preset-Pakete, Managed-Pilot-Angebot und State-Beiträge; `subscriptionPlans` bleibt als leeres Kompatibilitätsfeld erhalten |
| `GET /events` | kanonischer Realtime-Katalog mit Ereignissen, Emittern, Datentypen und State-Beiträgen |
| `GET /token` | signiertes Raum-Token für den Browser |
| `GET /console.html` | Testoberfläche für Ereignisse |
| `GET /events-admin.html` | einfacher Designer für Event-Type, Datensatz und Felder |
| `GET/POST /events-admin/catalog` | validieren und als Review-Branch für `server/event-catalog.json` bereitstellen |
| `GET /presets-admin.html` | Designer für offizielle DaisyUI-Snippets, Presets, Kategorien und Pakete |
| `GET/POST /presets-admin/catalog` | Preset-Library laden, validieren und als Review-Branch bereitstellen |
| `POST /presets-admin/parse` | DaisyUI-Markup ohne Persistenz in eine strukturierte Preset-Definition übersetzen |
| `POST /presets-admin/import` | kanonische Preset-Definition von einer öffentlichen HTTPS-API als Entwurf importieren |
| `POST /assets/inline-image` | öffentliches Bild ohne Persistenz als Data URI für einen eigenständigen HTML-Export laden |
| `POST /emit` | authentifiziertes Ereignis von außen |
| `WSS /ws` | WebSocket-Verbindung |

Der harte Contract kommt aus [`server/event-catalog.json`](server/event-catalog.json)
und wird vom Server unter `/contract` als Product Contract ausgeliefert:
Trigger-Typen, Value-Types mit Constraints, `matchOperators` samt strikter
Operandenform, `realtime.*`-Datasets, Quellen,
Preset-Typen und deren Varianten, Standard-Presets aus `server/preset-catalog.js`, verwaltete Presets und
Kategorien aus `server/preset-library.json`, Preset-Pakete, das aktive
Managed-Pilot-Angebot und kollisionsfreie State-Beiträge. Jedes Contract-Feld liefert neben `fieldTypes`
auch `fieldSchemas` mit `type`, `jsonType`, `default` und `constraints`
wie `min`, `max`, `maxLength`, `format`, `protocols`, `maxDepth` oder
`maxItems`. `/emit` und WebSocket-Runtime-Events prüfen dieselben Schemas,
bevor ein Event in den Raum darf. `/events` bleibt der schlanke Live-Katalog
für Realtime-Events. Der Canvas speichert keine Katalogkopie, sondern nur
konkrete Referenzen wie `triggerType: realtime` und `triggerEvent`.
Match-Felder sind im Event-Katalog explizit. Der Editor liest ihre erlaubten
Operator-IDs aus `matchFieldSchemas.<field>.operators`; er leitet weder Felder
aus `detail` noch Operatoren aus dem Datentyp ab.
`state.html` lädt `/contract` beim Start mit `no-store`. Im Managed-/Produktions-
modus darf der Editor bei einem reinen Verbindungs- oder Releasefehler höchstens
24 Stunden auf den letzten vollständig verifizierten Contract degradieren und
zeigt diesen Zustand sichtbar an. Ohne frischen verifizierten Cache, bei einem
inkompatiblen Core oder bei abgelaufener Cachefrist blockiert er. Lokale
Fallback-Typen, Preset-Varianten oder Preset-Definitionen werden nie erfunden.

Preset-Pakete gruppieren technische Fähigkeiten und Vorlagen. Sie sind weder
ein aktuelles Verkaufsangebot noch eine Berechtigung. Der Canvas speichert
keine Paketkopie; ein Preset schreibt weiter nur seinen eindeutigen
`stateContribution` in den globalen JSON-State. V1 veröffentlicht ausschließlich
`pilotOffers.managed-pilot-v1`; das aus Kompatibilitätsgründen vorhandene Feld
`subscriptionPlans` ist leer. Rechte entstehen ausschließlich aus der
authentifizierten Mandanten- und Rollenverwaltung, niemals aus Contract- oder
Paketmetadaten.

Im Editor liegen alle mitgelieferten Vorlagen zunächst gemeinsam unter
**Websuite Builder**. Der Preset Designer kann weitere Kategorien und Pakete
anlegen. Ein eingefügtes DaisyUI-v5.6.18-Beispiel wird serverseitig strukturell
geparst; gespeichert werden ausschließlich Variante und Defaultdaten, niemals
der HTML-Snippet. `Definition erzeugen` verändert den Contract noch nicht.
Alternativ lädt `Webhook/API-URL` eine exakte Preset-Definition als Entwurf.
URL und Rohantwort werden nicht gespeichert.
Erst `Review-Branch erstellen` validiert die gesamte Library, schreibt
`server/preset-library.json`, committet ausschließlich diese Quelldatei und
pusht einen eindeutigen `admin/presets-*`-Branch. `main`, die produktive
Release-ID und die Veröffentlichung bleiben bis Review, Merge und manuellem
Release unverändert.

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
fail-closed. Zulässige fachliche Trigger-Typen kommen ausschließlich aus
`/contract.triggerTypes`; aktuell öffentlich sind `button`, `change`,
`realtime`, `api`, `timer` und `auto`. Internes `flow` dient nur der
Child-Führung. Unbekannte Werte werden nicht als Alias akzeptiert oder
normalisiert. Server-getriebene Condition-Pfade unter `events.*`, `realtime.*`
und `emitters.*` müssen exakt im Product Contract deklariert sein.

Der Designer arbeitet in der gleichen Reihenfolge wie der Canvas-Vertrag:
Event-Type, Dataset-Key, Felder, Quelle. Das Admin-Secret bleibt lokal im
Browser gespeichert; beim Speichern validiert der Server den Contract, committet
`server/event-catalog.json` und pusht einen eindeutigen `admin/events-*`-Branch
zur Prüfung. Er schreibt weder `release-version.js` noch direkt nach `main`.
Erst ein geprüfter Merge und der manuelle Release veröffentlichen den Stand.
Es gibt kein Pinning alter Contract-Versionen: Runtime und Frontend verwenden
immer den aktuell veröffentlichten `release-N`-Stand.

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
GitHub Pages veröffentlicht auf `digitalisierungsplanung.de` ausschließlich die
allowlist-basierte Root-Runtime mit ihren Assets und `release-version.js`.
`state.html` ist kein Pages-Artefakt. Der Droplet stellt den internen
Studio-Einstieg ausschließlich als `/studio.html` bereit; ohne gültige
Pilot-Sitzung und editierbaren Projektkontext muss dieser zur Pilot-Konsole
zurückführen und darf keine Kundendaten laden.

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
npm run check
npm run test:server
npm run test:contracts
npm run test:full
npm run test:webkit
npm run test:ci
```

Gezielte Prüfgruppen:

```bash
npm run test:state-explorer
npm run test:state-render
```

`npm test` führt die Server-Tests und die wichtigsten Playwright-Abläufe aus.
`npm run check` prüft Betriebsverträge und den deterministischen Root-Export.
`npm run test:full` führt Server- und vollständige Chromium-Fälle aus;
`npm run test:webkit` ergänzt eine dedizierte WebKit-Produktsuite für den
öffentlichen Pilot-Funnel, Studio-Boot und konfliktgesichertes Managed-Save.
GitHub Actions verteilt die vollständigen Chromium-Fälle auf vier Shards und
sperrt einen Release, solange irgendein Repository-, Server-, Chromium- oder
WebKit-Gate fehlschlägt.

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
|-- CHANGELOG.md
|-- SECURITY.md
|-- CNAME
|-- assets/
|-- docs/
|-- mcp/
|-- scripts/
|-- server/
|-- tests/
|-- .github/workflows/ci.yml
|-- .github/workflows/deploy.yml
`-- .gitea/workflows/test.yml
```

## Veröffentlichung

1. PR beziehungsweise `main`-Push vollständig grün bekommen; dadurch wird noch
   nichts veröffentlicht und kein Release-Stamp erzeugt.
2. Denselben Quellstand in Staging fachlich und betrieblich freigeben.
3. GitHub Actions **Publish managed release** manuell mit exakt der nächsten
   Sequenz und einer kurzen Release-Note starten.
4. Der Workflow führt die vollständigen Gates erneut aus und verweigert einen
   veralteten oder nicht sequenziellen Release.
5. Erst danach entstehen `release-version.js`, unveränderlicher Tag und
   GitHub-Release. Eine explizite Allowlist wird als Pages-Artefakt veröffentlicht;
   der Droplet-Timer deployt und verifiziert die neue ID.
6. Die GitHub-Pages-Quelle muss in den Repository-Einstellungen auf **GitHub
   Actions** stehen; direkte Veröffentlichung aus `main` ist nicht zulässig.
7. Produktions-Smoke und Beobachtungsfenster protokollieren.

Das vollständige Verfahren samt Hotfix und Rollback steht in
[`docs/operations/release-policy.md`](docs/operations/release-policy.md).

Anspruch: ein schlanker Kern, ein Modell, ein Datenbus, eine ausführbare Oberfläche.
