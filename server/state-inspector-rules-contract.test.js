"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("state inspector rules stay simple and row-based", () => {
  const text = fs.readFileSync("docs/state-inspector-rules.md", "utf8");
  assert.match(text, /State Inspector/);
  assert.match(text, /Transition Inspector/);
  assert.match(text, /Checkbox A \(checkbox_a\)/);
  assert.match(text, /E-Mail \(email\)/);
  assert.match(text, /Jede Regel ist eine eigene Zeile/);
});
