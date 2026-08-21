"use strict";

const base = require("./preset-catalog-base");
const valueTypes = require("./value-types");

const FOCUSED_PRESET_IDS = Object.freeze([
  "builtin_daisy_dropdown",
  "builtin_daisy_button",
  "builtin_daisy_toast",
  "builtin_daisy_checkbox",
  "builtin_daisy_input",
  "builtin_daisy_input_number",
  "builtin_daisy_search",
  "builtin_daisy_input_email",
  "builtin_daisy_input_password",
  "builtin_page_heading",
  "builtin_media_image",
  "builtin_daisy_date",
  "builtin_daisy_radio"
]);

const FOCUSED_SPECS = Object.freeze([
  { sourceId: "builtin_daisy_dropdown", id: "builtin_daisy_dropdown", title: "Dropdown" },
  { sourceId: "builtin_daisy_button", id: "builtin_daisy_button", title: "Button" },
  { sourceId: "builtin_daisy_toast", id: "builtin_daisy_toast", title: "Toast" },
  { sourceId: "builtin_daisy_checkbox", id: "builtin_daisy_checkbox", title: "Checkbox" },
  {
    sourceId: "builtin_daisy_input",
    id: "builtin_daisy_input",
    rootStateId: "input",
    title: "Input Text",
    inputType: "text",
    data: { label: "Text", value: "" },
    dataTypes: { value: "text" }
  },
  {
    sourceId: "builtin_daisy_input",
    id: "builtin_daisy_input_number",
    rootStateId: "input_number",
    title: "Input Number",
    inputType: "number",
    data: { label: "Zahl", value: 0 },
    dataTypes: { value: "number" }
  },
  {
    sourceId: "builtin_daisy_input",
    id: "builtin_daisy_search",
    rootStateId: "search",
    title: "Search",
    inputType: "search",
    data: { label: "Suche", value: "" },
    dataTypes: { value: "text" }
  },
  {
    sourceId: "builtin_daisy_input",
    id: "builtin_daisy_input_email",
    rootStateId: "input_email",
    title: "Input Email",
    inputType: "email",
    data: { label: "E-Mail", value: "" },
    dataTypes: { value: "email" }
  },
  {
    sourceId: "builtin_daisy_input",
    id: "builtin_daisy_input_password",
    rootStateId: "input_password",
    title: "Input Password",
    inputType: "password",
    data: { label: "Passwort", value: "" },
    dataTypes: { value: "text" }
  },
  {
    sourceId: "builtin_page_heading",
    id: "builtin_page_heading",
    title: "Header",
    componentText: "Header"
  },
  {
    sourceId: "builtin_media_image",
    id: "builtin_media_image",
    title: "Image"
  },
  {
    sourceId: "builtin_daisy_calendar",
    id: "builtin_daisy_date",
    rootStateId: "date",
    title: "Date",
    data: { label: "Datum", value: "2026-07-17", min: "", max: "" }
  },
  { sourceId: "builtin_daisy_radio", id: "builtin_daisy_radio", title: "Radio" }
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function stateRoot(id) {
  const clean = String(id || "state")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "") || "state";
  return "states." + clean;
}

function replaceRootDeep(value, fromRoot, toRoot) {
  if (typeof value === "string") {
    if (value === fromRoot) return toRoot;
    if (value.startsWith(fromRoot + ".")) return toRoot + value.slice(fromRoot.length);
    return value;
  }
  if (Array.isArray(value)) return value.map(item => replaceRootDeep(item, fromRoot, toRoot));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) out[key] = replaceRootDeep(child, fromRoot, toRoot);
  return out;
}

function contributionFor(preset) {
  const root = stateRoot(preset.rootStateId || preset.id);
  const data = preset.data && typeof preset.data === "object" && !Array.isArray(preset.data) ? preset.data : {};
  const localTypes = base.collectLocalFieldTypes(data, preset.dataTypes || {});
  const fieldTypes = Object.keys(data).length ? { [root]: "object" } : {};
  for (const [path, type] of Object.entries(localTypes)) fieldTypes[root + "." + path] = type;
  return {
    id: String(preset.id || preset.rootStateId || "preset"),
    source: "preset",
    root,
    fields: Object.keys(fieldTypes),
    fieldTypes,
    fieldSchemas: valueTypes.fieldSchemasFromTypeMap(fieldTypes)
  };
}

function focusedPresetFrom(source, spec) {
  const sourceRootId = source.rootStateId || source.id;
  const targetRootId = spec.rootStateId || sourceRootId;
  const fromRoot = stateRoot(sourceRootId);
  const toRoot = stateRoot(targetRootId);
  const preset = replaceRootDeep(cloneJson(source), fromRoot, toRoot);

  preset.id = spec.id;
  preset.rootStateId = targetRootId;
  preset.title = spec.title;
  preset.categoryId = "websuite-builder";
  delete preset.hidden;
  delete preset.legacy;

  if (spec.data) preset.data = cloneJson(spec.data);
  if (spec.dataTypes) preset.dataTypes = cloneJson(spec.dataTypes);

  if (Array.isArray(preset.components)) {
    preset.components = preset.components.map((component, index) => {
      const next = { ...component };
      if (index === 0) next.id = spec.id + "_component";
      if (spec.inputType && next.type === "daisy") next.inputType = spec.inputType;
      if (spec.componentText !== undefined && index === 0) next.text = spec.componentText;
      return next;
    });
  }

  preset.stateContribution = contributionFor(preset);
  return preset;
}

function focusedCatalog(libraryValue) {
  const sourceCatalog = base.presetCatalogResponse(libraryValue);
  const byId = new Map(sourceCatalog.map(preset => [preset.id, preset]));
  return FOCUSED_SPECS.map(spec => {
    const source = byId.get(spec.sourceId);
    if (!source) throw new Error("Focused preset source missing: " + spec.sourceId);
    return focusedPresetFrom(source, spec);
  });
}

function builtinStateTemplates(libraryValue) {
  return focusedCatalog(libraryValue).map(preset => {
    const copy = cloneJson(preset);
    delete copy.commercial;
    delete copy.stateContribution;
    delete copy.primaryPackageId;
    return copy;
  });
}

function presetCatalogResponse(libraryValue) {
  const sourceCatalog = base.presetCatalogResponse(libraryValue);
  const managed = sourceCatalog
    .filter(preset => preset.builtIn === false)
    .map(cloneJson);
  return [...focusedCatalog(libraryValue), ...managed];
}

function visiblePresetCatalogResponse(libraryValue) {
  return presetCatalogResponse(libraryValue);
}

module.exports = {
  ...base,
  FOCUSED_PRESET_IDS,
  builtinStateTemplates,
  presetCatalogResponse,
  visiblePresetCatalogResponse
};
