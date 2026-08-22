const fs = require("node:fs");
const vm = require("node:vm");
const { test, expect } = require("@playwright/test");
const { productContractResponse } = require("../server/product-contract");
const { BASIC_PRESET_IDS } = require("../server/preset-catalog");
const { compileRecording, validateReplayPackage } = require("../server/recorder");

function checkpoint(index) {
  return {
    image: "data:image/jpeg;base64,AA==",
    checkpoint: { url: `https://example.com/${index}`, title: `State ${index}`, fingerprint: `fingerprint-${index}` }
  };
}

function inlineScript(file, after = "") {
  const html = fs.readFileSync(file, "utf8");
  const start = html.indexOf("<script>", after ? html.indexOf(after) : 0) + 8;
  return html.slice(start, html.lastIndexOf("</script>"));
}

test.describe("release contracts", () => {
  test("public contract serves the full editor shape with exactly 13 basic presets @smoke", async ({ request }) => {
    const contract = productContractResponse();
    expect(contract.schema).toBe("flow/1");
    expect(contract.flow.project).toEqual({ kind: "state-blueprint-definition", schemaVersion: 2 });
    expect(contract.flow.required).toEqual({
      project: ["kind", "schemaVersion", "app", "savedAt", "model"],
      model: ["version", "initial", "states", "transitions"],
      state: ["id", "title", "x", "y"],
      transition: ["id", "from", "to", "label"]
    });
    expect(contract.flow.recording.schema).toBe("website-recording/1");
    expect(contract.presetCategories).toEqual([{ id: "basic", label: "Basics" }]);
    expect(contract.presets.map(item => item.id)).toEqual(BASIC_PRESET_IDS);
    expect(contract.presets).toHaveLength(13);
    for (const preset of contract.presets) {
      expect(preset).toEqual(expect.objectContaining({
        id: expect.any(String),
        title: expect.any(String),
        categoryId: "basic",
        rootStateId: expect.any(String),
        components: expect.any(Array),
        data: expect.any(Object),
        dataTypes: expect.any(Object)
      }));
      expect(preset.components.length).toBeGreaterThan(0);
    }
    expect(contract.valueTypes.map(item => item.id)).toEqual([
      "text", "number", "boolean", "email", "password", "date", "url", "list", "object"
    ]);
    expect(contract.triggerTypes.map(item => item.id)).toEqual([
      "button", "change", "event", "api", "timer", "auto", "flow"
    ]);
    for (const removed of ["presetPackages", "subscriptionPlans", "connectors", "datasets", "provider"]) {
      expect(contract).not.toHaveProperty(removed);
    }
    expect(await (await request.get("/contract")).json()).toEqual(contract);
  });

  test("full editor source keeps the established layout and input subsystem @smoke", () => {
    const source = fs.readFileSync("state.html", "utf8");
    for (const marker of [
      'class="workspace mobile-canvas-active"',
      'id="stateInspector"',
      'class="state-explorer"',
      'class="preview"',
      'id="map"',
      'id="world"',
      "const TOUCH_PINCH_ZOOM_RESPONSE = 1.45;",
      "const TOUCH_DOUBLE_TAP_MS = 650;",
      "const TOUCH_NODE_DRAG_HOLD_MS = 220;",
      "const DESKTOP_NODE_DOUBLE_CLICK_MS = 420;",
      "let boxSelecting = null;",
      'data-mobile-view="presets"',
      'data-mobile-view="canvas"',
      'data-mobile-view="edit"',
      'data-mobile-view="app"'
    ]) {
      expect(source, `missing editor contract marker: ${marker}`).toContain(marker);
    }
    for (const compactReplacement of ["graph-viewport", "tabRecorder", "tabRender", "chartSummary"]) {
      expect(source).not.toContain(compactReplacement);
    }
    expect(() => new vm.Script(inlineScript("recorder.html"))).not.toThrow();
  });

  test("recording compiler keeps the exact reversible action-transition-state chain @smoke", async ({ page }) => {
    const compiled = compileRecording({
      id: "recording-1",
      startUrl: "https://example.com/0",
      createdAt: "2026-08-22T00:00:00Z",
      viewport: { width: 1120, height: 720 },
      actions: [
        { type: "click", delayMs: 350, locator: { role: "button", name: "Weiter" } },
        { type: "input", delayMs: 220, locator: { role: "textbox", name: "Name" }, value: "Ada" }
      ],
      snapshots: [checkpoint(0), checkpoint(1), checkpoint(2)]
    });
    expect(compiled.definition.model.states).toHaveLength(3);
    expect(compiled.definition.model.transitions).toHaveLength(2);
    expect(compiled.recording.steps).toHaveLength(2);
    expect(compiled.recording.snapshotCount).toBe(3);
    expect(compiled.recording.initialCheckpoint.fingerprint).toBe("fingerprint-0");
    expect(compiled.definition.camera).toEqual({ x: 0, y: 0, scale: 1 });
    expect(compiled.recording.steps.map(step => step.transitionId)).toEqual(["recorded_t_001", "recorded_t_002"]);
    expect(() => validateReplayPackage(compiled.recording)).not.toThrow();
    await page.goto("/state.html");
    const validated = await page.evaluate(definition => validateBlueprintDefinition(definition), compiled.definition);
    expect(validated.kind).toBe("state-blueprint-definition");
    expect(validated.model.states).toHaveLength(3);
  });

  test("durable replay package rejects broken or invented state changes @smoke", () => {
    const broken = {
      schema: "website-recording/1",
      startUrl: "https://example.com",
      initialStateId: "recorded_001",
      initialCheckpoint: { fingerprint: "start" },
      snapshotCount: 2,
      steps: [{
        id: "step_001",
        transitionId: "t_1",
        fromStateId: "invented",
        toStateId: "recorded_002",
        action: { type: "click" },
        checkpoint: { fingerprint: "done" }
      }]
    };
    expect(() => validateReplayPackage(broken)).toThrow(/lückenlose Kette/);
  });

  test("standalone recorder is screenshot-controlled and never raw-iframes the target page @smoke", async ({ page }) => {
    await page.goto("/recorder.html?embedded=1&parentOrigin=http%3A%2F%2F127.0.0.1%3A8124");
    await expect(page.locator("body")).toHaveClass(/embedded/);
    await expect(page.locator("#viewport")).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
    const source = fs.readFileSync("recorder.html", "utf8");
    expect(source).toContain("ZUSTAND_RECORDER_COMMAND");
    expect(source).toContain("STATE_BLUEPRINT_RECORDER_PROGRESS");
    expect(source).toContain("website-recording/1");
  });
});
