const fs = require("node:fs");
const vm = require("node:vm");
const { test, expect } = require("@playwright/test");
const { productContractResponse } = require("../server/product-contract");
const { BASIC_PRESET_IDS } = require("../server/preset-catalog");
const { compileRecording, validateReplayPackage } = require("../server/recorder");

function checkpoint(index) {
  return { image: "data:image/jpeg;base64,AA==", checkpoint: { url: `https://example.com/${index}`, title: `State ${index}`, fingerprint: `fingerprint-${index}` } };
}

function inlineScript(file, after = "") {
  const html = fs.readFileSync(file, "utf8");
  const start = html.indexOf("<script>", after ? html.indexOf(after) : 0) + 8;
  return html.slice(start, html.lastIndexOf("</script>"));
}

test.describe("focused release contracts", () => {
  test("public contract contains only one flow and exactly 13 basic presets @smoke", async ({ request }) => {
    const contract = productContractResponse();
    expect(contract.schema).toBe("flow/1");
    expect(contract.flow.recording.schema).toBe("website-recording/1");
    expect(contract.presetCategories).toHaveLength(1);
    expect(contract.presetCategories[0]).toMatchObject({ id: "basic", label: "Basics" });
    expect(contract.presets.map(item => item.id)).toEqual(BASIC_PRESET_IDS);
    for (const removed of ["presetPackages", "subscriptionPlans", "connectors", "datasets", "provider"]) expect(contract).not.toHaveProperty(removed);
    expect(Buffer.byteLength(JSON.stringify(contract))).toBeLessThan(40000);
    expect(await (await request.get("/contract")).json()).toEqual(contract);
  });

  test("restored focused product source is small, syntactically valid and legacy-free @smoke", () => {
    const source = fs.readFileSync("state.html", "utf8");
    expect(Buffer.byteLength(source)).toBeLessThan(100000);
    expect(source).toContain("App Recorder");
    expect(source).toContain("App Render");
    expect(source).toContain("zustand-project");
    expect(source).toContain("recorderFrame");
    for (const legacy of ["state-blueprint-mcp", "agent-widget", "event-catalog", "preset-library", "stripe/checkout", "wss://", "127.0.0.1:8799"]) expect(source).not.toContain(legacy);
    expect(() => new vm.Script(inlineScript("state.html", "disable-sw"))).not.toThrow();
    expect(() => new vm.Script(inlineScript("recorder.html"))).not.toThrow();
  });

  test("recording compiler keeps the exact reversible action-transition-state chain @smoke", () => {
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
    expect(compiled.recording.steps.map(step => step.transitionId)).toEqual(["recorded_t_001", "recorded_t_002"]);
    expect(() => validateReplayPackage(compiled.recording)).not.toThrow();
  });

  test("durable replay package rejects broken or invented state changes @smoke", () => {
    const broken = {
      schema: "website-recording/1",
      startUrl: "https://example.com",
      initialStateId: "recorded_001",
      initialCheckpoint: { fingerprint: "start" },
      snapshotCount: 2,
      steps: [{ id: "step_001", transitionId: "t_1", fromStateId: "invented", toStateId: "recorded_002", action: { type: "click" }, checkpoint: { fingerprint: "done" } }]
    };
    expect(() => validateReplayPackage(broken)).toThrow(/lückenlose Kette/);
  });

  test("embedded recorder is screenshot-controlled and never raw-iframes the target page @smoke", async ({ page }) => {
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
