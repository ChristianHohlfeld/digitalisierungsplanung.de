"use strict";

const eventCatalog = require("./event-catalog");
const productContract = require("./product-contract");

const DEFAULT_CONTRACT_PATH = "/contract";
const DEFAULT_PRESETS_ADMIN_CATALOG_PATH = "/presets-admin/catalog";

function compactText(value, fallback = "") {
  return String(value || fallback).replace(/\s+/g, " ").trim();
}

function unique(values) {
  return [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))];
}

function currentContract(config = {}) {
  return productContract.productContractResponse({
    eventCatalog: config.eventCatalog || eventCatalog.loadEventCatalogFile(config.eventCatalogPath),
    presetLibrary: config.presetLibrary
  });
}

function componentVariants(preset = {}) {
  return unique((Array.isArray(preset.components) ? preset.components : [])
    .map(component => component?.variant || component?.type));
}

function actionLabels(preset = {}) {
  const labels = [];
  const collect = value => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (typeof value.actionLabel === "string") labels.push(value.actionLabel);
    Object.values(value).forEach(collect);
  };
  collect(preset.data);
  return unique(labels).slice(0, 6);
}

function presetHint(preset = {}) {
  const title = compactText(preset.title || preset.id, "Preset");
  const variants = componentVariants(preset);
  const variant = compactText(preset.variant || variants[0], "component");
  const description = compactText(preset.description);
  const root = compactText(preset.stateContribution?.root);
  const parts = [`${title} (${variant})`];
  if (description) parts.push(description);
  if (root) parts.push(`schreibt in ${root}`);
  if (variants.length) parts.push(`rendert ${variants.join(", ")}`);
  return parts.join("; ") + ".";
}

function compactPreset(preset = {}) {
  const fieldTypes = preset.stateContribution?.fieldTypes || {};
  const variants = componentVariants(preset);
  return {
    id: compactText(preset.id),
    title: compactText(preset.title || preset.id),
    variant: compactText(preset.variant || variants[0]),
    description: compactText(preset.description),
    categoryId: compactText(preset.categoryId),
    packageIds: unique(Array.isArray(preset.packageIds) ? preset.packageIds : []),
    dataRoot: compactText(preset.stateContribution?.root),
    dataKeys: Object.keys(preset.data || {}).slice(0, 16),
    fields: Object.keys(fieldTypes).slice(0, 16),
    actionLabels: actionLabels(preset),
    hint: presetHint(preset)
  };
}

function agentContractContext(config = {}) {
  const contract = currentContract(config);
  const presets = (Array.isArray(contract.presets) ? contract.presets : [])
    .map(compactPreset)
    .filter(preset => preset.id)
    .sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
  return {
    schemaVersion: 1,
    sourceOfTruth: "product-contract",
    freshness: "Built per request from the current /contract response; no browser or chat shadow catalog.",
    endpoints: {
      contract: config.productContractPath || DEFAULT_CONTRACT_PATH,
      presetsAdminCatalog: config.presetsAdminCatalogPath || DEFAULT_PRESETS_ADMIN_CATALOG_PATH
    },
    counts: {
      categories: Array.isArray(contract.presetCategories) ? contract.presetCategories.length : 0,
      packages: Array.isArray(contract.presetPackages) ? contract.presetPackages.length : 0,
      presets: presets.length
    },
    categories: (Array.isArray(contract.presetCategories) ? contract.presetCategories : []).map(category => ({
      id: compactText(category.id),
      label: compactText(category.label || category.id),
      description: compactText(category.description)
    })),
    packages: (Array.isArray(contract.presetPackages) ? contract.presetPackages : []).map(item => ({
      id: compactText(item.id),
      label: compactText(item.label || item.id),
      description: compactText(item.description),
      buyerValue: compactText(item.buyerValue),
      presetCount: Number(item.presetCount || 0),
      presetIds: unique(Array.isArray(item.presetIds) ? item.presetIds : [])
    })),
    presets
  };
}

function presetPromptLines(context = {}, limit = 36) {
  const presets = Array.isArray(context.presets) ? context.presets : [];
  return presets.slice(0, limit).map(preset => {
    const packages = Array.isArray(preset.packageIds) && preset.packageIds.length
      ? ` packages=${preset.packageIds.join(",")}`
      : "";
    return `- ${preset.id}: ${preset.hint}${packages}`;
  });
}

module.exports = {
  agentContractContext,
  presetPromptLines
};
