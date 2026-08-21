"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("native recorder command stays available", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(pkg.scripts["recorder:native"], "node server/native-browser-recorder.js");
});
