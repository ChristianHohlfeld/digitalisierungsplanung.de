"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const CDN_PATTERNS = [
  /https:\/\/cdn\.jsdelivr\.net\/npm\/daisyui@5\/themes\.css/,
  /https:\/\/cdn\.jsdelivr\.net\/npm\/daisyui@5(?![\w/-])/,
  /https:\/\/cdn\.jsdelivr\.net\/npm\/@tailwindcss\/browser@4/
];

test("DaisyUI CDN is injected only into rendered app documents", () => {
  const hook = read("disable-sw.js");
  for (const pattern of CDN_PATTERNS) assert.match(hook, pattern);
  assert.match(hook, /function injectDaisyUiCdn/);
  assert.match(hook, /window\.Blob\s*=/);
  assert.match(hook, /iframe#appFrame/);

  const stateHtml = read("state.html");
  const indexHtml = read("index.html");
  for (const pattern of CDN_PATTERNS) {
    assert.doesNotMatch(stateHtml, pattern, "state.html must not load DaisyUI/Tailwind CDN into the editor shell");
    assert.doesNotMatch(indexHtml, pattern, "index.html must remain a clean exported landing page artifact");
  }
});

test("render document injection keeps editor markup untouched", () => {
  const hook = read("disable-sw.js");
  const marker = "injectDaisyUiCdn(html)";
  assert.ok(hook.includes(marker));
  assert.match(hook, /data-zustand-daisyui-cdn="components"/);
  assert.match(hook, /data-theme="light"/);
  assert.doesNotMatch(hook, /document\.head\.append\(/, "CDN tags must not be appended to the editor document head");
});
