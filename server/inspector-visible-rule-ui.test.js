"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("visible transition inspector hides legacy trigger-match complexity", () => {
  const script = fs.readFileSync("disable-sw.js", "utf8");
  assert.match(script, /installVisibleTransitionRuleBuilder/);
  assert.match(script, /pTransitionAdvancedTriggerCard/);
  assert.match(script, /trigger-regel/);
  assert.match(script, /match-feld/);
  assert.match(script, /technische bedingung/);
  assert.match(script, /simple-transition-rule-builder/);
});
