"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("native recorder docs promise normal browser usage, not screenshot steering", () => {
  const text = fs.readFileSync("server/native-browser-recorder.md", "utf8");
  assert.match(text, /echtes Chromium-Fenster/);
  assert.match(text, /normal benutzt/);
  assert.match(text, /kein Screenshot-Fernsteuerungsgefühl/);
});
