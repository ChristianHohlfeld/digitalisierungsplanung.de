"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const presets = require("./preset-catalog");

const EXPECTED_IDS = [
  "builtin_daisy_dropdown",
  "builtin_daisy_button",
  "builtin_daisy_toast",
  "builtin_daisy_checkbox",
  "builtin_daisy_input",
  "builtin_daisy_input_number",
  "builtin_daisy_search",
  "builtin_daisy_input_email",
  "builtin_daisy_input_password",
  "builtin_page_heading",
  "builtin_media_image",
  "builtin_daisy_date",
  "builtin_daisy_radio"
];

test("focused built-in preset surface contains exactly the 13 supported built-ins", () => {
  assert.deepEqual(presets.FOCUSED_PRESET_IDS, EXPECTED_IDS);
  const visibleBuiltIns = presets.visiblePresetCatalogResponse()
    .filter(preset => preset.builtIn !== false && preset.id.startsWith("builtin_"))
    .map(preset => preset.id);
  assert.deepEqual(visibleBuiltIns, EXPECTED_IDS);
  assert.deepEqual(presets.builtinStateTemplates().map(preset => preset.id), EXPECTED_IDS);
});

test("managed presets remain visible with their category and package metadata", () => {
  const catalog = presets.presetCatalogResponse();
  const managed = catalog.filter(preset => preset.builtIn === false);
  assert.ok(managed.length > 0);
  for (const preset of managed) {
    const visible = presets.visiblePresetCatalogResponse().find(candidate => candidate.id === preset.id);
    assert.ok(visible, `${preset.id} should remain visible`);
    assert.deepEqual(visible.packages || [], preset.packages || []);
  }
});

test("focused catalog exposes no legacy, hidden or fallback built-ins", () => {
  const catalog = presets.presetCatalogResponse();
  assert.equal(catalog.some(preset => preset.hidden === true), false);
  assert.equal(catalog.some(preset => preset.legacy === true), false);
  assert.equal(catalog.some(preset => preset.categoryId === "__legacy_hidden__"), false);
  assert.equal(catalog.some(preset => preset.id === "builtin_daisy_accordion"), false);
  assert.equal(catalog.some(preset => preset.id === "builtin_daisy_calendar"), false);
  assert.equal(presets.visiblePresetCatalogResponse().length, catalog.length);
});

test("typed input presets keep distinct state contracts", () => {
  const byId = new Map(presets.visiblePresetCatalogResponse().map(preset => [preset.id, preset]));
  const cases = [
    ["builtin_daisy_input", "input", "text", "text"],
    ["builtin_daisy_input_number", "input_number", "number", "number"],
    ["builtin_daisy_search", "search", "search", "text"],
    ["builtin_daisy_input_email", "input_email", "email", "email"],
    ["builtin_daisy_input_password", "input_password", "password", "text"]
  ];

  for (const [id, rootStateId, inputType, valueType] of cases) {
    const preset = byId.get(id);
    assert.ok(preset, id + " missing");
    assert.equal(preset.rootStateId, rootStateId);
    assert.equal(preset.components[0].inputType, inputType);
    assert.equal(preset.stateContribution.fieldTypes[`states.${rootStateId}.value`], valueType);
  }
});

test("date, header and image use the existing renderer primitives", () => {
  const byId = new Map(presets.visiblePresetCatalogResponse().map(preset => [preset.id, preset]));
  assert.equal(byId.get("builtin_daisy_date")?.components[0]?.variant, "calendar");
  assert.equal(byId.get("builtin_page_heading")?.components[0]?.type, "heading");
  assert.equal(byId.get("builtin_page_heading")?.components[0]?.text, "Header");
  assert.equal(byId.get("builtin_media_image")?.components[0]?.type, "image");
});
