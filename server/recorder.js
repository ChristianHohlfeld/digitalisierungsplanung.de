"use strict";

const crypto = require("node:crypto");
const dns = require("node:dns");
const net = require("node:net");

const RECORDING_SCHEMA = "website-recording/1";
const DEFAULT_VIEWPORT = Object.freeze({ width: 1120, height: 720 });
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_SETTLE_MS = 260;
const MAX_ACTIONS = 80;
const MAX_REPLAY_DELAY_MS = 60_000;

function recorderError(code, message, statusCode = 400) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function parseIpv4(address) {
  if (net.isIP(address) !== 4) return null;
  return address.split(".").reduce((value, part) => ((value << 8) + Number(part)) >>> 0, 0);
}

function inIpv4Cidr(address, base, bits) {
  const value = parseIpv4(address);
  const start = parseIpv4(base);
  if (value === null || start === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (start & mask);
}

function isBlockedIp(address) {
  const value = String(address || "").trim().toLowerCase();
  if (net.isIP(value) === 4) {
    return [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
      ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
      ["224.0.0.0", 4], ["240.0.0.0", 4]
    ].some(([base, bits]) => inIpv4Cidr(value, base, bits));
  }
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIp(mapped[1]);
  if (net.isIP(value) !== 6) return true;
  return value === "::" || value === "::1" || /^(?:fc|fd)[0-9a-f]{2}:/.test(value) || /^fe[89ab][0-9a-f]:/.test(value) || /^ff[0-9a-f]{2}:/.test(value) || /^2001:db8(?::|$)/.test(value);
}

async function validatePublicUrl(input, options = {}) {
  let url;
  try { url = new URL(String(input || "").trim()); }
  catch (_) { throw recorderError("invalid_url", "Eine vollständige URL ist erforderlich."); }
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw recorderError("invalid_url_scheme", "Nur HTTP- und HTTPS-URLs sind erlaubt.");
  if (url.username || url.password) throw recorderError("url_credentials_forbidden", "Zugangsdaten gehören nicht in die URL.");
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw recorderError("private_url_forbidden", "Lokale und private Ziele sind gesperrt.", 403);
  }
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) throw recorderError("private_url_forbidden", "Lokale und private Ziele sind gesperrt.", 403);
    return url.href;
  }
  const lookup = options.lookup || dns.promises.lookup.bind(dns.promises);
  let records;
  try { records = await lookup(hostname, { all: true, verbatim: true }); }
  catch (_) { throw recorderError("url_dns_failed", "Die Website konnte nicht aufgelöst werden.", 422); }
  const addresses = (Array.isArray(records) ? records : [records]).map(item => item?.address || item).filter(Boolean);
  if (!addresses.length || addresses.some(isBlockedIp)) throw recorderError("private_url_forbidden", "Lokale und private Ziele sind gesperrt.", 403);
  return url.href;
}

function canonicalUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    return url.href;
  } catch (_) {
    return String(value || "");
  }
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

async function pageCheckpoint(page) {
  const structure = await page.evaluate(() => {
    const compact = value => String(value || "").trim().replace(/\s+/g, " ").slice(0, 180);
    const controls = [...document.querySelectorAll("a[href],button,input,select,textarea,[role]")].slice(0, 400).map(element => ({
      tag: element.tagName.toLowerCase(),
      role: compact(element.getAttribute("role")),
      name: compact(element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.getAttribute("name") || element.id || element.textContent),
      type: compact(element.getAttribute("type")),
      href: element instanceof HTMLAnchorElement ? compact(element.getAttribute("href")) : "",
      value: element instanceof HTMLInputElement && element.type === "password"
        ? (element.value ? "[gesetzt]" : "")
        : element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
          ? compact(element.value)
          : "",
      checked: element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type) ? element.checked : undefined,
      disabled: "disabled" in element ? Boolean(element.disabled) : undefined,
      expanded: compact(element.getAttribute("aria-expanded")),
      pressed: compact(element.getAttribute("aria-pressed")),
      selected: compact(element.getAttribute("aria-selected"))
    }));
    return {
      title: compact(document.title),
      controls,
      text: String(document.body?.innerText || "").trim().replace(/\s+/g, " ").slice(0, 12_000),
      scroll: { x: Math.round(scrollX), y: Math.round(scrollY) }
    };
  });
  const url = canonicalUrl(page.url());
  return { url, title: structure.title, fingerprint: hash({ url, ...structure }) };
}

function selectorScript() {
  return `el => {
    if (!el || el.nodeType !== 1) return { css: "", role: "", name: "", testId: "", id: "", label: "", tag: "", inputType: "" };
    const esc = value => window.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
    const compact = value => String(value || "").trim().replace(/\\s+/g, " ").slice(0, 160);
    const explicitRole = compact(el.getAttribute("role"));
    const tag = el.tagName.toLowerCase();
    const inputType = el instanceof HTMLInputElement ? String(el.type || "text").toLowerCase() : "";
    const implicitRole = tag === "button" ? "button" : tag === "a" && el.hasAttribute("href") ? "link" : tag === "select" ? "combobox" : tag === "textarea" ? "textbox" : tag === "input" && ["checkbox","radio"].includes(inputType) ? inputType : tag === "input" ? "textbox" : "";
    const labelled = el.getAttribute("aria-labelledby");
    const labelledText = labelled ? labelled.split(/\\s+/).map(id => document.getElementById(id)?.textContent || "").join(" ") : "";
    const wrappingLabel = el.closest("label")?.textContent || "";
    const forLabel = el.id ? document.querySelector('label[for="' + esc(el.id) + '"]')?.textContent || "" : "";
    const name = compact(el.getAttribute("aria-label") || labelledText || forLabel || wrappingLabel || el.getAttribute("placeholder") || el.textContent || el.getAttribute("value"));
    const testId = compact(el.getAttribute("data-testid") || el.getAttribute("data-test"));
    let css = "";
    if (el.id) css = "#" + esc(el.id);
    else if (testId) css = tag + '[data-testid="' + testId.replace(/"/g, '\\"') + '"]';
    else if (el.getAttribute("name")) css = tag + '[name="' + String(el.getAttribute("name")).replace(/"/g, '\\"') + '"]';
    else {
      const parts = [];
      let node = el;
      for (let depth = 0; node && node.nodeType === 1 && depth < 6; depth += 1, node = node.parentElement) {
        let part = node.tagName.toLowerCase();
        const siblings = node.parentElement ? [...node.parentElement.children].filter(item => item.tagName === node.tagName) : [];
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
        parts.unshift(part);
      }
      css = parts.join(" > ");
    }
    return { css, role: explicitRole || implicitRole, name, testId, id: compact(el.id), label: name || tag, tag, inputType };
  }`;
}

async function targetAt(page, x, y) {
  return page.evaluate(({ x, y, source }) => {
    const element = document.elementFromPoint(x, y);
    return (0, eval)("(" + source + ")")(element);
  }, { x, y, source: selectorScript() });
}

async function focusedTarget(page) {
  return page.evaluate(source => (0, eval)("(" + source + ")")(document.activeElement), selectorScript());
}

async function settle(page, delay = DEFAULT_SETTLE_MS) {
  await Promise.race([
    page.waitForLoadState("domcontentloaded", { timeout: Math.max(1000, delay * 5) }).catch(() => {}),
    page.waitForTimeout(delay)
  ]);
  await page.waitForTimeout(Math.min(200, delay)).catch(() => {});
}

function actionLabel(action) {
  const target = String(action?.locator?.name || action?.locator?.label || "").trim();
  if (action.type === "click") return target ? `Klick: ${target}` : "Klick";
  if (action.type === "input") return action.redacted ? "Eingabe: [geschützt]" : target ? `Eingabe: ${target}` : "Eingabe";
  if (action.type === "key") return `Taste: ${action.key}`;
  if (action.type === "scroll") return Number(action.deltaY) < 0 ? "Scroll nach oben" : "Scroll nach unten";
  if (action.type === "navigate") return `Navigation: ${action.url}`;
  return "Weiter";
}

function replayDelay(action) {
  const value = Number(action?.delayMs);
  return Math.max(100, Math.min(MAX_REPLAY_DELAY_MS, Number.isFinite(value) ? Math.round(value) : 300));
}

function publicAction(action, index = 0) {
  const result = { ...action };
  delete result.target;
  const passwordInput = result.type === "input" && String(result.locator?.inputType || "").toLowerCase() === "password";
  if (result.redacted || passwordInput) {
    result.redacted = true;
    result.secretRef ||= `step_${index + 1}`;
    delete result.value;
  }
  return result;
}

function stateId(index) {
  return `recorded_${String(index + 1).padStart(3, "0")}`;
}

function transitionId(index) {
  return `recorded_t_${String(index + 1).padStart(3, "0")}`;
}

function validateCompiledModel(model) {
  const states = Array.isArray(model?.states) ? model.states : [];
  const transitions = Array.isArray(model?.transitions) ? model.transitions : [];
  const ids = new Set();
  for (const state of states) {
    if (!state?.id || ids.has(state.id)) throw recorderError("compiled_flow_invalid", "State-IDs müssen eindeutig sein.", 500);
    ids.add(state.id);
  }
  if (!states.length || !ids.has(model.initial)) throw recorderError("compiled_flow_invalid", "Der Flow benötigt einen gültigen Startzustand.", 500);
  for (const transition of transitions) {
    if (!transition?.id || ids.has(transition.id)) throw recorderError("compiled_flow_invalid", "Transition-IDs müssen eindeutig sein.", 500);
    ids.add(transition.id);
    if (!states.some(state => state.id === transition.from) || !states.some(state => state.id === transition.to)) {
      throw recorderError("compiled_flow_invalid", "Transitionen müssen vorhandene Zustände verbinden.", 500);
    }
  }
  return model;
}

function compileRecording(recording, options = {}) {
  const snapshots = Array.isArray(recording?.snapshots) ? recording.snapshots : [];
  const actions = Array.isArray(recording?.actions) ? recording.actions : [];
  if (!snapshots.length || snapshots.length !== actions.length + 1) {
    throw recorderError("recording_shape_invalid", "Eine Aufnahme benötigt genau einen Startzustand und einen Zielzustand je Aktion.", 422);
  }
  const host = new URL(recording.startUrl).hostname;
  const states = snapshots.map((snapshot, index) => {
    const id = stateId(index);
    const title = String(snapshot.checkpoint?.title || snapshot.url || `${host} ${index + 1}`).slice(0, 180);
    return {
      id,
      title,
      parentId: null,
      x: 120 + (index % 4) * 240,
      y: 120 + Math.floor(index / 4) * 168,
      components: [
        { id: `c_${id}_title`, type: "heading", text: title, url: "" },
        { id: `c_${id}_image`, type: "image", text: `Website-Zustand ${index + 1}`, url: snapshot.image }
      ],
      data: {
        source_url: snapshot.checkpoint.url,
        checkpoint: snapshot.checkpoint.fingerprint,
        recorded_action: index ? actionLabel(actions[index - 1]) : "Start"
      },
      dataTypes: { source_url: "url", checkpoint: "text", recorded_action: "text" },
      dataWires: [],
      subscriptions: []
    };
  });
  const transitions = actions.map((action, index) => ({
    id: transitionId(index),
    from: stateId(index),
    to: stateId(index + 1),
    label: actionLabel(action),
    condition: "",
    triggerType: "timer",
    triggerEvent: "",
    timerMs: replayDelay(action),
    set: {},
    groupEntryId: "",
    groupExitId: ""
  }));
  const model = validateCompiledModel({
    version: 2,
    name: String(options.name || `Website-Ablauf: ${host}`),
    initial: stateId(0),
    boundary: { entryId: stateId(0), exitId: stateId(states.length - 1), entryDisabled: false, exitDisabled: false, title: "", note: "" },
    states,
    transitions
  });
  const steps = actions.map((action, index) => ({
    id: `step_${String(index + 1).padStart(3, "0")}`,
    transitionId: transitionId(index),
    fromStateId: stateId(index),
    toStateId: stateId(index + 1),
    delayMs: replayDelay(action),
    action: publicAction(action, index),
    checkpoint: { ...snapshots[index + 1].checkpoint }
  }));
  const recordingPackage = {
    schema: RECORDING_SCHEMA,
    id: recording.id,
    startUrl: recording.startUrl,
    createdAt: recording.createdAt,
    viewport: { ...recording.viewport },
    initialStateId: stateId(0),
    initialCheckpoint: { ...snapshots[0].checkpoint },
    steps,
    snapshotCount: snapshots.length
  };
  validateRecordingPackage(recordingPackage, model);
  return {
    definition: {
      kind: "state-blueprint-definition",
      schemaVersion: 2,
      app: "Zustand",
      savedAt: new Date().toISOString(),
      model,
      stateTemplates: [],
      camera: { x: 0, y: 0, scale: 1 },
      previewCollapsed: false
    },
    recording: recordingPackage
  };
}

function validateRecordingPackage(recording, model) {
  if (recording?.schema !== RECORDING_SCHEMA) throw recorderError("recording_schema_invalid", "Unbekannter Recording-Contract.", 422);
  const states = Array.isArray(model?.states) ? model.states : [];
  const transitions = new Map((model?.transitions || []).map(item => [item.id, item]));
  const steps = Array.isArray(recording.steps) ? recording.steps : [];
  if (recording.initialStateId !== model?.initial || states.length !== steps.length + 1 || Number(recording.snapshotCount) !== states.length) {
    throw recorderError("recording_bijection_invalid", "Recording und State-Kette müssen dieselbe Länge und denselben Start besitzen.", 422);
  }
  const seenTransitions = new Set();
  const seenSteps = new Set();
  let currentStateId = recording.initialStateId;
  for (const step of steps) {
    if (!step.id || !step.transitionId || seenSteps.has(step.id) || seenTransitions.has(step.transitionId) || step.fromStateId !== currentStateId) {
      throw recorderError("recording_bijection_invalid", "Recording-Schritte müssen eine eindeutige, lückenlose Transitionenkette bilden.", 422);
    }
    const transition = transitions.get(step.transitionId);
    if (!transition || transition.from !== step.fromStateId || transition.to !== step.toStateId) throw recorderError("recording_transition_mismatch", "Recording und State-Chart stimmen nicht überein.", 422);
    seenSteps.add(step.id);
    seenTransitions.add(step.transitionId);
    currentStateId = step.toStateId;
  }
  if (seenTransitions.size !== transitions.size || currentStateId !== model?.boundary?.exitId) {
    throw recorderError("recording_bijection_invalid", "Jede Transition muss genau einen Recording-Schritt besitzen und am Flow-Ausgang enden.", 422);
  }
  validateReplayPackage(recording);
  return recording;
}

function validateReplayPackage(recording) {
  if (recording?.schema !== RECORDING_SCHEMA || !recording.initialStateId || !recording.initialCheckpoint?.fingerprint) {
    throw recorderError("recording_schema_invalid", "Replay-Paket verletzt den Recording-Contract.", 422);
  }
  const steps = Array.isArray(recording.steps) ? recording.steps : [];
  if (steps.length > MAX_ACTIONS) throw recorderError("recorder_action_limit", `Maximal ${MAX_ACTIONS} Aktionen pro Replay.`, 413);
  if (Number(recording.snapshotCount) !== steps.length + 1) throw recorderError("recording_bijection_invalid", "Replay-Paket benötigt genau einen Zielzustand je Aktion.", 422);
  const stepIds = new Set();
  const transitionIds = new Set();
  const stateIds = new Set([recording.initialStateId]);
  let currentStateId = recording.initialStateId;
  for (const step of steps) {
    if (!step?.id || !step.transitionId || stepIds.has(step.id) || transitionIds.has(step.transitionId) || step.fromStateId !== currentStateId || !step.toStateId || stateIds.has(step.toStateId) || !step.checkpoint?.fingerprint || !step.action?.type) {
      throw recorderError("recording_bijection_invalid", "Replay-Schritte müssen eine eindeutige, lückenlose Kette bilden.", 422);
    }
    if (!["click", "input", "key", "scroll", "navigate"].includes(step.action.type)) throw recorderError("invalid_recorder_action", "Replay-Paket enthält eine unbekannte Aktion.", 422);
    stepIds.add(step.id);
    transitionIds.add(step.transitionId);
    stateIds.add(step.toStateId);
    currentStateId = step.toStateId;
  }
  return recording;
}

function createRecorderManager(options = {}) {
  const now = options.now || Date.now;
  const lookup = options.lookup || dns.promises.lookup.bind(dns.promises);
  const ttlMs = Math.max(60_000, Number(options.ttlMs) || DEFAULT_TTL_MS);
  const maxSessions = Math.max(1, Number(options.maxSessions) || 4);
  const maxSessionsPerClient = Math.max(1, Number(options.maxSessionsPerClient) || 1);
  const viewport = {
    width: Math.max(640, Math.min(1600, Number(options.viewport?.width) || DEFAULT_VIEWPORT.width)),
    height: Math.max(480, Math.min(1200, Number(options.viewport?.height) || DEFAULT_VIEWPORT.height))
  };
  const sessions = new Map();
  let browserPromise = null;

  async function browser() {
    if (!browserPromise) {
      const launch = options.launchBrowser || (async () => {
        const { chromium } = require("playwright");
        return chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
      });
      browserPromise = Promise.resolve().then(launch).catch(error => { browserPromise = null; throw error; });
    }
    return browserPromise;
  }

  async function closeContext(context) {
    await context?.close?.().catch(() => {});
  }

  async function closeSession(session) {
    await closeContext(session?.context);
    await closeContext(session?.replay?.context);
    if (session) {
      session.context = null;
      session.page = null;
      session.replay = null;
    }
  }

  async function cleanup() {
    const cutoff = now() - ttlMs;
    for (const [id, session] of sessions) {
      if (session.touchedAt >= cutoff) continue;
      sessions.delete(id);
      await closeSession(session);
    }
  }

  const cleanupTimer = setInterval(() => void cleanup(), Math.min(60_000, Math.max(15_000, ttlMs / 4)));
  cleanupTimer.unref?.();

  function getSession(id) {
    const session = sessions.get(String(id || ""));
    if (!session) throw recorderError("recorder_session_not_found", "Recorder-Session nicht gefunden oder abgelaufen.", 404);
    session.touchedAt = now();
    return session;
  }

  async function guardPage(page) {
    await page.routeWebSocket("**", websocket => websocket.close({ code: 1008, reason: "Recorder network isolation" }));
    await page.route("**/*", async route => {
      const raw = route.request().url();
      let protocol = "";
      try { protocol = new URL(raw).protocol; } catch (_) {}
      if (["data:", "blob:", "about:"].includes(protocol)) return route.continue();
      try { await validatePublicUrl(raw, { lookup }); await route.continue(); }
      catch (_) { await route.abort("blockedbyclient"); }
    });
    page.on("dialog", dialog => void dialog.dismiss().catch(() => {}));
  }

  async function snapshot(page, index, atMs) {
    const image = await page.screenshot({ type: "jpeg", quality: 48, fullPage: false });
    return {
      index,
      atMs: Math.max(0, Math.round(Number(atMs) || 0)),
      url: page.url(),
      image: `data:image/jpeg;base64,${image.toString("base64")}`,
      checkpoint: await pageCheckpoint(page)
    };
  }

  function publicState(session, current = session.recording.snapshots.at(-1) || null) {
    return {
      sessionId: session.id,
      status: session.status,
      actionCount: session.recording.actions.length,
      snapshotCount: session.recording.snapshots.length,
      viewport,
      current
    };
  }

  async function startSession(inputUrl, clientKey = "unknown") {
    await cleanup();
    const key = String(clientKey || "unknown").slice(0, 160);
    for (const [id, previous] of sessions) {
      if (previous.clientKey !== key || previous.status === "recording") continue;
      sessions.delete(id);
      await closeSession(previous);
    }
    const active = [...sessions.values()];
    if (active.length >= maxSessions) throw recorderError("recorder_capacity", "Der Recorder ist gerade ausgelastet.", 429);
    if (active.filter(item => item.clientKey === key).length >= maxSessionsPerClient) throw recorderError("recorder_client_capacity", "Für diesen Client läuft bereits eine Aufnahme.", 429);
    const startUrl = await validatePublicUrl(inputUrl, { lookup });
    const context = await (await browser()).newContext({ viewport, ignoreHTTPSErrors: false, javaScriptEnabled: true, serviceWorkers: "block" });
    const page = await context.newPage();
    await guardPage(page);
    const startedAt = now();
    const session = {
      id: crypto.randomUUID(), clientKey: key, status: "recording", context, page, replay: null,
      startedAt, lastActionAt: startedAt, touchedAt: startedAt, compiled: null,
      recording: { id: crypto.randomUUID(), startUrl, createdAt: new Date(startedAt).toISOString(), viewport: { ...viewport }, actions: [], snapshots: [] }
    };
    sessions.set(session.id, session);
    try {
      await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
      await settle(page);
      const current = await snapshot(page, 1, 0);
      session.recording.snapshots.push(current);
      return publicState(session, current);
    } catch (error) {
      sessions.delete(session.id);
      await closeSession(session);
      throw recorderError("recorder_navigation_failed", `Website konnte nicht geöffnet werden: ${error.message}`, 422);
    }
  }

  function beginAction(session, base) {
    if (session.status !== "recording" || !session.page) throw recorderError("recorder_not_recording", "Die Aufnahme ist nicht aktiv.", 409);
    if (session.recording.actions.length >= MAX_ACTIONS) throw recorderError("recorder_action_limit", `Maximal ${MAX_ACTIONS} Aktionen pro Aufnahme.`, 413);
    const at = now();
    const action = { ...base, index: session.recording.actions.length + 1, atMs: at - session.startedAt, delayMs: at - session.lastActionAt };
    session.lastActionAt = at;
    session.touchedAt = at;
    return action;
  }

  async function performAction(id, payload = {}) {
    const session = getSession(id);
    const page = session.page;
    const type = String(payload.type || "");
    let action;
    if (type === "click") {
      const x = Math.max(0, Math.min(viewport.width - 1, Math.round(Number(payload.x) || 0)));
      const y = Math.max(0, Math.min(viewport.height - 1, Math.round(Number(payload.y) || 0)));
      const locator = await targetAt(page, x, y).catch(() => ({}));
      action = beginAction(session, { type, x, y, locator });
      await page.mouse.click(x, y);
    } else if (type === "input") {
      const value = String(payload.value ?? payload.text ?? "").slice(0, 4000);
      const locator = await focusedTarget(page).catch(() => ({}));
      const redacted = locator.inputType === "password";
      action = beginAction(session, { type, locator, redacted, ...(redacted ? { secretRef: `step_${session.recording.actions.length + 1}` } : { value }) });
      await page.keyboard.insertText(value);
    } else if (type === "key") {
      const key = String(payload.key || "");
      if (!new Set(["Enter", "Tab", "Escape", "Backspace", "Delete", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]).has(key)) throw recorderError("invalid_recorder_key", "Diese Taste wird nicht unterstützt.");
      action = beginAction(session, { type, key, locator: await focusedTarget(page).catch(() => ({})) });
      await page.keyboard.press(key);
    } else if (type === "scroll") {
      const deltaX = Math.max(-4000, Math.min(4000, Math.round(Number(payload.deltaX) || 0)));
      const deltaY = Math.max(-4000, Math.min(4000, Math.round(Number(payload.deltaY) || 0)));
      action = beginAction(session, { type, deltaX, deltaY });
      await page.mouse.wheel(deltaX, deltaY);
    } else if (type === "navigate") {
      const url = await validatePublicUrl(payload.url, { lookup });
      action = beginAction(session, { type, url });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
    } else {
      throw recorderError("invalid_recorder_action", "Unbekannte Recorder-Aktion.");
    }
    session.recording.actions.push(action);
    await settle(page);
    const current = await snapshot(page, session.recording.snapshots.length + 1, action.atMs);
    session.recording.snapshots.push(current);
    return publicState(session, current);
  }

  async function finishSession(id) {
    const session = getSession(id);
    if (!session.compiled) session.compiled = compileRecording(session.recording);
    session.status = "finished";
    await closeContext(session.context);
    session.context = null;
    session.page = null;
    return { ...publicState(session), ...session.compiled };
  }

  async function locate(page, locator) {
    if (locator?.testId) return page.getByTestId(locator.testId).first();
    if (locator?.role && locator?.name) return page.getByRole(locator.role, { name: locator.name, exact: true }).first();
    if (locator?.id) return page.locator(`#${String(locator.id).replace(/([ #;.?+*~':"!^$[\]()=>|/@])/g, "\\$1")}`).first();
    if (locator?.css) return page.locator(locator.css).first();
    return null;
  }

  async function applyAction(page, action, secret = "") {
    if (action.type === "click") {
      const target = await locate(page, action.locator);
      if (target) { try { await target.click({ timeout: 5000 }); return; } catch (_) {} }
      await page.mouse.click(Number(action.x) || 0, Number(action.y) || 0);
    } else if (action.type === "input") {
      const value = action.redacted ? String(secret || "") : String(action.value ?? "");
      if (action.redacted && !value) throw recorderError("replay_secret_required", "Für diesen Schritt muss das geschützte Feld erneut eingegeben werden.", 409);
      const target = await locate(page, action.locator);
      if (target) { try { await target.focus({ timeout: 5000 }); } catch (_) {} }
      await page.keyboard.insertText(value);
    } else if (action.type === "key") await page.keyboard.press(String(action.key));
    else if (action.type === "scroll") await page.mouse.wheel(Number(action.deltaX) || 0, Number(action.deltaY) || 0);
    else if (action.type === "navigate") await page.goto(await validatePublicUrl(action.url, { lookup }), { waitUntil: "domcontentloaded", timeout: 25_000 });
  }

  function checkpointMatches(actual, expected) {
    return actual.url === expected.url && actual.fingerprint === expected.fingerprint;
  }

  async function startReplay(id) {
    const session = getSession(id);
    if (!session.compiled) session.compiled = compileRecording(session.recording);
    await closeContext(session.replay?.context);
    const context = await (await browser()).newContext({ viewport, ignoreHTTPSErrors: false, javaScriptEnabled: true, serviceWorkers: "block" });
    try {
      const page = await context.newPage();
      await guardPage(page);
      await page.goto(await validatePublicUrl(session.recording.startUrl, { lookup }), { waitUntil: "domcontentloaded", timeout: 25_000 });
      await settle(page);
      const current = await snapshot(page, 1, 0);
      const expected = session.recording.snapshots[0].checkpoint;
      session.replay = { context, page, index: 0 };
      return { sessionId: id, stateId: stateId(0), index: 0, actionCount: session.recording.actions.length, current, expected, verified: checkpointMatches(current.checkpoint, expected), done: session.recording.actions.length === 0 };
    } catch (error) {
      await closeContext(context);
      throw recorderError("replay_start_failed", `Replay konnte nicht gestartet werden: ${error.message}`, 422);
    }
  }

  async function startPackageReplay(input, clientKey = "unknown") {
    await cleanup();
    const recording = validateReplayPackage(JSON.parse(JSON.stringify(input || {})));
    await validatePublicUrl(recording.startUrl, { lookup });
    const key = String(clientKey || "unknown").slice(0, 160);
    for (const [id, previous] of sessions) {
      if (previous.clientKey !== key || previous.status === "recording") continue;
      sessions.delete(id);
      await closeSession(previous);
    }
    const active = [...sessions.values()];
    if (active.length >= maxSessions) throw recorderError("recorder_capacity", "Der Recorder ist gerade ausgelastet.", 429);
    if (active.filter(item => item.clientKey === key).length >= maxSessionsPerClient) throw recorderError("recorder_client_capacity", "Für diesen Client läuft bereits eine Aufnahme.", 429);
    const id = crypto.randomUUID();
    sessions.set(id, {
      id,
      clientKey: key,
      status: "finished",
      context: null,
      page: null,
      replay: null,
      touchedAt: now(),
      compiled: { recording },
      recording: {
        id: recording.id,
        startUrl: recording.startUrl,
        createdAt: recording.createdAt,
        viewport: { ...recording.viewport },
        actions: recording.steps.map(step => ({ ...step.action, delayMs: step.delayMs })),
        snapshots: [
          { checkpoint: { ...recording.initialCheckpoint } },
          ...recording.steps.map(step => ({ checkpoint: { ...step.checkpoint } }))
        ]
      }
    });
    return startReplay(id);
  }

  async function replayNext(id, payload = {}) {
    const session = getSession(id);
    if (!session.replay?.page) throw recorderError("replay_not_started", "Replay wurde noch nicht gestartet.", 409);
    const { page } = session.replay;
    const index = session.replay.index;
    const action = session.recording.actions[index];
    if (!action) return { done: true, index, stateId: stateId(index), verified: true };
    await applyAction(page, action, payload.secret);
    await settle(page);
    const current = await snapshot(page, index + 2, action.atMs);
    const expected = session.recording.snapshots[index + 1].checkpoint;
    const verified = checkpointMatches(current.checkpoint, expected);
    session.replay.index += 1;
    const done = session.replay.index >= session.recording.actions.length;
    if (done || !verified) {
      await closeContext(session.replay.context);
      session.replay = null;
    }
    return {
      done,
      index: index + 1,
      stepId: `step_${String(index + 1).padStart(3, "0")}`,
      transitionId: transitionId(index),
      stateId: stateId(index + 1),
      current,
      expected,
      verified,
      delayMs: replayDelay(action),
      secretRequired: action.redacted === true
    };
  }

  async function stopReplay(id) {
    const session = getSession(id);
    await closeContext(session.replay?.context);
    session.replay = null;
    return { ok: true };
  }

  async function cancelSession(id) {
    const session = sessions.get(String(id || ""));
    if (!session) return false;
    sessions.delete(session.id);
    await closeSession(session);
    return true;
  }

  async function close() {
    clearInterval(cleanupTimer);
    for (const session of sessions.values()) await closeSession(session);
    sessions.clear();
    const active = await Promise.resolve(browserPromise).catch(() => null);
    browserPromise = null;
    await active?.close?.().catch(() => {});
  }

  return { startSession, performAction, finishSession, startReplay, startPackageReplay, replayNext, stopReplay, cancelSession, getSession, cleanup, close };
}

module.exports = {
  RECORDING_SCHEMA,
  DEFAULT_VIEWPORT,
  isBlockedIp,
  validatePublicUrl,
  pageCheckpoint,
  compileRecording,
  validateRecordingPackage,
  validateReplayPackage,
  createRecorderManager,
  recorderError
};
