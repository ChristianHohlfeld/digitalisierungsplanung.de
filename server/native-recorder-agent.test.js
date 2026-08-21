"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  fieldFromAction,
  listenerForAction,
  originAllowed,
  projectFromRecording,
  triggerContextForAction
} = require("./native-recorder-agent");

function sampleRecording() {
  return {
    startUrl: "https://wob-app15.wobak.de/de/cockpit",
    viewport: { width: 1200, height: 800 },
    actions: [
      { type: "click", selector: "#login", target: { label: "Login" }, delayMs: 120 },
      { type: "input", selector: "#mail", value: "a@b.de", target: { label: "E-Mail", inputType: "email" }, delayMs: 180 },
      { type: "input", selector: "#accept", checked: true, target: { label: "Freigabe", inputType: "checkbox" }, delayMs: 90 }
    ],
    snapshots: [0,1,2,3].map(index => ({ atMs: index * 100, url: `https://wob-app15.wobak.de/${index}`, title: `S${index}`, image: `data:image/jpeg;base64,${index}` }))
  };
}

test("recording compiles into the focused state-input project contract", () => {
  const project = projectFromRecording(sampleRecording(), { id: "project_demo", name: "Demo" });
  assert.equal(project.kind, "zustand-project");
  assert.equal(project.version, 1);
  assert.equal(project.states.length, 4);
  assert.equal(project.transitions.length, 3);
  assert.equal(project.states[0].trigger.type, "interaction");
  assert.equal(project.transitions[0].listener.type, "click");
  assert.equal(project.transitions[1].listener.type, "input");
  assert.equal(project.transitions[1].listener.value, "a@b.de");
});

test("checkboxes and text inputs become distinct context-aware rule fields", () => {
  const project = projectFromRecording(sampleRecording());
  assert.match(project.states[1].fields[0].path, /^states\.state_002\..+\.value$/);
  assert.equal(project.states[1].fields[0].type, "email");
  assert.match(project.states[2].fields[0].path, /^states\.state_003\..+\.checked$/);
  assert.equal(project.states[2].fields[0].type, "boolean");
});

test("state owns trigger context while transition owns concrete listener", () => {
  assert.equal(triggerContextForAction({ type: "click" }), "interaction");
  assert.equal(triggerContextForAction({ type: "input" }), "interaction");
  assert.equal(triggerContextForAction({ type: "event" }), "event");
  assert.deepEqual(listenerForAction({ type: "key", key: "Enter", selector: "#search" }), { type: "key", selector: "#search", key: "Enter" });
});

test("password-like replay data stays redacted", () => {
  const listener = listenerForAction({ type: "input", selector: "#password", redacted: true, value: "secret" });
  assert.equal(listener.redacted, true);
  assert.equal(Object.hasOwn(listener, "value"), false);
});

test("local agent permits the product origin and loopback editor origins only", () => {
  assert.equal(originAllowed("https://digitalisierungsplanung.de"), true);
  assert.equal(originAllowed("http://127.0.0.1:8080"), true);
  assert.equal(originAllowed("https://evil.example"), false);
});
