const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { test, expect } = require("@playwright/test");
const { normalizeModel, validateModel, applyActions, applyCommands, commandCatalog, definitionPayload } = require("../mcp/state-blueprint-core");
const { planPrompt, promptIntentMarkdown } = require("../mcp/state-blueprint-intents");

function runtimeScript(html) {
  const scripts = [...String(html).matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  const runtime = scripts.find(script => script.includes("IS_STANDALONE_EXPORT"));
  if (!runtime) throw new Error("Could not find standalone runtime script.");
  return runtime;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function createMcpClient(modelPath) {
  const child = spawn(process.execPath, ["mcp/state-blueprint-server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, STATE_BLUEPRINT_MODEL_PATH: modelPath },
    stdio: ["pipe", "pipe", "pipe"]
  });
  const pending = new Map();
  let nextId = 1;
  let buffer = "";
  let stderr = "";

  child.stderr.on("data", chunk => { stderr += chunk.toString(); });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", chunk => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        const message = JSON.parse(line);
        const slot = pending.get(message.id);
        if (slot) {
          pending.delete(message.id);
          if (message.error) slot.reject(new Error(message.error.message));
          else slot.resolve(message.result);
        }
      }
      newlineIndex = buffer.indexOf("\n");
    }
  });

  function request(method, params = {}) {
    const id = nextId++;
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}\n${stderr}`));
      }, 5000);
      pending.set(id, {
        resolve(value) {
          clearTimeout(timer);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  async function close() {
    child.stdin.end();
    child.kill();
  }

  return { request, close };
}

test.describe("State Blueprint MCP", () => {
  test("keeps state and transition ids in one global API namespace @smoke", () => {
    const model = {
      version: 2,
      name: "ID Contract",
      initial: "start",
      states: [
        { id: "start", title: "Start", components: [], data: {}, x: 96, y: 120 }
      ],
      transitions: [
        { id: "start", from: "start", to: "start", label: "Loop", set: {} }
      ]
    };

    const validation = validateModel(model);
    expect(validation.ok).toBe(false);
    expect(validation.issues.some(issue => issue.code === "state_transition_id_collision")).toBe(true);

    const normalized = normalizeModel(model);
    expect(normalized.transitions[0].id).not.toBe("start");

    const applied = applyActions(model, [{
      type: "upsert_transition",
      id: "start",
      from: "start",
      to: "start",
      label: "Loop"
    }], { allowInvalid: true });
    expect(applied.model.transitions[0].id).not.toBe("start");
  });

  test("uses Weiter only for empty labels and treats every explicit name as opaque @smoke", () => {
    const normalized = normalizeModel({
      version: 2,
      name: "Transition names",
      initial: "start",
      states: [
        { id: "start", title: "Start" },
        { id: "target", title: "Zustand 2" },
        { id: "custom_source", title: "Formular" },
        { id: "custom_target", title: "Konto" },
        { id: "empty_source", title: "Leer" },
        { id: "empty_target", title: "Fertig" }
      ],
      transitions: [
        { id: "explicit", from: "start", to: "target", label: "Bestätigen" },
        { id: "custom", from: "custom_source", to: "custom_target", label: "Anmelden" },
        { id: "empty", from: "empty_source", to: "empty_target", label: "   " }
      ]
    });

    expect(normalized.transitions.map(transition => transition.label)).toEqual([
      "Bestätigen",
      "Anmelden",
      "Weiter"
    ]);

    const created = applyCommands({}, [
      { command: "scene.new", title: "Defaults" },
      { command: "state.create", id: "one", title: "Eins" },
      { command: "state.create", id: "two", title: "Zwei" },
      { command: "transition.create", id: "one_two", from: "one", to: "two" },
      { command: "state.upsert", id: "two", title: "Umbenannt" }
    ]);
    expect(created.workspace.model.transitions[0].label).toBe("Weiter");
  });

  test("rejects every unqualified runtime reference instead of rewriting it @smoke", () => {
    const validation = validateModel({
      version: 2,
      name: "Strict runtime paths",
      initial: "start",
      states: [{
        id: "start",
        title: "Start",
        data: { email: "" },
        dataTypes: { email: "email" },
        components: [{ id: "email", type: "text", text: "{{email}}", dataPath: "email" }],
        dataSource: { url: "", target: "fetch", select: "", timeoutMs: 8000, retries: 2 },
        repeat: { path: "items", as: "item", index: "i" },
        dataWires: [{ id: "email_wire", sourcePath: "email", scopePath: "", itemPath: "", role: "field", componentType: "text" }],
        subscriptions: ["email"]
      }],
      transitions: [{
        id: "stay",
        from: "start",
        to: "start",
        label: "Weiter",
        condition: "email != ''",
        triggerType: "change",
        triggerEvent: "change.email",
        set: { email: "sent" }
      }]
    });

    expect(validation.ok).toBe(false);
    expect(validation.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      "invalid_component_data_path",
      "invalid_component_template_path",
      "invalid_data_source_target",
      "invalid_repeat_path",
      "invalid_data_wire_source",
      "invalid_subscription_path",
      "invalid_transition_condition_path",
      "invalid_change_trigger_path",
      "invalid_transition_set_path"
    ]));
  });

  test("validates explicit transition action ownership across MCP models @smoke", () => {
    const model = () => ({
      version: 2,
      name: "Action ownership",
      initial: "start",
      states: [
        {
          id: "start",
          title: "Start",
          data: { widget: { label: "Weiter", transitionId: "to_done" } },
          dataTypes: { widget: "object" },
          components: [{ id: "action", type: "daisy", variant: "button", dataPath: "states.start.widget" }]
        },
        { id: "done", title: "Done", data: {}, components: [] },
        { id: "other", title: "Other", data: {}, components: [] }
      ],
      transitions: [{
        id: "to_done",
        from: "start",
        to: "done",
        label: "Weiter",
        triggerType: "realtime",
        triggerEvent: "realtime.sip.call.incoming",
        set: {}
      }]
    });

    expect(validateModel(model()).ok).toBe(true);

    const missing = model();
    missing.states[0].data.widget.transitionId = "missing";
    expect(validateModel(missing).issues).toContainEqual(expect.objectContaining({ code: "missing_transition_action_target" }));

    const foreign = model();
    foreign.transitions[0].from = "other";
    expect(validateModel(foreign).issues).toContainEqual(expect.objectContaining({ code: "foreign_transition_action_target" }));

    const repeatedControl = model();
    repeatedControl.states[0].components.push({ id: "repeated", type: "transitionButton", transitionId: "to_done" });
    expect(validateModel(repeatedControl).ok).toBe(true);

    const conflict = model();
    conflict.states[0].data.widget.url = "https://example.com";
    expect(validateModel(conflict).issues).toContainEqual(expect.objectContaining({ code: "transition_action_target_conflict" }));

    const linkOnly = model();
    linkOnly.states[0].data.widget.transitionId = "";
    linkOnly.states[0].data.widget.url = "https://example.com";
    expect(validateModel(linkOnly).ok).toBe(true);
  });

  test("enforces one deterministic owner per effective trigger @smoke", () => {
    const base = () => ({
      version: 2,
      name: "Trigger ownership",
      initial: "start",
      states: [
        { id: "start", title: "Start", data: {}, components: [] },
        { id: "a", title: "A", data: {}, components: [] },
        { id: "b", title: "B", data: {}, components: [] },
        { id: "c", title: "C", data: {}, components: [] }
      ],
      transitions: [
        { id: "click_a", from: "start", to: "a", label: "A", triggerType: "button", set: {} },
        { id: "event_b", from: "start", to: "b", label: "B", triggerType: "realtime", triggerEvent: "realtime.route.b", set: {} }
      ]
    });

    expect(validateModel(base()).ok).toBe(true);

    const distinctButtons = base();
    distinctButtons.transitions = [
      { id: "click_a", from: "start", to: "a", label: "A", triggerType: "button", set: {} },
      { id: "click_b", from: "start", to: "b", label: "B", triggerType: "button", set: {} }
    ];
    expect(validateModel(distinctButtons).ok).toBe(true);

    const guarded = base();
    guarded.states[0].data.route = "b";
    guarded.states[0].dataTypes = { route: "text" };
    guarded.transitions[1].condition = 'states.start.route == "b"';
    guarded.transitions.push({
      id: "event_c",
      from: "start",
      to: "c",
      label: "C event",
      triggerType: "realtime",
      triggerEvent: "realtime.route.b",
      condition: 'states.start.route == "c"',
      set: {}
    });
    expect(validateModel(guarded).ok).toBe(true);

    const duplicateChange = base();
    duplicateChange.transitions = [
      { id: "change_a", from: "start", to: "a", label: "A", triggerType: "change", triggerEvent: "change.states.start.value", set: {} },
      { id: "change_b", from: "start", to: "b", label: "B", triggerType: "change", triggerEvent: "change.states.start.value", set: {} }
    ];
    expect(validateModel(duplicateChange).issues).toContainEqual(expect.objectContaining({ code: "duplicate_transition_trigger", triggerKey: "change:change.states.start.value" }));

    const duplicateWildcardChange = base();
    duplicateWildcardChange.transitions = [
      { id: "change_a", from: "start", to: "a", label: "A", triggerType: "change", triggerEvent: "", set: {} },
      { id: "change_b", from: "start", to: "b", label: "B", triggerType: "change", triggerEvent: "", set: {} }
    ];
    expect(validateModel(duplicateWildcardChange).issues).toContainEqual(expect.objectContaining({ code: "duplicate_transition_trigger", triggerKey: "change:*" }));

    const duplicateEvent = base();
    duplicateEvent.transitions = [
      { id: "event_a", from: "start", to: "a", label: "A", triggerType: "event", triggerEvent: "event.route", set: {} },
      { id: "event_b", from: "start", to: "b", label: "B", triggerType: "event", triggerEvent: "event.route", set: {} }
    ];
    expect(validateModel(duplicateEvent).issues).toContainEqual(expect.objectContaining({ code: "duplicate_transition_trigger", triggerKey: "event:event.route" }));

    const duplicateRealtime = base();
    duplicateRealtime.transitions.push({ id: "event_c", from: "start", to: "c", label: "C event", triggerType: "realtime", triggerEvent: "realtime.route.b", set: {} });
    expect(validateModel(duplicateRealtime).issues).toContainEqual(expect.objectContaining({ code: "duplicate_transition_trigger", stateId: "start" }));

    const duplicateSamePair = base();
    duplicateSamePair.transitions.push({ id: "event_a", from: "start", to: "a", label: "A event", triggerType: "realtime", triggerEvent: "realtime.route.b", set: {} });
    expect(validateModel(duplicateSamePair).issues).toContainEqual(expect.objectContaining({ code: "duplicate_transition_trigger", stateId: "start" }));

    const timers = base();
    timers.transitions = [
      { id: "timer_a", from: "start", to: "a", label: "A", triggerType: "timer", timerMs: 100, set: {} },
      { id: "timer_b", from: "start", to: "b", label: "B", triggerType: "timer", timerMs: 200, set: {} }
    ];
    expect(validateModel(timers).issues).toContainEqual(expect.objectContaining({ code: "duplicate_transition_trigger", triggerKey: "timer" }));

    const automatic = base();
    automatic.transitions[0].triggerType = "auto";
    expect(validateModel(automatic).issues).toContainEqual(expect.objectContaining({ code: "exclusive_auto_trigger", stateId: "start" }));

    const unknown = base();
    unknown.transitions[0].triggerType = "click";
    expect(validateModel(unknown).issues).toContainEqual(expect.objectContaining({ code: "invalid_transition_trigger_type", transitionId: "click_a" }));

    const missing = base();
    missing.transitions[1].triggerEvent = "";
    expect(validateModel(missing).issues).toContainEqual(expect.objectContaining({ code: "missing_transition_trigger", transitionId: "event_b" }));

    expect(() => applyActions(base(), [{
      type: "upsert_transition",
      id: "event_c",
      from: "start",
      to: "c",
      label: "C event",
      triggerType: "realtime",
      triggerEvent: "realtime.route.b"
    }])).toThrow("Each trigger-condition identity may be claimed only once");

    expect(() => applyActions(base(), [{
      type: "upsert_transition",
      id: "invalid",
      from: "start",
      to: "c",
      label: "Invalid",
      triggerType: "click"
    }])).toThrow("triggerType must be one of button, change, event, realtime, timer, auto");
  });

  test("documents the public MCP tools and model actions @smoke", () => {
    const apiDoc = fs.readFileSync(path.join(process.cwd(), "docs", "state-blueprint-api.md"), "utf8");
    const mcpDoc = fs.readFileSync(path.join(process.cwd(), "docs", "state-blueprint-mcp.md"), "utf8");
    const readme = fs.readFileSync(path.join(process.cwd(), "README.md"), "utf8");
    const tools = [
      "state_blueprint_get_model",
      "state_blueprint_replace_model",
      "state_blueprint_apply_actions",
      "state_blueprint_plan_prompt",
      "state_blueprint_apply_prompt",
      "state_blueprint_validate",
      "state_blueprint_export_definition",
      "state_blueprint_import_definition",
      "state_blueprint_export_html",
      "state_blueprint_action_catalog",
      "state_blueprint_apply_commands",
      "state_blueprint_command_catalog"
    ];
    const actions = [
      "create_flow",
      "set_model_name",
      "replace_model",
      "upsert_state",
      "delete_state",
      "move_state",
      "set_initial",
      "upsert_transition",
      "delete_transition",
      "upsert_state_variable",
      "delete_state_variable",
      "configure_fetch",
      "configure_repeat",
      "upsert_data_wire",
      "remove_data_wire",
      "add_component",
      "update_component",
      "remove_component",
      "reorder_components",
      "set_boundary"
    ];

    for (const tool of tools) expect(apiDoc).toContain(tool);
    for (const action of actions) expect(apiDoc).toContain(action);
    expect(apiDoc).toContain("`realtime`");
    expect(apiDoc).toContain("triggerType");
    expect(apiDoc).toContain("state_blueprint_apply_commands");
    expect(apiDoc).toContain("graph.insert_state_on_transition");
    expect(apiDoc).toContain("graph.collapse_to_parent");
    expect(apiDoc).toContain("graph.degroup_parent");
    expect(apiDoc).toContain("history.undo");
    expect(apiDoc).toContain("model.realtime");
    expect(apiDoc).not.toContain("upsert_editor_group");
    expect(apiDoc).not.toContain("delete_editor_group");
    expect(apiDoc).not.toContain("`add_state`");
    expect(apiDoc).not.toContain("`add_transition`");
    expect(apiDoc).not.toContain("`add_state_variable`");
    expect(apiDoc).not.toContain("`sourcePath` / `path`");
    expect(mcpDoc).toContain("state-blueprint-api.md");
    expect(mcpDoc).toContain('triggerType: "realtime"');
    expect(readme).toContain("docs/state-blueprint-api.md");

    const promptDoc = promptIntentMarkdown();
    expect(promptDoc).toContain("`upsert_transition`");
    expect(promptDoc).toContain("`upsert_state_variable`");
    expect(promptDoc).not.toContain("`add_transition`");
    expect(promptDoc).not.toContain("`add_state_variable`");

    const promptModel = applyActions({}, [
      { type: "upsert_state", id: "start", title: "Start" }
    ]).model;
    expect(planPrompt(promptModel, { prompt: "verbinde diesen State mit Checkout", selectedStateId: "start" }).intent).toBe("upsert_transition");
    expect(planPrompt(promptModel, { prompt: "füge Variable email vom Typ email hinzu", selectedStateId: "start" }).intent).toBe("upsert_state_variable");
  });

  test("uses the editor definition discriminator for MCP roundtrips @smoke", () => {
    const editorSource = fs.readFileSync(path.join(process.cwd(), "state.html"), "utf8");
    const editorKind = editorSource.match(/const DEFINITION_KIND = "([^"]+)";/)?.[1];
    const definition = definitionPayload({ version: 2, name: "Roundtrip", states: [], transitions: [] });

    expect(editorKind).toBe("state-blueprint-definition");
    expect(definition.kind).toBe(editorKind);
    expect(definition.schemaVersion).toBe(2);
  });

  test("rejects removed action, command, field, path, and workspace forms @smoke", async () => {
    const base = applyActions({}, [
      { type: "upsert_state", id: "start", title: "Start" },
      { type: "upsert_state", id: "done", title: "Done" },
      { type: "upsert_transition", id: "start_done", from: "start", to: "done" }
    ]).model;

    expect(() => applyActions(base, [{ type: "add_state", id: "old" }])).toThrow("Unknown state-blueprint action");
    expect(() => applyActions(base, [{ action: "upsert_state", id: "old" }])).toThrow("Unknown state-blueprint action");
    expect(() => applyActions(base, [{ type: "add_transition", id: "old", from: "start", to: "done" }])).toThrow("Unknown state-blueprint action");
    expect(() => applyActions(base, [{ type: "delete_transition", id: "start_done" }])).toThrow("requires transitionId");
    expect(() => applyActions(base, [{ type: "upsert_state_variable", stateId: "start", path: "states.start.email", value: "" }])).toThrow("requires a local path");
    expect(() => applyCommands({ model: base }, [{ type: "state.create", id: "old" }])).toThrow("Command requires command");
    expect(() => applyCommands({ model: base }, [{ command: "transition.upsert", id: "old", from: "start", to: "done" }])).toThrow("Unknown state-blueprint command");
    expect(() => applyCommands({ model: base }, [{ command: "widget.add", stateId: "start", component: { id: "old", type: "text" } }])).toThrow("Unknown state-blueprint command");

    const tempDir = path.join(process.cwd(), "tmp", "mcp-tests");
    fs.mkdirSync(tempDir, { recursive: true });
    const modelPath = path.join(tempDir, `noncanonical-workspace-${Date.now()}.json`);
    fs.writeFileSync(modelPath, JSON.stringify(base));
    const client = createMcpClient(modelPath);
    try {
      await client.request("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "strict-workspace-test", version: "1.0.0" }
      });
      const rejected = await client.request("tools/call", {
        name: "state_blueprint_get_model",
        arguments: {}
      });
      expect(rejected.isError).toBe(true);
      expect(rejected.structuredContent.error).toContain("state-blueprint.workspace schemaVersion 1");
    } finally {
      await client.close();
      try { fs.unlinkSync(modelPath); } catch (_) {}
    }
  });

  test("drives editor commands through the canonical model without DOM automation @smoke", () => {
    expect(commandCatalog.map(command => command.name)).toEqual(expect.arrayContaining([
      "state.create",
      "transition.create",
      "graph.insert_state_on_transition",
      "graph.collapse_to_parent",
      "graph.degroup_parent",
      "history.undo",
      "history.redo"
    ]));

    const created = applyCommands({}, [
      { command: "scene.new", title: "Command Flow" },
      { command: "state.create", id: "start", title: "Start", x: 96, y: 120 },
      { command: "state.create", id: "done", title: "Done", x: 456, y: 120 },
      { command: "transition.create", id: "start_done", from: "start", to: "done", label: "Continue" },
      { command: "selection.set", stateIds: ["start"] },
      { command: "viewport.fit", viewportWidth: 900, viewportHeight: 600 },
      { command: "graph.insert_state_on_transition", transitionId: "start_done", stateId: "review", title: "Review", x: 264, y: 120 }
    ]);

    expect(created.validation.ok).toBe(true);
    expect(created.workspace.model.states.map(state => state.id)).toEqual(["start", "done", "review"]);
    expect(created.workspace.model.transitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "start_done", from: "start", to: "review" }),
      expect.objectContaining({ from: "review", to: "done" })
    ]));
    expect(created.workspace.editor.selected.nodes).toEqual(["review"]);
    expect(created.workspace.editor.camera.scale).toBeGreaterThan(0.25);
    expect(JSON.stringify(created.workspace.model)).not.toMatch(/localState|stateStore|html/);

    const undone = applyCommands(created.workspace, [{ command: "history.undo" }]);
    expect(undone.workspace.model.states.map(state => state.id)).toEqual(["start", "done"]);
    expect(undone.workspace.model.transitions).toEqual([
      expect.objectContaining({ id: "start_done", from: "start", to: "done" })
    ]);

    const redone = applyCommands(undone.workspace, [{ command: "history.redo" }]);
    expect(redone.workspace.model.states.map(state => state.id)).toEqual(["start", "done", "review"]);
    expect(redone.workspace.model.transitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "start_done", from: "start", to: "review" }),
      expect.objectContaining({ from: "review", to: "done" })
    ]));
  });

  test("groups through real parent states instead of editorGroups metadata @smoke", () => {
    const grouped = applyCommands({}, [
      { command: "scene.new", title: "Group Contract" },
      { command: "state.create", id: "start", title: "Start", x: 96, y: 120 },
      { command: "state.create", id: "review", title: "Review", x: 360, y: 120 },
      { command: "state.create", id: "done", title: "Done", x: 624, y: 120 },
      { command: "transition.create", id: "start_review", from: "start", to: "review", label: "Review" },
      { command: "transition.create", id: "review_done", from: "review", to: "done", label: "Done" },
      { command: "graph.collapse_to_parent", id: "checkout", title: "Checkout", stateIds: ["start", "review"] }
    ]);

    expect(grouped.validation.ok).toBe(true);
    expect(grouped.workspace.model).not.toHaveProperty("editorGroups");
    expect(grouped.workspace.model.states.map(state => state.id)).toEqual(["start", "review", "done", "checkout"]);
    expect(grouped.workspace.model.states.find(state => state.id === "checkout")).toEqual(expect.objectContaining({
      id: "checkout",
      title: "Checkout",
      boundary: expect.objectContaining({ entryId: "start", exitId: "review" })
    }));
    expect(grouped.workspace.model.states.find(state => state.id === "start").parentId).toBe("checkout");
    expect(grouped.workspace.model.states.find(state => state.id === "review").parentId).toBe("checkout");
    expect(grouped.workspace.model.transitions.find(transition => transition.id === "review_done")).toEqual(expect.objectContaining({
      from: "checkout",
      to: "done",
      groupExitId: "review"
    }));

    const degrouped = applyCommands(grouped.workspace, [
      { command: "graph.degroup_parent", parentId: "checkout" }
    ]);
    expect(degrouped.validation.ok).toBe(true);
    expect(degrouped.workspace.model).not.toHaveProperty("editorGroups");
    expect(degrouped.workspace.model.states.map(state => state.id)).toEqual(["start", "review", "done"]);
    expect(degrouped.workspace.model.states.map(state => state.parentId || null)).toEqual([null, null, null]);
    expect(degrouped.workspace.model.transitions).toEqual([
      expect.objectContaining({ id: "start_review", from: "start", to: "review" }),
      expect.objectContaining({ id: "review_done", from: "review", to: "done" })
    ]);
  });

  test("exposes standard MCP tools and applies dependency-ordered app actions without hidden state @smoke", async ({ page }) => {
    const tempDir = path.join(process.cwd(), "tmp", "mcp-tests");
    fs.mkdirSync(tempDir, { recursive: true });
    const modelPath = path.join(tempDir, `workspace-${Date.now()}.json`);
    const client = createMcpClient(modelPath);

    try {
      const init = await client.request("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "state-blueprint-mcp-test", version: "1.0.0" }
      });
      expect(init.serverInfo.name).toBe("state-blueprint-mcp");

      const listed = await client.request("tools/list");
      const toolNames = listed.tools.map(tool => tool.name);
      expect(toolNames).toContain("state_blueprint_apply_actions");
      expect(toolNames).toContain("state_blueprint_apply_commands");
      expect(toolNames).toContain("state_blueprint_plan_prompt");
      expect(toolNames).toContain("state_blueprint_apply_prompt");
      expect(toolNames).toContain("state_blueprint_validate");
      expect(toolNames).toContain("state_blueprint_export_html");
      expect(toolNames).toContain("state_blueprint_command_catalog");

      const applied = await client.request("tools/call", {
        name: "state_blueprint_apply_actions",
        arguments: {
          actions: [
            { type: "create_flow", name: "MCP Checkout" },
            { type: "upsert_state", id: "start", title: "Start", x: 96, y: 120 },
            { type: "upsert_state_variable", stateId: "start", path: "email", valueType: "email", value: "" },
            { type: "upsert_state_variable", stateId: "start", path: "submitted", valueType: "boolean", value: false },
            { type: "upsert_data_wire", stateId: "start", id: "wire_email", sourcePath: "states.start.email", role: "field", componentType: "text", label: "Email" },
            { type: "add_component", stateId: "start", component: { id: "email_render", type: "dataWire", wireId: "wire_email" } },
            { type: "upsert_transition", id: "submit", from: "start", to: "done", label: "Submit", condition: "states.start.email", set: { "states.start.submitted": true } },
            { type: "upsert_state", id: "done", title: "Done", x: 360, y: 120, components: [{ id: "done_text", type: "text", text: "Thanks", url: "" }] },
            { type: "set_initial", stateId: "start" },
            { type: "upsert_state", id: "parent", title: "Parent", x: 96, y: 360 },
            { type: "upsert_state", id: "child", title: "Child", parentId: "parent", x: 120, y: 120 },
            { type: "set_boundary", parentId: "parent", entryId: "child", exitId: "child" }
          ]
        }
      });

      expect(applied.structuredContent.validation.ok).toBe(true);
      expect(applied.structuredContent.model.initial).toBe("start");

      const stored = JSON.parse(fs.readFileSync(modelPath, "utf8"));
      const model = stored.model;
      expect(model.name).toBe("MCP Checkout");
      expect(model.states.map(state => state.id)).toEqual(["start", "done", "parent", "child"]);
      expect(model.states.some(state => "combinedRender" in state)).toBe(false);
      expect(model.states.flatMap(state => state.components || []).some(component => component.type === "childOutlet")).toBe(false);
      expect(model.states.find(state => state.id === "start").dataTypes.email).toBe("email");
      expect(model.states.find(state => state.id === "start").data.email).toBe("");
      expect(model.states.find(state => state.id === "start").data).not.toHaveProperty("states.start");
      expect(model.states.find(state => state.id === "start").dataWires).toEqual([
        expect.objectContaining({ id: "wire_email", sourcePath: "states.start.email", componentType: "text" })
      ]);
      expect(model.transitions.find(transition => transition.id === "submit")).toEqual(expect.objectContaining({
        from: "start",
        to: "done",
        label: "Submit",
        condition: "states.start.email",
        set: { "states.start.submitted": true }
      }));
      expect(model.transitions.find(transition => transition.id === "boundary-flow:parent:input")).toEqual(expect.objectContaining({
        to: "child",
        boundaryFlow: { parentId: "parent", side: "input", stateId: "child" }
      }));
      expect(model.transitions.find(transition => transition.id === "boundary-flow:parent:output")).toEqual(expect.objectContaining({
        from: "child",
        boundaryFlow: { parentId: "parent", side: "output", stateId: "child" }
      }));
      expect(model).not.toHaveProperty("editorGroups");
      expect(JSON.stringify(model)).not.toMatch(/localState|stateStore|html/);

      const validation = await client.request("tools/call", { name: "state_blueprint_validate", arguments: {} });
      expect(validation.structuredContent.ok).toBe(true);

      const exportPath = path.join(tempDir, "mcp-checkout.html");
      const exportedHtml = await client.request("tools/call", {
        name: "state_blueprint_export_html",
        arguments: { outputPath: exportPath, includeHtml: false }
      });
      expect(exportedHtml.structuredContent.outputPath).toBe(exportPath);
      expect(exportedHtml.structuredContent.bytes).toBeGreaterThan(50000);
      const exportedText = fs.readFileSync(exportPath, "utf8");
      await page.goto("/state.html");
      const editorExportedText = await page.evaluate(
        definition => buildStandaloneAppHtml(GENERATED_APP_HTML, definition),
        exportedHtml.structuredContent.definition
      );
      expect({
        bytes: Buffer.byteLength(runtimeScript(exportedText), "utf8"),
        sha256: sha256(runtimeScript(exportedText))
      }).toEqual({
        bytes: Buffer.byteLength(runtimeScript(editorExportedText), "utf8"),
        sha256: sha256(runtimeScript(editorExportedText))
      });
      expect(exportedText).toContain("EXPORTED_STATE_BLUEPRINT");
      expect(exportedText).toContain("MCP Checkout");
      expect(exportedText).toContain("function normalizeStateDataObject(value)");
      expect(exportedText).toContain("function applyActiveStateDataDefaults(state)");
      expect(exportedText).toContain("function runtimeContextAfterModelUpdate(previousModel, nextModel, currentContext)");
      expect(exportedText).toContain("function resetRuntimeContextInPlace(nextModel, currentContext)");
      expect(exportedText).not.toContain("context = runtimeContextAfterModelUpdate");
      expect(exportedText).not.toContain('type: "STATE_BLUEPRINT_RUNTIME_EVENT"');
      expect(exportedText).not.toContain("window.opener");
      expect(exportedText).not.toContain("localStorage");
      expect(exportedText).not.toContain('window.addEventListener("storage"');
      expect(exportedText).not.toContain("window.__stateBlueprintRealtime");
      await page.goto("about:blank");
      await page.setContent(exportedText, { waitUntil: "domcontentloaded" });
      await expect(page.locator("#appName")).toHaveText("MCP Checkout");
      await expect(page.locator("#statePill")).toHaveText("start");
      await expect.poll(() => page.evaluate(() => context.states?.start?.email)).toBe("");

      const hiddenModel = await client.request("tools/call", {
        name: "state_blueprint_replace_model",
        arguments: {
          model: {
            version: 2,
            name: "Hidden State",
            initial: "hidden",
            states: [{
              id: "hidden",
              title: "Hidden",
              components: [{ id: "hidden_html", type: "daisy", html: "<button>Shadow</button>" }]
            }],
            transitions: []
          }
        }
      });
      expect(hiddenModel.isError).toBe(true);
      expect(hiddenModel.structuredContent.validation.issues).toContainEqual(expect.objectContaining({
        code: "hidden_component_state",
        componentId: "hidden_html"
      }));

      const hiddenAction = await client.request("tools/call", {
        name: "state_blueprint_apply_actions",
        arguments: {
          actions: [
            { type: "add_component", stateId: "start", component: { id: "bad_html", type: "daisy", html: "<button>Shadow</button>" } }
          ]
        }
      });
      expect(hiddenAction.isError).toBe(true);
      expect(hiddenAction.structuredContent.error).toContain("Component must not carry html");

      const resource = await client.request("resources/read", { uri: "state-blueprint://contract" });
      expect(resource.contents[0].text).toContain("single global state/event bus");

      const promptIntents = await client.request("resources/read", { uri: "state-blueprint://prompt-intents" });
      expect(promptIntents.contents[0].text).toContain("füge timer hinzu");
    } finally {
      await client.close();
      try { fs.unlinkSync(modelPath); } catch (_) {}
    }
  });

  test("applies full editor commands through MCP and persists the workspace session @smoke", async () => {
    const tempDir = path.join(process.cwd(), "tmp", "mcp-tests");
    fs.mkdirSync(tempDir, { recursive: true });
    const modelPath = path.join(tempDir, `command-workspace-${Date.now()}.json`);
    const client = createMcpClient(modelPath);

    try {
      await client.request("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "state-blueprint-mcp-test", version: "1.0.0" }
      });

      const catalog = await client.request("tools/call", {
        name: "state_blueprint_command_catalog",
        arguments: {}
      });
      expect(catalog.structuredContent.commands.map(command => command.name)).toEqual(expect.arrayContaining([
        "state.create",
        "transition.create",
        "graph.insert_state_on_transition",
        "selection.set",
        "viewport.fit",
        "history.undo",
        "history.redo"
      ]));

      const applied = await client.request("tools/call", {
        name: "state_blueprint_apply_commands",
        arguments: {
          commands: [
            { command: "scene.new", title: "Command MCP Flow" },
            { command: "state.create", id: "start", title: "Start", x: 96, y: 120 },
            { command: "state.create", id: "done", title: "Done", x: 456, y: 120 },
            { command: "transition.create", id: "start_done", from: "start", to: "done", label: "Continue" },
            { command: "selection.set", stateIds: ["start"] },
            { command: "viewport.fit", viewportWidth: 900, viewportHeight: 600 },
            { command: "graph.insert_state_on_transition", transitionId: "start_done", stateId: "review", title: "Review", x: 264, y: 120 }
          ]
        }
      });

      expect(applied.structuredContent.validation.ok).toBe(true);
      expect(applied.structuredContent.workspace.model.transitions).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "start_done", from: "start", to: "review" }),
        expect.objectContaining({ from: "review", to: "done" })
      ]));
      expect(applied.structuredContent.workspace.editor.selected.nodes).toEqual(["review"]);
      expect(applied.structuredContent.workspace.editor).not.toHaveProperty("runtimePaused");

      let stored = JSON.parse(fs.readFileSync(modelPath, "utf8"));
      expect(stored.kind).toBe("state-blueprint.workspace");
      expect(stored.model.states.map(state => state.id)).toEqual(["start", "done", "review"]);
      expect(stored.editor.selected.nodes).toEqual(["review"]);
      expect(stored.history.undo.length).toBeGreaterThan(0);
      expect(JSON.stringify(stored.model)).not.toMatch(/localState|stateStore|html/);

      await client.request("tools/call", {
        name: "state_blueprint_apply_commands",
        arguments: { commands: [{ command: "history.undo" }] }
      });
      stored = JSON.parse(fs.readFileSync(modelPath, "utf8"));
      expect(stored.model.states.map(state => state.id)).toEqual(["start", "done"]);
      expect(stored.model.transitions).toEqual([
        expect.objectContaining({ id: "start_done", from: "start", to: "done" })
      ]);

      const exported = await client.request("tools/call", {
        name: "state_blueprint_export_definition",
        arguments: {}
      });
      expect(exported.structuredContent.kind).toBe("state-blueprint-definition");
      expect(exported.structuredContent.model.states.map(state => state.id)).toEqual(["start", "done"]);
      expect(exported.structuredContent.camera).toEqual(expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
        scale: expect.any(Number)
      }));
      expect(exported.structuredContent.history).toBeUndefined();

      const imported = await client.request("tools/call", {
        name: "state_blueprint_import_definition",
        arguments: { definition: exported.structuredContent }
      });
      expect(imported.structuredContent.validation.ok).toBe(true);
      expect(imported.structuredContent.validation.model.states.map(state => state.id)).toEqual(["start", "done"]);
      const importedStored = JSON.parse(fs.readFileSync(modelPath, "utf8"));
      expect(importedStored.model.states.map(state => state.id)).toEqual(["start", "done"]);
    } finally {
      await client.close();
      try { fs.unlinkSync(modelPath); } catch (_) {}
    }
  });

  test("keeps MCP realtime transitions conformant without local event-catalog contracts @smoke", async () => {
    const tempDir = path.join(process.cwd(), "tmp", "mcp-tests");
    fs.mkdirSync(tempDir, { recursive: true });
    const modelPath = path.join(tempDir, `realtime-workspace-${Date.now()}.json`);
    const client = createMcpClient(modelPath);

    try {
      await client.request("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "state-blueprint-mcp-test", version: "1.0.0" }
      });

      const applied = await client.request("tools/call", {
        name: "state_blueprint_apply_actions",
        arguments: {
          actions: [
            { type: "create_flow", name: "Realtime MCP Flow" },
            { type: "upsert_state", id: "waiting", title: "Waiting", x: 96, y: 120 },
            { type: "upsert_state", id: "live_call", title: "Live call", x: 360, y: 120 },
            { type: "upsert_state_variable", stateId: "waiting", path: "handled", valueType: "boolean", value: false },
            { type: "upsert_data_wire", stateId: "waiting", id: "wire_realtime_status", sourcePath: "realtime.connected", role: "field", componentType: "text", label: "Realtime connected" },
            { type: "add_component", stateId: "waiting", component: { id: "realtime_status", type: "dataWire", wireId: "wire_realtime_status" } },
            {
              type: "upsert_transition",
              id: "call_incoming",
              from: "waiting",
              to: "live_call",
              label: "Incoming call",
              triggerType: "realtime",
              triggerEvent: "realtime.sip.call.incoming",
              condition: "events.realtime.sip.call.incoming.count > 0 && realtime.connected == true",
              set: {
                "states.waiting.handled": true
              }
            },
            { type: "set_initial", stateId: "waiting" }
          ]
        }
      });

      expect(applied.structuredContent.validation.ok).toBe(true);
      const stored = JSON.parse(fs.readFileSync(modelPath, "utf8")).model;
      expect(stored.realtime).toBeUndefined();
      expect(stored.states.find(state => state.id === "waiting").dataWires).toEqual([
        expect.objectContaining({ id: "wire_realtime_status", sourcePath: "realtime.connected" })
      ]);
      expect(stored.transitions.find(transition => transition.id === "call_incoming")).toEqual(expect.objectContaining({
        triggerType: "realtime",
        triggerEvent: "realtime.sip.call.incoming",
        condition: "events.realtime.sip.call.incoming.count > 0 && realtime.connected == true",
        set: {
          "states.waiting.handled": true
        }
      }));

      const replaced = await client.request("tools/call", {
        name: "state_blueprint_replace_model",
        arguments: {
          model: {
            ...stored,
            realtime: {
              events: [{
                name: "realtime.sip.call.incoming",
                label: "Should not persist"
              }]
            }
          }
        }
      });
      expect(replaced.structuredContent.validation.ok).toBe(true);
      const replacedStored = JSON.parse(fs.readFileSync(modelPath, "utf8")).model;
      expect(replacedStored.realtime).toBeUndefined();
      expect(replacedStored.transitions.find(transition => transition.id === "call_incoming").triggerType).toBe("realtime");

      const exported = await client.request("tools/call", {
        name: "state_blueprint_export_definition",
        arguments: {}
      });
      expect(exported.structuredContent.model.realtime).toBeUndefined();
      expect(exported.structuredContent.model.transitions.find(transition => transition.id === "call_incoming")).toMatchObject({
        triggerType: "realtime",
        triggerEvent: "realtime.sip.call.incoming"
      });

      const catalog = await client.request("tools/call", {
        name: "state_blueprint_action_catalog",
        arguments: {}
      });
      expect(JSON.stringify(catalog.structuredContent.actions)).toContain("triggerType=realtime");
    } finally {
      await client.close();
      try { fs.unlinkSync(modelPath); } catch (_) {}
    }
  });

  test("plans and applies natural-language prompts into contract-safe actions @smoke", async () => {
    const tempDir = path.join(process.cwd(), "tmp", "mcp-tests");
    fs.mkdirSync(tempDir, { recursive: true });
    const modelPath = path.join(tempDir, `prompt-workspace-${Date.now()}.json`);
    const client = createMcpClient(modelPath);

    try {
      await client.request("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "state-blueprint-mcp-test", version: "1.0.0" }
      });

      await client.request("tools/call", {
        name: "state_blueprint_apply_actions",
        arguments: {
          actions: [
            { type: "create_flow", name: "Prompt Flow" },
            { type: "upsert_state", id: "start", title: "Start", x: 96, y: 120 },
            { type: "set_initial", stateId: "start" }
          ]
        }
      });

      const planned = await client.request("tools/call", {
        name: "state_blueprint_plan_prompt",
        arguments: {
          prompt: "füge timer 10s hinzu und weiter zu Done",
          selectedStateId: "start"
        }
      });
      expect(planned.structuredContent.plan.intent).toBe("add_timer");
      expect(planned.structuredContent.plan.actions.map(action => action.type)).toEqual([
        "upsert_state_variable",
        "add_component",
        "upsert_state",
        "upsert_transition"
      ]);
      expect(planned.structuredContent.validation.ok).toBe(true);

      const appliedPrompt = await client.request("tools/call", {
        name: "state_blueprint_apply_prompt",
        arguments: {
          prompt: "füge timer 10s hinzu und weiter zu Done",
          selectedStateId: "start"
        }
      });
      expect(appliedPrompt.structuredContent.plan.intent).toBe("add_timer");
      expect(appliedPrompt.structuredContent.validation.ok).toBe(true);

      const stored = JSON.parse(fs.readFileSync(modelPath, "utf8"));
      const start = stored.model.states.find(state => state.id === "start");
      expect(start.data.timer.duration).toBe(10);
      expect(start.dataTypes.timer).toBe("object");
      expect(start.components).toEqual([
        expect.objectContaining({
          type: "daisy",
          variant: "countdown",
          dataPath: "states.start.timer"
        })
      ]);
      expect(stored.model.states.find(state => state.id === "done")).toEqual(expect.objectContaining({ title: "Done" }));
      expect(stored.model.transitions.find(transition => transition.id === "start_timer_done")).toEqual(expect.objectContaining({
        from: "start",
        to: "done",
        triggerType: "change",
        triggerEvent: "change.states.start.timer.finished",
        condition: "states.start.timer.finished == true"
      }));

      const childPrompt = await client.request("tools/call", {
        name: "state_blueprint_apply_prompt",
        arguments: {
          prompt: "erstelle inner state Schritt 1",
          selectedStateId: "start"
        }
      });
      expect(childPrompt.structuredContent.plan.intent).toBe("add_inner_state");
      expect(childPrompt.structuredContent.validation.ok).toBe(true);
      const nested = JSON.parse(fs.readFileSync(modelPath, "utf8")).model;
      expect(nested.states.find(state => state.id === "schritt_1")).toEqual(expect.objectContaining({
        parentId: "start",
        title: "Schritt 1"
      }));
      expect(nested.transitions.find(transition => transition.id === "boundary-flow:start:input")).toEqual(expect.objectContaining({
        to: "schritt_1",
        boundaryFlow: { parentId: "start", side: "input", stateId: "schritt_1" }
      }));
    } finally {
      await client.close();
      try { fs.unlinkSync(modelPath); } catch (_) {}
    }
  });

  test("plans and applies complete workflow prompts through MCP actions @smoke", async () => {
    const tempDir = path.join(process.cwd(), "tmp", "mcp-tests");
    fs.mkdirSync(tempDir, { recursive: true });
    const modelPath = path.join(tempDir, `workflow-workspace-${Date.now()}.json`);
    const client = createMcpClient(modelPath);

    try {
      await client.request("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "state-blueprint-mcp-test", version: "1.0.0" }
      });

      const planned = await client.request("tools/call", {
        name: "state_blueprint_plan_prompt",
        arguments: { prompt: "baue checkout workflow" }
      });
      expect(planned.structuredContent.plan.intent).toBe("create_workflow");
      expect(planned.structuredContent.plan.workflowTitles).toEqual(["Cart", "Shipping", "Payment", "Review", "Done"]);
      expect(planned.structuredContent.plan.actions.map(action => action.type)).toEqual([
        "create_flow",
        "upsert_state",
        "upsert_state",
        "upsert_state",
        "upsert_state",
        "upsert_state",
        "set_initial",
        "upsert_transition",
        "upsert_transition",
        "upsert_transition",
        "upsert_transition"
      ]);
      expect(planned.structuredContent.validation.ok).toBe(true);

      const applied = await client.request("tools/call", {
        name: "state_blueprint_apply_prompt",
        arguments: { prompt: "baue checkout workflow" }
      });
      expect(applied.structuredContent.plan.intent).toBe("create_workflow");
      expect(applied.structuredContent.validation.ok).toBe(true);

      const stored = JSON.parse(fs.readFileSync(modelPath, "utf8")).model;
      expect(stored.name).toBe("Checkout Flow");
      expect(stored.initial).toBe("cart");
      expect(stored.states.map(state => state.id)).toEqual(["cart", "shipping", "payment", "review", "done"]);
      expect(stored.transitions.map(transition => [transition.id, transition.from, transition.to, transition.triggerType])).toEqual([
        ["cart_to_shipping", "cart", "shipping", "button"],
        ["shipping_to_payment", "shipping", "payment", "button"],
        ["payment_to_review", "payment", "review", "button"],
        ["review_to_done", "review", "done", "button"]
      ]);
      expect(JSON.stringify(stored)).not.toMatch(/localState|stateStore|html/);
    } finally {
      await client.close();
      try { fs.unlinkSync(modelPath); } catch (_) {}
    }
  });

  test("plans API list fetches into the selected state's scoped bus branch @smoke", async () => {
    const tempDir = path.join(process.cwd(), "tmp", "mcp-tests");
    fs.mkdirSync(tempDir, { recursive: true });
    const modelPath = path.join(tempDir, `fetch-workspace-${Date.now()}.json`);
    const client = createMcpClient(modelPath);

    try {
      await client.request("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "state-blueprint-mcp-test", version: "1.0.0" }
      });

      await client.request("tools/call", {
        name: "state_blueprint_apply_actions",
        arguments: {
          actions: [
            { type: "create_flow", name: "Fetch Flow" },
            { type: "upsert_state", id: "start", title: "Start", x: 96, y: 120 },
            { type: "set_initial", stateId: "start" }
          ]
        }
      });

      const planned = await client.request("tools/call", {
        name: "state_blueprint_plan_prompt",
        arguments: {
          prompt: "lade API https://example.test/items als Liste",
          selectedStateId: "start"
        }
      });
      expect(planned.structuredContent.plan.actions).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "configure_fetch", stateId: "start", target: "states.start.fetch" }),
        expect.objectContaining({ type: "configure_repeat", stateId: "start", path: "states.start.fetch.data" }),
        expect.objectContaining({ type: "upsert_data_wire", stateId: "start", sourcePath: "states.start.fetch.data.title", scopePath: "states.start.fetch.data" })
      ]));

      const applied = await client.request("tools/call", {
        name: "state_blueprint_apply_prompt",
        arguments: {
          prompt: "lade API https://example.test/items als Liste",
          selectedStateId: "start"
        }
      });
      expect(applied.structuredContent.validation.ok).toBe(true);

      const stored = JSON.parse(fs.readFileSync(modelPath, "utf8")).model;
      const start = stored.states.find(state => state.id === "start");
      expect(start.dataSource).toMatchObject({
        url: "https://example.test/items",
        target: "states.start.fetch",
        select: ""
      });
      expect(start.repeat).toEqual({ path: "states.start.fetch.data", as: "item", index: "i", manual: true });
      expect(start.dataWires).toEqual([
        expect.objectContaining({
          sourcePath: "states.start.fetch.data.title",
          scopePath: "states.start.fetch.data",
          itemPath: "title"
        })
      ]);
      expect(JSON.stringify(stored)).not.toMatch(/"fetch\.data|localState|stateStore|html/);
    } finally {
      await client.close();
      try { fs.unlinkSync(modelPath); } catch (_) {}
    }
  });
});
