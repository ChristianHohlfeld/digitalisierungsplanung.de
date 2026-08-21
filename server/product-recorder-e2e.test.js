"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");
const { createAgent, createHttpServer } = require("./native-recorder-agent");

const root = path.resolve(__dirname, "..");

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

async function waitFor(predicate, timeoutMs = 15000, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for condition");
}

test("editor records a real browser path into a visual project and replays it", { timeout: 60000 }, async () => {
  let doneHits = 0;
  const doneQueries = [];

  const targetServer = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    if (url.pathname === "/target") {
      res.end(`<!doctype html><html><body>
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
      res.end("<!doctype html><html><body><h1 id=done>Fertig</h1></body></html>");
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });

  const editorServer = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    let file = null;
    if (url.pathname === "/state.html" || url.pathname === "/") file = "state.html";
    if (url.pathname === "/disable-sw.js") file = "disable-sw.js";
    if (!file) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("content-type", file.endsWith(".js") ? "application/javascript; charset=utf-8" : "text/html; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(fs.readFileSync(path.join(root, file)));
  });

  const agent = createAgent({
    launch: options => chromium.launch({ ...options, headless: true, args: [...(options.args || []), "--no-sandbox"] })
  });
  const agentServer = createHttpServer(agent);
  let editorBrowser = null;

  try {
    const targetPort = await listen(targetServer);
    const editorPort = await listen(editorServer);
    await listen(agentServer, 8799);

    editorBrowser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const editorPage = await editorBrowser.newPage();
    await editorPage.goto(`http://127.0.0.1:${editorPort}/state.html?tab=recorder`, { waitUntil: "domcontentloaded" });

    await editorPage.waitForFunction(() => document.getElementById("agentStatus")?.textContent.includes("bereit"), null, { timeout: 10000 });
    await editorPage.locator("#recordUrl").fill(`http://127.0.0.1:${targetPort}/target`);
    await editorPage.locator("#recordStart").click();

    await waitFor(() => [...agent.recordings.values()][0]?.page, 10000);
    const session = [...agent.recordings.values()][0];
    const targetPage = session.page;
    assert.ok(targetPage, "native recorder must expose the real target page");

    await targetPage.locator("#email").fill("qa@example.com");
    await targetPage.locator("#accept").check();
    await targetPage.locator("#go").click();
    await targetPage.waitForURL(/\/done\?/);
    await targetPage.waitForTimeout(650);

    assert.equal(doneHits, 1, "recording must execute the target path once");
    assert.deepEqual(doneQueries[0], { email: "qa@example.com", accept: "true" });

    await editorPage.locator("#recordFinish").click();
    await editorPage.waitForFunction(() => document.getElementById("tabRender")?.classList.contains("active"), null, { timeout: 15000 });

    const chartSummary = await editorPage.locator("#chartSummary").textContent();
    assert.match(chartSummary || "", /States .* Transitions/);
    assert.ok(await editorPage.locator(".node").count() >= 3, "recorded path must become visible chart states");
    assert.ok(await editorPage.locator(".edge-hit").count() >= 1, "recorded path must become chart transitions");

    await editorPage.evaluate(() => {
      document.querySelector(".edge-hit")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const inspector = await editorPage.locator("#inspector").textContent();
    assert.match(inspector || "", /Lauscht auf/);
    assert.match(inspector || "", /Filter \/ Regeln/);
    assert.doesNotMatch(inspector || "", /Trigger-Regel|Match-Feld|Technische Bedingung/);

    const beforeReplay = doneHits;
    await editorPage.locator("#replayStart").click();
    await waitFor(() => doneHits >= beforeReplay + 1, 30000, 100);
    await editorPage.waitForFunction(() => /finished/.test(document.getElementById("replayStatus")?.textContent || ""), null, { timeout: 30000 });

    assert.equal(doneHits, 2, "real replay must execute the same browser path a second time");
    assert.deepEqual(doneQueries[1], { email: "qa@example.com", accept: "true" });
  } finally {
    await editorBrowser?.close().catch(() => {});
    for (const id of [...agent.recordings.keys()]) await agent.cancelRecording(id).catch(() => {});
    for (const id of [...agent.replays.keys()]) await agent.cancelReplay(id).catch(() => {});
    await close(agentServer);
    await close(editorServer);
    await close(targetServer);
  }
});
