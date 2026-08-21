"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createRecording } = require("./native-browser-recorder");

test("native recorder keeps recording package data minimal", () => {
  const recording = createRecording("https://example.com", { width: 1024, height: 640 });
  assert.equal(recording.version, 1);
  assert.equal(recording.startUrl, "https://example.com");
  assert.deepEqual(recording.actions, []);
});
