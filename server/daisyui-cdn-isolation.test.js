"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const CDN_PATTERNS = [
  /https:\/\/cdn\.jsdelivr\.net\/npm\/daisyui@5\/themes\.css/,
  /https:\/\/cdn\.jsdelivr\.net\/npm\/daisyui@5(?![\w/-])/,
  /https:\/\/cdn\.jsdelivr\.net\/npm\/@tailwindcss\/browser@4/
];

function loadHookApi() {
  function NativeBlob(parts, options) {
    this.parts = parts;
    this.options = options;
  }
  const sandbox = {
    window: null,
    navigator: {},
    document: undefined,
    Blob: NativeBlob,
    Object,
    String,
    Array,
    console
  };
  sandbox.window = sandbox;
  vm.runInNewContext(read("disable-sw.js"), sandbox);
  return sandbox.window.__zustandDaisyUiCdn;
}

test("DaisyUI CDN is opt-in for isolated render documents only", () => {
  const hook = read("disable-sw.js");
  for (const pattern of CDN_PATTERNS) assert.match(hook, pattern);
  assert.match(hook, /function injectDaisyUiCdn/);
  assert.match(hook, /data-zustand-daisyui-render/);
  assert.doesNotMatch(hook, /iframe#appFrame/);
  assert.doesNotMatch(hook, /document\.head\.append/, "CDN tags must not be appended to the editor document head");

  const stateHtml = read("state.html");
  const indexHtml = read("index.html");
  for (const pattern of CDN_PATTERNS) {
    assert.doesNotMatch(stateHtml, pattern, "state.html must not load DaisyUI/Tailwind CDN into the editor shell");
    assert.doesNotMatch(indexHtml, pattern, "index.html must remain a clean exported landing page artifact");
  }
});

test("DaisyUI CDN injection leaves normal runtime HTML untouched", () => {
  const api = loadHookApi();
  const runtimeHtml = '<!doctype html><html><head></head><body><button class="btn">Runtime</button></body></html>';
  assert.equal(api.injectDaisyUiCdn(runtimeHtml), runtimeHtml);

  const renderHtml = '<!doctype html><html data-zustand-daisyui-render><head></head><body><button class="btn btn-primary">Preset</button></body></html>';
  const injected = api.injectDaisyUiCdn(renderHtml);
  assert.notEqual(injected, renderHtml);
  assert.match(injected, /daisyui@5\/themes\.css/);
  assert.match(injected, /daisyui@5/);
  assert.match(injected, /@tailwindcss\/browser@4/);
});
