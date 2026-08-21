"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const focused = require("../focused-editor-contract");
const stateCore = require("../mcp/state-blueprint-core");
const presetCatalog = require("./preset-catalog");

test("focused editor exposes exactly the focused sellable preset surface", () => {
  const expected = presetCatalog.FOCUSED_PRESET_IDS;
  assert.deepEqual(focused.PRESETS.map(item => item.id), [...expected]);
});

test("every focused editor preset produces a canonical contract-valid state", () => {
  for (const [index, preset] of focused.PRESETS.entries()) {
    let model = focused.blankModel("Focused preset contract");
    const state = focused.createStateFromPreset(preset.id, {
      id: "state_" + (index + 1),
      x: 120 + index * 24,
      y: 120
    });
    model = focused.addState(model, state).model;
    const validation = stateCore.validateModel(model);
    assert.equal(validation.ok, true, preset.id + ": " + JSON.stringify(validation.issues));
  }
});

test("focused rules compile to the canonical condition grammar", () => {
  let model = focused.blankModel("Rules");
  model = focused.addState(model, focused.createStateFromPreset("builtin_daisy_checkbox", { id: "approval" })).model;
  model = focused.addState(model, focused.createStateFromPreset("builtin_daisy_input_number", { id: "amount" })).model;
  const condition = focused.conditionFromRules([
    { path: "states.approval.checked", operator: "truthy", value: "" },
    { path: "states.amount.value", operator: ">=", value: 100 }
  ], "and");
  const transition = focused.createTransition(model, {
    id: "go",
    from: "approval",
    to: "amount",
    label: "Freigeben",
    triggerType: "button",
    condition
  });
  model = focused.addTransition(model, transition);
  const validation = stateCore.validateModel(model);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  assert.equal(condition, "states.approval.checked && states.amount.value >= 100");
});

test("focused rule parser round-trips its visible rule subset", () => {
  const source = "states.amount.value >= 100 || !states.approval.checked";
  const parsed = focused.rulesFromCondition(source);
  assert.equal(parsed.join, "or");
  assert.deepEqual(parsed.rules, [
    { path: "states.amount.value", operator: ">=", value: 100 },
    { path: "states.approval.checked", operator: "falsy", value: "" }
  ]);
  assert.equal(focused.conditionFromRules(parsed.rules, parsed.join), source);
});