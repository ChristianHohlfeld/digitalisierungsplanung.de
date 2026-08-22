"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("visible transition inspector is native, simple and contains no legacy trigger-match UI", () => {
  const editor = fs.readFileSync("state-app.js", "utf8");
  const cleanup = fs.readFileSync("disable-sw.js", "utf8");
  assert.match(editor, /Filter \/ Regeln/);
  assert.match(editor, /Welche Daten oder Eventwerte soll diese Kante beachten/);
  assert.match(editor, /ruleJoin/);
  assert.match(editor, /\+ Regel/);
  assert.match(editor, /Regel löschen/);
  assert.match(editor, /Lauscht auf/);
  assert.doesNotMatch(editor, /pTransitionAdvancedTriggerCard|pTriggerMatchField|technische bedingung|Trigger-Regel|Match-Feld/i);
  assert.doesNotMatch(cleanup, /Inspector|RuleBuilder|MutationObserver/);
});
