"use strict";

const eventCatalog = require("./event-catalog");
const presetCatalog = require("./preset-catalog");
const valueTypes = require("./value-types");

const CONTRACT_SCHEMA_VERSION = 1;

const VALUE_TYPES = valueTypes.valueTypeList();

const CONNECTOR_TYPES = [...eventCatalog.VALID_EMITTER_TYPES].map(id => ({
  id,
  label: id === "sip" ? "SIP" : id[0].toUpperCase() + id.slice(1)
}));

const BUILTIN_TRIGGER_TYPES = Object.freeze([
  {
    id: "button",
    label: "Klick",
    description: "User activates a rendered transition action.",
    settings: {},
    events: [{ name: "button.*", label: "Button click" }]
  },
  {
    id: "change",
    label: "Daten aendern sich",
    description: "A global-state bus value changes.",
    settings: {
      path: { type: "text", required: false, eventPrefix: "change." }
    },
    events: []
  },
  {
    id: "event",
    label: "Bus-Ereignis",
    description: "A named runtime event is emitted inside the global bus.",
    settings: {
      name: { type: "text", required: true }
    },
    events: []
  },
  {
    id: "realtime",
    label: "Realtime-Ereignis",
    description: "A catalogued server realtime event arrives in the room.",
    settings: {},
    events: []
  },
  {
    id: "timer",
    label: "Timer-Verzoegerung",
    description: "The active state waits for a configured delay.",
    settings: {
      timerMs: { type: "number", min: 100, max: 300000, step: 100, default: 2000 }
    },
    events: [{ name: "timer.*", label: "Timer elapsed" }]
  },
  {
    id: "auto",
    label: "Sofort",
    description: "The transition fires immediately when the state becomes active.",
    settings: {},
    events: [{ name: "auto.*", label: "State entered" }]
  },
  {
    id: "flow",
    label: "Ablauf",
    description: "Internal composite-state routing owned by the flow contract.",
    internal: true,
    settings: {},
    events: [{
      id: "flow.child.entry",
      name: "flow.child.entry",
      internal: true,
      label: "Unterablauf betreten"
    }]
  },
  {
    id: "api",
    label: "API-Antwort",
    description: "A state data-source request succeeds or fails.",
    settings: {},
    events: [
      { name: "fetch.ok", label: "API ok" },
      { name: "fetch.error", label: "API error" }
    ]
  }
]);

function triggerTypesForCatalog(catalog) {
  const response = eventCatalog.eventCatalogResponse(catalog);
  return BUILTIN_TRIGGER_TYPES.map(trigger => {
    if (trigger.id !== "realtime") return trigger;
    return {
      ...trigger,
      events: response.events.map(event => ({
        name: event.name,
        label: event.label,
        description: event.description,
        detail: event.detail,
        detailSchemas: event.detailSchemas,
        contributes: event.contributes
      }))
    };
  });
}

function datasetsForCatalog(catalog) {
  const response = eventCatalog.eventCatalogResponse(catalog);
  return response.events.map(event => ({
    id: event.name,
    type: "realtime",
    key: event.name.replace(/^realtime\./, ""),
    label: event.label,
    description: event.description,
    fields: event.detail,
    fieldSchemas: event.detailSchemas,
    contributes: event.contributes
  }));
}

function stateContributionsForCatalog(catalog) {
  const response = eventCatalog.eventCatalogResponse(catalog);
  const runtimeFieldTypes = Object.fromEntries(
    Object.entries(response.state.schema || {}).map(([path, type]) => [`${response.state.path}.${path}`, type])
  );
  return [
    {
      id: response.state.path,
      source: "runtime",
      root: response.state.path,
      fields: Object.keys(response.state.schema).map(path => `${response.state.path}.${path}`),
      fieldTypes: runtimeFieldTypes,
      fieldSchemas: valueTypes.fieldSchemasFromTypeMap(runtimeFieldTypes)
    },
    ...response.events.map(event => ({
      id: event.name,
      source: "event",
      root: event.contributes.root,
      fields: event.contributes.fields,
      fieldTypes: event.contributes.fieldTypes,
      fieldSchemas: event.contributes.fieldSchemas
    })),
    ...response.emitters.map(emitter => ({
      id: emitter.id,
      source: "connector",
      root: emitter.contributes.root,
      fields: emitter.contributes.fields,
      fieldTypes: emitter.contributes.fieldTypes,
      fieldSchemas: emitter.contributes.fieldSchemas
    }))
  ];
}

function productContractResponse(configOrCatalog) {
  const catalog = configOrCatalog?.eventCatalog || configOrCatalog;
  const response = eventCatalog.eventCatalogResponse(catalog);
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    provider: response.provider,
    valueTypes: VALUE_TYPES,
    connectorTypes: CONNECTOR_TYPES,
    triggerTypes: triggerTypesForCatalog(catalog),
    datasets: datasetsForCatalog(catalog),
    connectors: response.emitters,
    presetPackages: presetCatalog.presetPackagesResponse(),
    subscriptionPlans: presetCatalog.subscriptionPlansResponse(),
    presets: presetCatalog.presetCatalogResponse(),
    stateContributions: stateContributionsForCatalog(catalog)
  };
}

module.exports = {
  BUILTIN_TRIGGER_TYPES,
  CONNECTOR_TYPES,
  CONTRACT_SCHEMA_VERSION,
  VALUE_TYPES,
  VALUE_TYPE_CONSTRAINTS: valueTypes.VALUE_TYPE_DEFINITIONS,
  productContractResponse
};
