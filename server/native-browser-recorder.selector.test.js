"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { targetRecorderScript } = require("./native-browser-recorder");

test("native recorder script captures selectors and form values", () => {
  const script = targetRecorderScript();
  assert.match(script, /selectorFor/);
  assert.match(script, /sendInput/);
  assert.match(script, /inputType === "password"/);
});
