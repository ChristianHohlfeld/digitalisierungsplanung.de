const fs = require("node:fs");
const { test, expect } = require("@playwright/test");

async function openTool(page, path = "/state.html?recorderOrigin=http%3A%2F%2F127.0.0.1%3A8124") {
  await page.goto(path);
  await expect(page.locator(".node")).toHaveCount(2);
  await expect(page.locator("#chartSummary")).toHaveText("2 States · 1 Transitions");
}

function sampleRecordingResult() {
  const image = "data:image/jpeg;base64,/9j/2Q==";
  return {
    type: "STATE_BLUEPRINT_EXTERNAL_RECORDING_RESULT",
    sessionId: "11111111-1111-1111-1111-111111111111",
    definition: {
      model: {
        name: "Auftragsfreigabe",
        states: [
          { id: "recorded_001", title: "Entwurf", data: { source_url: "https://example.com/start" }, components: [{ type: "image", url: image }] },
          { id: "recorded_002", title: "Freigegeben", data: { source_url: "https://example.com/done", recorded_action: "Klick: Freigeben" }, components: [{ type: "image", url: image }] }
        ]
      }
    },
    recording: {
      schema: "website-recording/1",
      id: "recording-1",
      startUrl: "https://example.com/start",
      initialStateId: "recorded_001",
      initialCheckpoint: { url: "https://example.com/start", fingerprint: "start" },
      snapshotCount: 2,
      steps: [{
        id: "step_001",
        transitionId: "recorded_t_001",
        fromStateId: "recorded_001",
        toStateId: "recorded_002",
        delayMs: 100,
        action: { type: "click", x: 20, y: 20, locator: { role: "button", name: "Freigeben", css: "#approve", label: "Freigeben" } },
        checkpoint: { url: "https://example.com/done", fingerprint: "done" }
      }]
    }
  };
}

async function sendFromRecorderFrame(page, payload) {
  await expect(page.locator("#recorderFrame")).toHaveClass(/active/);
  await expect.poll(() => page.frames().some(item => item !== page.mainFrame() && /recorder\.html/.test(item.url()))).toBe(true);
  const frame = page.frames().find(item => item !== page.mainFrame() && /recorder\.html/.test(item.url()));
  if (!frame) throw new Error("recorder frame missing");
  await frame.evaluate(value => parent.postMessage(value, location.origin), payload);
}

test.describe("focused Zustand product UI", () => {
  test("restores the focused Recorder/Render surface and its established controls @smoke", async ({ page }) => {
    await openTool(page);
    await expect(page.locator(".brand")).toHaveText("ZUSTAND");
    await expect(page.locator(".authoring")).toBeVisible();
    await expect(page.locator(".graph-viewport")).toBeVisible();
    await expect(page.locator(".inspector")).toBeVisible();
    await expect(page.locator(".tab")).toHaveText(["App Recorder · Input", "App Render · Output"]);
    for (const name of ["Neu", "Projekt öffnen", "Projekt JSON", "App exportieren", "+ State", "Aufnahme starten", "Fertig → Projekt", "Abbrechen"]) {
      await expect(page.getByText(name, { exact: true })).toBeVisible();
    }
  });

  test("manual process states remain editable and previewable @smoke", async ({ page }) => {
    await openTool(page);
    await page.locator('[data-id="state_001"]').click();
    await expect(page.locator("#stateTitle")).toHaveValue("Start");
    await page.locator("#stateTitle").fill("Anfrage");
    await expect(page.locator('[data-id="state_001"] .node-head')).toHaveText("Anfrage");
    await page.locator("#tabRender").click();
    await expect(page.locator("#appFrame")).toContainText("Anfrage");
    await page.locator("#nextState").click();
    await expect(page.locator("#appFrame")).toContainText("Ziel");
  });

  test("desktop pointer drag keeps snapped state movement and the chart connection @smoke", async ({ page }) => {
    await openTool(page);
    const node = page.locator('[data-id="state_002"]');
    const before = await node.evaluate(element => ({ left: parseFloat(element.style.left), top: parseFloat(element.style.top) }));
    const box = await node.locator(".node-head").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 91, box.y + box.height / 2 + 39, { steps: 4 });
    await page.mouse.up();
    const after = await node.evaluate(element => ({ left: parseFloat(element.style.left), top: parseFloat(element.style.top) }));
    expect(after).not.toEqual(before);
    expect(after.left % 12).toBe(0);
    expect(after.top % 12).toBe(0);
    await expect(page.locator("#edges line")).not.toHaveCount(0);
  });

  test("touch selects and drags states without losing the mobile controls @smoke", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: "http://127.0.0.1:8124", viewport: { width: 390, height: 820 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await openTool(page);
    const node = page.locator('[data-id="state_002"]');
    await node.scrollIntoViewIfNeeded();
    const head = node.locator(".node-head");
    const box = await head.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(node).toHaveClass(/selected/);
    const before = await node.evaluate(element => parseFloat(element.style.left));
    const cdp = await context.newCDPSession(page);
    const start = { x: box.x + 30, y: box.y + 20 };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x + 64, y: start.y + 24 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => node.evaluate(element => parseFloat(element.style.left))).not.toBe(before);
    await expect(page.locator("#tabRecorder")).toBeVisible();
    await expect(page.locator("#tabRender")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await context.close();
  });

  test("state and transition inspector keep simple triggers, listeners and rules @smoke", async ({ page }) => {
    await openTool(page);
    await page.locator('[data-id="state_001"]').click();
    await page.locator("#stateTrigger").selectOption("event");
    await page.locator("#stateEvent").fill("order.approved");
    await page.locator(".edge-hit").dispatchEvent("click");
    await expect(page.locator("#listenerType")).toHaveValue("event");
    await page.locator("#listenerEvent").fill("order.approved");
    await page.locator("#addRule").click();
    await expect(page.locator(".rule-row")).toHaveCount(1);
    await page.locator("#ruleOp_0").selectOption("truthy");
    await expect(page.locator("#ruleValue_0")).toBeDisabled();
  });

  test("new states, project JSON and standalone app export stay functional @smoke", async ({ page }) => {
    await openTool(page);
    await page.locator("#btnAddState").click();
    await expect(page.locator(".node")).toHaveCount(3);
    const projectDownload = page.waitForEvent("download");
    await page.locator("#btnProjectExport").click();
    const projectFile = await (await projectDownload).path();
    const project = JSON.parse(fs.readFileSync(projectFile, "utf8"));
    expect(project.kind).toBe("zustand-project");
    expect(project.states).toHaveLength(3);
    const appDownload = page.waitForEvent("download");
    await page.locator("#btnExport").click();
    const appFile = await (await appDownload).path();
    const html = fs.readFileSync(appFile, "utf8");
    expect(html).toContain("const project=");
    expect(html).toContain("Neuer State");
    expect(html).not.toContain("serviceWorker.register");
  });

  test("website recording stays inside the Recorder tab and never opens a popup @smoke", async ({ page, context }) => {
    await page.route("**/healthz", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, recorderReady: true }) }));
    await openTool(page);
    const pages = context.pages().length;
    await page.locator("#recordUrl").fill("https://example.com/process");
    await page.locator("#recordStart").click();
    await expect(page.locator("#recorderFrame")).toHaveClass(/active/);
    await expect(page.locator("#recorderFrame")).toHaveAttribute("src", /recorder\.html.*embedded=1/);
    expect(context.pages()).toHaveLength(pages);
  });

  test("recording import creates exactly one state per checkpoint and one transition per action @smoke", async ({ page }) => {
    await page.route("**/healthz", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, recorderReady: true }) }));
    await openTool(page);
    await page.locator("#recordUrl").fill("https://example.com/process");
    await page.locator("#recordStart").click();
    await sendFromRecorderFrame(page, sampleRecordingResult());
    await expect(page.locator("#projectName")).toHaveValue("Auftragsfreigabe");
    await expect(page.locator(".node")).toHaveCount(2);
    await expect(page.locator(".edge-hit")).toHaveCount(1);
    await expect(page.locator("#tabRender")).toHaveClass(/active/);
    await expect(page.locator('[data-id="state_001"] .node-head')).toHaveText("Entwurf");
    await expect(page.locator('[data-id="state_002"] .node-head')).toHaveText("Freigegeben");
  });

  test("verified replay messages follow the exact recorded target state @smoke", async ({ page }) => {
    await page.route("**/healthz", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, recorderReady: true }) }));
    await openTool(page);
    await page.locator("#recordUrl").fill("https://example.com/process");
    await page.locator("#recordStart").click();
    await sendFromRecorderFrame(page, sampleRecordingResult());
    await sendFromRecorderFrame(page, { type: "STATE_BLUEPRINT_REPLAY_STATE", stateId: "recorded_002", transitionId: "recorded_t_001", stepId: "step_001", verified: true, done: true });
    await expect(page.locator('[data-id="state_002"]')).toHaveClass(/selected/);
    await expect(page.locator("#replayStatus")).toHaveText("Fertig");
  });
});
