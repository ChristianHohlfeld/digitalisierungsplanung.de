"use strict";

const ROOT_LAYER_ID = "__root__";
const GRID_SIZE = 24;
const NODE_W = 168;
const NODE_H = 96;
const EDITOR_GROUP_DISPLAY_W = GRID_SIZE * 10;
const EDITOR_GROUP_DISPLAY_H = GRID_SIZE * 5;
const WORLD_MIN_X = -10000;
const WORLD_MIN_Y = -8000;
const WORLD_MAX_X = 20000;
const WORLD_MAX_Y = 16000;
const STATE_VARIABLE_TYPES = ["text", "email", "password", "number", "boolean", "url", "image", "object", "list"];
const COMPONENT_TYPES = ["heading", "text", "image", "list", "link", "note", "divider", "daisy", "transitionButton", "dataWire"];
const TRANSITION_TRIGGER_TYPES = ["button", "change", "event", "timer", "auto"];
const DATA_WIRE_ROLES = ["image", "title", "price", "description", "field", "link", "note"];
const FORBIDDEN_COMPONENT_STATE_KEYS = ["localState", "stateStore", "store", "html"];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
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
  const raw = normalizeBindingPath(value, "");
  if (!raw) return "";
  const scope = stateDataScopeForId(state?.id);
  if (!scope) return raw;
  if (raw === scope || raw.startsWith(`${scope}.`)) return raw;
  if (raw.startsWith("states.")) return "";
  return `${scope}.${raw}`;
}

function stateScopedActionPath(state, value) {
  const raw = normalizeBindingPath(value, "");
  if (!raw) return "";
  if (/^(states|state|events|runtime)(\.|$)/.test(raw)) return raw;
  return stateVariableActualPath(state, raw) || raw;
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ensureStateVariableScopeRoot(state, data = state?.data) {
  const source = normalizeDataObject(data);
  const scope = stateDataScopeForId(state?.id);
  if (!scope) return source;
  if (!isPlainObject(source[scope])) {
    const existing = dataObjectValueAtPath(source, scope);
    source[scope] = isPlainObject(existing) ? existing : {};
  }
  return source;
}

function normalizeDataObject(value) {
  return isPlainObject(value) ? clone(value) : {};
}

function dataObjectPathSegments(dataObject, path) {
  const key = String(path || "").trim();
  if (!key) return [];
  const parts = key.split(".").filter(Boolean);
  for (let index = parts.length; index >= 1; index -= 1) {
    const prefix = parts.slice(0, index).join(".");
    if (Object.prototype.hasOwnProperty.call(dataObject, prefix)) return [prefix, ...parts.slice(index)];
  }
  return parts;
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

function stateScopedVariablePaths(state) {
  const scope = stateDataScopeForId(state?.id);
  const scopedRoot = dataObjectValueAtPath(state?.data, scope);
  const rows = [];
  const walk = (path, value) => {
    if (!path) return;
    if (isPlainObject(value)) {
      Object.entries(value).forEach(([key, child]) => walk(`${path}.${key}`, child));
      return;
    }
    rows.push(path);
  };
  if (isPlainObject(scopedRoot)) Object.entries(scopedRoot).forEach(([key, value]) => walk(`${scope}.${key}`, value));
  return rows.sort((a, b) => b.length - a.length);
}

function rewriteStateScopedCondition(state, condition) {
  let text = String(condition || "");
  const scope = stateDataScopeForId(state?.id);
  if (!scope) return text;
  for (const fullPath of stateScopedVariablePaths(state)) {
    const shortPath = fullPath.slice(scope.length + 1);
    if (!shortPath || text.includes(fullPath)) continue;
    const pattern = new RegExp(`(^|[^A-Za-z0-9_.$])${escapeRegExp(shortPath)}(?=$|[^A-Za-z0-9_])`, "g");
    text = text.replace(pattern, (_, prefix) => prefix + fullPath);
  }
  return text;
}

function normalizeStateScopedPatch(state, patch) {
  const out = {};
  for (const [key, value] of Object.entries(normalizeDataObject(patch))) {
    const path = stateScopedActionPath(state, key);
    if (path) out[path] = clone(value);
  }
  return out;
}

function normalizeStateScopedTransitionEvent(state, eventName, fallback = "") {
  const event = normalizeTransitionEvent(eventName, fallback);
  if (!event.startsWith("change.")) return event;
  const scopedPath = stateScopedActionPath(state, event.slice("change.".length));
  return scopedPath ? `change.${scopedPath}` : event;
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

function dataPathLabel(path, fallback = "Value") {
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

function normalizeDataSource(value) {
  const source = isPlainObject(value) ? value : {};
  const timeout = Number(source.timeoutMs);
  const retries = Number(source.retries);
  return {
    url: String(source.url || ""),
    target: normalizeContextPath(source.target, "fetch"),
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
    title: String(source.title || source.layerTitle || ""),
    note: String(source.note || source.comment || "")
  };
}

function editorGroupBoundsForStates(states) {
  if (!states.length) {
    return {
      x: 0,
      y: 0,
      width: EDITOR_GROUP_DISPLAY_W,
      height: EDITOR_GROUP_DISPLAY_H
    };
  }
  const minX = Math.min(...states.map(state => Number(state.x) || 0));
  const minY = Math.min(...states.map(state => Number(state.y) || 0));
  const maxX = Math.max(...states.map(state => (Number(state.x) || 0) + NODE_W));
  const maxY = Math.max(...states.map(state => (Number(state.y) || 0) + NODE_H));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return {
    x: snapToGrid(centerX - EDITOR_GROUP_DISPLAY_W / 2),
    y: snapToGrid(centerY - EDITOR_GROUP_DISPLAY_H / 2),
    width: EDITOR_GROUP_DISPLAY_W,
    height: EDITOR_GROUP_DISPLAY_H
  };
}

function normalizeEditorGroups(groups, sourceModel) {
  const states = Array.isArray(sourceModel?.states) ? sourceModel.states : [];
  if (!states.length) return [];
  const stateById = new Map(states.map(state => [state.id, state]));
  const stateIds = new Set(states.map(state => state.id));
  const reservedIds = new Set([
    ...stateIds,
    ...(Array.isArray(sourceModel?.transitions) ? sourceModel.transitions.map(transition => String(transition?.id || "")).filter(Boolean) : [])
  ]);
  const usedGroupIds = new Set();
  const assignedStateIds = new Set();
  const normalized = [];
  for (const rawGroup of Array.isArray(groups) ? groups : []) {
    if (!isPlainObject(rawGroup)) continue;
    const rawIds = Array.isArray(rawGroup.stateIds) ? rawGroup.stateIds.map(id => String(id || "")) : [];
    const firstState = rawIds.map(id => stateById.get(id)).find(Boolean);
    const rawLayerId = typeof rawGroup.layerId === "string" && stateIds.has(rawGroup.layerId)
      ? rawGroup.layerId
      : "";
    const layerId = rawLayerId || (firstState ? stateParentId(firstState) || "" : "");
    const memberIds = [...new Set(rawIds)]
      .filter(id => stateIds.has(id) && !assignedStateIds.has(id))
      .filter(id => (stateParentId(stateById.get(id)) || "") === layerId);
    if (!memberIds.length) continue;
    let id = normalizeId(rawGroup.id || rawGroup.title || "group");
    const base = id || "group";
    id = base;
    let suffix = 2;
    while (usedGroupIds.has(id) || reservedIds.has(id)) id = `${base}_${suffix++}`;
    usedGroupIds.add(id);
    memberIds.forEach(memberId => assignedStateIds.add(memberId));
    const bounds = editorGroupBoundsForStates(memberIds.map(memberId => stateById.get(memberId)).filter(Boolean));
    normalized.push({
      id,
      title: String(rawGroup.title || "Group").trim() || "Group",
      layerId,
      stateIds: memberIds,
      collapsed: true,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    });
  }
  return normalized;
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

function normalizeStateRenderMode(value) {
  return String(value || "").trim() === "component" ? "component" : "state";
}

function normalizeTransitionTriggerType(transition) {
  const value = String(transition?.triggerType || "button").toLowerCase();
  return TRANSITION_TRIGGER_TYPES.includes(value) ? value : "button";
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

function defaultTransitionLabel(transition, model) {
  const target = byModelId(model, transition?.to);
  return target?.title ? `To ${target.title}` : "Next";
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

function transitionIdentityKey(transition) {
  if (transition?.boundaryFlow) {
    return `boundary:${transition.boundaryFlow.parentId || ""}:${transition.boundaryFlow.side || ""}`;
  }
  if (isBoundaryProxyId(transition?.from) || isBoundaryProxyId(transition?.to)) {
    return `proxy:${transition?.from || ""}->${transition?.to || ""}`;
  }
  return `normal:${transition?.from || ""}->${transition?.to || ""}`;
}

function normalizeModel(input) {
  const m = isPlainObject(input) ? clone(input) : {};
  m.version = 2;
  m.name = String(m.name || "State App");
  m.boundary = normalizeBoundaryConfig(m.boundary);
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
    state.id = uniqueId(usedStateIds, state.id || state.title, "state");
    state.title = String(state.title || state.id);
    state.renderMode = normalizeStateRenderMode(state.renderMode);
    state.components = normalizeComponents(state.components);
    delete state.body;
    state.data = normalizeDataObject(state.data);
    state.dataTypes = normalizeDataTypes(state.dataTypes, state.data);
    state.dataSource = normalizeDataSource(state.dataSource);
    state.repeat = normalizeRepeatConfig(state.repeat);
    state.dataWires = normalizeDataWires(state.dataWires);
    const wireIds = new Set(state.dataWires.map(wire => wire.id));
    state.components = normalizeComponents(state.components)
      .filter(component => component.type !== "dataWire" || wireIds.has(component.wireId));
    state.subscriptions = normalizeSubscriptions(state.subscriptions);
    state.boundary = normalizeBoundaryConfig(state.boundary);
    state.x = snapClampToGrid(Number.isFinite(Number(state.x)) ? Number(state.x) : 100, WORLD_MIN_X, WORLD_MAX_X - 168);
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
  const pairs = new Set();
  const usedTransitionIds = new Set();
  m.transitions = m.transitions
    .filter(transition => isPlainObject(transition))
    .filter(transition => {
      if (!isKnownEndpoint(transition.from) || !isKnownEndpoint(transition.to)) return false;
      if (endpointParentId(m, transition.from) !== endpointParentId(m, transition.to)) return false;
      if (transition.groupEntryId && (!ids.has(transition.groupEntryId) || stateParentId(byModelId(m, transition.groupEntryId)) !== transition.to)) transition.groupEntryId = "";
      if (transition.groupExitId && (!ids.has(transition.groupExitId) || stateParentId(byModelId(m, transition.groupExitId)) !== transition.from)) transition.groupExitId = "";
      const pair = transitionIdentityKey(transition);
      if (pairs.has(pair)) return false;
      pairs.add(pair);
      return true;
    })
    .map(transition => {
      const id = uniqueRawId(usedTransitionIds, transition.id || uniqueId([], transition.label, "t"), "t");
      const triggerType = normalizeTransitionTriggerType(transition);
      const rawTriggerEvent = normalizeTransitionEvent(transition.triggerEvent || "");
      return {
        ...transition,
        id,
        label: String(transition.label || defaultTransitionLabel(transition, m)),
        condition: String(transition.condition || ""),
        set: normalizeDataObject(transition.set),
        triggerType,
        triggerEvent: normalizeTransitionEvent(rawTriggerEvent || (triggerType === "change" ? "" : defaultTransitionEvent({ ...transition, id, triggerType }))),
        timerMs: normalizeTransitionTimerMs(transition.timerMs),
        groupEntryId: typeof transition.groupEntryId === "string" ? transition.groupEntryId : "",
        groupExitId: typeof transition.groupExitId === "string" ? transition.groupExitId : ""
      };
    });

  m.editorGroups = normalizeEditorGroups(m.editorGroups, m);
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

function validateModel(model) {
  const rawHiddenComponentIssues = [];
  for (const state of Array.isArray(model?.states) ? model.states : []) {
    for (const component of Array.isArray(state?.components) ? state.components : []) {
      for (const forbidden of hiddenComponentStateKeys(component)) {
        rawHiddenComponentIssues.push({
          code: "hidden_component_state",
          stateId: String(state?.id || ""),
          componentId: String(component?.id || ""),
          message: `Component must not carry ${forbidden}; bind through state.data/dataWires instead.`
        });
      }
    }
  }
  const normalized = normalizeModel(model);
  const issues = [...rawHiddenComponentIssues];
  const warnings = [];
  const ids = new Set(normalized.states.map(state => state.id));
  if (normalized.states.length && !ids.has(normalized.initial)) issues.push({ code: "missing_initial", message: "Initial state must reference an existing state." });

  for (const state of normalized.states) {
    const data = normalizeDataObject(state.data);
    for (const [path] of Object.entries(normalizeDataTypes(state.dataTypes, data))) {
      if (!dataObjectHasPath(data, path)) warnings.push({ code: "orphan_data_type", stateId: state.id, path, message: "Data type path has no matching state.data value." });
    }
    for (const component of normalizeComponents(state.components)) {
      if (component.type === "transitionButton" && !normalized.transitions.some(transition => transition.id === component.transitionId)) {
        warnings.push({ code: "missing_transition_button_target", stateId: state.id, componentId: component.id, message: "Transition button references a missing transition." });
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
  assertNoHiddenComponentStateInComponents(args.components);
  const existingIds = new Set(model.states.map(state => state.id));
  const id = uniqueId(existingIds, args.id || args.title, "state");
  const parentId = args.parentId ? String(args.parentId) : null;
  if (parentId && !byModelId(model, parentId)) throw new Error(`Parent state not found: ${parentId}`);
  const state = {
    id,
    title: String(args.title || id),
    renderMode: normalizeStateRenderMode(args.renderMode),
    components: normalizeComponents(args.components),
    data: normalizeDataObject(args.data),
    dataTypes: normalizeDataTypes(args.dataTypes, args.data),
    dataSource: normalizeDataSource(args.dataSource),
    repeat: normalizeRepeatConfig(args.repeat),
    dataWires: normalizeDataWires(args.dataWires),
    subscriptions: normalizeSubscriptions(args.subscriptions),
    boundary: normalizeBoundaryConfig(args.boundary),
    parentId,
    x: snapClampToGrid(Number.isFinite(Number(args.x)) ? Number(args.x) : 120 + model.states.length * GRID_SIZE * 7, WORLD_MIN_X, WORLD_MAX_X - 168),
    y: snapClampToGrid(Number.isFinite(Number(args.y)) ? Number(args.y) : 120 + model.states.length * GRID_SIZE * 4, WORLD_MIN_Y, WORLD_MAX_Y - NODE_H)
  };
  model.states.push(state);
  if (!model.initial) model.initial = state.id;
  return state;
}

function upsertState(model, args) {
  if ("components" in args) assertNoHiddenComponentStateInComponents(args.components);
  const id = args.id ? String(args.id) : "";
  const existing = id ? byModelId(model, id) : null;
  if (!existing) return createState(model, args);
  if ("title" in args) existing.title = String(args.title || existing.id);
  if ("renderMode" in args) existing.renderMode = normalizeStateRenderMode(args.renderMode);
  if ("parentId" in args) {
    const parentId = args.parentId ? String(args.parentId) : null;
    if (parentId && !byModelId(model, parentId)) throw new Error(`Parent state not found: ${parentId}`);
    existing.parentId = parentId && parentId !== existing.id ? parentId : null;
  }
  if ("x" in args) existing.x = snapClampToGrid(Number(args.x), WORLD_MIN_X, WORLD_MAX_X - 168);
  if ("y" in args) existing.y = snapClampToGrid(Number(args.y), WORLD_MIN_Y, WORLD_MAX_Y - NODE_H);
  if ("components" in args) existing.components = normalizeComponents(args.components);
  if ("data" in args) existing.data = normalizeDataObject(args.data);
  if ("dataTypes" in args) existing.dataTypes = normalizeDataTypes(args.dataTypes, existing.data);
  if ("dataSource" in args) existing.dataSource = normalizeDataSource(args.dataSource);
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
  const id = String(args.id || args.stateId || "");
  if (!id) throw new Error("delete_state requires id.");
  const ids = args.deleteDescendants === false ? new Set([id]) : descendantStateIds(model, [id]);
  model.states = model.states.filter(state => !ids.has(state.id));
  model.transitions = model.transitions.filter(transition =>
    !ids.has(transition.from) &&
    !ids.has(transition.to) &&
    !ids.has(transition.groupEntryId) &&
    !ids.has(transition.groupExitId) &&
    !ids.has(transition.boundaryFlow?.stateId)
  );
  model.editorGroups = normalizeEditorGroups(model.editorGroups, model).filter(group =>
    group.stateIds.every(stateId => !ids.has(stateId))
  );
  if (ids.has(model.initial)) model.initial = model.states[0]?.id || "";
  return { deleted: [...ids] };
}

function upsertEditorGroup(model, args) {
  const groupId = String(args.id || args.groupId || args.title || "group");
  const stateIds = Array.isArray(args.stateIds) ? args.stateIds.map(String).filter(Boolean) : [];
  if (!stateIds.length) throw new Error("upsert_editor_group requires stateIds.");
  const existingGroups = normalizeEditorGroups(model.editorGroups, model);
  const existing = existingGroups.find(group => group.id === groupId);
  const nextGroup = {
    ...(existing || {}),
    id: groupId,
    title: String(args.title || existing?.title || "Group"),
    layerId: String(args.layerId || existing?.layerId || ""),
    stateIds
  };
  model.editorGroups = normalizeEditorGroups([
    ...existingGroups.filter(group => group.id !== existing?.id && group.id !== groupId),
    nextGroup
  ], model);
  return model.editorGroups.find(group => group.id === groupId) || model.editorGroups[model.editorGroups.length - 1] || null;
}

function deleteEditorGroup(model, args) {
  const ids = new Set((Array.isArray(args.ids) ? args.ids : [args.id || args.groupId]).map(id => String(id || "")).filter(Boolean));
  if (!ids.size) throw new Error("delete_editor_group requires id, groupId, or ids.");
  const before = normalizeEditorGroups(model.editorGroups, model);
  model.editorGroups = before.filter(group => !ids.has(group.id));
  return { deleted: before.filter(group => ids.has(group.id)).map(group => group.id) };
}

function upsertTransition(model, args) {
  const from = String(args.from || "");
  const to = String(args.to || "");
  if (!from || !to) throw new Error("upsert_transition requires from and to.");
  if (!byModelId(model, from) || !byModelId(model, to)) throw new Error("Transition endpoints must be existing states.");
  if (endpointParentId(model, from) !== endpointParentId(model, to)) throw new Error("Transition endpoints must be in the same layer.");
  const existing = args.id ? model.transitions.find(transition => transition.id === args.id) : model.transitions.find(transition => transition.from === from && transition.to === to && !transition.boundaryFlow);
  const target = existing || { id: uniqueRawId(new Set(model.transitions.map(transition => transition.id)), args.id || uniqueId([], args.label, "t"), "t") };
  const sourceState = byModelId(model, from);
  target.from = from;
  target.to = to;
  target.label = String(args.label || target.label || defaultTransitionLabel(target, model));
  target.condition = rewriteStateScopedCondition(sourceState, args.condition || "");
  target.set = normalizeStateScopedPatch(sourceState, args.set);
  target.triggerType = normalizeTransitionTriggerType(args);
  target.triggerEvent = normalizeStateScopedTransitionEvent(sourceState, args.triggerEvent || (target.triggerType === "change" ? "" : defaultTransitionEvent(target)));
  target.timerMs = normalizeTransitionTimerMs(args.timerMs);
  target.groupEntryId = String(args.groupEntryId || "");
  target.groupExitId = String(args.groupExitId || "");
  if (!existing) model.transitions.push(target);
  return target;
}

function applyAction(model, action) {
  if (!isPlainObject(action)) throw new Error("Each action must be an object.");
  const type = String(action.type || action.action || "");
  switch (type) {
    case "create_flow":
      return { type, model: Object.assign(model, blankModel(action.name || "State App")) };
    case "set_model_name":
      model.name = String(action.name || "State App");
      return { type, name: model.name };
    case "replace_model": {
      assertNoHiddenComponentStateInModel(action.model);
      const next = normalizeModel(action.model);
      Object.keys(model).forEach(key => delete model[key]);
      Object.assign(model, next);
      return { type, summary: modelSummary(model) };
    }
    case "upsert_state":
    case "add_state":
      return { type, state: upsertState(model, action) };
    case "delete_state":
      return { type, ...deleteState(model, action) };
    case "upsert_editor_group":
    case "group_states":
      return { type, group: upsertEditorGroup(model, action) };
    case "delete_editor_group":
    case "degroup_states":
      return { type, ...deleteEditorGroup(model, action) };
    case "move_state": {
      const state = findStateOrThrow(model, action.id || action.stateId);
      state.x = snapClampToGrid(Number(action.x), WORLD_MIN_X, WORLD_MAX_X - 168);
      state.y = snapClampToGrid(Number(action.y), WORLD_MIN_Y, WORLD_MAX_Y - NODE_H);
      return { type, state };
    }
    case "set_initial":
      findStateOrThrow(model, action.stateId || action.id);
      model.initial = String(action.stateId || action.id);
      return { type, initial: model.initial };
    case "upsert_transition":
    case "add_transition":
      return { type, transition: upsertTransition(model, action) };
    case "delete_transition": {
      const id = String(action.id || action.transitionId || "");
      model.transitions = model.transitions.filter(transition => transition.id !== id);
      for (const state of model.states) {
        state.components = normalizeComponents(state.components).filter(component => component.type !== "transitionButton" || component.transitionId !== id);
      }
      return { type, deleted: id };
    }
    case "upsert_state_variable": {
      const state = findStateOrThrow(model, action.stateId);
      const path = stateVariableActualPath(state, action.path);
      if (!path) throw new Error("upsert_state_variable requires a valid path.");
      const typeName = normalizeStateVariableType(action.valueType || action.type || inferStateVariableType(path, action.value));
      const value = Object.prototype.hasOwnProperty.call(action, "value") ? action.value : defaultStateVariableValue(typeName);
      state.data = setDataObjectPath(ensureStateVariableScopeRoot(state, state.data), path, value);
      state.dataTypes = { ...normalizeDataTypes(state.dataTypes, state.data), [path]: typeName };
      return { type, stateId: state.id, path, valueType: typeName };
    }
    case "delete_state_variable": {
      const state = findStateOrThrow(model, action.stateId);
      const path = stateVariableActualPath(state, action.path);
      state.data = deleteDataObjectPath(state.data, path);
      state.dataTypes = Object.fromEntries(Object.entries(normalizeDataTypes(state.dataTypes, state.data)).filter(([key]) => key !== path && !key.startsWith(path + ".")));
      state.dataWires = normalizeDataWires(state.dataWires).filter(wire => wire.sourcePath !== path && !wire.sourcePath.startsWith(path + "."));
      return { type, stateId: state.id, path };
    }
    case "configure_fetch": {
      const state = findStateOrThrow(model, action.stateId);
      const requestedTarget = Object.prototype.hasOwnProperty.call(action, "target")
        ? normalizeContextPath(action.target, "")
        : "";
      state.dataSource = normalizeDataSource({
        ...action,
        target: requestedTarget || `${stateDataScopeForId(state.id)}.fetch`
      });
      return { type, stateId: state.id, dataSource: state.dataSource };
    }
    case "configure_repeat": {
      const state = findStateOrThrow(model, action.stateId);
      state.repeat = normalizeRepeatConfig(action);
      return { type, stateId: state.id, repeat: state.repeat };
    }
    case "upsert_data_wire": {
      const state = findStateOrThrow(model, action.stateId);
      const scopedAction = {
        ...action,
        sourcePath: stateScopedActionPath(state, action.sourcePath || action.path),
        scopePath: action.scopePath ? stateScopedActionPath(state, action.scopePath) : ""
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
      const id = String(action.id || action.wireId || "");
      const sourcePath = normalizeBindingPath(action.sourcePath || "", "");
      state.dataWires = normalizeDataWires(state.dataWires).filter(wire => wire.id !== id && (!sourcePath || wire.sourcePath !== sourcePath));
      state.components = normalizeComponents(state.components).filter(component => component.type !== "dataWire" || component.wireId !== id);
      return { type, stateId: state.id, id, sourcePath };
    }
    case "add_component": {
      const state = findStateOrThrow(model, action.stateId);
      const rawComponent = action.component || action;
      assertNoHiddenComponentState(rawComponent);
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
      const componentId = String(action.componentId || action.id || "");
      assertNoHiddenComponentState(action.patch || action.component || {});
      let updated = null;
      state.components = normalizeComponents(state.components).map(component => {
        if (component.id !== componentId) return component;
        [updated] = normalizeComponents([{ ...component, ...(action.patch || action.component || {}) }]);
        return updated || component;
      });
      if (!updated) throw new Error(`Component not found: ${componentId}`);
      return { type, stateId: state.id, component: updated };
    }
    case "remove_component": {
      const state = findStateOrThrow(model, action.stateId);
      const componentId = String(action.componentId || action.id || "");
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
  const type = String(action?.type || action?.action || "");
  if (type === "create_flow" || type === "replace_model" || type === "set_model_name") return 0;
  if (type === "add_state" || type === "upsert_state") return 10;
  if (type === "set_initial") return 20;
  if (type === "upsert_state_variable" || type === "configure_fetch" || type === "configure_repeat" || type === "upsert_data_wire" || type === "add_component") return 30;
  if (type === "upsert_editor_group" || type === "group_states" || type === "delete_editor_group" || type === "degroup_states") return 35;
  if (type === "set_boundary") return 40;
  if (type === "add_transition" || type === "upsert_transition") return 50;
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
  const model = normalizeModel(inputModel || blankModel());
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

function definitionPayload(model, stateTemplates = []) {
  return {
    kind: "state-blueprint.definition",
    schemaVersion: 2,
    app: "State Blueprint",
    savedAt: new Date().toISOString(),
    model: normalizeModel(model),
    stateTemplates: Array.isArray(stateTemplates) ? clone(stateTemplates) : [],
    camera: { x: 32, y: 32, scale: 1 },
    previewCollapsed: false
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
  validateModel,
  applyActions,
  definitionPayload,
  modelSummary,
  setDataObjectPath,
  deleteDataObjectPath,
  dataObjectValueAtPath
};
