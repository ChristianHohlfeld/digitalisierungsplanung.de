"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

test("state.html is the focused product surface with input and output tabs", () => {
  const state = read("state.html");
  assert.ok(state.length > 20_000, "state.html must contain the actual product editor");
  assert.match(state, /<title>Zustand<\/title>/i);
  assert.match(state, /id="tabRecorder"/);
  assert.match(state, /App Recorder/);
  assert.match(state, /Input/);
  assert.match(state, /id="tabRender"/);
  assert.match(state, /App Render/);
  assert.match(state, /Output/);
  assert.match(state, /127\.0\.0\.1:8799/);
  assert.match(state, /zustand-project/);
  assert.match(state, /Filter \/ Regeln/);
  assert.match(state, /Trigger-Kontext/);
  assert.match(state, /Echter Replay/);
  assert.match(state, /id="btnExport"/);
  assert.doesNotMatch(state, /location\.href\s*=\s*["']\/recorder\.html/);
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

test("product scripts expose the native CLI and the local editor agent", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["recorder:native"], "node server/native-browser-recorder.js");
  assert.equal(pkg.scripts["recorder:agent"], "node server/native-recorder-agent.js");
  assert.equal(pkg.scripts["recorder:local"], undefined);
  assert.equal(pkg.scripts["mcp:state"], undefined);
  assert.equal(fs.existsSync(path.join(root, "server/native-recorder-agent.js")), true);
});
