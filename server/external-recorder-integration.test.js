"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("external URL recorder is exposed from the editor host", () => {
  const host = read("disable-sw.js");
  assert.match(host, /btnRecordUrl/);
  assert.match(host, /URL aufnehmen/);
  assert.match(host, /location\.href = "\/recorder\.html"/);
});

test("external recorder UI uses isolated realtime browser API and canonical editor storage", () => {
  const html = read("recorder.html");
  assert.match(html, /https:\/\/realtime\.digitalisierungsplanung\.de/);
  assert.match(html, /\/recorder\/sessions/);
  assert.match(html, /stateBlueprintHotLinked\.model\.v2/);
  assert.match(html, /Original-Website automatisch replayen/);
  assert.match(html, /Timings als Timer-Transitionen/);
});

test("production runs recorder separately and proxies only recorder API to it", () => {
  const ecosystem = read("server/ecosystem.config.cjs");
  const nginx = read("server/nginx/recorder.locations.conf");
  const deploy = read("server/deploy.sh");
  assert.match(ecosystem, /digitalisierungsplanung-recorder/);
  assert.match(ecosystem, /server\/recorder-run\.js/);
  assert.match(ecosystem, /RECORDER_PORT: "8789"/);
  assert.match(nginx, /location \^~ \/recorder\//);
  assert.match(nginx, /127\.0\.0\.1:8789/);
  assert.match(deploy, /playwright@1\.60\.0/);
  assert.match(deploy, /playwright install --with-deps chromium/);
  assert.match(deploy, /external-recorder/);
  assert.match(deploy, /8789\/healthz/);
});

test("external recorder compiles through the canonical State Blueprint contract only", () => {
  const source = read("server/external-recorder.js");
  assert.match(source, /stateCore\.blankModel\(\)/);
  assert.match(source, /stateCore\.applyCommands\(/);
  assert.match(source, /stateCore\.validateModel\(/);
  assert.match(source, /stateCore\.definitionPayload\(/);
  assert.doesNotMatch(source, /renderMode\s*:/);
  assert.doesNotMatch(source, /localState\s*:/);
  assert.doesNotMatch(source, /stateStore\s*:/);
});
