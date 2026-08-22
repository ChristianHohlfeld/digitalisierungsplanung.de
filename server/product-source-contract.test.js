"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

test("state.html is the focused input/output product shell", () => {
  const state = read("state.html");
  assert.ok(state.length > 8_000, "state.html must contain the actual product shell");
  assert.match(state, /<title>Zustand<\/title>/i);
  assert.match(state, /id="tabRecorder"/);
  assert.match(state, /App Recorder/);
  assert.match(state, /Input/);
  assert.match(state, /id="tabRender"/);
  assert.match(state, /App Render/);
  assert.match(state, /Output/);
  assert.match(state, /Desktop Recorder/);
  assert.match(state, /recorder-extension\/editor-bridge\.js/);
  assert.match(state, /state-app\.js/);
  assert.doesNotMatch(state, /127\.0\.0\.1:8799|npm run recorder:agent|Local Recorder Agent/i);
  assert.match(state, /id="btnExport"/);
  assert.doesNotMatch(state, /location\.href\s*=\s*["']\/recorder\.html/);
});

test("state app owns the focused state and transition inspector", () => {
  const app = read("state-app.js");
  assert.doesNotThrow(() => new vm.Script(app));
  assert.match(app, /kind:\s*"zustand-project"/);
  assert.match(app, /Filter \/ Regeln/);
  assert.match(app, /Trigger/);
  assert.match(app, /Lauscht auf/);
  assert.match(app, /Echter Browser-Replay/);
  assert.match(app, /Aufnahme auf Desktop verfügbar/);
  assert.doesNotMatch(app, /Trigger-Regel|Match-Feld|Technische Bedingung/i);
  assert.doesNotMatch(app, /127\.0\.0\.1:8799|npm run recorder:agent|Local Recorder Agent/i);
});

test("legacy recorder route forwards into the editor recorder tab", () => {
  const recorder = read("recorder.html");
  assert.match(recorder, /state\.html\?tab=recorder/);
  assert.doesNotMatch(recorder, /Text in das fokussierte Website-Feld schreiben/);
  assert.doesNotMatch(recorder, /Text senden/);
});

test("service-worker cleanup stays single-purpose and no longer patches inspector UI", () => {
  const source = read("disable-sw.js");
  assert.match(source, /serviceWorker/);
  assert.match(source, /caches/);
  assert.doesNotMatch(source, /RuleBuilder|pCond|Trigger-Regel|MutationObserver|FOCUSED_PRESET/i);
});

test("product has no local-agent or MCP runtime entrypoint", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["recorder:agent"], undefined);
  assert.equal(pkg.scripts["recorder:native"], undefined);
  assert.equal(pkg.scripts["recorder:local"], undefined);
  assert.equal(pkg.scripts["mcp:state"], undefined);
  assert.equal(fs.existsSync(path.join(root, "server/native-recorder-agent.js")), false);
  assert.equal(fs.existsSync(path.join(root, "server/native-browser-recorder.js")), false);
});
