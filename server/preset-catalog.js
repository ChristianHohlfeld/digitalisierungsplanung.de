"use strict";

const IMAGE_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 360'%3E%3Crect width='640' height='360' rx='28' fill='%230b1f33'/%3E%3Cpath d='m70 294 130-132 84 84 54-54 174 102z' fill='%2338bdf8' opacity='.55'/%3E%3Ccircle cx='470' cy='102' r='48' fill='%23f59e0b' opacity='.7'/%3E%3C/svg%3E";

function component(id, type, extra = {}) {
  return { id: `${id}_component`, type, text: "", url: "", ...extra };
}

function daisy(id, variant, data, dataTypes = {}, extra = {}) {
  return {
    id,
    rootStateId: id,
    categoryId: "basic",
    builtIn: true,
    components: [component(id, "daisy", {
      variant,
      dataPath: `states.${id}`,
      dataRole: "widget",
      dataLabel: id,
      ...extra
    })],
    data,
    dataTypes
  };
}

const BASIC_PRESETS = Object.freeze([
  { ...daisy("dropdown", "dropdown", { selected: "Option A", options: ["Option A", "Option B", "Option C"], open: false }), title: "Dropdown", description: "Einfache Auswahl." },
  { ...daisy("button", "button", { label: "Weiter", url: "", clicked: false, clickedAt: 0 }), title: "Button", description: "Aktion oder Transition." },
  { ...daisy("toast", "toast", { visible: true, tone: "info", message: "Neue Nachricht" }), title: "Toast", description: "Kurze Statusmeldung." },
  { ...daisy("checkbox", "checkbox", { legend: "Auswahl", items: [{ label: "Option", checked: false }], checked: false }), title: "Checkbox", description: "Boolesche Auswahl." },
  { ...daisy("text", "input", { label: "Text", value: "" }, { value: "text" }), title: "Textfeld", description: "Einfache Texteingabe." },
  { ...daisy("number", "input", { label: "Zahl", value: 0 }, { value: "number" }, { inputType: "number" }), title: "Zahlenfeld", description: "Numerische Eingabe." },
  { ...daisy("search", "input", { label: "Suche", value: "" }, { value: "text" }, { inputType: "search" }), title: "Suche", description: "Suchfeld." },
  { ...daisy("email", "input", { label: "E-Mail", value: "" }, { value: "email" }, { inputType: "email" }), title: "E-Mail-Feld", description: "E-Mail-Eingabe." },
  { ...daisy("password", "input", { label: "Passwort", value: "" }, { value: "password" }, { inputType: "password" }), title: "Passwortfeld", description: "Geschützte Eingabe." },
  { id: "heading", rootStateId: "heading", categoryId: "basic", builtIn: true, title: "Überschrift", description: "Seitenüberschrift.", components: [component("heading", "heading", { text: "Überschrift" })], data: {}, dataTypes: {} },
  { id: "image", rootStateId: "image", categoryId: "basic", builtIn: true, title: "Bild", description: "Einfacher Bildblock.", components: [component("image", "image", { text: "Bild", url: IMAGE_PLACEHOLDER })], data: {}, dataTypes: {} },
  { ...daisy("date", "calendar", { label: "Datum", value: "", min: "", max: "" }, { value: "date" }), title: "Datum", description: "Datumsauswahl." },
  { ...daisy("radio", "radio", { label: "Auswahl", value: "Option A", options: ["Option A", "Option B"] }), title: "Radio", description: "Einzelauswahl." }
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
