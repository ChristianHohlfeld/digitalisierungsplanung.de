"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const recorder = require("./external-recorder");
const { projectFromRecording } = require("./native-recorder-agent");
const stateCore = require("../mcp/state-blueprint-core");

const PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

test("external website recording keeps the editor model contract-valid and carries real replay data separately", () => {
  const definition = recorder.compileRecordingToDefinition({
    version: 1,
    startUrl: "https://example.com/",
    createdAt: "2026-08-21T00:00:00.000Z",
    actions: [
      { type: "click", selector: "#search", x: 144, y: 88, target: { label: "Suche" }, delayMs: 430 },
      { type: "input", selector: "#q", value: "digitalisierung", target: { label: "Suchfeld", inputType: "text" }, delayMs: 710 },
      { type: "key", selector: "#q", key: "Enter", target: { label: "Suchfeld" }, delayMs: 280 },
      { type: "scroll", deltaY: 520, deltaX: 0, delayMs: 900 }
    ],
    snapshots: [
      { url: "https://example.com/", title: "Start", image: PIXEL, atMs: 0 },
      { url: "https://example.com/", title: "Suche fokussiert", image: PIXEL, atMs: 430 },
      { url: "https://example.com/", title: "Eingabe", image: PIXEL, atMs: 1140 },
      { url: "https://example.com/search?q=digitalisierung", title: "Resultate", image: PIXEL, atMs: 1420 },
      { url: "https://example.com/search?q=digitalisierung", title: "Resultate gescrollt", image: PIXEL, atMs: 2320 }
    ]
  });

  const validation = stateCore.validateModel(definition.model);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  assert.deepEqual(
    definition.model.transitions.map(transition => ({ label: transition.label, triggerType: transition.triggerType, timerMs: transition.timerMs })),
    [
      { label: "Klick: Suche", triggerType: "timer", timerMs: 430 },
      { label: "Eingabe", triggerType: "timer", timerMs: 710 },
      { label: "Taste: Enter", triggerType: "timer", timerMs: 280 },
      { label: "Scroll ↓", triggerType: "timer", timerMs: 900 }
    ]
  );
});

test("unified recorder keeps real replay data at project level instead of stuffing it into states", () => {
  const project = projectFromRecording({
    startUrl: "https://example.com/",
    viewport: { width: 1024, height: 640 },
    actions: [{ type: "click", selector: "#next", target: { label: "Weiter" }, delayMs: 300 }],
    snapshots: [
      { url: "https://example.com/", title: "Start", image: PIXEL, atMs: 0 },
      { url: "https://example.com/next", title: "Weiter", image: PIXEL, atMs: 300 }
    ]
  }, { id: "project_contract" });

  assert.equal(project.kind, "zustand-project");
  assert.equal(project.recording.actions.length, 1);
  assert.equal(project.states.length, 2);
  assert.equal(project.transitions.length, 1);
  assert.equal(Object.hasOwn(project.states[0], "recording"), false);
  assert.equal(Object.hasOwn(project.transitions[0], "recording"), false);
});
