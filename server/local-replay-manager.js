"use strict";

const crypto = require("node:crypto");
const { chromium } = require("playwright");
const { normalizeUrl } = require("./native-browser-recorder");
const { actionDelay, applyReplayAction } = require("./local-replay");

const DEFAULT_VIEWPORT = Object.freeze({ width: 1366, height: 820 });

function replaySessionError(code, message, statusCode = 400) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function publicState(session) {
  return {
    sessionId: session.id,
    status: session.status,
    actionCount: session.recording.actions.length,
    currentIndex: session.currentIndex,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt || "",
    url: session.url || "",
    title: session.title || "",
    error: session.error || "",
    result: session.result || null
  };
}

function createReplayManager(options = {}) {
  const launch = options.launch || (launchOptions => chromium.launch(launchOptions));
  const sessions = new Map();

  function get(id) {
    const session = sessions.get(String(id || ""));
    if (!session) throw replaySessionError("replay_session_not_found", "Replay wurde nicht gefunden.", 404);
    return session;
  }

  async function closeResources(session) {
    await session.context?.close?.().catch(() => {});
    await session.browser?.close?.().catch(() => {});
    session.page = null;
    session.context = null;
    session.browser = null;
  }

  async function waitDelay(session, ms) {
    let remaining = Math.max(0, Number(ms) || 0);
    while (remaining > 0) {
      if (session.status === "stopped") throw replaySessionError("replay_stopped", "Replay gestoppt.", 409);
      while (session.status === "paused") {
        await new Promise(resolve => setTimeout(resolve, 80));
        if (session.status === "stopped") throw replaySessionError("replay_stopped", "Replay gestoppt.", 409);
      }
      const chunk = Math.min(100, remaining);
      await new Promise(resolve => setTimeout(resolve, chunk));
      remaining -= chunk;
    }
  }

  async function run(session) {
    try {
      const viewport = session.recording.viewport && Number(session.recording.viewport.width) && Number(session.recording.viewport.height)
        ? { width: Number(session.recording.viewport.width), height: Number(session.recording.viewport.height) }
        : DEFAULT_VIEWPORT;
      session.browser = await launch({ headless: session.headless, args: ["--disable-dev-shm-usage"] });
      session.context = await session.browser.newContext({ viewport, ignoreHTTPSErrors: true, javaScriptEnabled: true });
      session.page = await session.context.newPage();
      await session.page.goto(normalizeUrl(session.recording.startUrl), { waitUntil: "domcontentloaded", timeout: 30_000 });
      session.url = session.page.url();
      session.title = await session.page.title().catch(() => "");

      for (let index = 0; index < session.recording.actions.length; index += 1) {
        if (session.status === "stopped") throw replaySessionError("replay_stopped", "Replay gestoppt.", 409);
        const action = session.recording.actions[index];
        await waitDelay(session, session.skipDelay ? 0 : actionDelay(action));
        while (session.status === "paused") await waitDelay(session, 80);
        await applyReplayAction(session.page, action, { skipDelay: true, secrets: session.secrets });
        await session.page.waitForTimeout(150).catch(() => {});
        session.currentIndex = index + 1;
        session.url = session.page.url();
        session.title = await session.page.title().catch(() => "");
      }

      const image = await session.page.screenshot({ type: "jpeg", quality: 58, fullPage: false });
      session.status = "finished";
      session.finishedAt = new Date().toISOString();
      session.result = {
        ok: true,
        actionCount: session.recording.actions.length,
        url: session.page.url(),
        title: await session.page.title().catch(() => ""),
        image: `data:image/jpeg;base64,${image.toString("base64")}`
      };
    } catch (error) {
      if (session.status !== "stopped") {
        session.status = "failed";
        session.error = String(error.message || error);
      }
      session.finishedAt = new Date().toISOString();
    } finally {
      await closeResources(session);
    }
  }

  async function start(recording, optionsForRun = {}) {
    if (!recording || !Array.isArray(recording.actions) || !recording.startUrl) throw replaySessionError("replay_recording_invalid", "Replay-Paket ist ungültig.");
    const session = {
      id: crypto.randomUUID(),
      recording: JSON.parse(JSON.stringify(recording)),
      headless: optionsForRun.headless === true,
      skipDelay: optionsForRun.skipDelay === true,
      secrets: optionsForRun.secrets && typeof optionsForRun.secrets === "object" ? { ...optionsForRun.secrets } : {},
      status: "running",
      currentIndex: 0,
      startedAt: new Date().toISOString(),
      finishedAt: "",
      url: "",
      title: "",
      error: "",
      result: null,
      browser: null,
      context: null,
      page: null
    };
    sessions.set(session.id, session);
    void run(session);
    return publicState(session);
  }

  function state(id) {
    return publicState(get(id));
  }

  function pause(id) {
    const session = get(id);
    if (session.status !== "running") throw replaySessionError("replay_not_running", "Replay läuft nicht.", 409);
    session.status = "paused";
    return publicState(session);
  }

  function resume(id) {
    const session = get(id);
    if (session.status !== "paused") throw replaySessionError("replay_not_paused", "Replay ist nicht pausiert.", 409);
    session.status = "running";
    return publicState(session);
  }

  async function stop(id) {
    const session = get(id);
    if (["finished", "failed", "stopped"].includes(session.status)) return publicState(session);
    session.status = "stopped";
    session.finishedAt = new Date().toISOString();
    await closeResources(session);
    return publicState(session);
  }

  async function close() {
    await Promise.all([...sessions.values()].map(async session => {
      if (!["finished", "failed", "stopped"].includes(session.status)) session.status = "stopped";
      await closeResources(session);
    }));
    sessions.clear();
  }

  return { close, get, pause, resume, start, state, stop };
}

module.exports = { createReplayManager, publicState, replaySessionError };