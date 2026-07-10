#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  blankModel,
  normalizeModel,
  normalizeWorkspace,
  validateModel,
  applyActions,
  applyCommands,
  commandCatalog,
  definitionPayload,
  modelSummary
} = require("./state-blueprint-core");
const {
  planPrompt,
  promptIntentMarkdown
} = require("./state-blueprint-intents");

const SERVER_VERSION = "0.1.0";
const PROTOCOL_VERSION = "2025-11-25";
const DEFAULT_MODEL_PATH = path.resolve(process.cwd(), "state-blueprint.workspace.json");
const modelPath = path.resolve(process.env.STATE_BLUEPRINT_MODEL_PATH || DEFAULT_MODEL_PATH);

function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return fallback;
    throw error;
  }
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function jsLiteral(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch]));
}

function stateHtmlPath() {
  return path.resolve(__dirname, "..", "state.html");
}

function extractGeneratedAppHtml() {
  const hostHtml = fs.readFileSync(stateHtmlPath(), "utf8");
  const appMatch = hostHtml.match(/const APP_HTML = "((?:\\.|[^"\\])*)";/);
  if (!appMatch) throw new Error("Could not find generated app HTML template in state.html.");
  const appHtml = JSON.parse(`"${appMatch[1]}"`);
  const enhancerMatch = hostHtml.match(/function enhanceGeneratedAppHtml\(html\) \{[\s\S]*?\r?\n    \}\r?\n\r?\n    const GENERATED_APP_HTML/);
  if (!enhancerMatch) throw new Error("Could not find generated app enhancer in state.html.");
  const enhancerSource = enhancerMatch[0].replace(/\r?\n\r?\n    const GENERATED_APP_HTML[\s\S]*$/, "");
  const sandbox = { appHtml, generatedAppHtml: "" };
  vm.runInNewContext(
    `${enhancerSource}\ngeneratedAppHtml = enhanceGeneratedAppHtml(appHtml);`,
    sandbox,
    { timeout: 1000 }
  );
  if (typeof sandbox.generatedAppHtml !== "string" || !sandbox.generatedAppHtml.includes("<!doctype html>")) {
    throw new Error("Could not prepare generated app HTML.");
  }
  return sandbox.generatedAppHtml;
}

function buildStandaloneAppHtml(appHtml, payload) {
  const modelLiteral = jsLiteral(payload.model);
  const exportedAtLiteral = jsLiteral(payload.savedAt);
  const bootstrap = [
    "    const IS_STANDALONE_EXPORT = true;",
    "    const EXPORTED_STATE_BLUEPRINT = " + modelLiteral + ";",
    "    const EXPORTED_STATE_BLUEPRINT_SAVED_AT = " + exportedAtLiteral + ";",
    "",
    "    let model = normalizeModel(JSON.parse(JSON.stringify(EXPORTED_STATE_BLUEPRINT)));"
  ].join("\n");
  const html = appHtml
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(payload.model.name || "Zustand")}</title>`)
    .replace(/    let model = loadModel\(\) \|\| blankModel\(\);/, bootstrap)
    .replace(/    function saveModel\(\) \{\n      try \{ localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(model\)\); \} catch \(_\) \{\}\n    \}/,
      "    function saveModel() {}")
    .replace(/      saveModel\(\);\n      const oldContext = context;/,
      "      const oldContext = context;")
    .replace(/    window\.addEventListener\("message", evt => \{/, "    if (!IS_STANDALONE_EXPORT) window.addEventListener(\"message\", evt => {")
    .replace(/    window\.addEventListener\("storage", evt => \{/, "    if (!IS_STANDALONE_EXPORT) window.addEventListener(\"storage\", evt => {");
  if (!html.includes("EXPORTED_STATE_BLUEPRINT")) throw new Error("Could not prepare standalone app export.");
  return html;
}

function loadWorkspace() {
  const stored = readJsonFile(modelPath, null);
  if (!stored) return normalizeWorkspace({ model: blankModel("State App"), stateTemplates: [] });
  if (stored.kind === "state-blueprint.definition") {
    return normalizeWorkspace({
      model: normalizeModel(stored.model),
      stateTemplates: Array.isArray(stored.stateTemplates) ? stored.stateTemplates : [],
      editor: { camera: stored.camera, previewCollapsed: stored.previewCollapsed }
    });
  }
  if (stored.model) {
    return normalizeWorkspace({
      model: normalizeModel(stored.model),
      stateTemplates: Array.isArray(stored.stateTemplates) ? stored.stateTemplates : [],
      editor: stored.editor,
      clipboard: stored.clipboard,
      history: stored.history
    });
  }
  return normalizeWorkspace({ model: normalizeModel(stored), stateTemplates: [] });
}

function saveWorkspace(workspace) {
  const normalized = normalizeWorkspace(workspace);
  const payload = {
    kind: "state-blueprint.workspace",
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    model: normalized.model,
    stateTemplates: normalized.stateTemplates,
    editor: normalized.editor,
    clipboard: normalized.clipboard,
    history: normalized.history
  };
  writeJsonFile(modelPath, payload);
  return payload;
}

function jsonSchema(properties, required = []) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required
  };
}

const actionSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    type: {
      type: "string",
      description: "Action name, e.g. upsert_state, upsert_transition, upsert_state_variable, add_component, set_boundary."
    }
  },
  required: ["type"]
};

const commandSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    command: {
      type: "string",
      description: "Command name, e.g. state.create, transition.create, graph.insert_state_on_transition, viewport.fit, history.undo."
    }
  }
};

const tools = [
  {
    name: "state_blueprint_get_model",
    description: "Read the canonical State Blueprint model from the MCP workspace file.",
    inputSchema: jsonSchema({
      includeValidation: { type: "boolean", description: "Return contract validation and summary with the model." }
    })
  },
  {
    name: "state_blueprint_replace_model",
    description: "Replace the whole canonical model after normalization and contract validation.",
    inputSchema: jsonSchema({
      model: { type: "object", description: "State Blueprint model JSON." },
      allowInvalid: { type: "boolean", description: "Only use for diagnostics. Invalid models are not recommended." }
    }, ["model"])
  },
  {
    name: "state_blueprint_apply_actions",
    description: "Apply dependency-ordered model-editor actions atomically. Mirrors manual app steps without hidden or local runtime state.",
    inputSchema: jsonSchema({
      actions: {
        type: "array",
        items: actionSchema,
        description: "Actions are applied in dependency order so declared states exist before transitions. Supported types include create_flow, set_model_name, upsert_state, delete_state, move_state, set_initial, upsert_transition, delete_transition, upsert_state_variable, delete_state_variable, configure_fetch, configure_repeat, upsert_data_wire, remove_data_wire, add_component, update_component, remove_component, reorder_components, set_boundary, upsert_editor_group, delete_editor_group. upsert_transition accepts triggerType values button, change, event, realtime, timer, and auto."
      },
      dryRun: { type: "boolean", description: "Validate and return the result without writing to disk." },
      allowInvalid: { type: "boolean", description: "Return invalid results for diagnostics instead of rejecting." }
    }, ["actions"])
  },
  {
    name: "state_blueprint_apply_commands",
    description: "Apply exact editor/API commands over the canonical workspace. Covers model edits plus editor session actions such as selection, layer navigation, viewport, copy/paste, group/ungroup, undo, and redo without DOM automation.",
    inputSchema: jsonSchema({
      commands: {
        type: "array",
        items: commandSchema,
        description: "Commands are applied in order. Model-changing commands are validated before writing. Use state_blueprint_command_catalog for names."
      },
      dryRun: { type: "boolean", description: "Validate and return the workspace result without writing to disk." },
      allowInvalid: { type: "boolean", description: "Return invalid results for diagnostics instead of rejecting." }
    }, ["commands"])
  },
  {
    name: "state_blueprint_plan_prompt",
    description: "Translate a natural-language edit request such as 'füge timer hinzu' into ordered State Blueprint actions without writing them.",
    inputSchema: jsonSchema({
      prompt: { type: "string", description: "Natural language edit request in German or English." },
      selectedStateId: { type: "string", description: "Optional state that should be treated like the UI selection." },
      stateId: { type: "string", description: "Alias for selectedStateId." }
    }, ["prompt"])
  },
  {
    name: "state_blueprint_apply_prompt",
    description: "Translate and apply a natural-language edit request such as 'add countdown 10s to Done'. Returns the plan, actions, and validation.",
    inputSchema: jsonSchema({
      prompt: { type: "string", description: "Natural language edit request in German or English." },
      selectedStateId: { type: "string", description: "Optional state that should be treated like the UI selection." },
      stateId: { type: "string", description: "Alias for selectedStateId." },
      dryRun: { type: "boolean", description: "Plan and validate without writing." },
      allowUnknown: { type: "boolean", description: "Return unknown intents instead of failing." }
    }, ["prompt"])
  },
  {
    name: "state_blueprint_validate",
    description: "Validate the current model against the State Blueprint global-state/event-bus contract.",
    inputSchema: jsonSchema({})
  },
  {
    name: "state_blueprint_export_definition",
    description: "Return a formal .state.json definition payload compatible with the app import/export flow.",
    inputSchema: jsonSchema({})
  },
  {
    name: "state_blueprint_export_html",
    description: "Build the same standalone generated-app HTML that the editor Export HTML button creates.",
    inputSchema: jsonSchema({
      outputPath: { type: "string", description: "Optional file path to write. Relative paths resolve from the current working directory." },
      includeHtml: { type: "boolean", description: "Return the HTML text in the response. Defaults to true when outputPath is omitted." }
    })
  },
  {
    name: "state_blueprint_import_definition",
    description: "Import a formal State Blueprint definition payload into the MCP workspace file.",
    inputSchema: jsonSchema({
      definition: { type: "object", description: "Formal state-blueprint.definition JSON." }
    }, ["definition"])
  },
  {
    name: "state_blueprint_action_catalog",
    description: "Return the supported action names and their contract-level intent.",
    inputSchema: jsonSchema({})
  },
  {
    name: "state_blueprint_command_catalog",
    description: "Return the command API catalog for full programmatic editor execution.",
    inputSchema: jsonSchema({})
  }
];

const actionCatalog = [
  ["create_flow", "Clear the model and start a new flow."],
  ["set_model_name", "Rename the flow."],
  ["replace_model", "Replace the model wholesale, then normalize/validate."],
  ["upsert_state", "Create or update a state, including parent layer, render mode, components, data defaults, fetch, repeat, wires, subscriptions, and boundary."],
  ["delete_state", "Delete a state and, by default, descendants plus connected transitions."],
  ["upsert_editor_group", "Group states as editor-only view metadata. It changes canvas organization, not runtime FSM flow."],
  ["delete_editor_group", "Remove an editor group without deleting member states or transitions."],
  ["move_state", "Move a state on the canvas using snapped world coordinates."],
  ["set_initial", "Set the initial state."],
  ["upsert_transition", "Create or update an explicit transition in one layer with trigger, condition, timer, and set patch. Realtime transitions store only triggerType=realtime and a concrete realtime.* triggerEvent ref."],
  ["delete_transition", "Delete one transition without deleting connected states."],
  ["upsert_state_variable", "Write a state.data default and state.dataTypes entry. Runtime still uses the global bus as truth."],
  ["delete_state_variable", "Remove a state.data default/type and stale render wires for that path."],
  ["configure_fetch", "Configure state-entry data loading into an explicit global bus path, defaulting to the selected state's scoped fetch branch."],
  ["configure_repeat", "Configure list rendering from an explicit global bus path."],
  ["upsert_data_wire", "Map a global bus path into visible render content."],
  ["remove_data_wire", "Remove a render mapping without touching global bus data."],
  ["add_component", "Append or insert a structured render component."],
  ["update_component", "Patch a structured render component."],
  ["remove_component", "Remove a render component."],
  ["reorder_components", "Set render order."],
  ["set_boundary", "Set root or nested layer input/output boundary references and matching proxy transitions."]
].map(([name, description]) => ({ name, description }));

const promptExamples = [
  { prompt: "baue checkout workflow", intent: "create_workflow" },
  { prompt: "füge timer 10s hinzu und weiter zu Done", intent: "add_timer" },
  { prompt: "erstelle inner state Schritt 1", intent: "add_inner_state" },
  { prompt: "verbinde diesen State mit Checkout", intent: "add_transition" },
  { prompt: "füge Card Preset hinzu", intent: "add_component" },
  { prompt: "füge Variable email vom Typ email hinzu", intent: "add_state_variable" },
  { prompt: "lade API https://example.test/items als Liste", intent: "configure_fetch" }
];

function toolResult(value, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
    isError
  };
}

function callTool(name, args = {}) {
  if (name === "state_blueprint_get_model") {
    const workspace = loadWorkspace();
    const result = { modelPath, model: workspace.model };
    if (args.includeValidation) result.validation = validateModel(workspace.model);
    return result;
  }
  if (name === "state_blueprint_replace_model") {
    const workspace = loadWorkspace();
    const validation = validateModel(args.model);
    if (!validation.ok && !args.allowInvalid) {
      const error = new Error("Model contract validation failed.");
      error.validation = validation;
      throw error;
    }
    workspace.model = validation.model;
    if (!args.allowInvalid) saveWorkspace(workspace);
    return { modelPath, dryRun: Boolean(args.allowInvalid), validation, model: workspace.model };
  }
  if (name === "state_blueprint_apply_actions") {
    const workspace = loadWorkspace();
    const result = applyActions(workspace.model, args.actions || [], { allowInvalid: Boolean(args.allowInvalid) });
    if (!args.dryRun) {
      workspace.model = result.model;
      saveWorkspace(workspace);
    }
    return { modelPath, dryRun: Boolean(args.dryRun), ...result };
  }
  if (name === "state_blueprint_apply_commands") {
    const workspace = loadWorkspace();
    const result = applyCommands(workspace, args.commands || [], { allowInvalid: Boolean(args.allowInvalid) });
    if (!args.dryRun) saveWorkspace(result.workspace);
    return { modelPath, dryRun: Boolean(args.dryRun), ...result };
  }
  if (name === "state_blueprint_plan_prompt") {
    const workspace = loadWorkspace();
    const plan = planPrompt(workspace.model, args);
    const dryRun = plan.actions.length
      ? applyActions(workspace.model, plan.actions, { allowInvalid: true })
      : null;
    return {
      modelPath,
      plan,
      validation: dryRun?.validation || validateModel(workspace.model),
      previewModel: dryRun?.model
    };
  }
  if (name === "state_blueprint_apply_prompt") {
    const workspace = loadWorkspace();
    const plan = planPrompt(workspace.model, args);
    if (!plan.understood && !args.allowUnknown) throw new Error(plan.explanation || "Prompt could not be mapped to State Blueprint actions.");
    const result = plan.actions.length
      ? applyActions(workspace.model, plan.actions, { allowInvalid: false })
      : { model: workspace.model, results: [], validation: validateModel(workspace.model) };
    if (!args.dryRun) {
      workspace.model = result.model;
      saveWorkspace(workspace);
    }
    return { modelPath, dryRun: Boolean(args.dryRun), plan, ...result };
  }
  if (name === "state_blueprint_validate") {
    return { modelPath, ...validateModel(loadWorkspace().model) };
  }
  if (name === "state_blueprint_export_definition") {
    const workspace = loadWorkspace();
    return definitionPayload(workspace.model, workspace.stateTemplates, workspace.editor);
  }
  if (name === "state_blueprint_export_html") {
    const workspace = loadWorkspace();
    const payload = definitionPayload(workspace.model, workspace.stateTemplates, workspace.editor);
    const html = buildStandaloneAppHtml(extractGeneratedAppHtml(), payload);
    const includeHtml = Object.prototype.hasOwnProperty.call(args, "includeHtml")
      ? Boolean(args.includeHtml)
      : !args.outputPath;
    let outputPath = "";
    if (args.outputPath) {
      outputPath = path.resolve(process.cwd(), String(args.outputPath));
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, html, "utf8");
    }
    return {
      modelPath,
      outputPath,
      bytes: Buffer.byteLength(html, "utf8"),
      definition: payload,
      html: includeHtml ? html : undefined
    };
  }
  if (name === "state_blueprint_import_definition") {
    const definition = args.definition || {};
    if (definition.kind !== "state-blueprint.definition" || definition.schemaVersion !== 2) {
      throw new Error('Import expects kind "state-blueprint.definition" with schemaVersion 2.');
    }
    const validation = validateModel(definition.model);
    if (!validation.ok) {
      const error = new Error("Imported definition violates the model contract.");
      error.validation = validation;
      throw error;
    }
    const workspace = {
      model: validation.model,
      stateTemplates: Array.isArray(definition.stateTemplates) ? definition.stateTemplates : [],
      editor: { camera: definition.camera, previewCollapsed: definition.previewCollapsed }
    };
    saveWorkspace(workspace);
    return { modelPath, validation, summary: modelSummary(workspace.model) };
  }
  if (name === "state_blueprint_action_catalog") {
    return { modelPath, actions: actionCatalog, promptExamples };
  }
  if (name === "state_blueprint_command_catalog") {
    return { modelPath, commands: commandCatalog };
  }
  throw new Error(`Unknown tool: ${name}`);
}

function listResources() {
  return [
    {
      uri: "state-blueprint://model",
      name: "Current State Blueprint model",
      description: "Canonical model loaded from the MCP workspace file.",
      mimeType: "application/json"
    },
    {
      uri: "state-blueprint://contract",
      name: "State Blueprint contract",
      description: "Global-state/event-bus rules that MCP tools enforce.",
      mimeType: "text/markdown"
    },
    {
      uri: "state-blueprint://actions",
      name: "State Blueprint MCP action catalog",
      description: "Supported ordered action types for state_blueprint_apply_actions.",
      mimeType: "application/json"
    },
    {
      uri: "state-blueprint://commands",
      name: "State Blueprint MCP command catalog",
      description: "Full programmatic editor command names for state_blueprint_apply_commands.",
      mimeType: "application/json"
    },
    {
      uri: "state-blueprint://prompt-intents",
      name: "State Blueprint prompt intents",
      description: "Natural-language phrases and intent defaults for state_blueprint_plan_prompt.",
      mimeType: "text/markdown"
    }
  ];
}

function readResource(uri) {
  if (uri === "state-blueprint://model") {
    return {
      contents: [{
        uri,
        mimeType: "application/json",
        text: JSON.stringify(loadWorkspace().model, null, 2)
      }]
    };
  }
  if (uri === "state-blueprint://actions") {
    return {
      contents: [{
        uri,
        mimeType: "application/json",
        text: JSON.stringify({ actions: actionCatalog, promptExamples }, null, 2)
      }]
    };
  }
  if (uri === "state-blueprint://commands") {
    return {
      contents: [{
        uri,
        mimeType: "application/json",
        text: JSON.stringify({ commands: commandCatalog }, null, 2)
      }]
    };
  }
  if (uri === "state-blueprint://prompt-intents") {
    return {
      contents: [{
        uri,
        mimeType: "text/markdown",
        text: promptIntentMarkdown()
      }]
    };
  }
  if (uri === "state-blueprint://contract") {
    return {
      contents: [{
        uri,
        mimeType: "text/markdown",
        text: [
          "# State Blueprint MCP Contract",
          "",
          "- The model JSON is the only edited artifact.",
          "- Runtime truth remains the single global state/event bus.",
          "- State variables are declared as `state.data` plus `state.dataTypes`; they are defaults, not local runtime storage.",
          "- Render data is expressed as `dataWires` and structured components, never as hidden HTML blobs or component-local stores.",
          "- Transition triggers, conditions, timers, and `set` patches live on transitions.",
          "- Realtime event-catalog data is not copied into the model; transitions keep only concrete `realtime.*` refs.",
          "- Nested flows use boundary input/output references and proxy transitions instead of cross-layer direct wires.",
          "- Tools apply actions in the order given and validate before writing."
        ].join("\n")
      }]
    };
  }
  throw new Error(`Unknown resource: ${uri}`);
}

function response(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id, error) {
  const data = error?.validation ? { validation: error.validation } : undefined;
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message: error?.message || String(error),
      data
    }
  };
}

function handleMessage(message) {
  const { id, method, params = {} } = message || {};
  if (method === "notifications/initialized" || id === undefined || id === null && String(method || "").startsWith("notifications/")) return null;
  try {
    if (method === "initialize") {
      return response(id, {
        protocolVersion: params.protocolVersion || PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false }
        },
        serverInfo: { name: "state-blueprint-mcp", version: SERVER_VERSION }
      });
    }
    if (method === "tools/list") return response(id, { tools });
    if (method === "tools/call") return response(id, toolResult(callTool(params.name, params.arguments || {})));
    if (method === "resources/list") return response(id, { resources: listResources() });
    if (method === "resources/read") return response(id, readResource(params.uri));
    if (method === "ping") return response(id, {});
    return errorResponse(id, new Error(`Unsupported MCP method: ${method}`));
  } catch (error) {
    if (method === "tools/call") return response(id, toolResult({ error: error.message, validation: error.validation }, true));
    return errorResponse(id, error);
  }
}

function writeMessage(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  buffer += chunk;
  let newlineIndex = buffer.indexOf("\n");
  while (newlineIndex >= 0) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (line) {
      try {
        const result = handleMessage(JSON.parse(line));
        if (result) writeMessage(result);
      } catch (error) {
        writeMessage(errorResponse(null, error));
      }
    }
    newlineIndex = buffer.indexOf("\n");
  }
});

process.stdin.on("end", () => {
  process.exit(0);
});
