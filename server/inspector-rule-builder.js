"use strict";

const OPERATORS = Object.freeze(["==", "!=", ">", ">=", "<", "<=", "truthy", "falsy"]);
const JOINERS = Object.freeze(["and", "or"]);
const PRIMARY_RULE_FIELDS = new Set(["checked", "value", "selected", "selectedValue", "enabled", "visible", "count"]);
const HIDDEN_UI_FIELDS = new Set(["label", "placeholder", "help", "hint", "title", "description", "min", "max", "step", "src", "url"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanPath(value) {
  return String(value || "").trim().replace(/^\.+|\.+$/g, "");
}

function inferType(value, declared = "") {
  const raw = String(declared || "").toLowerCase();
  if (["boolean", "bool", "checked"].includes(raw) || typeof value === "boolean") return "boolean";
  if (["number", "int", "float"].includes(raw) || typeof value === "number") return "number";
  if (["email", "url", "date", "password"].includes(raw)) return raw;
  return "text";
}

function leafName(path) {
  return String(path || "").split(".").filter(Boolean).at(-1) || "";
}

function shouldExposeRuleField(localPath, value, type) {
  const leaf = leafName(localPath);
  if (!leaf) return false;
  if (PRIMARY_RULE_FIELDS.has(leaf)) return true;
  if (HIDDEN_UI_FIELDS.has(leaf)) return false;
  if (["boolean", "number", "email", "date", "password"].includes(type)) return true;
  if (typeof value === "string" && leaf === "value") return true;
  return false;
}

function walkStateData(state, value, localPath = "", out = []) {
  if (!isPlainObject(value)) {
    if (!localPath || Array.isArray(value)) return out;
    const type = inferType(value, state.dataTypes?.[localPath]);
    if (!shouldExposeRuleField(localPath, value, type)) return out;
    const stateId = String(state.id || "").trim();
    const title = String(state.title || stateId || "State").trim();
    out.push({
      path: `states.${stateId}.${localPath}`,
      label: `${title} (${stateId}) · ${localPath}`,
      source: "state",
      stateId,
      type
    });
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    const nextPath = localPath ? `${localPath}.${key}` : key;
    walkStateData(state, child, nextPath, out);
  }
  return out;
}

function stateFields(model, stateId = "") {
  const states = Array.isArray(model?.states) ? model.states : [];
  const wanted = String(stateId || "");
  const selected = wanted ? states.filter(item => String(item.id) === wanted) : states;
  return selected.flatMap(state => walkStateData(state, isPlainObject(state.data) ? state.data : {}));
}

function allStateFields(model, sourceStateId = "") {
  const states = Array.isArray(model?.states) ? model.states : [];
  const source = String(sourceStateId || "");
  const sorted = [...states].sort((a, b) => {
    const aSource = String(a.id) === source ? 0 : 1;
    const bSource = String(b.id) === source ? 0 : 1;
    if (aSource !== bSource) return aSource - bSource;
    return String(a.title || a.id).localeCompare(String(b.title || b.id));
  });
  return sorted.flatMap(state => walkStateData(state, isPlainObject(state.data) ? state.data : {}));
}

function eventFields(contract = {}) {
  const datasets = Array.isArray(contract.datasets) ? contract.datasets : [];
  const fields = [];
  for (const dataset of datasets) {
    const datasetId = String(dataset.id || "").trim();
    const datasetLabel = String(dataset.label || dataset.name || datasetId || "Event").trim();
    const sourceFields = isPlainObject(dataset.fields) ? dataset.fields : {};
    for (const [name, type] of Object.entries(sourceFields)) {
      fields.push({
        path: `${datasetId}.detail.${name}`,
        label: `${datasetLabel} · ${name}`,
        source: "event",
        eventId: datasetId,
        type: inferType(null, type)
      });
    }
  }
  return fields;
}

function contextFieldsForTransition(model, transition = {}, contract = {}) {
  const from = String(transition.from || "");
  const fields = [...allStateFields(model, from), ...eventFields(contract)];
  const seen = new Set();
  return fields.filter(field => {
    const path = cleanPath(field.path);
    if (!path || seen.has(path)) return false;
    seen.add(path);
    field.path = path;
    field.sourceState = field.source === "state" && String(field.stateId) === from;
    return true;
  });
}

function parseValue(raw = "") {
  const value = String(raw || "").trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value.replace(/^["']|["']$/g, "");
}

function valueLiteral(value) {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(String(value ?? ""));
}

function parseAtom(raw = "") {
  const atom = String(raw || "").trim();
  if (!atom || atom === "true") return null;
  if (atom.startsWith("!")) return { field: cleanPath(atom.slice(1)), operator: "falsy", value: "" };
  const match = atom.match(/^([a-zA-Z_][a-zA-Z0-9_]*(?:\.(?:[a-zA-Z_][a-zA-Z0-9_]*|\d+))*)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (match) return { field: cleanPath(match[1]), operator: match[2], value: parseValue(match[3]) };
  return { field: cleanPath(atom), operator: "truthy", value: "" };
}

function parseCondition(condition = "") {
  const text = String(condition || "").trim();
  if (!text) return { join: "and", rules: [] };
  const join = text.includes("||") ? "or" : "and";
  const splitter = join === "or" ? "||" : "&&";
  return {
    join,
    rules: text.split(splitter).map(parseAtom).filter(Boolean)
  };
}

function compileRule(rule = {}) {
  const field = cleanPath(rule.field);
  if (!field) return "";
  const operator = OPERATORS.includes(rule.operator) ? rule.operator : "==";
  if (operator === "truthy") return field;
  if (operator === "falsy") return `!${field}`;
  return `${field} ${operator} ${valueLiteral(rule.value)}`;
}

function compileCondition(rules = [], join = "and") {
  const glue = join === "or" ? " || " : " && ";
  return rules.map(compileRule).filter(Boolean).join(glue);
}

function removeRule(rules = [], index) {
  return rules.filter((_, current) => current !== Number(index));
}

function operatorsForFieldType(type = "text") {
  const normalized = String(type || "text").toLowerCase();
  if (normalized === "boolean") return ["==", "!=", "truthy", "falsy"];
  if (normalized === "number") return ["==", "!=", ">", ">=", "<", "<="];
  return ["==", "!=", "truthy", "falsy"];
}

module.exports = {
  OPERATORS,
  JOINERS,
  cleanPath,
  compileCondition,
  compileRule,
  contextFieldsForTransition,
  eventFields,
  operatorsForFieldType,
  parseCondition,
  removeRule,
  stateFields
};
