"use strict";

const fs = require("node:fs");
const path = require("node:path");
const parse5 = require("parse5");

const DAISY_VERSION = "5.7.0";
const PRESET_LIBRARY_SCHEMA_VERSION = 2;
const DEFAULT_PRESET_LIBRARY_PATH = path.join(__dirname, "preset-library.json");
const MAX_SNIPPET_BYTES = 64 * 1024;
const ID_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const CUSTOM_PRESET_ID_PATTERN = /^custom_[a-z0-9_]{1,56}$/;
const LOCAL_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REQUIRED_PACKAGE_IDS = new Set([
  "core.process",
  "website.builder",
  "approval.compliance",
  "service.operations",
  "bi.analytics",
  "sales.crm",
  "knowledge.portal",
  "integration.automation"
]);
const SUPPORTED_VARIANTS = new Set([
  "accordion", "alert", "avatar", "badge", "bottom-navigation", "breadcrumbs",
  "button", "card", "checkbox", "drawer", "dropdown", "footer", "hero", "input",
  "menu", "modal", "navbar", "progress", "radio", "select", "steps", "table",
  "tabs", "textarea", "toggle"
]);
const UNSAFE_TAGS = new Set(["script", "style", "iframe", "object", "embed", "link", "meta", "template"]);
const SAFE_ATTR_URL = /^(?:#|\/|\.\/|\.\.\/|https:\/\/|mailto:|tel:|data:image\/)/i;

function contractError(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertOnlyFields(value, fields) {
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) throw contractError("unknown_field");
  }
}

function cleanText(value, fallback = "", max = 500) {
  return String(value ?? fallback).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
}

function requiredText(value, code, max = 160) {
  const text = cleanText(value, "", max);
  if (!text) throw contractError(code);
  return text;
}

function validId(value, code = "invalid_id") {
  const id = cleanText(value, "", 64);
  if (!ID_PATTERN.test(id)) throw contractError(code);
  return id;
}

function normalizeDataValue(value, depth = 0) {
  if (depth > 8) throw contractError("preset_data_too_deep");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(item => normalizeDataValue(item, depth + 1));
  if (!isPlainObject(value)) throw contractError("invalid_preset_data");
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (!LOCAL_KEY_PATTERN.test(key) || key === "_snippet") throw contractError("invalid_preset_data_key");
    out[key] = normalizeDataValue(child, depth + 1);
  }
  return out;
}

function assertUnmaterializedTransitionBindings(value) {
  if (Array.isArray(value)) {
    value.forEach(assertUnmaterializedTransitionBindings);
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (/transitionId$/i.test(key)) {
      const prefix = key.slice(0, key.length - "TransitionId".length);
      const urlKeys = prefix
        ? [`${prefix}Url`, `${prefix}Href`, ...(prefix.toLowerCase() === "primary" ? ["url", "href"] : [])]
        : ["url", "href"];
      if (String(child || "").trim() && urlKeys.some(urlKey => String(value[urlKey] || "").trim())) throw contractError("preset_action_target_conflict");
      if (child !== "") throw contractError("preset_transition_binding_must_be_empty");
      continue;
    }
    assertUnmaterializedTransitionBindings(child);
  }
}

function walk(node, visit) {
  if (node?.tagName) visit(node);
  for (const child of node?.childNodes || []) walk(child, visit);
}

function attr(node, name) {
  return node?.attrs?.find(item => item.name === name)?.value || "";
}

function classSet(node) {
  return new Set(attr(node, "class").split(/\s+/).filter(Boolean));
}

function textContent(node) {
  if (!node) return "";
  if (node.nodeName === "#text") return node.value || "";
  return cleanText((node.childNodes || []).map(textContent).join(" ").replace(/\s+/g, " "), "", 2000);
}

function first(node, predicate) {
  let found = null;
  walk(node, child => { if (!found && predicate(child)) found = child; });
  return found;
}

function findAll(node, predicate) {
  const out = [];
  walk(node, child => { if (predicate(child)) out.push(child); });
  return out;
}

function variantForNode(node) {
  const classes = classSet(node);
  const has = name => classes.has(name);
  if (has("navbar")) return "navbar";
  if (has("hero")) return "hero";
  if (has("modal")) return "modal";
  if (has("drawer")) return "drawer";
  if (has("dropdown")) return "dropdown";
  if (has("collapse")) return "accordion";
  if (has("steps")) return "steps";
  if (has("tabs")) return "tabs";
  if (has("table")) return "table";
  if (has("footer")) return "footer";
  if (has("alert")) return "alert";
  if (has("card")) return "card";
  if (has("btn")) return "button";
  if (has("input")) return "input";
  if (has("textarea")) return "textarea";
  if (has("select")) return "select";
  if (has("checkbox")) return "checkbox";
  if (has("toggle")) return "toggle";
  if (has("radio")) return "radio";
  if (has("progress")) return "progress";
  if (has("badge")) return "badge";
  if (has("avatar")) return "avatar";
  if (has("menu")) return "menu";
  if (has("breadcrumbs")) return "breadcrumbs";
  if (has("btm-nav") || has("dock")) return "bottom-navigation";
  return "";
}

function validateTemplateHtml(html) {
  const snippet = String(html || "");
  if (!snippet.trim()) throw contractError("template_required");
  if (Buffer.byteLength(snippet, "utf8") > MAX_SNIPPET_BYTES) throw contractError("snippet_too_large", 413);
  const fragment = parse5.parseFragment(snippet);
  walk(fragment, node => {
    const tag = String(node.tagName || "").toLowerCase();
    if (UNSAFE_TAGS.has(tag)) throw contractError("unsafe_snippet_element");
    for (const item of node.attrs || []) {
      const name = String(item.name || "").toLowerCase();
      const value = String(item.value || "").trim();
      if (/^on/.test(name)) throw contractError("unsafe_snippet_attribute");
      if ((name === "href" || name === "src" || name === "action" || name === "formaction") && value && !SAFE_ATTR_URL.test(value)) throw contractError("unsafe_snippet_url");
      if (name === "style" && /url\s*\(/i.test(value)) throw contractError("unsafe_snippet_style");
    }
  });
  return { fragment, html: snippet.trim() };
}

function findComponentRoot(fragment) {
  let out = null;
  walk(fragment, node => {
    if (out) return;
    const variant = variantForNode(node);
    if (variant) out = { node, variant };
  });
  if (!out) throw contractError("unsupported_daisy_variant");
  if (!SUPPORTED_VARIANTS.has(out.variant)) throw contractError("unsupported_daisy_variant");
  return out;
}

function normalizeTemplate(value, variant) {
  if (!isPlainObject(value)) throw contractError("invalid_template");
  assertOnlyFields(value, new Set(["source", "version", "docsPath", "html"]));
  const source = cleanText(value.source || "daisyui", "daisyui", 40);
  if (source !== "daisyui") throw contractError("invalid_template_source");
  const checked = validateTemplateHtml(value.html);
  const root = findComponentRoot(checked.fragment);
  if (variant && root.variant !== variant && !(variant === "button" && root.variant === "button")) throw contractError("template_variant_mismatch");
  return {
    source,
    version: cleanText(value.version || DAISY_VERSION, DAISY_VERSION, 40),
    docsPath: cleanText(value.docsPath || "", "", 300),
    html: checked.html
  };
}

function extractData(variant, root) {
  const heading = textContent(first(root, node => /^h[1-6]$/.test(node.tagName)));
  const paragraph = textContent(first(root, node => node.tagName === "p"));
  const buttons = findAll(root, node => node.tagName === "button" || classSet(node).has("btn")).map(textContent).filter(Boolean);
  const input = first(root, node => ["input", "textarea", "select"].includes(node.tagName));
  if (variant === "button") return { label: textContent(root) || "Button", clicked: false, clickedAt: 0 };
  if (variant === "card") return { title: heading || "Card Title", body: paragraph, actionLabel: buttons.at(-1) || "Buy Now" };
  if (variant === "alert") return { message: textContent(root) || "Alert" };
  if (variant === "input" || variant === "textarea" || variant === "select") return { label: attr(input, "aria-label") || attr(input, "placeholder") || "Field", value: attr(input, "value") || "" };
  if (variant === "checkbox" || variant === "toggle" || variant === "radio") return { label: attr(input, "aria-label") || textContent(root) || "Option", checked: Boolean(attr(input, "checked")) };
  if (variant === "navbar") return { brand: heading || textContent(first(root, node => classSet(node).has("text-xl"))) || "Brand" };
  if (variant === "hero") return { title: heading || "Hero", body: paragraph, actionLabel: buttons[0] || "Get started" };
  if (variant === "footer") return { brand: textContent(root) || "Footer" };
  return { title: heading || textContent(root) || `${variant} Preset`, body: paragraph };
}

function validateCategory(value) {
  if (!isPlainObject(value)) throw contractError("invalid_category");
  assertOnlyFields(value, new Set(["id", "label", "description", "sort"]));
  return {
    id: validId(value.id, "invalid_category_id"),
    label: requiredText(value.label, "category_label_required", 80),
    description: cleanText(value.description, "", 300),
    sort: Number.isSafeInteger(value.sort) ? Math.max(0, Math.min(10000, value.sort)) : 1000
  };
}

function validatePackage(value) {
  if (!isPlainObject(value)) throw contractError("invalid_package");
  assertOnlyFields(value, new Set(["id", "label", "category", "description", "buyerValue", "upsell", "sort"]));
  return {
    id: validId(value.id, "invalid_package_id"),
    label: requiredText(value.label, "package_label_required", 80),
    category: requiredText(value.category, "package_category_required", 40),
    description: cleanText(value.description, "", 500),
    buyerValue: cleanText(value.buyerValue, "", 500),
    upsell: value.upsell === true,
    sort: Number.isSafeInteger(value.sort) ? Math.max(0, Math.min(10000, value.sort)) : 1000
  };
}

function validatePreset(value, categoryIds, packageIds) {
  if (!isPlainObject(value)) throw contractError("invalid_preset");
  assertOnlyFields(value, new Set(["id", "variant", "title", "description", "categoryId", "packageIds", "template", "data"]));
  const id = cleanText(value.id, "", 64);
  if (!CUSTOM_PRESET_ID_PATTERN.test(id)) throw contractError("invalid_custom_preset_id");
  const variant = cleanText(value.variant, "", 40);
  if (!SUPPORTED_VARIANTS.has(variant)) throw contractError("unsupported_daisy_variant");
  const categoryId = validId(value.categoryId, "invalid_category_id");
  if (!categoryIds.has(categoryId)) throw contractError("unknown_category");
  const assignedPackages = Array.isArray(value.packageIds) ? [...new Set(value.packageIds.map(item => validId(item, "invalid_package_id")))] : [];
  if (!assignedPackages.length) throw contractError("preset_package_required");
  if (assignedPackages.some(packageId => !packageIds.has(packageId))) throw contractError("unknown_package");
  const data = normalizeDataValue(value.data);
  if (!isPlainObject(data)) throw contractError("invalid_preset_data");
  assertUnmaterializedTransitionBindings(data);
  return {
    id,
    variant,
    title: requiredText(value.title, "preset_title_required", 120),
    description: cleanText(value.description, "", 500),
    categoryId,
    packageIds: assignedPackages,
    template: normalizeTemplate(value.template, variant),
    data
  };
}

function validatePresetLibrary(value) {
  if (!isPlainObject(value)) throw contractError("invalid_preset_library");
  assertOnlyFields(value, new Set(["schemaVersion", "daisyVersion", "categories", "packages", "presets"]));
  if (![1, PRESET_LIBRARY_SCHEMA_VERSION].includes(value.schemaVersion)) throw contractError("invalid_schema_version");
  if (value.daisyVersion !== DAISY_VERSION) throw contractError("invalid_daisy_version");
  if (!Array.isArray(value.categories) || !value.categories.length) throw contractError("categories_required");
  if (!Array.isArray(value.packages) || !value.packages.length) throw contractError("packages_required");
  if (!Array.isArray(value.presets)) throw contractError("invalid_presets");
  if (value.categories.length > 40 || value.packages.length > 80 || value.presets.length > 500) throw contractError("preset_library_too_large", 413);
  const categories = value.categories.map(validateCategory);
  const packages = value.packages.map(validatePackage);
  const categoryIds = new Set(categories.map(item => item.id));
  const packageIds = new Set(packages.map(item => item.id));
  if (categoryIds.size !== categories.length) throw contractError("duplicate_category_id");
  if (packageIds.size !== packages.length) throw contractError("duplicate_package_id");
  if (!categoryIds.has("websuite-builder")) throw contractError("websuite_category_required");
  if ([...REQUIRED_PACKAGE_IDS].some(id => !packageIds.has(id))) throw contractError("core_package_required");
  const presets = value.presets.map(item => validatePreset(item, categoryIds, packageIds));
  if (new Set(presets.map(item => item.id)).size !== presets.length) throw contractError("duplicate_preset_id");
  return {
    schemaVersion: PRESET_LIBRARY_SCHEMA_VERSION,
    daisyVersion: DAISY_VERSION,
    categories: categories.sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label)),
    packages: packages.sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label)),
    presets: presets.sort((a, b) => a.title.localeCompare(b.title))
  };
}

function validatePresetDefinition(value, library) {
  const normalizedLibrary = validatePresetLibrary(library);
  return validatePreset(
    value,
    new Set(normalizedLibrary.categories.map(item => item.id)),
    new Set(normalizedLibrary.packages.map(item => item.id))
  );
}

function loadPresetLibraryFile(filePath = DEFAULT_PRESET_LIBRARY_PATH) {
  try {
    return validatePresetLibrary(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch (error) {
    if (error?.code) throw error;
    throw contractError("preset_library_load_failed", 500);
  }
}

function serializePresetLibrary(value) {
  return JSON.stringify(validatePresetLibrary(value), null, 2) + "\n";
}

function slug(value) {
  return cleanText(value, "preset", 80).toLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "preset";
}

function parseDaisySnippet(payload) {
  if (!isPlainObject(payload)) throw contractError("invalid_json");
  const snippet = String(payload.snippet || "");
  const checked = validateTemplateHtml(snippet);
  const { node, variant } = findComponentRoot(checked.fragment);
  const title = cleanText(payload.title, "", 120) || textContent(first(node, child => /^h[1-6]$/.test(child.tagName))) || `${variant} Preset`;
  const requestedId = cleanText(payload.id, "", 64);
  const id = requestedId || `custom_${slug(title)}`;
  if (!CUSTOM_PRESET_ID_PATTERN.test(id)) throw contractError("invalid_custom_preset_id");
  return {
    id,
    variant,
    title,
    description: cleanText(payload.description, `Original DaisyUI ${DAISY_VERSION} ${variant} template.`, 500),
    categoryId: validId(payload.categoryId || "websuite-builder", "invalid_category_id"),
    packageIds: Array.isArray(payload.packageIds) ? [...new Set(payload.packageIds.map(item => validId(item, "invalid_package_id")))] : [],
    template: {
      source: "daisyui",
      version: DAISY_VERSION,
      docsPath: cleanText(payload.docsPath || "", "", 300),
      html: checked.html
    },
    data: normalizeDataValue(extractData(variant, node))
  };
}

module.exports = {
  DAISY_VERSION,
  DEFAULT_PRESET_LIBRARY_PATH,
  PRESET_LIBRARY_SCHEMA_VERSION,
  SUPPORTED_VARIANTS,
  loadPresetLibraryFile,
  parseDaisySnippet,
  serializePresetLibrary,
  validatePresetDefinition,
  validatePresetLibrary
};
