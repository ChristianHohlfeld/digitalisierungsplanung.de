"use strict";

const crypto = require("node:crypto");
const { chromium } = require("playwright");
const { compileRecordingToDefinition } = require("./external-recorder");
const { createRecording, normalizeAction, normalizeUrl, targetRecorderScript } = require("./native-browser-recorder");

const DEFAULT_VIEWPORT = Object.freeze({ width: 1366, height: 820 });
const DEFAULT_MAX_ACTIONS = 200;
const DEFAULT_MAX_SESSIONS = 2;

function recorderError(code, message, statusCode = 400) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

async function snapshot(page, recording, atMs) {
  if (!page || page.isClosed()) return null;
  const image = await page.screenshot({ type: "jpeg", quality: 58, fullPage: false });
  const item = {
    atMs: Math.max(0, Math.round(Number(atMs) || 0)),
    url: page.url(),
    title: await page.title().catch(() => ""),
    image: `data:image/jpeg;base64,${image.toString("base64")}`
  };
  recording.snapshots.push(item);
  return item;
}

function publicState(session) {
  const current = session.recording.snapshots.at(-1) || null;
  return {
    sessionId: session.id,
    status: session.status,
    startUrl: session.recording.startUrl,
    actionCount: session.recording.actions.length,
    snapshotCount: session.recording.snapshots.length,
    current: current ? { atMs: current.atMs, url: current.url, title: current.title } : null,
    createdAt: session.recording.createdAt,
    error: session.error || ""
  };
}

function createLocalNativeManager(options = {}) {
  const viewport = options.viewport || DEFAULT_VIEWPORT;
  const maxActions = Math.max(1, Number(options.maxActions) || DEFAULT_MAX_ACTIONS);
  const maxSessions = Math.max(1, Number(options.maxSessions) || DEFAULT_MAX_SESSIONS);
  const launch = options.launch || (launchOptions => chromium.launch(launchOptions));
  const sessions = new Map();

  async function closeResources(session) {
    await session.context?.close?.().catch(() => {});
    await session.browser?.close?.().catch(() => {});
    session.context = null;
    session.browser = null;
    session.page = null;
  }

  async function startSession(url) {
    const active = [...sessions.values()].filter(item => item.status === "recording");
    if (active.length >= maxSessions) throw recorderError("native_session_limit", "Zu viele parallele Browser-Aufnahmen.", 429);
    const startUrl = normalizeUrl(url);
    const id = crypto.randomUUID();
    const recording = createRecording(startUrl, viewport);
    const startedAt = Date.now();
    const session = {
      id,
      status: "starting",
      recording,
      startedAt,
      lastActionAt: startedAt,
      snapshotQueue: Promise.resolve(),
      browser: null,
      context: null,
      page: null,
      error: ""
    };
    sessions.set(id, session);

    try {
      const browser = await launch({ headless: false, args: ["--disable-dev-shm-usage"] });
      session.browser = browser;
      const context = await browser.newContext({ viewport, ignoreHTTPSErrors: true, javaScriptEnabled: true });
      session.context = context;
      await context.exposeBinding("__stateBlueprintRecord", async (source, payload = {}) => {
        if (session.status !== "recording") return;
        if (session.recording.actions.length >= maxActions) {
          session.error = `Aufnahme-Limit von ${maxActions} Aktionen erreicht.`;
          return;
        }
        const action = normalizeAction(payload, session.recording.actions.length + 1, session.startedAt, session.lastActionAt);
        session.lastActionAt = Date.now();
        session.recording.actions.push(action);
        session.snapshotQueue = session.snapshotQueue.then(async () => {
          await source.page.waitForTimeout(180).catch(() => {});
          await snapshot(source.page, session.recording, action.atMs).catch(error => { session.error = String(error.message || error); });
          session.page = source.page;
        });
      });
      await context.addInitScript(targetRecorderScript());
      context.on("page", page => { session.page = page; });
      browser.on("disconnected", () => {
        if (session.status === "recording") session.status = "browser_closed";
      });
      const page = await context.newPage();
      session.page = page;
      await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(300);
      await snapshot(page, recording, 0);
      session.status = "recording";
      return publicState(session);
    } catch (error) {
      session.status = "failed";
      session.error = String(error.message || error);
      await closeResources(session);
      throw recorderError("native_start_failed", session.error, 500);
    }
  }

  function getSession(id) {
    const session = sessions.get(String(id || ""));
    if (!session) throw recorderError("native_session_not_found", "Aufnahme wurde nicht gefunden.", 404);
    return session;
  }

  function getState(id) {
    return publicState(getSession(id));
  }

  async function finishSession(id) {
    const session = getSession(id);
    if (!["recording", "browser_closed"].includes(session.status)) throw recorderError("native_session_not_recording", "Aufnahme ist nicht aktiv.", 409);
    session.status = "finishing";
    await session.snapshotQueue.catch(() => {});
    if (!session.recording.snapshots.length && session.page && !session.page.isClosed()) await snapshot(session.page, session.recording, Date.now() - session.startedAt).catch(() => {});
    if (!session.recording.snapshots.length) throw recorderError("native_recording_empty", "Aufnahme enthält keinen sichtbaren State.", 422);
    const definition = compileRecordingToDefinition(session.recording, { name: `Website-Ablauf: ${new URL(session.recording.startUrl).hostname}` });
    session.status = "finished";
    await closeResources(session);
    return {
      ...publicState(session),
      definition,
      recording: {
        kind: "state-blueprint-recording-package",
        version: session.recording.version,
        startUrl: session.recording.startUrl,
        createdAt: session.recording.createdAt,
        viewport: session.recording.viewport,
        actions: session.recording.actions.map(action => {
          const copy = { ...action };
          delete copy.target;
          return copy;
        }),
        snapshotCount: session.recording.snapshots.length
      }
    };
  }

  async function cancelSession(id) {
    const session = getSession(id);
    session.status = "cancelled";
    await closeResources(session);
    return publicState(session);
  }

  async function close() {
    await Promise.all([...sessions.values()].map(closeResources));
    sessions.clear();
  }

  return { startSession, getState, getSession, finishSession, cancelSession, close };
}

module.exports = { createLocalNativeManager, publicState, recorderError, snapshot };