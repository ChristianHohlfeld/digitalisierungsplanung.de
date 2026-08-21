"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const eventCatalog = require("./event-catalog");
const presets = require("./preset-catalog");
const productContract = require("./product-contract");

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
  "builtin_daisy_toggle"
];

function contract() {
  return productContract.productContractResponse(eventCatalog.DEFAULT_EVENT_CATALOG);
}

test("all preset surfaces contain exactly the 13 supported built-ins", () => {
  assert.deepEqual(presets.FOCUSED_PRESET_IDS, EXPECTED_IDS);
  assert.deepEqual(presets.CONTRACT_ONLY_PRESET_IDS, []);
  assert.deepEqual(presets.presetCatalogResponse().map(preset => preset.id), EXPECTED_IDS);
  assert.deepEqual(presets.visiblePresetCatalogResponse().map(preset => preset.id), EXPECTED_IDS);
  assert.deepEqual(presets.contractPresetCatalogResponse().map(preset => preset.id), EXPECTED_IDS);
  assert.deepEqual(presets.builtinStateTemplates().map(preset => preset.id), EXPECTED_IDS);
  assert.deepEqual(contract().presets.map(preset => preset.id), EXPECTED_IDS);
});

test("preset catalogs expose no managed, legacy, hidden, contract-only or fallback entries", () => {
  const surfaces = [
    presets.presetCatalogResponse(),
    presets.visiblePresetCatalogResponse(),
    presets.contractPresetCatalogResponse(),
    contract().presets
  ];
  for (const catalog of surfaces) {
    assert.equal(catalog.some(preset => preset.builtIn === false), false);
    assert.equal(catalog.some(preset => preset.hidden === true), false);
    assert.equal(catalog.some(preset => preset.legacy === true), false);
    assert.equal(catalog.some(preset => preset.contractOnly === true), false);
    assert.equal(catalog.some(preset => preset.managedOnly === true), false);
    assert.equal(catalog.some(preset => preset.categoryId === "__legacy_hidden__"), false);
    for (const id of BLOCKED_PRESET_IDS) {
      assert.equal(catalog.some(preset => preset.id === id), false, `${id} must not exist in focused surfaces`);
    }
  }
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

test("focused inspector is native and service-worker cleanup no longer patches product UI", () => {
  const cleanup = fs.readFileSync(path.join(__dirname, "..", "disable-sw.js"), "utf8");
  const editor = fs.readFileSync(path.join(__dirname, "..", "state.html"), "utf8");
  assert.doesNotMatch(cleanup, /STATE_BLUEPRINT_FOCUSED_INSPECTOR_CONTRACT|componentPresetTypes|MutationObserver|RuleBuilder/);
  assert.match(editor, /Trigger-Kontext/);
  assert.match(editor, /Filter \/ Regeln/);
});

test("inspector semantics keep state trigger context separate from transition listener", () => {
  const editor = fs.readFileSync(path.join(__dirname, "..", "state.html"), "utf8");
  assert.match(editor, /Trigger-Kontext/);
  assert.match(editor, /Lauscht auf/);
  assert.match(editor, /Worauf lauscht diese Kante im State-Kontext/);
  assert.match(editor, /ruleJoin/);
});
