"use strict";

const eventCatalog = require("../server/event-catalog");
const productContract = require("../server/product-contract");
const valueTypes = require("../server/value-types");

const ROOT_LAYER_ID = "__root__";
const GRID_SIZE = 24;
const NODE_W = 192;
const NODE_H = 96;
const WORLD_MIN_X = -10000;
const WORLD_MIN_Y = -8000;
const WORLD_MAX_X = 20000;
const WORLD_MAX_Y = 16000;
const STATE_VARIABLE_TYPES = ["text", "email", "password", "number", "boolean", "url", "image", "object", "list"];
const COMPONENT_TYPES = ["heading", "text", "image", "list", "link", "note", "divider", "daisy", "transitionButton", "dataWire"];
const TRANSITION_TRIGGER_TYPES = ["button", "change", "event", "realtime", "api", "timer", "auto"];
const TRANSITION_TRIGGER_CONTRACT_TYPES = new Set([...TRANSITION_TRIGGER_TYPES, "flow"]);
const DATA_WIRE_ROLES = ["image", "title", "price", "description", "field", "link", "note"];
const FORBIDDEN_COMPONENT_STATE_KEYS = ["localState", "stateStore", "store", "html"];
const REPOSITORY_PRODUCT_CONTRACT = productContract.productContractResponse(eventCatalog.loadEventCatalogFile());
const CONTRACT_READABLE_PATHS = new Set(
  REPOSITORY_PRODUCT_CONTRACT.stateContributions.flatMap(contribution => [
    contribution.root,
    ...(Array.isArray(contribution.fields) ? contribution.fields : [])
  ])
);
const CONTRACT_REALTIME_EVENTS = new Set(
  (REPOSITORY_PRODUCT_CONTRACT.triggerTypes.find(type => type.id === "realtime")?.events || [])
    .map(event => event.name)
);
const CONTRACT_REALTIME_EVENTS_BY_NAME = new Map(
  (REPOSITORY_PRODUCT_CONTRACT.triggerTypes.find(type => type.id === "realtime")?.events || [])
    .map(event => [event.name, event])
);
const TRIGGER_MATCH_TYPES = new Set(["realtime"]);
const TRIGGER_MATCH_OPERATORS = new Set(["equals", "gt", "gte", "lt", "lte", "between"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function snapToGrid(value) {
  return Math.round(Number(value || 0) / GRID_SIZE) * GRID_SIZE;
}

function snapClampToGrid(value, min, max) {
  return snapToGrid(clamp(Number.isFinite(Number(value)) ? Number(value) : 0, min, max));
}

function normalizeId(text, fallback = "state") {
  return String(text || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "") || fallback;
}

function uniqueId(existing, requested, prefix = "id") {
  const used = existing instanceof Set ? existing : new Set(existing || []);
  let base = normalizeId(requested || prefix, prefix);
  if (!base.startsWith(prefix) && !requested) base = `${prefix}_${base}`;
  let id = base;
  let index = 2;
  while (used.has(id)) id = `${base}_${index++}`;
  used.add(id);
  return id;
}

function uniqueRawId(existing, requested, prefix = "id") {
  const used = existing instanceof Set ? existing : new Set(existing || []);
  const base = String(requested || "").trim() || uniqueId([], prefix, prefix);
  let id = base;
  let index = 2;
  while (used.has(id)) id = `${base}_${index++}`;
  used.add(id);
  return id;
}

function normalizeContextPath(path, fallback = "") {
  const text = String(path || "").trim();
  if (!text) return fallback;
  return /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(text) ? text : fallback;
}

function normalizeBindingPath(path, fallback = "") {
  const text = String(path || "").trim();
  if (!text) return fallback;
  return /^[a-zA-Z_][a-zA-Z0-9_]*(\.(?:[a-zA-Z_][a-zA-Z0-9_]*|\d+))*$/.test(text) ? text : fallback;
}

function normalizeDataTypePath(path, fallback = "") {
  return normalizeBindingPath(path, fallback);
}

function stateDataScopeForId(id) {
  const clean = normalizeId(id || "state");
  return clean ? `states.${clean}` : "";
}

function stateVariableActualPath(state, value) {
  const localPath = stateVariableLocalPath(value);
  if (!localPath) return "";
  const scope = stateDataScopeForId(state?.id);
  return scope ? `${scope}.${localPath}` : localPath;
}

function stateVariableLocalPath(value) {
  const raw = normalizeBindingPath(value, "");
  return raw && !raw.startsWith("states.") ? raw : "";
}

function runtimeActionPath(value) {
  const raw = normalizeBindingPath(value, "");
  if (!raw) return "";
  return runtimeBusPathIsReadable(raw) ? raw : "";
}

function runtimeBusPathIsReadable(value) {
  const path = normalizeBindingPath(value, "");
  return /^states\.[a-zA-Z_][a-zA-Z0-9_]*\./.test(path)
    || path === "state.current"
    || path === "runtime.paused"
    || CONTRACT_READABLE_PATHS.has(path);
}

function runtimeBusPathIsWritable(value) {
  return /^states\.[a-zA-Z_][a-zA-Z0-9_]*\./.test(normalizeBindingPath(value, ""));
}

function conditionRuntimePaths(condition) {
  const withoutStrings = String(condition || "").replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, " ");
  return withoutStrings.match(/[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*/g) || [];
}

function conditionContractIssue(condition) {
  const text = String(condition || "").trim();
  if (!text) return "";
  const pathPattern = "[a-zA-Z_][a-zA-Z0-9_]*(?:\\.(?:[a-zA-Z_][a-zA-Z0-9_]*|\\d+))*";
  const pathOnly = new RegExp(`^${pathPattern}$`);
  const comparison = new RegExp(`^(${pathPattern})\\s*(==|!=|>=|<=|>|<)\\s*(.+)$`);
  const literal = /^(?:true|false|-?\d+(?:\.\d+)?|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')$/;
  for (const orPart of text.split("||")) {
    if (!orPart.trim()) return "Condition contains an empty OR branch.";
    for (let atom of orPart.split("&&")) {
      atom = atom.trim();
      if (!atom) return "Condition contains an empty AND branch.";
      if (atom === "true" || atom === "false") continue;
      if (atom.startsWith("!")) {
        const path = atom.slice(1).trim();
        if (!pathOnly.test(path) || !runtimeBusPathIsReadable(path)) return `Invalid condition atom: ${atom}`;
        continue;
      }
      const match = atom.match(comparison);
      if (match) {
        if (!runtimeBusPathIsReadable(match[1]) || !literal.test(match[3].trim())) return `Invalid condition comparison: ${atom}`;
        if ([">", ">=", "<", "<="].includes(match[2]) && !/^-?\d+(?:\.\d+)?$/.test(match[3].trim())) {
          return `Numeric comparison requires a numeric literal: ${atom}`;
        }
        continue;
      }
      if (!pathOnly.test(atom) || !runtimeBusPathIsReadable(atom)) return `Invalid condition atom: ${atom}`;
    }
  }
  return "";
}

function runtimeReferenceContractIssuesForState(state) {
  const stateId = String(state?.id || "");
  const issues = [];
  const add = (code, path, message) => issues.push({ code, stateId, path, message });
  for (const component of Array.isArray(state?.components) ? state.components : []) {
    if (component?.dataPath && !runtimeBusPathIsWritable(component.dataPath)) {
      add("invalid_component_data_path", String(component.dataPath), "Component dataPath must use states.<id>.<field>.");
    }
    for (const value of [component?.text, component?.url, ...(Array.isArray(component?.items) ? component.items.flatMap(item => [item?.text, item?.url]) : [])]) {
      if (/\{\{[\s\S]*?\}\}/.test(String(value || ""))) {
        add("invalid_component_template", String(value || ""), "Component text must be literal; bind runtime data through dataPath or dataWires.");
      }
    }
  }
  for (const wire of Array.isArray(state?.dataWires) ? state.dataWires : []) {
    if (!runtimeBusPathIsReadable(wire?.sourcePath || wire?.path)) add("invalid_data_wire_source", String(wire?.sourcePath || wire?.path || ""), "Data-wire sourcePath must use a fully qualified runtime bus path.");
    if (wire?.scopePath && !runtimeBusPathIsReadable(wire.scopePath)) add("invalid_data_wire_scope", String(wire.scopePath), "Data-wire scopePath must use a fully qualified runtime bus path.");
  }
  if (state?.dataSource?.target && !runtimeBusPathIsWritable(state.dataSource.target)) {
    add("invalid_data_source_target", String(state.dataSource.target), "Fetch target must use states.<id>.<field>.");
  }
  if (state?.repeat?.path && !runtimeBusPathIsReadable(state.repeat.path)) {
    add("invalid_repeat_path", String(state.repeat.path), "Repeat path must use a fully qualified runtime bus path.");
  }
  for (const subscription of Array.isArray(state?.subscriptions) ? state.subscriptions : []) {
    if (subscription !== "*" && !runtimeBusPathIsReadable(subscription)) add("invalid_subscription_path", String(subscription), "Subscription must be * or a fully qualified runtime bus path.");
  }
  return issues;
}

function normalizeTriggerMatch(value) {
  if (!isPlainObject(value)) return {};
  const field = normalizeBindingPath(value.field || "", "");
  const operator = String(value.operator || "").trim();
  if (!field || !TRIGGER_MATCH_OPERATORS.has(operator)) return {};
  const out = { field, operator };
  if (operator === "between") {
    const range = normalizeTriggerMatchRange(value.value);
    if (!range) return {};
    out.value = range;
  } else if (Object.hasOwn(value, "value")) out.value = clone(value.value);
  else out.value = "";
  return out;
}

function triggerMatchIsEmpty(match) {
  return !isPlainObject(match) || !normalizeBindingPath(match.field || "", "") || !TRIGGER_MATCH_OPERATORS.has(String(match.operator || ""));
}

function canonicalTriggerMatchValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "";
  if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (isPlainObject(value) && Number.isFinite(value.min) && Number.isFinite(value.max)) {
    return JSON.stringify({
      min: value.min,
      minInclusive: value.minInclusive !== false,
      max: value.max,
      maxInclusive: value.maxInclusive !== false
    });
  }
  return "";
}

function canonicalTriggerMatchKey(match) {
  const normalized = normalizeTriggerMatch(match);
  if (triggerMatchIsEmpty(normalized)) return "*";
  const value = canonicalTriggerMatchValue(normalized.value);
  if (!value) return "";
  return `${normalized.field}:${normalized.operator}:${value}`;
}

function triggerMatchOperatorsForSchema(schema) {
  const type = String(schema?.type || "").trim();
  if (type === "number") return new Set(["equals", "gt", "gte", "lt", "lte", "between"]);
  if (["boolean", "text", "email", "url", "image"].includes(type)) return new Set(["equals"]);
  return new Set();
}

function normalizeTriggerMatchRange(value) {
  if (!isPlainObject(value)) return null;
  const min = Number(value.min);
  const max = Number(value.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const minInclusive = value.minInclusive !== false;
  const maxInclusive = value.maxInclusive !== false;
  if (min > max) return null;
  if (min === max && (!minInclusive || !maxInclusive)) return null;
  return { min, minInclusive, max, maxInclusive };
}

function triggerMatchInterval(match, schema) {
  const normalized = normalizeTriggerMatch(match);
  if (triggerMatchIsEmpty(normalized) || String(schema?.type || "") !== "number") return null;
  if (normalized.operator === "equals") {
    if (!valueTypes.validateValueAgainstSchema(normalized.value, schema).ok) return null;
    return { min: normalized.value, minInclusive: true, max: normalized.value, maxInclusive: true };
  }
  if (normalized.operator === "gt" || normalized.operator === "gte") {
    if (!valueTypes.validateValueAgainstSchema(normalized.value, schema).ok) return null;
    return { min: normalized.value, minInclusive: normalized.operator === "gte", max: Infinity, maxInclusive: false };
  }
  if (normalized.operator === "lt" || normalized.operator === "lte") {
    if (!valueTypes.validateValueAgainstSchema(normalized.value, schema).ok) return null;
    return { min: -Infinity, minInclusive: false, max: normalized.value, maxInclusive: normalized.operator === "lte" };
  }
  if (normalized.operator === "between") {
    const range = normalizeTriggerMatchRange(normalized.value);
    if (!range) return null;
    if (!valueTypes.validateValueAgainstSchema(range.min, schema).ok || !valueTypes.validateValueAgainstSchema(range.max, schema).ok) return null;
    return range;
  }
  return null;
}

function triggerMatchIntervalsOverlap(left, right) {
  if (!left || !right) return true;
  if (left.max < right.min) return false;
  if (right.max < left.min) return false;
  if (left.max === right.min && !(left.maxInclusive && right.minInclusive)) return false;
  if (right.max === left.min && !(right.maxInclusive && left.minInclusive)) return false;
  return true;
}

function transitionTriggerMatchesCanOverlap(left, right) {
  const leftMatch = normalizeTriggerMatch(left?.triggerMatch);
  const rightMatch = normalizeTriggerMatch(right?.triggerMatch);
  if (triggerMatchIsEmpty(leftMatch) || triggerMatchIsEmpty(rightMatch)) return true;
  if (leftMatch.field !== rightMatch.field) return true;
  const event = CONTRACT_REALTIME_EVENTS_BY_NAME.get(normalizeTransitionEvent(left?.triggerEvent || ""));
  const schema = event?.matchFieldSchemas?.[leftMatch.field] || event?.detailSchemas?.[leftMatch.field] || valueTypes.fieldSchemaForType(event?.detail?.[leftMatch.field] || "text");
  if (String(schema?.type || "") === "number") {
    return triggerMatchIntervalsOverlap(triggerMatchInterval(leftMatch, schema), triggerMatchInterval(rightMatch, schema));
  }
  return canonicalTriggerMatchValue(leftMatch.value) === canonicalTriggerMatchValue(rightMatch.value);
}

function triggerMatchContractIssues(transition) {
  const match = normalizeTriggerMatch(transition?.triggerMatch);
  if (triggerMatchIsEmpty(match)) return [];
  const transitionId = String(transition?.id || "");
  const triggerType = String(transition?.triggerType || "button");
  const eventName = normalizeTransitionEvent(transition?.triggerEvent || "");
  const issues = [];
  const add = (code, message) => issues.push({ code, transitionId, path: match.field, message });
  if (!TRIGGER_MATCH_TYPES.has(triggerType)) {
    add("invalid_trigger_match_type", "triggerMatch is only supported for Product Contract realtime events.");
    return issues;
  }
  const event = CONTRACT_REALTIME_EVENTS_BY_NAME.get(eventName);
  if (!event) {
    add("invalid_trigger_match_event", "triggerMatch must reference an event declared by the Product Contract.");
    return issues;
  }
  const allowedFields = new Set(event.matchFields || Object.keys(event.detail || {}));
  if (!allowedFields.has(match.field)) {
    add("invalid_trigger_match_field", "triggerMatch.field must be declared as a matchable Product Contract event field.");
    return issues;
  }
  const schema = event.matchFieldSchemas?.[match.field] || event.detailSchemas?.[match.field] || valueTypes.fieldSchemaForType(event.detail?.[match.field]);
  const operators = triggerMatchOperatorsForSchema(schema);
  if (!operators.has(match.operator)) {
    add("invalid_trigger_match_operator", "triggerMatch.operator is not allowed for this field type.");
    return issues;
  }
  const validation = String(schema?.type || "") === "number" && match.operator === "between"
    ? (() => {
        const interval = triggerMatchInterval(match, schema);
        return interval && Number.isFinite(interval.min) && Number.isFinite(interval.max) ? { ok: true } : { ok: false };
      })()
    : valueTypes.validateValueAgainstSchema(match.value, schema);
  if (!validation.ok) {
    add("invalid_trigger_match_value", "triggerMatch.value must match the Product Contract field type and constraints.");
  }
  return issues;
}

function runtimeReferenceContractIssuesForTransition(transition) {
  const transitionId = String(transition?.id || "");
  const issues = [];
  const conditionIssue = conditionContractIssue(transition?.condition);
  if (conditionIssue) issues.push({ code: "invalid_transition_condition", transitionId, message: conditionIssue });
  for (const path of Object.keys(isPlainObject(transition?.set) ? transition.set : {})) {
    if (!runtimeBusPathIsWritable(path)) issues.push({ code: "invalid_transition_set_path", transitionId, path, message: "Transition set paths must use states.<id>.<field>." });
  }
  const literals = new Set(["true", "false"]);
  for (const path of conditionRuntimePaths(transition?.condition)) {
    if (!literals.has(path) && !runtimeBusPathIsReadable(path)) {
      issues.push({ code: "invalid_transition_condition_path", transitionId, path, message: "Transition condition references must use fully qualified runtime bus paths." });
    }
  }
  const triggerType = String(transition?.triggerType || "button");
  const triggerEvent = String(transition?.triggerEvent || "");
  if (triggerEvent && normalizeTransitionEvent(triggerEvent) !== triggerEvent) {
    issues.push({ code: "invalid_transition_event_name", transitionId, path: triggerEvent, message: "Transition event names must already be canonical." });
  }
  if (triggerType === "change") {
    const path = triggerEvent.startsWith("change.") ? triggerEvent.slice("change.".length) : triggerEvent;
    if (!path || !runtimeBusPathIsReadable(path)) issues.push({ code: "invalid_change_trigger_path", transitionId, path, message: "Change triggers must reference one concrete fully qualified runtime bus path." });
  }
  if (triggerType === "api" && !/^fetch\.[a-z0-9_.]+\.(success|error)$/.test(triggerEvent)) {
    issues.push({ code: "invalid_api_trigger_event", transitionId, path: triggerEvent, message: "API triggers must reference fetch.<target>.success or fetch.<target>.error." });
  }
  if (triggerType === "event" && triggerEvent.startsWith("fetch.")) {
    issues.push({ code: "invalid_event_trigger_namespace", transitionId, path: triggerEvent, message: "Fetch result events belong to triggerType api." });
  }
  if (triggerType === "realtime" && !CONTRACT_REALTIME_EVENTS.has(triggerEvent)) {
    issues.push({ code: "invalid_realtime_trigger_event", transitionId, path: triggerEvent, message: "Realtime triggers must reference an event declared by the Product Contract." });
  }
  issues.push(...triggerMatchContractIssues(transition));
  return issues;
}

function assertRuntimeReferenceContract(entity, kind) {
  const issues = kind === "transition"
    ? runtimeReferenceContractIssuesForTransition(entity)
    : runtimeReferenceContractIssuesForState(entity);
  if (!issues.length) return;
  const error = new Error(issues.map(issue => issue.message).join("; "));
  error.validation = { ok: false, issues };
  throw error;
}

function normalizeDataObject(value) {
  return isPlainObject(value) ? clone(value) : {};
}

function normalizeStateDataValue(value) {
  if (Array.isArray(value)) return value.map(normalizeStateDataValue);
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = normalizeStateDataValue(child);
  }
  return out;
}

function normalizeStateDataObject(value) {
  return isPlainObject(value) ? normalizeStateDataValue(value) : {};
}

function stateDataContractIssues(value, stateId) {
  const issues = [];
  if (value === undefined) return issues;
  if (!isPlainObject(value)) {
    return [{
      code: "invalid_state_data",
      stateId,
      message: "state.data must be an object with local identifier keys."
    }];
  }
  const visit = (node, path) => {
    if (node === null || node === undefined) {
      issues.push({
        code: "invalid_state_data_value",
        stateId,
        path,
        message: `state.data value "${path}" must be defined and must not be null.`
      });
      return;
    }
    if (typeof node === "number" && !Number.isFinite(node)) {
      issues.push({ code: "invalid_state_data_value", stateId, path, message: `state.data value "${path}" must be a finite JSON number.` });
      return;
    }
    if (!["boolean", "number", "object", "string"].includes(typeof node)) {
      issues.push({ code: "invalid_state_data_value", stateId, path, message: `state.data value "${path}" must be a JSON value.` });
      return;
    }
    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(node, index)) {
          issues.push({ code: "invalid_state_data_value", stateId, path: `${path}[${index}]`, message: `state.data value "${path}[${index}]" must not be an array hole.` });
          continue;
        }
        visit(node[index], `${path}[${index}]`);
      }
      return;
    }
    if (typeof node !== "object") return;
    if (!isPlainObject(node)) {
      issues.push({ code: "invalid_state_data_value", stateId, path, message: `state.data value "${path}" must be a plain JSON object.` });
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      const childPath = path ? `${path}.${key}` : key;
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
        issues.push({
          code: "invalid_state_data_key",
          stateId,
          path: childPath,
          message: `state.data key "${childPath}" must be a local identifier without dots.`
        });
      }
      visit(child, childPath);
    }
  };
  visit(value, "");
  return issues;
}

function stateDataTypeContractIssues(value, data, stateId) {
  if (value === undefined) return [];
  if (!isPlainObject(value)) {
    return [{
      code: "invalid_state_data_types",
      stateId,
      message: "state.dataTypes must be an object keyed by local state.data paths."
    }];
  }
  const dataObject = isPlainObject(data) ? data : {};
  const issues = [];
  for (const path of Object.keys(value)) {
    const cleanPath = normalizeDataTypePath(path, "");
    if (!cleanPath || !dataObjectHasPath(dataObject, cleanPath)) {
      issues.push({
        code: "invalid_state_data_type_path",
        stateId,
        path,
        message: `state.dataTypes path "${path}" must reference a local path declared in state.data.`
      });
    }
  }
  return issues;
}

function assertStateDataContract(value, dataTypes, stateId) {
  const issues = [
    ...stateDataContractIssues(value, stateId),
    ...stateDataTypeContractIssues(dataTypes, value, stateId)
  ];
  if (!issues.length) return;
  const error = new Error(issues.map(issue => issue.message).join("; "));
  error.validation = { ok: false, issues };
  throw error;
}

function dataObjectPathSegments(dataObject, path) {
  const key = String(path || "").trim();
  if (!key) return [];
  return key.split(".").filter(Boolean);
}

function dataObjectValueAtPath(data, path) {
  const source = normalizeDataObject(data);
  const parts = dataObjectPathSegments(source, path);
  if (!parts.length) return undefined;
  let node = source;
  for (const part of parts) {
    if (!node || typeof node !== "object" || !Object.prototype.hasOwnProperty.call(node, part)) return undefined;
    node = node[part];
  }
  return node;
}

function dataObjectHasPath(data, path) {
  return dataObjectValueAtPath(data, path) !== undefined;
}

function setDataObjectPath(data, path, value) {
  const source = normalizeDataObject(data);
  const cleanPath = normalizeDataTypePath(path, "");
  const parts = dataObjectPathSegments(source, cleanPath);
  if (!parts.length) return source;
  let node = source;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      node[part] = clone(value);
      return;
    }
    if (!isPlainObject(node[part])) node[part] = {};
    node = node[part];
  });
  return source;
}

function deleteDataObjectPath(data, path) {
  const source = normalizeDataObject(data);
  const parts = dataObjectPathSegments(source, path);
  if (!parts.length) return source;
  let node = source;
  for (const part of parts.slice(0, -1)) {
    if (!node || typeof node !== "object" || !Object.prototype.hasOwnProperty.call(node, part)) return source;
    node = node[part];
  }
  if (node && typeof node === "object") delete node[parts[parts.length - 1]];
  return source;
}

function normalizeStateVariableType(value, fallback = "text") {
  const type = String(value || "").trim();
  return STATE_VARIABLE_TYPES.includes(type) ? type : fallback;
}

function inferStateVariableType(path, value) {
  const key = String(path || "").toLowerCase();
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) return "list";
  if (isPlainObject(value)) return "object";
  const text = String(value ?? "");
  if (/(^|[._-])(password|passwort|secret|token|pin)([._-]|$)/i.test(key)) return "password";
  if (/(^|[._-])(email|e-mail|mail)([._-]|$)/i.test(key) || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) return "email";
  if (/(^|[._-])(image|img|photo|avatar|logo|icon|picture)([._-]|$)/i.test(key) || /\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(text)) return "image";
  if (/(^|[._-])(url|href|link|website)([._-]|$)/i.test(key) || /^https?:\/\//i.test(text)) return "url";
  return "text";
}

function defaultStateVariableValue(type) {
  if (type === "number") return 0;
  if (type === "boolean") return false;
  if (type === "object") return {};
  if (type === "list") return [];
  return "";
}

function normalizeDataTypes(value, data = {}) {
  if (!isPlainObject(value)) return {};
  const dataObject = normalizeDataObject(data);
  const out = {};
  for (const [path, type] of Object.entries(value)) {
    const cleanPath = normalizeDataTypePath(path, "");
    if (cleanPath && dataObjectHasPath(dataObject, cleanPath)) out[cleanPath] = normalizeStateVariableType(type);
  }
  return out;
}

function validateTransitionCondition(condition) {
  const text = String(condition || "");
  const issues = runtimeReferenceContractIssuesForTransition({ condition: text, set: {} });
  if (issues.length) throw new Error(issues[0].message);
  return text;
}

function normalizeTransitionPatch(patch) {
  if (patch === undefined) return {};
  const invalidValuePath = firstInvalidJsonValuePath(patch, "transition.set");
  if (invalidValuePath) throw new Error(`${invalidValuePath} must be a fully defined JSON value.`);
  const out = {};
  for (const [key, value] of Object.entries(normalizeDataObject(patch))) {
    if (!runtimeBusPathIsWritable(key)) throw new Error("Transition set paths must use states.<id>.<field>.");
    out[key] = clone(value);
  }
  return out;
}

function normalizeTransitionEventName(eventName, fallback = "") {
  const event = normalizeTransitionEvent(eventName, fallback);
  if (!event.startsWith("change.")) return event;
  const path = event.slice("change.".length);
  if (!runtimeBusPathIsReadable(path)) throw new Error("Change triggers must reference a fully qualified runtime bus path.");
  return event;
}

function normalizeListItems(items, fallbackText = "") {
  const allowed = new Set(["text", "link", "image", "note", "divider"]);
  if (Array.isArray(items)) {
    return items
      .filter(item => isPlainObject(item) && allowed.has(item.type || "text"))
      .map(item => ({
        id: String(item.id || uniqueId([], item.text || "c", "c")),
        type: item.type || "text",
        text: String(item.text || ""),
        url: String(item.url || "")
      }));
  }
  return String(fallbackText || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => ({ id: uniqueId([], line, "c"), type: "text", text: line, url: "" }));
}

function normalizeComponentDataPath(path, fallback = "") {
  const text = String(path || "").trim();
  if (!text) return fallback;
  return normalizeBindingPath(text, fallback);
}

function hiddenComponentStateKeys(component) {
  if (!isPlainObject(component)) return [];
  return FORBIDDEN_COMPONENT_STATE_KEYS.filter(key => Object.prototype.hasOwnProperty.call(component, key));
}

function assertNoHiddenComponentState(component) {
  const forbidden = hiddenComponentStateKeys(component);
  if (forbidden.length) {
    throw new Error(`Component must not carry ${forbidden[0]}; bind through state.data/dataWires instead.`);
  }
}

function assertNoHiddenComponentStateInComponents(components) {
  for (const component of Array.isArray(components) ? components : []) {
    assertNoHiddenComponentState(component);
  }
}

function assertNoHiddenComponentStateInModel(model) {
  for (const state of Array.isArray(model?.states) ? model.states : []) {
    assertNoHiddenComponentStateInComponents(state?.components);
  }
}

function normalizeComponents(components) {
  const used = new Set();
  return (Array.isArray(components) ? components : [])
    .filter(component => isPlainObject(component) && COMPONENT_TYPES.includes(component.type))
    .slice(0, 160)
    .map(component => {
      const id = uniqueRawId(used, component.id || uniqueId([], component.text || component.type, "c"), "c");
      const norm = {
        id,
        type: component.type,
        text: String(component.text || ""),
        url: String(component.url || ""),
        variant: String(component.variant || "")
      };
      if (component.generatedFromRepeat) norm.generatedFromRepeat = true;
      if (component.generatedFromDataWire) norm.generatedFromDataWire = true;
      if (component.dataPath) norm.dataPath = normalizeComponentDataPath(component.dataPath, "");
      if (component.dataRole) norm.dataRole = String(component.dataRole || "").slice(0, 40);
      if (component.dataLabel) norm.dataLabel = String(component.dataLabel || "").slice(0, 80);
      if (component.type === "transitionButton") norm.transitionId = String(component.transitionId || "");
      if (component.type === "dataWire") norm.wireId = String(component.wireId || "");
      if (component.type === "list") norm.items = normalizeListItems(component.items, component.text);
      return norm;
    });
}

function normalizeDataWireRole(value, fallback = "field") {
  const role = String(value || "").trim().toLowerCase();
  return DATA_WIRE_ROLES.includes(role) ? role : fallback;
}

function normalizeDataWireComponentType(value, role = "field") {
  const type = String(value || "").trim().toLowerCase();
  if (["heading", "text", "image", "link", "note"].includes(type)) return type;
  if (role === "image") return "image";
  if (role === "title") return "heading";
  if (role === "link") return "link";
  if (role === "note") return "note";
  return "text";
}

function dataPathLabel(path, fallback = "Wert") {
  const parts = String(path || "").split(".").filter(Boolean).filter(part => !/^\d+$/.test(part));
  const raw = parts.pop() || fallback;
  const spaced = raw.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  return (spaced || fallback).replace(/^./, ch => ch.toUpperCase());
}

function normalizeDataWire(value) {
  if (!isPlainObject(value)) return null;
  const sourcePath = normalizeBindingPath(value.sourcePath || value.path, "");
  if (!sourcePath) return null;
  const scopePath = normalizeBindingPath(value.scopePath || value.repeatPath || "", "");
  const itemPath = normalizeBindingPath(value.itemPath || "", "");
  const role = normalizeDataWireRole(value.role || value.dataRole, "field");
  const componentType = normalizeDataWireComponentType(value.componentType || value.type, role);
  return {
    id: String(value.id || uniqueId([], sourcePath, "wire")),
    sourcePath,
    scopePath,
    itemPath,
    role,
    componentType,
    label: String(value.label || value.dataLabel || dataPathLabel(itemPath || sourcePath, role)).slice(0, 80)
  };
}

function normalizeDataWires(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map(normalizeDataWire)
    .filter(Boolean)
    .filter(wire => {
      const key = [wire.sourcePath, wire.scopePath, wire.itemPath, wire.role, wire.componentType].join("\u0000");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 80);
}

function normalizeDataSource(value, fallbackTarget = "") {
  const source = isPlainObject(value) ? value : {};
  const timeout = Number(source.timeoutMs);
  const retries = Number(source.retries);
  return {
    url: String(source.url || ""),
    target: normalizeContextPath(source.target, fallbackTarget),
    select: normalizeContextPath(source.select, ""),
    timeoutMs: clamp(Number.isFinite(timeout) ? timeout : 8000, 1000, 30000),
    retries: clamp(Number.isFinite(retries) ? Math.round(retries) : 2, 0, 5)
  };
}

function normalizeContextIdentifier(text, fallback = "item") {
  const value = String(text || "").trim();
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value) ? value : fallback;
}

function normalizeRepeatConfig(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    path: normalizeContextPath(source.path, ""),
    as: normalizeContextIdentifier(source.as, "item"),
    index: normalizeContextIdentifier(source.index, "i"),
    manual: Boolean(source.manual)
  };
}

function normalizeBoundaryConfig(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    entryId: String(source.entryId || ""),
    exitId: String(source.exitId || ""),
    entryDisabled: Boolean(source.entryDisabled),
    exitDisabled: Boolean(source.exitDisabled),
    title: String(source.title || ""),
    note: String(source.note || "")
  };
}

function firstInvalidJsonValuePath(value, path) {
  if (value === null || value === undefined) return path;
  if (typeof value === "number" && !Number.isFinite(value)) return path;
  if (!["boolean", "number", "object", "string"].includes(typeof value)) return path;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) return `${path}[${index}]`;
      const found = firstInvalidJsonValuePath(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return "";
  }
  if (typeof value !== "object") return "";
  if (!isPlainObject(value)) return path;
  for (const [key, child] of Object.entries(value)) {
    const found = firstInvalidJsonValuePath(child, `${path}.${key}`);
    if (found) return found;
  }
  return "";
}

function normalizeSubscriptionPath(value) {
  const text = String(value || "").trim();
  if (text === "*") return "*";
  return normalizeContextPath(text, "");
}

function normalizeSubscriptions(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(/[\n,]+/);
  const seen = new Set();
  const result = [];
  source.forEach(item => {
    const path = normalizeSubscriptionPath(item);
    if (!path || seen.has(path)) return;
    seen.add(path);
    result.push(path);
  });
  return result.slice(0, 64);
}

function normalizeTransitionTriggerType(transition) {
  return transition?.triggerType === undefined ? "button" : String(transition.triggerType);
}

function transitionTriggerContractType(transition) {
  return transition?.triggerType === undefined ? "button" : String(transition.triggerType);
}

function normalizeTransitionTimerMs(value) {
  const numeric = Number(value);
  return Math.min(300000, Math.max(100, Number.isFinite(numeric) ? Math.round(numeric) : 3000));
}

function normalizeTransitionEvent(value, fallback = "") {
  const raw = String(value || fallback || "").trim();
  if (!raw) return "";
  return raw.replace(/[^a-zA-Z0-9_.:-]+/g, ".").replace(/^\.+|\.+$/g, "");
}

function eventSegment(text) {
  return String(text || "event").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "") || "event";
}

function defaultTransitionEvent(transition) {
  const triggerType = normalizeTransitionTriggerType(transition);
  if (triggerType === "button") return "button." + eventSegment(transition?.id || transition?.label || "next") + ".clicked";
  if (triggerType === "timer") return "timer." + eventSegment(transition?.label || transition?.id || "done") + ".done";
  if (triggerType === "auto") return "auto." + eventSegment(transition?.id || transition?.label || "next");
  return "";
}

function byModelId(model, id) {
  return model?.states?.find?.(state => state.id === id) || null;
}

function defaultTransitionLabel() {
  return "Weiter";
}

function normalizeTransitionLabel(transition) {
  const label = String(transition?.label || "").trim();
  return label || defaultTransitionLabel();
}

function boundaryProxyId(parentId, side, transitionId) {
  return `proxy:${parentId}:${side}:${transitionId}`;
}

function isBoundaryProxyId(id) {
  return typeof id === "string" && id.startsWith("proxy:");
}

function boundaryProxyLayerId(id) {
  if (!isBoundaryProxyId(id)) return null;
  const parentId = id.split(":")[1] || ROOT_LAYER_ID;
  return parentId === ROOT_LAYER_ID ? null : parentId;
}

function defaultBoundaryLaneId(side) {
  return `__boundary_${side}`;
}

function layerBoundaryFlowId(parentId, side) {
  return `boundary-flow:${parentId}:${side}`;
}

function boundaryProxyForSide(parentId, side) {
  return boundaryProxyId(parentId, side, defaultBoundaryLaneId(side));
}

function stateParentId(state) {
  return state?.parentId || null;
}

function endpointParentId(model, id) {
  const state = byModelId(model, id);
  return state ? stateParentId(state) : boundaryProxyLayerId(id);
}

function normalizeModel(input) {
  const m = isPlainObject(input) ? clone(input) : {};
  m.version = 2;
  m.name = String(m.name || "Unbenannter Ablauf");
  m.boundary = normalizeBoundaryConfig(m.boundary);
  delete m.realtime;
  m.states = Array.isArray(m.states) ? m.states : [];
  m.transitions = Array.isArray(m.transitions) ? m.transitions : [];
  if (!m.states.length) {
    m.transitions = [];
    m.initial = "";
    m.boundary.entryId = "";
    m.boundary.exitId = "";
    return m;
  }

  const usedStateIds = new Set();
  for (const state of m.states) {
    const explicitId = String(state.id || "").trim();
    state.id = explicitId || uniqueId(usedStateIds, state.title, "state");
    usedStateIds.add(state.id);
    state.title = String(state.title || state.id);
    delete state.renderMode;
    state.components = normalizeComponents(state.components);
    delete state.body;
    state.data = normalizeStateDataObject(state.data);
    state.dataTypes = normalizeDataTypes(state.dataTypes, state.data);
    state.dataSource = normalizeDataSource(state.dataSource, `${stateDataScopeForId(state.id)}.fetch`);
    state.repeat = normalizeRepeatConfig(state.repeat);
    state.dataWires = normalizeDataWires(state.dataWires);
    const wireIds = new Set(state.dataWires.map(wire => wire.id));
    state.components = normalizeComponents(state.components)
      .filter(component => component.type !== "dataWire" || wireIds.has(component.wireId));
    state.subscriptions = normalizeSubscriptions(state.subscriptions);
    state.boundary = normalizeBoundaryConfig(state.boundary);
    state.x = snapClampToGrid(Number.isFinite(Number(state.x)) ? Number(state.x) : 100, WORLD_MIN_X, WORLD_MAX_X - NODE_W);
    state.y = snapClampToGrid(Number.isFinite(Number(state.y)) ? Number(state.y) : 100, WORLD_MIN_Y, WORLD_MAX_Y - NODE_H);
  }

  const ids = new Set(m.states.map(state => state.id));
  for (const state of m.states) {
    state.parentId = typeof state.parentId === "string" && ids.has(state.parentId) && state.parentId !== state.id ? state.parentId : null;
  }

  for (const state of m.states) {
    const seen = new Set([state.id]);
    let current = state;
    while (current?.parentId) {
      if (seen.has(current.parentId)) {
        current.parentId = null;
        break;
      }
      seen.add(current.parentId);
      current = byModelId(m, current.parentId);
    }
  }

  const rootEntry = m.boundary.entryId ? byModelId(m, m.boundary.entryId) : null;
  const rootExit = m.boundary.exitId ? byModelId(m, m.boundary.exitId) : null;
  if (m.boundary.entryId && (!rootEntry || stateParentId(rootEntry) !== null)) m.boundary.entryId = "";
  if (m.boundary.exitId && (!rootExit || stateParentId(rootExit) !== null)) m.boundary.exitId = "";
  for (const state of m.states) {
    const entry = state.boundary.entryId ? byModelId(m, state.boundary.entryId) : null;
    const exit = state.boundary.exitId ? byModelId(m, state.boundary.exitId) : null;
    if (state.boundary.entryId && (!entry || stateParentId(entry) !== state.id)) state.boundary.entryId = "";
    if (state.boundary.exitId && (!exit || stateParentId(exit) !== state.id)) state.boundary.exitId = "";
  }

  const isKnownEndpoint = id => ids.has(id) || isBoundaryProxyId(id);
  const usedTransitionIds = new Set(ids);
  m.transitions = m.transitions
    .filter(transition => isPlainObject(transition))
    .filter(transition => {
      if (!isKnownEndpoint(transition.from) || !isKnownEndpoint(transition.to)) return false;
      if (endpointParentId(m, transition.from) !== endpointParentId(m, transition.to)) return false;
      if (transition.groupEntryId && (!ids.has(transition.groupEntryId) || stateParentId(byModelId(m, transition.groupEntryId)) !== transition.to)) transition.groupEntryId = "";
      if (transition.groupExitId && (!ids.has(transition.groupExitId) || stateParentId(byModelId(m, transition.groupExitId)) !== transition.from)) transition.groupExitId = "";
      return true;
    })
    .map(transition => {
      const explicitId = String(transition.id || "").trim();
      const id = explicitId || uniqueRawId(usedTransitionIds, uniqueId([], transition.label, "t"), "t");
      usedTransitionIds.add(id);
      const triggerType = normalizeTransitionTriggerType(transition);
      const rawTriggerEvent = normalizeTransitionEvent(transition.triggerEvent || "");
      const normalized = {
        ...transition,
        id,
        label: normalizeTransitionLabel(transition),
        condition: String(transition.condition || ""),
        set: normalizeDataObject(transition.set),
        triggerType,
        triggerEvent: normalizeTransitionEvent(rawTriggerEvent || (triggerType === "change" ? "" : defaultTransitionEvent({ ...transition, id, triggerType }))),
        timerMs: normalizeTransitionTimerMs(transition.timerMs),
        groupEntryId: typeof transition.groupEntryId === "string" ? transition.groupEntryId : "",
        groupExitId: typeof transition.groupExitId === "string" ? transition.groupExitId : ""
      };
      const triggerMatch = normalizeTriggerMatch(transition.triggerMatch);
      if (!triggerMatchIsEmpty(triggerMatch)) normalized.triggerMatch = triggerMatch;
      else delete normalized.triggerMatch;
      return normalized;
    });

  delete m.editorGroups;
  if (!ids.has(m.initial)) m.initial = m.states[0]?.id || "";
  return m;
}

function blankModel(name = "State App") {
  return normalizeModel({ version: 2, name, initial: "", states: [], transitions: [], boundary: normalizeBoundaryConfig(null) });
}

function modelSummary(model) {
  const normalized = normalizeModel(model);
  return {
    name: normalized.name,
    initial: normalized.initial,
    states: normalized.states.length,
    transitions: normalized.transitions.length,
    rootStates: normalized.states.filter(state => !state.parentId).length,
    childStates: normalized.states.filter(state => state.parentId).length,
    dataWires: normalized.states.reduce((sum, state) => sum + normalizeDataWires(state.dataWires).length, 0),
    components: normalized.states.reduce((sum, state) => sum + normalizeComponents(state.components).length, 0)
  };
}

function collectTransitionBindingEntries(value, path, entries = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectTransitionBindingEntries(item, `${path}[${index}]`, entries));
    return entries;
  }
  if (!isPlainObject(value)) return entries;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (/transitionId$/i.test(key)) {
      const transitionId = String(child || "").trim();
      if (transitionId) {
        const prefix = key.slice(0, key.length - "TransitionId".length);
        const urlKeys = prefix
          ? [`${prefix}Url`, `${prefix}Href`, ...(prefix.toLowerCase() === "primary" ? ["url", "href"] : [])]
          : ["url", "href"];
        entries.push({
          transitionId,
          path: childPath,
          targetConflict: urlKeys.some(urlKey => String(value[urlKey] || "").trim())
        });
      }
      continue;
    }
    collectTransitionBindingEntries(child, childPath, entries);
  }
  return entries;
}

function componentTransitionBindingEntries(model, state, component) {
  if (component.type === "transitionButton") {
    const transitionId = String(component.transitionId || "").trim();
    return transitionId ? [{ transitionId, path: `components.${component.id}.transitionId` }] : [];
  }
  if (component.type !== "daisy") return [];
  const dataPath = String(component.dataPath || "").trim();
  if (!dataPath) return [];
  const owner = model.states.find(candidate => {
    const scope = stateDataScopeForId(candidate.id);
    return dataPath === scope || dataPath.startsWith(scope + ".");
  });
  if (!owner) return [];
  const scope = stateDataScopeForId(owner.id);
  const localPath = dataPath === scope ? "" : dataPath.slice(scope.length + 1);
  const value = localPath ? dataObjectValueAtPath(owner.data, localPath) : owner.data;
  return collectTransitionBindingEntries(value, `states.${owner.id}.data${localPath ? "." + localPath : ""}`);
}

function effectiveTransitionTriggerStateId(transition) {
  return String(transition?.groupExitId || transition?.from || "");
}

function transitionTriggerBaseKey(transition) {
  const triggerType = normalizeTransitionTriggerType(transition);
  if (triggerType === "flow") return "";
  if (triggerType === "button") return `button:${transition.id}`;
  if (triggerType === "auto" || triggerType === "timer") return triggerType;
  const eventName = normalizeTransitionEvent(transition?.triggerEvent || "");
  return triggerType === "change"
    ? eventName ? `change:${eventName}` : ""
    : eventName ? `${triggerType}:${eventName}` : "";
}

function transitionTriggerContractKey(transition) {
  const baseKey = transitionTriggerBaseKey(transition);
  if (!baseKey) return "";
  const triggerType = normalizeTransitionTriggerType(transition);
  if (!["change", "event", "realtime", "api"].includes(triggerType)) return baseKey;
  const matchKey = canonicalTriggerMatchKey(transition?.triggerMatch);
  return matchKey ? `${baseKey}|match:${matchKey}` : "";
}

function transitionTriggerContractIssues(transitions) {
  const issues = [];
  const byState = new Map();
  for (const transition of transitions) {
    const contractType = transitionTriggerContractType(transition);
    if (!TRANSITION_TRIGGER_CONTRACT_TYPES.has(contractType)) {
      issues.push({
        code: "invalid_transition_trigger_type",
        transitionId: String(transition?.id || ""),
        triggerType: contractType,
        message: "Transition triggerType must be one of button, change, event, realtime, api, timer, auto, flow."
      });
      continue;
    }
    const triggerType = normalizeTransitionTriggerType(transition);
    const technicalBoundaryFlow = Boolean(
      transition?.boundaryFlow ||
      isBoundaryProxyId(transition?.from) ||
      isBoundaryProxyId(transition?.to)
    );
    if (triggerType === "flow" && !technicalBoundaryFlow) {
      issues.push({
        code: "invalid_public_flow_trigger",
        transitionId: String(transition?.id || ""),
        message: "flow is reserved for derived boundary projections."
      });
      continue;
    }
    if (technicalBoundaryFlow) continue;
    const stateId = effectiveTransitionTriggerStateId(transition);
    if (!byState.has(stateId)) byState.set(stateId, []);
    byState.get(stateId).push(transition);
  }
  for (const [stateId, outgoing] of byState) {
    if (outgoing.some(transition => normalizeTransitionTriggerType(transition) === "auto") && outgoing.length !== 1) {
      issues.push({
        code: "exclusive_auto_trigger",
        stateId,
        transitionIds: outgoing.map(transition => transition.id),
        message: "An auto transition must be the only outgoing trigger of its effective state."
      });
      continue;
    }
    const claims = new Map();
    const eventClaims = new Map();
    for (const transition of outgoing) {
      const matchIssues = triggerMatchContractIssues(transition);
      if (matchIssues.length) {
        issues.push(...matchIssues.map(issue => ({ ...issue, stateId })));
        continue;
      }
      const triggerKey = transitionTriggerContractKey(transition);
      const triggerBaseKey = transitionTriggerBaseKey(transition);
      if (!triggerKey) {
        issues.push({ code: "missing_transition_trigger", stateId, transitionId: transition.id, message: "Each transition must define one concrete trigger." });
        continue;
      }
      const matchKey = canonicalTriggerMatchKey(transition?.triggerMatch);
      if (claims.has(triggerKey)) {
        issues.push({
          code: "duplicate_transition_trigger",
          stateId,
          triggerKey,
          transitionIds: [claims.get(triggerKey), transition.id],
          message: "Each trigger identity may be claimed only once per effective state."
        });
        continue;
      }
      claims.set(triggerKey, transition.id);
      if (triggerBaseKey && ["change", "event", "realtime", "api"].includes(normalizeTransitionTriggerType(transition))) {
        const existing = eventClaims.get(triggerBaseKey) || [];
        const hasCatchAll = existing.some(item => item.matchKey === "*");
        if ((matchKey === "*" && existing.length) || (matchKey !== "*" && hasCatchAll)) {
          issues.push({
            code: "ambiguous_transition_trigger_match",
            stateId,
            triggerKey: triggerBaseKey,
            transitionIds: [...existing.map(item => item.id), transition.id],
            message: "A catch-all trigger may not share one event with specific triggerMatch rules."
          });
          continue;
        }
        const overlapping = matchKey !== "*" ? existing.find(item => transitionTriggerMatchesCanOverlap(item.transition, transition)) : null;
        if (overlapping) {
          issues.push({
            code: "ambiguous_transition_trigger_match",
            stateId,
            triggerKey: triggerBaseKey,
            transitionIds: [overlapping.id, transition.id],
            message: "Trigger match rules for one event must be mathematically disjoint."
          });
          continue;
        }
        existing.push({ id: transition.id, matchKey, transition });
        eventClaims.set(triggerBaseKey, existing);
      }
    }
  }
  return issues;
}

function validateModel(model) {
  const rawContractIssues = [];
  if (!isPlainObject(model)) {
    return {
      ok: false,
      issues: [{ code: "invalid_model", message: "Model must be an object." }],
      warnings: [],
      summary: modelSummary(blankModel()),
      model: blankModel()
    };
  }
  if (model.version !== 2) rawContractIssues.push({ code: "invalid_model_version", message: "Model version must be 2." });
  if (!Array.isArray(model.states)) rawContractIssues.push({ code: "invalid_states", message: "Model states must be an array." });
  if (!Array.isArray(model.transitions)) rawContractIssues.push({ code: "invalid_transitions", message: "Model transitions must be an array." });
  rawContractIssues.push(...transitionTriggerContractIssues(Array.isArray(model?.transitions) ? model.transitions : []));
  const forbiddenBoundaryKeys = ["layerTitle", "comment", "entryTriggerType", "entryTriggerEvent"];
  const inspectBoundary = (boundary, path) => {
    if (!isPlainObject(boundary)) return;
    for (const key of forbiddenBoundaryKeys) {
      if (Object.prototype.hasOwnProperty.call(boundary, key)) {
        rawContractIssues.push({
          code: "invalid_boundary_field",
          path: `${path}.${key}`,
          message: `${path}.${key} is not part of the canonical boundary contract.`
        });
      }
    }
  };
  inspectBoundary(model?.boundary, "model.boundary");
  const rawStateIds = new Set();
  const rawStateById = new Map();
  for (const state of Array.isArray(model?.states) ? model.states : []) {
    const id = String(state?.id || "").trim();
    if (!id) {
      rawContractIssues.push({ code: "missing_state_id", message: "Every state must define an ID." });
      continue;
    }
    if (rawStateIds.has(id)) {
      rawContractIssues.push({ code: "duplicate_state_id", stateId: id, message: `State ID ${id} must be unique.` });
      continue;
    }
    rawStateIds.add(id);
    rawStateById.set(id, state);
  }
  if (rawStateIds.size && !rawStateIds.has(String(model.initial || ""))) {
    rawContractIssues.push({ code: "missing_initial", message: "Initial state must reference an existing state." });
  }
  for (const [id, state] of rawStateById) {
    const parentId = state?.parentId == null || state.parentId === "" ? null : String(state.parentId);
    if (parentId && (!rawStateIds.has(parentId) || parentId === id)) {
      rawContractIssues.push({ code: "invalid_parent", stateId: id, message: `Parent of ${id} must reference another state.` });
    }
    const seen = new Set([id]);
    let current = state;
    while (current?.parentId) {
      const parent = String(current.parentId);
      if (seen.has(parent)) {
        rawContractIssues.push({ code: "cyclic_parent", stateId: id, message: `Parent chain of ${id} must not contain a cycle.` });
        break;
      }
      seen.add(parent);
      current = rawStateById.get(parent);
    }
  }
  const validateBoundaryReference = (boundary, parentId, side) => {
    const endpointId = String(boundary?.[side === "entry" ? "entryId" : "exitId"] || "");
    if (!endpointId) return false;
    const endpoint = rawStateById.get(endpointId);
    if (!endpoint || (endpoint.parentId || null) !== parentId) {
      rawContractIssues.push({
        code: `invalid_boundary_${side}`,
        stateId: parentId || "",
        message: `${side === "entry" ? "Entry" : "Exit"} boundary must reference a direct child of its layer.`
      });
      return false;
    }
    return true;
  };
  validateBoundaryReference(model.boundary, null, "entry");
  validateBoundaryReference(model.boundary, null, "exit");
  for (const [id, state] of rawStateById) {
    const children = [...rawStateById.values()].filter(candidate => (candidate.parentId || null) === id);
    const hasEntry = validateBoundaryReference(state.boundary, id, "entry");
    validateBoundaryReference(state.boundary, id, "exit");
    if (children.length && !state?.boundary?.entryDisabled && !hasEntry) {
      rawContractIssues.push({
        code: "missing_boundary_entry",
        stateId: id,
        message: `Parent ${id} must define boundary.entryId or explicitly disable automatic entry.`
      });
    }
  }
  const rawTransitionIds = new Set();
  for (const transition of Array.isArray(model?.transitions) ? model.transitions : []) {
    const id = String(transition?.id || "").trim();
    if (!id) {
      rawContractIssues.push({ code: "missing_transition_id", message: "Every transition must define an ID." });
    } else if (rawTransitionIds.has(id)) {
      rawContractIssues.push({ code: "duplicate_transition_id", transitionId: id, message: `Transition ID ${id} must be unique.` });
    } else {
      rawTransitionIds.add(id);
    }
    if (id && rawStateIds.has(id)) {
      rawContractIssues.push({
        code: "state_transition_id_collision",
        transitionId: id,
        message: "State and transition IDs must share one global namespace."
      });
    }
    if (transition?.boundaryFlow || isBoundaryProxyId(transition?.from) || isBoundaryProxyId(transition?.to)) continue;
    const from = String(transition?.from || "");
    const to = String(transition?.to || "");
    if (!rawStateIds.has(from) || !rawStateIds.has(to)) {
      rawContractIssues.push({ code: "missing_transition_endpoint", transitionId: id, message: `Transition ${id || "<unknown>"} must reference existing states.` });
      continue;
    }
    const fromParent = rawStateById.get(from)?.parentId || null;
    const toParent = rawStateById.get(to)?.parentId || null;
    if (fromParent !== toParent) {
      rawContractIssues.push({ code: "cross_layer_transition", transitionId: id, message: `Transition ${id} must stay inside one layer.` });
    }
  }
  for (const state of Array.isArray(model?.states) ? model.states : []) {
    if (Object.prototype.hasOwnProperty.call(state || {}, "renderMode")) {
      rawContractIssues.push({
        code: "invalid_state_render_mode",
        stateId: String(state?.id || ""),
        message: "renderMode is not part of the contract; visible components belong to their state."
      });
    }
    inspectBoundary(state?.boundary, `model.states.${String(state?.id || "")}.boundary`);
    rawContractIssues.push(...stateDataContractIssues(state?.data, String(state?.id || "")));
    rawContractIssues.push(...stateDataTypeContractIssues(state?.dataTypes, state?.data, String(state?.id || "")));
    rawContractIssues.push(...runtimeReferenceContractIssuesForState(state));
    for (const component of Array.isArray(state?.components) ? state.components : []) {
      for (const forbidden of hiddenComponentStateKeys(component)) {
        rawContractIssues.push({
          code: "hidden_component_state",
          stateId: String(state?.id || ""),
          componentId: String(component?.id || ""),
          message: `Component must not carry ${forbidden}; bind through state.data/dataWires instead.`
        });
      }
    }
  }
  for (const transition of Array.isArray(model?.transitions) ? model.transitions : []) {
    rawContractIssues.push(...runtimeReferenceContractIssuesForTransition(transition));
    if (isPlainObject(transition?.set)) {
      const invalidValuePath = firstInvalidJsonValuePath(transition.set, "transition.set");
      if (invalidValuePath) {
        rawContractIssues.push({
          code: "invalid_transition_set_value",
          transitionId: String(transition?.id || ""),
          path: invalidValuePath,
          message: `${invalidValuePath} must be a fully defined JSON value.`
        });
      }
    }
  }
  const normalized = normalizeModel(model);
  const issues = [...rawContractIssues];
  const warnings = [];
  const ids = new Set(normalized.states.map(state => state.id));
  const transitionById = new Map(normalized.transitions.map(transition => [transition.id, transition]));
  if (normalized.states.length && !ids.has(normalized.initial)) issues.push({ code: "missing_initial", message: "Initial state must reference an existing state." });
  for (const state of normalized.states) {
    const data = normalizeStateDataObject(state.data);
    for (const [path] of Object.entries(normalizeDataTypes(state.dataTypes, data))) {
      if (!dataObjectHasPath(data, path)) warnings.push({ code: "orphan_data_type", stateId: state.id, path, message: "Data type path has no matching state.data value." });
    }
    for (const component of normalizeComponents(state.components)) {
      if (component.type === "transitionButton" && !String(component.transitionId || "").trim()) {
        issues.push({ code: "empty_transition_action_binding", stateId: state.id, componentId: component.id, message: "Transition action bindings must reference one transition ID." });
      }
      for (const binding of componentTransitionBindingEntries(normalized, state, component)) {
        if (binding.targetConflict) {
          issues.push({ code: "transition_action_target_conflict", stateId: state.id, componentId: component.id, transitionId: binding.transitionId, path: binding.path, message: "A UI action slot must target either one transition or one URL, never both." });
          continue;
        }
        const transition = transitionById.get(binding.transitionId);
        if (!transition) {
          issues.push({ code: "missing_transition_action_target", stateId: state.id, componentId: component.id, transitionId: binding.transitionId, path: binding.path, message: "Transition action binding references a missing transition." });
          continue;
        }
        const direct = transition.from === state.id;
        const parentExit = Boolean(state.parentId && transition.from === state.parentId && transition.groupExitId === state.id);
        if (!direct && !parentExit) {
          issues.push({ code: "foreign_transition_action_target", stateId: state.id, componentId: component.id, transitionId: binding.transitionId, path: binding.path, message: "Transition action binding must reference an outgoing transition of its rendered state." });
          continue;
        }
      }
      if (component.type === "dataWire" && !normalizeDataWires(state.dataWires).some(wire => wire.id === component.wireId)) {
        warnings.push({ code: "missing_data_wire_target", stateId: state.id, componentId: component.id, message: "Data-wire component references a missing data wire." });
      }
    }
  }

  for (const transition of normalized.transitions) {
    if (!ids.has(transition.from) && !isBoundaryProxyId(transition.from)) issues.push({ code: "missing_transition_from", transitionId: transition.id, message: "Transition from endpoint is missing." });
    if (!ids.has(transition.to) && !isBoundaryProxyId(transition.to)) issues.push({ code: "missing_transition_to", transitionId: transition.id, message: "Transition to endpoint is missing." });
    if (endpointParentId(normalized, transition.from) !== endpointParentId(normalized, transition.to)) {
      issues.push({ code: "cross_layer_transition", transitionId: transition.id, message: "Transitions must stay inside one layer; use boundary entry/exit references for nested flows." });
    }
    if (!isPlainObject(transition.set)) issues.push({ code: "invalid_transition_set", transitionId: transition.id, message: "Transition set must be an object patch for global state." });
  }

  return {
    ok: issues.length === 0,
    issues,
    warnings,
    summary: modelSummary(normalized),
    model: normalized
  };
}

function findStateOrThrow(model, stateId) {
  const state = byModelId(model, stateId);
  if (!state) throw new Error(`State not found: ${stateId}`);
  return state;
}

function childParentIdForBoundary(model, parentId) {
  return parentId && parentId !== ROOT_LAYER_ID ? parentId : null;
}

function setBoundaryEndpoint(model, parentId, side, stateId) {
  const parentBoundary = parentId && parentId !== ROOT_LAYER_ID
    ? findStateOrThrow(model, parentId).boundary
    : model.boundary;
  if (side === "input") {
    parentBoundary.entryId = stateId || "";
    parentBoundary.entryDisabled = false;
  } else {
    parentBoundary.exitId = stateId || "";
    parentBoundary.exitDisabled = false;
  }
}

function ensureBoundaryFlowTransition(model, parentId, side, stateId) {
  const effectiveParentId = parentId || ROOT_LAYER_ID;
  if (!stateId) return;
  const child = findStateOrThrow(model, stateId);
  const expectedParentId = childParentIdForBoundary(model, effectiveParentId);
  if (stateParentId(child) !== expectedParentId) throw new Error(`Boundary ${side} state must be inside the selected layer.`);
  model.transitions = model.transitions.filter(transition =>
    !(transition.boundaryFlow?.parentId === effectiveParentId && transition.boundaryFlow?.side === side) &&
    transition.id !== layerBoundaryFlowId(effectiveParentId, side)
  );
  const inputProxyId = boundaryProxyForSide(effectiveParentId, "input");
  const outputProxyId = boundaryProxyForSide(effectiveParentId, "output");
  model.transitions.push({
    id: layerBoundaryFlowId(effectiveParentId, side),
    from: side === "input" ? inputProxyId : child.id,
    to: side === "input" ? child.id : outputProxyId,
    label: side === "input" ? "IN" : "OUT",
    condition: "",
    set: {},
    boundaryFlow: { parentId: effectiveParentId, side, stateId: child.id }
  });
}

function createState(model, args) {
  if (Object.prototype.hasOwnProperty.call(args || {}, "renderMode")) {
    throw new Error("renderMode is not part of the contract; visible components belong to their state.");
  }
  if (args?.boundary && ["layerTitle", "comment", "entryTriggerType", "entryTriggerEvent"].some(key => Object.prototype.hasOwnProperty.call(args.boundary, key))) {
    throw new Error("State boundary contains a non-contract field.");
  }
  assertNoHiddenComponentStateInComponents(args.components);
  const existingIds = new Set(model.states.map(state => state.id));
  const id = uniqueId(existingIds, args.id || args.title, "state");
  const parentId = args.parentId ? String(args.parentId) : null;
  if (parentId && !byModelId(model, parentId)) throw new Error(`Parent state not found: ${parentId}`);
  assertStateDataContract(args.data, args.dataTypes, id);
  assertRuntimeReferenceContract({ ...args, id }, "state");
  const state = {
    id,
    title: String(args.title || id),
    components: normalizeComponents(args.components),
    data: normalizeStateDataObject(args.data),
    dataTypes: normalizeDataTypes(args.dataTypes, normalizeStateDataObject(args.data)),
    dataSource: normalizeDataSource(args.dataSource, `${stateDataScopeForId(id)}.fetch`),
    repeat: normalizeRepeatConfig(args.repeat),
    dataWires: normalizeDataWires(args.dataWires),
    subscriptions: normalizeSubscriptions(args.subscriptions),
    boundary: normalizeBoundaryConfig(args.boundary),
    parentId,
    x: snapClampToGrid(Number.isFinite(Number(args.x)) ? Number(args.x) : 120 + model.states.length * NODE_W, WORLD_MIN_X, WORLD_MAX_X - NODE_W),
    y: snapClampToGrid(Number.isFinite(Number(args.y)) ? Number(args.y) : 120 + model.states.length * GRID_SIZE * 4, WORLD_MIN_Y, WORLD_MAX_Y - NODE_H)
  };
  model.states.push(state);
  if (!model.initial) model.initial = state.id;
  return state;
}

function upsertState(model, args) {
  if (Object.prototype.hasOwnProperty.call(args || {}, "renderMode")) {
    throw new Error("renderMode is not part of the contract; visible components belong to their state.");
  }
  if (args?.boundary && ["layerTitle", "comment", "entryTriggerType", "entryTriggerEvent"].some(key => Object.prototype.hasOwnProperty.call(args.boundary, key))) {
    throw new Error("State boundary contains a non-contract field.");
  }
  if ("components" in args) assertNoHiddenComponentStateInComponents(args.components);
  const id = args.id ? String(args.id) : "";
  const existing = id ? byModelId(model, id) : null;
  if (!existing) return createState(model, args);
  assertRuntimeReferenceContract({ ...existing, ...args, id: existing.id }, "state");
  if ("data" in args || "dataTypes" in args) {
    assertStateDataContract(
      "data" in args ? args.data : existing.data,
      "dataTypes" in args ? args.dataTypes : existing.dataTypes,
      existing.id
    );
  }
  if ("title" in args) existing.title = String(args.title || existing.id);
  if ("parentId" in args) {
    const parentId = args.parentId ? String(args.parentId) : null;
    if (parentId && !byModelId(model, parentId)) throw new Error(`Parent state not found: ${parentId}`);
    existing.parentId = parentId && parentId !== existing.id ? parentId : null;
  }
  if ("x" in args) existing.x = snapClampToGrid(Number(args.x), WORLD_MIN_X, WORLD_MAX_X - NODE_W);
  if ("y" in args) existing.y = snapClampToGrid(Number(args.y), WORLD_MIN_Y, WORLD_MAX_Y - NODE_H);
  if ("components" in args) existing.components = normalizeComponents(args.components);
  if ("data" in args) existing.data = normalizeStateDataObject(args.data);
  if ("dataTypes" in args) existing.dataTypes = normalizeDataTypes(args.dataTypes, existing.data);
  if ("dataSource" in args) existing.dataSource = normalizeDataSource(args.dataSource, `${stateDataScopeForId(existing.id)}.fetch`);
  if ("repeat" in args) existing.repeat = normalizeRepeatConfig(args.repeat);
  if ("dataWires" in args) existing.dataWires = normalizeDataWires(args.dataWires);
  if ("subscriptions" in args) existing.subscriptions = normalizeSubscriptions(args.subscriptions);
  if ("boundary" in args) existing.boundary = normalizeBoundaryConfig(args.boundary);
  return existing;
}

function descendantStateIds(model, rootIds) {
  const ids = new Set(rootIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const state of model.states) {
      if (state.parentId && ids.has(state.parentId) && !ids.has(state.id)) {
        ids.add(state.id);
        changed = true;
      }
    }
  }
  return ids;
}

function deleteState(model, args) {
  const id = String(args.id || "");
  if (!id) throw new Error("delete_state requires id.");
  const ids = args.deleteDescendants === false ? new Set([id]) : descendantStateIds(model, [id]);
  if (ids.has(model.initial) && model.states.some(state => !ids.has(state.id))) {
    throw new Error("Set a surviving initial state before deleting the current initial state.");
  }
  model.states = model.states.filter(state => !ids.has(state.id));
  model.transitions = model.transitions.filter(transition =>
    !ids.has(transition.from) &&
    !ids.has(transition.to) &&
    !ids.has(transition.boundaryFlow?.stateId)
  );
  const clearBoundaryReference = (boundary, parentId) => {
    const hasChildren = model.states.some(state => stateParentId(state) === parentId);
    if (ids.has(boundary.entryId)) {
      boundary.entryId = "";
      boundary.entryDisabled = hasChildren;
    }
    if (ids.has(boundary.exitId)) {
      boundary.exitId = "";
      boundary.exitDisabled = hasChildren;
    }
  };
  clearBoundaryReference(model.boundary, null);
  for (const state of model.states) clearBoundaryReference(state.boundary, state.id);
  for (const transition of model.transitions) {
    if (ids.has(transition.groupEntryId)) transition.groupEntryId = "";
    if (ids.has(transition.groupExitId)) transition.groupExitId = "";
  }
  if (!model.states.length) model.initial = "";
  return { deleted: [...ids] };
}

function statesInLayer(model, parentId = null) {
  const layer = parentId || null;
  return model.states.filter(state => stateParentId(state) === layer);
}

function layerExists(model, layerId) {
  return !layerId || Boolean(byModelId(model, layerId));
}

function layerContainerBoundary(model, layerId) {
  return layerId ? findStateOrThrow(model, layerId).boundary : model.boundary;
}

function ensureDefaultBoundaryTransitions(model, parentId = null) {
  const boundary = normalizeBoundaryConfig(layerContainerBoundary(model, parentId));
  const effectiveParentId = parentId || ROOT_LAYER_ID;
  if (boundary.entryId) ensureBoundaryFlowTransition(model, effectiveParentId, "input", boundary.entryId);
  if (boundary.exitId) ensureBoundaryFlowTransition(model, effectiveParentId, "output", boundary.exitId);
}

function selectedStateIdsFromCommand(workspace, command) {
  const explicit = Array.isArray(command.stateIds) ? command.stateIds : [];
  if (explicit.length) return explicit.map(String).filter(Boolean);
  return normalizeEditorSelection(workspace.editor?.selected, workspace.model).nodes;
}

function selectedEdgeIdsFromCommand(workspace, command) {
  const explicit = Array.isArray(command.transitionIds) ? command.transitionIds : [];
  if (explicit.length) return explicit.map(String).filter(Boolean);
  return normalizeEditorSelection(workspace.editor?.selected, workspace.model).edges;
}

function transitionById(model, id) {
  return model.transitions.find(transition => transition.id === id) || null;
}

function collapseEntryStateForModel(model, stateIds) {
  const selectedSet = new Set(stateIds);
  const states = stateIds.map(id => byModelId(model, id)).filter(Boolean);
  const selectedTransitions = model.transitions.filter(transition =>
    selectedSet.has(transition.from) &&
    selectedSet.has(transition.to) &&
    !transition.boundaryFlow
  );
  const incoming = new Set(selectedTransitions.map(transition => transition.to));
  const candidates = states.filter(state => !incoming.has(state.id));
  return candidates.length === 1 ? candidates[0] : null;
}

function collapseExitStateForModel(model, stateIds) {
  const selectedSet = new Set(stateIds);
  const states = stateIds.map(id => byModelId(model, id)).filter(Boolean);
  const selectedTransitions = model.transitions.filter(transition =>
    selectedSet.has(transition.from) &&
    selectedSet.has(transition.to) &&
    !transition.boundaryFlow
  );
  const outgoing = new Set(selectedTransitions.map(transition => transition.from));
  const candidates = states.filter(state => !outgoing.has(state.id));
  return candidates.length === 1 ? candidates[0] : null;
}

function stateBounds(states) {
  const minX = Math.min(...states.map(state => Number(state.x) || 0));
  const minY = Math.min(...states.map(state => Number(state.y) || 0));
  const maxX = Math.max(...states.map(state => (Number(state.x) || 0) + NODE_W));
  const maxY = Math.max(...states.map(state => (Number(state.y) || 0) + NODE_H));
  return { minX, minY, maxX, maxY };
}

function replaceNestedBoundaryReferences(model, oldChildIds, newDirectChildId, parentId) {
  const ids = oldChildIds instanceof Set ? oldChildIds : new Set(oldChildIds || []);
  if (!ids.size || !newDirectChildId) return;
  for (const transition of model.transitions) {
    if (transition.to === parentId && ids.has(transition.groupEntryId)) transition.groupEntryId = newDirectChildId;
    if (transition.from === parentId && ids.has(transition.groupExitId)) transition.groupExitId = newDirectChildId;
  }
}

function collapseStatesToParent(model, args = {}) {
  const requestedIds = Array.isArray(args.stateIds) ? args.stateIds.map(String).filter(Boolean) : [];
  const selected = [...new Set(requestedIds)];
  if (!selected.length) throw new Error("graph.collapse_to_parent requires stateIds.");
  const states = selected.map(id => byModelId(model, id)).filter(Boolean);
  if (states.length !== selected.length) throw new Error("Cannot collapse missing states.");
  const layerId = stateParentId(states[0]);
  if (states.some(state => stateParentId(state) !== layerId)) throw new Error("Collapsed states must be in one layer.");
  const selectedSet = new Set(selected);
  const entry = args.entryId ? byModelId(model, args.entryId) : collapseEntryStateForModel(model, selected);
  const exit = args.exitId ? byModelId(model, args.exitId) : collapseExitStateForModel(model, selected);
  if (!entry || !exit || !selectedSet.has(entry.id) || !selectedSet.has(exit.id)) throw new Error("Collapsed group needs entry and exit states inside the selection.");
  const bounds = stateBounds(states);
  const usedIds = new Set([
    ...model.states.map(state => state.id),
    ...model.transitions.map(transition => transition.id)
  ]);
  const groupId = uniqueId(usedIds, args.id || args.title || "group", "group");
  const group = createState(model, {
    id: groupId,
    title: String(args.title || "Group"),
    parentId: layerId,
    x: snapToGrid((bounds.minX + bounds.maxX) / 2 - NODE_W / 2),
    y: snapToGrid((bounds.minY + bounds.maxY) / 2 - NODE_H / 2),
    boundary: {
      entryId: entry.id,
      exitId: exit.id,
      entryDisabled: false,
      exitDisabled: false
    }
  });

  for (const transition of model.transitions) {
    if (transition.boundaryFlow) continue;
    const originalFrom = transition.from;
    const originalTo = transition.to;
    const fromSelected = selectedSet.has(originalFrom);
    const toSelected = selectedSet.has(originalTo);
    if (!fromSelected && toSelected) {
      transition.to = group.id;
      transition.groupEntryId = selectedSet.has(transition.groupEntryId) ? transition.groupEntryId : originalTo;
    }
    if (fromSelected && !toSelected) {
      transition.from = group.id;
      transition.groupExitId = selectedSet.has(transition.groupExitId) ? transition.groupExitId : originalFrom;
    }
  }
  for (const transition of model.transitions) {
    if (transition.boundaryFlow) continue;
    if (transition.to === group.id && !selectedSet.has(transition.groupEntryId)) transition.groupEntryId = entry.id;
    if (transition.from === group.id && !selectedSet.has(transition.groupExitId)) transition.groupExitId = exit.id;
  }
  for (const state of states) state.parentId = group.id;
  replaceNestedBoundaryReferences(model, selectedSet, group.id, layerId);
  const outerBoundary = normalizeBoundaryConfig(layerContainerBoundary(model, layerId));
  if (outerBoundary.entryId && selectedSet.has(outerBoundary.entryId)) setBoundaryEndpoint(model, layerId || ROOT_LAYER_ID, "input", group.id);
  if (outerBoundary.exitId && selectedSet.has(outerBoundary.exitId)) setBoundaryEndpoint(model, layerId || ROOT_LAYER_ID, "output", group.id);
  if (selectedSet.has(model.initial)) model.initial = group.id;
  ensureDefaultBoundaryTransitions(model, layerId);
  ensureDefaultBoundaryTransitions(model, group.id);
  normalizeModel(model);
  return byModelId(model, group.id);
}

function childBoundaryState(model, parent, side) {
  const children = statesInLayer(model, parent.id);
  const boundary = normalizeBoundaryConfig(parent.boundary);
  const configuredId = side === "input" ? boundary.entryId : boundary.exitId;
  return children.find(state => state.id === configuredId) || null;
}

function removeBoundaryFlowsForParent(model, parentId) {
  const proxyPrefix = `proxy:${parentId}:`;
  model.transitions = model.transitions.filter(transition =>
    transition.boundaryFlow?.parentId !== parentId &&
    !String(transition.from || "").startsWith(proxyPrefix) &&
    !String(transition.to || "").startsWith(proxyPrefix)
  );
}

function degroupParentState(model, args = {}) {
  const parent = findStateOrThrow(model, args.parentId);
  const children = statesInLayer(model, parent.id);
  if (!children.length) throw new Error("graph.degroup_parent requires a parent with children.");
  const childIds = new Set(children.map(child => child.id));
  const outerParentId = stateParentId(parent);
  const outerBoundary = normalizeBoundaryConfig(layerContainerBoundary(model, outerParentId));
  const entry = childBoundaryState(model, parent, "input");
  const exit = childBoundaryState(model, parent, "output");
  if (!entry || !exit) throw new Error("Cannot degroup without entry and exit children.");

  for (const transition of model.transitions) {
    if (transition.boundaryFlow) continue;
    if (transition.to === parent.id) {
      transition.to = childIds.has(transition.groupEntryId) ? transition.groupEntryId : entry.id;
      transition.groupEntryId = "";
    }
    if (transition.from === parent.id) {
      transition.from = childIds.has(transition.groupExitId) ? transition.groupExitId : exit.id;
      transition.groupExitId = "";
    }
    if (transition.to === outerParentId && transition.groupEntryId === parent.id) transition.groupEntryId = entry.id;
    if (transition.from === outerParentId && transition.groupExitId === parent.id) transition.groupExitId = exit.id;
  }

  for (const child of children) child.parentId = outerParentId || null;
  if (outerBoundary.entryId === parent.id) setBoundaryEndpoint(model, outerParentId || ROOT_LAYER_ID, "input", entry.id);
  if (outerBoundary.exitId === parent.id) setBoundaryEndpoint(model, outerParentId || ROOT_LAYER_ID, "output", exit.id);
  if (model.initial === parent.id) model.initial = entry.id;
  removeBoundaryFlowsForParent(model, parent.id);
  model.states = model.states.filter(state => state.id !== parent.id);
  model.transitions = model.transitions.filter(transition => transition.from !== parent.id && transition.to !== parent.id);
  ensureDefaultBoundaryTransitions(model, outerParentId);
  normalizeModel(model);
  return { parentId: parent.id, childIds: [...childIds] };
}

function upsertTransition(model, args) {
  const from = String(args.from || "");
  const to = String(args.to || "");
  if (!from || !to) throw new Error("upsert_transition requires from and to.");
  if (!byModelId(model, from) || !byModelId(model, to)) throw new Error("Transition endpoints must be existing states.");
  if (endpointParentId(model, from) !== endpointParentId(model, to)) throw new Error("Transition endpoints must be in the same layer.");
  const existing = args.id ? model.transitions.find(transition => transition.id === args.id) : model.transitions.find(transition => transition.from === from && transition.to === to && !transition.boundaryFlow);
  const usedIds = new Set([
    ...model.states.map(state => state.id),
    ...model.transitions.map(transition => transition.id)
  ]);
  const target = { ...(existing || { id: uniqueRawId(usedIds, args.id || uniqueId([], args.label, "t"), "t") }) };
  target.from = from;
  target.to = to;
  target.label = String(args.label || target.label || defaultTransitionLabel());
  target.condition = validateTransitionCondition(args.condition || "");
  target.set = normalizeTransitionPatch(args.set);
  const triggerType = transitionTriggerContractType(args);
  if (!TRANSITION_TRIGGER_CONTRACT_TYPES.has(triggerType) || triggerType === "flow") {
    throw new Error("upsert_transition triggerType must be one of button, change, event, realtime, api, timer, auto.");
  }
  target.triggerType = triggerType;
  target.triggerEvent = normalizeTransitionEventName(args.triggerEvent || (target.triggerType === "change" ? "" : defaultTransitionEvent(target)));
  const triggerMatch = normalizeTriggerMatch(args.triggerMatch);
  if (!triggerMatchIsEmpty(triggerMatch)) target.triggerMatch = triggerMatch;
  else delete target.triggerMatch;
  target.timerMs = normalizeTransitionTimerMs(args.timerMs);
  target.groupEntryId = String(args.groupEntryId || "");
  target.groupExitId = String(args.groupExitId || "");
  assertRuntimeReferenceContract(target, "transition");
  if (existing) Object.assign(existing, target);
  else model.transitions.push(target);
  return existing || target;
}

function applyAction(model, action) {
  if (!isPlainObject(action)) throw new Error("Each action must be an object.");
  const type = String(action.type || "");
  switch (type) {
    case "create_flow":
      return { type, model: Object.assign(model, blankModel(action.name || "State App")) };
    case "set_model_name":
      model.name = String(action.name || "State App");
      return { type, name: model.name };
    case "replace_model": {
      assertNoHiddenComponentStateInModel(action.model);
      const validation = validateModel(action.model);
      if (!validation.ok) {
        const error = new Error(validation.issues.map(issue => issue.message).join("; ") || "Model contract validation failed.");
        error.validation = validation;
        throw error;
      }
      const next = normalizeModel(action.model);
      Object.keys(model).forEach(key => delete model[key]);
      Object.assign(model, next);
      return { type, summary: modelSummary(model) };
    }
    case "upsert_state":
      return { type, state: upsertState(model, action) };
    case "delete_state":
      return { type, ...deleteState(model, action) };
    case "move_state": {
      const state = findStateOrThrow(model, action.stateId);
      state.x = snapClampToGrid(Number(action.x), WORLD_MIN_X, WORLD_MAX_X - NODE_W);
      state.y = snapClampToGrid(Number(action.y), WORLD_MIN_Y, WORLD_MAX_Y - NODE_H);
      return { type, state };
    }
    case "set_initial":
      findStateOrThrow(model, action.stateId);
      model.initial = String(action.stateId);
      return { type, initial: model.initial };
    case "upsert_transition":
      return { type, transition: upsertTransition(model, action) };
    case "delete_transition": {
      const id = String(action.transitionId || "");
      if (!id) throw new Error("delete_transition requires transitionId.");
      model.transitions = model.transitions.filter(transition => transition.id !== id);
      for (const state of model.states) {
        state.components = normalizeComponents(state.components).filter(component => component.type !== "transitionButton" || component.transitionId !== id);
      }
      return { type, deleted: id };
    }
    case "upsert_state_variable": {
      const state = findStateOrThrow(model, action.stateId);
      const localPath = stateVariableLocalPath(action.path);
      const path = stateVariableActualPath(state, localPath);
      if (!localPath || !path) throw new Error("upsert_state_variable requires a local path.");
      const typeName = normalizeStateVariableType(action.valueType || inferStateVariableType(localPath, action.value));
      const value = Object.prototype.hasOwnProperty.call(action, "value") ? action.value : defaultStateVariableValue(typeName);
      state.data = setDataObjectPath(normalizeStateDataObject(state.data), localPath, value);
      state.dataTypes = { ...normalizeDataTypes(state.dataTypes, state.data), [localPath]: typeName };
      return { type, stateId: state.id, path, valueType: typeName };
    }
    case "delete_state_variable": {
      const state = findStateOrThrow(model, action.stateId);
      const localPath = stateVariableLocalPath(action.path);
      const path = stateVariableActualPath(state, localPath);
      if (!localPath || !path) throw new Error("delete_state_variable requires a local path.");
      state.data = deleteDataObjectPath(state.data, localPath);
      state.dataTypes = Object.fromEntries(Object.entries(normalizeDataTypes(state.dataTypes, state.data)).filter(([key]) => key !== localPath && !key.startsWith(localPath + ".")));
      state.dataWires = normalizeDataWires(state.dataWires).filter(wire => wire.sourcePath !== path && !wire.sourcePath.startsWith(path + "."));
      return { type, stateId: state.id, path };
    }
    case "configure_fetch": {
      const state = findStateOrThrow(model, action.stateId);
      const requestedTarget = Object.prototype.hasOwnProperty.call(action, "target")
        ? normalizeContextPath(action.target, "")
        : "";
      if (requestedTarget && !runtimeBusPathIsWritable(requestedTarget)) {
        throw new Error("Fetch target must use states.<id>.<field>.");
      }
      state.dataSource = normalizeDataSource({
        ...action,
        target: requestedTarget || `${stateDataScopeForId(state.id)}.fetch`
      }, `${stateDataScopeForId(state.id)}.fetch`);
      return { type, stateId: state.id, dataSource: state.dataSource };
    }
    case "configure_repeat": {
      const state = findStateOrThrow(model, action.stateId);
      if (action.path && !runtimeBusPathIsReadable(action.path)) {
        throw new Error("Repeat path must use a fully qualified runtime bus path.");
      }
      state.repeat = normalizeRepeatConfig(action);
      return { type, stateId: state.id, repeat: state.repeat };
    }
    case "upsert_data_wire": {
      const state = findStateOrThrow(model, action.stateId);
      const scopedAction = {
        ...action,
        sourcePath: runtimeActionPath(action.sourcePath),
        scopePath: action.scopePath ? runtimeActionPath(action.scopePath) : ""
      };
      const wire = normalizeDataWire(scopedAction);
      if (!wire) throw new Error("upsert_data_wire requires sourcePath.");
      const wires = normalizeDataWires(state.dataWires);
      const index = wires.findIndex(item => item.id === wire.id || (item.sourcePath === wire.sourcePath && item.scopePath === wire.scopePath && item.itemPath === wire.itemPath));
      if (index >= 0) wires[index] = { ...wires[index], ...wire, id: wires[index].id };
      else wires.push(wire);
      state.dataWires = normalizeDataWires(wires);
      if (wire.scopePath) state.repeat = normalizeRepeatConfig({ path: wire.scopePath, as: "item", index: "i", manual: true });
      return { type, stateId: state.id, wire };
    }
    case "remove_data_wire": {
      const state = findStateOrThrow(model, action.stateId);
      const id = String(action.wireId || "");
      const sourcePath = normalizeBindingPath(action.sourcePath || "", "");
      if (!id && !sourcePath) throw new Error("remove_data_wire requires wireId or sourcePath.");
      if (sourcePath && !runtimeBusPathIsReadable(sourcePath)) {
        throw new Error("Data-wire sourcePath must use a fully qualified runtime bus path.");
      }
      state.dataWires = normalizeDataWires(state.dataWires).filter(wire => wire.id !== id && (!sourcePath || wire.sourcePath !== sourcePath));
      state.components = normalizeComponents(state.components).filter(component => component.type !== "dataWire" || component.wireId !== id);
      return { type, stateId: state.id, id, sourcePath };
    }
    case "add_component": {
      const state = findStateOrThrow(model, action.stateId);
      const rawComponent = action.component;
      if (!isPlainObject(rawComponent)) throw new Error("add_component requires component.");
      assertNoHiddenComponentState(rawComponent);
      assertRuntimeReferenceContract({ id: state.id, components: [rawComponent] }, "state");
      const [component] = normalizeComponents([rawComponent]);
      if (!component) throw new Error("add_component requires a valid component.");
      const components = normalizeComponents(state.components);
      const index = Number.isInteger(action.index) ? clamp(action.index, 0, components.length) : components.length;
      components.splice(index, 0, component);
      state.components = normalizeComponents(components);
      return { type, stateId: state.id, component };
    }
    case "update_component": {
      const state = findStateOrThrow(model, action.stateId);
      const componentId = String(action.componentId || "");
      if (!componentId) throw new Error("update_component requires componentId.");
      if (!isPlainObject(action.patch)) throw new Error("update_component requires patch.");
      const patch = action.patch;
      assertNoHiddenComponentState(patch);
      const currentComponent = normalizeComponents(state.components).find(component => component.id === componentId);
      if (!currentComponent) throw new Error(`Component not found: ${componentId}`);
      assertRuntimeReferenceContract({ id: state.id, components: [{ ...currentComponent, ...patch }] }, "state");
      let updated = null;
      state.components = normalizeComponents(state.components).map(component => {
        if (component.id !== componentId) return component;
        [updated] = normalizeComponents([{ ...component, ...patch }]);
        return updated || component;
      });
      return { type, stateId: state.id, component: updated };
    }
    case "remove_component": {
      const state = findStateOrThrow(model, action.stateId);
      const componentId = String(action.componentId || "");
      if (!componentId) throw new Error("remove_component requires componentId.");
      state.components = normalizeComponents(state.components).filter(component => component.id !== componentId);
      return { type, stateId: state.id, componentId };
    }
    case "reorder_components": {
      const state = findStateOrThrow(model, action.stateId);
      const order = Array.isArray(action.componentIds) ? action.componentIds.map(String) : [];
      const byId = new Map(normalizeComponents(state.components).map(component => [component.id, component]));
      state.components = [...order.map(id => byId.get(id)).filter(Boolean), ...[...byId.values()].filter(component => !order.includes(component.id))];
      return { type, stateId: state.id, componentIds: state.components.map(component => component.id) };
    }
    case "set_boundary": {
      const parentId = action.parentId ? String(action.parentId) : ROOT_LAYER_ID;
      const boundaryTarget = parentId === ROOT_LAYER_ID ? model.boundary : findStateOrThrow(model, parentId).boundary;
      Object.assign(boundaryTarget, normalizeBoundaryConfig({ ...boundaryTarget, ...action }));
      if ("entryId" in action) setBoundaryEndpoint(model, parentId, "input", String(action.entryId || ""));
      if ("exitId" in action) setBoundaryEndpoint(model, parentId, "output", String(action.exitId || ""));
      if (boundaryTarget.entryId) ensureBoundaryFlowTransition(model, parentId, "input", boundaryTarget.entryId);
      if (boundaryTarget.exitId) ensureBoundaryFlowTransition(model, parentId, "output", boundaryTarget.exitId);
      return { type, parentId, boundary: normalizeBoundaryConfig(boundaryTarget) };
    }
    default:
      throw new Error(`Unknown state-blueprint action: ${type}`);
  }
}

function actionApplyPriority(action) {
  const type = String(action?.type || "");
  if (type === "create_flow" || type === "replace_model" || type === "set_model_name") return 0;
  if (type === "upsert_state") return 10;
  if (type === "set_initial") return 20;
  if (type === "upsert_state_variable" || type === "configure_fetch" || type === "configure_repeat" || type === "upsert_data_wire" || type === "add_component") return 30;
  if (type === "set_boundary") return 40;
  if (type === "upsert_transition") return 50;
  return 60;
}

function orderedActions(actions) {
  return (Array.isArray(actions) ? actions : [])
    .map((action, index) => ({ action, index, priority: actionApplyPriority(action) }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(item => item.action);
}

function applyActions(inputModel, actions, options = {}) {
  if (!Array.isArray(actions)) throw new Error("actions must be an array.");
  const input = isPlainObject(inputModel) && !Object.keys(inputModel).length ? blankModel() : inputModel || blankModel();
  const inputValidation = validateModel(input);
  if (!inputValidation.ok) {
    const error = new Error(inputValidation.issues.map(issue => issue.message).join("; ") || "Model contract validation failed.");
    error.validation = inputValidation;
    throw error;
  }
  const model = inputValidation.model;
  const results = [];
  for (const action of orderedActions(actions)) {
    results.push(applyAction(model, action));
    normalizeModel(model);
  }
  const validation = validateModel(model);
  if (!validation.ok && !options.allowInvalid) {
    const message = validation.issues.map(issue => issue.message).join("; ") || "Model contract validation failed.";
    const error = new Error(message);
    error.validation = validation;
    throw error;
  }
  return { model: validation.model, results, validation };
}

function normalizeCamera(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    x: Number.isFinite(Number(source.x)) ? Math.round(Number(source.x)) : 32,
    y: Number.isFinite(Number(source.y)) ? Math.round(Number(source.y)) : 32,
    scale: clamp(Number.isFinite(Number(source.scale)) ? Number(source.scale) : 1, 0.25, 2.4)
  };
}

function normalizeEditorSelection(value, model) {
  const source = isPlainObject(value) ? value : {};
  const stateIds = new Set((model?.states || []).map(state => state.id));
  const transitionIds = new Set((model?.transitions || []).map(transition => transition.id));
  const nodeInput = Array.isArray(source.nodes) ? source.nodes : source.type === "node" ? [source.id] : Array.isArray(source.ids) ? source.ids : [];
  const edgeInput = Array.isArray(source.edges) ? source.edges : source.type === "edge" ? [source.id] : [];
  const nodes = [...new Set(nodeInput.map(String).filter(id => stateIds.has(id)))];
  const edges = [...new Set(edgeInput.map(String).filter(id => transitionIds.has(id)))];
  return { nodes, edges, allCurrentLayer: source.allCurrentLayer === true };
}

function normalizeEditorSession(value, model) {
  const source = isPlainObject(value) ? value : {};
  const currentLayerId = typeof source.currentLayerId === "string" && layerExists(model, source.currentLayerId)
    ? source.currentLayerId
    : null;
  const panels = isPlainObject(source.panels) ? clone(source.panels) : {};
  return {
    selected: normalizeEditorSelection(source.selected, model),
    currentLayerId,
    camera: normalizeCamera(source.camera),
    previewCollapsed: Boolean(source.previewCollapsed),
    panels
  };
}

function normalizeCommandHistory(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    undo: Array.isArray(source.undo) ? source.undo.filter(isPlainObject).slice(-100) : [],
    redo: Array.isArray(source.redo) ? source.redo.filter(isPlainObject).slice(-100) : [],
    current: isPlainObject(source.current) ? clone(source.current) : null
  };
}

function normalizeWorkspace(value = {}) {
  const source = isPlainObject(value) ? value : {};
  if (Array.isArray(source.stateTemplates) && source.stateTemplates.length) {
    throw new Error("stateTemplates are contract-managed and must not be stored in a workspace.");
  }
  const candidate = source.model || (source.version === 2 ? source : blankModel());
  const validation = validateModel(candidate);
  if (!validation.ok) {
    const error = new Error(validation.issues.map(issue => issue.message).join("; ") || "Model contract validation failed.");
    error.validation = validation;
    throw error;
  }
  const model = validation.model;
  const workspace = {
    model,
    editor: normalizeEditorSession(source.editor, model),
    clipboard: isPlainObject(source.clipboard) ? clone(source.clipboard) : null,
    history: normalizeCommandHistory(source.history)
  };
  workspace.history.current = workspace.history.current || commandSnapshot(workspace);
  return workspace;
}

function commandSnapshot(workspace) {
  return {
    model: normalizeModel(workspace.model),
    editor: normalizeEditorSession(workspace.editor, workspace.model),
    clipboard: isPlainObject(workspace.clipboard) ? clone(workspace.clipboard) : null
  };
}

function restoreCommandSnapshot(workspace, snapshot) {
  const restored = normalizeWorkspace(snapshot);
  workspace.model = restored.model;
  workspace.editor = restored.editor;
  workspace.clipboard = restored.clipboard;
  workspace.history.current = commandSnapshot(workspace);
}

function pushCommandHistory(workspace) {
  workspace.history = normalizeCommandHistory(workspace.history);
  const current = commandSnapshot(workspace);
  if (JSON.stringify(workspace.history.current) !== JSON.stringify(current)) {
    workspace.history.current = current;
  }
  workspace.history.undo.push(clone(workspace.history.current));
  if (workspace.history.undo.length > 100) workspace.history.undo.shift();
  workspace.history.redo = [];
}

function commitCommandHistory(workspace) {
  workspace.model = normalizeModel(workspace.model);
  workspace.editor = normalizeEditorSession(workspace.editor, workspace.model);
  workspace.history.current = commandSnapshot(workspace);
}

function commandIsHistoryNeutral(commandName) {
  return [
    "selection.set",
    "selection.clear",
    "selection.all",
    "layer.open",
    "layer.back",
    "layer.root",
    "viewport.set_camera",
    "viewport.reset",
    "viewport.fit",
    "preview.set_collapsed",
    "ui.set_panel",
    "graph.copy_selection"
  ].includes(commandName);
}

function selectionForCurrentLayer(model, layerId) {
  const layer = layerId || null;
  return {
    nodes: statesInLayer(model, layer).map(state => state.id),
    edges: model.transitions
      .filter(transition => endpointParentId(model, transition.from) === layer && endpointParentId(model, transition.to) === layer)
      .map(transition => transition.id),
    allCurrentLayer: true
  };
}

function fitCameraForModel(model, command = {}) {
  const layerId = command.layerId !== undefined ? String(command.layerId || "") || null : null;
  const states = statesInLayer(model, layerId);
  if (!states.length) return normalizeCamera({ x: 32, y: 32, scale: 1 });
  const bounds = stateBounds(states);
  const width = Math.max(320, Number(command.viewportWidth) || 1200);
  const height = Math.max(240, Number(command.viewportHeight) || 800);
  const margin = Math.max(48, Number(command.margin) || 120);
  const contentW = Math.max(1, bounds.maxX - bounds.minX);
  const contentH = Math.max(1, bounds.maxY - bounds.minY);
  const scale = clamp(Math.min((width - margin * 2) / contentW, (height - margin * 2) / contentH), 0.25, 2.4);
  return normalizeCamera({
    scale,
    x: width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
    y: height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale
  });
}

function selectionPayload(model, selection) {
  const normalized = normalizeEditorSelection(selection, model);
  const stateIds = new Set(normalized.nodes);
  const transitionIds = new Set(normalized.edges);
  const states = model.states.filter(state => stateIds.has(state.id));
  const transitions = model.transitions.filter(transition =>
    transitionIds.has(transition.id) ||
    stateIds.has(transition.from) && stateIds.has(transition.to)
  );
  return { states: clone(states), transitions: clone(transitions) };
}

function duplicateSelectionPayload(model, payload, args = {}) {
  const sourceStates = Array.isArray(payload?.states) ? payload.states : [];
  if (!sourceStates.length) return { states: [], transitions: [] };
  const usedStateIds = new Set(model.states.map(state => state.id));
  const usedTransitionIds = new Set([
    ...model.states.map(state => state.id),
    ...model.transitions.map(transition => transition.id)
  ]);
  const idMap = new Map();
  const dx = Number.isFinite(Number(args.dx)) ? Number(args.dx) : GRID_SIZE * 2;
  const dy = Number.isFinite(Number(args.dy)) ? Number(args.dy) : GRID_SIZE * 2;
  const copiedStates = sourceStates.map(state => {
    const id = uniqueId(usedStateIds, args.idPrefix ? `${args.idPrefix}_${state.id}` : state.id, "state");
    idMap.set(state.id, id);
    return {
      ...clone(state),
      id,
      title: String(state.title || state.id),
      parentId: state.parentId && idMap.has(state.parentId) ? idMap.get(state.parentId) : state.parentId || null,
      x: snapClampToGrid((Number(state.x) || 0) + dx, WORLD_MIN_X, WORLD_MAX_X - NODE_W),
      y: snapClampToGrid((Number(state.y) || 0) + dy, WORLD_MIN_Y, WORLD_MAX_Y - NODE_H)
    };
  });
  const copiedTransitions = (Array.isArray(payload?.transitions) ? payload.transitions : [])
    .filter(transition => idMap.has(transition.from) && idMap.has(transition.to))
    .map(transition => ({
      ...clone(transition),
      id: uniqueRawId(usedTransitionIds, args.idPrefix ? `${args.idPrefix}_${transition.id}` : transition.id, "t"),
      from: idMap.get(transition.from),
      to: idMap.get(transition.to),
      groupEntryId: idMap.get(transition.groupEntryId) || "",
      groupExitId: idMap.get(transition.groupExitId) || "",
      boundaryFlow: undefined
    }))
    .map(transition => {
      delete transition.boundaryFlow;
      return transition;
    });
  model.states.push(...copiedStates);
  model.transitions.push(...copiedTransitions);
  return { states: copiedStates, transitions: copiedTransitions };
}

function insertStateOnTransition(model, command) {
  const transition = transitionById(model, command.transitionId);
  if (!transition || transition.boundaryFlow || isBoundaryProxyId(transition.from) || isBoundaryProxyId(transition.to)) {
    throw new Error("graph.insert_state_on_transition requires a normal transition.");
  }
  const from = findStateOrThrow(model, transition.from);
  const to = findStateOrThrow(model, transition.to);
  const state = createState(model, {
    id: command.stateId || command.title,
    title: command.title || "State",
    parentId: stateParentId(from),
    x: Number.isFinite(Number(command.x)) ? Number(command.x) : snapToGrid((from.x + to.x) / 2),
    y: Number.isFinite(Number(command.y)) ? Number(command.y) : snapToGrid((from.y + to.y) / 2),
    components: command.components,
    data: command.data,
    dataTypes: command.dataTypes,
    boundary: command.boundary
  });
  const oldTo = transition.to;
  const oldGroupEntryId = transition.groupEntryId || "";
  transition.to = state.id;
  transition.groupEntryId = "";
  const next = upsertTransition(model, {
    id: command.nextTransitionId,
    from: state.id,
    to: oldTo,
    label: command.nextLabel || defaultTransitionLabel(),
    triggerType: transition.triggerType,
    triggerEvent: command.nextTriggerEvent || "",
    timerMs: transition.timerMs,
    groupEntryId: oldGroupEntryId
  });
  return { state, before: transition, after: next };
}

function applyCommand(workspace, command = {}) {
  if (!isPlainObject(command)) throw new Error("Each command must be an object.");
  const name = String(command.command || "");
  if (!name) throw new Error("Command requires command.");
  switch (name) {
    case "actions.apply": {
      const result = applyActions(workspace.model, command.actions || [], { allowInvalid: Boolean(command.allowInvalid) });
      workspace.model = result.model;
      return { command: name, ...result };
    }
    case "scene.new":
      return { command: name, ...applyAction(workspace.model, { type: "create_flow", name: command.title || "State App" }) };
    case "scene.rename":
      return { command: name, ...applyAction(workspace.model, { type: "set_model_name", name: command.title || "State App" }) };
    case "model.replace":
      return { command: name, ...applyAction(workspace.model, { type: "replace_model", model: command.model }) };
    case "state.upsert":
    case "state.create":
      return { command: name, ...applyAction(workspace.model, { ...command, type: "upsert_state" }) };
    case "state.move":
      return { command: name, ...applyAction(workspace.model, { ...command, type: "move_state" }) };
    case "state.delete":
      return { command: name, ...applyAction(workspace.model, { ...command, type: "delete_state" }) };
    case "state.set_initial":
      return { command: name, ...applyAction(workspace.model, { ...command, type: "set_initial" }) };
    case "transition.create":
    case "transition.update":
    case "transition.rewire":
      return { command: name, ...applyAction(workspace.model, { ...command, type: "upsert_transition" }) };
    case "transition.delete":
      return { command: name, ...applyAction(workspace.model, { ...command, type: "delete_transition" }) };
    case "variable.upsert":
      return { command: name, ...applyAction(workspace.model, { ...command, type: "upsert_state_variable" }) };
    case "variable.delete":
      return { command: name, ...applyAction(workspace.model, { ...command, type: "delete_state_variable" }) };
    case "fetch.configure":
      return { command: name, ...applyAction(workspace.model, { ...command, type: "configure_fetch" }) };
    case "repeat.configure":
      return { command: name, ...applyAction(workspace.model, { ...command, type: "configure_repeat" }) };
    case "wire.upsert":
      return { command: name, ...applyAction(workspace.model, { ...command, type: "upsert_data_wire" }) };
    case "wire.remove":
      return { command: name, ...applyAction(workspace.model, { ...command, type: "remove_data_wire" }) };
    case "component.add":
      return { command: name, ...applyAction(workspace.model, { ...command, type: "add_component" }) };
    case "component.update":
      return { command: name, ...applyAction(workspace.model, { ...command, type: "update_component" }) };
    case "component.remove":
      return { command: name, ...applyAction(workspace.model, { ...command, type: "remove_component" }) };
    case "component.reorder":
      return { command: name, ...applyAction(workspace.model, { ...command, type: "reorder_components" }) };
    case "boundary.set":
      return { command: name, ...applyAction(workspace.model, { ...command, type: "set_boundary" }) };
    case "selection.set":
      if (!Array.isArray(command.stateIds) && !Array.isArray(command.transitionIds)) {
        throw new Error("selection.set requires stateIds or transitionIds.");
      }
      workspace.editor.selected = normalizeEditorSelection({ nodes: command.stateIds || [], edges: command.transitionIds || [] }, workspace.model);
      return { command: name, selected: workspace.editor.selected };
    case "selection.clear":
      workspace.editor.selected = normalizeEditorSelection(null, workspace.model);
      return { command: name, selected: workspace.editor.selected };
    case "selection.all":
      workspace.editor.selected = selectionForCurrentLayer(workspace.model, workspace.editor.currentLayerId);
      return { command: name, selected: workspace.editor.selected };
    case "layer.open": {
      const layerId = command.stateId || "";
      if (!layerId || !byModelId(workspace.model, layerId)) throw new Error("layer.open requires an existing stateId.");
      workspace.editor.currentLayerId = String(layerId);
      workspace.editor.selected = normalizeEditorSelection(null, workspace.model);
      return { command: name, currentLayerId: workspace.editor.currentLayerId };
    }
    case "layer.back": {
      const current = byModelId(workspace.model, workspace.editor.currentLayerId);
      workspace.editor.currentLayerId = current?.parentId || null;
      workspace.editor.selected = normalizeEditorSelection(null, workspace.model);
      return { command: name, currentLayerId: workspace.editor.currentLayerId };
    }
    case "layer.root":
      workspace.editor.currentLayerId = null;
      workspace.editor.selected = normalizeEditorSelection(null, workspace.model);
      return { command: name, currentLayerId: null };
    case "viewport.set_camera":
      if (!isPlainObject(command.camera)) throw new Error("viewport.set_camera requires camera.");
      workspace.editor.camera = normalizeCamera(command.camera);
      return { command: name, camera: workspace.editor.camera };
    case "viewport.reset":
      workspace.editor.camera = normalizeCamera({ x: 32, y: 32, scale: 1 });
      return { command: name, camera: workspace.editor.camera };
    case "viewport.fit":
      workspace.editor.camera = fitCameraForModel(workspace.model, { ...command, layerId: command.layerId ?? workspace.editor.currentLayerId });
      return { command: name, camera: workspace.editor.camera };
    case "preview.set_collapsed":
      if (typeof command.collapsed !== "boolean") throw new Error("preview.set_collapsed requires collapsed.");
      workspace.editor.previewCollapsed = Boolean(command.collapsed);
      return { command: name, previewCollapsed: workspace.editor.previewCollapsed };
    case "ui.set_panel": {
      const panel = String(command.panel || "");
      if (!panel) throw new Error("ui.set_panel requires panel.");
      workspace.editor.panels[panel] = {
        collapsed: Boolean(command.collapsed)
      };
      if (Number.isFinite(Number(command.width))) {
        workspace.editor.panels[panel].width = Number(command.width);
      }
      return { command: name, panels: workspace.editor.panels };
    }
    case "graph.copy_selection":
      workspace.clipboard = selectionPayload(workspace.model, {
        nodes: command.stateIds || selectedStateIdsFromCommand(workspace, command),
        edges: command.transitionIds || selectedEdgeIdsFromCommand(workspace, command)
      });
      return { command: name, clipboard: workspace.clipboard };
    case "graph.paste":
    case "graph.duplicate_selection": {
      const payload = name === "graph.paste" && workspace.clipboard
        ? workspace.clipboard
        : selectionPayload(workspace.model, {
            nodes: selectedStateIdsFromCommand(workspace, command),
            edges: selectedEdgeIdsFromCommand(workspace, command)
          });
      const duplicated = duplicateSelectionPayload(workspace.model, payload, command);
      workspace.editor.selected = normalizeEditorSelection({ nodes: duplicated.states.map(state => state.id), edges: duplicated.transitions.map(transition => transition.id) }, workspace.model);
      return { command: name, duplicated };
    }
    case "graph.delete_selection": {
      const stateIds = selectedStateIdsFromCommand(workspace, command);
      const edgeIds = selectedEdgeIdsFromCommand(workspace, command);
      edgeIds.forEach(transitionId => applyAction(workspace.model, { type: "delete_transition", transitionId }));
      stateIds.forEach(id => applyAction(workspace.model, { type: "delete_state", id }));
      workspace.editor.selected = normalizeEditorSelection(null, workspace.model);
      return { command: name, deleted: { states: stateIds, transitions: edgeIds } };
    }
    case "graph.insert_state_on_transition": {
      const inserted = insertStateOnTransition(workspace.model, command);
      workspace.editor.selected = normalizeEditorSelection({ nodes: [inserted.state.id], edges: [] }, workspace.model);
      return { command: name, inserted };
    }
    case "graph.collapse_to_parent": {
      const group = collapseStatesToParent(workspace.model, { ...command, stateIds: selectedStateIdsFromCommand(workspace, command) });
      workspace.editor.selected = normalizeEditorSelection({ nodes: [group.id], edges: [] }, workspace.model);
      return { command: name, group };
    }
    case "graph.degroup_parent": {
      const result = degroupParentState(workspace.model, command);
      workspace.editor.selected = normalizeEditorSelection({ nodes: result.childIds, edges: [] }, workspace.model);
      return { command: name, ...result };
    }
    case "history.undo": {
      workspace.history = normalizeCommandHistory(workspace.history);
      if (!workspace.history.undo.length) return { command: name, applied: false };
      const current = commandSnapshot(workspace);
      const previous = workspace.history.undo.pop();
      workspace.history.redo.push(current);
      restoreCommandSnapshot(workspace, previous);
      return { command: name, applied: true };
    }
    case "history.redo": {
      workspace.history = normalizeCommandHistory(workspace.history);
      if (!workspace.history.redo.length) return { command: name, applied: false };
      const current = commandSnapshot(workspace);
      const next = workspace.history.redo.pop();
      workspace.history.undo.push(current);
      restoreCommandSnapshot(workspace, next);
      return { command: name, applied: true };
    }
    default:
      throw new Error(`Unknown state-blueprint command: ${name}`);
  }
}

function applyCommands(inputWorkspace, commands, options = {}) {
  if (!Array.isArray(commands)) throw new Error("commands must be an array.");
  const workspace = normalizeWorkspace(inputWorkspace);
  const results = [];
  for (const command of commands) {
    const name = String(command?.command || "");
    const historyCommand = name === "history.undo" || name === "history.redo";
    const historyNeutral = commandIsHistoryNeutral(name) || command.history === false;
    if (!historyCommand && !historyNeutral) pushCommandHistory(workspace);
    const result = applyCommand(workspace, command);
    workspace.model = normalizeModel(workspace.model);
    workspace.editor = normalizeEditorSession(workspace.editor, workspace.model);
    if (!historyCommand) commitCommandHistory(workspace);
    results.push(result);
  }
  const validation = validateModel(workspace.model);
  if (!validation.ok && !options.allowInvalid) {
    const message = validation.issues.map(issue => issue.message).join("; ") || "Workspace command validation failed.";
    const error = new Error(message);
    error.validation = validation;
    throw error;
  }
  workspace.model = validation.model;
  workspace.editor = normalizeEditorSession(workspace.editor, workspace.model);
  return { workspace, results, validation };
}

const commandCatalog = [
  ["actions.apply", "Run existing model actions through the same command pipeline."],
  ["scene.new", "Create a fresh scene."],
  ["scene.rename", "Rename the scene."],
  ["model.replace", "Replace the canonical model."],
  ["state.create", "Create a state."],
  ["state.upsert", "Create or update a state."],
  ["state.move", "Move a state."],
  ["state.delete", "Delete a state."],
  ["state.set_initial", "Set the initial state."],
  ["transition.create", "Create a transition."],
  ["transition.update", "Update a transition."],
  ["transition.rewire", "Rewire a transition by id."],
  ["transition.delete", "Delete a transition."],
  ["variable.upsert", "Add or update a scoped state variable."],
  ["variable.delete", "Remove a scoped state variable."],
  ["fetch.configure", "Configure fetch-on-enter."],
  ["repeat.configure", "Configure repeat/list rendering."],
  ["wire.upsert", "Map a bus path into render."],
  ["wire.remove", "Remove a data wire."],
  ["component.add", "Add a render component or widget."],
  ["component.update", "Update a render component or widget."],
  ["component.remove", "Remove a render component or widget."],
  ["component.reorder", "Reorder render components/widgets/buttons."],
  ["boundary.set", "Set layer boundary entry/exit and proxy wires."],
  ["selection.set", "Select states/transitions in the editor session."],
  ["selection.clear", "Clear editor selection."],
  ["selection.all", "Select all items in the current layer."],
  ["layer.open", "Open a state layer in the editor session."],
  ["layer.back", "Go to the parent layer."],
  ["layer.root", "Open root layer."],
  ["viewport.set_camera", "Set pan/zoom camera."],
  ["viewport.reset", "Reset pan/zoom camera."],
  ["viewport.fit", "Fit the current layer into a viewport."],
  ["preview.set_collapsed", "Collapse or expand preview."],
  ["ui.set_panel", "Set editor panel UI state."],
  ["graph.copy_selection", "Copy selected states and internal transitions."],
  ["graph.paste", "Paste copied graph selection with new ids."],
  ["graph.duplicate_selection", "Duplicate selected graph items."],
  ["graph.delete_selection", "Delete selected states/transitions."],
  ["graph.insert_state_on_transition", "Drop a new state onto an existing transition and splice it into the FSM."],
  ["graph.collapse_to_parent", "Collapse states into a real parent state with child boundary."],
  ["graph.degroup_parent", "Expand a real parent state back into its surrounding layer."],
  ["history.undo", "Undo the last command-level mutation."],
  ["history.redo", "Redo the last undone command-level mutation."]
].map(([name, description]) => ({ name, description }));

function formalModelDefinition(model) {
  const validation = validateModel(model);
  if (!validation.ok) {
    const error = new Error(validation.issues.map(issue => issue.message).join("; ") || "Model contract validation failed.");
    error.validation = validation;
    throw error;
  }
  const normalizedModel = validation.model;
  normalizedModel.transitions = normalizedModel.transitions.filter(transition =>
    !transition.boundaryFlow &&
    !isBoundaryProxyId(transition.from) &&
    !isBoundaryProxyId(transition.to)
  );
  return normalizedModel;
}

function definitionPayload(model, stateTemplates = [], editor = {}) {
  if (Array.isArray(stateTemplates) && stateTemplates.length) {
    throw new Error("stateTemplates are contract-managed and must not be exported in a definition.");
  }
  const normalizedModel = formalModelDefinition(model);
  const session = normalizeEditorSession(editor, normalizedModel);
  return {
    kind: "state-blueprint-definition",
    schemaVersion: 2,
    app: "Zustand",
    savedAt: new Date().toISOString(),
    model: normalizedModel,
    stateTemplates: [],
    camera: session.camera,
    previewCollapsed: session.previewCollapsed
  };
}

module.exports = {
  ROOT_LAYER_ID,
  normalizeId,
  normalizeContextPath,
  normalizeBindingPath,
  normalizeDataObject,
  normalizeDataTypes,
  normalizeStateVariableType,
  inferStateVariableType,
  defaultStateVariableValue,
  normalizeComponents,
  normalizeDataWires,
  normalizeDataSource,
  normalizeRepeatConfig,
  normalizeBoundaryConfig,
  normalizeSubscriptions,
  normalizeTransitionTriggerType,
  normalizeTransitionEvent,
  blankModel,
  normalizeModel,
  normalizeWorkspace,
  validateModel,
  applyActions,
  applyCommands,
  commandCatalog,
  definitionPayload,
  modelSummary,
  setDataObjectPath,
  deleteDataObjectPath,
  dataObjectValueAtPath
};
