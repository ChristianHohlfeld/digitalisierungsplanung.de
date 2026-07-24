"use strict";

const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const dns = require("node:dns");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const path = require("node:path");
const { URL } = require("node:url");
const { WebSocketServer, WebSocket } = require("ws");
const eventCatalog = require("./event-catalog");
const presetLibrary = require("./preset-library");
const adminTools = require("./admin-tools");
const productContract = require("./product-contract");
const { loadReleaseInfo, parseReleaseSource } = require("./release");
const stateBlueprintMcp = require("../mcp/state-blueprint-server");

const DEFAULT_ALLOWED_ORIGINS = ["https://digitalisierungsplanung.de"];
const DEFAULT_PATH = "/ws";
const DEFAULT_TOKEN_PATH = "/token";
const DEFAULT_EVENTS_PATH = "/events";
const DEFAULT_PRODUCT_CONTRACT_PATH = "/contract";
const DEFAULT_EMIT_PATH = "/emit";
const DEFAULT_ADMIN_PATH = "/admin.html";
const DEFAULT_ADMIN_ROUTES_PATH = "/admin/routes";
const DEFAULT_CONSOLE_PATH = "/console.html";
const DEFAULT_EVENTS_ADMIN_PATH = "/events-admin.html";
const DEFAULT_EVENTS_ADMIN_CATALOG_PATH = "/events-admin/catalog";
const DEFAULT_PRESETS_ADMIN_PATH = "/presets-admin.html";
const DEFAULT_PRESETS_ADMIN_CATALOG_PATH = "/presets-admin/catalog";
const DEFAULT_PRESETS_ADMIN_PARSE_PATH = "/presets-admin/parse";
const DEFAULT_PRESETS_ADMIN_IMPORT_PATH = "/presets-admin/import";
const DEFAULT_IMAGE_INLINE_PATH = "/assets/inline-image";
const DEFAULT_MCP_PATH = "/mcp";
const DEFAULT_VERSION_PATH = "/version";
const DEFAULT_ADMIN_COMMIT_MESSAGE = "Update realtime event catalog";
const DEFAULT_PRESET_ADMIN_COMMIT_MESSAGE = "Update preset library";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8788;
const MAX_ID_LENGTH = 128;
const MAX_EVENT_NAME_LENGTH = 160;
const MAX_EMIT_BODY_BYTES = 64 * 1024;
const MAX_PRESET_API_RESPONSE_BYTES = 64 * 1024;
const MAX_IMAGE_INLINE_BODY_BYTES = 4 * 1024;
const MAX_MCP_BODY_BYTES = 1024 * 1024;
const MAX_IMAGE_INLINE_BYTES = 12 * 1024 * 1024;
const PRESET_API_TIMEOUT_MS = 8000;
const IMAGE_INLINE_TIMEOUT_MS = 12000;
const MESSAGE_TYPES = new Set(["runtime.event"]);
const CONSOLE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Realtime Event Console</title>
  <style>
    :root { color-scheme: dark; --bg: #07111d; --panel: #0b1b2a; --line: #20425f; --text: #e6f2ff; --muted: #9fb6cc; --accent: #38bdf8; --ok: #34d399; --bad: #fb7185; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; font-family: "Segoe UI", system-ui, sans-serif; background: var(--bg); color: var(--text); }
    main { width: min(920px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 40px; }
    header { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
    h1 { margin: 0; font-size: 28px; line-height: 1.1; }
    .status { color: var(--muted); font-size: 13px; }
    form, .result { border: 1px solid var(--line); border-radius: 8px; background: var(--panel); padding: 16px; }
    form { display: grid; gap: 14px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    label { display: grid; gap: 6px; color: var(--muted); font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
    input, select, textarea, button { width: 100%; border: 1px solid var(--line); border-radius: 6px; background: #06111f; color: var(--text); font: inherit; }
    input, select { height: 42px; padding: 0 10px; }
    textarea { min-height: 160px; padding: 10px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 13px; line-height: 1.45; }
    button { height: 42px; padding: 0 14px; border-color: #23729b; background: #0b3a55; color: #dff7ff; font-weight: 900; cursor: pointer; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .actions { display: flex; gap: 10px; align-items: center; }
    .actions button { width: auto; min-width: 120px; }
    .hint { color: var(--muted); font-size: 13px; line-height: 1.45; }
    .result { margin-top: 14px; white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 13px; line-height: 1.45; }
    .ok { color: var(--ok); }
    .bad { color: var(--bad); }
    a { color: var(--accent); text-decoration: none; font-weight: 800; }
    @media (max-width: 720px) { .grid, header { grid-template-columns: 1fr; display: grid; } .actions { display: grid; } .actions button { width: 100%; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Realtime Event Console</h1>
        <div class="status" id="status">Loading event catalog...</div>
      </div>
      <a id="stateLink" href="https://digitalisierungsplanung.de/state.html?room=smoke" target="_blank" rel="noreferrer">Open state room</a>
    </header>
    <form id="emitForm">
      <div class="grid">
        <label>Room ID<input id="roomId" name="roomId" autocomplete="off" value="smoke"></label>
        <label>Client ID<input id="clientId" name="clientId" autocomplete="off" value="console"></label>
      </div>
      <label>Connector<select id="emitterId" name="emitterId"></select></label>
      <label>Event<select id="eventName" name="eventName"></select></label>
      <label>Detail JSON<textarea id="detail" name="detail" spellcheck="false">{}</textarea></label>
      <label>Emit Secret<input id="secret" name="secret" type="password" autocomplete="off" placeholder="REALTIME_EMIT_SECRET"></label>
      <div class="actions">
        <button id="send" type="submit">Emit event</button>
        <button id="reload" type="button">Reload events</button>
      </div>
      <div class="hint">Events come from <code>/events</code>. The secret is stored locally in this browser and is sent only as the Bearer token for <code>/emit</code>.</div>
    </form>
    <div id="result" class="result">No event emitted yet.</div>
  </main>
  <script>
    const statusEl = document.getElementById("status");
    const resultEl = document.getElementById("result");
    const eventSelect = document.getElementById("eventName");
    const emitterSelect = document.getElementById("emitterId");
    const detailEl = document.getElementById("detail");
    const roomEl = document.getElementById("roomId");
    const clientEl = document.getElementById("clientId");
    const secretEl = document.getElementById("secret");
    const sendEl = document.getElementById("send");
    const stateLinkEl = document.getElementById("stateLink");
    const EMIT_SECRET_STORAGE_KEY = "digitalisierungsplanung.realtime.emitSecret";
    let catalog = null;

    try {
      secretEl.value = localStorage.getItem(EMIT_SECRET_STORAGE_KEY) || "";
    } catch (_) {}
    secretEl.addEventListener("input", () => {
      try {
        const value = secretEl.value.trim();
        if (value) localStorage.setItem(EMIT_SECRET_STORAGE_KEY, value);
        else localStorage.removeItem(EMIT_SECRET_STORAGE_KEY);
      } catch (_) {}
    });

    function setResult(message, ok = true) {
      resultEl.classList.toggle("ok", ok);
      resultEl.classList.toggle("bad", !ok);
      resultEl.textContent = message;
    }

    function sampleValue(path, type) {
      const key = String(path || "").toLowerCase();
      if (key.includes("caller")) return "+491234";
      if (key.includes("callee")) return "100";
      if (key.includes("callid") || key.includes("call_id")) return "call-" + Date.now();
      if (type === "number") return 1;
      if (type === "boolean") return true;
      if (type === "object") return {};
      if (type === "list") return [];
      return "";
    }

    function detailForEvent(event) {
      const detail = {};
      for (const [path, type] of Object.entries(event?.detail || {})) {
        detail[path] = sampleValue(path, type);
      }
      return detail;
    }

    function selectedEvent() {
      return (catalog?.events || []).find(event => event.name === eventSelect.value) || null;
    }

    function selectedEmitter() {
      return (catalog?.emitters || []).find(emitter => emitter.id === emitterSelect.value) || null;
    }

    function syncDetail() {
      detailEl.value = JSON.stringify(detailForEvent(selectedEvent()), null, 2);
    }

    function syncStateLink() {
      const roomId = encodeURIComponent(roomEl.value.trim() || "smoke");
      stateLinkEl.href = "https://digitalisierungsplanung.de/state.html?room=" + roomId;
    }

    async function loadCatalog() {
      statusEl.textContent = "Loading event catalog...";
      eventSelect.innerHTML = "";
      emitterSelect.innerHTML = "";
      const response = await fetch("/events", { cache: "no-store" });
      if (!response.ok) throw new Error("events failed with status " + response.status);
      catalog = await response.json();
      for (const emitter of catalog.emitters || []) {
        const option = document.createElement("option");
        option.value = emitter.id;
        option.textContent = (emitter.label || emitter.id) + " - " + emitter.id;
        emitterSelect.appendChild(option);
      }
      for (const event of catalog.events || []) {
        const option = document.createElement("option");
        option.value = event.name;
        option.textContent = (event.label || event.name) + " - " + event.name;
        eventSelect.appendChild(option);
      }
      if (!eventSelect.options.length) throw new Error("event catalog has no events");
      if (!emitterSelect.options.length) throw new Error("event catalog has no connectors");
      syncEventsForEmitter();
      statusEl.textContent = "Loaded " + eventSelect.options.length + " event(s).";
      syncDetail();
      syncStateLink();
    }

    function syncEventsForEmitter() {
      const emitter = selectedEmitter();
      const allowed = new Set(emitter?.events || []);
      for (const option of eventSelect.options) {
        option.hidden = allowed.size > 0 && !allowed.has(option.value);
        option.disabled = option.hidden;
      }
      const selected = eventSelect.selectedOptions[0];
      if (!selected || selected.disabled) {
        const first = [...eventSelect.options].find(option => !option.disabled);
        if (first) eventSelect.value = first.value;
      }
    }

    async function emitEvent(event) {
      event.preventDefault();
      const roomId = roomEl.value.trim();
      const clientId = clientEl.value.trim() || "console";
      const emitterId = emitterSelect.value;
      const name = eventSelect.value;
      const secret = secretEl.value.trim();
      if (!roomId || !emitterId || !name || !secret) {
        setResult("roomId, connector, event and secret are required.", false);
        return;
      }
      let detail;
      try {
        detail = JSON.parse(detailEl.value || "{}");
        if (!detail || typeof detail !== "object" || Array.isArray(detail)) throw new Error("detail must be an object");
      } catch (error) {
        setResult("Invalid detail JSON: " + error.message, false);
        return;
      }
      sendEl.disabled = true;
      try {
        const response = await fetch("/emit", {
          method: "POST",
          headers: {
            "authorization": "Bearer " + secret,
            "content-type": "application/json"
          },
          body: JSON.stringify({ roomId, clientId, emitterId, name, detail })
        });
        const payload = await response.json().catch(() => ({}));
        setResult(JSON.stringify({ status: response.status, ...payload }, null, 2), response.ok);
      } catch (error) {
        setResult("Emit failed: " + error.message, false);
      } finally {
        sendEl.disabled = false;
      }
    }

    new URLSearchParams(location.search).forEach((value, key) => {
      if (key === "room") roomEl.value = value;
      if (key === "client") clientEl.value = value;
    });
    roomEl.addEventListener("input", syncStateLink);
    emitterSelect.addEventListener("change", () => {
      syncEventsForEmitter();
      syncDetail();
    });
    eventSelect.addEventListener("change", syncDetail);
    document.getElementById("reload").addEventListener("click", () => loadCatalog().catch(error => {
      statusEl.textContent = "Event load failed.";
      setResult(error.message, false);
    }));
    document.getElementById("emitForm").addEventListener("submit", emitEvent);
    loadCatalog().catch(error => {
      statusEl.textContent = "Event load failed.";
      setResult(error.message, false);
    });
  </script>
</body>
</html>`;


function parseList(value, fallback = []) {
  if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean);
  const items = String(value || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
  return items.length ? items : [...fallback];
}

function parseInteger(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function presetApiError(code, status) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function normalizedPresetApiUrl(value) {
  let target;
  try {
    target = new URL(String(value || "").trim());
  } catch (_) {
    throw presetApiError("invalid_preset_api_url", 400);
  }
  if (target.protocol !== "https:" || !target.hostname || target.username || target.password || target.hash || target.href.length > 2048) {
    throw presetApiError("invalid_preset_api_url", 400);
  }
  const literalHost = target.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(literalHost) && !isPublicNetworkAddress(literalHost)) {
    throw presetApiError("preset_api_target_not_public", 400);
  }
  return target;
}

function isPublicNetworkAddress(address) {
  const value = String(address || "").toLowerCase().split("%")[0];
  const family = net.isIP(value);
  if (family === 4) {
    const [a, b] = value.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      a === 100 && b >= 64 && b <= 127 ||
      a === 169 && b === 254 ||
      a === 172 && b >= 16 && b <= 31 ||
      a === 192 && [0, 168].includes(b) ||
      a === 198 && [18, 19].includes(b) ||
      a === 198 && b === 51 ||
      a === 203 && b === 0);
  }
  if (family === 6) {
    return !(value === "::" || value === "::1" || value.startsWith("::ffff:") ||
      value.startsWith("fc") || value.startsWith("fd") || /^fe[89ab]/.test(value) ||
      value.startsWith("ff") || value.startsWith("2001:db8:"));
  }
  return false;
}

function publicPresetApiLookup(hostname, options, callback) {
  const lookupOptions = typeof options === "number" ? { family: options } : { ...(options || {}) };
  dns.lookup(hostname, { ...lookupOptions, all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      callback(presetApiError("preset_api_host_unavailable", 502));
      return;
    }
    const requestedFamily = Number(lookupOptions.family) || 0;
    const candidates = addresses.filter(item => !requestedFamily || item.family === requestedFamily);
    if (!candidates.length || candidates.some(item => !isPublicNetworkAddress(item.address))) {
      callback(presetApiError("preset_api_target_not_public", 400));
      return;
    }
    if (lookupOptions.all) callback(null, candidates);
    else callback(null, candidates[0].address, candidates[0].family);
  });
}

function fetchPresetApiDefinition(value) {
  const target = normalizedPresetApiUrl(value);
  return new Promise((resolve, reject) => {
    const request = https.request(target, {
      method: "GET",
      headers: { accept: "application/json" },
      lookup: publicPresetApiLookup
    }, response => {
      const status = Number(response.statusCode) || 0;
      if (status >= 300 && status < 400) {
        response.resume();
        reject(presetApiError("preset_api_redirect_not_allowed", 502));
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(presetApiError("preset_api_upstream_failed", 502));
        return;
      }
      if (!/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(String(response.headers["content-type"] || ""))) {
        response.resume();
        reject(presetApiError("preset_api_json_required", 415));
        return;
      }
      const declaredLength = Number(response.headers["content-length"] || 0);
      if (declaredLength > MAX_PRESET_API_RESPONSE_BYTES) {
        response.resume();
        reject(presetApiError("preset_api_response_too_large", 413));
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on("data", chunk => {
        bytes += chunk.length;
        if (bytes > MAX_PRESET_API_RESPONSE_BYTES) {
          response.destroy(presetApiError("preset_api_response_too_large", 413));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (_) {
          reject(presetApiError("invalid_preset_api_response", 422));
        }
      });
      response.on("error", error => reject(error?.code ? error : presetApiError("preset_api_fetch_failed", 502)));
    });
    request.setTimeout(PRESET_API_TIMEOUT_MS, () => request.destroy(presetApiError("preset_api_timeout", 504)));
    request.on("error", error => reject(error?.status ? error : presetApiError("preset_api_fetch_failed", 502)));
    request.end();
  });
}

function imageInlineError(code, status) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function normalizedPublicImageUrl(value) {
  let target;
  try {
    target = new URL(String(value || "").trim());
  } catch (_) {
    throw imageInlineError("invalid_image_url", 400);
  }
  if (!["http:", "https:"].includes(target.protocol) || !target.hostname || target.username || target.password || target.hash || target.href.length > 4096) {
    throw imageInlineError("invalid_image_url", 400);
  }
  const literalHost = target.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(literalHost) && !isPublicNetworkAddress(literalHost)) {
    throw imageInlineError("image_target_not_public", 400);
  }
  return target;
}

function publicImageLookup(hostname, options, callback) {
  const lookupOptions = typeof options === "number" ? { family: options } : { ...(options || {}) };
  dns.lookup(hostname, { ...lookupOptions, all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      callback(imageInlineError("image_host_unavailable", 502));
      return;
    }
    const requestedFamily = Number(lookupOptions.family) || 0;
    const candidates = addresses.filter(item => !requestedFamily || item.family === requestedFamily);
    if (!candidates.length || candidates.some(item => !isPublicNetworkAddress(item.address))) {
      callback(imageInlineError("image_target_not_public", 400));
      return;
    }
    if (lookupOptions.all) callback(null, candidates);
    else callback(null, candidates[0].address, candidates[0].family);
  });
}

function fetchPublicImageAsset(value, options = {}) {
  const target = normalizedPublicImageUrl(value);
  const maxBytes = parseInteger(options.maxBytes, MAX_IMAGE_INLINE_BYTES, 1024, MAX_IMAGE_INLINE_BYTES);
  const transport = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(target, {
      method: "GET",
      headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml,image/*;q=0.8" },
      lookup: publicImageLookup
    }, response => {
      const status = Number(response.statusCode) || 0;
      if (status >= 300 && status < 400) {
        response.resume();
        reject(imageInlineError("image_redirect_not_allowed", 502));
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(imageInlineError("image_upstream_failed", 502));
        return;
      }
      const mimeType = String(response.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      if (!/^image\/[a-z0-9.+-]+$/i.test(mimeType)) {
        response.resume();
        reject(imageInlineError("image_response_not_image", 415));
        return;
      }
      const declaredLength = Number(response.headers["content-length"] || 0);
      if (declaredLength > maxBytes) {
        response.resume();
        reject(imageInlineError("image_response_too_large", 413));
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on("data", chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          response.destroy(imageInlineError("image_response_too_large", 413));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({
        mimeType,
        buffer: Buffer.concat(chunks)
      }));
      response.on("error", error => reject(error?.status ? error : imageInlineError("image_fetch_failed", 502)));
    });
    request.setTimeout(IMAGE_INLINE_TIMEOUT_MS, () => request.destroy(imageInlineError("image_fetch_timeout", 504)));
    request.on("error", error => reject(error?.status ? error : imageInlineError("image_fetch_failed", 502)));
    request.end();
  });
}

function defaultGitRunner(args, options = {}) {
  return spawnSync("git", args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: "utf8"
  });
}

function loadEventCatalog(options = {}, env = process.env) {
  return eventCatalog.loadEventCatalog(options, env);
}

function loadConfig(options = {}) {
  const env = options.env || process.env;
  const roomSecret = options.roomSecret ?? env.REALTIME_ROOM_SECRET ?? "";
  const emitSecret = options.emitSecret ?? env.REALTIME_EMIT_SECRET ?? "";
  const nodeEnv = options.nodeEnv || env.NODE_ENV || "development";
  const repoDir = path.resolve(options.repoDir || env.REALTIME_REPO_DIR || process.cwd());
  const releaseFile = path.resolve(options.releaseFile || env.ZUSTAND_RELEASE_FILE || path.join(repoDir, "release-version.js"));
  const presetLibraryPath = path.resolve(options.presetLibraryPath || env.REALTIME_PRESET_LIBRARY_PATH || presetLibrary.DEFAULT_PRESET_LIBRARY_PATH);
  const allowUnsignedRooms = options.allowUnsignedRooms ?? (
    String(env.REALTIME_ALLOW_UNSIGNED_ROOMS || "").toLowerCase() === "true"
  );

  return {
    host: options.host || env.REALTIME_HOST || DEFAULT_HOST,
    port: parseInteger(options.port ?? env.REALTIME_PORT, DEFAULT_PORT, 1, 65535),
    path: options.path || env.REALTIME_PATH || DEFAULT_PATH,
    tokenPath: options.tokenPath || env.REALTIME_TOKEN_PATH || DEFAULT_TOKEN_PATH,
    eventsPath: options.eventsPath || env.REALTIME_EVENTS_PATH || DEFAULT_EVENTS_PATH,
    productContractPath: options.productContractPath || env.REALTIME_PRODUCT_CONTRACT_PATH || DEFAULT_PRODUCT_CONTRACT_PATH,
    emitPath: options.emitPath || env.REALTIME_EMIT_PATH || DEFAULT_EMIT_PATH,
    adminPath: options.adminPath || env.REALTIME_ADMIN_PATH || DEFAULT_ADMIN_PATH,
    adminRoutesPath: options.adminRoutesPath || env.REALTIME_ADMIN_ROUTES_PATH || DEFAULT_ADMIN_ROUTES_PATH,
    consolePath: options.consolePath || env.REALTIME_CONSOLE_PATH || DEFAULT_CONSOLE_PATH,
    eventsAdminPath: options.eventsAdminPath || env.REALTIME_EVENTS_ADMIN_PATH || DEFAULT_EVENTS_ADMIN_PATH,
    eventsAdminCatalogPath: options.eventsAdminCatalogPath || env.REALTIME_EVENTS_ADMIN_CATALOG_PATH || DEFAULT_EVENTS_ADMIN_CATALOG_PATH,
    presetsAdminPath: options.presetsAdminPath || env.REALTIME_PRESETS_ADMIN_PATH || DEFAULT_PRESETS_ADMIN_PATH,
    presetsAdminCatalogPath: options.presetsAdminCatalogPath || env.REALTIME_PRESETS_ADMIN_CATALOG_PATH || DEFAULT_PRESETS_ADMIN_CATALOG_PATH,
    presetsAdminParsePath: options.presetsAdminParsePath || env.REALTIME_PRESETS_ADMIN_PARSE_PATH || DEFAULT_PRESETS_ADMIN_PARSE_PATH,
    presetsAdminImportPath: options.presetsAdminImportPath || env.REALTIME_PRESETS_ADMIN_IMPORT_PATH || DEFAULT_PRESETS_ADMIN_IMPORT_PATH,
    imageInlinePath: options.imageInlinePath || env.REALTIME_IMAGE_INLINE_PATH || DEFAULT_IMAGE_INLINE_PATH,
    mcpPath: options.mcpPath || env.REALTIME_MCP_PATH || DEFAULT_MCP_PATH,
    versionPath: options.versionPath || env.REALTIME_VERSION_PATH || DEFAULT_VERSION_PATH,
    eventCatalogPath: path.resolve(options.eventCatalogPath || env.REALTIME_EVENT_CATALOG_PATH || eventCatalog.DEFAULT_EVENT_CATALOG_PATH),
    adminHtmlPath: path.resolve(options.adminHtmlPath || env.REALTIME_ADMIN_HTML_PATH || path.join(__dirname, "admin.html")),
    eventAdminHtmlPath: path.resolve(options.eventAdminHtmlPath || env.REALTIME_EVENT_ADMIN_HTML_PATH || path.join(__dirname, "events-admin.html")),
    presetLibraryPath,
    presetAdminHtmlPath: path.resolve(options.presetAdminHtmlPath || env.REALTIME_PRESET_ADMIN_HTML_PATH || path.join(__dirname, "presets-admin.html")),
    repoDir,
    releaseFile,
    adminSecret: options.adminSecret ?? env.REALTIME_ADMIN_SECRET ?? "",
    mcpSecret: options.mcpSecret ?? env.REALTIME_MCP_SECRET ?? env.MCP_SECRET ?? "",
    gitPushToken: options.gitPushToken ?? env.REALTIME_GIT_PUSH_TOKEN ?? "",
    gitRunner: options.gitRunner || defaultGitRunner,
    presetApiFetcher: options.presetApiFetcher || fetchPresetApiDefinition,
    imageInlineFetcher: options.imageInlineFetcher || fetchPublicImageAsset,
    allowedOrigins: parseList(
      options.allowedOrigins ?? env.REALTIME_ALLOWED_ORIGINS,
      DEFAULT_ALLOWED_ORIGINS
    ),
    maxPayload: parseInteger(options.maxPayload ?? env.REALTIME_MAX_PAYLOAD_BYTES, 64 * 1024, 1024),
    maxImageInlineBytes: parseInteger(options.maxImageInlineBytes ?? env.REALTIME_MAX_IMAGE_INLINE_BYTES, MAX_IMAGE_INLINE_BYTES, 1024, MAX_IMAGE_INLINE_BYTES),
    heartbeatMs: parseInteger(options.heartbeatMs ?? env.REALTIME_HEARTBEAT_MS, 30000, 1000),
    rateLimitWindowMs: parseInteger(options.rateLimitWindowMs ?? env.REALTIME_RATE_WINDOW_MS, 10000, 1000),
    rateLimitMax: parseInteger(options.rateLimitMax ?? env.REALTIME_RATE_LIMIT, 360, 1),
    tokenTtlMs: parseInteger(options.tokenTtlMs ?? env.REALTIME_ROOM_TOKEN_TTL_MS, 60 * 60 * 1000, 1000),
    roomSecret,
    emitSecret,
    release: options.release || loadReleaseInfo({ env, path: releaseFile }),
    eventCatalog: loadEventCatalog(options, env),
    presetLibrary: options.presetLibrary || presetLibrary.loadPresetLibraryFile(presetLibraryPath),
    mcpModelPath: path.resolve(options.mcpModelPath || env.STATE_BLUEPRINT_MODEL_PATH || path.join(repoDir, "state-blueprint.workspace.json")),
    allowUnsignedRooms: Boolean(allowUnsignedRooms),
    requireRoomSecret: options.requireRoomSecret ?? (nodeEnv === "production" && !allowUnsignedRooms)
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeId(value) {
  const text = String(value || "").trim();
  if (!text || text.length > MAX_ID_LENGTH) return "";
  return /^[a-zA-Z0-9_.:-]+$/.test(text) ? text : "";
}

function sanitizeEventName(value) {
  const text = String(value || "").trim();
  if (!text || text.length > MAX_EVENT_NAME_LENGTH) return "";
  return /^[a-zA-Z0-9_.:-]+$/.test(text) ? text : "";
}

function toBase64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function fromBase64UrlJson(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function signTokenBody(body, secret) {
  return crypto.createHmac("sha256", String(secret)).update(body).digest("base64url");
}

function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createRoomToken({ roomId, clientId = "", secret, ttlMs = 60 * 60 * 1000, now = Date.now() }) {
  const normalizedRoomId = sanitizeId(roomId);
  const normalizedClientId = clientId ? sanitizeId(clientId) : "";
  if (!normalizedRoomId) throw new Error("roomId is required");
  if (clientId && !normalizedClientId) throw new Error("clientId is invalid");
  if (!secret) throw new Error("secret is required");

  const payload = {
    roomId: normalizedRoomId,
    clientId: normalizedClientId || undefined,
    iat: now,
    exp: now + ttlMs
  };
  const body = toBase64UrlJson(payload);
  return `${body}.${signTokenBody(body, secret)}`;
}

function verifyRoomToken(token, { roomId, clientId, secret, now = Date.now() }) {
  if (!secret) return { ok: false, code: "missing_secret" };
  const [body, signature, extra] = String(token || "").split(".");
  if (!body || !signature || extra !== undefined) return { ok: false, code: "malformed_token" };

  const expected = signTokenBody(body, secret);
  if (!timingSafeEqualString(signature, expected)) return { ok: false, code: "bad_signature" };

  let payload;
  try {
    payload = fromBase64UrlJson(body);
  } catch (_) {
    return { ok: false, code: "bad_payload" };
  }

  if (payload.roomId !== roomId) return { ok: false, code: "room_mismatch" };
  if (payload.clientId && payload.clientId !== clientId) return { ok: false, code: "client_mismatch" };
  if (!Number.isFinite(payload.exp) || payload.exp < now) return { ok: false, code: "expired_token" };
  return { ok: true, payload };
}

function rejectUpgrade(socket, statusCode, reason) {
  socket.write(`HTTP/1.1 ${statusCode} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function writeJson(response, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    ...headers
  });
  response.end(body);
}

function writeHtml(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; connect-src 'self' https://cdn.jsdelivr.net; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' https: data: blob:; frame-src 'self' blob: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-length": Buffer.byteLength(body),
    ...headers
  });
  response.end(body);
}

function bearerToken(request) {
  const header = String(request.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function mcpAuthSecrets(config) {
  return [...new Set([
    config.mcpSecret,
    config.adminSecret,
    config.emitSecret
  ].map(secret => String(secret || "")).filter(Boolean))];
}

function readJsonBody(request, maxBytes = MAX_EMIT_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on("data", chunk => {
      total += chunk.length;
      if (total <= maxBytes) chunks.push(chunk);
    });
    request.on("error", reject);
    request.on("end", () => {
      if (total > maxBytes) {
        const error = new Error("payload_too_large");
        error.code = "payload_too_large";
        reject(error);
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        resolve(parsed);
      } catch (_) {
        const error = new Error("invalid_json");
        error.code = "invalid_json";
        reject(error);
      }
    });
  });
}

function publicBaseUrl(request) {
  const proto = String(request.headers["x-forwarded-proto"] || "http").split(",")[0].trim() || "http";
  const host = String(request.headers["x-forwarded-host"] || request.headers.host || "localhost").split(",")[0].trim();
  return `${proto}://${host}`;
}

function eventCatalogResponse(config) {
  return {
    ...eventCatalog.eventCatalogResponse(config.eventCatalog),
    release: releaseResponse(config)
  };
}

function releaseResponse(config) {
  return {
    ok: true,
    releaseId: config.release.id,
    releaseSequence: config.release.sequence,
    builtAt: config.release.builtAt,
    sourceCommit: config.release.sourceCommit,
    deployedCommit: config.release.deployedCommit
  };
}

function cleanCommitMessage(value, fallback = DEFAULT_ADMIN_COMMIT_MESSAGE) {
  const text = String(value || "").replace(/[\r\n]+/g, " ").trim();
  return (text || fallback).slice(0, 120);
}

function serializeReleaseInfo(release) {
  return `globalThis.ZUSTAND_RELEASE_SEQUENCE = ${Math.max(0, release.sequence || 0)};\n` +
    `globalThis.ZUSTAND_RELEASE_ID = ${JSON.stringify(release.id || "dev-local")};\n` +
    `globalThis.ZUSTAND_RELEASE_BUILT_AT = ${JSON.stringify(release.builtAt || "")};\n` +
    `globalThis.ZUSTAND_RELEASE_SOURCE = ${JSON.stringify(release.sourceCommit || "")};\n`;
}

function readFileRelease(config) {
  try {
    return parseReleaseSource(fs.readFileSync(config.releaseFile, "utf8"));
  } catch (_) {
    return config.release;
  }
}

function nextReleaseInfo(config) {
  const current = readFileRelease(config);
  const currentSequence = Number.isSafeInteger(current.sequence) && current.sequence > 0
    ? current.sequence
    : Number.isSafeInteger(config.release.sequence) ? config.release.sequence : 0;
  return {
    id: `release-${currentSequence + 1}`,
    sequence: currentSequence + 1,
    builtAt: new Date().toISOString(),
    sourceCommit: currentShortCommit(config),
    deployedCommit: ""
  };
}

function gitFailure(code, result, status = 500) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  error.gitStatus = result?.status;
  error.gitStdout = String(result?.stdout || "");
  error.gitStderr = String(result?.stderr || "");
  return error;
}

function errorJson(error, fallback) {
  const payload = { error: error.code || fallback };
  const detail = String(error.gitStderr || error.gitStdout || "").trim();
  if (detail && detail !== payload.error) payload.detail = detail.slice(0, 1200);
  return payload;
}

function runGit(config, args, code) {
  const result = config.gitRunner(args, {
    cwd: config.repoDir,
    env: process.env
  });
  if (!result || result.status !== 0) throw gitFailure(code, result);
  return result;
}

function repoRelativePath(repoDir, absolutePath) {
  const relative = path.relative(repoDir, absolutePath).replaceAll("\\", "/");
  if (!relative || relative.startsWith("../") || path.isAbsolute(relative)) {
    const error = new Error("catalog_path_outside_repo");
    error.code = "catalog_path_outside_repo";
    error.status = 500;
    throw error;
  }
  return relative;
}

function pushCurrentHead(config) {
  const pushArgs = config.gitPushToken
    ? [
        "-c",
        `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${config.gitPushToken}`).toString("base64")}`,
        "push",
        "origin",
        "HEAD:main"
      ]
    : ["push", "origin", "HEAD:main"];
  runGit(config, pushArgs, "git_push_failed");
}

function currentShortCommit(config) {
  const rev = runGit(config, ["rev-parse", "--short", "HEAD"], "git_rev_parse_failed");
  return String(rev.stdout || "").trim();
}

function localAheadCount(config) {
  const result = config.gitRunner(["rev-list", "--count", "@{u}..HEAD"], {
    cwd: config.repoDir,
    env: process.env
  });
  if (!result || result.status !== 0) return 0;
  const count = Number.parseInt(String(result.stdout || "").trim(), 10);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function gitRevListCount(config, range) {
  const result = config.gitRunner(["rev-list", "--count", range], {
    cwd: config.repoDir,
    env: process.env
  });
  if (!result || result.status !== 0) return 0;
  const count = Number.parseInt(String(result.stdout || "").trim(), 10);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function syncManagedCatalogBase(config) {
  runGit(config, ["fetch", "origin", "main"], "git_fetch_failed");
  const status = runGit(config, ["status", "--porcelain"], "git_status_failed");
  const dirty = String(status.stdout || "").trim();
  if (dirty) throw gitFailure("git_worktree_dirty", { status: 1, stdout: dirty, stderr: "repository has uncommitted changes" }, 409);
  const ahead = gitRevListCount(config, "origin/main..HEAD");
  const behind = gitRevListCount(config, "HEAD..origin/main");
  if (ahead > 0 && behind > 0) {
    throw gitFailure("git_branch_diverged", { status: 1, stdout: "", stderr: "local main diverged from origin/main" }, 409);
  }
  if (behind > 0) runGit(config, ["reset", "--hard", "origin/main"], "git_sync_failed");
}

function writeManagedCatalogCommitAndPush(config, options) {
  syncManagedCatalogBase(config);
  const relativeCatalogPath = repoRelativePath(config.repoDir, options.catalogPath);
  const relativeReleasePath = repoRelativePath(config.repoDir, config.releaseFile);
  fs.writeFileSync(options.catalogPath, options.serialized, { encoding: "utf8", mode: 0o644 });

  const unstaged = config.gitRunner(["diff", "--quiet", "--", relativeCatalogPath], {
    cwd: config.repoDir,
    env: process.env
  });
  if (!unstaged) throw gitFailure("git_diff_failed", unstaged);
  const staged = config.gitRunner(["diff", "--cached", "--quiet", "--", relativeCatalogPath], {
    cwd: config.repoDir,
    env: process.env
  });
  if (!staged) throw gitFailure("git_diff_failed", staged);
  if (![0, 1].includes(unstaged.status) || ![0, 1].includes(staged.status)) throw gitFailure("git_diff_failed", unstaged.status !== 0 ? unstaged : staged);
  if (unstaged.status === 0 && staged.status === 0) {
    if (localAheadCount(config) > 0) {
      pushCurrentHead(config);
      return { ok: true, changed: true, commit: currentShortCommit(config) };
    }
    return { ok: true, changed: false };
  }

  const release = nextReleaseInfo(config);
  fs.writeFileSync(config.releaseFile, serializeReleaseInfo(release), { encoding: "utf8", mode: 0o644 });

  runGit(config, ["add", "--", relativeCatalogPath, relativeReleasePath], "git_add_failed");
  const baseMessage = cleanCommitMessage(options.message, options.defaultMessage);
  const commitMessage = baseMessage.includes(release.id) ? baseMessage : `${baseMessage} (${release.id})`;
  runGit(config, [
    "-c",
    `user.name=${options.authorName}`,
    "-c",
    `user.email=${options.authorEmail}`,
    "commit",
    "-m",
    commitMessage,
    "--",
    relativeCatalogPath,
    relativeReleasePath
  ], "git_commit_failed");

  pushCurrentHead(config);
  const commit = currentShortCommit(config);
  return {
    ok: true,
    changed: true,
    commit,
    releaseId: release.id,
    releaseSequence: release.sequence,
    release: { ...release, deployedCommit: commit }
  };
}

function writeCatalogCommitAndPush(config, catalog, message) {
  return writeManagedCatalogCommitAndPush(config, {
    catalogPath: config.eventCatalogPath,
    serialized: eventCatalog.serializeEventCatalog(catalog),
    message,
    defaultMessage: DEFAULT_ADMIN_COMMIT_MESSAGE,
    authorName: "Realtime Event Designer",
    authorEmail: "realtime-events@digitalisierungsplanung.de"
  });
}

function writePresetLibraryCommitAndPush(config, library, message) {
  return writeManagedCatalogCommitAndPush(config, {
    catalogPath: config.presetLibraryPath,
    serialized: presetLibrary.serializePresetLibrary(library),
    message,
    defaultMessage: DEFAULT_PRESET_ADMIN_COMMIT_MESSAGE,
    authorName: "Preset Designer",
    authorEmail: "presets@digitalisierungsplanung.de"
  });
}

function createRoom(roomId) {
  return {
    id: roomId,
    clients: new Set(),
    seenSeq: new Map()
  };
}

function serializeForBroadcast(message, state, room) {
  const base = {
    type: message.type,
    roomId: state.roomId,
    clientId: state.clientId,
    serverTime: Date.now()
  };
  if (Number.isSafeInteger(message.seq)) base.seq = message.seq;

  if (message.type === "runtime.event") {
    return {
      ...base,
      name: message.name,
      detail: message.detail || {},
      emitterId: message.emitterId || ""
    };
  }

  return null;
}

function parseJsonMessage(data) {
  const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data || "");
  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function validateJoinMessage(message) {
  if (!message || message.type !== "join") return { ok: false, code: "join_required" };
  const roomId = sanitizeId(message.roomId);
  const clientId = sanitizeId(message.clientId);
  if (!roomId) return { ok: false, code: "invalid_room" };
  if (!clientId) return { ok: false, code: "invalid_client" };
  return { ok: true, roomId, clientId, token: message.token || "" };
}

function validateRealtimeMessage(message, offeredEventsByName = new Map(), offeredEmittersById = new Map()) {
  if (!message || !MESSAGE_TYPES.has(message.type)) return { ok: false, code: "invalid_type" };
  if (message.seq !== undefined && !Number.isSafeInteger(message.seq)) return { ok: false, code: "invalid_seq" };

  if (message.type === "runtime.event") {
    const name = sanitizeEventName(message.name);
    if (!name || !name.startsWith("realtime.")) return { ok: false, code: "invalid_event_name" };
    const offered = offeredEventsByName.get(name);
    if (!offered) return { ok: false, code: "event_not_offered" };
    const detail = message.detail === undefined ? {} : message.detail;
    const detailValidation = eventCatalog.validateEventDetail(detail, offered.detail);
    if (!detailValidation.ok) return detailValidation;
    const emitterId = message.emitterId ? sanitizeId(message.emitterId) : "";
    if (message.emitterId && !emitterId) return { ok: false, code: "invalid_emitter" };
    if (emitterId) {
      const emitter = offeredEmittersById.get(emitterId);
      if (!emitter) return { ok: false, code: "emitter_not_offered" };
      if (!emitter.events.includes(name)) return { ok: false, code: "emitter_event_not_allowed" };
    }
    message.name = name;
    message.detail = detail;
    message.emitterId = emitterId;
  }

  return { ok: true, message };
}

function sendJson(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(payload));
  return true;
}

function sendError(socket, code, close = false) {
  sendJson(socket, { type: "error", code });
  if (close) socket.close(1008, code);
}

function createRealtimeServer(options = {}) {
  const config = loadConfig(options);
  const allowedOrigins = new Set(config.allowedOrigins);
  let offeredEventsByName = new Map();
  let offeredEmittersById = new Map();
  const rooms = new Map();
  const setEventCatalog = catalog => {
    config.eventCatalog = eventCatalog.validateEventCatalog(catalog);
    offeredEventsByName = new Map(config.eventCatalog.events.map(event => [event.name, event]));
    offeredEmittersById = new Map(config.eventCatalog.emitters.map(emitter => [emitter.id, emitter]));
  };
  setEventCatalog(config.eventCatalog);
  const setPresetLibrary = library => {
    config.presetLibrary = presetLibrary.validatePresetLibrary(library);
  };
  setPresetLibrary(config.presetLibrary);
  const isOriginAllowed = origin => allowedOrigins.has("*") || allowedOrigins.has(origin);
  const isSamePublicOrigin = (origin, request) => Boolean(origin) && origin === publicBaseUrl(request);
  const corsHeadersForOrigin = (origin, request) => {
    if (!origin || !isOriginAllowed(origin) && !isSamePublicOrigin(origin, request)) return null;
    return {
      "access-control-allow-origin": allowedOrigins.has("*") ? "*" : origin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
      "vary": "Origin"
    };
  };
  const adminHeadersForRequest = (request) => {
    const origin = request.headers.origin || "";
    if (!origin) return {};
    if (!isSamePublicOrigin(origin, request)) return null;
    return {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
      "vary": "Origin"
    };
  };
  const prepareAdminResponse = (request, response) => {
    const headers = adminHeadersForRequest(request);
    if (!headers) {
      writeJson(response, 403, { error: "origin_not_allowed" });
      return { done: true };
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204, headers);
      response.end();
      return { done: true };
    }
    if (!config.adminSecret) {
      writeJson(response, 503, { error: "admin_secret_required" }, headers);
      return { done: true };
    }
    if (!timingSafeEqualString(bearerToken(request), config.adminSecret)) {
      writeJson(response, 401, { error: "unauthorized" }, headers);
      return { done: true };
    }
    return { done: false, headers };
  };
  const prepareCatalogResponse = (request, response) => {
    const origin = request.headers.origin || "";
    const headers = origin ? corsHeadersForOrigin(origin, request) : {};
    if (!headers) {
      writeJson(response, 403, { error: "origin_not_allowed" });
      return { done: true };
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204, headers);
      response.end();
      return { done: true };
    }
    return { done: false, headers };
  };
  const prepareMcpResponse = (request, response) => {
    const origin = request.headers.origin || "";
    const headers = origin ? adminHeadersForRequest(request) : {};
    if (!headers) {
      writeJson(response, 403, { error: "origin_not_allowed" });
      return { done: true };
    }
    const mcpHeaders = {
      ...headers,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id"
    };
    if (request.method === "OPTIONS") {
      response.writeHead(204, mcpHeaders);
      response.end();
      return { done: true };
    }
    const secrets = mcpAuthSecrets(config);
    if (!secrets.length) {
      writeJson(response, 503, { error: "mcp_secret_required" }, mcpHeaders);
      return { done: true };
    }
    const token = bearerToken(request);
    if (!secrets.some(secret => timingSafeEqualString(token, secret))) {
      writeJson(response, 401, { error: "unauthorized" }, mcpHeaders);
      return { done: true };
    }
    return { done: false, headers: mcpHeaders };
  };

  const server = options.server || http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/healthz") {
      const clients = [...rooms.values()].reduce((sum, room) => sum + room.clients.size, 0);
      writeJson(response, 200, { ...releaseResponse(config), rooms: rooms.size, clients });
      return;
    }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === config.adminPath)) {
      writeHtml(response, 200, fs.readFileSync(config.adminHtmlPath, "utf8"));
      return;
    }
    if ((request.method === "GET" || request.method === "OPTIONS") && url.pathname === config.adminRoutesPath) {
      const prepared = prepareCatalogResponse(request, response);
      if (prepared.done) return;
      writeJson(response, 200, {
        ...adminTools.adminRouteIndex(config),
        release: releaseResponse(config)
      }, prepared.headers);
      return;
    }
    if ((request.method === "GET" || request.method === "OPTIONS") && url.pathname === config.versionPath) {
      const prepared = prepareCatalogResponse(request, response);
      if (prepared.done) return;
      writeJson(response, 200, releaseResponse(config), prepared.headers);
      return;
    }
    if (request.method === "GET" && url.pathname === config.consolePath) {
      writeHtml(response, 200, CONSOLE_HTML);
      return;
    }
    if (request.method === "GET" && url.pathname === config.eventsAdminPath) {
      writeHtml(response, 200, fs.readFileSync(config.eventAdminHtmlPath, "utf8"));
      return;
    }
    if ((request.method === "GET" || request.method === "POST" || request.method === "OPTIONS") && url.pathname === config.eventsAdminCatalogPath) {
      void handleAdminCatalogRequest(request, response);
      return;
    }
    if (request.method === "GET" && url.pathname === config.presetsAdminPath) {
      writeHtml(response, 200, fs.readFileSync(config.presetAdminHtmlPath, "utf8"));
      return;
    }
    if ((request.method === "GET" || request.method === "POST" || request.method === "OPTIONS") && url.pathname === config.presetsAdminCatalogPath) {
      void handlePresetCatalogRequest(request, response);
      return;
    }
    if ((request.method === "POST" || request.method === "OPTIONS") && url.pathname === config.presetsAdminParsePath) {
      void handlePresetParseRequest(request, response);
      return;
    }
    if ((request.method === "POST" || request.method === "OPTIONS") && url.pathname === config.presetsAdminImportPath) {
      void handlePresetImportRequest(request, response);
      return;
    }
    if ((request.method === "POST" || request.method === "OPTIONS") && url.pathname === config.imageInlinePath) {
      void handleImageInlineRequest(request, response);
      return;
    }
    if ((request.method === "POST" || request.method === "OPTIONS") && url.pathname === config.mcpPath) {
      void handleMcpRequest(request, response);
      return;
    }
    if ((request.method === "GET" || request.method === "OPTIONS") && url.pathname === config.eventsPath) {
      const prepared = prepareCatalogResponse(request, response);
      if (prepared.done) return;
      writeJson(response, 200, eventCatalogResponse(config), prepared.headers);
      return;
    }
    if ((request.method === "GET" || request.method === "OPTIONS") && url.pathname === config.productContractPath) {
      const prepared = prepareCatalogResponse(request, response);
      if (prepared.done) return;
      writeJson(response, 200, {
        ...productContract.productContractResponse(config),
        release: releaseResponse(config)
      }, prepared.headers);
      return;
    }
    if ((request.method === "POST" || request.method === "OPTIONS") && url.pathname === config.emitPath) {
      void handleEmitRequest(request, response);
      return;
    }
    if ((request.method === "GET" || request.method === "OPTIONS") && url.pathname === config.tokenPath) {
      const headers = corsHeadersForOrigin(request.headers.origin || "", request);
      if (!headers) {
        writeJson(response, 403, { error: "origin_not_allowed" });
        return;
      }
      if (request.method === "OPTIONS") {
        response.writeHead(204, headers);
        response.end();
        return;
      }
      const roomId = sanitizeId(url.searchParams.get("roomId"));
      const clientId = sanitizeId(url.searchParams.get("clientId"));
      if (!roomId || !clientId) {
        writeJson(response, 400, { error: "invalid_room_or_client" }, headers);
        return;
      }
      if (!config.roomSecret) {
        writeJson(response, 503, { error: "room_secret_required" }, headers);
        return;
      }
      writeJson(response, 200, {
        roomId,
        clientId,
        token: createRoomToken({
          roomId,
          clientId,
          secret: config.roomSecret,
          ttlMs: config.tokenTtlMs
        }),
        expiresInMs: config.tokenTtlMs
      }, headers);
      return;
    }
    writeJson(response, 404, { error: "not_found" });
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.maxPayload
  });

  function getRoom(roomId) {
    const existing = rooms.get(roomId);
    if (existing) return existing;
    const room = createRoom(roomId);
    rooms.set(roomId, room);
    return room;
  }

  function broadcast(room, sourceSocket, payload) {
    const body = JSON.stringify(payload);
    let delivered = 0;
    for (const peer of room.clients) {
      if (peer === sourceSocket || peer.readyState !== WebSocket.OPEN) continue;
      peer.send(body);
      delivered += 1;
    }
    return delivered;
  }

  function validateEmitPayload(payload) {
    if (!isPlainObject(payload)) return { ok: false, code: "invalid_json" };
    const roomId = sanitizeId(payload.roomId);
    const clientId = sanitizeId(payload.clientId || "server");
    const name = sanitizeEventName(payload.name || "");
    const emitterId = sanitizeId(payload.emitterId || "");
    if (!roomId) return { ok: false, code: "invalid_room" };
    if (!clientId) return { ok: false, code: "invalid_client" };
    if (!name || !name.startsWith("realtime.")) return { ok: false, code: "invalid_event_name" };
    const offered = offeredEventsByName.get(name);
    if (!offered) return { ok: false, code: "event_not_offered" };
    if (!emitterId) return { ok: false, code: "invalid_emitter" };
    const emitter = offeredEmittersById.get(emitterId);
    if (!emitter) return { ok: false, code: "emitter_not_offered" };
    if (!emitter.events.includes(name)) return { ok: false, code: "emitter_event_not_allowed" };
    const detail = payload.detail === undefined ? {} : payload.detail;
    const detailValidation = eventCatalog.validateEventDetail(detail, offered.detail);
    if (!detailValidation.ok) return detailValidation;
    return {
      ok: true,
      roomId,
      clientId,
      emitterId,
      name,
      detail
    };
  }

  async function handleAdminCatalogRequest(request, response) {
    const requestUrl = new URL(request.url || "/", "http://localhost");
    const prepared = prepareAdminResponse(request, response);
    if (prepared.done) return;
    const headers = prepared.headers;

    if (request.method === "GET") {
      try {
        const catalog = eventCatalog.loadEventCatalogFile(config.eventCatalogPath);
        setEventCatalog(catalog);
        writeJson(response, 200, {
          catalog,
          release: releaseResponse(config)
        }, headers);
      } catch (error) {
        writeJson(response, error.status || 500, { error: error.code || "catalog_load_failed" }, headers);
      }
      return;
    }

    let payload;
    try {
      payload = await readJsonBody(request, config.maxPayload);
    } catch (error) {
      const status = error.code === "payload_too_large" ? 413 : 400;
      writeJson(response, status, { error: error.code || "invalid_json" }, headers);
      return;
    }

    try {
      const catalog = eventCatalog.validateEventCatalog(payload.catalog);
      if (payload.validateOnly === true || requestUrl.searchParams.get("validate") === "1") {
        writeJson(response, 200, { ok: true, catalog }, headers);
        return;
      }
      const result = writeCatalogCommitAndPush(config, catalog, payload.message);
      setEventCatalog(catalog);
      if (result.release) config.release = result.release;
      writeJson(response, 200, result, headers);
    } catch (error) {
      writeJson(response, error.status || 500, errorJson(error, "event_catalog_save_failed"), headers);
    }
  }

  async function handlePresetCatalogRequest(request, response) {
    const requestUrl = new URL(request.url || "/", "http://localhost");
    const prepared = prepareAdminResponse(request, response);
    if (prepared.done) return;
    const headers = prepared.headers;

    if (request.method === "GET") {
      try {
        const library = presetLibrary.loadPresetLibraryFile(config.presetLibraryPath);
        setPresetLibrary(library);
        writeJson(response, 200, {
          library,
          supportedVariants: [...presetLibrary.SUPPORTED_VARIANTS].sort(),
          release: releaseResponse(config)
        }, headers);
      } catch (error) {
        writeJson(response, error.status || 500, { error: error.code || "preset_library_load_failed" }, headers);
      }
      return;
    }

    let payload;
    try {
      payload = await readJsonBody(request, config.maxPayload);
    } catch (error) {
      const status = error.code === "payload_too_large" ? 413 : 400;
      writeJson(response, status, { error: error.code || "invalid_json" }, headers);
      return;
    }

    try {
      const library = presetLibrary.validatePresetLibrary(payload.library);
      if (payload.validateOnly === true || requestUrl.searchParams.get("validate") === "1") {
        writeJson(response, 200, { ok: true, library }, headers);
        return;
      }
      const result = writePresetLibraryCommitAndPush(config, library, payload.message);
      setPresetLibrary(library);
      if (result.release) config.release = result.release;
      writeJson(response, 200, result, headers);
    } catch (error) {
      writeJson(response, error.status || 500, errorJson(error, "preset_library_save_failed"), headers);
    }
  }

  async function handlePresetParseRequest(request, response) {
    const prepared = prepareAdminResponse(request, response);
    if (prepared.done) return;
    const headers = prepared.headers;
    let payload;
    try {
      payload = await readJsonBody(request, config.maxPayload);
    } catch (error) {
      const status = error.code === "payload_too_large" ? 413 : 400;
      writeJson(response, status, { error: error.code || "invalid_json" }, headers);
      return;
    }
    try {
      writeJson(response, 200, {
        ok: true,
        preset: presetLibrary.parseDaisySnippet(payload),
        daisyVersion: presetLibrary.DAISY_VERSION
      }, headers);
    } catch (error) {
      writeJson(response, error.status || 400, { error: error.code || "snippet_parse_failed" }, headers);
    }
  }

  async function handlePresetImportRequest(request, response) {
    const prepared = prepareAdminResponse(request, response);
    if (prepared.done) return;
    const headers = prepared.headers;
    let payload;
    try {
      payload = await readJsonBody(request, config.maxPayload);
      if (!isPlainObject(payload) || !isPlainObject(payload.library) || Object.keys(payload).some(key => !["url", "library"].includes(key))) {
        throw presetApiError("invalid_preset_api_request", 400);
      }
      const target = normalizedPresetApiUrl(payload.url);
      const library = presetLibrary.validatePresetLibrary(payload.library);
      const imported = await config.presetApiFetcher(target.href);
      const preset = presetLibrary.validatePresetDefinition(imported, library);
      writeJson(response, 200, { ok: true, preset }, headers);
    } catch (error) {
      writeJson(response, error.status || 400, { error: error.code || "preset_api_import_failed" }, headers);
    }
  }

  async function handleImageInlineRequest(request, response) {
    const prepared = prepareCatalogResponse(request, response);
    if (prepared.done) return;
    const headers = prepared.headers;
    let payload;
    try {
      payload = await readJsonBody(request, MAX_IMAGE_INLINE_BODY_BYTES);
      if (!isPlainObject(payload) || Object.keys(payload).some(key => key !== "url")) {
        throw imageInlineError("invalid_image_inline_request", 400);
      }
      const target = normalizedPublicImageUrl(payload.url);
      const asset = await config.imageInlineFetcher(target.href, { maxBytes: config.maxImageInlineBytes });
      const buffer = Buffer.isBuffer(asset?.buffer) ? asset.buffer : Buffer.from(asset?.buffer || "");
      const mimeType = String(asset?.mimeType || "").split(";")[0].trim().toLowerCase();
      if (!/^image\/[a-z0-9.+-]+$/i.test(mimeType) || !buffer.length) {
        throw imageInlineError("invalid_image_inline_response", 502);
      }
      if (buffer.length > config.maxImageInlineBytes) {
        throw imageInlineError("image_response_too_large", 413);
      }
      writeJson(response, 200, {
        ok: true,
        url: target.href,
        mimeType,
        bytes: buffer.length,
        dataUri: `data:${mimeType};base64,${buffer.toString("base64")}`
      }, headers);
    } catch (error) {
      writeJson(response, error.status || 400, { error: error.code || "image_inline_failed" }, headers);
    }
  }

  async function handleMcpRequest(request, response) {
    const prepared = prepareMcpResponse(request, response);
    if (prepared.done) return;

    let payload;
    try {
      payload = await readJsonBody(request, MAX_MCP_BODY_BYTES);
    } catch (error) {
      const status = error.code === "payload_too_large" ? 413 : 400;
      writeJson(response, status, { error: error.code || "invalid_json" }, prepared.headers);
      return;
    }

    try {
      const options = { modelPath: config.mcpModelPath };
      if (Array.isArray(payload)) {
        const batch = payload
          .map(message => stateBlueprintMcp.handleMessage(message, options))
          .filter(Boolean);
        if (!batch.length) {
          response.writeHead(202, { "cache-control": "no-store", ...prepared.headers });
          response.end();
          return;
        }
        writeJson(response, 200, batch, prepared.headers);
        return;
      }
      const result = stateBlueprintMcp.handleMessage(payload, options);
      if (!result) {
        response.writeHead(202, { "cache-control": "no-store", ...prepared.headers });
        response.end();
        return;
      }
      writeJson(response, 200, result, prepared.headers);
    } catch (error) {
      writeJson(response, 500, { error: error.code || "mcp_request_failed", message: error.message }, prepared.headers);
    }
  }

  async function handleEmitRequest(request, response) {
    const origin = request.headers.origin || "";
    const headers = origin ? corsHeadersForOrigin(origin, request) : {};
    if (!headers) {
      writeJson(response, 403, { error: "origin_not_allowed" });
      return;
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204, headers);
      response.end();
      return;
    }
    if (!config.emitSecret) {
      writeJson(response, 503, { error: "emit_secret_required" }, headers);
      return;
    }
    if (!timingSafeEqualString(bearerToken(request), config.emitSecret)) {
      writeJson(response, 401, { error: "unauthorized" }, headers);
      return;
    }

    let payload;
    try {
      payload = await readJsonBody(request, config.maxPayload);
    } catch (error) {
      const status = error.code === "payload_too_large" ? 413 : 400;
      writeJson(response, status, { error: error.code || "invalid_json" }, headers);
      return;
    }

    const emit = validateEmitPayload(payload);
    if (!emit.ok) {
      writeJson(response, 400, { error: emit.code }, headers);
      return;
    }

    const room = rooms.get(emit.roomId);
    const delivered = room ? broadcast(room, null, {
      type: "runtime.event",
      roomId: emit.roomId,
      clientId: emit.clientId,
      serverTime: Date.now(),
      name: emit.name,
      detail: emit.detail,
      emitterId: emit.emitterId,
      event: offeredEventsByName.get(emit.name),
      emitter: offeredEmittersById.get(emit.emitterId)
    }) : 0;
    writeJson(response, 202, {
      ok: true,
      roomId: emit.roomId,
      name: emit.name,
      delivered
    }, headers);
  }

  function removeFromRoom(socket) {
    const state = socket.realtimeState;
    if (!state?.joined) return;
    const room = rooms.get(state.roomId);
    state.joined = false;
    if (!room) return;
    room.clients.delete(socket);
    if (!room.clients.size) rooms.delete(state.roomId);
  }

  function replaceDuplicateClient(room, clientId) {
    for (const peer of room.clients) {
      if (peer.realtimeState?.clientId !== clientId) continue;
      sendError(peer, "client_replaced", true);
      removeFromRoom(peer);
      peer.close(4008, "client_replaced");
    }
  }

  function consumeRate(state) {
    const now = Date.now();
    if (now - state.rateWindowStartedAt > config.rateLimitWindowMs) {
      state.rateWindowStartedAt = now;
      state.rateCount = 0;
    }
    state.rateCount += 1;
    return state.rateCount <= config.rateLimitMax;
  }

  function handleJoin(socket, message) {
    const join = validateJoinMessage(message);
    if (!join.ok) {
      sendError(socket, join.code, true);
      return;
    }

    if (config.requireRoomSecret && !config.roomSecret) {
      sendError(socket, "room_secret_required", true);
      return;
    }

    if (!config.allowUnsignedRooms) {
      const verified = verifyRoomToken(join.token, {
        roomId: join.roomId,
        clientId: join.clientId,
        secret: config.roomSecret
      });
      if (!verified.ok) {
        sendError(socket, "invalid_token", true);
        return;
      }
    }

    const room = getRoom(join.roomId);
    replaceDuplicateClient(room, join.clientId);
    const state = socket.realtimeState;
    state.joined = true;
    state.roomId = join.roomId;
    state.clientId = join.clientId;
    room.clients.add(socket);
    sendJson(socket, {
      type: "joined",
      roomId: join.roomId,
      clientId: join.clientId,
      serverTime: Date.now()
    });
  }

  function handleMessage(socket, rawData) {
    const state = socket.realtimeState;
    const message = parseJsonMessage(rawData);
    if (!message) {
      sendError(socket, "invalid_json");
      return;
    }

    if (!state.joined) {
      handleJoin(socket, message);
      return;
    }

    if (!consumeRate(state)) {
      sendError(socket, "rate_limited", true);
      return;
    }

    const validated = validateRealtimeMessage(message, offeredEventsByName, offeredEmittersById);
    if (!validated.ok) {
      sendError(socket, validated.code);
      return;
    }

    const room = rooms.get(state.roomId);
    if (!room) {
      sendError(socket, "room_missing", true);
      return;
    }

    if (Number.isSafeInteger(message.seq)) {
      const previousSeq = room.seenSeq.get(state.clientId) || 0;
      if (message.seq <= previousSeq) return;
      room.seenSeq.set(state.clientId, message.seq);
    }

    const payload = serializeForBroadcast(message, state, room);
    if (!payload) {
      sendError(socket, "invalid_message");
      return;
    }
    if (payload.type === "runtime.event") {
      payload.event = offeredEventsByName.get(payload.name);
      payload.emitter = payload.emitterId ? offeredEmittersById.get(payload.emitterId) || null : null;
    }
    broadcast(room, socket, payload);
  }

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname !== config.path) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    const origin = request.headers.origin || "";
    if (!isOriginAllowed(origin)) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }

    wss.handleUpgrade(request, socket, head, ws => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", socket => {
    socket.realtimeState = {
      joined: false,
      alive: true,
      roomId: "",
      clientId: "",
      rateWindowStartedAt: Date.now(),
      rateCount: 0
    };

    socket.on("pong", () => {
      socket.realtimeState.alive = true;
    });
    socket.on("message", data => handleMessage(socket, data));
    socket.on("close", () => removeFromRoom(socket));
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.realtimeState?.alive) {
        socket.terminate();
        continue;
      }
      socket.realtimeState.alive = false;
      socket.ping();
    }
  }, config.heartbeatMs);
  heartbeat.unref?.();

  function listen(port = config.port, host = config.host) {
    return new Promise((resolve, reject) => {
      const onError = error => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve(address());
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    });
  }

  function address() {
    return server.address();
  }

  function close() {
    clearInterval(heartbeat);
    for (const socket of wss.clients) socket.terminate();
    return new Promise(resolve => {
      wss.close(() => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(() => resolve());
      });
    });
  }

  return {
    config,
    server,
    wss,
    rooms,
    listen,
    address,
    close
  };
}

if (require.main === module) {
  const realtime = createRealtimeServer();
  realtime.listen()
    .then(addr => {
      const displayHost = addr.address === "0.0.0.0" || addr.address === "::" ? "localhost" : addr.address;
      console.log(`Realtime WebSocket server listening on ${displayHost}:${addr.port}${realtime.config.path}`);
    })
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  createRealtimeServer,
  createRoomToken,
  verifyRoomToken,
  loadConfig
};
