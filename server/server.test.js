"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const presetCatalog = require("./preset-catalog");
const productContract = require("./product-contract");
const recorder = require("./recorder");
const { createAppServer } = require("./server");

function shot(index) {
  return {
    image: "data:image/jpeg;base64,AA==",
    checkpoint: { url: `https://example.com/${index}`, title: `Seite ${index}`, fingerprint: `fingerprint-${index}` }
  };
}

test("product contract exposes only the focused flow surface", () => {
  const contract = productContract.productContractResponse();
  assert.equal(contract.schema, "flow/1");
  assert.equal(contract.flow.recording.schema, "website-recording/1");
  assert.deepEqual(contract.presets.map(item => item.id), presetCatalog.BASIC_PRESET_IDS);
  assert.deepEqual(contract.presetCategories.map(item => item.id), ["basic"]);
  assert.equal(contract.presetPackages, undefined);
  assert.equal(contract.subscriptionPlans, undefined);
  assert.equal(contract.connectors, undefined);
  assert.equal(contract.datasets, undefined);
  assert.ok(JSON.stringify(contract).length < 40_000);
});

test("recording compilation keeps an exact step-transition bijection", () => {
  const result = recorder.compileRecording({
    id: "recording-1",
    startUrl: "https://example.com/0",
    createdAt: "2026-08-22T00:00:00Z",
    viewport: { width: 1120, height: 720 },
    actions: [
      { type: "click", delayMs: 350, locator: { role: "button", name: "Weiter" } },
      { type: "input", delayMs: 220, locator: { role: "textbox", name: "Name" }, value: "Ada" }
    ],
    snapshots: [shot(0), shot(1), shot(2)]
  });
  assert.equal(result.definition.model.states.length, 3);
  assert.equal(result.definition.model.transitions.length, 2);
  assert.deepEqual(result.recording.steps.map(step => step.transitionId), ["recorded_t_001", "recorded_t_002"]);
  assert.deepEqual(result.recording.steps.map(step => [step.fromStateId, step.toStateId]), [["recorded_001", "recorded_002"], ["recorded_002", "recorded_003"]]);
  assert.equal(result.recording.initialCheckpoint.fingerprint, "fingerprint-0");
  assert.doesNotThrow(() => recorder.validateRecordingPackage(result.recording, result.definition.model));
  assert.doesNotThrow(() => recorder.validateReplayPackage(result.recording));
});

test("recording compilation never serializes password values", () => {
  const secret = "do-not-store-this-password";
  const result = recorder.compileRecording({
    id: "recording-secret",
    startUrl: "https://example.com/0",
    createdAt: "2026-08-22T00:00:00Z",
    viewport: { width: 1120, height: 720 },
    actions: [{
      type: "input",
      delayMs: 100,
      locator: { role: "textbox", name: "Passwort", inputType: "password" },
      value: secret
    }],
    snapshots: [shot(0), shot(1)]
  });
  assert.equal(result.recording.steps[0].action.redacted, true);
  assert.equal(result.recording.steps[0].action.secretRef, "step_1");
  assert.equal(result.recording.steps[0].action.value, undefined);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("durable replay package rejects repeated state ids", () => {
  assert.throws(() => recorder.validateReplayPackage({
    schema: "website-recording/1",
    startUrl: "https://example.com",
    initialStateId: "recorded_001",
    initialCheckpoint: { fingerprint: "start" },
    snapshotCount: 2,
    steps: [{
      id: "step_001",
      transitionId: "recorded_t_001",
      fromStateId: "recorded_001",
      toStateId: "recorded_001",
      action: { type: "click" },
      checkpoint: { fingerprint: "end" }
    }]
  }), error => error.code === "recording_bijection_invalid");
});

test("recording compilation rejects missing visual checkpoints", () => {
  assert.throws(() => recorder.compileRecording({
    id: "broken",
    startUrl: "https://example.com",
    createdAt: "2026-08-22T00:00:00Z",
    viewport: { width: 1120, height: 720 },
    actions: [{ type: "click" }],
    snapshots: [shot(0)]
  }), error => error.code === "recording_shape_invalid");
});

test("recorder URL guard blocks private and metadata targets", async () => {
  await assert.rejects(() => recorder.validatePublicUrl("http://127.0.0.1"), error => error.code === "private_url_forbidden");
  await assert.rejects(() => recorder.validatePublicUrl("http://169.254.169.254/latest/meta-data"), error => error.code === "private_url_forbidden");
  await assert.rejects(() => recorder.validatePublicUrl("https://internal.example", { lookup: async () => [{ address: "10.0.0.4", family: 4 }] }), error => error.code === "private_url_forbidden");
  assert.equal(await recorder.validatePublicUrl("https://example.com/a", { lookup: async () => [{ address: "93.184.216.34", family: 4 }] }), "https://example.com/a");
});

test("minimal runtime serves health, contract and recorder API", async t => {
  const calls = [];
  const fakeManager = {
    async startSession(url, client) { calls.push(["start", url, client]); return { sessionId: "11111111-1111-1111-1111-111111111111", current: shot(0), viewport: { width: 1120, height: 720 } }; },
    async performAction(id, body) { calls.push(["action", id, body]); return { sessionId: id, current: shot(1) }; },
    async finishSession(id) { calls.push(["finish", id]); return { definition: { model: { states: [], transitions: [] } }, recording: { schema: "website-recording/1", steps: [] } }; },
    async startPackageReplay(recording, client) { calls.push(["package-replay", recording, client]); return { sessionId: "22222222-2222-2222-2222-222222222222", stateId: "recorded_001", verified: true }; },
    async startReplay(id) { calls.push(["replay-start", id]); return { stateId: "recorded_001", verified: true }; },
    async replayNext(id) { calls.push(["replay-next", id]); return { done: true, verified: true }; },
    async stopReplay(id) { calls.push(["replay-stop", id]); return { ok: true }; },
    async cancelSession(id) { calls.push(["cancel", id]); return true; },
    async close() {}
  };
  const app = createAppServer({
    port: 0,
    recorderManager: fakeManager,
    recorderReady: true,
    allowedOrigins: ["https://digitalisierungsplanung.de"],
    release: { id: "release-test", sequence: 1, builtAt: "", sourceCommit: "", deployedCommit: "" }
  });
  await app.listen();
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const health = await fetch(base + "/healthz").then(response => response.json());
  assert.deepEqual(health, { ok: true, service: "flow-runtime", recorderReady: true, releaseId: "release-test", releaseSequence: 1 });
  const contract = await fetch(base + "/contract").then(response => response.json());
  assert.equal(contract.schema, "flow/1");
  assert.equal(contract.presets.length, 13);
  const page = await fetch(base + "/recorder.html");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors https:\/\/digitalisierungsplanung\.de/);

  const forbidden = await fetch(base + "/contract", { headers: { origin: "https://evil.example" } });
  assert.equal(forbidden.status, 403);
  const started = await fetch(base + "/recorder/sessions", {
    method: "POST",
    headers: { origin: "https://digitalisierungsplanung.de", "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com" })
  });
  assert.equal(started.status, 201);
  assert.equal(started.headers.get("access-control-allow-origin"), "https://digitalisierungsplanung.de");
  assert.equal(calls[0][0], "start");
  assert.equal(calls[0][1], "https://example.com");
  const packaged = await fetch(base + "/recorder/replays", {
    method: "POST",
    headers: { origin: "https://digitalisierungsplanung.de", "content-type": "application/json" },
    body: JSON.stringify({ recording: { schema: "website-recording/1" } })
  });
  assert.equal(packaged.status, 201);
  assert.equal(calls.at(-1)[0], "package-replay");
});
