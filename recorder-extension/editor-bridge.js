"use strict";

(() => {
  const pending = new Map();
  let sequence = 0;
  let ready = false;
  let initialized = false;

  function init() {
    if (initialized) return;
    initialized = true;
    window.addEventListener("message", event => {
      const data = event.data;
      if (event.source !== window || data?.source !== "zustand-recorder-extension") return;
      if (data.type === "ZUSTAND_EXTENSION_READY") {
        ready = true;
        window.dispatchEvent(new CustomEvent("zustand-recorder-ready"));
        return;
      }
      if (data.type !== "ZUSTAND_EXTENSION_RESPONSE") return;
      const entry = pending.get(String(data.requestId || ""));
      if (!entry) return;
      pending.delete(String(data.requestId || ""));
      clearTimeout(entry.timer);
      const response = data.response || {};
      if (response.ok === false) entry.reject(new Error(response.error || "Desktop Recorder Fehler"));
      else entry.resolve(response);
    });
  }

  function request(command, payload = {}, timeoutMs = 3000) {
    init();
    const requestId = `ext_${Date.now()}_${++sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("Desktop Recorder nicht verfügbar"));
      }, timeoutMs);
      pending.set(requestId, { resolve, reject, timer });
      window.postMessage({
        source: "zustand-editor",
        type: "ZUSTAND_EXTENSION_COMMAND",
        requestId,
        command,
        payload
      }, "*");
    });
  }

  async function ping(timeoutMs = 900) {
    const response = await request("PING", {}, timeoutMs);
    ready = response?.ok !== false;
    return response;
  }

  function isMobile() {
    const ua = navigator.userAgent || "";
    return /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  }

  function sanitizeId(value, fallback = "field") {
    const clean = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 54);
    return clean || fallback;
  }

  function fieldFromAction(action = {}, stateId = "state") {
    if (!action || action.type !== "input") return null;
    const target = action.target || {};
    const selector = String(action.selector || target.selector || "");
    const label = String(target.label || selector || "Eingabe").trim().slice(0, 100);
    const inputType = String(target.inputType || "text").toLowerCase();
    const base = sanitizeId(target.name || target.id || label || selector, "input");
    const booleanField = inputType === "checkbox" || inputType === "radio";
    const property = booleanField ? "checked" : "value";
    const type = booleanField ? "boolean" : inputType === "number" ? "number" : inputType === "email" ? "email" : inputType === "password" ? "password" : "text";
    return { id: base, label, type, property, path: `states.${stateId}.${base}.${property}`, selector };
  }

  function triggerContext(action = {}) {
    if (["click", "input", "key", "scroll", "navigate"].includes(String(action.type || ""))) return "interaction";
    if (["event", "webhook"].includes(String(action.type || ""))) return "event";
    if (action.type === "timer") return "timer";
    return "auto";
  }

  function listenerFromAction(action = {}) {
    const listener = { type: String(action.type || "auto") || "auto" };
    for (const key of ["selector", "key", "url", "deltaX", "deltaY", "x", "y"]) {
      if (Object.hasOwn(action, key)) listener[key] = action[key];
    }
    if (action.type === "input") {
      listener.redacted = action.redacted === true;
      if (!listener.redacted && Object.hasOwn(action, "value")) listener.value = action.value;
      if (Object.hasOwn(action, "checked")) listener.checked = Boolean(action.checked);
    }
    return listener;
  }

  function snapshotForState(snapshots, actions, index) {
    if (!snapshots.length) return {};
    if (index === 0) return snapshots[0];
    const targetAt = Number(actions[index - 1]?.atMs) || 0;
    return snapshots.find(snapshot => Number(snapshot.atMs) >= targetAt) || snapshots.at(-1) || {};
  }

  function projectFromRecording(recording, options = {}) {
    const actions = Array.isArray(recording?.actions) ? recording.actions.filter(Boolean) : [];
    const snapshots = Array.isArray(recording?.snapshots) ? recording.snapshots.filter(item => item?.image) : [];
    if (!snapshots.length) throw new Error("Die Aufnahme enthält noch keine visuellen States.");
    const host = (() => { try { return new URL(recording.startUrl || snapshots[0]?.url).hostname; } catch (_) { return "Website"; } })();
    const stateCount = Math.max(1, actions.length + 1);
    const states = Array.from({ length: stateCount }, (_, index) => {
      const id = `state_${String(index + 1).padStart(3, "0")}`;
      const snapshot = snapshotForState(snapshots, actions, index);
      const outgoing = actions[index] || null;
      const field = fieldFromAction(outgoing, id);
      const label = outgoing?.target?.label || outgoing?.selector || outgoing?.key || outgoing?.type || "";
      return {
        id,
        title: String(snapshot.title || snapshot.url || label || `${host} ${index + 1}`).slice(0, 180),
        x: 80 + (index % 4) * 240,
        y: 80 + Math.floor(index / 4) * 150,
        trigger: { type: outgoing ? triggerContext(outgoing) : "auto", eventName: "", timerMs: outgoing?.type === "timer" ? Math.max(0, Number(outgoing.delayMs) || 0) : 0 },
        fields: field ? [field] : [],
        snapshot: { atMs: Math.max(0, Number(snapshot.atMs) || 0), url: String(snapshot.url || recording.startUrl || ""), title: String(snapshot.title || ""), image: String(snapshot.image || "") }
      };
    });
    const transitions = actions.map((action, index) => ({
      id: `transition_${String(index + 1).padStart(3, "0")}`,
      from: states[index].id,
      to: states[index + 1].id,
      label: String(action.target?.label || action.selector || action.key || action.type || "Weiter").slice(0, 140),
      listener: listenerFromAction(action),
      rules: { join: "and", items: [] },
      replay: { delayMs: Math.max(0, Math.round(Number(action.delayMs) || 0)) }
    }));
    return {
      kind: "zustand-project",
      version: 1,
      id: options.id || `project_${Math.random().toString(36).slice(2, 10)}`,
      name: String(options.name || `Recording · ${host}`),
      createdAt: options.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startStateId: states[0].id,
      states,
      transitions,
      recording: {
        startUrl: String(recording.startUrl || ""),
        viewport: recording.viewport || null,
        actions: actions.map(action => ({ ...action })),
        snapshotCount: snapshots.length
      }
    };
  }

  const api = {
    init,
    isMobile,
    isReady: () => ready,
    ping,
    projectFromRecording,
    startRecording: url => request("START_RECORDING", { url }, 25000),
    recordingStatus: () => request("RECORDING_STATUS", {}, 2500),
    finishRecording: () => request("FINISH_RECORDING", {}, 15000),
    cancelRecording: () => request("CANCEL_RECORDING", {}, 4000),
    startReplay: startUrl => request("START_REPLAY", { startUrl }, 25000),
    applyReplayAction: (replayId, action) => request("APPLY_REPLAY_ACTION", { replayId, action }, 15000),
    stopReplay: replayId => request("STOP_REPLAY", { replayId }, 4000)
  };

  init();
  window.ZustandRecorderBridge = Object.freeze(api);
})();
