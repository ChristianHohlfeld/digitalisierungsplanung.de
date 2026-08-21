"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const readline = require("node:readline/promises");
const { stdin: input, stdout: output } = require("node:process");
const { chromium } = require("playwright");
const { compileRecordingToDefinition } = require("./external-recorder");

const DEFAULT_VIEWPORT = Object.freeze({ width: 1366, height: 820 });
const SPECIAL_KEYS = Object.freeze(["Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);

function normalizeUrl(value) {
  const parsed = new URL(String(value || "").trim());
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only http/https URLs can be recorded.");
  return parsed.href;
}

function targetRecorderScript() {
  return `(() => {
    if (window.__stateBlueprintNativeRecorderInstalled) return;
    window.__stateBlueprintNativeRecorderInstalled = true;
    let lastScrollX = window.scrollX || 0;
    let lastScrollY = window.scrollY || 0;
    const pendingInputs = new Map();
    const specialKeys = new Set(${JSON.stringify(SPECIAL_KEYS)});
    const textOf = node => String(node?.innerText || node?.textContent || node?.value || node?.getAttribute?.("aria-label") || node?.getAttribute?.("title") || node?.getAttribute?.("placeholder") || "").trim().replace(/\\s+/g, " ").slice(0, 160);
    const cssEscape = value => window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, m => "\\\\" + m);
    const selectorFor = el => {
      if (!el || el === document || el === window) return "";
      if (el.id) return "#" + cssEscape(el.id);
      const name = el.getAttribute?.("name");
      if (name) return el.tagName.toLowerCase() + "[name=\"" + String(name).replace(/\"/g, "\\\\\"") + "\"]";
      const dataId = el.getAttribute?.("data-id") || el.getAttribute?.("data-testid") || el.getAttribute?.("data-test");
      if (dataId) return "[data-id=\"" + String(dataId).replace(/\"/g, "\\\\\"") + "\"]";
      const parts = [];
      for (let node = el; node && node.nodeType === 1 && parts.length < 4; node = node.parentElement) {
        const tag = node.tagName.toLowerCase();
        const parent = node.parentElement;
        if (!parent) { parts.unshift(tag); break; }
        const siblings = [...parent.children].filter(child => child.tagName === node.tagName);
        const index = siblings.indexOf(node) + 1;
        parts.unshift(siblings.length > 1 ? tag + ":nth-of-type(" + index + ")" : tag);
      }
      return parts.join(" > ");
    };
    const targetInfo = el => ({
      selector: selectorFor(el),
      label: textOf(el.closest?.("label") || el),
      tag: String(el?.tagName || "").toLowerCase(),
      inputType: String(el?.type || "").toLowerCase()
    });
    const send = payload => { try { window.__stateBlueprintRecord?.(payload); } catch (_) {} };
    const sendInput = el => {
      const target = targetInfo(el);
      const redacted = target.inputType === "password";
      send({ type: "input", selector: target.selector, target, value: redacted ? undefined : String(el.value ?? ""), redacted });
    };
    const scheduleInput = el => {
      const key = selectorFor(el) || Math.random().toString(36);
      clearTimeout(pendingInputs.get(key));
      pendingInputs.set(key, setTimeout(() => { pendingInputs.delete(key); sendInput(el); }, 260));
    };
    document.addEventListener("click", event => {
      const el = event.target?.closest?.("button,a,input,textarea,select,[role=button],[data-id],[data-testid]") || event.target;
      send({ type: "click", x: Math.round(event.clientX), y: Math.round(event.clientY), selector: selectorFor(el), target: targetInfo(el) });
    }, true);
    document.addEventListener("input", event => {
      const el = event.target;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) scheduleInput(el);
    }, true);
    document.addEventListener("change", event => {
      const el = event.target;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) sendInput(el);
    }, true);
    document.addEventListener("keydown", event => {
      if (!specialKeys.has(event.key)) return;
      send({ type: "key", key: event.key, selector: selectorFor(event.target), target: targetInfo(event.target) });
    }, true);
    window.addEventListener("scroll", () => {
      const nextX = window.scrollX || 0;
      const nextY = window.scrollY || 0;
      const deltaX = Math.round(nextX - lastScrollX);
      const deltaY = Math.round(nextY - lastScrollY);
      lastScrollX = nextX;
      lastScrollY = nextY;
      if (deltaX || deltaY) send({ type: "scroll", deltaX, deltaY });
    }, true);
  })();`;
}

function createRecording(startUrl, viewport = DEFAULT_VIEWPORT) {
  return { version: 1, startUrl, createdAt: new Date().toISOString(), viewport: { ...viewport }, actions: [], snapshots: [] };
}

async function screenshotSnapshot(page, recording, atMs) {
  const image = await page.screenshot({ type: "jpeg", quality: 56, fullPage: false });
  const snapshot = {
    atMs: Math.max(0, Math.round(Number(atMs) || 0)),
    url: page.url(),
    title: await page.title().catch(() => ""),
    image: `data:image/jpeg;base64,${image.toString("base64")}`
  };
  recording.snapshots.push(snapshot);
  return snapshot;
}

function normalizeAction(payload = {}, index, startedAt, lastActionAt) {
  const at = Date.now();
  const action = { ...payload, index, atMs: Math.max(0, at - startedAt), delayMs: Math.max(0, at - lastActionAt) };
  if (action.type === "input") action.value = action.redacted ? undefined : String(action.value ?? "");
  return action;
}

async function runNativeBrowserRecorder(options = {}) {
  const startUrl = normalizeUrl(options.url);
  const viewport = options.viewport || DEFAULT_VIEWPORT;
  const outFile = path.resolve(options.output || "recording-package.json");
  const browser = await chromium.launch({ headless: options.headless === true, args: ["--disable-dev-shm-usage"] });
  const context = await browser.newContext({ viewport, ignoreHTTPSErrors: options.ignoreHTTPSErrors !== false });
  const recording = createRecording(startUrl, viewport);
  const startedAt = Date.now();
  let lastActionAt = startedAt;
  let snapshotQueue = Promise.resolve();

  await context.exposeBinding("__stateBlueprintRecord", async (source, payload = {}) => {
    const action = normalizeAction(payload, recording.actions.length + 1, startedAt, lastActionAt);
    lastActionAt = Date.now();
    recording.actions.push(action);
    snapshotQueue = snapshotQueue.then(async () => {
      await source.page.waitForTimeout(180).catch(() => {});
      await screenshotSnapshot(source.page, recording, action.atMs).catch(() => {});
    });
  });
  await context.addInitScript(targetRecorderScript());

  const page = await context.newPage();
  await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(350);
  await screenshotSnapshot(page, recording, 0);

  if (options.waitForEnter !== false) {
    console.log("\nNative Recorder läuft.");
    console.log("Bediene das Chromium-Fenster ganz normal: klicken, tippen, scrollen, Dropdowns, E-Mail-Felder.");
    console.log("Zurück im Terminal Enter drücken, wenn fertig.\n");
    const rl = readline.createInterface({ input, output });
    await rl.question("Fertig? Enter beendet und exportiert … ");
    rl.close();
  }
  await snapshotQueue.catch(() => {});

  const definition = compileRecordingToDefinition(recording, { name: `Native Recording: ${new URL(startUrl).hostname}` });
  const recordingPackage = {
    kind: "state-blueprint-native-recording-package",
    version: 1,
    createdAt: new Date().toISOString(),
    definition,
    recording: {
      kind: "state-blueprint-recording-package",
      version: recording.version,
      startUrl: recording.startUrl,
      createdAt: recording.createdAt,
      viewport: recording.viewport,
      actions: recording.actions,
      snapshotCount: recording.snapshots.length
    }
  };
  await fs.writeFile(outFile, JSON.stringify(recordingPackage, null, 2));
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  return { outFile, actionCount: recording.actions.length, snapshotCount: recording.snapshots.length, recordingPackage };
}

async function main() {
  const args = process.argv.slice(2);
  const url = args.find(arg => !arg.startsWith("--"));
  if (!url) {
    console.error("Usage: npm run recorder:native -- https://example.com [--out=recording-package.json] [--headless]");
    process.exit(1);
  }
  const outArg = args.find(arg => arg.startsWith("--out="));
  const result = await runNativeBrowserRecorder({
    url,
    output: outArg ? outArg.slice("--out=".length) : "recording-package.json",
    headless: args.includes("--headless")
  });
  console.log(`Exportiert: ${result.outFile}`);
  console.log(`${result.actionCount} Aktionen, ${result.snapshotCount} Snapshots`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message || error);
    process.exit(1);
  });
}

module.exports = { createRecording, normalizeAction, normalizeUrl, runNativeBrowserRecorder, targetRecorderScript };
