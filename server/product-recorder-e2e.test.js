"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const extensionPath = path.join(root, "recorder-extension");

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise(resolve => server.close(() => resolve()));
}

async function waitFor(predicate, timeoutMs = 20000, intervalMs = 80) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw lastError || new Error("Timed out waiting for condition");
}

async function startVirtualDisplay() {
  if (process.platform !== "linux" || process.env.DISPLAY) return null;
  process.env.DISPLAY = `:${90 + Math.floor(Math.random() * 8)}`;
  const display = spawn("Xvfb", [process.env.DISPLAY, "-screen", "0", "1440x1000x24", "-ac", "-nolisten", "tcp"], { stdio: "ignore" });
  await new Promise(resolve => setTimeout(resolve, 500));
  if (display.exitCode !== null) throw new Error("Xvfb could not start for extension E2E");
  return display;
}

function serveEditor(req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const map = new Map([
    ["/", "state.html"],
    ["/state.html", "state.html"],
    ["/state-app.js", "state-app.js"],
    ["/disable-sw.js", "disable-sw.js"],
    ["/recorder-extension/editor-bridge.js", "recorder-extension/editor-bridge.js"]
  ]);
  const file = map.get(url.pathname);
  if (!file) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }
  res.setHeader("content-type", file.endsWith(".js") ? "application/javascript; charset=utf-8" : "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(fs.readFileSync(path.join(root, file)));
}

test("browser extension records a real path into the chart and replays it", { timeout: 90000 }, async () => {
  let doneHits = 0;
  const doneQueries = [];
  const targetServer = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    if (url.pathname === "/target") {
      res.end(`<!doctype html><html><head><title>Recorder Test</title></head><body style="min-height:1600px">
        <label>E-Mail <input id="email" name="email" type="email"></label>
        <label>Freigabe <input id="accept" name="accept" type="checkbox"></label>
        <button id="go" type="button">Weiter</button>
        <script>
          document.getElementById("go").addEventListener("click", () => {
            const email = document.getElementById("email").value;
            const accept = document.getElementById("accept").checked;
            location.href = "/done?email=" + encodeURIComponent(email) + "&accept=" + accept;
          });
        </script>
      </body></html>`);
      return;
    }
    if (url.pathname === "/done") {
      doneHits += 1;
      doneQueries.push({ email: url.searchParams.get("email"), accept: url.searchParams.get("accept") });
      res.end("<!doctype html><html><head><title>Fertig</title></head><body><h1 id=done>Fertig</h1></body></html>");
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  const editorServer = http.createServer(serveEditor);

  let context = null;
  let display = null;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "zustand-extension-e2e-"));

  try {
    const targetPort = await listen(targetServer);
    const editorPort = await listen(editorServer);
    display = await startVirtualDisplay();

    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      viewport: { width: 1280, height: 860 },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--no-sandbox",
        "--disable-dev-shm-usage"
      ]
    });

    await waitFor(async () => context.serviceWorkers().length > 0, 15000);
    const editorPage = await context.newPage();
    await editorPage.goto(`http://127.0.0.1:${editorPort}/state.html?tab=recorder`, { waitUntil: "domcontentloaded" });
    await editorPage.waitForFunction(() => document.getElementById("recorderStatus")?.textContent.includes("bereit"), null, { timeout: 15000 });

    const startUrl = `http://127.0.0.1:${targetPort}/target`;
    await editorPage.locator("#recordUrl").fill(startUrl);
    await editorPage.locator("#recordStart").click();

    const targetPage = await waitFor(() => context.pages().find(page => page.url().startsWith(startUrl)), 15000);
    await targetPage.waitForLoadState("domcontentloaded");
    await targetPage.locator("#email").fill("qa@example.com");
    await targetPage.locator("#accept").check();
    await targetPage.evaluate(() => window.scrollTo(0, 380));
    await targetPage.waitForTimeout(350);
    await targetPage.locator("#go").click();
    await targetPage.waitForURL(/\/done\?/);
    await targetPage.waitForTimeout(700);

    assert.equal(doneHits, 1, "recording must execute the target path once");
    assert.deepEqual(doneQueries[0], { email: "qa@example.com", accept: "true" });

    await editorPage.bringToFront();
    await editorPage.waitForFunction(() => Number(document.getElementById("recordActions")?.textContent || 0) >= 3, null, { timeout: 15000 });
    await editorPage.locator("#recordFinish").click();
    await editorPage.waitForFunction(() => document.getElementById("tabRender")?.classList.contains("active"), null, { timeout: 15000 });

    const downloadPromise = editorPage.waitForEvent("download");
    await editorPage.locator("#btnProjectExport").click();
    const download = await downloadPromise;
    const projectPath = await download.path();
    assert.ok(projectPath, "project export must be downloadable");
    const exported = JSON.parse(fs.readFileSync(projectPath, "utf8"));
    assert.equal(exported.kind, "zustand-project");
    assert.ok(exported.states.length === exported.recording.actions.length + 1, "actions are the truth for visible states");
    assert.ok(exported.recording.actions.some(action => action.type === "input" && action.selector === "#email" && action.value === "qa@example.com"), "email value must be recorded");
    assert.ok(exported.recording.actions.some(action => action.type === "input" && action.selector === "#accept" && action.checked === true), "checkbox state must be recorded");
    assert.ok(exported.recording.actions.some(action => action.type === "click" && action.selector === "#go"), "navigation click must be recorded");
    assert.ok(exported.recording.actions.some(action => action.type === "scroll"), "scroll must be recorded");

    assert.equal(await editorPage.locator(".node").count(), exported.states.length);
    assert.equal(await editorPage.locator(".edge-hit").count(), exported.transitions.length);
    await editorPage.evaluate(() => document.querySelector(".edge-hit")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const inspector = await editorPage.locator("#inspector").textContent();
    assert.match(inspector || "", /Lauscht auf/);
    assert.match(inspector || "", /Filter \/ Regeln/);
    assert.doesNotMatch(inspector || "", /Trigger-Regel|Match-Feld|Technische Bedingung/);

    const beforeReplay = doneHits;
    await editorPage.locator("#replaySpeed").selectOption("4");
    await editorPage.locator("#replayStart").click();
    await waitFor(() => doneHits >= beforeReplay + 1, 30000, 100);
    await editorPage.waitForFunction(() => /Fertig/.test(document.getElementById("replayStatus")?.textContent || ""), null, { timeout: 30000 });
    assert.deepEqual(doneQueries[beforeReplay], { email: "qa@example.com", accept: "true" });
  } finally {
    await context?.close().catch(() => {});
    display?.kill("SIGTERM");
    await close(editorServer);
    await close(targetServer);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
