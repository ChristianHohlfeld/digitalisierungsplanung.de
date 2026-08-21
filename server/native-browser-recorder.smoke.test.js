"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createRecording, normalizeAction } = require("./native-browser-recorder");

test("native recorder records actions as replay metadata beside snapshots", () => {
  const recording = createRecording("https://example.com", { width: 1000, height: 700 });
  recording.actions.push(normalizeAction({ type: "click", x: 20, y: 30, selector: "#email" }, 1, Date.now(), Date.now()));
  recording.actions.push(normalizeAction({ type: "input", selector: "#email", value: "x@y.de" }, 2, Date.now(), Date.now()));
  assert.equal(recording.actions[0].type, "click");
  assert.equal(recording.actions[1].value, "x@y.de");
});
