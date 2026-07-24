"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const presetCatalog = require("./preset-catalog");
const presetLibrary = require("./preset-library");

const OFFICIAL_DAISY_CDN = "https://cdn.jsdelivr.net/npm/daisyui@5";
const OFFICIAL_DAISY_THEMES_CDN = "https://cdn.jsdelivr.net/npm/daisyui@5/themes.css";
const OFFICIAL_TAILWIND_BROWSER_CDN = "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4";

test("preset library is reduced to real DaisyUI template contract", () => {
  const library = presetLibrary.loadPresetLibraryFile();
  assert.equal(library.schemaVersion, 2);
  assert.equal(library.daisyVersion, "5.7.0");
  assert.deepEqual(library.presets, []);
});

test("built-in presets expose real DaisyUI template HTML to the state editor", () => {
  const presets = presetCatalog.presetCatalogResponse();
  assert.ok(presets.length >= 8);
  for (const preset of presets) {
    assert.equal(preset.template.source, "daisyui");
    assert.equal(preset.template.version, "5.7.0");
    assert.match(preset.template.docsPath, /packages\/docs\/src\/routes\/\(routes\)\/components\//);
    assert.ok(preset.template.html.includes("class=\""), `${preset.id} needs real DaisyUI class markup`);
    assert.equal(preset.components.length, 1);
    assert.equal(preset.components[0].type, "daisy");
    assert.deepEqual(preset.components[0].template, preset.template);
    assert.equal(JSON.stringify(preset.data).includes("_snippet"), false);
  }
  const button = presets.find(preset => preset.id === "builtin_daisy_button");
  assert.ok(button);
  assert.equal(button.components[0].template.html, '<button class="btn btn-primary">{{ label | Button }}</button>');
  assert.equal(button.stateContribution.fieldSchemas["states.button.label"].type, "text");
});

test("snippet parser stores original DaisyUI markup as template, not data", () => {
  const parsed = presetLibrary.parseDaisySnippet({
    snippet: '<button class="btn btn-primary">Save</button>',
    title: "Save Button",
    categoryId: "websuite-builder",
    packageIds: ["core.process"]
  });
  assert.equal(parsed.id, "custom_save_button");
  assert.equal(parsed.variant, "button");
  assert.equal(parsed.template.source, "daisyui");
  assert.equal(parsed.template.version, "5.7.0");
  assert.equal(parsed.template.html, '<button class="btn btn-primary">Save</button>');
  assert.equal(Object.hasOwn(parsed.data, "_snippet"), false);
  assert.equal(parsed.data.label, "Save");
});

test("snippet parser rejects unsafe behavior while allowing real DaisyUI markup", () => {
  assert.throws(
    () => presetLibrary.parseDaisySnippet({ snippet: "<scr" + "ipt>alert(1)</scr" + "ipt>" }),
    error => error?.code === "unsafe_snippet_element"
  );
  assert.throws(
    () => presetLibrary.parseDaisySnippet({ snippet: '<button class="btn" on' + 'click="alert(1)">Bad</button>' }),
    error => error?.code === "unsafe_snippet_attribute"
  );
  assert.doesNotThrow(() => presetLibrary.parseDaisySnippet({
    snippet: '<div class="card bg-base-100 w-96 shadow-sm"><div class="card-body"><h2 class="card-title">Card Title</h2><p>Body</p><div class="card-actions justify-end"><button class="btn btn-primary">Buy Now</button></div></div></div>',
    title: "Card"
  }));
});

test("frontend renderer uses the official DaisyUI CDN shape", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "assets", "daisyui-template-renderer.js"), "utf8");
  assert.ok(renderer.includes("DaisyPresetRenderer"));
  assert.ok(renderer.includes("renderPresetHtml"));
  assert.ok(renderer.includes(OFFICIAL_DAISY_CDN));
  assert.ok(renderer.includes(OFFICIAL_DAISY_THEMES_CDN));
  assert.ok(renderer.includes(OFFICIAL_TAILWIND_BROWSER_CDN));
  assert.equal(renderer.includes("generatePresetHtml"), false);
  assert.equal(renderer.includes("switch (variant)"), false);
});

test("state editor and preset admin allow Tailwind browser inside isolated previews", () => {
  const stateHtml = fs.readFileSync(path.join(__dirname, "..", "state.html"), "utf8");
  const adminHtml = fs.readFileSync(path.join(__dirname, "presets-admin.html"), "utf8");
  for (const html of [stateHtml, adminHtml]) {
    assert.ok(html.includes(OFFICIAL_DAISY_CDN));
    assert.ok(html.includes(OFFICIAL_DAISY_THEMES_CDN));
    assert.ok(html.includes(OFFICIAL_TAILWIND_BROWSER_CDN));
    assert.ok(html.includes('sandbox="allow-scripts"'));
  }
});
