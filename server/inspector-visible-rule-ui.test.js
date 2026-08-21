"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("visible transition inspector is native, simple and contains no legacy trigger-match UI", () => {
  const editor = fs.readFileSync("state.html", "utf8");
  const cleanup = fs.readFileSync("disable-sw.js", "utf8");
  assert.match(editor, /Filter \/ Regeln/);
  assert.match(editor, /Worauf lauscht diese Kante im State-Kontext/);
  assert.match(editor, /ruleJoin/);
  assert.match(editor, /\+ Regel/);
  assert.match(editor, /Regel löschen/);
  assert.doesNotMatch(editor, /pTransitionAdvancedTriggerCard|pTriggerMatchField|technische bedingung/i);
  assert.doesNotMatch(cleanup, /Inspector|RuleBuilder|MutationObserver/);
});
