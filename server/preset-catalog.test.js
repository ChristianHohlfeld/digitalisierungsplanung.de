"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const presets = require("./preset-catalog");

const EXPECTED_BUILTIN_IDS = [
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

const REMOVED_LEGACY_IDS = [
  "builtin_daisy_accordion",
  "builtin_daisy_alert",
  "builtin_daisy_calendar",
  "builtin_daisy_bi_kpi_board",
  "builtin_daisy_export_image_asset",
  "builtin_daisy_stripe_pricing",
  "builtin_body_copy",
  "builtin_task_checklist",
  "builtin_external_link",
  "builtin_info_note",
  "builtin_section_divider",
  "builtin_content_list"
];

test("built-in preset surface is exactly the 13 supported primitives", () => {
  assert.deepEqual(presets.BUILTIN_PRESET_IDS, EXPECTED_BUILTIN_IDS);
  assert.deepEqual(
    presets.builtinStateTemplates().map(preset => preset.id),
    EXPECTED_BUILTIN_IDS
  );
});

test("product catalog contains no legacy compatibility entries", () => {
  const catalog = presets.presetCatalogResponse();
  const builtins = catalog.filter(preset => preset.builtIn === true);
  const managed = catalog.filter(preset => preset.builtIn === false);

  assert.deepEqual(builtins.map(preset => preset.id), EXPECTED_BUILTIN_IDS);
  assert.ok(managed.length > 0, "managed presets stay first-class product data");
  assert.ok(catalog.every(preset => !Object.hasOwn(preset, "hidden")));
  assert.ok(catalog.every(preset => !Object.hasOwn(preset, "legacy")));
  for (const id of REMOVED_LEGACY_IDS) {
    assert.equal(catalog.some(preset => preset.id === id), false, id + " must be deleted");
  }
});

test("package metadata is derived only from the reduced catalog", () => {
  const catalogIds = new Set(presets.presetCatalogResponse().map(preset => preset.id));
  for (const pack of presets.presetPackagesResponse()) {
    assert.equal(pack.presetCount, pack.presetIds.length);
    assert.ok(pack.presetIds.every(id => catalogIds.has(id)), pack.id + " contains stale preset id");
  }
  const analytics = presets.presetPackagesResponse().find(pack => pack.id === "bi.analytics");
  assert.ok(analytics);
  assert.equal(analytics.presetIds.includes("builtin_daisy_bi_kpi_board"), false);
});

test("typed input presets keep distinct state contracts", () => {
  const byId = new Map(presets.presetCatalogResponse().map(preset => [preset.id, preset]));
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

test("date, header and image use the supported renderer primitives", () => {
  const byId = new Map(presets.presetCatalogResponse().map(preset => [preset.id, preset]));
  assert.equal(byId.get("builtin_daisy_date")?.components[0]?.variant, "calendar");
  assert.equal(byId.get("builtin_page_heading")?.components[0]?.type, "heading");
  assert.equal(byId.get("builtin_page_heading")?.components[0]?.text, "Header");
  assert.equal(byId.get("builtin_media_image")?.components[0]?.type, "image");
});
