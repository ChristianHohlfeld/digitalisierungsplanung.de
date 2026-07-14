# Zustand MCP

Zustand stellt einen lokalen MCP-Server bereit, damit externe Werkzeuge
dasselbe kanonische Modell bearbeiten können wie der visuelle Editor.

Der Server spricht JSON-RPC über stdio. Er klickt keine UI, hält keinen zweiten
Runtime-Speicher und schreibt erst nach Normalisierung und Vertragsvalidierung.

Die vollständige API-Referenz mit Modellaktionen, Editorbefehlen, Beispielen und
UI-zu-API-Zuordnung steht in [`state-blueprint-api.md`](./state-blueprint-api.md).

## Start

```bash
STATE_BLUEPRINT_MODEL_PATH=./state-blueprint.workspace.json npm run mcp:state
```

Ohne `STATE_BLUEPRINT_MODEL_PATH` nutzt der Server
`./state-blueprint.workspace.json`.

Persistiert wird ausschließlich `state-blueprint.workspace` in
`schemaVersion: 1`. Nackte Modelle und formale Definitionen sind keine
Workspace-Dateien; Definitionen werden nur mit
`state_blueprint_import_definition` importiert. Namen und Felder der
öffentlichen Werkzeuge, Aktionen und Befehle sind exakt und besitzen keine
Kompatibilitätsaliasse.

## Werkzeuge

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

`state_blueprint_apply_actions` ist die niedrige Modell-API. Sie führt
kanonische Modelloperationen aus, sortiert Abhängigkeiten und validiert danach.

`state_blueprint_apply_commands` ist die vollständige Editor-API. Sie kann alles
ausführen, was ein Nutzer als App-Befehl auslöst: Zustände, Übergänge, Variablen,
Bausteine, Datenverbindungen, Boundary, Auswahl, Ebenen-Navigation, Ansicht, Kopieren/Einfügen,
Gruppieren/Auflösen und Undo/Redo. Auch diese Befehle laufen über das Modell und
nicht über DOM-Klicks.

## Vertragsregeln

- eine Wahrheit bleibt der globale JSON-Zustands-/Ereignisbus.
- Das persistierte Modell beschreibt Zustände, Übergänge, Render-Komponenten,
  Datenverbindungen, Boundary und Editor-Session.
- Runtime-Daten werden nicht in Komponenten, HTML oder lokalen Stores versteckt.
- UI-Aktionen feuern nur explizit gebundene Übergänge oder Bus-Ereignisse.
- Jede explizite UI-Aktionsbindung besitzt eine vorhandene ausgehende
  Transition-ID. Mehrere Controls dürfen dieselbe Transition auslösen, ohne
  einen weiteren Trigger zu erzeugen. Nur ein `button`-Trigger rendert dafür ein
  Control; andere Trigger erzeugen keinen Ersatzbutton und keine lokale
  Fallback-Aktion.
- Ein Aktionsslot besitzt entweder eine Transition-ID oder eine URL. Beides im
  selben Slot ist ein Contract-Fehler.
- Trigger bleiben an Transitionen. Pro effektiver Quelle darf jede konkrete
  Triggeridentität nur einmal vorkommen; ein Timer ist einmal zulässig und
  `auto` ist exklusiv. MCP-Aktionen mit einem Konflikt werden nicht angewendet.
- `transition.set` ist Wirkung nach einem Ereignis, nicht die Quelle einer
  Schaltflächen-Bindung.
- Realtime-Übergänge speichern `triggerType: "realtime"` plus konkrete
  `realtime.*`-Ereignisse; Ereigniskataloge werden nicht ins Modell kopiert.
- Preset-Kategorien, Paketmetadaten und Preset-Definitionen bleiben im
  serverseitigen Product Contract; MCP persistiert sie ebenso wenig im Modell
  wie der Editor.
- Verschachtelter Ablauf läuft über Boundary-Eingang/-Ausgang und Proxy-Übergänge.
- Exportierte Definitionen enthalten keine Undo-Historie und keinen
  Editor-Zwischenablage.
- Lokale `state.data`-Pfade deklarieren Defaults; Runtime-Referenzen sind immer
  vollqualifizierte `states.<id>.*`-Buspfade.
- Preview, Editor-HTML-Export und MCP-HTML-Export verwenden dieselbe kanonische
  Runtime-Quelle.

## MCP-Ressourcen

- `state-blueprint://model`
- `state-blueprint://contract`
- `state-blueprint://actions`
- `state-blueprint://commands`
- `state-blueprint://prompt-intents`

## Beispiel: Modellaktionen

```json
{
  "actions": [
    { "type": "create_flow", "name": "Newsletter" },
    { "type": "upsert_state", "id": "formular", "title": "Formular", "x": 96, "y": 120 },
    { "type": "upsert_state_variable", "stateId": "formular", "path": "email", "valueType": "email", "value": "" },
    { "type": "upsert_state", "id": "fertig", "title": "Fertig", "x": 360, "y": 120 },
    { "type": "upsert_transition", "id": "formular_fertig", "from": "formular", "to": "fertig", "label": "Absenden", "condition": "states.formular.email" },
    { "type": "set_initial", "stateId": "formular" }
  ]
}
```

## Beispiel: Editorbefehle

```json
{
  "commands": [
    { "command": "scene.new", "title": "Auftragsprozess" },
    { "command": "state.create", "id": "start", "title": "Start", "x": 96, "y": 120 },
    { "command": "state.create", "id": "fertig", "title": "Fertig", "x": 456, "y": 120 },
    { "command": "transition.create", "id": "start_fertig", "from": "start", "to": "fertig", "label": "Weiter" },
    { "command": "graph.insert_state_on_transition", "transitionId": "start_fertig", "stateId": "prüfen", "title": "Prüfen" },
    { "command": "viewport.fit", "viewportWidth": 1200, "viewportHeight": 800 }
  ]
}
```
