"use strict";

const eventCatalog = require("./event-catalog");
const presetCatalog = require("./preset-catalog");
const presetLibrary = require("./preset-library");
const valueTypes = require("./value-types");

const CONTRACT_SCHEMA_VERSION = 2;

const VALUE_TYPES = valueTypes.valueTypeList();

const FIELD_VALUE_OPERAND = Object.freeze({
  kind: "field-value",
  schemaSource: "matchFieldSchemas.<field>"
});

const MATCH_OPERATORS = Object.freeze([
  {
    id: "equals",
    label: "Ist gleich",
    fieldTypes: ["text", "email", "number", "boolean", "url", "image"],
    operand: FIELD_VALUE_OPERAND
  },
  {
    id: "gt",
    label: "Größer als",
    fieldTypes: ["number"],
    operand: FIELD_VALUE_OPERAND
  },
  {
    id: "gte",
    label: "Mindestens",
    fieldTypes: ["number"],
    operand: FIELD_VALUE_OPERAND
  },
  {
    id: "lt",
    label: "Kleiner als",
    fieldTypes: ["number"],
    operand: FIELD_VALUE_OPERAND
  },
  {
    id: "lte",
    label: "Höchstens",
    fieldTypes: ["number"],
    operand: FIELD_VALUE_OPERAND
  },
  {
    id: "between",
    label: "Zwischen",
    fieldTypes: ["number"],
    operand: {
      kind: "range",
      jsonType: "object",
      required: ["min", "max"],
      additionalProperties: false,
      properties: {
        min: { type: "number", constraints: { finite: true, withinFieldConstraints: true } },
        minInclusive: { type: "boolean", default: true, constraints: { enum: [true, false] } },
        max: { type: "number", constraints: { finite: true, withinFieldConstraints: true } },
        maxInclusive: { type: "boolean", default: true, constraints: { enum: [true, false] } }
      },
      constraints: { ordered: true, nonEmpty: true }
    }
  }
]);

function matchFieldSchemasForEvent(event) {
  return Object.fromEntries((event.matchFields || []).map(field => {
    const schema = event.matchFieldSchemas?.[field];
    if (!schema) throw new Error(`Missing match-field schema for ${event.name}.${field}`);
    const operators = MATCH_OPERATORS
      .filter(operator => operator.fieldTypes.includes(schema.type))
      .map(operator => operator.id);
    if (!operators.length) throw new Error(`No match operators declared for ${event.name}.${field}`);
    return [field, { ...schema, operators }];
  }));
}

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
    label: "Daten ändern sich",
    description: "A global-state bus value changes.",
    settings: {
      path: { type: "text", required: false, eventPrefix: "change." }
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
    label: "Timer-Verzögerung",
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
      { name: "fetch.*.success", label: "API erfolgreich" },
      { name: "fetch.*.error", label: "API fehlgeschlagen" }
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
        matchFields: event.matchFields,
        matchFieldSchemas: matchFieldSchemasForEvent(event),
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
    matchFields: event.matchFields,
    matchFieldSchemas: matchFieldSchemasForEvent(event),
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
  const library = configOrCatalog?.presetLibrary;
  const response = eventCatalog.eventCatalogResponse(catalog);
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    provider: response.provider,
    valueTypes: VALUE_TYPES,
    matchOperators: MATCH_OPERATORS,
    connectorTypes: CONNECTOR_TYPES,
    triggerTypes: triggerTypesForCatalog(catalog),
    datasets: datasetsForCatalog(catalog),
    connectors: response.emitters,
    presetTypes: presetLibrary.presetTypesResponse(),
    presetCategories: presetCatalog.presetCategoriesResponse(library),
    presetPackages: presetCatalog.presetPackagesResponse(library),
    subscriptionPlans: presetCatalog.subscriptionPlansResponse(library),
    presets: presetCatalog.presetCatalogResponse(library),
    stateContributions: stateContributionsForCatalog(catalog)
  };
}

module.exports = {
  BUILTIN_TRIGGER_TYPES,
  CONNECTOR_TYPES,
  CONTRACT_SCHEMA_VERSION,
  MATCH_OPERATORS,
  VALUE_TYPES,
  VALUE_TYPE_CONSTRAINTS: valueTypes.VALUE_TYPE_DEFINITIONS,
  productContractResponse
};
