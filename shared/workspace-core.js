(function exposeWorkspaceCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StateBlueprintWorkspaceCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createWorkspaceCore() {
  "use strict";

  const GESTURE_TRANSITIONS = Object.freeze({
    idle: Object.freeze(["pendingCanvas", "pendingNode", "pendingEdge", "boxSelect", "pan", "nodeDrag", "connect", "edgeRewire", "pinch"]),
    pendingCanvas: Object.freeze(["idle", "boxSelect", "pan", "connect", "pinch"]),
    pendingNode: Object.freeze(["idle", "pan", "nodeDrag", "pinch"]),
    pendingEdge: Object.freeze(["idle", "pan", "edgeRewire", "pinch"]),
    boxSelect: Object.freeze(["idle", "pinch"]),
    pan: Object.freeze(["idle", "pinch"]),
    nodeDrag: Object.freeze(["idle", "pinch"]),
    connect: Object.freeze(["idle", "pinch"]),
    edgeRewire: Object.freeze(["idle", "pinch"]),
    pinch: Object.freeze(["idle"])
  });

  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    if (value === undefined || value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      const copy = new Array(value.length);
      for (let index = 0; index < value.length; index += 1) {
        if (Object.prototype.hasOwnProperty.call(value, index)) copy[index] = clone(value[index]);
      }
      return copy;
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
  }

  function isReservedRuntimeId(value) {
    return /^__runtime(?:_|:)/.test(String(value || ""));
  }

  function idleGesture() {
    return { mode: "idle", pointerId: null, pointerType: "", startedAt: 0 };
  }

  function pointerIdForEvent(event) {
    if (!event) return null;
    if (Number.isFinite(event.pointerId)) return event.pointerId;
    return event.pointerType && event.pointerType !== "mouse" ? null : "mouse";
  }

  function transitionGesture(currentValue, nextMode, event, options) {
    const current = currentValue && GESTURE_TRANSITIONS[currentValue.mode] ? currentValue : idleGesture();
    const next = String(nextMode || "idle");
    const config = options || {};
    if (!GESTURE_TRANSITIONS[next]) return { ok: false, state: current, reason: "unknown-mode" };
    if (!config.force && current.mode !== next && !GESTURE_TRANSITIONS[current.mode].includes(next)) {
      return { ok: false, state: current, reason: "invalid-transition" };
    }
    const pointerId = pointerIdForEvent(event);
    if (!config.force && current.mode !== "idle" && next !== "idle" &&
      current.pointerId !== null && pointerId !== null && current.pointerId !== pointerId) {
      return { ok: false, state: current, reason: "pointer-owned" };
    }
    if (next === "idle") return { ok: true, state: idleGesture(), reason: "" };
    return {
      ok: true,
      state: {
        mode: next,
        pointerId: next === "pinch" ? null : pointerId === null ? current.pointerId : pointerId,
        pointerType: String((event && event.pointerType) || (next === "pinch" ? "touch" : current.pointerType) || "mouse"),
        startedAt: current.mode === "idle" ? Number(config.now ?? Date.now()) : current.startedAt
      },
      reason: ""
    };
  }

  function validationSucceeded(validation) {
    return validation === undefined || validation === null || validation === true || validation.ok === true;
  }

  function validationMessage(validation) {
    if (typeof validation === "string") return validation;
    if (validation && typeof validation.message === "string") return validation.message;
    if (validation && Array.isArray(validation.issues)) {
      return validation.issues.map(issue => issue && issue.message).filter(Boolean).join("; ");
    }
    return "Atomic workspace transaction failed validation.";
  }

  function runAtomicTransaction(input, operation, options) {
    if (typeof operation !== "function") throw new TypeError("Atomic workspace transaction requires an operation.");
    const config = options || {};
    const before = clone(input);
    const draft = clone(input);
    try {
      const result = operation(draft);
      if (result && typeof result.then === "function") {
        throw new TypeError("Atomic workspace transaction operation must be synchronous.");
      }
      const value = typeof config.normalize === "function" ? config.normalize(draft, result) : draft;
      const validation = typeof config.validate === "function" ? config.validate(value, result) : true;
      if (!validationSucceeded(validation)) {
        const error = new Error(validationMessage(validation));
        error.validation = validation;
        throw error;
      }
      return { value, result, before };
    } catch (error) {
      if (error && typeof error === "object" && !("transactionBefore" in error)) error.transactionBefore = before;
      throw error;
    }
  }

  return Object.freeze({
    GESTURE_TRANSITIONS,
    clone,
    isReservedRuntimeId,
    idleGesture,
    transitionGesture,
    runAtomicTransaction
  });
});
