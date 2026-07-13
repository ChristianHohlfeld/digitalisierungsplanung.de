"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  validateCapture,
  modelFromTrace,
  createProcessAnalyzer
} = require("./process-recorder");

function capture(overrides = {}) {
  return {
    sessionId: "session-1",
    startedAt: 1000,
    endedAt: 2000,
    events: [
      { seq: 1, at: 1000, kind: "application", app: "outlook", window: "Posteingang", value: "must-not-survive" },
      { seq: 2, at: 1200, kind: "click", app: "outlook", window: "Posteingang", button: "left", control: { name: "Rechnung öffnen", type: "Button", automationId: "open", password: false, value: "secret" } },
      { seq: 3, at: 1500, kind: "input", app: "erp", window: "Rechnung", keyCount: 12, control: { name: "Textfeld", type: "Edit", automationId: "invoice", password: false } }
    ],
    frames: [],
    ...overrides
  };
}

test("validates redacted desktop capture without accepting field values", () => {
  const validated = validateCapture(capture());
  assert.equal(validated.events.length, 3);
  assert.equal(validated.events[0].value, undefined);
  assert.equal(validated.events[1].control.value, undefined);
  assert.deepEqual(validated.events[2], {
    seq: 3,
    at: 1500,
    kind: "input",
    app: "erp",
    window: "Rechnung",
    control: { name: "Textfeld", type: "Edit", automationId: "invoice", password: false },
    keyCount: 12
  });
});

test("builds one deterministic contract-valid linear model from an observed trace", () => {
  const trace = {
    title: "Rechnung prüfen",
    steps: [
      { title: "Posteingang", description: "Rechnung liegt vor.", actionToNext: "Rechnung öffnen" },
      { title: "Rechnung prüfen", description: "Die Rechnung wird fachlich geprüft.", actionToNext: "Freigeben" },
      { title: "Freigegeben", description: "Die Prüfung ist abgeschlossen.", actionToNext: "" }
    ]
  };
  const first = modelFromTrace(trace);
  const second = modelFromTrace(trace);
  assert.equal(first.validation.ok, true);
  assert.deepEqual(first.model, second.model);
  assert.equal(first.model.initial, "posteingang");
  assert.deepEqual(first.model.transitions.map(item => item.label), ["Rechnung öffnen", "Freigeben"]);
  assert.ok(first.model.transitions.every(item => item.triggerType === "button" && item.triggerEvent === `button.${item.id}`));
});

test("runs an injected agent without retaining a second model", async () => {
  let received = null;
  const analyzer = createProcessAnalyzer({
    analyzer: async value => {
      received = value;
      return {
        title: "Aufgenommener Ablauf",
        steps: [
          { title: "Start", description: "Arbeit beginnt.", actionToNext: "Weiter" },
          { title: "Fertig", description: "Arbeit endet.", actionToNext: "" }
        ]
      };
    }
  });
  const result = await analyzer.analyze(capture());
  assert.equal(analyzer.enabled, true);
  assert.equal(result.contract, "zustand-process-model-v1");
  assert.equal(result.summary.states, 2);
  assert.equal(received.events[0].value, undefined);
  assert.equal("trace" in result, false);
});

test("OpenAI agent disables response storage and uses strict structured output", async () => {
  let request = null;
  const analyzer = createProcessAnalyzer({
    openAiApiKey: "test-key",
    model: "test-model",
    fetchImpl: async (url, init) => {
      request = { url, init, body: JSON.parse(init.body) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          output_text: JSON.stringify({
            title: "Ablauf",
            steps: [{ title: "Start", description: "Beginn", actionToNext: "" }]
          })
        })
      };
    }
  });
  const result = await analyzer.analyze(capture());
  assert.equal(result.summary.states, 1);
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.body.store, false);
  assert.equal(request.body.text.format.type, "json_schema");
  assert.equal(request.body.text.format.strict, true);
  assert.equal(request.init.cache, "no-store");
});

test("Windows companion is loopback-only, visible, redacted, and non-persistent", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "tools", "process-recorder", "ZustandRecorder.cs"), "utf8");
  assert.match(source, /new TcpListener\(IPAddress\.Loopback, Port\)/);
  assert.match(source, /new NotifyIcon/);
  assert.match(source, /Access-Control-Allow-Private-Network: true/);
  assert.match(source, /HTTP\/1\.1 100 Continue/);
  assert.match(source, /password\) name = "Passwortfeld"/);
  assert.doesNotMatch(source, /ToUnicode|GetKeyboardState|ValuePattern|Registry\.|File\.Write|FileStream/);
  assert.equal(fs.existsSync(path.join(__dirname, "..", "assets", "Zustand-Prozessrecorder.zip")), true);
});
