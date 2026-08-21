"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("state editor source is restored and remains the export source", () => {
  const state = read("state.html");
  const build = read("scripts/build-index.mjs");
  assert.ok(state.length > 100_000, "state.html must contain the actual editor source");
  assert.match(state, /State Blueprint Editor/i);
  assert.match(state, /id=["']btnExport["']/);
  assert.match(build, /state\.html\?demo=zustand/);
  assert.doesNotMatch(build, /site_pricing/);
});

test("product scripts expose only the native recorder path", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["recorder:native"], "node server/native-browser-recorder.js");
  assert.equal(pkg.scripts["recorder:local"], undefined);
  assert.equal(pkg.scripts["mcp:state"], undefined);
  assert.equal(fs.existsSync(path.join(root, "server/local-recorder-agent.js")), false);
  assert.equal(fs.existsSync(path.join(root, "server/local-recorder-agent.test.js")), false);
  assert.equal(fs.existsSync(path.join(root, "server/native-browser-recorder.js")), true);
});
