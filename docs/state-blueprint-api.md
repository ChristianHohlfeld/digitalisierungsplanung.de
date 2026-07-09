# Zustand API Reference

This document is the automation contract for Zustand / Digitalisierungsplanung.
The API edits the same canonical JSON model that the visual editor edits. It does
not click the UI, does not keep a second store, and does not create hidden runtime
state.

## Core Rule

There is one truth:

```text
State Blueprint JSON model -> global JSON state/event bus -> FSM runtime
```

API calls may change the model. Runtime values are produced by the generated app
through the bus. Components are only views and event surfaces over that bus.

## Run The MCP Server

```bash
STATE_BLUEPRINT_MODEL_PATH=./state-blueprint.workspace.json npm run mcp:state
```

If `STATE_BLUEPRINT_MODEL_PATH` is omitted, the server reads and writes
`./state-blueprint.workspace.json`.

The server speaks MCP JSON-RPC over stdio. Every response returns JSON text in
`content[0].text` and the same value in `structuredContent`.

Minimal JSON-RPC call:

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"state_blueprint_validate","arguments":{}}}
```

## Tools

| Tool | Purpose |
| --- | --- |
| `state_blueprint_get_model` | Read the current canonical workspace model. |
| `state_blueprint_replace_model` | Replace the whole model after normalization and validation. |
| `state_blueprint_apply_actions` | Apply ordered editor/model actions atomically. This is the main write API. |
| `state_blueprint_plan_prompt` | Convert a supported natural-language edit into actions without writing. |
| `state_blueprint_apply_prompt` | Convert a supported natural-language edit into actions and apply it. |
| `state_blueprint_validate` | Validate the current model against the FSM/bus contract. |
| `state_blueprint_export_definition` | Return the formal `.state.json` definition payload. |
| `state_blueprint_import_definition` | Import a formal `.state.json` definition payload. |
| `state_blueprint_export_html` | Build the standalone generated app HTML, optionally writing it to disk. |
| `state_blueprint_action_catalog` | Return supported action names and prompt examples. |

## Main Write Interface

Use `state_blueprint_apply_actions` for everything that should mirror an editor
model edit.

```json
{
  "actions": [
    { "type": "upsert_state", "id": "start", "title": "Start" },
    { "type": "upsert_state", "id": "done", "title": "Done", "x": 360, "y": 120 },
    { "type": "upsert_transition", "id": "start_to_done", "from": "start", "to": "done", "label": "Continue" }
  ],
  "dryRun": false,
  "allowInvalid": false
}
```

Actions are sorted in dependency order before they are applied, so states are
created before transitions that reference them. The result is normalized and
validated before it is written.

## Action Reference

### `create_flow`

Clear the model and start fresh.

Fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | no | Flow name. Defaults to `State App`. |

Example:

```json
{ "type": "create_flow", "name": "Checkout Flow" }
```

### `set_model_name`

Rename the flow without changing states or transitions.

```json
{ "type": "set_model_name", "name": "Order intake" }
```

### `replace_model`

Replace the whole canonical model. Use for complete imports or generated model
rewrites. The model is normalized and validated.

```json
{
  "type": "replace_model",
  "model": {
    "version": 2,
    "name": "Tiny Flow",
    "initial": "start",
    "boundary": { "entryId": "start", "exitId": "start", "entryDisabled": false, "exitDisabled": false },
    "states": [{ "id": "start", "title": "Start", "x": 120, "y": 120, "components": [] }],
    "transitions": []
  }
}
```

### `upsert_state` / `add_state`

Create or update one state.

Fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | no | Stable state identity. Generated from title if omitted. |
| `title` | string | no | Human label. |
| `parentId` | string | no | Put state inside a parent layer. Omit or empty for root. |
| `x`, `y` | number | no | Canvas world coordinates, snapped to grid. |
| `renderMode` | `state` or `component` | no | Normal state screen or component-like state. |
| `components` | array | no | Structured render rows. No `html`, `localState`, or hidden store fields. |
| `data` | object | no | State-scoped defaults/shape for the global bus. |
| `dataTypes` | object | no | Type declarations for paths present in `data`. |
| `dataSource` | object | no | Fetch-on-enter configuration. |
| `repeat` | object | no | List/repeat configuration. |
| `dataWires` | array | no | Data-to-render mappings. |
| `subscriptions` | array | no | Bus paths this state cares about. |
| `boundary` | object | no | Child-layer entry/exit metadata. |

Example: create a state with a text component.

```json
{
  "type": "upsert_state",
  "id": "cart",
  "title": "Cart",
  "x": 96,
  "y": 120,
  "components": [
    { "id": "cart_intro", "type": "text", "text": "Review your order.", "url": "" }
  ]
}
```

Example: create a child state.

```json
{
  "type": "upsert_state",
  "id": "address_form",
  "title": "Address form",
  "parentId": "checkout",
  "x": 120,
  "y": 120
}
```

### `move_state`

Move a state on the canvas.

```json
{ "type": "move_state", "stateId": "cart", "x": 240, "y": 192 }
```

### `delete_state`

Delete a state. Descendants and connected transitions are removed by default.

```json
{ "type": "delete_state", "id": "cart" }
```

To delete only the state itself:

```json
{ "type": "delete_state", "id": "cart", "deleteDescendants": false }
```

### `set_initial`

Set the initial runtime state.

```json
{ "type": "set_initial", "stateId": "cart" }
```

### `upsert_transition` / `add_transition`

Create or update one explicit FSM transition. Endpoints must be existing states
in the same layer. Cross-layer flow must use boundary input/output references.

Fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | no | Stable transition identity. |
| `from` | state id | yes | Source state. |
| `to` | state id | yes | Target state. |
| `label` | string | no | Button/edge label. |
| `triggerType` | `button`, `change`, `event`, `realtime`, `timer`, `auto` | no | Defaults to `button`. |
| `triggerEvent` | string | no | Explicit event name. Generated for button/timer/auto if omitted. Realtime transitions keep a concrete `realtime.*` event ref. |
| `timerMs` | number | no | Used by timer transitions. |
| `condition` | string | no | Guard expression over bus paths. |
| `set` | object | no | Patch written to the global bus on transition. |
| `groupEntryId`, `groupExitId` | state id | no | Editor group projection hints, not runtime state. |

Button transition:

```json
{
  "type": "upsert_transition",
  "id": "cart_to_shipping",
  "from": "cart",
  "to": "shipping",
  "label": "Checkout",
  "triggerType": "button",
  "set": { "checkoutStarted": true }
}
```

Timer transition:

```json
{
  "type": "upsert_transition",
  "id": "loading_to_done",
  "from": "loading",
  "to": "done",
  "label": "Loaded",
  "triggerType": "timer",
  "timerMs": 2000,
  "set": { "loaded": true }
}
```

Bus-change transition:

```json
{
  "type": "upsert_transition",
  "id": "valid_to_next",
  "from": "form",
  "to": "summary",
  "label": "Continue",
  "triggerType": "change",
  "triggerEvent": "change.states.form.accepted",
  "condition": "accepted == true"
}
```

Short state-scoped paths such as `accepted` are normalized to
`states.<source-state-id>.accepted`.

Realtime transition:

```json
{
  "type": "upsert_transition",
  "id": "call_to_live",
  "from": "waiting",
  "to": "live_call",
  "label": "Incoming call",
  "triggerType": "realtime",
  "triggerEvent": "realtime.sip.call.incoming",
  "condition": "events.realtime.sip.call.incoming.count > 0"
}
```

Realtime event definitions stay on the Realtime API (`/events`). The model stores
no `model.realtime` contract copy.

### `delete_transition`

Delete one transition. Any render placeholder button for that transition is also
removed.

```json
{ "type": "delete_transition", "transitionId": "cart_to_shipping" }
```

### `upsert_state_variable`

Declare or update a state-scoped variable in the global bus tree.

Important: the API always scopes unqualified paths under `states.<stateId>`.
That prevents collisions between states.

```json
{
  "type": "upsert_state_variable",
  "stateId": "form",
  "path": "email",
  "valueType": "email",
  "value": ""
}
```

Stored result:

```json
{
  "data": { "states.form": { "email": "" } },
  "dataTypes": { "states.form.email": "email" }
}
```

Allowed `valueType`: `text`, `email`, `password`, `number`, `boolean`, `url`,
`image`, `object`, `list`.

### `delete_state_variable`

Remove one declared bus path from a state. Matching data-wire rows are removed.

```json
{ "type": "delete_state_variable", "stateId": "form", "path": "email" }
```

### `configure_fetch`

Configure state-entry fetch. Fetch is an entry effect of the active state, never
a render side effect.

Fields:

| Field | Type | Notes |
| --- | --- | --- |
| `stateId` | string | Required. |
| `url` | string | Endpoint URL. |
| `target` | bus path | Defaults to `states.<stateId>.fetch`. |
| `select` | path | Optional response path selector. |
| `timeoutMs` | number | Clamped between 1000 and 30000. |
| `retries` | number | Clamped between 0 and 5. |

```json
{
  "type": "configure_fetch",
  "stateId": "products",
  "url": "https://api.example.test/products",
  "target": "states.products.fetch",
  "select": "",
  "timeoutMs": 8000,
  "retries": 2
}
```

### `configure_repeat`

Render a list from an explicit bus path.

```json
{
  "type": "configure_repeat",
  "stateId": "products",
  "path": "states.products.fetch.data",
  "as": "item",
  "index": "i",
  "manual": true
}
```

### `upsert_data_wire`

Map a bus path into visible render content.

Fields:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Stable wire id. |
| `stateId` | string | Owner state. |
| `sourcePath` / `path` | bus path | Value to read. |
| `scopePath` | bus path | Optional repeat collection path. |
| `itemPath` | path | Optional path inside each repeated item. |
| `role` | string | `image`, `title`, `price`, `description`, `field`, `link`, `note`. |
| `componentType` | string | `heading`, `text`, `image`, `link`, `note`. |
| `label` | string | User-facing label. |

Example: render product titles from a repeated list.

```json
{
  "type": "upsert_data_wire",
  "stateId": "products",
  "id": "wire_product_title",
  "sourcePath": "states.products.fetch.data.title",
  "scopePath": "states.products.fetch.data",
  "itemPath": "title",
  "role": "title",
  "componentType": "heading",
  "label": "Title"
}
```

### `remove_data_wire`

Remove one data-to-render mapping.

```json
{ "type": "remove_data_wire", "stateId": "products", "wireId": "wire_product_title" }
```

### `add_component`

Append or insert one structured render component.

Allowed component `type`: `heading`, `text`, `image`, `list`, `link`, `note`,
`divider`, `daisy`, `transitionButton`, `dataWire`.

No component may carry `html`, `localState`, `stateStore`, or `store`. If a
component needs data, bind it through `dataPath` or `wireId`.

Text component:

```json
{
  "type": "add_component",
  "stateId": "cart",
  "index": 0,
  "component": { "id": "cart_copy", "type": "text", "text": "Review your order.", "url": "" }
}
```

Daisy widget:

```json
{
  "type": "add_component",
  "stateId": "cart",
  "component": {
    "id": "cart_card",
    "type": "daisy",
    "variant": "card",
    "dataPath": "states.cart.card",
    "dataRole": "widget",
    "dataLabel": "Cart card"
  }
}
```

Placed transition button:

```json
{
  "type": "add_component",
  "stateId": "cart",
  "component": { "id": "slot_checkout", "type": "transitionButton", "transitionId": "cart_to_shipping" }
}
```

Data-wire render row:

```json
{
  "type": "add_component",
  "stateId": "products",
  "component": { "id": "product_title_row", "type": "dataWire", "wireId": "wire_product_title" }
}
```

### `update_component`

Patch one component.

```json
{
  "type": "update_component",
  "stateId": "cart",
  "componentId": "cart_copy",
  "patch": { "text": "Check items and quantities." }
}
```

### `remove_component`

Remove one render component. This does not delete state variables unless you also
call `delete_state_variable`.

```json
{ "type": "remove_component", "stateId": "cart", "componentId": "cart_copy" }
```

### `reorder_components`

Set render order for visible rows. Omitted component ids keep their relative
order after the listed ids.

```json
{
  "type": "reorder_components",
  "stateId": "cart",
  "componentIds": ["slot_checkout", "cart_copy", "cart_card"]
}
```

### `set_boundary`

Set root or nested layer input/output references. This creates or updates the
matching proxy transitions.

Root boundary:

```json
{
  "type": "set_boundary",
  "entryId": "home",
  "exitId": "thanks",
  "title": "Website flow",
  "note": "Main public funnel"
}
```

Nested boundary:

```json
{
  "type": "set_boundary",
  "parentId": "checkout",
  "entryId": "address_form",
  "exitId": "review"
}
```

Contract rule: child states do not jump back to the parent by magic. A child can
only leave through an explicit boundary output and whatever real parent-layer
transition is connected after that.

### `upsert_editor_group` / `group_states`

Group states in the editor canvas without changing runtime flow.

```json
{
  "type": "upsert_editor_group",
  "id": "checkout_group",
  "title": "Checkout",
  "stateIds": ["cart", "shipping", "payment"],
  "layerId": ""
}
```

Rules:

- Groups live in `model.editorGroups`.
- They do not create states.
- They do not create transitions.
- They do not render in the generated app.
- Grouped and ungrouped models must run identically.

### `delete_editor_group` / `degroup_states`

Remove editor grouping only.

```json
{ "type": "delete_editor_group", "id": "checkout_group" }
```

## Complete Workflows

### Create Two States And Wire Them

```json
{
  "actions": [
    { "type": "create_flow", "name": "Simple flow" },
    { "type": "upsert_state", "id": "start", "title": "Start", "x": 96, "y": 120 },
    { "type": "upsert_state", "id": "done", "title": "Done", "x": 384, "y": 120 },
    { "type": "upsert_transition", "id": "start_to_done", "from": "start", "to": "done", "label": "Continue" },
    { "type": "set_initial", "stateId": "start" }
  ]
}
```

### Insert A State Between Two States

```json
{
  "actions": [
    { "type": "delete_transition", "id": "a_to_c" },
    { "type": "upsert_state", "id": "b", "title": "Review", "x": 360, "y": 120 },
    { "type": "upsert_transition", "id": "a_to_b", "from": "a", "to": "b", "label": "Review" },
    { "type": "upsert_transition", "id": "b_to_c", "from": "b", "to": "c", "label": "Continue" }
  ]
}
```

### Add A Functional Daisy Button/Card State

```json
{
  "actions": [
    {
      "type": "upsert_state_variable",
      "stateId": "product",
      "path": "card",
      "valueType": "object",
      "value": {
        "title": "Business process map",
        "body": "Understand the process before digitizing it.",
        "actionLabel": "Open"
      }
    },
    {
      "type": "add_component",
      "stateId": "product",
      "component": {
        "id": "product_card",
        "type": "daisy",
        "variant": "card",
        "dataPath": "states.product.card",
        "dataRole": "widget",
        "dataLabel": "Product card"
      }
    },
    { "type": "upsert_state", "id": "details", "title": "Details", "x": 384, "y": 120 },
    { "type": "upsert_transition", "id": "product_to_details", "from": "product", "to": "details", "label": "Open" }
  ]
}
```

### Fetch JSON And Render A List

```json
{
  "actions": [
    { "type": "upsert_state", "id": "products", "title": "Products", "x": 96, "y": 120 },
    {
      "type": "configure_fetch",
      "stateId": "products",
      "url": "https://api.example.test/products",
      "target": "states.products.fetch"
    },
    { "type": "configure_repeat", "stateId": "products", "path": "states.products.fetch.data", "as": "item", "index": "i", "manual": true },
    {
      "type": "upsert_data_wire",
      "stateId": "products",
      "id": "wire_title",
      "sourcePath": "states.products.fetch.data.title",
      "scopePath": "states.products.fetch.data",
      "itemPath": "title",
      "role": "title",
      "componentType": "heading",
      "label": "Title"
    },
    { "type": "add_component", "stateId": "products", "component": { "id": "title_row", "type": "dataWire", "wireId": "wire_title" } }
  ]
}
```

### Create A Nested Flow With Parent Out

```json
{
  "actions": [
    { "type": "upsert_state", "id": "checkout", "title": "Checkout", "x": 96, "y": 120 },
    { "type": "upsert_state", "id": "address", "title": "Address", "parentId": "checkout", "x": 120, "y": 120 },
    { "type": "upsert_state", "id": "review", "title": "Review", "parentId": "checkout", "x": 408, "y": 120 },
    { "type": "set_boundary", "parentId": "checkout", "entryId": "address", "exitId": "review" },
    { "type": "upsert_transition", "id": "address_to_review", "from": "address", "to": "review", "label": "Review" },
    { "type": "upsert_state", "id": "thanks", "title": "Thanks", "x": 384, "y": 120 },
    { "type": "upsert_transition", "id": "checkout_to_thanks", "from": "checkout", "to": "thanks", "label": "Finish" }
  ]
}
```

The child exits through the parent's boundary output. If the parent has no real
outgoing transition after that, the machine stops.

### Loading State That Continues After Two Seconds

```json
{
  "actions": [
    {
      "type": "upsert_state_variable",
      "stateId": "loading",
      "path": "loading",
      "valueType": "object",
      "value": { "label": "Loading..." }
    },
    {
      "type": "add_component",
      "stateId": "loading",
      "component": {
        "id": "loading_widget",
        "type": "daisy",
        "variant": "loading",
        "dataPath": "states.loading.loading",
        "dataRole": "widget",
        "dataLabel": "Loading"
      }
    },
    {
      "type": "upsert_transition",
      "id": "loading_to_done",
      "from": "loading",
      "to": "done",
      "label": "Loaded",
      "triggerType": "timer",
      "timerMs": 2000
    }
  ]
}
```

Timer transitions are not rendered as buttons.

## Import, Export, Save, Load

### Save / Read Current Workspace

```json
{"name":"state_blueprint_get_model","arguments":{"includeValidation":true}}
```

### Load / Replace Current Workspace

```json
{"name":"state_blueprint_replace_model","arguments":{"model":{"version":2,"name":"Imported","states":[],"transitions":[]}}}
```

### Export `.state.json`

```json
{"name":"state_blueprint_export_definition","arguments":{}}
```

### Import `.state.json`

```json
{"name":"state_blueprint_import_definition","arguments":{"definition":{"kind":"state-blueprint.definition","schemaVersion":2,"model":{"version":2,"name":"Imported","states":[],"transitions":[]},"stateTemplates":[]}}}
```

### Export Standalone HTML

Return HTML in the response:

```json
{"name":"state_blueprint_export_html","arguments":{}}
```

Write HTML to a file:

```json
{
  "name": "state_blueprint_export_html",
  "arguments": {
    "outputPath": "./dist/zustand-app.html",
    "includeHtml": false
  }
}
```

The exported HTML embeds `EXPORTED_STATE_BLUEPRINT` and runs without the editor.

## Natural-Language API

Use this only as a convenience layer over the action API.

Plan without writing:

```json
{
  "name": "state_blueprint_plan_prompt",
  "arguments": {
    "prompt": "fuege timer 10s hinzu und weiter zu Done",
    "selectedStateId": "start"
  }
}
```

Apply immediately:

```json
{
  "name": "state_blueprint_apply_prompt",
  "arguments": {
    "prompt": "Cart -> Shipping -> Payment -> Done"
  }
}
```

Supported intent families:

- create workflow
- add timer/countdown
- add inner state
- add transition/wire
- add Daisy component/preset
- add typed state variable
- configure API/list fetch

Inspect `plan.assumptions` before applying ambiguous prompts.

## Editor Action Mapping

| User editor action | API |
| --- | --- |
| New scene | `create_flow` |
| Rename flow | `set_model_name` |
| Save/load model | `state_blueprint_get_model`, `state_blueprint_replace_model`, `state_blueprint_import_definition` |
| Export `.state.json` | `state_blueprint_export_definition` |
| Export HTML | `state_blueprint_export_html` |
| Create state | `upsert_state` |
| Move state | `move_state` |
| Delete state | `delete_state` |
| Set initial | `set_initial` |
| Create child state | `upsert_state` with `parentId` |
| Connect states | `upsert_transition` |
| Rewire transition | `upsert_transition` with same `id`, new `from`/`to` |
| Delete transition | `delete_transition` |
| Set trigger type | `upsert_transition` with `triggerType`, `triggerEvent`, `timerMs` |
| Set condition | `upsert_transition.condition` |
| Set transition bus patch | `upsert_transition.set` |
| Add state variable/screen field | `upsert_state_variable` |
| Remove state variable/screen field | `delete_state_variable` |
| Configure fetch | `configure_fetch` |
| Configure repeat/list | `configure_repeat` |
| Add data wire | `upsert_data_wire` |
| Remove data wire | `remove_data_wire` |
| Add widget/render row | `add_component` |
| Edit widget/render row | `update_component` plus `upsert_state_variable` for bound data |
| Remove widget/render row | `remove_component` |
| Reorder render rows/buttons/widgets | `reorder_components` |
| Place transition button in render | `add_component` with `type: transitionButton` |
| Set layer input/output proxies | `set_boundary` |
| Group states | `upsert_editor_group` |
| Degroup states | `delete_editor_group` |
| Validate contract | `state_blueprint_validate` |

Session-only editor affordances such as hover, selection, box-select, pan, zoom,
undo, redo, and preview pause are not persistent model edits. Automation should
use dry runs, `get_model`, and explicit replacement if it needs its own history.

## Contract Checks

Before writing, the API rejects or normalizes these cases:

- Transitions whose endpoints do not exist.
- Transitions across layers without boundary proxies.
- Component-local state such as `html`, `localState`, `stateStore`, or `store`.
- Data type entries without matching `state.data`.
- Data-wire components pointing at missing wires.
- Transition-button components pointing at missing transitions.
- State variable collisions, by scoping new variables under `states.<stateId>`.

Recommended write flow for agents:

1. Call `state_blueprint_get_model` with validation.
2. Build a small action list.
3. Call `state_blueprint_apply_actions` with `dryRun: true`.
4. Inspect `validation.ok`, `issues`, and `warnings`.
5. Apply the same action list without `dryRun`.
6. Call `state_blueprint_validate`.

