"use strict";

const presetCatalog = require("./preset-catalog");

const CONTRACT_SCHEMA = "flow/1";
const PROJECT_KIND = "zustand-project";
const PROJECT_VERSION = 1;
const RECORDING_SCHEMA = "website-recording/1";
const TRIGGER_CONTEXTS = Object.freeze(["interaction", "timer", "event", "auto"]);
const LISTENER_TYPES = Object.freeze(["click", "input", "change", "key", "scroll", "navigate", "timer", "event", "auto"]);

const FLOW_CONTRACT = Object.freeze({
  schema: CONTRACT_SCHEMA,
  project: { kind: PROJECT_KIND, version: PROJECT_VERSION },
  required: {
    project: ["kind", "version", "startStateId", "states", "transitions"],
    state: ["id", "title", "trigger"],
    transition: ["id", "from", "to", "label", "listener"]
  },
  triggerContexts: TRIGGER_CONTEXTS,
  listenerTypes: LISTENER_TYPES,
  invariants: [
    "state and transition ids are unique",
    "startStateId references one existing state",
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
    presetCategories: presetCatalog.presetCategoriesResponse(),
    presets: presetCatalog.presetCatalogResponse()
  };
}

module.exports = {
  CONTRACT_SCHEMA,
  PROJECT_KIND,
  PROJECT_VERSION,
  RECORDING_SCHEMA,
  TRIGGER_CONTEXTS,
  LISTENER_TYPES,
  FLOW_CONTRACT,
  productContractResponse
};
