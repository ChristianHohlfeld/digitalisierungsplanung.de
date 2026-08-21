"use strict";

const { chromium } = require("playwright");

const MAX_DELAY_MS = 10 * 60 * 1000;
const DEFAULT_VIEWPORT = Object.freeze({ width: 1366, height: 820 });

function replayError(code, message, details = {}) {
  const error = new Error(message || code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function normalizeRecording(input = {}) {
  const recording = input.recording && typeof input.recording === "object" ? input.recording : input;
  const startUrl = String(recording.startUrl || "").trim();
  if (!startUrl) throw replayError("replay_start_url_missing", "Recording has no start URL.");
  const actions = Array.isArray(recording.actions) ? recording.actions.map(action => ({ ...action })) : [];
  const viewport = {
    width: Math.max(640, Math.min(1920, Number(recording.viewport?.width) || DEFAULT_VIEWPORT.width)),
    height: Math.max(480, Math.min(1400, Number(recording.viewport?.height) || DEFAULT_VIEWPORT.height))
  };
  return { ...recording, startUrl, actions, viewport };
}

function actionSecretKey(action = {}) {
  const selector = String(action.selector || action.target?.selector || "").trim();
  return selector ? `selector:${selector}` : `action:${Number(action.index) || 0}`;
}

function requiredSecretKeys(recordingInput = {}) {
  const recording = normalizeRecording(recordingInput);
  return recording.actions.filter(action => action?.redacted === true).map(actionSecretKey);
}

function secretForAction(action, secrets = {}) {
  if (!action?.redacted) return String(action?.value ?? action?.text ?? "");
  const key = actionSecretKey(action);
  if (Object.prototype.hasOwnProperty.call(secrets, key)) return String(secrets[key] ?? "");
  const selector = String(action.selector || action.target?.selector || "").trim();
  if (selector && Object.prototype.hasOwnProperty.call(secrets, selector)) return String(secrets[selector] ?? "");
  throw replayError("replay_secret_missing", `Secret missing for ${key}.`, { secretKey: key, actionIndex: action.index });
}

async function locatorForAction(page, action = {}) {
  const selector = String(action.selector || action.target?.selector || "").trim();
  if (!selector) return null;
  const locator = page.locator(selector).first();
  const count = await locator.count().catch(() => 0);
  return count ? locator : null;
}

async function applyRecordedAction(page, action = {}, options = {}) {
  const type = String(action.type || "").trim();
  const locator = await locatorForAction(page, action);
  if (type === "click") {
    if (locator) {
      await locator.scrollIntoViewIfNeeded().catch(() => {});
      await locator.click({ timeout: options.actionTimeoutMs || 10_000 });
      return;
    }
    if (Number.isFinite(Number(action.x)) && Number.isFinite(Number(action.y))) {
      await page.mouse.click(Number(action.x), Number(action.y));
      return;
    }
    throw replayError("replay_target_missing", "Click target could not be found.", { actionIndex: action.index, selector: action.selector || "" });
  }
  if (type === "input") {
    const value = secretForAction(action, options.secrets || {});
    if (!locator) throw replayError("replay_target_missing", "Input target could not be found.", { actionIndex: action.index, selector: action.selector || "" });
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await locator.fill(value, { timeout: options.actionTimeoutMs || 10_000 });
    return;
  }
  if (type === "key") {
    const key = String(action.key || "").trim();
    if (!key) return;
    if (locator) await locator.press(key, { timeout: options.actionTimeoutMs || 10_000 });
    else await page.keyboard.press(key);
    return;
  }
  if (type === "scroll") {
    await page.mouse.wheel(Number(action.deltaX) || 0, Number(action.deltaY) || 0);
    return;
  }
  if (type === "navigate") {
    const rawUrl = String(action.url || "").trim();
    if (!rawUrl) return;
    const safeUrl = options.validateUrl ? await options.validateUrl(rawUrl) : rawUrl;
    await page.goto(safeUrl, { waitUntil: "domcontentloaded", timeout: options.navigationTimeoutMs || 30_000 });
    return;
  }
  throw replayError("replay_action_unsupported", `Unsupported replay action: ${type || "unknown"}.`, { actionIndex: action.index });
}

async function replayRecording(recordingInput = {}, options = {}) {
  const recording = normalizeRecording(recordingInput);
  const safeStartUrl = options.validateUrl ? await options.validateUrl(recording.startUrl) : recording.startUrl;
  const browser = options.browser || await (options.launchBrowser
    ? options.launchBrowser()
    : chromium.launch({ headless: options.headless !== false, args: ["--disable-dev-shm-usage"] }));
  const ownsBrowser = !options.browser;
  const context = await browser.newContext({
    viewport: recording.viewport,
    ignoreHTTPSErrors: options.ignoreHTTPSErrors === true,
    javaScriptEnabled: true
  });
  const page = await context.newPage();
  const startedAt = Date.now();
  let completed = 0;
  let failedAction = null;
  try {
    await page.goto(safeStartUrl, { waitUntil: "domcontentloaded", timeout: options.navigationTimeoutMs || 30_000 });
    for (const action of recording.actions) {
      const delay = Math.max(0, Math.min(MAX_DELAY_MS, Number(action.delayMs) || 0));
      if (options.respectTiming !== false && delay) await page.waitForTimeout(delay);
      try {
        await applyRecordedAction(page, action, { ...options, validateUrl: options.validateUrl });
        completed += 1;
        await page.waitForTimeout(Math.max(0, Number(options.settleMs) || 120));
      } catch (error) {
        failedAction = { index: action.index || completed + 1, type: action.type || "", selector: action.selector || "", message: String(error?.message || error) };
        throw error;
      }
    }
    const image = await page.screenshot({ type: "jpeg", quality: 58, fullPage: false });
    return {
      ok: true,
      actionCount: completed,
      durationMs: Date.now() - startedAt,
      url: page.url(),
      title: await page.title().catch(() => ""),
      image: `data:image/jpeg;base64,${image.toString("base64")}`
    };
  } catch (error) {
    const image = await page.screenshot({ type: "jpeg", quality: 50, fullPage: false }).catch(() => null);
    const wrapped = replayError(error?.code || "replay_failed", String(error?.message || error), {
      actionCount: completed,
      durationMs: Date.now() - startedAt,
      failedAction,
      url: page.url(),
      image: image ? `data:image/jpeg;base64,${image.toString("base64")}` : ""
    });
    throw wrapped;
  } finally {
    await context.close().catch(() => {});
    if (ownsBrowser) await browser.close().catch(() => {});
  }
}

function sanitizeRecordingForTask(input = {}) {
  const recording = normalizeRecording(input);
  return {
    kind: "state-blueprint-recording-package",
    version: Number(recording.version) || 1,
    startUrl: recording.startUrl,
    createdAt: recording.createdAt || new Date().toISOString(),
    viewport: recording.viewport,
    actions: recording.actions.map(action => {
      const copy = { ...action };
      delete copy.value;
      if (!copy.redacted && action.value !== undefined) copy.value = String(action.value);
      return copy;
    })
  };
}

module.exports = {
  actionSecretKey,
  applyRecordedAction,
  normalizeRecording,
  replayRecording,
  requiredSecretKeys,
  sanitizeRecordingForTask
};
