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
      { seq: 1, at: 1000, kind: "visual", app: "Freigegebenes Fenster", window: "Posteingang", value: "must-not-survive" },
      { seq: 2, at: 1200, kind: "visual", app: "Freigegebenes Fenster", window: "Rechnung geöffnet" },
      { seq: 3, at: 1500, kind: "visual", app: "Freigegebenes Fenster", window: "Rechnung geprüft" }
    ],
    frames: [],
    ...overrides
  };
}

test("validates browser display changes without accepting extra event data", () => {
  const validated = validateCapture(capture());
  assert.equal(validated.events.length, 3);
  assert.equal(validated.events[0].value, undefined);
  assert.deepEqual(validated.events[2], {
    seq: 3,
    at: 1500,
    kind: "visual",
    app: "Freigegebenes Fenster",
    window: "Rechnung geprüft"
  });
});

test("rejects native event aliases outside the browser-display contract", () => {
  assert.throws(
    () => validateCapture(capture({ events: [{ seq: 1, at: 1, kind: "click", app: "legacy", window: "legacy" }] })),
    error => error?.code === "invalid_capture_event_kind"
  );
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

test("classifies OpenAI rejection without exposing its message or credentials", async () => {
  const analyzer = createProcessAnalyzer({
    openAiApiKey: "secret-test-key",
    model: "gpt-5.6-luna",
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      headers: { get: name => name === "x-request-id" ? "req-safe-123" : null },
      json: async () => ({
        error: {
          code: "insufficient_quota",
          message: "sensitive provider message"
        }
      })
    })
  });

  await assert.rejects(
    analyzer.analyze(capture()),
    error => {
      assert.equal(error.code, "process_provider_rate_limited");
      assert.equal(error.providerStatus, 429);
      assert.equal(error.providerCode, "insufficient_quota");
      assert.equal(error.providerRequestId, "req-safe-123");
      assert.doesNotMatch(JSON.stringify(error), /secret-test-key|sensitive provider message/);
      return true;
    }
  );
});

test("browser display recording is install-free, tab-aware, idle-paused, and non-persistent", () => {
  const editor = fs.readFileSync(path.join(__dirname, "..", "state.html"), "utf8");
  assert.match(editor, /getDisplayMedia/);
  assert.match(editor, /surfaceSwitching: "include"/);
  assert.match(editor, /recording\.idle = true/);
  assert.match(editor, /recording\.liveAnalysisCount >= recording\.maxLiveAnalyses/);
  assert.doesNotMatch(editor, /127\.0\.0\.1:43127|Zustand-Recorder|Zustand-Prozessrecorder/);
});
