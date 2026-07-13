"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MAX_ID_LENGTH = 128;
const MAX_EVENT_NAME_LENGTH = 160;
const MAX_STATE_PATH_LENGTH = 240;
const VALID_VALUE_TYPES = new Set(["text", "email", "password", "number", "boolean", "url", "image", "object", "list"]);
const VALID_EMITTER_TYPES = new Set(["sip", "email", "webhook", "data"]);
const DEFAULT_EVENT_CATALOG_PATH = path.join(__dirname, "event-catalog.json");
const DEFAULT_EVENT_CATALOG = Object.freeze({
  provider: {
    id: "digitalisierungsplanung.realtime",
    label: "Digitalisierungsplanung Realtime"
  },
  state: {
    path: "realtime",
    schema: {
      roomId: "text",
      clientId: "text",
      status: "text",
      connected: "boolean",
      joined: "boolean",
      connecting: "boolean",
      reconnectAttempt: "number",
      error: "text"
    }
  },
  events: [
    {
      name: "realtime.sip.call.incoming",
      label: "Incoming call",
      description: "SIP phone call started",
      detail: { caller: "text", callee: "text", callId: "text" },
      bindings: []
    },
    {
      name: "realtime.sip.call.answered",
      label: "Call answered",
      description: "SIP phone call was answered",
      detail: { callId: "text", agent: "text" },
      bindings: []
    },
    {
      name: "realtime.sip.call.ended",
      label: "Call ended",
      description: "SIP phone call ended",
      detail: { callId: "text", duration: "number" },
      bindings: []
    },
    {
      name: "realtime.mail.received",
      label: "Mail received",
      description: "Inbound email arrived",
      detail: { from: "email", subject: "text", messageId: "text" },
      bindings: []
    },
    {
      name: "realtime.endpoint.updated",
      label: "Endpoint updated",
      description: "External endpoint reported a new status",
      detail: { endpoint: "url", status: "number", changedAt: "text" },
      bindings: []
    },
    {
      name: "realtime.data.updated",
      label: "Data updated",
      description: "External data source reported an update",
      detail: { key: "text", value: "object" },
      bindings: []
    }
  ],
  emitters: [
    {
      id: "sip.threecx",
      type: "sip",
      label: "3CX / SIP phone system",
      description: "Business phone bridge for real call events",
      endpoint: "POST /emit",
      events: [
        "realtime.sip.call.incoming",
        "realtime.sip.call.answered",
        "realtime.sip.call.ended"
      ]
    },
    {
      id: "mail.gmail",
      type: "email",
      label: "Gmail inbox",
      description: "Gmail bridge for new email events",
      endpoint: "POST /emit",
      events: ["realtime.mail.received"]
    },
    {
      id: "mail.outlook",
      type: "email",
      label: "Outlook inbox",
      description: "Microsoft Outlook bridge for new email events",
      endpoint: "POST /emit",
      events: ["realtime.mail.received"]
    },
    {
      id: "webhook.endpoint",
      type: "webhook",
      label: "Webhook endpoint",
      description: "External systems calling a webhook bridge",
      endpoint: "POST /emit",
      events: ["realtime.endpoint.updated"]
    },
    {
      id: "data.source",
      type: "data",
      label: "Data source",
      description: "Data connector bridge for changed business data",
      endpoint: "POST /emit",
      events: ["realtime.data.updated"]
    }
  ]
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function contractError(code, message, status = 400) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  return error;
}

function assertAllowedKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw contractError("unknown_field", `${label}.${key} is not part of the event catalog contract`);
  }
}

function sanitizeId(value) {
  const text = String(value || "").trim();
  if (!text || text.length > MAX_ID_LENGTH) return "";
  return /^[a-zA-Z0-9_.:-]+$/.test(text) ? text : "";
}

function sanitizeEventName(value) {
  const text = String(value || "").trim();
  if (!text || text.length > MAX_EVENT_NAME_LENGTH) return "";
  return /^[a-zA-Z0-9_.:-]+$/.test(text) ? text : "";
}

function sanitizeStatePath(value) {
  const text = String(value || "").trim();
  if (!text || text.length > MAX_STATE_PATH_LENGTH) return "";
  return /^[a-zA-Z_][a-zA-Z0-9_:-]*(?:\.[a-zA-Z_][a-zA-Z0-9_:-]*)*$/.test(text) ? text : "";
}

function normalizeValueType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (!VALID_VALUE_TYPES.has(type)) throw contractError("invalid_value_type", `Invalid value type: ${value}`);
  return type;
}

function normalizeEmitterType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (!VALID_EMITTER_TYPES.has(type)) throw contractError("invalid_emitter_type", `Invalid emitter type: ${value}`);
  return type;
}

function normalizeSchema(value, label) {
  if (!isPlainObject(value)) throw contractError("invalid_schema", `${label} must be an object`);
  const out = {};
  for (const [rawPath, rawType] of Object.entries(value)) {
    const cleanPath = sanitizeStatePath(rawPath);
    if (!cleanPath) throw contractError("invalid_path", `${label}.${rawPath} is not a valid path`);
    if (Object.hasOwn(out, cleanPath)) throw contractError("duplicate_path", `${label}.${cleanPath} is duplicated`);
    out[cleanPath] = normalizeValueType(rawType);
  }
  return out;
}

function normalizeBindings(value, detail, eventName) {
  if (!Array.isArray(value)) throw contractError("invalid_bindings", `${eventName}.bindings must be an array`);
  return value.map((binding, index) => {
    if (!isPlainObject(binding)) throw contractError("invalid_binding", `${eventName}.bindings[${index}] must be an object`);
    assertAllowedKeys(binding, ["from", "to", "type"], `${eventName}.bindings[${index}]`);
    const from = sanitizeStatePath(binding.from);
    const to = sanitizeStatePath(binding.to);
    if (!from) throw contractError("invalid_binding_from", `${eventName}.bindings[${index}].from is invalid`);
    if (!to || !/^states\.[a-zA-Z_][a-zA-Z0-9_]*\./.test(to)) {
      throw contractError("invalid_binding_to", `${eventName}.bindings[${index}].to must target states.<id>.<field>`);
    }
    const sourceDetailPath = from.startsWith("detail.") ? from.slice("detail.".length) : from;
    if (!Object.hasOwn(detail, sourceDetailPath)) {
      throw contractError("unknown_binding_source", `${eventName}.bindings[${index}].from is not declared in detail`);
    }
    return {
      from,
      to,
      type: normalizeValueType(binding.type || detail[sourceDetailPath] || "text")
    };
  });
}

function validateEventCatalog(value) {
  if (!isPlainObject(value)) throw contractError("invalid_catalog", "Event catalog must be an object");
  assertAllowedKeys(value, ["provider", "state", "events", "emitters"], "catalog");

  const providerSource = value.provider;
  if (!isPlainObject(providerSource)) throw contractError("invalid_provider", "catalog.provider must be an object");
  assertAllowedKeys(providerSource, ["id", "label"], "catalog.provider");
  const provider = {
    id: sanitizeId(providerSource.id),
    label: String(providerSource.label || "").trim()
  };
  if (!provider.id) throw contractError("invalid_provider_id", "catalog.provider.id is invalid");
  if (!provider.label) throw contractError("invalid_provider_label", "catalog.provider.label is required");

  const stateSource = value.state;
  if (!isPlainObject(stateSource)) throw contractError("invalid_state", "catalog.state must be an object");
  assertAllowedKeys(stateSource, ["path", "schema"], "catalog.state");
  const state = {
    path: sanitizeStatePath(stateSource.path),
    schema: normalizeSchema(stateSource.schema || {}, "catalog.state.schema")
  };
  if (!state.path) throw contractError("invalid_state_path", "catalog.state.path is invalid");

  if (!Array.isArray(value.events)) throw contractError("invalid_events", "catalog.events must be an array");
  const seen = new Set();
  const events = value.events.map((event, index) => {
    if (!isPlainObject(event)) throw contractError("invalid_event", `catalog.events[${index}] must be an object`);
    assertAllowedKeys(event, ["name", "label", "description", "detail", "bindings"], `catalog.events[${index}]`);
    const name = sanitizeEventName(event.name);
    if (!name || !name.startsWith("realtime.")) throw contractError("invalid_event_name", `catalog.events[${index}].name must start with realtime.`);
    if (seen.has(name)) throw contractError("duplicate_event", `${name} is duplicated`);
    seen.add(name);
    const label = String(event.label || "").trim();
    if (!label) throw contractError("invalid_event_label", `${name}.label is required`);
    const detail = normalizeSchema(event.detail || {}, `${name}.detail`);
    return {
      name,
      label,
      description: String(event.description || "").trim(),
      detail,
      bindings: normalizeBindings(event.bindings || [], detail, name)
    };
  });
  if (!events.length) throw contractError("empty_catalog", "catalog.events must contain at least one event");
  const eventNames = new Set(events.map(event => event.name));

  if (!Array.isArray(value.emitters)) throw contractError("invalid_emitters", "catalog.emitters must be an array");
  const seenEmitters = new Set();
  const emitters = value.emitters.map((emitter, index) => {
    if (!isPlainObject(emitter)) throw contractError("invalid_emitter", `catalog.emitters[${index}] must be an object`);
    assertAllowedKeys(emitter, ["id", "type", "label", "description", "endpoint", "events"], `catalog.emitters[${index}]`);
    const id = sanitizeStatePath(emitter.id);
    if (!id) throw contractError("invalid_emitter_id", `catalog.emitters[${index}].id is invalid`);
    if (seenEmitters.has(id)) throw contractError("duplicate_emitter", `${id} is duplicated`);
    seenEmitters.add(id);
    const label = String(emitter.label || "").trim();
    if (!label) throw contractError("invalid_emitter_label", `${id}.label is required`);
    if (!Array.isArray(emitter.events) || !emitter.events.length) {
      throw contractError("empty_emitter_events", `${id}.events must contain at least one event`);
    }
    const emitterEvents = emitter.events.map((rawEventName, eventIndex) => {
      const eventName = sanitizeEventName(rawEventName);
      if (!eventName || !eventNames.has(eventName)) {
        throw contractError("unknown_emitter_event", `${id}.events[${eventIndex}] is not declared in catalog.events`);
      }
      return eventName;
    });
    if (new Set(emitterEvents).size !== emitterEvents.length) throw contractError("duplicate_emitter_event", `${id}.events contains duplicates`);
    return {
      id,
      type: normalizeEmitterType(emitter.type),
      label,
      description: String(emitter.description || "").trim(),
      endpoint: String(emitter.endpoint || "POST /emit").trim() || "POST /emit",
      events: emitterEvents
    };
  });
  if (!emitters.length) throw contractError("empty_emitters", "catalog.emitters must contain at least one emitter");
  const globalIds = new Set([provider.id, state.path]);
  for (const event of events) {
    if (globalIds.has(event.name)) throw contractError("catalog_id_collision", `${event.name} is not globally unique`);
    globalIds.add(event.name);
  }
  for (const emitter of emitters) {
    if (globalIds.has(emitter.id)) throw contractError("catalog_id_collision", `${emitter.id} is not globally unique`);
    globalIds.add(emitter.id);
  }
  for (const event of events) {
    if (!emitters.some(emitter => emitter.events.includes(event.name))) {
      throw contractError("event_without_emitter", `${event.name} has no emitter`);
    }
  }

  return { provider, state, events, emitters };
}

function serializeEventCatalog(catalog) {
  return `${JSON.stringify(validateEventCatalog(catalog), null, 2)}\n`;
}

function loadEventCatalogFile(catalogPath = DEFAULT_EVENT_CATALOG_PATH) {
  return validateEventCatalog(JSON.parse(fs.readFileSync(catalogPath, "utf8")));
}

function loadEventCatalog(options = {}, env = process.env) {
  if (options.eventCatalog) return validateEventCatalog(options.eventCatalog);
  const catalogPath = options.eventCatalogPath || env.REALTIME_EVENT_CATALOG_PATH || DEFAULT_EVENT_CATALOG_PATH;
  return loadEventCatalogFile(catalogPath);
}

function eventStateRoot(eventName) {
  return `events.${eventName}`;
}

function emitterStateRoot(emitterId) {
  return `emitters.${emitterId}`;
}

function emitterContributes(emitterId) {
  const root = emitterStateRoot(emitterId);
  return {
    root,
    fields: [
      `${root}.count`,
      `${root}.lastAt`,
      `${root}.lastEvent`,
      `${root}.lastDetail`,
      `${root}.status`,
      `${root}.error`
    ]
  };
}

function eventCatalogResponse(catalog) {
  return {
    provider: catalog.provider,
    state: catalog.state,
    events: catalog.events.map(event => ({
      ...event,
      contributes: {
        root: eventStateRoot(event.name),
        fields: [
          `${eventStateRoot(event.name)}.count`,
          `${eventStateRoot(event.name)}.lastAt`,
          `${eventStateRoot(event.name)}.detail`,
          ...Object.keys(event.detail).map(path => `${eventStateRoot(event.name)}.detail.${path}`)
        ]
      }
    })),
    emitters: catalog.emitters.map(emitter => ({
      ...emitter,
      contributes: emitterContributes(emitter.id)
    }))
  };
}

function detailTypeMatches(value, type) {
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "object") return isPlainObject(value);
  if (type === "list") return Array.isArray(value);
  return typeof value === "string";
}

function validateEventDetail(detail, schema) {
  if (!isPlainObject(detail)) return { ok: false, code: "invalid_detail" };
  for (const key of Object.keys(detail)) {
    if (!Object.hasOwn(schema, key)) return { ok: false, code: "unknown_detail_field" };
  }
  for (const [key, type] of Object.entries(schema)) {
    if (!Object.hasOwn(detail, key)) return { ok: false, code: "missing_detail_field" };
    if (!detailTypeMatches(detail[key], type)) return { ok: false, code: "invalid_detail_type" };
  }
  return { ok: true };
}

module.exports = {
  DEFAULT_EVENT_CATALOG,
  DEFAULT_EVENT_CATALOG_PATH,
  VALID_EMITTER_TYPES,
  VALID_VALUE_TYPES,
  contractError,
  eventCatalogResponse,
  emitterContributes,
  emitterStateRoot,
  loadEventCatalog,
  loadEventCatalogFile,
  sanitizeEventName,
  sanitizeId,
  sanitizeStatePath,
  serializeEventCatalog,
  validateEventCatalog,
  validateEventDetail
};
