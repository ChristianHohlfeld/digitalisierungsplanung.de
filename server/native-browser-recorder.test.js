"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createRecording,
  normalizeAction,
  normalizeUrl,
  targetRecorderScript
} = require("./native-browser-recorder");

test("native browser recorder exposes real browser event capture", () => {
  const script = targetRecorderScript();
  assert.match(script, /document\.addEventListener\("click"/);
  assert.match(script, /document\.addEventListener\("input"/);
  assert.match(script, /document\.addEventListener\("change"/);
  assert.match(script, /document\.addEventListener\("keydown"/);
  assert.match(script, /window\.addEventListener\("scroll"/);
  assert.match(script, /__stateBlueprintRecord/);
});

test("native browser recorder keeps protected input values out of replay data", () => {
  const action = normalizeAction({ type: "input", value: "secret", redacted: true }, 1, Date.now(), Date.now());
  assert.equal(action.type, "input");
  assert.equal(action.value, undefined);
  assert.equal(action.redacted, true);
});

test("native browser recording package starts with a real URL and viewport", () => {
  const url = normalizeUrl("https://wob-app15.wobak.de/de/cockpit");
  const recording = createRecording(url, { width: 1200, height: 800 });
  assert.equal(recording.startUrl, "https://wob-app15.wobak.de/de/cockpit");
  assert.deepEqual(recording.viewport, { width: 1200, height: 800 });
  assert.deepEqual(recording.actions, []);
  assert.deepEqual(recording.snapshots, []);
});

test("native browser recorder rejects non-browser schemes", () => {
  assert.throws(() => normalizeUrl("file:///etc/passwd"), /Only http\/https/);
});
