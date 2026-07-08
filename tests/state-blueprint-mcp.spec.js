const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { test, expect } = require("@playwright/test");

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
  test("exposes standard MCP tools and applies dependency-ordered app actions without hidden state @smoke", async () => {
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
      expect(toolNames).toContain("state_blueprint_plan_prompt");
      expect(toolNames).toContain("state_blueprint_apply_prompt");
      expect(toolNames).toContain("state_blueprint_validate");

      const applied = await client.request("tools/call", {
        name: "state_blueprint_apply_actions",
        arguments: {
          actions: [
            { type: "create_flow", name: "MCP Checkout" },
            { type: "upsert_state", id: "start", title: "Start", x: 96, y: 120 },
            { type: "upsert_state_variable", stateId: "start", path: "email", valueType: "email", value: "" },
            { type: "upsert_data_wire", stateId: "start", id: "wire_email", sourcePath: "email", role: "field", componentType: "text", label: "Email" },
            { type: "add_component", stateId: "start", component: { id: "email_render", type: "dataWire", wireId: "wire_email" } },
            { type: "upsert_transition", id: "submit", from: "start", to: "done", label: "Submit", condition: "email", set: { submitted: true } },
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
      expect(model.states.find(state => state.id === "start").dataTypes["states.start.email"]).toBe("email");
      expect(model.states.find(state => state.id === "start").data["states.start"].email).toBe("");
      expect(model.states.find(state => state.id === "start").data.email).toBeUndefined();
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
      expect(JSON.stringify(model)).not.toMatch(/localState|stateStore|html/);

      const validation = await client.request("tools/call", { name: "state_blueprint_validate", arguments: {} });
      expect(validation.structuredContent.ok).toBe(true);

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
      expect(start.data["states.start"].timer.duration).toBe(10);
      expect(start.dataTypes["states.start.timer"]).toBe("object");
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
