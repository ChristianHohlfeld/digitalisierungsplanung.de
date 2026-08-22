"use strict";

const EDITOR_ORIGINS = new Set([
  "https://digitalisierungsplanung.de",
  "https://www.digitalisierungsplanung.de"
]);

let recordingSessionId = "";
let installed = false;
let inputTimer = null;
let pendingInput = null;
let scrollTimer = null;
let lastScrollX = window.scrollX || 0;
let lastScrollY = window.scrollY || 0;

function selectorFor(element) {
  if (!(element instanceof Element)) return { selector: "", label: "", tag: "", inputType: "", id: "", name: "" };
  const esc = value => CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  const label = String(
    element.getAttribute("aria-label") ||
    element.getAttribute("placeholder") ||
    element.getAttribute("title") ||
    element.innerText ||
    element.getAttribute("name") ||
    element.id ||
    element.tagName
  ).trim().replace(/\s+/g, " ").slice(0, 120);
  const inputType = element instanceof HTMLInputElement ? String(element.type || "text").toLowerCase() : "";
  const meta = {
    label,
    tag: element.tagName.toLowerCase(),
    inputType,
    id: String(element.id || ""),
    name: String(element.getAttribute("name") || "")
  };
  if (element.id) return { ...meta, selector: `#${esc(element.id)}` };
  for (const attr of ["data-testid", "data-test", "data-qa", "name"]) {
    const value = element.getAttribute(attr);
    if (value) return { ...meta, selector: `${element.tagName.toLowerCase()}[${attr}="${CSS.escape(String(value))}"]` };
  }
  const parts = [];
  let node = element;
  for (let depth = 0; node instanceof Element && depth < 6; depth += 1, node = node.parentElement) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      parts.unshift(`#${esc(node.id)}`);
      break;
    }
    const parent = node.parentElement;
    if (parent) {
      const siblings = [...parent.children].filter(item => item.tagName === node.tagName);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
    }
    parts.unshift(part);
  }
  return { ...meta, selector: parts.join(" > ") };
}

function sendAction(action) {
  if (!recordingSessionId) return;
  chrome.runtime.sendMessage({
    type: "ZUSTAND_RECORDED_ACTION",
    sessionId: recordingSessionId,
    action
  }).catch(() => {});
}

function flushInput() {
  clearTimeout(inputTimer);
  inputTimer = null;
  if (!pendingInput) return;
  const action = pendingInput;
  pendingInput = null;
  sendAction(action);
}

function queueInput(element) {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement || element.isContentEditable)) return;
  const target = selectorFor(element);
  const type = target.inputType;
  const booleanField = type === "checkbox" || type === "radio";
  const redacted = type === "password";
  const action = {
    type: "input",
    selector: target.selector,
    target,
    redacted
  };
  if (booleanField) action.checked = Boolean(element.checked);
  else if (!redacted) action.value = element.isContentEditable ? String(element.textContent || "") : String(element.value ?? "");
  pendingInput = action;
  if (booleanField || element instanceof HTMLSelectElement) return flushInput();
  clearTimeout(inputTimer);
  inputTimer = setTimeout(flushInput, 360);
}

function recordClick(event) {
  flushInput();
  const element = event.target instanceof Element ? event.target : null;
  const target = selectorFor(element);
  sendAction({
    type: "click",
    selector: target.selector,
    target,
    x: Math.round(Number(event.clientX) || 0),
    y: Math.round(Number(event.clientY) || 0)
  });
}

function recordKey(event) {
  if (!new Set(["Enter", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]).has(event.key)) return;
  flushInput();
  const target = selectorFor(event.target instanceof Element ? event.target : null);
  sendAction({ type: "key", key: event.key, selector: target.selector, target });
}

function recordScroll() {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    const x = window.scrollX || 0;
    const y = window.scrollY || 0;
    const deltaX = Math.round(x - lastScrollX);
    const deltaY = Math.round(y - lastScrollY);
    lastScrollX = x;
    lastScrollY = y;
    if (deltaX || deltaY) sendAction({ type: "scroll", deltaX, deltaY, scrollX: x, scrollY: y });
  }, 180);
}

function installRecorder() {
  if (installed) return;
  installed = true;
  document.addEventListener("click", recordClick, true);
  document.addEventListener("input", event => queueInput(event.target), true);
  document.addEventListener("change", event => queueInput(event.target), true);
  document.addEventListener("focusout", flushInput, true);
  document.addEventListener("keydown", recordKey, true);
  window.addEventListener("scroll", recordScroll, { passive: true, capture: true });
}

function uninstallRecorder() {
  flushInput();
  recordingSessionId = "";
}

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === "ZUSTAND_START_RECORDING") {
    recordingSessionId = String(message.sessionId || "");
    lastScrollX = window.scrollX || 0;
    lastScrollY = window.scrollY || 0;
    installRecorder();
    return Promise.resolve({ ok: true, url: location.href });
  }
  if (message?.type === "ZUSTAND_STOP_RECORDING") {
    uninstallRecorder();
    return Promise.resolve({ ok: true });
  }
  return undefined;
});

chrome.runtime.sendMessage({ type: "ZUSTAND_CONTENT_READY", url: location.href }).catch(() => {});

if (EDITOR_ORIGINS.has(location.origin)) {
  window.addEventListener("message", event => {
    const data = event.data;
    if (event.source !== window || data?.source !== "zustand-editor" || data?.type !== "ZUSTAND_EXTENSION_COMMAND") return;
    chrome.runtime.sendMessage({
      type: "ZUSTAND_EDITOR_COMMAND",
      requestId: String(data.requestId || ""),
      command: String(data.command || ""),
      payload: data.payload || {}
    }).then(response => {
      window.postMessage({
        source: "zustand-recorder-extension",
        type: "ZUSTAND_EXTENSION_RESPONSE",
        requestId: String(data.requestId || ""),
        response
      }, "*");
    }).catch(error => {
      window.postMessage({
        source: "zustand-recorder-extension",
        type: "ZUSTAND_EXTENSION_RESPONSE",
        requestId: String(data.requestId || ""),
        response: { ok: false, error: String(error?.message || error || "Recorder extension error") }
      }, "*");
    });
  });
  window.postMessage({ source: "zustand-recorder-extension", type: "ZUSTAND_EXTENSION_READY" }, "*");
}
