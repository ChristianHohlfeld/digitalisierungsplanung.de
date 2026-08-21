"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const recorder = require("./external-recorder");
const stateCore = require("../mcp/state-blueprint-core");

const PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

test("external recorder blocks local, private and metadata-style targets by default", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fc00::1", "fe80::1"]) {
    assert.equal(recorder.isBlockedIp(ip), true, ip);
  }
  for (const ip of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"]) {
    assert.equal(recorder.isBlockedIp(ip), false, ip);
  }
});

test("external recorder validates every hostname through DNS and rejects any unapproved private resolution", async () => {
  const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
  const mixedLookup = async () => [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }];
  assert.equal(await recorder.validatePublicUrl("https://example.com/a", { lookup: publicLookup }), "https://example.com/a");
  await assert.rejects(
    recorder.validatePublicUrl("https://example.com/", { lookup: mixedLookup }),
    error => error.code === "private_url_forbidden" && error.statusCode === 403
  );
  await assert.rejects(
    recorder.validatePublicUrl("http://localhost:8788/", { lookup: publicLookup }),
    error => error.code === "private_url_forbidden"
  );
  await assert.rejects(
    recorder.validatePublicUrl("file:///etc/passwd", { lookup: publicLookup }),
    error => error.code === "invalid_url_scheme"
  );
});

test("approved intranet hostnames can resolve to private addresses without opening arbitrary LAN targets", async () => {
  const intranetLookup = async () => [{ address: "10.10.0.42", family: 4 }];
  const metadataLookup = async () => [{ address: "169.254.169.254", family: 4 }];

  assert.equal(
    await recorder.validatePublicUrl("https://wob-app15.wobak.de/de/cockpit", { lookup: intranetLookup }),
    "https://wob-app15.wobak.de/de/cockpit"
  );
  assert.equal(recorder.privateHostAllowed("wob-app15.wobak.de"), true);
  assert.equal(recorder.privateHostAllowed("evil.example"), false);

  await assert.rejects(
    recorder.validatePublicUrl("https://evil.example/", { lookup: intranetLookup }),
    error => error.code === "private_url_forbidden" && error.statusCode === 403
  );
  await assert.rejects(
    recorder.validatePublicUrl("https://wob-app15.wobak.de/", { lookup: metadataLookup }),
    error => error.code === "private_url_forbidden" && error.statusCode === 403
  );
});

test("recorded external flow compiles into the canonical FSM with timer timings", () => {
  const definition = recorder.compileRecordingToDefinition({
    version: 1,
    startUrl: "https://example.com/",
    createdAt: "2026-08-21T00:00:00.000Z",
    actions: [
      { type: "click", selector: "#buy", target: { label: "Buy" }, delayMs: 1375 },
      { type: "input", selector: "#email", value: "a@example.com", delayMs: 620 }
    ],
    snapshots: [
      { url: "https://example.com/", title: "Example", image: PIXEL, atMs: 0 },
      { url: "https://example.com/cart", title: "Cart", image: PIXEL, atMs: 1375 },
      { url: "https://example.com/cart", title: "Email", image: PIXEL, atMs: 1995 }
    ]
  });

  assert.equal(definition.kind, "state-blueprint-definition");
  assert.equal(definition.schemaVersion, 2);
  assert.equal(definition.stateTemplates.length, 0);
  assert.equal(definition.model.states.length, 3);
  assert.equal(definition.model.transitions.length, 2);
  assert.deepEqual(definition.model.transitions.map(item => [item.triggerType, item.timerMs]), [["timer", 1375], ["timer", 620]]);
  assert.match(definition.model.transitions[0].label, /Klick: Buy/);
  assert.equal(definition.model.states[0].components.some(component => component.type === "image" && component.url === PIXEL), true);
  const validation = stateCore.validateModel(definition.model);
  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
});

test("recorded flow clamps only pathological replay delays and keeps normal human timing exact", () => {
  const definition = recorder.compileRecordingToDefinition({
    startUrl: "https://example.com/",
    actions: [{ type: "click", delayMs: 0 }],
    snapshots: [
      { url: "https://example.com/", title: "A", image: PIXEL },
      { url: "https://example.com/b", title: "B", image: PIXEL }
    ]
  });
  assert.equal(definition.model.transitions[0].timerMs, 100);
});

test("cloud recorder implementation still exposes real browser actions for server-side fallback", () => {
  const html = recorder.recorderHtml();
  assert.match(html, /Website aufnehmen/);
  assert.match(html, /freigegebene Intranet/);
  assert.match(html, /\/recorder\/sessions/);
  assert.match(html, /STATE_BLUEPRINT_EXTERNAL_RECORDING_RESULT/);
  assert.match(html, /Original-Website automatisch replayen/);
  assert.match(html, /Passwortwerte werden nie gespeichert/);
});

test("public recorder route no longer duplicates product recorder or replay UI", () => {
  const html = fs.readFileSync("recorder.html", "utf8");
  assert.match(html, /state\.html\?tab=recorder/);
  assert.doesNotMatch(html, /Play echter Replay|Pause\/Stop Replay|Export Replay|\.externalRecording|state-blueprint-recording-package/);
});
