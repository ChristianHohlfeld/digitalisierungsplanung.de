"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { actionSecretKey, normalizeRecording, requiredSecretKeys, sanitizeRecordingForTask } = require("./replay-engine");

test("replay engine keeps selectors, timings and real input values", () => {
  const recording = normalizeRecording({
    startUrl: "https://example.com/login",
    viewport: { width: 1280, height: 720 },
    actions: [
      { index: 1, type: "click", selector: "#email", delayMs: 120 },
      { index: 2, type: "input", selector: "#email", value: "user@example.com", delayMs: 80 },
      { index: 3, type: "key", selector: "#email", key: "Enter", delayMs: 50 }
    ]
  });
  assert.equal(recording.startUrl, "https://example.com/login");
  assert.equal(recording.actions[1].value, "user@example.com");
  assert.equal(recording.actions[1].selector, "#email");
  assert.equal(recording.actions[1].delayMs, 80);
});

test("password actions never persist their secret and expose an explicit secret key", () => {
  const recording = {
    startUrl: "https://example.com/login",
    actions: [{ index: 4, type: "input", selector: "#password", redacted: true, value: "must-not-survive" }]
  };
  assert.equal(actionSecretKey(recording.actions[0]), "selector:#password");
  assert.deepEqual(requiredSecretKeys(recording), ["selector:#password"]);
  const taskRecording = sanitizeRecordingForTask(recording);
  assert.equal(Object.prototype.hasOwnProperty.call(taskRecording.actions[0], "value"), false);
  assert.equal(taskRecording.actions[0].redacted, true);
});
