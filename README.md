# Digitalisierungsplanung

Zustand is a standalone visual FSM builder for understanding, modeling, testing, and exporting digital business processes.

The repository is intentionally narrow. It contains the app, its generated preview runtime, the MCP/API control layer, and the tests that protect the state-machine contract.

## Screenshots

The editor keeps the process, the generated app, and the global-state contract visible in one place.

![Zustand editor canvas with a demo business flow](assets/screenshots/zustand-editor-flow.png)

The preview is the same FSM running as an app. Buttons and widgets fire real transitions and write through the global JSON bus.

![Generated app preview showing checkout flow](assets/screenshots/zustand-preview-checkout.png)

The state inspector edits the selected state's trigger, widgets, screen fields, and scoped bus data without creating hidden local state.

![State inspector with widget and screen-field controls](assets/screenshots/zustand-inspector-widgets.png)

## Contract

There is one source of truth:

```text
global JSON state/event bus
```

Everything that affects flow or data must be represented in the model and must read from or write to that bus through the official runtime path.

Allowed local state:

- Drag, hover, focus, and selection affordances.
- Viewport pan/zoom.
- Animation frame and timer handles.
- Temporary editor UI state.

Not allowed:

- Hidden component stores.
- DOM-only flow decisions.
- Stored HTML as component truth.
- Preset caches that act like runtime data.
- Shadow copies of `state.current`, transition results, widget values, or flow state.
- Legacy migrations or demo-specific behavior paths in the core model.

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
|   `-- state-blueprint-mcp.md
|-- statereadme.md
|-- CNAME
|-- .github/workflows/deploy.yml
`-- .gitea/workflows/test.yml
```

## App

`state.html` contains the visual editor host and the generated preview runtime.

Main responsibilities:

- Model normalization and validation.
- Canvas rendering, SVG ports, boundary proxies, routing, drag/drop, pan, and zoom.
- State inspector and render editor.
- Global state/data tree UI.
- Data defaults, data types, data wires, repeat mappings, and fetch-on-enter configuration.
- DaisyUI preset catalog and preset instantiation.
- Generated app preview runtime.
- Save/load/export/import helpers.

The file stays self-contained so it can be served as a single static app.

## Runtime

The generated preview runtime is bus-driven:

- Host sends `STATE_BLUEPRINT_MODEL`.
- Runtime sends `STATE_BLUEPRINT_RUNTIME_STATE`.
- Runtime asks the host to open external links with `STATE_BLUEPRINT_OPEN_URL`.

Runtime rules:

- `defaultContext(model)` creates bus defaults such as `state.current`, `state.previous`, `state.lastTransition`, and `runtime.paused`.
- `runtimeSet(...)` and `writeRuntimeState(...)` are the write path into the bus.
- Entry effects, such as fetch, run on state entry, not during render.
- Render reads the model plus the bus. It does not invent model state.

## MCP/API

The MCP layer is the structured API surface for automation and external tools. It edits the same canonical JSON model as the app.

Main tools:

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

Run the MCP server:

```bash
STATE_BLUEPRINT_MODEL_PATH=./state-blueprint.workspace.json npm run mcp:state
```

The API applies ordered model actions, normalizes the result, validates the contract, and persists only the canonical JSON model. It does not click the UI and does not keep a parallel runtime store.

Full API documentation: [`docs/state-blueprint-api.md`](docs/state-blueprint-api.md)

## Tests

The tests are part of the architecture.

- `core-contracts.spec.js` protects source-level and browser-level contracts.
- `state-tool.spec.js` is the broad app smoke suite for canvas, proxies, nested states, routing, presets, Daisy behavior, touch gestures, undo/redo, render ordering, save/load, and preview behavior.
- `nested-runtime-regressions.spec.js` protects generated app flow through composite states.
- `state-blueprint-mcp.spec.js` protects the MCP/API contract.

Run:

```bash
npm test
npm run test:contracts
npm run test:full
```

## Deploy

The GitHub Pages workflow runs the smoke suite before publishing the static app.
