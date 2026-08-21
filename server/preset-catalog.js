"use strict";

const valueTypes = require("./value-types");
const presetLibrary = require("./preset-library");

const DEFAULT_IMAGE_COMPONENT_URL = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NDAiIGhlaWdodD0iMzYwIiB2aWV3Qm94PSIwIDAgNjQwIDM2MCI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJnIiB4MT0iMCIgeDI9IjEiIHkxPSIwIiB5Mj0iMSI+PHN0b3Agc3RvcC1jb2xvcj0iIzBlYTVlOSIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI2Y1OWUwYiIvPjwvbGluZWFyR3JhZGllbnQ+PC9kZWZzPjxyZWN0IHdpZHRoPSI2NDAiIGhlaWdodD0iMzYwIiByeD0iMzIiIGZpbGw9InVybCgjZykiLz48Y2lyY2xlIGN4PSI0NzIiIGN5PSIxMTIiIHI9IjUyIiBmaWxsPSIjZmZmZmZmIiBvcGFjaXR5PSIuMzIiLz48cGF0aCBkPSJNNzIgMjg2bDEyMi0xMjIgNzggNzggNDgtNDggMTc2IDkyeiIgZmlsbD0iI2ZmZmZmZiIgb3BhY2l0eT0iLjQ4Ii8+PHRleHQgeD0iNDgiIHk9IjcwIiBmb250LWZhbWlseT0iQXJpYWwsIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMzQiIGZvbnQtd2VpZ2h0PSI3MDAiIGZpbGw9IiNmZmZmZmYiPkltYWdlIGJsb2NrPC90ZXh0Pjwvc3ZnPg==";
const CATEGORY_ID = "websuite-builder";

const BUILTIN_PRESET_IDS = Object.freeze([
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

const BUILTIN_PRESET_SPECS = Object.freeze([
  {
    id: "builtin_daisy_dropdown",
    rootStateId: "dropdown",
    title: "Dropdown",
    description: "Auswahlmenü mit gemeinsamem Zustandswert.",
    component: { type: "daisy", variant: "dropdown" },
    packageIds: ["core.process"],
    data: { selected: "Option A", options: ["Option A", "Option B", "Option C"], open: false }
  },
  {
    id: "builtin_daisy_button",
    rootStateId: "button",
    title: "Button",
    description: "Aktionsbutton für URL oder echten ausgehenden Übergang.",
    component: { type: "daisy", variant: "button" },
    packageIds: ["core.process"],
    data: { label: "Weiter", url: "", clicked: false, clickedAt: 0 }
  },
  {
    id: "builtin_daisy_toast",
    rootStateId: "toast",
    title: "Toast",
    description: "Kurzmeldung mit gemeinsamem Sichtbarkeitszustand und Timer.",
    component: { type: "daisy", variant: "toast" },
    packageIds: ["service.operations"],
    data: { visible: true, tone: "info", message: "Neue Nachricht eingetroffen." },
    transitions: [{
      id: "toast_dismiss",
      from: "toast",
      to: "toast",
      label: "Toast ausblenden",
      condition: "states.toast.visible == true",
      triggerType: "timer",
      timerMs: 3000,
      set: { "states.toast.visible": false }
    }]
  },
  {
    id: "builtin_daisy_checkbox",
    rootStateId: "checkbox",
    title: "Checkbox",
    description: "Checkbox-Auswahl im globalen State.",
    component: { type: "daisy", variant: "checkbox" },
    packageIds: ["core.process"],
    data: { legend: "Einstellungen", items: [{ label: "Angemeldet bleiben", checked: false }], checked: false }
  },
  {
    id: "builtin_daisy_input",
    rootStateId: "input",
    title: "Input Text",
    description: "Textfeld im globalen State.",
    component: { type: "daisy", variant: "input", inputType: "text" },
    packageIds: ["core.process"],
    data: { label: "Text", value: "" },
    dataTypes: { value: "text" }
  },
  {
    id: "builtin_daisy_input_number",
    rootStateId: "input_number",
    title: "Input Number",
    description: "Numerisches Eingabefeld im globalen State.",
    component: { type: "daisy", variant: "input", inputType: "number" },
    packageIds: ["core.process"],
    data: { label: "Zahl", value: 0 },
    dataTypes: { value: "number" }
  },
  {
    id: "builtin_daisy_search",
    rootStateId: "search",
    title: "Search",
    description: "Suchfeld im globalen State.",
    component: { type: "daisy", variant: "input", inputType: "search" },
    packageIds: ["core.process"],
    data: { label: "Suche", value: "" },
    dataTypes: { value: "text" }
  },
  {
    id: "builtin_daisy_input_email",
    rootStateId: "input_email",
    title: "Input Email",
    description: "E-Mail-Eingabefeld im globalen State.",
    component: { type: "daisy", variant: "input", inputType: "email" },
    packageIds: ["core.process"],
    data: { label: "E-Mail", value: "" },
    dataTypes: { value: "email" }
  },
  {
    id: "builtin_daisy_input_password",
    rootStateId: "input_password",
    title: "Input Password",
    description: "Passwort-Eingabefeld im globalen State.",
    component: { type: "daisy", variant: "input", inputType: "password" },
    packageIds: ["core.process"],
    data: { label: "Passwort", value: "" },
    dataTypes: { value: "text" }
  },
  {
    id: "builtin_page_heading",
    rootStateId: "page_heading",
    title: "Header",
    description: "Klare Überschrift für Seite oder Zustand.",
    component: { type: "heading", text: "Header" },
    packageIds: ["website.builder"],
    data: {}
  },
  {
    id: "builtin_media_image",
    rootStateId: "media_image",
    title: "Image",
    description: "Bildbereich für Seite oder Zustand.",
    component: { type: "image", text: "Bildbeschreibung", url: DEFAULT_IMAGE_COMPONENT_URL },
    packageIds: ["website.builder"],
    data: {}
  },
  {
    id: "builtin_daisy_date",
    rootStateId: "date",
    title: "Date",
    description: "Datumsauswahl im globalen State.",
    component: { type: "daisy", variant: "calendar" },
    packageIds: ["core.process"],
    data: { label: "Datum", value: "2026-07-17", min: "", max: "" }
  },
  {
    id: "builtin_daisy_radio",
    rootStateId: "radio",
    title: "Radio",
    description: "Radio-Auswahl im globalen State.",
    component: { type: "daisy", variant: "radio" },
    packageIds: ["core.process"],
    data: { label: "Tarif", value: "Team", options: ["Gratis", "Team", "Enterprise"] }
  }
]);

const STRIPE_CHECKOUT_BASE_URL = "https://realtime.digitalisierungsplanung.de/stripe/checkout";
const STRIPE_CHECKOUT_SUCCESS_URL = "https://digitalisierungsplanung.de/?checkout=success&session_id={CHECKOUT_SESSION_ID}";
const STRIPE_CHECKOUT_CANCEL_URL = "https://digitalisierungsplanung.de/?checkout=cancel";
const CONTACT_URL = "mailto:kontakt@digitalisierungsplanung.de?subject=Volumen%20%26%20Unternehmen%20buchen";
const STRIPE_CHECKOUT_DEFAULTS = Object.freeze({
  path: "/stripe/checkout",
  endpoint: STRIPE_CHECKOUT_BASE_URL,
  successUrl: STRIPE_CHECKOUT_SUCCESS_URL,
  cancelUrl: STRIPE_CHECKOUT_CANCEL_URL
});

const PRODUCT_PRICING_PLANS = Object.freeze([
  {
    id: "starter",
    title: "Starter",
    badge: "Einstieg",
    price: "49,99 EUR",
    period: "pro Benutzer / Monat",
    body: "Für Einzelne, die Prozesse modellieren, testen und einfache Prozess-Apps nutzen.",
    features: ["1 Benutzer", "Monatliche Tool-Nutzung", "HTML-Export"],
    includedPackageIds: ["core.process"],
    recommendedAddOnPackageIds: ["website.builder", "approval.compliance"],
    actionLabel: "Starter buchen",
    stripe: {
      provider: "stripe",
      mode: "subscription",
      lookupKey: "starter_user_monthly_eur",
      productName: "Digitalisierungsplanung Starter",
      unitAmountCents: 4999,
      currency: "eur",
      recurringInterval: "month",
      billingAddressCollection: "required",
      automaticTax: true,
      taxBehavior: "exclusive",
      taxCode: "txcd_10103001",
      quantityMode: "per_user",
      adjustableQuantity: true,
      minQuantity: 1,
      maxQuantity: 250
    },
    sort: 10
  },
  {
    id: "expert",
    title: "Expert",
    badge: "Beliebt",
    price: "199 EUR",
    period: "/Monat",
    body: "Für Teams und Expertinnen, die Abläufe gemeinsam bauen, prüfen und als Web-App nutzen.",
    features: ["Expert-Arbeitsbereich", "Website Builder", "Freigaben & Prüfung"],
    includedPackageIds: ["core.process", "website.builder", "approval.compliance"],
    recommendedAddOnPackageIds: ["bi.analytics", "service.operations"],
    actionLabel: "Expert buchen",
    highlight: true,
    stripe: {
      provider: "stripe",
      mode: "subscription",
      lookupKey: "expert_monthly_eur",
      productName: "Digitalisierungsplanung Expert",
      unitAmountCents: 19900,
      currency: "eur",
      recurringInterval: "month",
      billingAddressCollection: "required",
      automaticTax: true,
      taxBehavior: "exclusive",
      taxCode: "txcd_10103001",
      quantityMode: "workspace",
      adjustableQuantity: false,
      minQuantity: 1,
      maxQuantity: 1
    },
    sort: 20
  },
  {
    id: "enterprise",
    title: "Volumen & Unternehmen",
    badge: "Volumen",
    price: "499 EUR",
    period: "/Monat",
    body: "Für mehrere Bereiche, Volumen, Datenschutzabstimmung und begleiteten Rollout.",
    features: ["Volumenpakete", "Enterprise-Abstimmung", "Begleitete Einführung"],
    includedPackageIds: ["core.process", "website.builder", "approval.compliance", "service.operations"],
    recommendedAddOnPackageIds: ["bi.analytics", "sales.crm", "integration.automation"],
    actionLabel: "Volumen buchen",
    stripe: {
      provider: "stripe",
      mode: "subscription",
      lookupKey: "enterprise_monthly_eur",
      productName: "Digitalisierungsplanung Volumen & Unternehmen",
      unitAmountCents: 49900,
      currency: "eur",
      recurringInterval: "month",
      billingAddressCollection: "required",
      automaticTax: true,
      taxBehavior: "exclusive",
      taxCode: "txcd_10103001",
      quantityMode: "workspace",
      adjustableQuantity: false,
      minQuantity: 1,
      maxQuantity: 1
    },
    sort: 30
  }
]);

const SUBSCRIPTION_PLANS = Object.freeze(PRODUCT_PRICING_PLANS.map(plan => ({
  id: plan.id,
  label: plan.title,
  badge: plan.badge || "",
  price: plan.price,
  period: plan.period,
  description: plan.body,
  includedPackageIds: [...plan.includedPackageIds],
  recommendedAddOnPackageIds: [...plan.recommendedAddOnPackageIds],
  cta: plan.actionLabel,
  highlight: plan.highlight === true,
  billing: {
    cadence: "monthly",
    unit: plan.stripe?.quantityMode === "per_user" ? "user" : "workspace",
    usage: "tool_nutzung"
  },
  stripe: { ...plan.stripe },
  sort: plan.sort
})));

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeId(text) {
  return String(text || "state")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "") || "state";
}

function normalizeStateDataValue(value) {
  if (Array.isArray(value)) return value.filter(item => item !== undefined).map(normalizeStateDataValue);
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) continue;
    out[key] = normalizeStateDataValue(child);
  }
  return out;
}

function normalizeStateDataObject(value) {
  return isPlainObject(value) ? normalizeStateDataValue(value) : {};
}

function stateDataScopeForId(id) {
  return "states." + normalizeId(id || "state");
}

function resolvedPresetLibrary(value) {
  return value ? presetLibrary.validatePresetLibrary(value) : presetLibrary.loadPresetLibraryFile();
}

function packageMapForLibrary(library) {
  return new Map(library.packages.map(item => [item.id, item]));
}

function normalizePackageIds(value, fallback, packageById) {
  const out = [];
  const push = id => {
    const clean = String(id || "").trim();
    if (packageById.has(clean) && !out.includes(clean)) out.push(clean);
  };
  if (Array.isArray(value)) value.forEach(push);
  if (!out.length && Array.isArray(fallback)) fallback.forEach(push);
  if (out.length) return out;
  return Array.isArray(fallback) && fallback.length === 0 ? [] : ["core.process"];
}

function normalizeDataTypePath(path) {
  const text = String(path || "").trim();
  return /^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(text) ? text : "";
}

function valueAtPath(data, path) {
  const parts = String(path || "").split(".").filter(Boolean);
  let cursor = data;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object" || !Object.hasOwn(cursor, part)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function inferValueType(path, value) {
  const key = String(path || "").toLowerCase();
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) return "list";
  if (isPlainObject(value)) return "object";
  if (/email/.test(key)) return "email";
  if (/(?:^|\.)(?:url|link|href|endpoint)$/.test(key)) return "url";
  if (/(?:^|\.)(?:image|avatar)$/.test(key)) return "image";
  return "text";
}

function collectLocalFieldTypes(data, explicitTypes = {}) {
  const cleanData = normalizeStateDataObject(data);
  const out = {};
  const explicit = isPlainObject(explicitTypes) ? explicitTypes : {};

  function visit(value, path) {
    if (!path) {
      if (isPlainObject(value)) {
        for (const [key, child] of Object.entries(value)) visit(child, key);
      }
      return;
    }
    const explicitType = valueTypes.normalizeValueType(explicit[path]);
    out[path] = explicitType || inferValueType(path, value);
    if (isPlainObject(value)) {
      for (const [key, child] of Object.entries(value)) visit(child, path + "." + key);
    }
  }

  visit(cleanData, "");
  for (const [rawPath, rawType] of Object.entries(explicit)) {
    const path = normalizeDataTypePath(rawPath);
    const type = valueTypes.normalizeValueType(rawType);
    if (path && type && valueAtPath(cleanData, path) !== undefined) out[path] = type;
  }
  return out;
}

function componentFromSpec(presetId, rootStateId, title, spec) {
  if (spec.type === "daisy") {
    return {
      id: `${presetId}_component`,
      type: "daisy",
      text: "",
      url: "",
      variant: spec.variant,
      dataPath: stateDataScopeForId(rootStateId),
      dataRole: "widget",
      dataLabel: title,
      ...(spec.inputType ? { inputType: spec.inputType } : {})
    };
  }
  return {
    id: `${presetId}_component`,
    type: spec.type,
    text: spec.text || "",
    url: spec.url || ""
  };
}

function rawBuiltinTemplate(spec) {
  return {
    id: spec.id,
    rootStateId: spec.rootStateId,
    title: spec.title,
    description: spec.description,
    builtIn: true,
    categoryId: CATEGORY_ID,
    packageIds: [...spec.packageIds],
    components: [componentFromSpec(spec.id, spec.rootStateId, spec.title, spec.component)],
    data: cloneJson(spec.data || {}),
    dataTypes: cloneJson(spec.dataTypes || {}),
    transitions: cloneJson(spec.transitions || [])
  };
}

function rawManagedTemplate(spec, library) {
  const packageById = packageMapForLibrary(library);
  const id = String(spec.id || "").trim();
  const rootStateId = normalizeId(spec.rootStateId || id || "preset");
  const title = String(spec.title || id || "Preset");
  const variant = String(spec.variant || "input").trim() || "input";
  return {
    id,
    rootStateId,
    title,
    description: String(spec.description || ""),
    builtIn: false,
    categoryId: String(spec.categoryId || CATEGORY_ID),
    packageIds: normalizePackageIds(spec.packageIds, ["core.process"], packageById),
    components: [componentFromSpec(id, rootStateId, title, { type: "daisy", variant })],
    data: normalizeStateDataObject(spec.data),
    dataTypes: cloneJson(spec.dataTypes || {}),
    transitions: cloneJson(spec.transitions || [])
  };
}

function normalizePreset(preset, library) {
  const packageById = packageMapForLibrary(library);
  const rootStateId = normalizeId(preset.rootStateId || preset.id || "preset");
  const data = normalizeStateDataObject(preset.data);
  const dataTypes = collectLocalFieldTypes(data, preset.dataTypes);
  const root = stateDataScopeForId(rootStateId);
  const fieldTypes = Object.keys(data).length ? { [root]: "object" } : {};
  for (const [path, type] of Object.entries(dataTypes)) fieldTypes[`${root}.${path}`] = type;
  const packageIds = normalizePackageIds(preset.packageIds, ["core.process"], packageById);
  const primaryPackageId = packageIds[0] || "core.process";
  return {
    ...preset,
    rootStateId,
    data,
    dataTypes,
    packageIds,
    primaryPackageId,
    commercial: {
      packageIds,
      primaryPackageId,
      packageLabels: packageIds.map(id => packageById.get(id)?.label || id),
      addOn: packageIds.some(id => packageById.get(id)?.upsell === true)
    },
    stateContribution: {
      id: String(preset.id || rootStateId),
      source: "preset",
      root,
      fields: Object.keys(fieldTypes),
      fieldTypes,
      fieldSchemas: valueTypes.fieldSchemasFromTypeMap(fieldTypes)
    }
  };
}

function builtinStateTemplates() {
  return BUILTIN_PRESET_SPECS.map(rawBuiltinTemplate);
}

function presetCatalogResponse(libraryValue) {
  const library = resolvedPresetLibrary(libraryValue);
  const builtins = builtinStateTemplates().map(preset => normalizePreset(preset, library));
  const managed = library.presets.map(spec => normalizePreset(rawManagedTemplate(spec, library), library));
  return [...builtins, ...managed];
}

function presetCategoriesResponse(libraryValue) {
  return resolvedPresetLibrary(libraryValue).categories.map(cloneJson);
}

function presetPackagesResponse(libraryValue) {
  const library = resolvedPresetLibrary(libraryValue);
  const packageById = packageMapForLibrary(library);
  const presets = presetCatalogResponse(library);
  return library.packages
    .map(item => {
      const presetIds = presets
        .filter(preset => preset.packageIds.includes(item.id))
        .map(preset => preset.id);
      const includedInPlanIds = SUBSCRIPTION_PLANS
        .filter(plan => normalizePackageIds(plan.includedPackageIds, [], packageById).includes(item.id))
        .map(plan => plan.id);
      return {
        ...cloneJson(item),
        includedInPlanIds,
        presetIds,
        presetCount: presetIds.length
      };
    })
    .sort((a, b) => a.sort - b.sort);
}

function subscriptionPlansResponse(libraryValue) {
  const library = resolvedPresetLibrary(libraryValue);
  const packageById = packageMapForLibrary(library);
  return SUBSCRIPTION_PLANS
    .map(plan => {
      const includedPackageIds = normalizePackageIds(plan.includedPackageIds, [], packageById);
      const recommendedAddOnPackageIds = normalizePackageIds(plan.recommendedAddOnPackageIds, [], packageById);
      return {
        ...cloneJson(plan),
        includedPackageIds,
        recommendedAddOnPackageIds,
        includedPackages: includedPackageIds.map(id => cloneJson(packageById.get(id))).filter(Boolean),
        recommendedAddOns: recommendedAddOnPackageIds.map(id => cloneJson(packageById.get(id))).filter(Boolean)
      };
    })
    .sort((a, b) => a.sort - b.sort);
}

function stripeCheckoutPlansResponse() {
  return PRODUCT_PRICING_PLANS.map(plan => ({
    id: plan.id,
    label: plan.title,
    price: plan.price,
    period: plan.period,
    description: plan.body,
    cta: plan.actionLabel,
    stripe: { ...plan.stripe }
  }));
}

function stripeCheckoutPlanById(id) {
  const clean = String(id || "").trim();
  return stripeCheckoutPlansResponse().find(plan => plan.id === clean) || null;
}

module.exports = {
  BUILTIN_PRESET_IDS,
  STRIPE_CHECKOUT_DEFAULTS,
  builtinStateTemplates,
  collectLocalFieldTypes,
  presetCatalogResponse,
  presetCategoriesResponse,
  presetPackagesResponse,
  stripeCheckoutPlanById,
  stripeCheckoutPlansResponse,
  subscriptionPlansResponse
};
