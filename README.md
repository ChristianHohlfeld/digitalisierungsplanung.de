# Digitalisierungsplanung

Zustand ist ein eigenständiger visueller FSM-Builder für digitale Geschäftsprozesse. Das Werkzeug macht Abläufe sichtbar, prüfbar und als statische HTML-Anwendung exportierbar.

Das Repository ist bewusst schmal gehalten. Es enthält die Hauptanwendung, die erzeugte Laufzeitumgebung, die MCP/API-Schicht und die Tests, die den State-Machine-Kontrakt schützen.

## Screenshots

Diese Screenshots werden nach erfolgreichen Läufen aus der echten `state.html`-App erzeugt. Die README bleibt dadurch nah an der aktuellen Oberfläche.

Der Editor zeigt Prozessmodell, generierte App und globalen State-Kontrakt an einem Ort.

![Zustand Editor mit Business-Flow](assets/screenshots/zustand-editor-flow.png)

Die Vorschau ist dieselbe FSM als laufende App. Buttons und Widgets feuern echte Transitionen und schreiben über den globalen JSON-Bus.

![Generierte App-Vorschau mit Checkout-Flow](assets/screenshots/zustand-preview-checkout.png)

Der State-Inspector bearbeitet Trigger, Widgets, sichtbare Felder und gescopte Bus-Daten des ausgewählten States, ohne versteckten lokalen Zustand zu erzeugen.

![State-Inspector mit Widget- und Feldsteuerung](assets/screenshots/zustand-inspector-widgets.png)

## Kontrakt

Es gibt genau eine Quelle der Wahrheit:

```text
globaler JSON-State- und Event-Bus
```

Alles, was Daten oder Ablauf beeinflusst, muss im Modell beschrieben sein und über den offiziellen Laufzeitpfad aus diesem Bus lesen oder in diesen Bus schreiben.

Die vollständige schriftliche Kontrakt-Spezifikation steht in [`statereadme.md`](statereadme.md).

Erlaubter lokaler UI-Zustand:

- Ziehen, Hover, Fokus und Auswahl im Editor.
- Canvas-Pan und Canvas-Zoom.
- Handles für Animationen und Timer.
- Temporärer UI-Zustand des Editors.

Nicht erlaubt:

- Versteckte Komponenten-Stores.
- DOM-only-Entscheidungen für den Ablauf.
- HTML als Wahrheit einer Komponente.
- Preset-Caches, die wie Laufzeitdaten wirken.
- Schattenkopien von `state.current`, Transition-Ergebnissen, Widget-Werten oder Flow-Zustand.
- Legacy-Migrationen oder demo-spezifische Sonderpfade im Kernmodell.

## Repository

```text
.
|-- index.html
|-- state.html
|-- package.json
|-- playwright.config.js
|-- tests/
|-- mcp/
|-- docs/
|   `-- state-blueprint-api.md
|-- statereadme.md
|-- CNAME
|-- .github/workflows/deploy.yml
`-- .gitea/workflows/test.yml
```

## Anwendung

`state.html` enthält den visuellen Editor und die eingebettete Vorschau-Laufzeit.

Zentrale Aufgaben:

- Modell-Normalisierung und Validierung.
- Canvas-Rendering, SVG-Ports, Boundary-Proxies, Routing, Drag-and-drop, Pan und Zoom.
- State-Inspector und Render-Editor.
- Oberfläche für globalen State, Datenbaum und relevante Bus-Pfade.
- State-Daten, Datentypen, Data-Wires, Repeat-Mappings und Fetch-on-enter-Konfiguration.
- DaisyUI-Preset-Katalog und Preset-Instanziierung.
- Generierte App-Vorschau.
- Speichern, Laden, Export und Import.

Die Datei bleibt selbstständig, damit die Anwendung als statische App ausgeliefert werden kann.

## Laufzeit

Die generierte Vorschau-Laufzeit ist busgetrieben:

- Der Host sendet `STATE_BLUEPRINT_MODEL`.
- Die Laufzeit sendet `STATE_BLUEPRINT_RUNTIME_STATE`.
- Die Laufzeit bittet den Host mit `STATE_BLUEPRINT_OPEN_URL`, externe Links zu öffnen.

Laufzeitregeln:

- `defaultContext(model)` erzeugt Bus-Defaults wie `state.current`, `state.previous`, `state.lastTransition` und `runtime.paused`.
- `runtimeSet(...)` und `writeRuntimeState(...)` sind der Schreibpfad in den Bus.
- Entry-Effekte wie Fetch laufen beim Betreten eines States, nicht während des Renderns.
- Render liest Modell und Bus. Render erfindet keinen Modellzustand.

## MCP/API

Die MCP-Schicht ist die strukturierte API-Oberfläche für Automatisierung und externe Werkzeuge. Sie bearbeitet dasselbe kanonische JSON-Modell wie der visuelle Editor.

Zentrale Tools:

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

MCP-Server starten:

```bash
STATE_BLUEPRINT_MODEL_PATH=./state-blueprint.workspace.json npm run mcp:state
```

Die API wendet geordnete Modellaktionen an, normalisiert das Ergebnis, validiert den Kontrakt und persistiert nur das kanonische JSON-Modell. Sie klickt nicht die UI und hält keinen parallelen Laufzeit-Store.

Vollständige API-Dokumentation: [`docs/state-blueprint-api.md`](docs/state-blueprint-api.md)

## Tests

Die Tests sind Teil der Architektur.

- `core-contracts.spec.js` schützt Quellcode- und Browser-Kontrakte.
- `state-tool.spec.js` ist die breite App-Smoke-Suite für Canvas, Proxies, Nested States, Routing, Presets, Daisy-Verhalten, Touch-Gesten, Undo/Redo, Render-Reihenfolge, Save/Load und Vorschauverhalten.
- `nested-runtime-regressions.spec.js` schützt den generierten App-Flow durch Composite States.
- `state-blueprint-mcp.spec.js` schützt den MCP/API-Kontrakt.

Tests ausführen:

```bash
npm test
npm run test:contracts
npm run test:full
```

## Veröffentlichung

Der GitHub-Pages-Workflow führt die Smoke-Suite aus, bevor die statische App veröffentlicht wird.
