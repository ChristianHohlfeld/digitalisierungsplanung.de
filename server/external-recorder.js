"use strict";

const crypto = require("node:crypto");
const dns = require("node:dns");
const net = require("node:net");
const { URL } = require("node:url");
const stateCore = require("../mcp/state-blueprint-core");

const RECORDER_PAGE_PATH = "/recorder.html";
const RECORDER_API_PREFIX = "/recorder/sessions";
const DEFAULT_VIEWPORT = Object.freeze({ width: 1024, height: 640 });
const DEFAULT_SESSION_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 4;
const DEFAULT_MAX_SESSIONS_PER_CLIENT = 1;
const DEFAULT_MAX_ACTIONS = 80;
const DEFAULT_MAX_BODY_BYTES = 128 * 1024;
const DEFAULT_SETTLE_MS = 260;
const MAX_REPLAY_DELAY_MS = 10 * 60 * 1000;
const ALLOWED_POPUP_TARGET_ORIGINS = new Set([
  "https://digitalisierungsplanung.de",
  "https://www.digitalisierungsplanung.de"
]);

function recorderError(code, message, statusCode = 400) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function parseIpv4(address) {
  if (net.isIP(address) !== 4) return null;
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function inIpv4Cidr(value, base, bits) {
  const parsed = parseIpv4(value);
  const parsedBase = parseIpv4(base);
  if (parsed === null || parsedBase === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (parsed & mask) === (parsedBase & mask);
}

function isBlockedIp(address) {
  const value = String(address || "").trim().toLowerCase();
  const family = net.isIP(value);
  if (!family) return true;
  if (family === 4) {
    return [
      ["0.0.0.0", 8],
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["192.168.0.0", 16],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
      ["240.0.0.0", 4]
    ].some(([base, bits]) => inIpv4Cidr(value, base, bits));
  }
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIp(mapped[1]);
  if (value === "::" || value === "::1") return true;
  if (/^(?:fc|fd)[0-9a-f]{2}:/.test(value)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(value)) return true;
  if (/^ff[0-9a-f]{2}:/.test(value)) return true;
  if (/^2001:db8(?::|$)/.test(value)) return true;
  return false;
}

function normalizeLookupResult(result) {
  const values = Array.isArray(result) ? result : [result];
  return values
    .map(item => typeof item === "string" ? item : item?.address)
    .map(value => String(value || "").trim())
    .filter(Boolean);
}

async function validatePublicUrl(input, options = {}) {
  let parsed;
  try {
    parsed = new URL(String(input || "").trim());
  } catch (_) {
    throw recorderError("invalid_url", "A valid absolute URL is required.");
  }
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw recorderError("invalid_url_scheme", "Only http and https URLs can be recorded.");
  }
  if (parsed.username || parsed.password) {
    throw recorderError("url_credentials_forbidden", "Credentials in recorder URLs are not allowed.");
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw recorderError("private_url_forbidden", "Local/private recorder targets are not allowed.", 403);
  }
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) throw recorderError("private_url_forbidden", "Local/private recorder targets are not allowed.", 403);
    return parsed.href;
  }
  const lookup = options.lookup || dns.promises.lookup.bind(dns.promises);
  let resolved;
  try {
    resolved = await lookup(hostname, { all: true, verbatim: true });
  } catch (_) {
    throw recorderError("url_dns_failed", "Recorder target could not be resolved.", 422);
  }
  const addresses = normalizeLookupResult(resolved);
  if (!addresses.length || addresses.some(isBlockedIp)) {
    throw recorderError("private_url_forbidden", "Local/private recorder targets are not allowed.", 403);
  }
  return parsed.href;
}

function actionLabel(action = {}) {
  const target = String(action.target?.label || action.selector || "").trim();
  switch (String(action.type || "")) {
    case "click": return target ? `Klick: ${target}` : "Klick";
    case "input": return action.redacted ? "Eingabe: [geschützt]" : "Eingabe";
    case "key": return `Taste: ${String(action.key || "")}`;
    case "scroll": return "Scroll";
    case "navigate": return `Navigation: ${String(action.url || "")}`;
    default: return "Weiter";
  }
}

function timerDelayMs(action = {}) {
  const value = Number(action.delayMs);
  if (!Number.isFinite(value)) return 300;
  return Math.max(40, Math.min(MAX_REPLAY_DELAY_MS, Math.round(value)));
}

function compileRecordingToDefinition(recording, options = {}) {
  const snapshots = Array.isArray(recording?.snapshots) ? recording.snapshots.filter(item => item?.image) : [];
  if (!snapshots.length) throw recorderError("recording_empty", "Recording contains no visual states.", 422);
  const actions = Array.isArray(recording?.actions) ? recording.actions : [];
  const model = stateCore.blankModel();
  const host = (() => {
    try { return new URL(recording.startUrl || snapshots[0]?.url || "https://example.com").hostname; } catch (_) { return "Website"; }
  })();
  model.name = String(options.name || `Website-Recording: ${host}`);
  const commands = [];
  snapshots.forEach((snapshot, index) => {
    const number = String(index + 1).padStart(3, "0");
    const stateId = `recorded_${number}`;
    const precedingAction = index > 0 ? actions[index - 1] : null;
    const title = String(snapshot.title || snapshot.url || `${host} ${number}`).slice(0, 180);
    commands.push({
      command: "state.create",
      id: stateId,
      title,
      x: 120 + (index % 4) * 240,
      y: 120 + Math.floor(index / 4) * 168,
      components: [
        { id: `c_${stateId}_title`, type: "heading", text: title, url: "" },
        { id: `c_${stateId}_image`, type: "image", text: "", url: String(snapshot.image) }
      ],
      data: {
        source_url: String(snapshot.url || recording.startUrl || ""),
        recorded_action: precedingAction ? actionLabel(precedingAction) : "Start"
      },
      dataTypes: { source_url: "url", recorded_action: "text" }
    });
  });
  for (let index = 0; index < snapshots.length - 1; index += 1) {
    const from = `recorded_${String(index + 1).padStart(3, "0")}`;
    const to = `recorded_${String(index + 2).padStart(3, "0")}`;
    const action = actions[index] || {};
    commands.push({
      command: "transition.create",
      id: `recorded_t_${String(index + 1).padStart(3, "0")}`,
      from,
      to,
      label: actionLabel(action),
      condition: "",
      triggerType: "timer",
      triggerEvent: "",
      timerMs: timerDelayMs(action),
      set: {}
    });
  }
  const workspace = stateCore.normalizeWorkspace({ model, editor: {} });
  const result = stateCore.applyCommands(workspace, commands);
  const validation = stateCore.validateModel(result.workspace.model);
  if (!validation.ok) {
    const error = recorderError("compiled_model_invalid", "Recorded flow did not compile to a valid State Blueprint.", 500);
    error.validation = validation;
    throw error;
  }
  return stateCore.definitionPayload(validation.model, [], result.workspace.editor);
}

function cssSelectorForElementScript() {
  return `el => {
    if (!el || el.nodeType !== 1) return { selector: "", label: "", tag: "", inputType: "" };
    const esc = value => (window.CSS && CSS.escape ? CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&"));
    const label = String(el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.innerText || el.value || el.name || el.id || el.tagName || "").trim().replace(/\\s+/g, " ").slice(0, 100);
    const inputType = el instanceof HTMLInputElement ? String(el.type || "text").toLowerCase() : "";
    if (el.id) return { selector: "#" + esc(el.id), label, tag: el.tagName.toLowerCase(), inputType };
    for (const attr of ["data-testid", "data-test", "name"]) {
      const value = el.getAttribute(attr);
      if (value) return { selector: el.tagName.toLowerCase() + "[" + attr + "=\\\"" + String(value).replace(/\\/g, "\\\\").replace(/\"/g, "\\\"") + "\\\"]", label, tag: el.tagName.toLowerCase(), inputType };
    }
    const parts = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 5; depth += 1, node = node.parentElement) {
      let part = node.tagName.toLowerCase();
      const siblings = node.parentElement ? Array.from(node.parentElement.children).filter(item => item.tagName === node.tagName) : [];
      if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
      parts.unshift(part);
      if (node.id) { parts[0] = "#" + esc(node.id); break; }
    }
    return { selector: parts.join(" > "), label, tag: el.tagName.toLowerCase(), inputType };
  }`;
}

async function targetAt(page, x, y) {
  return page.evaluate(({ x, y, selectorSource }) => {
    const el = document.elementFromPoint(x, y);
    const fn = eval("(" + selectorSource + ")");
    return fn(el);
  }, { x, y, selectorSource: cssSelectorForElementScript() });
}

async function focusedTarget(page) {
  return page.evaluate(selectorSource => {
    const fn = eval("(" + selectorSource + ")");
    return fn(document.activeElement);
  }, cssSelectorForElementScript());
}

async function settlePage(page, ms = DEFAULT_SETTLE_MS) {
  await Promise.race([
    page.waitForLoadState("domcontentloaded", { timeout: Math.max(500, ms * 4) }).catch(() => {}),
    page.waitForTimeout(ms)
  ]);
  await page.waitForTimeout(Math.min(180, ms)).catch(() => {});
}

function normalizedClientKey(value) {
  return String(value || "unknown").trim().slice(0, 160) || "unknown";
}

function createRecorderManager(options = {}) {
  const lookup = options.lookup || dns.promises.lookup.bind(dns.promises);
  const now = options.now || Date.now;
  const ttlMs = Math.max(60_000, Number(options.ttlMs) || DEFAULT_SESSION_TTL_MS);
  const maxSessions = Math.max(1, Number(options.maxSessions) || DEFAULT_MAX_SESSIONS);
  const maxSessionsPerClient = Math.max(1, Number(options.maxSessionsPerClient) || DEFAULT_MAX_SESSIONS_PER_CLIENT);
  const maxActions = Math.max(1, Number(options.maxActions) || DEFAULT_MAX_ACTIONS);
  const viewport = {
    width: Math.max(640, Math.min(1600, Number(options.viewport?.width) || DEFAULT_VIEWPORT.width)),
    height: Math.max(480, Math.min(1200, Number(options.viewport?.height) || DEFAULT_VIEWPORT.height))
  };
  const sessions = new Map();
  let browserPromise = null;

  async function browser() {
    if (!browserPromise) {
      const launcher = options.launchBrowser || (async () => {
        const { chromium } = require("playwright");
        return chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
      });
      browserPromise = Promise.resolve().then(() => launcher()).catch(error => {
        browserPromise = null;
        throw error;
      });
    }
    return browserPromise;
  }

  async function closeSessionResources(session) {
    if (!session?.context) return;
    const context = session.context;
    session.context = null;
    session.page = null;
    await context.close().catch(() => {});
  }

  async function cleanup() {
    const cutoff = now() - ttlMs;
    for (const [id, session] of sessions) {
      if (session.touchedAt >= cutoff) continue;
      sessions.delete(id);
      await closeSessionResources(session);
    }
  }

  const cleanupTimer = setInterval(() => { void cleanup(); }, Math.min(60_000, Math.max(15_000, Math.round(ttlMs / 4))));
  cleanupTimer.unref?.();

  function getSession(id) {
    const session = sessions.get(String(id || ""));
    if (!session) throw recorderError("recorder_session_not_found", "Recorder session not found or expired.", 404);
    session.touchedAt = now();
    return session;
  }

  function activeCountForClient(clientKey) {
    return [...sessions.values()].filter(session => session.clientKey === clientKey && session.status === "recording").length;
  }

  async function guardPage(page) {
    await page.route("**/*", async route => {
      const raw = route.request().url();
      let parsed;
      try { parsed = new URL(raw); } catch (_) { await route.abort("blockedbyclient"); return; }
      if (["data:", "blob:", "about:"].includes(parsed.protocol)) { await route.continue(); return; }
      try {
        await validatePublicUrl(raw, { lookup });
        await route.continue();
      } catch (_) {
        await route.abort("blockedbyclient");
      }
    });
    page.on("dialog", dialog => { void dialog.dismiss().catch(() => {}); });
  }

  async function takeSnapshot(session, atMs = 0) {
    const page = session.page;
    const image = await page.screenshot({ type: "jpeg", quality: 45, fullPage: false });
    const snapshot = {
      index: session.recording.snapshots.length + 1,
      atMs: Math.max(0, Math.round(Number(atMs) || 0)),
      url: page.url(),
      title: await page.title().catch(() => ""),
      image: `data:image/jpeg;base64,${image.toString("base64")}`
    };
    session.recording.snapshots.push(snapshot);
    return snapshot;
  }

  function publicState(session, snapshot = null) {
    const current = snapshot || session.recording.snapshots.at(-1) || null;
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
    const safeClient = normalizedClientKey(clientKey);
    if ([...sessions.values()].filter(session => session.status === "recording").length >= maxSessions) {
      throw recorderError("recorder_capacity", "Recorder capacity is currently full.", 429);
    }
    if (activeCountForClient(safeClient) >= maxSessionsPerClient) {
      throw recorderError("recorder_client_capacity", "This client already has an active recorder session.", 429);
    }
    const safeUrl = await validatePublicUrl(inputUrl, { lookup });
    const instance = await browser();
    const context = await instance.newContext({ viewport, ignoreHTTPSErrors: false, javaScriptEnabled: true });
    const page = await context.newPage();
    await guardPage(page);
    const startedAt = now();
    const session = {
      id: crypto.randomUUID(),
      clientKey: safeClient,
      status: "recording",
      context,
      page,
      startedAt,
      touchedAt: startedAt,
      lastActionAt: startedAt,
      definition: null,
      recording: {
        version: 1,
        startUrl: safeUrl,
        createdAt: new Date(startedAt).toISOString(),
        viewport: { ...viewport },
        actions: [],
        snapshots: []
      }
    };
    sessions.set(session.id, session);
    try {
      await page.goto(safeUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await settlePage(page);
      const snapshot = await takeSnapshot(session, 0);
      return publicState(session, snapshot);
    } catch (error) {
      sessions.delete(session.id);
      await closeSessionResources(session);
      throw recorderError("recorder_navigation_failed", `Could not open recorder target: ${error.message}`, 422);
    }
  }

  function beginAction(session, base) {
    if (session.status !== "recording" || !session.page) throw recorderError("recorder_not_recording", "Recorder session is not active.", 409);
    if (session.recording.actions.length >= maxActions) throw recorderError("recorder_action_limit", `Recorder is limited to ${maxActions} actions per flow.`, 413);
    const at = now();
    const action = {
      ...base,
      index: session.recording.actions.length + 1,
      atMs: Math.max(0, at - session.startedAt),
      delayMs: Math.max(0, at - session.lastActionAt)
    };
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
      const target = await targetAt(page, x, y).catch(() => ({ selector: "", label: "", tag: "", inputType: "" }));
      action = beginAction(session, { type, x, y, selector: target.selector || "", target });
      await page.mouse.click(x, y);
    } else if (type === "input") {
      const text = String(payload.text ?? "").slice(0, 4000);
      const target = await focusedTarget(page).catch(() => ({ selector: "", label: "", tag: "", inputType: "" }));
      const redacted = target.inputType === "password";
      action = beginAction(session, { type, selector: target.selector || "", target, value: redacted ? undefined : text, redacted });
      await page.keyboard.insertText(text);
    } else if (type === "key") {
      const key = String(payload.key || "");
      const allowed = new Set(["Enter", "Tab", "Escape", "Backspace", "Delete", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);
      if (!allowed.has(key)) throw recorderError("invalid_recorder_key", "Unsupported recorder key.");
      const target = await focusedTarget(page).catch(() => ({ selector: "", label: "", tag: "", inputType: "" }));
      action = beginAction(session, { type, key, selector: target.selector || "", target });
      await page.keyboard.press(key);
    } else if (type === "scroll") {
      const deltaX = Math.max(-4000, Math.min(4000, Math.round(Number(payload.deltaX) || 0)));
      const deltaY = Math.max(-4000, Math.min(4000, Math.round(Number(payload.deltaY) || 0)));
      action = beginAction(session, { type, deltaX, deltaY });
      await page.mouse.wheel(deltaX, deltaY);
    } else if (type === "navigate") {
      const url = await validatePublicUrl(payload.url, { lookup });
      action = beginAction(session, { type, url });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    } else {
      throw recorderError("invalid_recorder_action", "Unknown recorder action.");
    }
    session.recording.actions.push(action);
    await settlePage(page);
    const snapshot = await takeSnapshot(session, action.atMs);
    return publicState(session, snapshot);
  }

  async function finishSession(id) {
    const session = getSession(id);
    if (session.status === "recording") {
      session.definition = compileRecordingToDefinition(session.recording);
      session.status = "finished";
      await closeSessionResources(session);
    }
    return {
      ...publicState(session),
      definition: session.definition,
      recording: {
        version: session.recording.version,
        startUrl: session.recording.startUrl,
        createdAt: session.recording.createdAt,
        viewport: session.recording.viewport,
        actions: session.recording.actions.map(action => ({ ...action })),
        snapshotCount: session.recording.snapshots.length
      }
    };
  }

  async function applyReplayAction(page, action) {
    const delay = timerDelayMs(action);
    if (delay > 0) await page.waitForTimeout(delay);
    if (action.type === "click") {
      if (action.selector) {
        try { await page.locator(action.selector).first().click({ timeout: 5000 }); return; } catch (_) {}
      }
      await page.mouse.click(Number(action.x) || 0, Number(action.y) || 0);
      return;
    }
    if (action.type === "input") {
      if (action.redacted || action.value === undefined) throw recorderError("replay_secret_required", "A protected password value was intentionally not stored; replay requires live secret input.", 409);
      if (action.selector) {
        try { await page.locator(action.selector).first().fill(String(action.value), { timeout: 5000 }); return; } catch (_) {}
      }
      await page.keyboard.insertText(String(action.value));
      return;
    }
    if (action.type === "key") { await page.keyboard.press(String(action.key)); return; }
    if (action.type === "scroll") { await page.mouse.wheel(Number(action.deltaX) || 0, Number(action.deltaY) || 0); return; }
    if (action.type === "navigate") {
      const safeUrl = await validatePublicUrl(action.url, { lookup });
      await page.goto(safeUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
    }
  }

  async function replaySession(id) {
    const session = getSession(id);
    const instance = await browser();
    const context = await instance.newContext({ viewport, ignoreHTTPSErrors: false, javaScriptEnabled: true });
    const page = await context.newPage();
    await guardPage(page);
    try {
      await page.goto(await validatePublicUrl(session.recording.startUrl, { lookup }), { waitUntil: "domcontentloaded", timeout: 20_000 });
      for (const action of session.recording.actions) {
        await applyReplayAction(page, action);
        await settlePage(page);
      }
      const image = await page.screenshot({ type: "jpeg", quality: 45, fullPage: false });
      return {
        ok: true,
        actionCount: session.recording.actions.length,
        url: page.url(),
        title: await page.title().catch(() => ""),
        image: `data:image/jpeg;base64,${image.toString("base64")}`
      };
    } finally {
      await context.close().catch(() => {});
    }
  }

  async function cancelSession(id) {
    const session = sessions.get(String(id || ""));
    if (!session) return false;
    sessions.delete(session.id);
    await closeSessionResources(session);
    return true;
  }

  async function close() {
    clearInterval(cleanupTimer);
    for (const session of sessions.values()) await closeSessionResources(session);
    sessions.clear();
    const activeBrowser = await Promise.resolve(browserPromise).catch(() => null);
    browserPromise = null;
    await activeBrowser?.close?.().catch(() => {});
  }

  return { startSession, performAction, finishSession, replaySession, cancelSession, close, cleanup, getSession };
}

function requestClientKey(request) {
  const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || String(request.socket?.remoteAddress || "unknown");
}

function writeJson(response, statusCode, body, headers = {}) {
  const text = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-length": Buffer.byteLength(text),
    ...headers
  });
  response.end(text);
}

function writeHtml(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

async function readJsonBody(request, maxBytes = DEFAULT_MAX_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw recorderError("request_too_large", "Recorder request is too large.", 413);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch (_) { throw recorderError("invalid_json", "Recorder request body must be valid JSON."); }
}

function recorderHtml() {
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Website aufnehmen · Zustand</title>
<style>
:root{color-scheme:dark;--bg:#07111d;--panel:#0b1b2a;--line:#20425f;--text:#e6f2ff;--muted:#9fb6cc;--accent:#38bdf8;--ok:#34d399;--bad:#fb7185}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.4 system-ui,sans-serif}main{width:min(1180px,calc(100% - 24px));margin:auto;padding:18px 0 28px}header{display:flex;gap:14px;align-items:end;justify-content:space-between;margin-bottom:14px}h1{margin:0;font-size:24px}p{margin:4px 0;color:var(--muted)}.panel{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:12px;margin-bottom:12px}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}input,button,select{height:40px;border:1px solid var(--line);border-radius:8px;background:#06111f;color:var(--text);font:inherit;padding:0 10px}input[type=url]{flex:1;min-width:260px}#typeText{flex:1;min-width:180px}button{cursor:pointer;font-weight:800}button.primary{background:#0b3a55;border-color:#23729b}button.good{background:#064e3b;border-color:#15966d}button.danger{background:#5f1721;border-color:#a4384a}button:disabled{opacity:.45;cursor:not-allowed}.viewport{position:relative;display:grid;place-items:center;overflow:auto;min-height:320px;background:#020617;border:1px solid var(--line);border-radius:12px}.viewport img{display:block;max-width:100%;height:auto;cursor:crosshair;user-select:none;-webkit-user-drag:none}.status{font-family:ui-monospace,monospace;color:var(--muted)}.ok{color:var(--ok)}.bad{color:var(--bad)}#after{display:none}.hint{font-size:12px;color:var(--muted)}@media(max-width:680px){header{display:block}.row>*{flex:1}button{min-width:90px}}
</style></head><body><main>
<header><div><h1>Website aufnehmen</h1><p>Beliebige öffentliche URL durchklicken → States + echte Timer-Transitionen.</p></div><div class="status" id="status">Bereit</div></header>
<section class="panel"><div class="row"><input id="url" type="url" autocomplete="url" placeholder="https://example.com"><button class="primary" id="start">Aufnahme starten</button></div><div class="hint">Private/localhost/Metadata-Netze sind serverseitig gesperrt. Passwortwerte werden nie gespeichert.</div></section>
<section class="panel" id="controls" hidden><div class="row"><input id="typeText" type="text" autocomplete="off" placeholder="Text in fokussiertes Feld schreiben"><button id="type">Text senden</button><select id="key"><option>Enter</option><option>Tab</option><option>Escape</option><option>Backspace</option><option>ArrowDown</option><option>ArrowUp</option></select><button id="sendKey">Taste</button><button id="up">↑ Scroll</button><button id="down">↓ Scroll</button><button class="good" id="finish">Fertig → States</button><button class="danger" id="cancel">Abbrechen</button></div></section>
<section class="viewport" id="viewport"><div class="status">URL eingeben und Aufnahme starten.</div></section>
<section class="panel" id="after"><div class="row"><button class="good" id="import">In Zustand übernehmen</button><button id="replay">Original-Website automatisch replayen</button><button id="download">JSON laden</button></div><div class="hint" id="summary"></div></section>
</main><script>
const q=new URLSearchParams(location.search);const allowed=new Set(["https://digitalisierungsplanung.de","https://www.digitalisierungsplanung.de"]);const targetOrigin=allowed.has(q.get("targetOrigin"))?q.get("targetOrigin"):"https://digitalisierungsplanung.de";
const status=document.getElementById("status"),viewport=document.getElementById("viewport"),controls=document.getElementById("controls"),after=document.getElementById("after");let session=null,definition=null;
function setStatus(text,ok=true){status.textContent=text;status.className="status "+(ok?"ok":"bad")}
async function api(path,body,method="POST"){const r=await fetch(path,{method,headers:{"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),cache:"no-store"});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.message||data.error||("HTTP "+r.status));return data}
function render(data){session=data.sessionId||session;const shot=data.current;if(!shot?.image)return;viewport.innerHTML="";const img=new Image();img.src=shot.image;img.alt=shot.title||shot.url||"Website";img.dataset.w=String(data.viewport?.width||1024);img.dataset.h=String(data.viewport?.height||640);img.addEventListener("click",async e=>{if(!session)return;const r=img.getBoundingClientRect();const x=Math.round((e.clientX-r.left)/r.width*Number(img.dataset.w));const y=Math.round((e.clientY-r.top)/r.height*Number(img.dataset.h));try{setStatus("Klick …");render(await api("/recorder/sessions/"+encodeURIComponent(session)+"/actions",{type:"click",x,y}));setStatus("Aufnahme · "+(data.actionCount+1)+" Aktionen")}catch(err){setStatus(err.message,false)}});viewport.appendChild(img)}
document.getElementById("start").onclick=async()=>{try{setStatus("Öffne Browser …");const data=await api("/recorder/sessions",{url:document.getElementById("url").value});render(data);controls.hidden=false;setStatus("Aufnahme läuft")}catch(err){setStatus(err.message,false)}};
document.getElementById("type").onclick=async()=>{try{const el=document.getElementById("typeText");render(await api("/recorder/sessions/"+encodeURIComponent(session)+"/actions",{type:"input",text:el.value}));el.value="";setStatus("Eingabe aufgenommen")}catch(err){setStatus(err.message,false)}};
document.getElementById("sendKey").onclick=async()=>{try{render(await api("/recorder/sessions/"+encodeURIComponent(session)+"/actions",{type:"key",key:document.getElementById("key").value}));setStatus("Taste aufgenommen")}catch(err){setStatus(err.message,false)}};
for(const [id,dy] of [["up",-520],["down",520]])document.getElementById(id).onclick=async()=>{try{render(await api("/recorder/sessions/"+encodeURIComponent(session)+"/actions",{type:"scroll",deltaY:dy,deltaX:0}));setStatus("Scroll aufgenommen")}catch(err){setStatus(err.message,false)}};
document.getElementById("finish").onclick=async()=>{try{setStatus("Kompiliere States …");const data=await api("/recorder/sessions/"+encodeURIComponent(session)+"/finish",{});definition=data.definition;controls.hidden=true;after.style.display="block";document.getElementById("summary").textContent=data.recording.actions.length+" Aktionen · "+data.recording.snapshotCount+" States · Timer-Timings übernommen";setStatus("FSM erzeugt");}catch(err){setStatus(err.message,false)}};
document.getElementById("import").onclick=()=>{if(!definition)return;window.opener?.postMessage({type:"STATE_BLUEPRINT_EXTERNAL_RECORDING_RESULT",definition,sessionId:session},targetOrigin);setStatus("An Zustand übergeben")};
document.getElementById("replay").onclick=async()=>{try{setStatus("Replay läuft …");const data=await api("/recorder/sessions/"+encodeURIComponent(session)+"/replay",{});viewport.innerHTML='<img alt="Replay result" style="max-width:100%" src="'+data.image+'">';setStatus("Replay: "+data.actionCount+" Aktionen")}catch(err){setStatus(err.message,false)}};
document.getElementById("download").onclick=()=>{if(!definition)return;const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(definition,null,2)],{type:"application/json"}));a.download="website-recording.json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
document.getElementById("cancel").onclick=async()=>{if(session)await api("/recorder/sessions/"+encodeURIComponent(session),undefined,"DELETE").catch(()=>{});window.close()};
</script></body></html>`;
}

function matchesRecorderPath(pathname) {
  return pathname === RECORDER_PAGE_PATH || pathname === RECORDER_API_PREFIX || pathname.startsWith(`${RECORDER_API_PREFIX}/`);
}

function originAllowed(request, allowedOrigins, publicBaseUrl) {
  const origin = String(request.headers.origin || "");
  if (!origin) return true;
  if (origin === publicBaseUrl) return true;
  return new Set(allowedOrigins || []).has("*") || new Set(allowedOrigins || []).has(origin);
}

async function handleRecorderRequest(request, response, url, options = {}) {
  const manager = options.manager;
  if (!manager) throw new Error("Recorder manager is required.");
  const publicBaseUrl = String(options.publicBaseUrl || "");
  if (!originAllowed(request, options.allowedOrigins, publicBaseUrl)) {
    writeJson(response, 403, { error: "origin_not_allowed", message: "Origin is not allowed." });
    return;
  }
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "cache-control": "no-store",
      "access-control-allow-origin": String(request.headers.origin || publicBaseUrl || "*"),
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-headers": "content-type",
      "vary": "Origin"
    });
    response.end();
    return;
  }
  try {
    if (request.method === "GET" && url.pathname === RECORDER_PAGE_PATH) {
      writeHtml(response, 200, recorderHtml());
      return;
    }
    if (request.method === "POST" && url.pathname === RECORDER_API_PREFIX) {
      const body = await readJsonBody(request);
      writeJson(response, 201, await manager.startSession(body.url, requestClientKey(request)));
      return;
    }
    const match = url.pathname.match(/^\/recorder\/sessions\/([0-9a-f-]+)(?:\/(actions|finish|replay))?$/i);
    if (!match) {
      writeJson(response, 404, { error: "recorder_route_not_found" });
      return;
    }
    const [, id, action] = match;
    if (request.method === "POST" && action === "actions") {
      writeJson(response, 200, await manager.performAction(id, await readJsonBody(request)));
      return;
    }
    if (request.method === "POST" && action === "finish") {
      writeJson(response, 200, await manager.finishSession(id));
      return;
    }
    if (request.method === "POST" && action === "replay") {
      writeJson(response, 200, await manager.replaySession(id));
      return;
    }
    if (request.method === "DELETE" && !action) {
      await manager.cancelSession(id);
      writeJson(response, 200, { ok: true });
      return;
    }
    writeJson(response, 405, { error: "method_not_allowed" });
  } catch (error) {
    writeJson(response, Number(error.statusCode) || 500, {
      error: String(error.code || "recorder_failed"),
      message: String(error.message || "Recorder request failed.")
    });
  }
}

module.exports = {
  RECORDER_PAGE_PATH,
  RECORDER_API_PREFIX,
  DEFAULT_VIEWPORT,
  isBlockedIp,
  validatePublicUrl,
  compileRecordingToDefinition,
  createRecorderManager,
  recorderHtml,
  matchesRecorderPath,
  handleRecorderRequest,
  ALLOWED_POPUP_TARGET_ORIGINS
};
