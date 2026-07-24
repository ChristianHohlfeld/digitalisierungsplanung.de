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
    label: "Daten ändern sich",
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

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
        matchFieldSchemas: event.matchFieldSchemas,
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
    matchFieldSchemas: event.matchFieldSchemas,
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

function managedDaisyRoot(preset) {
  if (preset?.builtIn !== false || !Array.isArray(preset.components)) return "";
  if (!preset.components.some(component => component?.type === "daisy")) return "";
  const root = String(preset.stateContribution?.root || "").trim();
  return /^states\.[A-Za-z_][A-Za-z0-9_]*$/.test(root) ? root : "";
}

function normalizeManagedDaisyPreset(preset) {
  const root = managedDaisyRoot(preset);
  if (!root) return preset;
  const target = `${root}.view`;
  let changed = false;
  const components = preset.components.map(component => {
    if (component?.type !== "daisy") return component;
    const dataPath = String(component.dataPath || "").trim();
    if (dataPath && dataPath !== root) return component;
    changed = true;
    return { ...component, dataPath: target };
  });
  if (!changed) return preset;

  const sourceData = isPlainObject(preset.data) ? preset.data : {};
  const dataTypes = { view: "object" };
  for (const [path, type] of Object.entries(isPlainObject(preset.dataTypes) ? preset.dataTypes : {})) {
    dataTypes[`view.${path}`] = type;
  }

  const fieldTypes = { [root]: "object", [target]: "object" };
  const originalFieldTypes = isPlainObject(preset.stateContribution?.fieldTypes) ? preset.stateContribution.fieldTypes : {};
  for (const [path, type] of Object.entries(originalFieldTypes)) {
    if (path === root) continue;
    if (path.startsWith(root + ".")) fieldTypes[target + path.slice(root.length)] = type;
  }

  return {
    ...preset,
    components,
    data: { view: sourceData },
    dataTypes,
    stateContribution: {
      ...(preset.stateContribution || {}),
      root,
      fields: Object.keys(fieldTypes),
      fieldTypes,
      fieldSchemas: valueTypes.fieldSchemasFromTypeMap(fieldTypes)
    }
  };
}

function presetContractResponse(library) {
  return presetCatalog.presetCatalogResponse(library).map(normalizeManagedDaisyPreset);
}

function productContractResponse(configOrCatalog) {
  const catalog = configOrCatalog?.eventCatalog || configOrCatalog;
  const library = configOrCatalog?.presetLibrary;
  const response = eventCatalog.eventCatalogResponse(catalog);
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    provider: response.provider,
    valueTypes: VALUE_TYPES,
    connectorTypes: CONNECTOR_TYPES,
    triggerTypes: triggerTypesForCatalog(catalog),
    datasets: datasetsForCatalog(catalog),
    connectors: response.emitters,
    presetCategories: presetCatalog.presetCategoriesResponse(library),
    presetPackages: presetCatalog.presetPackagesResponse(library),
    subscriptionPlans: presetCatalog.subscriptionPlansResponse(library),
    presets: presetContractResponse(library),
    stateContributions: stateContributionsForCatalog(catalog)
  };
}

module.exports = {
  BUILTIN_TRIGGER_TYPES,
  CONNECTOR_TYPES,
  CONTRACT_SCHEMA_VERSION,
  VALUE_TYPES,
  VALUE_TYPE_CONSTRAINTS: valueTypes.VALUE_TYPE_DEFINITIONS,
  normalizeManagedDaisyPreset,
  productContractResponse
};
