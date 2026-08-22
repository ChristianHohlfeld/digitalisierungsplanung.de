"use strict";

const presetCatalog = require("./preset-catalog");

const CONTRACT_SCHEMA = "flow/1";
const PROJECT_KIND = "state-blueprint-definition";
const PROJECT_VERSION = 2;
const RECORDING_SCHEMA = "website-recording/1";
const VALUE_TYPES = Object.freeze([
  { id: "text", label: "Text", jsonType: "string", default: "" },
  { id: "number", label: "Zahl", jsonType: "number", default: 0 },
  { id: "boolean", label: "Ja/Nein", jsonType: "boolean", default: false },
  { id: "email", label: "E-Mail", jsonType: "string", default: "" },
  { id: "password", label: "Passwort", jsonType: "string", default: "" },
  { id: "date", label: "Datum", jsonType: "string", default: "" },
  { id: "url", label: "URL", jsonType: "string", default: "" },
  { id: "list", label: "Liste", jsonType: "array", default: [] },
  { id: "object", label: "Objekt", jsonType: "object", default: {} }
]);
const TRIGGER_TYPES = Object.freeze([
  { id: "button", label: "Klick", settings: {} },
  { id: "change", label: "Änderung", settings: {} },
  { id: "event", label: "App-Ereignis", settings: {}, events: [] },
  { id: "api", label: "API-Antwort", settings: {} },
  { id: "timer", label: "Timer", settings: { timerMs: true } },
  { id: "auto", label: "Automatisch", settings: {} },
  { id: "flow", label: "Unterablauf", settings: {}, internal: true }
]);

const FLOW_CONTRACT = Object.freeze({
  schema: CONTRACT_SCHEMA,
  project: { kind: PROJECT_KIND, schemaVersion: PROJECT_VERSION },
  required: {
    project: ["kind", "schemaVersion", "app", "savedAt", "model"],
    model: ["version", "initial", "states", "transitions"],
    state: ["id", "title", "x", "y"],
    transition: ["id", "from", "to", "label"]
  },
  invariants: [
    "state and transition ids are unique",
    "model.initial references one existing state",
    "every transition connects existing states",
    "state changes happen only through transitions"
  ],
  recording: {
    schema: RECORDING_SCHEMA,
    actionTypes: ["click", "input", "key", "scroll", "navigate"],
    invariant: "actions = steps = transitions; states = actions + 1",
    replay: "Execute every action against a fresh browser and stop at the first checkpoint mismatch."
  }
});

function productContractResponse() {
  return {
    schemaVersion: 1,
    schema: CONTRACT_SCHEMA,
    flow: FLOW_CONTRACT,
    valueTypes: VALUE_TYPES,
    triggerTypes: TRIGGER_TYPES,
    presetCategories: presetCatalog.presetCategoriesResponse(),
    presets: presetCatalog.presetCatalogResponse()
  };
}

module.exports = {
  CONTRACT_SCHEMA,
  PROJECT_KIND,
  PROJECT_VERSION,
  RECORDING_SCHEMA,
  VALUE_TYPES,
  TRIGGER_TYPES,
  FLOW_CONTRACT,
  productContractResponse
};
