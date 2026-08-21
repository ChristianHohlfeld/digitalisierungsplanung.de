"use strict";

(function initExternalRecorderCompiler(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ZustandExternalRecorderCompiler = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function externalRecorderCompilerFactory() {
  const RECORDING_KIND = "zustand-external-recording";
  const RECORDING_VERSION = 1;
  const DEFINITION_KIND = "state-blueprint-definition";
  const SCHEMA_VERSION = 2;
  const ALLOWED_STEP_TYPES = new Set(["navigation", "click", "input", "change", "submit"]);
  const SECRET_HINT = /(?:password|passwd|passcode|secret|token|api[_-]?key|authorization|credential|current-password|new-password)/i;

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function safeText(value, max = 1000) {
    return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
  }

  function normalizeUrl(value) {
    const text = safeText(value, 4096);
    if (!text) return "";
    try {
      const url = new URL(text);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch (_) {
      return "";
    }
  }

  function normalizeSelector(value) {
    const text = safeText(value, 2048);
    return text.replace(/\s+/g, " ");
  }

  function normalizeAtMs(value, previousAtMs) {
    const number = Number(value);
    const finite = Number.isFinite(number) ? Math.max(0, Math.round(number)) : previousAtMs;
    return Math.max(previousAtMs, finite);
  }

  function looksSecret(step) {
    const inputType = safeText(step.inputType, 80).toLowerCase();
    if (inputType === "password") return true;
    return SECRET_HINT.test([
      inputType,
      safeText(step.name, 200),
      safeText(step.autocomplete, 200),
      safeText(step.selector, 2048),
      safeText(step.label, 300)
    ].join(" "));
  }

  function normalizeStep(input, index, previousAtMs) {
    if (!isPlainObject(input)) throw new Error(`Recording step ${index + 1} must be an object.`);
    const type = safeText(input.type, 40).toLowerCase();
    if (!ALLOWED_STEP_TYPES.has(type)) throw new Error(`Unsupported recording step type: ${type || "empty"}.`);
    const atMs = normalizeAtMs(input.atMs, previousAtMs);
    const step = {
      index: index + 1,
      type,
      atMs,
      url: normalizeUrl(input.url),
      title: safeText(input.title, 300),
      selector: normalizeSelector(input.selector),
      label: safeText(input.label, 300),
      inputType: safeText(input.inputType, 80).toLowerCase(),
      name: safeText(input.name, 200),
      autocomplete: safeText(input.autocomplete, 200),
      value: input.value == null ? "" : safeText(input.value, 4000),
      checked: typeof input.checked === "boolean" ? input.checked : undefined
    };
    if (type !== "navigation" && !step.selector) throw new Error(`Recording step ${index + 1} requires selector.`);
    if (looksSecret(step)) {
      step.value = "[REDACTED]";
      step.secret = true;
    }
    if (step.checked === undefined) delete step.checked;
    if (!step.title) delete step.title;
    if (!step.label) delete step.label;
    if (!step.inputType) delete step.inputType;
    if (!step.name) delete step.name;
    if (!step.autocomplete) delete step.autocomplete;
    if (!step.value && !["input", "change"].includes(type)) delete step.value;
    if (!step.url) delete step.url;
    return step;
  }

  function normalizeRecording(input) {
    if (!isPlainObject(input)) throw new Error("Recording must be an object.");
    const rawSteps = Array.isArray(input.steps) ? input.steps : [];
    if (!rawSteps.length) throw new Error("Recording requires at least one step.");
    let previousAtMs = 0;
    const steps = rawSteps.map((step, index) => {
      const normalized = normalizeStep(step, index, previousAtMs);
      previousAtMs = normalized.atMs;
      return normalized;
    });
    return {
      kind: RECORDING_KIND,
      version: RECORDING_VERSION,
      createdAt: safeText(input.createdAt, 80) || new Date().toISOString(),
      sourceUrl: normalizeUrl(input.sourceUrl) || steps.find(step => step.url)?.url || "",
      sourceTitle: safeText(input.sourceTitle, 300),
      viewport: isPlainObject(input.viewport) ? {
        width: Math.max(0, Math.round(Number(input.viewport.width) || 0)),
        height: Math.max(0, Math.round(Number(input.viewport.height) || 0))
      } : { width: 0, height: 0 },
      steps
    };
  }

  function slug(value, fallback = "step") {
    const normalized = safeText(value, 120)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60);
    return normalized || fallback;
  }

  function pad(index) {
    return String(index + 1).padStart(3, "0");
  }

  function stepVerb(step) {
    if (step.type === "navigation") return "Navigate";
    if (step.type === "click") return "Click";
    if (step.type === "input") return "Input";
    if (step.type === "change") return "Change";
    if (step.type === "submit") return "Submit";
    return "Action";
  }

  function stepTitle(step) {
    const label = safeText(step.label, 120);
    return label ? `${stepVerb(step)} · ${label}` : stepVerb(step);
  }

  function stepDescription(step) {
    const parts = [];
    if (step.url) parts.push(step.url);
    if (step.selector) parts.push(`Target: ${step.selector}`);
    if (["input", "change"].includes(step.type)) {
      if (step.secret) parts.push("Value: [REDACTED]");
      else if (Object.prototype.hasOwnProperty.call(step, "checked")) parts.push(`Checked: ${step.checked}`);
      else parts.push(`Value: ${safeText(step.value, 240)}`);
    }
    return parts.join("\n") || "Recorded browser action";
  }

  function stateData(step, delayMs) {
    const data = {
      action: step.type,
      url: step.url || "",
      selector: step.selector || "",
      delayMs: Math.max(0, Math.round(delayMs || 0)),
      recordedAtMs: Math.max(0, Math.round(step.atMs || 0))
    };
    if (step.label) data.label = step.label;
    if (["input", "change"].includes(step.type)) data.value = step.secret ? "[REDACTED]" : safeText(step.value, 4000);
    if (Object.prototype.hasOwnProperty.call(step, "checked")) data.checked = Boolean(step.checked);
    return data;
  }

  function stateDataTypes(data) {
    const out = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "number") out[key] = "number";
      else if (typeof value === "boolean") out[key] = "boolean";
      else out[key] = "text";
    }
    return out;
  }

  function emptyBoundary() {
    return { entryId: "", exitId: "", entryDisabled: false, exitDisabled: false };
  }

  function actionState(step, index, delayMs) {
    const id = `record_${pad(index)}_${slug(step.type)}`;
    const data = stateData(step, delayMs);
    const components = [
      { id: `${id}_heading`, type: "heading", text: stepTitle(step), url: "" },
      { id: `${id}_detail`, type: "text", text: stepDescription(step), url: "" }
    ];
    if (step.url) components.push({ id: `${id}_url`, type: "link", text: "Open recorded page", url: step.url });
    if (step.secret) components.push({ id: `${id}_secret`, type: "note", text: "Sensitive input was redacted during recording.", url: "" });
    return {
      id,
      title: stepTitle(step),
      components,
      data,
      dataTypes: stateDataTypes(data),
      dataSource: null,
      repeat: null,
      dataWires: [],
      subscriptions: [],
      boundary: emptyBoundary(),
      parentId: null,
      x: 120 + index * 480,
      y: 120
    };
  }

  function waitState(index, delayMs) {
    const id = `record_wait_${pad(index)}`;
    return {
      id,
      title: `Wait ${delayMs} ms`,
      components: [{ id: `${id}_note`, type: "note", text: `Recorded delay: ${delayMs} ms`, url: "" }],
      data: { delayMs },
      dataTypes: { delayMs: "number" },
      dataSource: null,
      repeat: null,
      dataWires: [],
      subscriptions: [],
      boundary: emptyBoundary(),
      parentId: null,
      x: 360 + index * 480,
      y: 120
    };
  }

  function transition(id, from, to, label, triggerType, timerMs) {
    return {
      id,
      from,
      to,
      label: safeText(label, 160),
      condition: "",
      triggerType,
      triggerEvent: "",
      timerMs: triggerType === "timer" ? Math.max(1, Math.round(timerMs || 1)) : 0,
      set: {},
      groupEntryId: "",
      groupExitId: ""
    };
  }

  function modelName(recording, options) {
    if (safeText(options && options.name, 200)) return safeText(options.name, 200);
    if (recording.sourceTitle) return `Recorded · ${recording.sourceTitle}`;
    if (recording.sourceUrl) {
      try { return `Recorded · ${new URL(recording.sourceUrl).host}`; } catch (_) {}
    }
    return "Recorded website flow";
  }

  function compileRecording(input, options = {}) {
    const recording = normalizeRecording(input);
    const states = [];
    const transitions = [];
    const actionStates = recording.steps.map((step, index) => {
      const next = recording.steps[index + 1];
      const delayMs = next ? Math.max(0, next.atMs - step.atMs) : 0;
      const state = actionState(step, index, delayMs);
      states.push(state);
      return state;
    });

    for (let index = 0; index < actionStates.length - 1; index += 1) {
      const current = actionStates[index];
      const next = actionStates[index + 1];
      const delayMs = Math.max(0, recording.steps[index + 1].atMs - recording.steps[index].atMs);
      if (delayMs > 0) {
        const wait = waitState(index, delayMs);
        states.push(wait);
        transitions.push(transition(`record_t_${pad(index)}_wait`, current.id, wait.id, stepTitle(recording.steps[index]), "auto", 0));
        transitions.push(transition(`record_t_${pad(index)}_next`, wait.id, next.id, `${delayMs} ms`, "timer", delayMs));
      } else {
        transitions.push(transition(`record_t_${pad(index)}_next`, current.id, next.id, stepTitle(recording.steps[index]), "auto", 0));
      }
    }

    const model = {
      version: SCHEMA_VERSION,
      name: modelName(recording, options),
      initial: actionStates[0].id,
      boundary: emptyBoundary(),
      states,
      transitions
    };

    const definition = {
      kind: DEFINITION_KIND,
      schemaVersion: SCHEMA_VERSION,
      app: "Zustand",
      savedAt: new Date().toISOString(),
      model,
      stateTemplates: [],
      camera: { x: 32, y: 32, scale: 1 },
      previewCollapsed: false
    };

    return { recording, model, definition };
  }

  function replayPlan(input) {
    const recording = normalizeRecording(input);
    return recording.steps.map((step, index) => ({
      ...clone(step),
      delayMs: index === 0 ? Math.max(0, step.atMs) : Math.max(0, step.atMs - recording.steps[index - 1].atMs)
    }));
  }

  return {
    RECORDING_KIND,
    RECORDING_VERSION,
    DEFINITION_KIND,
    SCHEMA_VERSION,
    normalizeRecording,
    compileRecording,
    replayPlan,
    looksSecret
  };
});
