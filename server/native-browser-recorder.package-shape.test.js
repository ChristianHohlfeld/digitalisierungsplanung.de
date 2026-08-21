"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createRecording } = require("./native-browser-recorder");

test("native recorder recording starts as exportable replay package data", () => {
  const recording = createRecording("https://example.com", { width: 900, height: 600 });
  assert.equal(recording.version, 1);
  assert.equal(recording.startUrl, "https://example.com");
  assert.equal(recording.viewport.width, 900);
});
