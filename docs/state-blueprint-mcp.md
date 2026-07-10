# State Blueprint MCP

State Blueprint stellt einen lokalen MCP-Server bereit, damit externe Tools
dasselbe kanonische Modell bearbeiten koennen wie der visuelle Editor.

Der Server spricht JSON-RPC ueber stdio. Er klickt keine UI, haelt keinen zweiten
Runtime-Store und schreibt erst nach Normalisierung und Vertragsvalidierung.

Die vollstaendige API-Referenz mit Actions, Commands, Beispielen und
UI-zu-API-Zuordnung steht in [`state-blueprint-api.md`](./state-blueprint-api.md).

## Start

```bash
STATE_BLUEPRINT_MODEL_PATH=./state-blueprint.workspace.json npm run mcp:state
```

Ohne `STATE_BLUEPRINT_MODEL_PATH` nutzt der Server
`./state-blueprint.workspace.json`.

## Tools

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

`state_blueprint_apply_actions` ist die niedrige Modell-API. Sie fuehrt
kanonische Modelloperationen aus, sortiert Abhaengigkeiten und validiert danach.

`state_blueprint_apply_commands` ist die vollstaendige Editor-API. Sie kann alles
ausfuehren, was ein User als App-Befehl ausloest: States, Transitions, Variablen,
Widgets, Data-Wires, Boundary, Auswahl, Layer-Navigation, Viewport, Copy/Paste,
Collapse/Degroup und Undo/Redo. Auch diese Commands laufen ueber das Modell und
nicht ueber DOM-Klicks.

## Vertragsregeln

- Single Source of Truth bleibt der globale JSON-State/Event-Bus.
- Das persistierte Modell beschreibt States, Transitions, Render-Komponenten,
  Data-Wires, Boundary und Editor-Session.
- Runtime-Daten werden nicht in Komponenten, HTML oder lokalen Stores versteckt.
- UI-Aktionen feuern nur explizit gebundene Transitionen oder Bus-Events.
- `transition.set` ist Wirkung nach einem Event, nicht die Quelle einer
  Button-Bindung.
- Realtime-Transitions speichern `triggerType: "realtime"` plus konkrete
  `realtime.*`-Events; Event-Kataloge werden nicht ins Modell kopiert.
- Nested Flow laeuft ueber Boundary-Input/Output und Proxy-Transitions.
- Exportierte Definitionen enthalten keine Undo-Historie und keinen
  Editor-Clipboard-Zustand.

## MCP-Ressourcen

- `state-blueprint://model`
- `state-blueprint://contract`
- `state-blueprint://actions`
- `state-blueprint://commands`
- `state-blueprint://prompt-intents`

## Beispiel: Modell-Actions

```json
{
  "actions": [
    { "type": "create_flow", "name": "Newsletter" },
    { "type": "upsert_state", "id": "formular", "title": "Formular", "x": 96, "y": 120 },
    { "type": "upsert_state_variable", "stateId": "formular", "path": "email", "valueType": "email", "value": "" },
    { "type": "upsert_state", "id": "fertig", "title": "Fertig", "x": 360, "y": 120 },
    { "type": "upsert_transition", "id": "formular_fertig", "from": "formular", "to": "fertig", "label": "Absenden", "condition": "email" },
    { "type": "set_initial", "stateId": "formular" }
  ]
}
```

## Beispiel: Editor-Commands

```json
{
  "commands": [
    { "command": "scene.new", "title": "Auftragsprozess" },
    { "command": "state.create", "id": "start", "title": "Start", "x": 96, "y": 120 },
    { "command": "state.create", "id": "fertig", "title": "Fertig", "x": 456, "y": 120 },
    { "command": "transition.create", "id": "start_fertig", "from": "start", "to": "fertig", "label": "Weiter" },
    { "command": "graph.insert_state_on_transition", "transitionId": "start_fertig", "stateId": "pruefen", "title": "Pruefen" },
    { "command": "viewport.fit", "viewportWidth": 1200, "viewportHeight": 800 }
  ]
}
```
