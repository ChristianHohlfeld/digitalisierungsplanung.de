"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("product recorder uses the browser extension instead of developer localhost setup", () => {
  const html = read("state.html");
  const app = read("state-app.js");
  const bridge = read("recorder-extension/editor-bridge.js");
  const product = `${html}\n${app}`;

  assert.doesNotMatch(product, /npm run recorder:agent/i);
  assert.doesNotMatch(product, /127\.0\.0\.1:8799/);
  assert.doesNotMatch(product, /Local Recorder Agent/i);
  assert.match(html, /recorder-extension\/editor-bridge\.js/);
  assert.match(html, /state-app\.js/);
  assert.match(product, /Desktop Recorder/);
  assert.match(product, /Aufnahme auf Desktop verfügbar/);
  assert.match(bridge, /ZUSTAND_EXTENSION_COMMAND/);
  assert.doesNotThrow(() => new vm.Script(app));
  assert.doesNotThrow(() => new vm.Script(bridge));
});

test("recorder extension is a real all-url browser recorder with replay support", () => {
  const manifest = JSON.parse(read("recorder-extension/manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.host_permissions.includes("<all_urls>"));
  assert.ok(manifest.permissions.includes("scripting"));
  assert.ok(manifest.permissions.includes("storage"));
  assert.equal(manifest.background.service_worker, "background.js");
  assert.ok(manifest.content_scripts.some(item => item.matches.includes("<all_urls>")));

  const content = read("recorder-extension/content.js");
  const background = read("recorder-extension/background.js");
  assert.doesNotThrow(() => new vm.Script(content));
  assert.doesNotThrow(() => new vm.Script(background));
  assert.match(content, /addEventListener\("click"/);
  assert.match(content, /addEventListener\("input"/);
  assert.match(content, /inputType.*password/);
  assert.match(background, /captureVisibleTab/);
  assert.match(background, /chrome\.scripting\.executeScript/);
  assert.match(background, /START_RECORDING/);
  assert.match(background, /APPLY_REPLAY_ACTION/);
});
