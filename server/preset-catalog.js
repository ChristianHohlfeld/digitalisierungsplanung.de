"use strict";

const BASIC_PRESETS = Object.freeze([
  { id: "dropdown", label: "Dropdown", kind: "field", valueType: "text", defaults: { value: "Option A", options: ["Option A", "Option B", "Option C"] } },
  { id: "button", label: "Button", kind: "action", defaults: { label: "Weiter" } },
  { id: "toast", label: "Toast", kind: "feedback", defaults: { message: "Neue Nachricht", tone: "info" } },
  { id: "checkbox", label: "Checkbox", kind: "field", valueType: "boolean", defaults: { checked: false } },
  { id: "text", label: "Textfeld", kind: "field", valueType: "text", defaults: { value: "" } },
  { id: "number", label: "Zahlenfeld", kind: "field", valueType: "number", defaults: { value: 0 } },
  { id: "search", label: "Suche", kind: "field", valueType: "text", defaults: { value: "" } },
  { id: "email", label: "E-Mail-Feld", kind: "field", valueType: "email", defaults: { value: "" } },
  { id: "password", label: "Passwortfeld", kind: "field", valueType: "password", defaults: { value: "" } },
  { id: "heading", label: "Überschrift", kind: "content", valueType: "text", defaults: { text: "Überschrift" } },
  { id: "image", label: "Bild", kind: "content", valueType: "url", defaults: { url: "" } },
  { id: "date", label: "Datum", kind: "field", valueType: "date", defaults: { value: "" } },
  { id: "radio", label: "Radio", kind: "field", valueType: "text", defaults: { value: "Option A", options: ["Option A", "Option B"] } }
]);

const BASIC_PRESET_IDS = Object.freeze(BASIC_PRESETS.map(preset => preset.id));
const BASIC_CATEGORY = Object.freeze({ id: "basic", label: "Basics" });
const clone = value => JSON.parse(JSON.stringify(value));

function presetCatalogResponse() {
  return clone(BASIC_PRESETS);
}

function presetCategoriesResponse() {
  return [clone(BASIC_CATEGORY)];
}

module.exports = {
  BASIC_PRESETS,
  BASIC_PRESET_IDS,
  BASIC_CATEGORY,
  presetCatalogResponse,
  presetCategoriesResponse
};
