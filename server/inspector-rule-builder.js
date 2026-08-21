"use strict";

const OPERATORS = Object.freeze(["==", "!=", ">", ">=", "<", "<=", "truthy", "falsy", "contains"]);
const JOINERS = Object.freeze(["and", "or"]);

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

function walkStateData(state, value, localPath = "", out = []) {
  if (!isPlainObject(value)) {
    if (!localPath || Array.isArray(value)) return out;
    const type = inferType(value, state.dataTypes?.[localPath]);
    out.push({
      path: `states.${state.id}.${localPath}`,
      label: `${state.title || state.id} · ${localPath}`,
      source: "state",
      stateId: state.id,
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

function stateFields(model, stateId) {
  const states = Array.isArray(model?.states) ? model.states : [];
  const state = states.find(item => String(item.id) === String(stateId));
  if (!state) return [];
  return walkStateData(state, isPlainObject(state.data) ? state.data : {});
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
  const fields = [...stateFields(model, from), ...eventFields(contract)];
  const seen = new Set();
  return fields.filter(field => {
    const path = cleanPath(field.path);
    if (!path || seen.has(path)) return false;
    seen.add(path);
    field.path = path;
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
  const text = String(value ?? "").trim();
  if (!text) return "\"\"";
  if (/^-?\d+(?:\.\d+)?$/.test(text) || text === "true" || text === "false") return text;
  if (/^[a-zA-Z0-9_@.:-]+$/.test(text)) return text;
  return JSON.stringify(text);
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
  if (operator === "contains") return `${field} != \"\" && ${field} != null`;
  return `${field} ${operator} ${valueLiteral(rule.value)}`;
}

function compileCondition(rules = [], join = "and") {
  const glue = join === "or" ? " || " : " && ";
  return rules.map(compileRule).filter(Boolean).join(glue);
}

function removeRule(rules = [], index) {
  return rules.filter((_, current) => current !== Number(index));
}

module.exports = {
  OPERATORS,
  JOINERS,
  cleanPath,
  compileCondition,
  compileRule,
  contextFieldsForTransition,
  eventFields,
  parseCondition,
  removeRule,
  stateFields
};
