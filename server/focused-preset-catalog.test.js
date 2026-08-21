"use strict";

const fs = require("node:fs");
const path = require("node:path");
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

const BLOCKED_PRESET_IDS = [
  "builtin_daisy_accordion",
  "builtin_daisy_alert",
  "builtin_daisy_avatar",
  "builtin_daisy_badge",
  "builtin_daisy_calendar",
  "builtin_daisy_card",
  "builtin_daisy_chart",
  "builtin_daisy_pricing",
  "builtin_daisy_stripe_pricing",
  "builtin_daisy_bi_kpi_board",
  "builtin_daisy_export_image_asset",
  "builtin_daisy_select",
  "builtin_daisy_textarea",
  "builtin_daisy_toggle",
  "custom_acme_footer",
  "custom_api_card"
];

const BLOCKED_COMPONENT_TYPES = ["text", "list", "link", "note", "divider"];

function assertExactlyFocused(label, catalog) {
  assert.deepEqual(catalog.map(preset => preset.id), EXPECTED_IDS, label);
  assert.equal(catalog.length, EXPECTED_IDS.length, `${label} length`);
  assert.equal(catalog.some(preset => preset.builtIn === false), false, `${label} has managed presets`);
  assert.equal(catalog.some(preset => preset.hidden === true), false, `${label} has hidden presets`);
  assert.equal(catalog.some(preset => preset.legacy === true), false, `${label} has legacy presets`);
  assert.equal(catalog.some(preset => preset.contractOnly === true), false, `${label} has contract-only presets`);
  assert.equal(catalog.some(preset => preset.managedOnly === true), false, `${label} has managed-only presets`);
  assert.equal(catalog.some(preset => preset.categoryId === "__legacy_hidden__"), false, `${label} has legacy category`);
  for (const id of BLOCKED_PRESET_IDS) {
    assert.equal(catalog.some(preset => preset.id === id), false, `${id} must not be present in ${label}`);
  }
}

test("every preset surface contains exactly the 13 supported built-ins", () => {
  assert.deepEqual(presets.FOCUSED_PRESET_IDS, EXPECTED_IDS);
  assert.deepEqual(presets.CONTRACT_ONLY_PRESET_IDS, []);
  assertExactlyFocused("visible", presets.visiblePresetCatalogResponse());
  assertExactlyFocused("catalog", presets.presetCatalogResponse());
  assertExactlyFocused("contract", presets.contractPresetCatalogResponse());
  assertExactlyFocused("templates", presets.builtinStateTemplates());
});

test("managed library presets are ignored by every public contract surface", () => {
  const library = {
    daisyVersion: "5.6.18",
    categories: [{ id: "websuite-builder", label: "Websuite Builder", description: "", sort: 10 }],
    packages: [{ id: "core.process", label: "Core", category: "package", description: "", sort: 10 }],
    presets: [
      {
        id: "custom_api_card",
        variant: "card",
        title: "API Card",
        description: "Must stay out of the editor contract.",
        builtIn: false,
        categoryId: "websuite-builder",
        packageIds: ["core.process"],
        data: { title: "Card" }
      }
    ]
  };
  assertExactlyFocused("visible with managed library", presets.visiblePresetCatalogResponse(library));
  assertExactlyFocused("catalog with managed library", presets.presetCatalogResponse(library));
  assertExactlyFocused("contract with managed library", presets.contractPresetCatalogResponse(library));
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

test("inspector bootstrap prunes legacy Darstellung component dropdown options", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "disable-sw.js"), "utf8");
  assert.match(source, /STATE_BLUEPRINT_FOCUSED_INSPECTOR_CONTRACT/);
  assert.match(source, /FOCUSED_COMPONENT_TYPES = Object\.freeze\(\["heading", "image"\]\)/);
  assert.match(source, /componentPresetTypes = \(\) => \[\.\.\.FOCUSED_COMPONENT_TYPES\]/);
  for (const type of BLOCKED_COMPONENT_TYPES) {
    assert.doesNotMatch(source, new RegExp(`focusedOption\\("${type}"`));
  }
});
