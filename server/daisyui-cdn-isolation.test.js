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

function fakeDocument(marked = false) {
  const nodes = [];
  const doc = {
    documentElement: {
      attrs: {},
      getAttribute(name) { return this.attrs[name] || ""; },
      setAttribute(name, value) { this.attrs[name] = String(value); }
    },
    head: {
      appended: nodes,
      appendChild(node) { nodes.push(node); }
    },
    querySelector(selector) {
      if (selector === "[data-zustand-daisyui-render]") return marked ? {} : null;
      const match = selector.match(/^\[data-zustand-daisyui-cdn="([^"]+)"\]$/);
      return match ? nodes.find(node => node.attrs?.["data-zustand-daisyui-cdn"] === match[1]) || null : null;
    },
    createElement(tagName) {
      return {
        tagName,
        attrs: {},
        setAttribute(name, value) { this.attrs[name] = String(value); }
      };
    }
  };
  return { doc, nodes };
}

test("DaisyUI CDN is opt-in for marked render documents only", () => {
  const hook = read("disable-sw.js");
  for (const pattern of CDN_PATTERNS) assert.match(hook, pattern);
  assert.match(hook, /function injectDaisyUiCdn/);
  assert.match(hook, /function ensureDaisyUiInMarkedDocument/);
  assert.match(hook, /data-zustand-daisyui-render/);
  assert.match(hook, /data-zustand-daisyui-frame/);
  assert.match(hook, /iframe\[" \+ FRAME_MARKER \+ "\]/);
  assert.doesNotMatch(hook, /querySelectorAll\("iframe"\)/);
  assert.doesNotMatch(hook, /new MutationObserver/);
  assert.doesNotMatch(hook, /iframe#appFrame/);
  assert.doesNotMatch(hook, /document\.head\.append/, "CDN tags must not be appended to the editor document head");

  const stateHtml = read("state.html");
  const indexHtml = read("index.html");
  for (const pattern of CDN_PATTERNS) {
    assert.doesNotMatch(stateHtml, pattern, "state.html must not load DaisyUI/Tailwind CDN into the editor shell");
    assert.doesNotMatch(indexHtml, pattern, "index.html must remain a clean exported landing page artifact");
  }
});

test("DaisyUI CDN injection leaves unmarked runtime HTML and documents untouched", () => {
  const api = loadHookApi();
  const runtimeHtml = '<!doctype html><html><head></head><body><button class="btn">Runtime</button></body></html>';
  assert.equal(api.injectDaisyUiCdn(runtimeHtml), runtimeHtml);

  const unmarked = fakeDocument(false);
  api.ensureDaisyUiInMarkedDocument(unmarked.doc);
  assert.equal(unmarked.nodes.length, 0);
});

test("DaisyUI CDN injection styles marked render HTML and documents", () => {
  const api = loadHookApi();
  const renderHtml = '<!doctype html><html><head></head><body><div data-zustand-daisyui-render><button class="btn btn-primary">Preset</button></div></body></html>';
  const injected = api.injectDaisyUiCdn(renderHtml);
  assert.notEqual(injected, renderHtml);
  assert.match(injected, /daisyui@5\/themes\.css/);
  assert.match(injected, /daisyui@5/);
  assert.match(injected, /@tailwindcss\/browser@4/);

  const marked = fakeDocument(true);
  api.ensureDaisyUiInMarkedDocument(marked.doc);
  assert.deepEqual(marked.nodes.map(node => node.attrs["data-zustand-daisyui-cdn"]), ["themes", "components", "tailwind"]);
  assert.equal(marked.doc.documentElement.getAttribute("data-theme"), "light");
});
