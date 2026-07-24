"use strict";

const valueTypes = require("./value-types");
const presetLibrary = require("./preset-library");

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

function stateDataScopeForId(id) {
  return "states." + normalizeId(id || "state");
}

function normalizeStateDataValue(value) {
  if (Array.isArray(value)) return value.filter(item => item !== undefined).map(normalizeStateDataValue);
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) out[key] = normalizeStateDataValue(child);
  }
  return out;
}

function normalizeStateDataObject(value) {
  return isPlainObject(value) ? normalizeStateDataValue(value) : {};
}

function resolvedPresetLibrary(value) {
  return value ? presetLibrary.validatePresetLibrary(value) : presetLibrary.loadPresetLibraryFile();
}

function packageMapForLibrary(library) {
  return new Map(library.packages.map(item => [item.id, item]));
}

function normalizePackageIds(value, fallback = ["core.process"], packageById) {
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

const SUBSCRIPTION_PLANS = Object.freeze([
  {
    id: "starter",
    label: "Starter",
    price: "249 EUR",
    period: "/Monat",
    description: "Für einzelne Prozesse, schnelle Prototypen und erste digitale Anwendungen.",
    includedPackageIds: ["core.process"],
    recommendedAddOnPackageIds: ["website.builder", "approval.compliance"],
    cta: "Starter anfragen",
    sort: 10
  },
  {
    id: "business",
    label: "Business",
    badge: "Beliebt",
    price: "749 EUR",
    period: "/Monat",
    description: "Für Mittelstandsteams, die Prozesse modellieren, prüfen und als Web-App nutzen.",
    includedPackageIds: ["core.process", "website.builder", "approval.compliance"],
    recommendedAddOnPackageIds: ["bi.analytics", "service.operations"],
    cta: "Business anfragen",
    highlight: true,
    sort: 20
  },
  {
    id: "scale",
    label: "Scale",
    badge: "Teams",
    price: "1.990 EUR",
    period: "/Monat",
    description: "Für mehrere Bereiche, operative Echtzeit-Prozesse und wiederholbare Rollouts.",
    includedPackageIds: ["core.process", "website.builder", "approval.compliance", "service.operations"],
    recommendedAddOnPackageIds: ["bi.analytics", "sales.crm", "integration.automation"],
    cta: "Scale anfragen",
    sort: 30
  }
]);

const docs = component => `packages/docs/src/routes/(routes)/components/${component}/+page.md`;
const template = (variant, html, docsPath = docs(variant)) => ({
  source: "daisyui",
  version: presetLibrary.DAISY_VERSION,
  docsPath,
  html
});

const BUILTIN_DAISY_PRESETS = Object.freeze([
  {
    id: "button",
    title: "Button",
    description: "Original DaisyUI Button. Text ist editierbar; Klicks können später mit Transitionen verbunden werden.",
    variant: "button",
    packageIds: ["core.process"],
    data: { label: "Button", clicked: false, clickedAt: 0 },
    dataTypes: { clicked: "boolean", clickedAt: "number" },
    template: template("button", `<button class="btn btn-primary">{{ label | Button }}</button>`)
  },
  {
    id: "card",
    title: "Card",
    description: "Original DaisyUI Card mit Body, Titel und Action-Button.",
    variant: "card",
    packageIds: ["website.builder"],
    data: {
      title: "Card Title",
      body: "A card component has a body part, title and actions part.",
      actionLabel: "Buy Now"
    },
    template: template("card", `<div class="card bg-base-100 w-96 shadow-sm">
  <div class="card-body">
    <h2 class="card-title">{{ title | Card Title }}</h2>
    <p>{{ body | A card component has a body part, title and actions part. }}</p>
    <div class="card-actions justify-end">
      <button class="btn btn-primary">{{ actionLabel | Buy Now }}</button>
    </div>
  </div>
</div>`)
  },
  {
    id: "alert",
    title: "Alert",
    description: "Original DaisyUI Alert für Status- und Hinweismeldungen.",
    variant: "alert",
    packageIds: ["service.operations"],
    data: { message: "12 unread messages. Tap to see." },
    template: template("alert", `<div role="alert" class="alert alert-info">
  <span>{{ message | 12 unread messages. Tap to see. }}</span>
</div>`)
  },
  {
    id: "input",
    title: "Input",
    description: "Original DaisyUI Input für einfache Texteingaben.",
    variant: "input",
    packageIds: ["core.process"],
    data: { placeholder: "Type here", value: "" },
    template: template("input", `<input type="text" placeholder="{{ placeholder | Type here }}" class="input" value="{{ value | }}" />`)
  },
  {
    id: "select",
    title: "Select",
    description: "Original DaisyUI Select mit einfachen Optionen.",
    variant: "select",
    packageIds: ["core.process"],
    data: { value: "Pick a browser" },
    template: template("select", `<select class="select">
  <option disabled selected>{{ value | Pick a browser }}</option>
  <option>Chrome</option>
  <option>Firefox</option>
  <option>Safari</option>
</select>`)
  },
  {
    id: "checkbox",
    title: "Checkbox",
    description: "Original DaisyUI Checkbox für Ja/Nein-Entscheidungen.",
    variant: "checkbox",
    packageIds: ["approval.compliance"],
    data: { label: "Remember me", checked: false },
    dataTypes: { checked: "boolean" },
    template: template("checkbox", `<label class="label cursor-pointer justify-start gap-3">
  <input type="checkbox" class="checkbox" />
  <span>{{ label | Remember me }}</span>
</label>`)
  },
  {
    id: "toggle",
    title: "Toggle",
    description: "Original DaisyUI Toggle für ein/aus.",
    variant: "toggle",
    packageIds: ["core.process"],
    data: { label: "Notifications", checked: true },
    dataTypes: { checked: "boolean" },
    template: template("toggle", `<label class="label cursor-pointer justify-start gap-3">
  <input type="checkbox" class="toggle" checked />
  <span>{{ label | Notifications }}</span>
</label>`)
  },
  {
    id: "hero",
    title: "Hero",
    description: "Original DaisyUI Hero für Einstiegsseiten und Call-to-Action-Flächen.",
    variant: "hero",
    packageIds: ["website.builder"],
    data: {
      title: "Hello there",
      body: "Provident cupiditate voluptatem et in. Quaerat fugiat ut assumenda excepturi exercitationem quasi.",
      actionLabel: "Get Started"
    },
    template: template("hero", `<div class="hero bg-base-200 min-h-96">
  <div class="hero-content text-center">
    <div class="max-w-md">
      <h1 class="text-5xl font-bold">{{ title | Hello there }}</h1>
      <p class="py-6">{{ body | Provident cupiditate voluptatem et in. Quaerat fugiat ut assumenda excepturi exercitationem quasi. }}</p>
      <button class="btn btn-primary">{{ actionLabel | Get Started }}</button>
    </div>
  </div>
</div>`)
  },
  {
    id: "navbar",
    title: "Navbar",
    description: "Original DaisyUI Navbar als einfache Kopfzeile.",
    variant: "navbar",
    packageIds: ["website.builder"],
    data: { brand: "daisyUI", linkA: "Home", linkB: "About", linkC: "Contact" },
    template: template("navbar", `<div class="navbar bg-base-100 shadow-sm">
  <div class="flex-1">
    <a class="btn btn-ghost text-xl">{{ brand | daisyUI }}</a>
  </div>
  <div class="flex-none">
    <ul class="menu menu-horizontal px-1">
      <li><a>{{ linkA | Home }}</a></li>
      <li><a>{{ linkB | About }}</a></li>
      <li><a>{{ linkC | Contact }}</a></li>
    </ul>
  </div>
</div>`)
  },
  {
    id: "modal",
    title: "Modal",
    description: "Original DaisyUI Modal als sichtbarer Dialog für Preview und Export.",
    variant: "modal",
    packageIds: ["approval.compliance"],
    data: { title: "Hello!", body: "Press ESC key or click outside to close.", actionLabel: "Close" },
    template: template("modal", `<dialog class="modal" open>
  <div class="modal-box">
    <h3 class="text-lg font-bold">{{ title | Hello! }}</h3>
    <p class="py-4">{{ body | Press ESC key or click outside to close. }}</p>
    <div class="modal-action">
      <form method="dialog">
        <button class="btn">{{ actionLabel | Close }}</button>
      </form>
    </div>
  </div>
</dialog>`)
  },
  {
    id: "table",
    title: "Table",
    description: "Original DaisyUI Table als einfache Datenansicht.",
    variant: "table",
    packageIds: ["bi.analytics"],
    data: { headline: "Team members", first: "Cy Ganderton", second: "Hart Hagerty", third: "Brice Swyre" },
    template: template("table", `<div class="overflow-x-auto">
  <table class="table">
    <thead><tr><th></th><th>Name</th><th>Job</th><th>Favorite Color</th></tr></thead>
    <tbody>
      <tr><th>1</th><td>{{ first | Cy Ganderton }}</td><td>Quality Control Specialist</td><td>Blue</td></tr>
      <tr><th>2</th><td>{{ second | Hart Hagerty }}</td><td>Desktop Support Technician</td><td>Purple</td></tr>
      <tr><th>3</th><td>{{ third | Brice Swyre }}</td><td>Tax Accountant</td><td>Red</td></tr>
    </tbody>
  </table>
</div>`)
  },
  {
    id: "footer",
    title: "Footer",
    description: "Original DaisyUI Footer für einfache Seitenabschlüsse.",
    variant: "footer",
    packageIds: ["website.builder"],
    data: { brand: "ACME Industries Ltd.", note: "Providing reliable tech since 1992" },
    template: template("footer", `<footer class="footer sm:footer-horizontal bg-neutral text-neutral-content p-10">
  <aside>
    <p class="footer-title">{{ brand | ACME Industries Ltd. }}</p>
    <p>{{ note | Providing reliable tech since 1992 }}</p>
  </aside>
  <nav>
    <h6 class="footer-title">Services</h6>
    <a class="link link-hover">Branding</a>
    <a class="link link-hover">Design</a>
    <a class="link link-hover">Marketing</a>
  </nav>
</footer>`)
  }
]);

function templateForSpec(spec) {
  if (spec.template) return cloneJson(spec.template);
  return template(spec.variant || "card", `<div class="card bg-base-100 w-96 shadow-sm"><div class="card-body"><h2 class="card-title">${spec.title || "Preset"}</h2></div></div>`, docs("card"));
}

function daisyTemplate(spec, packageById) {
  const key = normalizeId(spec.rootStateId || spec.id);
  const packageIds = normalizePackageIds(spec.packageIds, ["core.process"], packageById);
  const componentTemplate = templateForSpec(spec);
  return {
    id: spec.managed ? spec.id : "builtin_daisy_" + key,
    rootStateId: key,
    title: spec.title,
    description: spec.description || "Echte DaisyUI-Komponente mit State-Datenbindung.",
    builtIn: spec.managed !== true,
    categoryId: spec.categoryId || "websuite-builder",
    packageIds,
    template: componentTemplate,
    components: [{
      id: "builtin_daisy_" + key + "_component",
      type: "daisy",
      variant: spec.variant || spec.id,
      dataPath: stateDataScopeForId(key),
      dataRole: "widget",
      dataLabel: spec.title,
      template: componentTemplate
    }],
    data: normalizeStateDataObject(spec.data),
    dataTypes: isPlainObject(spec.dataTypes) ? cloneJson(spec.dataTypes) : {},
    transitions: Array.isArray(spec.transitions) ? cloneJson(spec.transitions) : []
  };
}

function builtinStateTemplates(libraryValue) {
  const library = resolvedPresetLibrary(libraryValue);
  const packageById = packageMapForLibrary(library);
  const builtins = BUILTIN_DAISY_PRESETS.map(spec => daisyTemplate(spec, packageById));
  const managed = library.presets.map(spec => daisyTemplate({ ...spec, managed: true }, packageById));
  return [...builtins, ...managed];
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
  if (/(?:^|\.)(?:image|avatar|src)$/.test(key)) return "image";
  return "text";
}

function collectLocalFieldTypes(data, explicitTypes = {}) {
  const cleanData = normalizeStateDataObject(data);
  const out = {};
  const explicit = isPlainObject(explicitTypes) ? explicitTypes : {};
  function visit(value, path) {
    if (!path) {
      if (isPlainObject(value)) for (const [key, child] of Object.entries(value)) visit(child, key);
      return;
    }
    const explicitType = valueTypes.normalizeValueType(explicit[path]);
    out[path] = explicitType || inferValueType(path, value);
    if (isPlainObject(value)) for (const [key, child] of Object.entries(value)) visit(child, path + "." + key);
  }
  visit(cleanData, "");
  for (const [rawPath, rawType] of Object.entries(explicit)) {
    const path = normalizeDataTypePath(rawPath);
    const type = valueTypes.normalizeValueType(rawType);
    if (path && type && valueAtPath(cleanData, path) !== undefined) out[path] = type;
  }
  return out;
}

function absoluteFieldTypes(rootStateId, localFieldTypes, hasData) {
  const root = stateDataScopeForId(rootStateId);
  const out = hasData ? { [root]: "object" } : {};
  for (const [path, type] of Object.entries(localFieldTypes || {})) out[root + "." + path] = type;
  return out;
}

function normalizePreset(preset, library) {
  const packageById = packageMapForLibrary(library);
  const rootStateId = normalizeId(preset.rootStateId || preset.id || "preset");
  const data = normalizeStateDataObject(preset.data);
  const dataTypes = collectLocalFieldTypes(data, preset.dataTypes);
  const hasData = Object.keys(data).length > 0;
  const fieldTypes = absoluteFieldTypes(rootStateId, dataTypes, hasData);
  const fields = Object.keys(fieldTypes);
  const packageIds = normalizePackageIds(preset.packageIds, ["core.process"], packageById);
  const primaryPackageId = packageIds[0] || "core.process";
  return {
    builtIn: true,
    ...preset,
    rootStateId,
    data,
    dataTypes,
    categoryId: preset.categoryId || "websuite-builder",
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
      root: stateDataScopeForId(rootStateId),
      fields,
      fieldTypes,
      fieldSchemas: valueTypes.fieldSchemasFromTypeMap(fieldTypes)
    }
  };
}

function presetCatalogResponse(libraryValue) {
  const library = resolvedPresetLibrary(libraryValue);
  return builtinStateTemplates(library).map(preset => normalizePreset(preset, library));
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
      const presetIds = presets.filter(preset => Array.isArray(preset.packageIds) && preset.packageIds.includes(item.id)).map(preset => preset.id);
      const includedInPlanIds = SUBSCRIPTION_PLANS
        .filter(plan => normalizePackageIds(plan.includedPackageIds, [], packageById).includes(item.id))
        .map(plan => plan.id);
      return { ...cloneJson(item), includedInPlanIds, presetIds, presetCount: presetIds.length };
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

module.exports = {
  builtinStateTemplates,
  presetCatalogResponse,
  presetCategoriesResponse,
  presetPackagesResponse,
  subscriptionPlansResponse
};
