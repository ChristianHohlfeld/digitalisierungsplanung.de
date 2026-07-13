"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEFAULT_EVENT_CATALOG,
  eventCatalogResponse,
  serializeEventCatalog,
  validateEventCatalog,
  validateEventDetail
} = require("./event-catalog");

test("validates the realtime event catalog as the single server contract", () => {
  const catalog = validateEventCatalog(DEFAULT_EVENT_CATALOG);
  assert.equal(catalog.provider.id, "digitalisierungsplanung.realtime");
  assert.equal(catalog.state.path, "realtime");
  assert.ok(catalog.events.some(event => event.name === "realtime.sip.call.incoming"));
  assert.ok(catalog.emitters.some(emitter => emitter.id === "sip.threecx"));
  assert.ok(catalog.emitters.some(emitter => emitter.id === "mail.outlook"));
  assert.match(serializeEventCatalog(catalog), /"realtime\.sip\.call\.incoming"/);
});

test("rejects catalog fields outside the contract instead of silently normalizing", () => {
  assert.throws(
    () => validateEventCatalog({ ...DEFAULT_EVENT_CATALOG, version: 1 }),
    error => error.code === "unknown_field"
  );
  assert.throws(
    () => validateEventCatalog({
      ...DEFAULT_EVENT_CATALOG,
      provider: { ...DEFAULT_EVENT_CATALOG.provider, version: 1 }
    }),
    error => error.code === "unknown_field"
  );
  assert.throws(
    () => validateEventCatalog({
      ...DEFAULT_EVENT_CATALOG,
      events: [
        DEFAULT_EVENT_CATALOG.events[0],
        DEFAULT_EVENT_CATALOG.events[0]
      ]
    }),
    error => error.code === "duplicate_event"
  );
  assert.throws(
    () => validateEventCatalog({
      ...DEFAULT_EVENT_CATALOG,
      events: [{ ...DEFAULT_EVENT_CATALOG.events[0], name: "button.clicked" }]
    }),
    error => error.code === "invalid_event_name"
  );
  assert.throws(
    () => validateEventCatalog({
      ...DEFAULT_EVENT_CATALOG,
      emitters: [{ ...DEFAULT_EVENT_CATALOG.emitters[0], id: "sip.threecx" }, { ...DEFAULT_EVENT_CATALOG.emitters[0], id: "sip.threecx" }]
    }),
    error => error.code === "duplicate_emitter"
  );
  assert.throws(
    () => validateEventCatalog({
      ...DEFAULT_EVENT_CATALOG,
      emitters: [{ ...DEFAULT_EVENT_CATALOG.emitters[0], id: "realtime.sip.call.incoming" }]
    }),
    error => error.code === "catalog_id_collision"
  );
});

test("exposes each event contribution to the unique global state tree", () => {
  const response = eventCatalogResponse(validateEventCatalog(DEFAULT_EVENT_CATALOG));
  const incoming = response.events.find(event => event.name === "realtime.sip.call.incoming");
  const emitter = response.emitters.find(item => item.id === "sip.threecx");
  assert.equal(response.state.path, "realtime");
  assert.equal(incoming.contributes.root, "events.realtime.sip.call.incoming");
  assert.deepEqual(incoming.contributes.fields, [
    "events.realtime.sip.call.incoming.count",
    "events.realtime.sip.call.incoming.lastAt",
    "events.realtime.sip.call.incoming.detail",
    "events.realtime.sip.call.incoming.detail.caller",
    "events.realtime.sip.call.incoming.detail.callee",
    "events.realtime.sip.call.incoming.detail.callId"
  ]);
  assert.equal(emitter.contributes.root, "emitters.sip.threecx");
  assert.ok(emitter.contributes.fields.includes("emitters.sip.threecx.lastEvent"));
});

test("validates runtime event detail against the catalog detail schema", () => {
  const schema = DEFAULT_EVENT_CATALOG.events[0].detail;
  assert.deepEqual(
    validateEventDetail({ caller: "+491234", callee: "100", callId: "abc-123" }, schema),
    { ok: true }
  );
  assert.deepEqual(
    validateEventDetail({ caller: "+491234", callId: "abc-123" }, schema),
    { ok: false, code: "missing_detail_field" }
  );
  assert.deepEqual(
    validateEventDetail({ caller: "+491234", callee: "100", callId: "abc-123", extra: "x" }, schema),
    { ok: false, code: "unknown_detail_field" }
  );
  assert.deepEqual(
    validateEventDetail({ caller: "+491234", callee: "100", callId: 123 }, schema),
    { ok: false, code: "invalid_detail_type" }
  );
});
