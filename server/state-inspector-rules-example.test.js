"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { compileCondition } = require("./inspector-rule-builder");

test("documented checkbox/input rule example compiles", () => {
  const example = JSON.parse(fs.readFileSync("docs/state-inspector-rules-example.json", "utf8"));
  assert.equal(
    compileCondition(example.rules, example.join),
    "states.checkbox_a.checked == true && states.checkbox_b.checked == false && states.email.value != \"\""
  );
});
