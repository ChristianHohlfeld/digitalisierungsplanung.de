"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const presets = require("./preset-catalog");
const basePresets = require("./preset-catalog-base");

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

function managedCatalogById() {
  return new Map(
    basePresets.presetCatalogResponse()
      .filter(preset => preset.builtIn === false)
      .map(preset => [preset.id, preset])
  );
}

test("focused preset surface contains exactly the 13 supported built-ins plus managed presets", () => {
  const visible = presets.visiblePresetCatalogResponse();
  const visibleBuiltIns = visible.filter(preset => preset.builtIn !== false);
  const visibleManaged = visible.filter(preset => preset.builtIn === false);
  const baseManaged = managedCatalogById();

  assert.deepEqual(presets.FOCUSED_PRESET_IDS, EXPECTED_IDS);
  assert.deepEqual(visibleBuiltIns.map(preset => preset.id), EXPECTED_IDS);
  assert.deepEqual(
    presets.builtinStateTemplates().map(preset => preset.id),
    EXPECTED_IDS
  );
  assert.deepEqual(
    visibleManaged.map(preset => preset.id).sort(),
    [...baseManaged.keys()].sort()
  );

  for (const preset of visibleManaged) {
    const original = baseManaged.get(preset.id);
    assert.ok(original, preset.id + " missing from managed base catalog");
    assert.equal(preset.hidden, original.hidden);
    assert.equal(preset.categoryId, original.categoryId);
    assert.deepEqual(preset.packageIds, original.packageIds);
    assert.notEqual(preset.categoryId, presets.LEGACY_CATEGORY_ID);
  }
});

test("legacy shipped presets stay hidden without hiding managed presets", () => {
  const catalog = presets.presetCatalogResponse();
  const visible = catalog.filter(preset => preset.hidden !== true);
  const legacy = catalog.filter(preset => preset.hidden === true);
  const visibleBuiltIns = visible.filter(preset => preset.builtIn !== false);
  const visibleManaged = visible.filter(preset => preset.builtIn === false);
  const baseManaged = managedCatalogById();

  assert.deepEqual(visibleBuiltIns.map(preset => preset.id), EXPECTED_IDS);
  assert.deepEqual(
    visibleManaged.map(preset => preset.id).sort(),
    [...baseManaged.keys()].sort()
  );
  assert.ok(legacy.length > 0);
  assert.ok(legacy.every(preset => preset.builtIn !== false));
  assert.ok(legacy.every(preset => preset.categoryId === presets.LEGACY_CATEGORY_ID));
  assert.ok(legacy.every(preset => preset.legacy === true));
  assert.ok(legacy.every(preset => preset.hidden === true));
  assert.equal(catalog.find(preset => preset.id === "builtin_daisy_accordion")?.hidden, true);
  assert.equal(catalog.some(preset => preset.id === "builtin_daisy_calendar"), false);
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
