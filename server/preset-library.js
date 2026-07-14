"use strict";

const fs = require("node:fs");
const path = require("node:path");
const parse5 = require("parse5");

const DAISY_VERSION = "5.6.18";
const PRESET_LIBRARY_SCHEMA_VERSION = 1;
const DEFAULT_PRESET_LIBRARY_PATH = path.join(__dirname, "preset-library.json");
const MAX_SNIPPET_BYTES = 64 * 1024;
const ID_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const CUSTOM_PRESET_ID_PATTERN = /^custom_[a-z0-9_]{1,56}$/;
const LOCAL_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REQUIRED_PACKAGE_IDS = new Set(["core.process", "website.builder", "approval.compliance", "service.operations", "bi.analytics", "sales.crm", "knowledge.portal", "integration.automation"]);
const SUPPORTED_VARIANTS = new Set([
  "accordion", "alert", "avatar", "badge", "bottom-navigation", "breadcrumbs",
  "button", "card", "carousel", "checkbox", "countdown", "drawer", "dropdown",
  "feature-grid", "file-input", "footer", "hero", "indicator", "input", "loading",
  "mask", "menu", "modal", "navbar", "pricing", "progress", "radial-progress",
  "radio", "range", "rating", "select", "stat", "steps", "table", "tabs",
  "textarea", "timeline", "toast", "toggle", "chart"
]);

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
    if (!LOCAL_KEY_PATTERN.test(key)) throw contractError("invalid_preset_data_key");
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
      if (String(child || "").trim() && urlKeys.some(urlKey => String(value[urlKey] || "").trim())) {
        throw contractError("preset_action_target_conflict");
      }
      if (child !== "") throw contractError("preset_transition_binding_must_be_empty");
      continue;
    }
    assertUnmaterializedTransitionBindings(child);
  }
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
  assertOnlyFields(value, new Set(["id", "variant", "title", "description", "categoryId", "packageIds", "data"]));
  const id = cleanText(value.id, "", 64);
  if (!CUSTOM_PRESET_ID_PATTERN.test(id)) throw contractError("invalid_custom_preset_id");
  const variant = cleanText(value.variant, "", 40);
  if (!SUPPORTED_VARIANTS.has(variant)) throw contractError("unsupported_daisy_variant");
  const categoryId = validId(value.categoryId, "invalid_category_id");
  if (!categoryIds.has(categoryId)) throw contractError("unknown_category");
  const assignedPackages = Array.isArray(value.packageIds)
    ? [...new Set(value.packageIds.map(item => validId(item, "invalid_package_id")))]
    : [];
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
    data
  };
}

function validatePresetLibrary(value) {
  if (!isPlainObject(value)) throw contractError("invalid_preset_library");
  assertOnlyFields(value, new Set(["schemaVersion", "daisyVersion", "categories", "packages", "presets"]));
  if (value.schemaVersion !== PRESET_LIBRARY_SCHEMA_VERSION) throw contractError("invalid_schema_version");
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
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    throw contractError("preset_library_load_failed", 500);
  }
  return validatePresetLibrary(parsed);
}

function serializePresetLibrary(value) {
  return JSON.stringify(validatePresetLibrary(value), null, 2) + "\n";
}

function attr(node, name) {
  return node?.attrs?.find(item => item.name === name)?.value || "";
}

function hasAttr(node, name) {
  return Boolean(node?.attrs?.some(item => item.name === name));
}

function classSet(node) {
  return new Set(attr(node, "class").split(/\s+/).filter(Boolean));
}

function elementChildren(node) {
  return (node?.childNodes || []).filter(child => Boolean(child.tagName));
}

function walk(node, visit, ancestors = []) {
  if (node?.tagName) visit(node, ancestors);
  for (const child of node?.childNodes || []) walk(child, visit, node?.tagName ? [...ancestors, node] : ancestors);
}

function textContent(node) {
  if (!node) return "";
  if (node.nodeName === "#text") return node.value || "";
  return cleanText((node.childNodes || []).map(textContent).join(" ").replace(/\s+/g, " "), "", 2000);
}

function hasClass(node, name) {
  return classSet(node).has(name);
}

function findAll(node, predicate) {
  const out = [];
  walk(node, child => { if (predicate(child)) out.push(child); });
  return out;
}

function first(node, predicate) {
  return findAll(node, predicate)[0] || null;
}

function byClass(node, name) {
  return first(node, child => hasClass(child, name));
}

function allByClass(node, name) {
  return findAll(node, child => hasClass(child, name));
}

function firstTag(node, ...names) {
  const accepted = new Set(names);
  return first(node, child => accepted.has(child.tagName));
}

function texts(nodes) {
  return nodes.map(textContent).filter(Boolean);
}

function safeImageUrl(value) {
  const url = cleanText(value, "", 1000);
  return /^https:\/\/[^\s<>"']+$/i.test(url) ? url : "";
}

function toneFromClasses(node, prefix, fallback = "primary") {
  const value = [...classSet(node)].find(name => name.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function variantForNode(node) {
  const classes = classSet(node);
  const has = name => classes.has(name);
  if (has("toast")) return "toast";
  if (has("footer")) return "footer";
  if (has("navbar")) return "navbar";
  if (has("hero")) return "hero";
  if (has("modal")) return "modal";
  if (has("drawer")) return "drawer";
  if (has("carousel")) return "carousel";
  if (has("breadcrumbs")) return "breadcrumbs";
  if (has("dropdown")) return "dropdown";
  if (has("collapse")) return "accordion";
  if (has("timeline")) return "timeline";
  if (has("steps")) return "steps";
  if (has("tabs")) return "tabs";
  if (has("stats") || has("stat")) return "stat";
  if (has("rating")) return "rating";
  if (has("radial-progress")) return "radial-progress";
  if (has("progress")) return "progress";
  if (has("countdown")) return "countdown";
  if (has("loading")) return "loading";
  if (has("indicator")) return "indicator";
  if (has("dock") || has("btm-nav") || has("bottom-nav")) return "bottom-navigation";
  if (has("file-input")) return "file-input";
  if (has("toggle")) return "toggle";
  if (has("checkbox")) return "checkbox";
  if (has("radio")) return "radio";
  if (has("range")) return "range";
  if (has("select")) return "select";
  if (has("textarea")) return "textarea";
  if (has("input")) return "input";
  if (has("table")) return "table";
  if (has("menu")) return "menu";
  if (has("alert")) return "alert";
  if (has("avatar")) return "avatar";
  if (has("badge")) return "badge";
  if (has("mask")) return "mask";
  if (has("card")) return "card";
  if (has("btn")) return "button";
  return "";
}

function findComponentRoot(fragment) {
  const candidates = [];
  walk(fragment, (node, ancestors) => {
    const variant = variantForNode(node);
    if (!variant) return;
    const parentCandidate = ancestors.some(parent => Boolean(variantForNode(parent)));
    if (!parentCandidate) candidates.push({ node, variant });
  });
  if (!candidates.length) throw contractError("supported_daisy_component_required");
  if (candidates.length > 1 && candidates.every(candidate => candidate.variant === "accordion")) {
    return { node: fragment, variant: "accordion" };
  }
  if (candidates.length !== 1) throw contractError("ambiguous_daisy_component");
  return candidates[0];
}

function labelForControl(root) {
  const label = first(root, node => node.tagName === "label");
  return textContent(label) || attr(root, "aria-label") || attr(root, "placeholder") || "Wert";
}

function buttonLabels(root) {
  return texts(findAll(root, node => node.tagName === "button" || hasClass(node, "btn")));
}

function linkItems(root) {
  return texts(findAll(root, node => ["a", "button", "li"].includes(node.tagName)))
    .filter((item, index, values) => values.indexOf(item) === index);
}

function extractData(variant, root) {
  const heading = textContent(firstTag(root, "h1", "h2", "h3", "h4", "h5", "h6"));
  const paragraph = textContent(firstTag(root, "p"));
  const buttons = buttonLabels(root);
  const image = firstTag(root, "img");
  if (variant === "footer") {
    const aside = first(root, node => node.tagName === "aside");
    const columns = findAll(root, node => node.tagName === "nav").map(nav => ({
      title: textContent(byClass(nav, "footer-title")) || "Links",
      items: findAll(nav, node => node.tagName === "a" || node.tagName === "button")
        .map(node => ({ label: textContent(node), transitionId: "" })).filter(item => item.label)
    }));
    const asideParagraphs = aside ? findAll(aside, node => node.tagName === "p") : [];
    return { brand: textContent(byClass(aside, "footer-title")) || textContent(asideParagraphs[0]) || "Marke", note: textContent(asideParagraphs[1]) || "", columns };
  }
  if (variant === "navbar") {
    const search = first(root, node => node.tagName === "input" && (attr(node, "type") || "text") === "text");
    const dropdowns = allByClass(root, "dropdown");
    const items = texts(findAll(root, node => node.tagName === "li"));
    return { layout: search ? "search-dropdown" : dropdowns.length > 1 ? "cart-profile" : items.length ? "menu-submenu" : "title-only", brand: textContent(byClass(root, "text-xl")) || buttons[0] || heading || "Marke", selected: items[0] || "", items, search: attr(search, "value"), submenu: [], submenuOpen: false, profileOpen: false, cartOpen: false };
  }
  if (variant === "hero") return { layout: image ? "figure" : "centered", title: heading || "Titelbereich", body: paragraph, actionLabel: buttons[0] || "Weiter", image: safeImageUrl(attr(image, "src")) };
  if (variant === "card") return { title: heading || "Karte", body: paragraph, image: safeImageUrl(attr(image, "src")), imageAlt: attr(image, "alt"), actionLabel: buttons.at(-1) || "Weiter" };
  if (variant === "accordion") return { open: textContent(byClass(root, "collapse-title")), items: allByClass(root, "collapse").map(section => ({ label: textContent(byClass(section, "collapse-title")), body: textContent(byClass(section, "collapse-content")) })).filter(item => item.label) };
  if (variant === "alert") return { tone: toneFromClasses(root, "alert-", "info"), message: textContent(root) };
  if (variant === "toast") { const alert = byClass(root, "alert") || root; return { visible: true, tone: toneFromClasses(alert, "alert-", "info"), message: textContent(alert) }; }
  if (variant === "avatar") return { name: attr(image, "alt") || "Avatar", image: safeImageUrl(attr(image, "src")), status: hasClass(root, "online") ? "online" : hasClass(root, "offline") ? "offline" : "", initials: textContent(byClass(root, "placeholder")), placeholder: !image };
  if (variant === "badge") return { label: textContent(root), tone: toneFromClasses(root, "badge-", "primary") };
  if (variant === "bottom-navigation") { const items = linkItems(root); return { selected: items[0] || "Start", items }; }
  if (variant === "breadcrumbs") return { items: findAll(root, node => node.tagName === "li").map(node => ({ label: textContent(node), transitionId: "" })).filter(item => item.label) };
  if (variant === "button") return { label: textContent(root) || "Weiter", clicked: false, clickedAt: 0 };
  if (variant === "carousel") return { index: 0, images: findAll(root, node => node.tagName === "img").map(node => safeImageUrl(attr(node, "src"))).filter(Boolean) };
  if (variant === "checkbox" || variant === "toggle") { const controls = findAll(root, node => hasClass(node, variant)); return { legend: heading || "Einstellungen", label: labelForControl(root), checked: controls.some(node => hasAttr(node, "checked")), items: controls.map(node => ({ label: textContent(node.parentNode) || labelForControl(node), checked: hasAttr(node, "checked") })) }; }
  if (variant === "countdown") return { duration: Number(attr(root, "style").match(/--value:\s*(\d+)/)?.[1] || 20), value: Number(attr(root, "style").match(/--value:\s*(\d+)/)?.[1] || 20), label: paragraph || "Sekunden übrig", running: true, finished: false, startedAt: 0, endsAt: 0 };
  if (variant === "drawer") return { open: Boolean(first(root, node => node.tagName === "input" && hasAttr(node, "checked"))), title: heading || "Menü", selected: linkItems(root)[0] || "", items: linkItems(root) };
  if (variant === "dropdown") { const items = texts(findAll(root, node => node.tagName === "li")); return { selected: buttons[0] || items[0] || "Auswählen", options: items, open: false }; }
  if (variant === "file-input") return { label: labelForControl(root), filename: "" };
  if (variant === "indicator") return { label: buttons.at(-1) || paragraph || "Element", count: Number(textContent(byClass(root, "indicator-item"))) || 0 };
  if (variant === "input" || variant === "textarea") return { label: labelForControl(root), value: attr(root, "value") || textContent(root) };
  if (variant === "loading") return { label: attr(root, "aria-label") || paragraph || "Lädt...", active: true, durationMs: 2000, nextLabel: "Weiter" };
  if (variant === "mask") return { image: safeImageUrl(attr(image || root, "src")), alt: attr(image || root, "alt"), shape: [...classSet(root)].find(name => name.startsWith("mask-") && name !== "mask")?.slice(5) || "squircle" };
  if (variant === "menu") { const items = texts(findAll(root, node => node.tagName === "li")); return { selected: items[0] || "", items }; }
  if (variant === "modal") return { open: hasAttr(root, "open"), confirmed: false, openLabel: "Dialog öffnen", title: heading || "Dialog", body: paragraph, actionLabel: buttons[0] || "Bestätigen", closeLabel: buttons[1] || "Schließen" };
  if (variant === "progress" || variant === "radial-progress") return { value: Number(attr(root, "value") || attr(root, "style").match(/--value:\s*(\d+)/)?.[1] || 0), max: Number(attr(root, "max") || 100), label: attr(root, "aria-label") || paragraph || "Fortschritt" };
  if (variant === "radio") { const controls = findAll(root, node => hasClass(node, "radio")); const options = controls.map(node => attr(node, "aria-label") || attr(node, "value") || textContent(node.parentNode)).filter(Boolean); return { label: labelForControl(root), value: attr(controls.find(node => hasAttr(node, "checked")), "value") || options[0] || "", options }; }
  if (variant === "range") return { label: labelForControl(root), value: Number(attr(root, "value") || 0), min: Number(attr(root, "min") || 0), max: Number(attr(root, "max") || 100) };
  if (variant === "rating") { const controls = findAll(root, node => node.tagName === "input"); const selected = Math.max(0, controls.findIndex(node => hasAttr(node, "checked")) + 1); return { label: attr(root, "aria-label") || "Bewertung", value: selected || 1, max: controls.length || 5 }; }
  if (variant === "select") { const options = findAll(root, node => node.tagName === "option"); return { label: labelForControl(root), value: textContent(options.find(node => hasAttr(node, "selected"))) || textContent(options[0]), options: texts(options) }; }
  if (variant === "stat") return { title: textContent(byClass(root, "stat-title")) || heading || "Kennzahl", value: textContent(byClass(root, "stat-value")) || "0", description: textContent(byClass(root, "stat-desc")) || paragraph };
  if (variant === "steps") { const items = texts(allByClass(root, "step")); return { current: textContent(first(root, node => hasClass(node, "step-primary"))) || items[0] || "", items: items.map(label => ({ label, description: "" })) }; }
  if (variant === "table") { const headers = texts(findAll(root, node => node.tagName === "th")); const rows = findAll(root, node => node.tagName === "tr").map(row => texts(elementChildren(row).filter(node => node.tagName === "td"))).filter(row => row.length); return { columns: headers, rows }; }
  if (variant === "tabs") { const items = texts(allByClass(root, "tab")); return { selected: textContent(first(root, node => hasClass(node, "tab-active"))) || items[0] || "", items }; }
  if (variant === "timeline") return { current: "", items: findAll(root, node => node.tagName === "li").map(item => ({ title: textContent(firstTag(item, "h1", "h2", "h3", "div")) || textContent(item), body: textContent(firstTag(item, "p")) })).filter(item => item.title) };
  return { title: heading || "Baustein", body: paragraph };
}

function slug(value) {
  return cleanText(value, "preset", 80).toLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "preset";
}

function parseDaisySnippet(payload) {
  if (!isPlainObject(payload)) throw contractError("invalid_json");
  const snippet = String(payload.snippet || "");
  if (!snippet.trim()) throw contractError("snippet_required");
  if (Buffer.byteLength(snippet, "utf8") > MAX_SNIPPET_BYTES) throw contractError("snippet_too_large", 413);
  const fragment = parse5.parseFragment(snippet);
  walk(fragment, node => {
    if (["script", "style", "iframe", "object", "embed", "link", "meta", "template"].includes(node.tagName)) throw contractError("unsafe_snippet_element");
    if ((node.attrs || []).some(item => /^on/i.test(item.name))) throw contractError("unsafe_snippet_attribute");
  });
  const { node, variant } = findComponentRoot(fragment);
  const title = cleanText(payload.title, "", 120) || textContent(firstTag(node, "h1", "h2", "h3", "h4", "h5", "h6")) || `${variant} Preset`;
  const requestedId = cleanText(payload.id, "", 64);
  const id = requestedId || `custom_${slug(title)}`;
  if (!CUSTOM_PRESET_ID_PATTERN.test(id)) throw contractError("invalid_custom_preset_id");
  return {
    id,
    variant,
    title,
    description: cleanText(payload.description, `Aus DaisyUI ${DAISY_VERSION} importierter ${variant}-Baustein.`, 500),
    categoryId: validId(payload.categoryId || "websuite-builder", "invalid_category_id"),
    packageIds: Array.isArray(payload.packageIds) ? [...new Set(payload.packageIds.map(item => validId(item, "invalid_package_id")))] : [],
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
