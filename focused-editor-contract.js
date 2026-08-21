(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZustandFocusedContract = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PRESETS = Object.freeze([
    { id: "builtin_daisy_dropdown", title: "Dropdown", kind: "daisy", variant: "dropdown", data: { label: "Dropdown", value: "", options: ["Option 1", "Option 2"] }, dataTypes: { label: "text", value: "text", options: "list" } },
    { id: "builtin_daisy_button", title: "Button", kind: "daisy", variant: "button", data: { label: "Button" }, dataTypes: { label: "text" } },
    { id: "builtin_daisy_toast", title: "Toast", kind: "daisy", variant: "toast", data: { message: "Hinweis", visible: true }, dataTypes: { message: "text", visible: "boolean" } },
    { id: "builtin_daisy_checkbox", title: "Checkbox", kind: "daisy", variant: "checkbox", data: { label: "Checkbox", checked: false }, dataTypes: { label: "text", checked: "boolean" } },
    { id: "builtin_daisy_input", title: "Input Text", kind: "input", inputType: "text", data: { label: "Text", value: "" }, dataTypes: { label: "text", value: "text" } },
    { id: "builtin_daisy_input_number", title: "Input Number", kind: "input", inputType: "number", data: { label: "Zahl", value: 0 }, dataTypes: { label: "text", value: "number" } },
    { id: "builtin_daisy_search", title: "Search", kind: "input", inputType: "search", data: { label: "Suche", value: "" }, dataTypes: { label: "text", value: "text" } },
    { id: "builtin_daisy_input_email", title: "Input Email", kind: "input", inputType: "email", data: { label: "E-Mail", value: "" }, dataTypes: { label: "text", value: "email" } },
    { id: "builtin_daisy_input_password", title: "Input Password", kind: "input", inputType: "password", data: { label: "Passwort", value: "" }, dataTypes: { label: "text", value: "text" } },
    { id: "builtin_page_heading", title: "Header", kind: "heading", data: {}, dataTypes: {} },
    { id: "builtin_media_image", title: "Image", kind: "image", data: {}, dataTypes: {} },
    { id: "builtin_daisy_date", title: "Date", kind: "input", inputType: "date", data: { label: "Datum", value: "2026-08-21", min: "", max: "" }, dataTypes: { label: "text", value: "text", min: "text", max: "text" } },
    { id: "builtin_daisy_radio", title: "Radio", kind: "daisy", variant: "radio", data: { label: "Auswahl", value: "Option 1", options: ["Option 1", "Option 2"] }, dataTypes: { label: "text", value: "text", options: "list" } }
  ]);

  const TRIGGERS = Object.freeze([
    { id: "button", title: "Klick / Button" },
    { id: "change", title: "Feld geändert" },
    { id: "event", title: "Ereignis" },
    { id: "timer", title: "Wartezeit" },
    { id: "auto", title: "Automatisch" }
  ]);

  const RULE_OPERATORS = Object.freeze([
    { id: "==", title: "ist gleich" },
    { id: "!=", title: "ist nicht gleich" },
    { id: ">", title: "größer als" },
    { id: ">=", title: "mindestens" },
    { id: "<", title: "kleiner als" },
    { id: "<=", title: "höchstens" },
    { id: "truthy", title: "ist gesetzt / wahr" },
    { id: "falsy", title: "ist leer / falsch" }
  ]);

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function normalizeId(value, fallback) {
    const clean = String(value || fallback || "state")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64);
    return clean || String(fallback || "state");
  }

  function uniqueId(values, requested, prefix) {
    const used = new Set((values || []).map(String));
    const base = normalizeId(requested || prefix || "id", prefix || "id");
    let candidate = base;
    let index = 2;
    while (used.has(candidate)) candidate = base + "_" + index++;
    return candidate;
  }

  function blankModel(name) {
    return {
      version: 2,
      name: String(name || "Neuer Ablauf"),
      initial: "",
      states: [],
      transitions: []
    };
  }

  function presetById(id) {
    return PRESETS.find(item => item.id === String(id || "")) || null;
  }

  function componentForPreset(spec, stateId) {
    const componentId = "c_" + stateId + "_main";
    if (spec.kind === "heading") return { id: componentId, type: "heading", text: "Header", url: "" };
    if (spec.kind === "image") return { id: componentId, type: "image", text: "", url: "" };
    if (spec.kind === "input") {
      return {
        id: componentId,
        type: "daisy",
        text: "",
        url: "",
        variant: "input",
        inputType: spec.inputType,
        dataPath: "states." + stateId,
        dataRole: "widget",
        dataLabel: spec.title
      };
    }
    return {
      id: componentId,
      type: "daisy",
      text: "",
      url: "",
      variant: spec.variant,
      dataPath: "states." + stateId,
      dataRole: "widget",
      dataLabel: spec.title
    };
  }

  function createStateFromPreset(presetId, options) {
    const spec = presetById(presetId);
    if (!spec) throw new Error("Unknown focused preset: " + presetId);
    const opts = options && typeof options === "object" ? options : {};
    const id = normalizeId(opts.id || spec.title, "state");
    return {
      id,
      title: String(opts.title || spec.title),
      x: Number.isFinite(Number(opts.x)) ? Number(opts.x) : 120,
      y: Number.isFinite(Number(opts.y)) ? Number(opts.y) : 120,
      components: [componentForPreset(spec, id)],
      data: clone(spec.data || {}),
      dataTypes: clone(spec.dataTypes || {})
    };
  }

  function createPlainState(options) {
    const opts = options && typeof options === "object" ? options : {};
    const id = normalizeId(opts.id || opts.title || "state", "state");
    return {
      id,
      title: String(opts.title || "State"),
      x: Number.isFinite(Number(opts.x)) ? Number(opts.x) : 120,
      y: Number.isFinite(Number(opts.y)) ? Number(opts.y) : 120,
      components: [],
      data: {},
      dataTypes: {}
    };
  }

  function addState(model, state) {
    const next = clone(model || blankModel());
    next.version = 2;
    next.states = Array.isArray(next.states) ? next.states : [];
    next.transitions = Array.isArray(next.transitions) ? next.transitions : [];
    const requested = normalizeId(state && state.id, "state");
    const id = uniqueId(next.states.map(item => item.id), requested, "state");
    const copy = clone(state || createPlainState({ id }));
    copy.id = id;
    copy.title = String(copy.title || id);
    copy.x = Number.isFinite(Number(copy.x)) ? Number(copy.x) : 120;
    copy.y = Number.isFinite(Number(copy.y)) ? Number(copy.y) : 120;
    copy.components = Array.isArray(copy.components) ? copy.components : [];
    copy.data = copy.data && typeof copy.data === "object" && !Array.isArray(copy.data) ? copy.data : {};
    copy.dataTypes = copy.dataTypes && typeof copy.dataTypes === "object" && !Array.isArray(copy.dataTypes) ? copy.dataTypes : {};
    for (const component of copy.components) {
      if (typeof component.dataPath === "string" && /^states\.[a-zA-Z_][a-zA-Z0-9_]*(?:\.|$)/.test(component.dataPath)) {
        component.dataPath = component.dataPath.replace(/^states\.[a-zA-Z_][a-zA-Z0-9_]*/, "states." + id);
      }
      if (String(component.id || "").includes(requested)) component.id = String(component.id).replace(requested, id);
    }
    next.states.push(copy);
    if (!next.initial) next.initial = id;
    return { model: next, state: copy };
  }

  function deleteState(model, id) {
    const next = clone(model || blankModel());
    next.states = (next.states || []).filter(item => item.id !== id);
    next.transitions = (next.transitions || []).filter(item => item.from !== id && item.to !== id);
    if (next.initial === id) next.initial = next.states[0] ? next.states[0].id : "";
    return next;
  }

  function createTransition(model, options) {
    const opts = options && typeof options === "object" ? options : {};
    const transitions = Array.isArray(model && model.transitions) ? model.transitions : [];
    const id = uniqueId(transitions.map(item => item.id), opts.id || "transition", "transition");
    const triggerType = TRIGGERS.some(item => item.id === opts.triggerType) ? opts.triggerType : "button";
    return {
      id,
      from: String(opts.from || ""),
      to: String(opts.to || ""),
      label: String(opts.label || "Weiter"),
      condition: String(opts.condition || ""),
      triggerType,
      triggerEvent: triggerType === "event" ? String(opts.triggerEvent || "") : "",
      timerMs: triggerType === "timer" ? Math.max(0, Math.round(Number(opts.timerMs) || 1000)) : 0,
      set: opts.set && typeof opts.set === "object" && !Array.isArray(opts.set) ? clone(opts.set) : {}
    };
  }

  function addTransition(model, transition) {
    const next = clone(model || blankModel());
    next.transitions = Array.isArray(next.transitions) ? next.transitions : [];
    next.transitions.push(clone(transition));
    return next;
  }

  function literal(value) {
    const raw = String(value === undefined || value === null ? "" : value).trim();
    if (raw === "true" || raw === "false") return raw;
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) return raw;
    return JSON.stringify(raw);
  }

  function normalizeRule(rule) {
    const path = String(rule && rule.path || "").trim();
    const operator = String(rule && rule.operator || "==");
    const value = rule && Object.prototype.hasOwnProperty.call(rule, "value") ? rule.value : "";
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*(?:\.(?:[a-zA-Z_][a-zA-Z0-9_]*|\d+))*$/.test(path)) return null;
    if (!RULE_OPERATORS.some(item => item.id === operator)) return null;
    return { path, operator, value };
  }

  function conditionFromRules(rules, join) {
    const atoms = (Array.isArray(rules) ? rules : []).map(normalizeRule).filter(Boolean).map(rule => {
      if (rule.operator === "truthy") return rule.path;
      if (rule.operator === "falsy") return "!" + rule.path;
      return rule.path + " " + rule.operator + " " + literal(rule.value);
    });
    if (!atoms.length) return "";
    const glue = String(join || "and") === "or" ? " || " : " && ";
    return atoms.join(glue);
  }

  function unquote(value) {
    const text = String(value || "").trim();
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
      try { return JSON.parse(text.startsWith("'") ? '"' + text.slice(1, -1).replace(/"/g, '\\"') + '"' : text); } catch (_) { return text.slice(1, -1); }
    }
    if (text === "true") return true;
    if (text === "false") return false;
    if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
    return text;
  }

  function rulesFromCondition(condition) {
    const text = String(condition || "").trim();
    if (!text) return { join: "and", rules: [] };
    const join = text.includes("||") ? "or" : "and";
    const pieces = text.split(join === "or" ? "||" : "&&").map(item => item.trim()).filter(Boolean);
    const rules = [];
    for (const atom of pieces) {
      if (/^![a-zA-Z_][a-zA-Z0-9_.]*$/.test(atom)) {
        rules.push({ path: atom.slice(1), operator: "falsy", value: "" });
        continue;
      }
      if (/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(atom)) {
        rules.push({ path: atom, operator: "truthy", value: "" });
        continue;
      }
      const match = atom.match(/^([a-zA-Z_][a-zA-Z0-9_.]*)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
      if (!match) return { join: "and", rules: [], raw: text };
      rules.push({ path: match[1], operator: match[2], value: unquote(match[3]) });
    }
    return { join, rules };
  }

  function stateDataPaths(model) {
    const out = [];
    for (const state of Array.isArray(model && model.states) ? model.states : []) {
      const walk = (value, prefix) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          if (prefix) out.push(prefix);
          return;
        }
        const keys = Object.keys(value);
        if (!keys.length && prefix) out.push(prefix);
        for (const key of keys) walk(value[key], prefix ? prefix + "." + key : key);
      };
      for (const key of Object.keys(state.data || {})) walk(state.data[key], "states." + state.id + "." + key);
    }
    return out.sort();
  }

  function recordingActionForTransition(model, recording, transitionId) {
    const transitions = Array.isArray(model && model.transitions) ? model.transitions : [];
    const index = transitions.findIndex(item => item.id === transitionId);
    if (index < 0) return null;
    const actions = Array.isArray(recording && recording.actions) ? recording.actions : [];
    return actions[index] || null;
  }

  return {
    PRESETS,
    TRIGGERS,
    RULE_OPERATORS,
    clone,
    normalizeId,
    uniqueId,
    blankModel,
    presetById,
    createStateFromPreset,
    createPlainState,
    addState,
    deleteState,
    createTransition,
    addTransition,
    conditionFromRules,
    rulesFromCondition,
    stateDataPaths,
    recordingActionForTransition
  };
});