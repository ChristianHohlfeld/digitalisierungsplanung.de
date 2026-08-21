"use strict";
const fs=require("node:fs");
const vm=require("node:vm");
const test=require("node:test");
const assert=require("node:assert/strict");
const state=fs.readFileSync(require.resolve("../state.html"),"utf8");
const recorder=fs.readFileSync(require.resolve("./external-recorder"),"utf8");

test("recorder auto-routes without developer setup in product UI",()=>{
  assert.match(state,/const CLOUD = "https:\/\/realtime\.digitalisierungsplanung\.de"/);
  assert.match(state,/Recorder bereit/);
  assert.match(state,/Auto · Cloud/);
  assert.match(state,/localAgentAvailable/);
  assert.match(state,/cloudReplay/);
  assert.match(state,/window\.open\(`\$\{CLOUD\}\/recorder\.html/);
  assert.doesNotMatch(state,/Agent nicht erreichbar · npm run recorder:agent/);
  assert.doesNotMatch(state,/Einmal lokal starten:/);
  assert.doesNotMatch(state,/<span class="pill mono">127\.0\.0\.1:8799<\/span>/);
});

test("state editor smart-recorder script stays syntactically valid",()=>{
  const match=state.match(/<script>\n(\(\(\) => \{[\s\S]*?)\n<\/script>/);
  assert.ok(match,"inline editor script missing");
  assert.doesNotThrow(()=>new vm.Script(match[1]));
  assert.equal(match[1].includes("\\${"),false,"generated recorder interpolation must not stay escaped");
});

test("cloud recorder accepts editor URL and returns recording package",()=>{
  assert.match(recorder,/const initialUrl=q\.get\("url"\)\|\|""/);
  assert.match(recorder,/autoStart=q\.get\("autostart"\)==="1"/);
  assert.match(recorder,/definition,recording,sessionId:session/);
  assert.match(recorder,/document\.getElementById\("start"\)\.click\(\)/);
});
