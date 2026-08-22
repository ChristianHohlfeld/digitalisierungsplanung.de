"use strict";

const RECORDING_KEY = "zustand.activeRecording";
const REPLAY_KEY = "zustand.activeReplay";
const MAX_ACTIONS = 160;
let recordQueue = Promise.resolve();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const uid = prefix => `${prefix}_${crypto.randomUUID()}`;

function normalizeUrl(value) {
  const url = new URL(String(value || "").trim());
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("Nur http/https URLs können aufgenommen werden.");
  return url.href;
}

async function getStored(key) {
  const value = await chrome.storage.local.get(key);
  return value[key] || null;
}

async function setStored(key, value) {
  if (value === null || value === undefined) await chrome.storage.local.remove(key);
  else await chrome.storage.local.set({ [key]: value });
}

async function getRecording() { return getStored(RECORDING_KEY); }
async function setRecording(value) { return setStored(RECORDING_KEY, value); }
async function getReplay() { return getStored(REPLAY_KEY); }
async function setReplay(value) { return setStored(REPLAY_KEY, value); }

async function waitForTab(tabId, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error("Browser-Tab wurde geschlossen.");
    if (tab.status === "complete") return tab;
    await sleep(100);
  }
  throw new Error("Website hat zu lange zum Laden gebraucht.");
}

async function sendToTab(tabId, message, retries = 30) {
  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try { return await chrome.tabs.sendMessage(tabId, message); }
    catch (error) { lastError = error; await sleep(80); }
  }
  throw lastError || new Error("Recorder konnte sich nicht mit dem Tab verbinden.");
}

async function captureSnapshot(session, atMs) {
  const tab = await chrome.tabs.get(session.tabId).catch(() => null);
  if (!tab || !tab.active || !Number.isInteger(tab.windowId)) return session;
  let image = "";
  try { image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 52 }); }
  catch (_) { return session; }
  session.snapshots.push({
    atMs: Math.max(0, Math.round(Number(atMs) || 0)),
    url: String(tab.url || session.currentUrl || session.startUrl),
    title: String(tab.title || ""),
    image
  });
  if (session.snapshots.length > MAX_ACTIONS + 4) session.snapshots.shift();
  await setRecording(session);
  return session;
}

async function stopExistingRecording() {
  const prior = await getRecording();
  if (!prior) return;
  await chrome.tabs.sendMessage(prior.tabId, { type: "ZUSTAND_STOP_RECORDING" }).catch(() => {});
  await setRecording(null);
}

async function startRecording(url) {
  await stopExistingRecording();
  const startUrl = normalizeUrl(url);
  const tab = await chrome.tabs.create({ url: startUrl, active: true });
  if (!Number.isInteger(tab.id)) throw new Error("Browser-Tab konnte nicht geöffnet werden.");
  const loaded = await waitForTab(tab.id);
  const now = Date.now();
  const session = {
    id: uid("rec"),
    tabId: tab.id,
    windowId: loaded.windowId,
    status: "recording",
    startUrl,
    currentUrl: String(loaded.url || startUrl),
    startedAt: now,
    lastActionAt: now,
    actions: [],
    snapshots: []
  };
  await setRecording(session);
  await sendToTab(tab.id, { type: "ZUSTAND_START_RECORDING", sessionId: session.id });
  await sleep(120);
  await captureSnapshot(session, 0);
  return summary(session);
}

function cleanTarget(target = {}) {
  return {
    selector: String(target.selector || "").slice(0, 1000),
    label: String(target.label || "").slice(0, 160),
    tag: String(target.tag || "").slice(0, 32),
    inputType: String(target.inputType || "").slice(0, 32),
    id: String(target.id || "").slice(0, 160),
    name: String(target.name || "").slice(0, 160)
  };
}

function normalizeAction(payload, session) {
  const type = String(payload?.type || "");
  if (!new Set(["click", "input", "key", "scroll", "navigate"]).has(type)) throw new Error("Unbekannte Recorder-Aktion.");
  const now = Date.now();
  const action = {
    type,
    index: session.actions.length + 1,
    atMs: Math.max(0, now - session.startedAt),
    delayMs: Math.max(0, now - session.lastActionAt)
  };
  if (payload.selector) action.selector = String(payload.selector).slice(0, 1000);
  if (payload.target) action.target = cleanTarget(payload.target);
  if (type === "click") { action.x = Math.round(Number(payload.x) || 0); action.y = Math.round(Number(payload.y) || 0); }
  if (type === "input") {
    action.redacted = payload.redacted === true;
    if (!action.redacted && Object.hasOwn(payload, "value")) action.value = String(payload.value ?? "").slice(0, 10000);
    if (Object.hasOwn(payload, "checked")) action.checked = Boolean(payload.checked);
  }
  if (type === "key") action.key = String(payload.key || "Enter").slice(0, 80);
  if (type === "scroll") { action.deltaX = Math.round(Number(payload.deltaX) || 0); action.deltaY = Math.round(Number(payload.deltaY) || 0); }
  if (type === "navigate") action.url = normalizeUrl(payload.url);
  return { action, now };
}

async function appendAction(payload, senderTabId, sessionId) {
  const session = await getRecording();
  if (!session || session.id !== sessionId || session.tabId !== senderTabId || session.status !== "recording") return { ok: false, ignored: true };
  if (session.actions.length >= MAX_ACTIONS) throw new Error(`Aufnahme ist auf ${MAX_ACTIONS} Aktionen begrenzt.`);
  const { action, now } = normalizeAction(payload, session);
  session.actions.push(action);
  session.lastActionAt = now;
  if (action.type === "navigate") session.currentUrl = action.url;
  await setRecording(session);
  await sleep(action.type === "navigate" ? 280 : 140);
  await captureSnapshot(session, action.atMs);
  return { ok: true, actionCount: session.actions.length, snapshotCount: session.snapshots.length };
}

function summary(session) {
  return {
    id: session.id,
    status: session.status,
    actionCount: session.actions.length,
    snapshotCount: session.snapshots.length,
    url: session.currentUrl || session.startUrl
  };
}

async function finishRecording() {
  const session = await getRecording();
  if (!session) throw new Error("Keine aktive Aufnahme.");
  await chrome.tabs.sendMessage(session.tabId, { type: "ZUSTAND_STOP_RECORDING" }).catch(() => {});
  const tab = await chrome.tabs.get(session.tabId).catch(() => null);
  if (tab?.active) await captureSnapshot(session, session.actions.at(-1)?.atMs || 0);
  session.status = "finished";
  const recording = {
    version: 1,
    startUrl: session.startUrl,
    createdAt: new Date(session.startedAt).toISOString(),
    viewport: null,
    actions: session.actions,
    snapshots: session.snapshots
  };
  await setRecording(null);
  return { recording };
}

async function cancelRecording() {
  const session = await getRecording();
  if (!session) return { ok: true };
  await chrome.tabs.sendMessage(session.tabId, { type: "ZUSTAND_STOP_RECORDING" }).catch(() => {});
  await setRecording(null);
  return { ok: true };
}

function applyDomAction(action) {
  const selector = String(action.selector || "");
  const find = () => {
    if (selector) {
      try { const node = document.querySelector(selector); if (node) return node; } catch (_) {}
    }
    if (Number.isFinite(Number(action.x)) && Number.isFinite(Number(action.y))) return document.elementFromPoint(Number(action.x), Number(action.y));
    return document.activeElement;
  };
  const element = find();
  if (action.type === "scroll") {
    window.scrollBy({ left: Number(action.deltaX) || 0, top: Number(action.deltaY) || 0, behavior: "instant" });
    return { ok: true };
  }
  if (!(element instanceof Element)) return { ok: false, error: "Element nicht gefunden" };
  element.scrollIntoView?.({ block: "center", inline: "center" });
  element.focus?.();
  if (action.type === "click") {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      const EventType = type.startsWith("pointer") ? PointerEvent : MouseEvent;
      element.dispatchEvent(new EventType(type, { bubbles: true, cancelable: true, view: window }));
    }
    return { ok: true };
  }
  if (action.type === "input") {
    if (action.redacted) return { ok: false, error: "secret_required" };
    if (Object.hasOwn(action, "checked") && element instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
      if (setter) setter.call(element, Boolean(action.checked)); else element.checked = Boolean(action.checked);
    } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(element, String(action.value ?? "")); else element.value = String(action.value ?? "");
    } else if (element.isContentEditable) {
      element.textContent = String(action.value ?? "");
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  }
  if (action.type === "key") {
    const key = String(action.key || "Enter");
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    element.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
    if (key === "Enter") {
      const form = element.closest?.("form");
      if (form?.requestSubmit) form.requestSubmit();
    }
    return { ok: true };
  }
  return { ok: true };
}

async function startReplay(startUrl) {
  const prior = await getReplay();
  if (prior?.tabId) await chrome.tabs.remove(prior.tabId).catch(() => {});
  const tab = await chrome.tabs.create({ url: normalizeUrl(startUrl), active: true });
  if (!Number.isInteger(tab.id)) throw new Error("Replay-Tab konnte nicht geöffnet werden.");
  await waitForTab(tab.id);
  const replay = { id: uid("replay"), tabId: tab.id, status: "running" };
  await setReplay(replay);
  return replay;
}

async function applyReplayAction(replayId, action) {
  const replay = await getReplay();
  if (!replay || replay.id !== replayId || replay.status !== "running") throw new Error("Replay ist nicht aktiv.");
  if (action.type === "navigate") {
    await chrome.tabs.update(replay.tabId, { url: normalizeUrl(action.url) });
    await waitForTab(replay.tabId);
    return { ok: true };
  }
  const result = await chrome.scripting.executeScript({ target: { tabId: replay.tabId }, func: applyDomAction, args: [action] });
  const value = result?.[0]?.result || { ok: false, error: "Replay-Aktion fehlgeschlagen" };
  if (!value.ok) throw new Error(value.error === "secret_required" ? "Geschützte Eingabe muss beim Replay neu eingegeben werden." : value.error);
  await sleep(100);
  return value;
}

async function stopReplay() {
  const replay = await getReplay();
  if (replay) {
    replay.status = "stopped";
    await setReplay(null);
  }
  return { ok: true };
}

async function handleEditorCommand(command, payload) {
  switch (command) {
    case "PING": return { ok: true, name: "Zustand Recorder", version: 1 };
    case "START_RECORDING": return { ok: true, ...(await startRecording(payload.url)) };
    case "RECORDING_STATUS": {
      const session = await getRecording();
      return session ? { ok: true, ...summary(session) } : { ok: true, status: "idle", actionCount: 0, snapshotCount: 0 };
    }
    case "FINISH_RECORDING": return { ok: true, ...(await finishRecording()) };
    case "CANCEL_RECORDING": return cancelRecording();
    case "START_REPLAY": return { ok: true, ...(await startReplay(payload.startUrl)) };
    case "APPLY_REPLAY_ACTION": return { ok: true, ...(await applyReplayAction(payload.replayId, payload.action)) };
    case "STOP_REPLAY": return stopReplay();
    default: throw new Error("Unbekannter Recorder-Befehl.");
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "ZUSTAND_CONTENT_READY") {
    return getRecording().then(session => {
      if (!session || sender.tab?.id !== session.tabId) return { ok: true };
      return sendToTab(session.tabId, { type: "ZUSTAND_START_RECORDING", sessionId: session.id }).then(() => ({ ok: true })).catch(() => ({ ok: false }));
    });
  }
  if (message?.type === "ZUSTAND_RECORDED_ACTION") {
    recordQueue = recordQueue.then(() => appendAction(message.action || {}, sender.tab?.id, String(message.sessionId || ""))).catch(error => ({ ok: false, error: String(error.message || error) }));
    return recordQueue;
  }
  if (message?.type === "ZUSTAND_EDITOR_COMMAND") {
    return handleEditorCommand(String(message.command || ""), message.payload || {}).catch(error => ({ ok: false, error: String(error.message || error) }));
  }
  return undefined;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url && changeInfo.status !== "complete") return;
  recordQueue = recordQueue.then(async () => {
    const session = await getRecording();
    if (!session || session.tabId !== tabId || session.status !== "recording") return;
    if (changeInfo.url) {
      const nextUrl = String(changeInfo.url || "");
      if (nextUrl && nextUrl !== session.currentUrl && /^https?:/i.test(nextUrl)) {
        const { action, now } = normalizeAction({ type: "navigate", url: nextUrl }, session);
        session.actions.push(action);
        session.lastActionAt = now;
        session.currentUrl = nextUrl;
        await setRecording(session);
      }
    }
    if (changeInfo.status === "complete") {
      await sendToTab(tabId, { type: "ZUSTAND_START_RECORDING", sessionId: session.id }).catch(() => {});
      await sleep(100);
      await captureSnapshot(session, session.actions.at(-1)?.atMs || 0);
    }
  }).catch(() => {});
});

chrome.tabs.onRemoved.addListener(tabId => {
  void getRecording().then(session => {
    if (session?.tabId === tabId) return setRecording(null);
  });
  void getReplay().then(replay => {
    if (replay?.tabId === tabId) return setReplay(null);
  });
});
