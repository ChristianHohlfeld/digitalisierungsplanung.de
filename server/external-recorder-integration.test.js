"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("state editor owns recorder input and render output", () => {
  const host = read("state.html");
  assert.match(host, /id="tabRecorder"/);
  assert.match(host, /App Recorder/);
  assert.match(host, /Input/);
  assert.match(host, /id="tabRender"/);
  assert.match(host, /App Render/);
  assert.match(host, /Output/);
  assert.match(host, /id="recordUrl"/);
  assert.match(host, /id="recordStart"/);
  assert.match(host, /http:\/\/127\.0\.0\.1:8799/);
  assert.match(host, /agent\("\/recordings"/);
  assert.match(host, /agent\("\/replays"/);
  assert.doesNotMatch(read("disable-sw.js"), /Recorder|Inspector|RuleBuilder/);
});

test("legacy recorder page only forwards into the editor recorder tab", () => {
  const html = read("recorder.html");
  assert.match(html, /\/state\.html\?tab=recorder/);
  assert.doesNotMatch(html, /realtime\.digitalisierungsplanung\.de/);
  assert.doesNotMatch(html, /\/recorder\/sessions/);
  assert.doesNotMatch(html, /stateBlueprintHotLinked/);
});

test("production cloud recorder remains isolated and deploy-health checked", () => {
  const ecosystem = read("server/ecosystem.config.cjs");
  const nginx = read("server/nginx/recorder.locations.conf");
  const deploy = read("server/deploy.sh");
  const packageJson = require("../package.json");
  assert.match(ecosystem, /digitalisierungsplanung-recorder/);
  assert.match(ecosystem, /server\/recorder-run\.js/);
  assert.match(ecosystem, /RECORDER_PORT: "8789"/);
  assert.match(nginx, /location \^~ \/recorder\//);
  assert.match(nginx, /127\.0\.0\.1:8789/);
  assert.equal(packageJson.dependencies.playwright, "1.60.0");
  assert.doesNotMatch(deploy, /npm install --no-save.*playwright/);
  assert.doesNotMatch(deploy, /npx\s+playwright/);
  assert.match(deploy, /node \.\/node_modules\/playwright\/cli\.js install --with-deps chromium/);
  assert.match(deploy, /RECORDER_CHROMIUM/);
  assert.match(deploy, /8789\/healthz/);
});

test("external recorder compiler still produces only canonical State Blueprint output", () => {
  const source = read("server/external-recorder.js");
  assert.match(source, /stateCore\.blankModel\(\)/);
  assert.match(source, /stateCore\.applyCommands\(/);
  assert.match(source, /stateCore\.validateModel\(/);
  assert.match(source, /stateCore\.definitionPayload\(/);
  assert.doesNotMatch(source, /renderMode\s*:/);
  assert.doesNotMatch(source, /localState\s*:/);
  assert.doesNotMatch(source, /stateStore\s*:/);
});
