"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("native recorder usage shows the exact npm command", () => {
  const text = fs.readFileSync("server/native-browser-recorder.md", "utf8");
  assert.match(text, /npm run recorder:native -- https:\/\/wob-app15\.wobak\.de\/de\/cockpit/);
});
