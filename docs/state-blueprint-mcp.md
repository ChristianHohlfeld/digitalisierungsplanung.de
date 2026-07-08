# State Blueprint MCP

State Blueprint exposes a local MCP server so external tools can edit the same canonical model a human edits in the app.

The server is standard JSON-RPC over stdio and uses newline-delimited MCP messages. It does not click the UI and it does not keep a second runtime store. Every tool reads or writes the State Blueprint JSON model, normalizes it, validates the contract, and only then persists it.

For the complete API reference, action schemas, UI-to-API mapping, and end-to-end examples, see [`state-blueprint-api.md`](./state-blueprint-api.md).

## Run

```bash
STATE_BLUEPRINT_MODEL_PATH=./state-blueprint.workspace.json npm run mcp:state
```

If `STATE_BLUEPRINT_MODEL_PATH` is omitted, the server uses `./state-blueprint.workspace.json`.

## Tools

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

`state_blueprint_apply_actions` is the main tool. It applies actions in contract dependency order, then normalizes and validates the model before writing. This lets generated plans provide mixed action lists while still creating states before transitions that reference them:

- `create_flow`
- `set_model_name`
- `replace_model`
- `upsert_state`
- `delete_state`
- `upsert_editor_group`
- `delete_editor_group`
- `move_state`
- `set_initial`
- `upsert_transition`
- `delete_transition`
- `upsert_state_variable`
- `delete_state_variable`
- `configure_fetch`
- `configure_repeat`
- `upsert_data_wire`
- `remove_data_wire`
- `add_component`
- `update_component`
- `remove_component`
- `reorder_components`
- `set_boundary`

`state_blueprint_plan_prompt` turns common German/English edit requests into the same ordered actions without writing first. `state_blueprint_apply_prompt` applies that plan.

Examples it understands:

- `fuege timer 10s hinzu und weiter zu Done`
- `erstelle inner state Schritt 1`
- `verbinde diesen State mit Checkout`
- `fuege Card Preset hinzu`
- `fuege Variable email vom Typ email hinzu`
- `lade API https://example.test/items als Liste`

For ambiguous text, inspect `plan.assumptions` and then call `state_blueprint_apply_actions` manually.

## Contract

- Single source of truth stays the global state/event bus.
- State variables are `state.data` plus `state.dataTypes`; they are defaults and shape declarations, not local runtime state.
- Visible data uses `dataWires` and structured components.
- Transitions own triggers, conditions, timers, and `set` patches.
- Fetch is configured as a state-entry effect into an explicit bus path; generated plans default to `states.<stateId>.fetch`.
- Repeat renders an explicit bus list path.
- Nested flows use boundary input/output references and proxy transitions.
- Components must not smuggle flow or data decisions through local stores or HTML blobs.

## MCP Resources

- `state-blueprint://model`
- `state-blueprint://contract`
- `state-blueprint://actions`
- `state-blueprint://prompt-intents`

## Example

```json
{
  "actions": [
    { "type": "create_flow", "name": "Newsletter signup" },
    { "type": "upsert_state", "id": "form", "title": "Signup form", "x": 96, "y": 120 },
    { "type": "upsert_state_variable", "stateId": "form", "path": "email", "valueType": "email", "value": "" },
    { "type": "upsert_data_wire", "stateId": "form", "id": "wire_email", "sourcePath": "email", "role": "field", "componentType": "text", "label": "Email" },
    { "type": "add_component", "stateId": "form", "component": { "id": "email_row", "type": "dataWire", "wireId": "wire_email" } },
    { "type": "upsert_state", "id": "done", "title": "Done", "x": 360, "y": 120 },
    { "type": "upsert_transition", "id": "submit", "from": "form", "to": "done", "label": "Submit", "condition": "email", "set": { "submitted": true } },
    { "type": "set_initial", "stateId": "form" }
  ]
}
```

## Chat Example

```json
{
  "prompt": "fuege timer 10s hinzu und weiter zu Done",
  "selectedStateId": "form"
}
```

The plan creates a countdown component bound to `states.form.timer`, declares the typed state variable, creates `Done` if needed, and adds a `change.states.form.timer.finished` transition.
