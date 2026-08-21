"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");

function read(name) {
  return fs.readFileSync(path.join(root, name), "utf8");
}

test("external recording renders inside the real state inspector without polluting the model", () => {
  const loader = read("disable-sw.js");
  const inspector = read("state-recorder-inspector.js");

  assert.match(loader, /state-recorder-inspector\.js/);
  assert.match(loader, /state\.html/);
  assert.match(inspector, /stateInspectorBody/);
  assert.match(inspector, /pFlowCard/);
  assert.match(inspector, /pRecordedReplayCard/);
  assert.match(inspector, /Aufgezeichneter Ablauf/);
  assert.match(inspector, /Replay ab Start/);
  assert.match(inspector, /Replay exportieren/);
  assert.match(inspector, /\.externalRecording/);
  assert.match(inspector, /state-blueprint-recording-package/);
  assert.match(inspector, /\/recorder\/sessions\//);
  assert.doesNotMatch(inspector, /model\.recording/);
  assert.doesNotMatch(inspector, /position\s*:\s*(?:fixed|absolute)/);
});

test("recorder import carries the live replay session only in the sidecar package", () => {
  const html = read("recorder.html");

  assert.match(html, /kind:\s*"state-blueprint-recording-package"/);
  assert.match(html, /sessionId:\s*session/);
  assert.match(html, /STORAGE_KEY \+ "\.externalRecording"/);
  assert.match(html, /JSON\.stringify\(\{ model: definition\.model, recording \}\)/);
  assert.doesNotMatch(html, /definition\.model\.recording/);
});
