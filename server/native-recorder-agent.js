"use strict";

const crypto = require("node:crypto");
const http = require("node:http");
const { URL } = require("node:url");
const { chromium } = require("playwright");
const {
  createRecording,
  normalizeAction,
  normalizeUrl,
  targetRecorderScript
} = require("./native-browser-recorder");

const HOST = process.env.ZUSTAND_RECORDER_HOST || "127.0.0.1";
const PORT = Math.max(1, Number(process.env.ZUSTAND_RECORDER_PORT) || 8799);
const DEFAULT_VIEWPORT = Object.freeze({ width: 1366, height: 820 });
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const ALLOWED_ORIGINS = new Set([
  "https://digitalisierungsplanung.de",
  "https://www.digitalisierungsplanung.de",
  "http://127.0.0.1",
  "http://localhost"
]);

function safeId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function json(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    ...headers
  });
  res.end(body);
}

function originAllowed(origin) {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") return true;
    return ALLOWED_ORIGINS.has(parsed.origin);
  } catch (_) {
    return false;
  }
}

function corsHeaders(req) {
  const origin = String(req.headers.origin || "");
  if (!originAllowed(origin)) return null;
  const headers = {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    "vary": "Origin"
  };
  if (String(req.headers["access-control-request-private-network"] || "").toLowerCase() === "true") {
    headers["access-control-allow-private-network"] = "true";
  }
  return headers;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sanitizeId(value, fallback = "field") {
  const clean = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 54);
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
  return {
    id: base,
    label,
    type: booleanField ? "boolean" : inputType === "number" ? "number" : inputType === "email" ? "email" : inputType === "password" ? "password" : "text",
    property: booleanField ? "checked" : "value",
    path: `states.${stateId}.${base}.${booleanField ? "checked" : "value"}`,
    selector
  };
}

function triggerContextForAction(action = {}) {
  switch (String(action?.type || "")) {
    case "click":
    case "input":
    case "key":
    case "scroll":
      return "interaction";
    case "event":
    case "webhook":
      return "event";
    case "timer":
      return "timer";
    default:
      return "auto";
  }
}

function listenerForAction(action = {}) {
  action = action || {};
  const listener = { type: String(action.type || "auto") || "auto" };
  if (action.selector) listener.selector = String(action.selector);
  if (action.key) listener.key = String(action.key);
  if (action.url) listener.url = String(action.url);
  if (Number.isFinite(Number(action.deltaX))) listener.deltaX = Number(action.deltaX);
  if (Number.isFinite(Number(action.deltaY))) listener.deltaY = Number(action.deltaY);
  if (Number.isFinite(Number(action.x))) listener.x = Number(action.x);
  if (Number.isFinite(Number(action.y))) listener.y = Number(action.y);
  if (action.type === "input") {
    listener.redacted = action.redacted === true;
    if (!listener.redacted && Object.hasOwn(action, "value")) listener.value = action.value;
    if (Object.hasOwn(action, "checked")) listener.checked = Boolean(action.checked);
  }
  return listener;
}

function projectFromRecording(recording, options = {}) {
  const snapshots = Array.isArray(recording?.snapshots) ? recording.snapshots.filter(item => item?.image) : [];
  const actions = Array.isArray(recording?.actions) ? recording.actions.filter(Boolean) : [];
  if (!snapshots.length) throw new Error("Recording has no visual states");
  const host = (() => {
    try { return new URL(recording.startUrl || snapshots[0].url).hostname; } catch (_) { return "Website"; }
  })();
  const stateCount = Math.max(1, actions.length + 1);
  const states = Array.from({ length: stateCount }, (_, index) => {
    const snapshot = snapshots[index] || snapshots[snapshots.length - 1] || {};
    const outgoing = actions[index] || null;
    const id = `state_${String(index + 1).padStart(3, "0")}`;
    const field = fieldFromAction(outgoing, id);
    const actionLabel = outgoing?.target?.label || outgoing?.selector || outgoing?.key || outgoing?.type || "";
    return {
      id,
      title: String(snapshot.title || snapshot.url || actionLabel || `${host} ${index + 1}`).slice(0, 180),
      x: 80 + (index % 4) * 240,
      y: 80 + Math.floor(index / 4) * 150,
      trigger: {
        type: outgoing ? triggerContextForAction(outgoing) : "auto",
        eventName: "",
        timerMs: outgoing?.type === "timer" ? Math.max(0, Number(outgoing.delayMs) || 0) : 0
      },
      fields: field ? [field] : [],
      snapshot: {
        atMs: Math.max(0, Number(snapshot.atMs) || 0),
        url: String(snapshot.url || recording.startUrl || ""),
        title: String(snapshot.title || ""),
        image: String(snapshot.image || "")
      }
    };
  });
  const transitions = actions.map((action, index) => ({
    id: `transition_${String(index + 1).padStart(3, "0")}`,
    from: states[index].id,
    to: states[index + 1].id,
    label: String(action.target?.label || action.selector || action.key || action.type || "Weiter").slice(0, 140),
    listener: listenerForAction(action),
    rules: { join: "and", items: [] },
    replay: { delayMs: Math.max(0, Math.round(Number(action.delayMs) || 0)) }
  }));
  return {
    kind: "zustand-project",
    version: 1,
    id: options.id || safeId("project"),
    name: String(options.name || `Recording · ${host}`),
    createdAt: options.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startStateId: states[0].id,
    states,
    transitions,
    recording: {
      startUrl: String(recording.startUrl || ""),
      viewport: { ...(recording.viewport || DEFAULT_VIEWPORT) },
      actions: actions.map(action => ({ ...action })),
      snapshotCount: snapshots.length
    }
  };
}

async function snapshot(page, recording, atMs) {
  const image = await page.screenshot({ type: "jpeg", quality: 58, fullPage: false });
  recording.snapshots.push({
    atMs: Math.max(0, Math.round(Number(atMs) || 0)),
    url: page.url(),
    title: await page.title().catch(() => ""),
    image: `data:image/jpeg;base64,${image.toString("base64")}`
  });
}

async function clickAction(page, action) {
  if (action.selector) {
    const locator = page.locator(action.selector).first();
    if (await locator.count().catch(() => 0)) {
      await locator.click({ timeout: 5000 }).catch(() => null);
      return;
    }
  }
  if (Number.isFinite(Number(action.x)) && Number.isFinite(Number(action.y))) {
    await page.mouse.click(Number(action.x), Number(action.y));
  }
}

async function inputAction(page, action, secrets = {}) {
  const selector = String(action.selector || "");
  if (!selector) return;
  const locator = page.locator(selector).first();
  if (!(await locator.count().catch(() => 0))) return;
  const secret = action.redacted ? secrets[selector] : undefined;
  if (action.redacted && secret === undefined) {
    const error = new Error(`Secret required for ${selector}`);
    error.code = "secret_required";
    error.selector = selector;
    throw error;
  }
  if (Object.hasOwn(action, "checked")) {
    if (action.checked) await locator.check({ timeout: 5000 });
    else await locator.uncheck({ timeout: 5000 });
    return;
  }
  await locator.fill(String(action.redacted ? secret : action.value ?? ""), { timeout: 5000 });
}

async function replayAction(page, action, secrets) {
  switch (String(action.type || "")) {
    case "click": await clickAction(page, action); break;
    case "input": await inputAction(page, action, secrets); break;
    case "key": {
      if (action.selector) {
        const locator = page.locator(action.selector).first();
        if (await locator.count().catch(() => 0)) await locator.press(String(action.key || "Enter"));
        else await page.keyboard.press(String(action.key || "Enter"));
      } else await page.keyboard.press(String(action.key || "Enter"));
      break;
    }
    case "scroll": await page.mouse.wheel(Number(action.deltaX) || 0, Number(action.deltaY) || 0); break;
    case "navigate": if (action.url) await page.goto(String(action.url), { waitUntil: "domcontentloaded", timeout: 30000 }); break;
    default: break;
  }
}

function createAgent(options = {}) {
  const recordings = new Map();
  const replays = new Map();
  const launch = options.launch || (launchOptions => chromium.launch(launchOptions));

  async function startRecording(url) {
    const startUrl = normalizeUrl(url);
    const id = safeId("rec");
    const viewport = { ...DEFAULT_VIEWPORT };
    const browser = await launch({ headless: false, args: ["--disable-dev-shm-usage"] });
    const context = await browser.newContext({ viewport, ignoreHTTPSErrors: true });
    const recording = createRecording(startUrl, viewport);
    const startedAt = Date.now();
    let lastActionAt = startedAt;
    let snapshotQueue = Promise.resolve();
    const session = { id, status: "opening", browser, context, page: null, recording, snapshotQueue, error: "" };
    recordings.set(id, session);

    await context.exposeBinding("__stateBlueprintRecord", async (source, payload = {}) => {
      if (session.status !== "recording") return;
      const action = normalizeAction(payload, recording.actions.length + 1, startedAt, lastActionAt);
      lastActionAt = Date.now();
      recording.actions.push(action);
      snapshotQueue = snapshotQueue.then(async () => {
        await source.page.waitForTimeout(180).catch(() => {});
        await snapshot(source.page, recording, action.atMs).catch(() => {});
      });
      session.snapshotQueue = snapshotQueue;
    });
    await context.addInitScript(targetRecorderScript());
    const page = await context.newPage();
    session.page = page;
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(250);
    await snapshot(page, recording, 0);
    session.status = "recording";
    page.on("close", () => {
      if (session.status === "recording") session.status = "browser_closed";
    });
    return summary(session);
  }

  function summary(session) {
    return {
      id: session.id,
      status: session.status,
      actionCount: session.recording?.actions?.length || 0,
      snapshotCount: session.recording?.snapshots?.length || 0,
      url: session.page?.url?.() || session.recording?.startUrl || "",
      error: session.error || ""
    };
  }

  async function finishRecording(id) {
    const session = recordings.get(id);
    if (!session) throw Object.assign(new Error("Recording not found"), { statusCode: 404 });
    session.status = "finishing";
    await session.snapshotQueue.catch(() => {});
    const project = projectFromRecording(session.recording);
    const result = {
      kind: "zustand-recording-package",
      version: 1,
      createdAt: new Date().toISOString(),
      project
    };
    await session.context.close().catch(() => {});
    await session.browser.close().catch(() => {});
    session.status = "finished";
    recordings.delete(id);
    return result;
  }

  async function cancelRecording(id) {
    const session = recordings.get(id);
    if (!session) return false;
    session.status = "cancelled";
    await session.context.close().catch(() => {});
    await session.browser.close().catch(() => {});
    recordings.delete(id);
    return true;
  }

  async function startReplay(project, options = {}) {
    if (!project?.recording?.startUrl || !Array.isArray(project.recording.actions)) throw new Error("Project has no replay recording");
    const id = safeId("replay");
    const replay = { id, status: "opening", currentAction: 0, actionCount: project.recording.actions.length, error: "", browser: null, context: null };
    replays.set(id, replay);
    void (async () => {
      try {
        const browser = await launch({ headless: false, args: ["--disable-dev-shm-usage"] });
        replay.browser = browser;
        const context = await browser.newContext({ viewport: project.recording.viewport || DEFAULT_VIEWPORT, ignoreHTTPSErrors: true });
        replay.context = context;
        const page = await context.newPage();
        await page.goto(project.recording.startUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        replay.status = "running";
        const speed = Math.max(0.1, Math.min(8, Number(options.speed) || 1));
        const secrets = options.secrets && typeof options.secrets === "object" ? options.secrets : {};
        for (let index = 0; index < project.recording.actions.length; index += 1) {
          if (replay.status === "cancelled") break;
          const action = project.recording.actions[index];
          const delay = Math.min(30000, Math.max(0, Number(action.delayMs) || 0) / speed);
          if (delay) await page.waitForTimeout(delay);
          await replayAction(page, action, secrets);
          replay.currentAction = index + 1;
          await page.waitForTimeout(120).catch(() => {});
        }
        if (replay.status !== "cancelled") replay.status = "finished";
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
      } catch (error) {
        replay.status = "failed";
        replay.error = error.code === "secret_required" ? `Secret required: ${error.selector}` : String(error.message || error);
        await replay.context?.close().catch(() => {});
        await replay.browser?.close().catch(() => {});
      }
    })();
    return { id, status: replay.status, currentAction: 0, actionCount: replay.actionCount };
  }

  async function cancelReplay(id) {
    const replay = replays.get(id);
    if (!replay) return false;
    replay.status = "cancelled";
    await replay.context?.close().catch(() => {});
    await replay.browser?.close().catch(() => {});
    return true;
  }

  function replaySummary(id) {
    const replay = replays.get(id);
    if (!replay) return null;
    return { id, status: replay.status, currentAction: replay.currentAction, actionCount: replay.actionCount, error: replay.error || "" };
  }

  return { recordings, replays, startRecording, finishRecording, cancelRecording, startReplay, cancelReplay, replaySummary, summary };
}

function createHttpServer(agent = createAgent()) {
  return http.createServer(async (req, res) => {
    const headers = corsHeaders(req);
    if (!headers) return json(res, 403, { error: "origin_forbidden" });
    if (req.method === "OPTIONS") {
      res.writeHead(204, headers);
      return res.end();
    }
    try {
      const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
      const parts = url.pathname.split("/").filter(Boolean);
      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, { ok: true, name: "zustand-native-recorder", version: 1 }, headers);
      }
      if (req.method === "POST" && url.pathname === "/recordings") {
        const body = await readJson(req);
        return json(res, 201, await agent.startRecording(body.url), headers);
      }
      if (parts[0] === "recordings" && parts[1]) {
        const session = agent.recordings.get(parts[1]);
        if (req.method === "GET" && parts.length === 2) {
          if (!session) return json(res, 404, { error: "recording_not_found" }, headers);
          return json(res, 200, agent.summary(session), headers);
        }
        if (req.method === "POST" && parts[2] === "finish") {
          return json(res, 200, await agent.finishRecording(parts[1]), headers);
        }
        if (req.method === "DELETE" && parts.length === 2) {
          await agent.cancelRecording(parts[1]);
          return json(res, 200, { ok: true }, headers);
        }
      }
      if (req.method === "POST" && url.pathname === "/replays") {
        const body = await readJson(req);
        return json(res, 201, await agent.startReplay(body.project, { speed: body.speed, secrets: body.secrets }), headers);
      }
      if (parts[0] === "replays" && parts[1]) {
        if (req.method === "GET") {
          const replay = agent.replaySummary(parts[1]);
          if (!replay) return json(res, 404, { error: "replay_not_found" }, headers);
          return json(res, 200, replay, headers);
        }
        if (req.method === "DELETE") {
          await agent.cancelReplay(parts[1]);
          return json(res, 200, { ok: true }, headers);
        }
      }
      return json(res, 404, { error: "not_found" }, headers);
    } catch (error) {
      return json(res, error.statusCode || 500, { error: error.code || "agent_error", message: String(error.message || error) }, headers);
    }
  });
}

function main() {
  const agent = createAgent();
  const server = createHttpServer(agent);
  server.listen(PORT, HOST, () => {
    console.log(`Zustand Local Recorder Agent: http://${HOST}:${PORT}`);
    console.log("Editor öffnen → App Recorder → URL → Aufnahme starten.");
  });
  const shutdown = async () => {
    for (const id of [...agent.recordings.keys()]) await agent.cancelRecording(id);
    for (const id of [...agent.replays.keys()]) await agent.cancelReplay(id);
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (require.main === module) main();

module.exports = {
  createAgent,
  createHttpServer,
  fieldFromAction,
  listenerForAction,
  originAllowed,
  projectFromRecording,
  triggerContextForAction
};
