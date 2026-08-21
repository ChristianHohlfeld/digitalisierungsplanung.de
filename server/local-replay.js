"use strict";

const { chromium } = require("playwright");
const { normalizeUrl } = require("./native-browser-recorder");

const MAX_DELAY_MS = 10 * 60 * 1000;
const DEFAULT_VIEWPORT = Object.freeze({ width: 1366, height: 820 });

function replayError(code, message, statusCode = 400) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function actionDelay(action) {
  const value = Number(action?.delayMs);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_DELAY_MS, Math.round(value)));
}

function valueForAction(action, secrets = {}) {
  if (action?.redacted !== true) return String(action?.value ?? action?.text ?? "");
  const byIndex = secrets[String(action?.index || "")];
  if (typeof byIndex === "string") return byIndex;
  const bySelector = action?.selector ? secrets[String(action.selector)] : undefined;
  if (typeof bySelector === "string") return bySelector;
  throw replayError(
    "replay_secret_required",
    `Geschützte Eingabe ${action?.selector || `#${action?.index || "?"}`} benötigt einen lokal hinterlegten Secret-Wert.`,
    422
  );
}

async function clickTarget(page, action) {
  if (action.selector) {
    try {
      await page.locator(action.selector).first().click({ timeout: 5000 });
      return;
    } catch (_) {}
  }
  if (Number.isFinite(Number(action.x)) && Number.isFinite(Number(action.y))) {
    await page.mouse.click(Number(action.x), Number(action.y));
    return;
  }
  throw replayError("replay_click_target_missing", "Klick-Ziel ist nicht mehr auffindbar.", 422);
}

async function inputTarget(page, action, secrets) {
  const value = valueForAction(action, secrets);
  if (action.selector) {
    const target = page.locator(action.selector).first();
    try {
      await target.fill(value, { timeout: 5000 });
      return;
    } catch (_) {
      try {
        await target.click({ timeout: 2000 });
        await page.keyboard.press("ControlOrMeta+A").catch(() => {});
        await page.keyboard.type(value);
        return;
      } catch (_) {}
    }
  }
  await page.keyboard.type(value);
}

async function applyReplayAction(page, action, options = {}) {
  const delay = options.skipDelay === true ? 0 : actionDelay(action);
  if (delay > 0) await page.waitForTimeout(delay);
  const type = String(action?.type || "");

  if (type === "click") return clickTarget(page, action);
  if (type === "input") return inputTarget(page, action, options.secrets || {});
  if (type === "key") {
    if (!action.key) throw replayError("replay_key_missing", "Aufgezeichnete Taste fehlt.", 422);
    if (action.selector) {
      try {
        await page.locator(action.selector).first().press(String(action.key), { timeout: 5000 });
        return;
      } catch (_) {}
    }
    await page.keyboard.press(String(action.key));
    return;
  }
  if (type === "scroll") {
    await page.mouse.wheel(Number(action.deltaX) || 0, Number(action.deltaY) || 0);
    return;
  }
  if (type === "navigate") {
    await page.goto(normalizeUrl(action.url), { waitUntil: "domcontentloaded", timeout: 30_000 });
    return;
  }
  throw replayError("replay_action_unknown", `Unbekannte Replay-Aktion: ${type || "leer"}.`, 422);
}

async function replayRecording(recording, options = {}) {
  if (!recording || !Array.isArray(recording.actions)) throw replayError("replay_recording_invalid", "Replay-Paket enthält keine Actions.");
  const startUrl = normalizeUrl(recording.startUrl);
  const viewport = recording.viewport && Number(recording.viewport.width) && Number(recording.viewport.height)
    ? { width: Number(recording.viewport.width), height: Number(recording.viewport.height) }
    : DEFAULT_VIEWPORT;
  const launch = options.launch || (launchOptions => chromium.launch(launchOptions));
  const browser = await launch({ headless: options.headless === true, args: ["--disable-dev-shm-usage"] });
  const context = await browser.newContext({ viewport, ignoreHTTPSErrors: true, javaScriptEnabled: true });
  const page = await context.newPage();
  const startedAt = Date.now();
  const steps = [];

  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    for (const action of recording.actions) {
      const stepStartedAt = Date.now();
      await applyReplayAction(page, action, options);
      await page.waitForTimeout(Math.max(80, Math.min(300, Number(options.settleMs) || 160))).catch(() => {});
      steps.push({
        index: Number(action.index) || steps.length + 1,
        type: String(action.type || ""),
        durationMs: Date.now() - stepStartedAt,
        url: page.url()
      });
    }
    const image = await page.screenshot({ type: "jpeg", quality: 58, fullPage: false });
    return {
      ok: true,
      actionCount: recording.actions.length,
      durationMs: Date.now() - startedAt,
      url: page.url(),
      title: await page.title().catch(() => ""),
      image: `data:image/jpeg;base64,${image.toString("base64")}`,
      steps
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

module.exports = { actionDelay, applyReplayAction, replayError, replayRecording, valueForAction };