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

test("rejects invalid catalog shape and colliding contract paths", () => {
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
      events: [
        ...DEFAULT_EVENT_CATALOG.events,
        {
          name: "realtime.sip.call",
          label: "Call",
          description: "",
          detail: { value: "text" },
          bindings: []
        }
      ],
      emitters: [
        {
          ...DEFAULT_EVENT_CATALOG.emitters[0],
          events: [...DEFAULT_EVENT_CATALOG.emitters[0].events, "realtime.sip.call"]
        },
        ...DEFAULT_EVENT_CATALOG.emitters.slice(1)
      ]
    }),
    error => error.code === "catalog_path_collision"
  );
  assert.throws(
    () => validateEventCatalog({
      ...DEFAULT_EVENT_CATALOG,
      events: [{ ...DEFAULT_EVENT_CATALOG.events[0], detail: { customer: "object", "customer.id": "text" } }]
    }),
    error => error.code === "catalog_path_collision"
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
  assert.throws(
    () => validateEventCatalog({
      ...DEFAULT_EVENT_CATALOG,
      emitters: [
        ...DEFAULT_EVENT_CATALOG.emitters,
        { ...DEFAULT_EVENT_CATALOG.emitters[1], id: "sip.threecx.child" }
      ]
    }),
    error => error.code === "catalog_path_collision"
  );
});

test("accepts new server-contract datasets with strict typed fields", () => {
  const catalog = validateEventCatalog({
    ...DEFAULT_EVENT_CATALOG,
    events: [
      ...DEFAULT_EVENT_CATALOG.events,
      {
        name: "realtime.sip.call.missed",
        label: "Missed call",
        description: "SIP call was not answered",
        detail: { caller: "text", callId: "text", missedAt: "text" },
        bindings: []
      }
    ],
    emitters: [
      {
        ...DEFAULT_EVENT_CATALOG.emitters[0],
        events: [...DEFAULT_EVENT_CATALOG.emitters[0].events, "realtime.sip.call.missed"]
      },
      ...DEFAULT_EVENT_CATALOG.emitters.slice(1)
    ]
  });
  const response = eventCatalogResponse(catalog);
  const missed = response.events.find(event => event.name === "realtime.sip.call.missed");
  assert.equal(missed.contributes.root, "events.realtime.sip.call.missed");
  assert.ok(missed.contributes.fields.includes("events.realtime.sip.call.missed.detail.missedAt"));
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

test("validates runtime event detail against field constraints, not only base types", () => {
  assert.deepEqual(
    validateEventDetail({ from: "not-an-email" }, { from: "email" }),
    { ok: false, code: "invalid_detail_value" }
  );
  assert.deepEqual(
    validateEventDetail({ endpoint: "ftp://example.com" }, { endpoint: "url" }),
    { ok: false, code: "invalid_detail_value" }
  );
  assert.deepEqual(
    validateEventDetail({ duration: Number.MAX_SAFE_INTEGER + 1 }, { duration: "number" }),
    { ok: false, code: "invalid_detail_value" }
  );
});
