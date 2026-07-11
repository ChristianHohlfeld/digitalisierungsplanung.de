"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const { URL } = require("node:url");
const { WebSocketServer, WebSocket } = require("ws");
const { loadReleaseInfo } = require("./release");

const DEFAULT_ALLOWED_ORIGINS = ["https://digitalisierungsplanung.de"];
const DEFAULT_PATH = "/ws";
const DEFAULT_TOKEN_PATH = "/token";
const DEFAULT_EVENTS_PATH = "/events";
const DEFAULT_EMIT_PATH = "/emit";
const DEFAULT_CONSOLE_PATH = "/console.html";
const DEFAULT_VERSION_PATH = "/version";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8788;
const MAX_ID_LENGTH = 128;
const MAX_EVENT_NAME_LENGTH = 160;
const MAX_STATE_PATH_LENGTH = 240;
const MAX_EMIT_BODY_BYTES = 64 * 1024;
const VALID_VALUE_TYPES = new Set(["text", "email", "password", "number", "boolean", "url", "image", "object", "list"]);
const DEFAULT_EVENT_CATALOG = {
  provider: {
    id: "digitalisierungsplanung.realtime",
    label: "Digitalisierungsplanung Realtime",
    version: 1
  },
  state: {
    path: "realtime",
    schema: {
      roomId: "text",
      clientId: "text",
      status: "text",
      connected: "boolean",
      joined: "boolean",
      connecting: "boolean",
      reconnectAttempt: "number",
      error: "text"
    }
  },
  events: [
    {
      name: "realtime.sip.call.incoming",
      label: "Incoming call",
      description: "SIP phone call started",
      detail: { caller: "text", callee: "text", callId: "text" },
      bindings: [
        { from: "detail.caller", to: "realtime.sip.call.incoming.caller", type: "text" },
        { from: "detail.callee", to: "realtime.sip.call.incoming.callee", type: "text" },
        { from: "detail.callId", to: "realtime.sip.call.incoming.callId", type: "text" }
      ]
    },
    {
      name: "realtime.sip.call.answered",
      label: "Call answered",
      description: "SIP phone call was answered",
      detail: { callId: "text", agent: "text" },
      bindings: [
        { from: "detail.callId", to: "realtime.sip.call.answered.callId", type: "text" },
        { from: "detail.agent", to: "realtime.sip.call.answered.agent", type: "text" }
      ]
    },
    {
      name: "realtime.sip.call.ended",
      label: "Call ended",
      description: "SIP phone call ended",
      detail: { callId: "text", duration: "number" },
      bindings: [
        { from: "detail.callId", to: "realtime.sip.call.ended.callId", type: "text" },
        { from: "detail.duration", to: "realtime.sip.call.ended.duration", type: "number" }
      ]
    }
  ]
};
const MESSAGE_TYPES = new Set([
  "presence.cursor",
  "runtime.event"
]);
const TRANSIENT_TYPES = new Set(["presence.cursor"]);
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
      <label>Event<select id="eventName" name="eventName"></select></label>
      <label>Detail JSON<textarea id="detail" name="detail" spellcheck="false">{}</textarea></label>
      <label>Emit Secret<input id="secret" name="secret" type="password" autocomplete="off" placeholder="REALTIME_EMIT_SECRET"></label>
      <div class="actions">
        <button id="send" type="submit">Emit event</button>
        <button id="reload" type="button">Reload events</button>
      </div>
      <div class="hint">Events come from <code>/events</code>. The secret stays in this browser field and is sent only as the Bearer token for <code>/emit</code>.</div>
    </form>
    <div id="result" class="result">No event emitted yet.</div>
  </main>
  <script>
    const statusEl = document.getElementById("status");
    const resultEl = document.getElementById("result");
    const eventSelect = document.getElementById("eventName");
    const detailEl = document.getElementById("detail");
    const roomEl = document.getElementById("roomId");
    const clientEl = document.getElementById("clientId");
    const secretEl = document.getElementById("secret");
    const sendEl = document.getElementById("send");
    const stateLinkEl = document.getElementById("stateLink");
    let catalog = null;

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
      const response = await fetch("/events", { cache: "no-store" });
      if (!response.ok) throw new Error("events failed with status " + response.status);
      catalog = await response.json();
      for (const event of catalog.events || []) {
        const option = document.createElement("option");
        option.value = event.name;
        option.textContent = (event.label || event.name) + " - " + event.name;
        eventSelect.appendChild(option);
      }
      if (!eventSelect.options.length) throw new Error("event catalog has no events");
      statusEl.textContent = "Loaded " + eventSelect.options.length + " event(s).";
      syncDetail();
      syncStateLink();
    }

    async function emitEvent(event) {
      event.preventDefault();
      const roomId = roomEl.value.trim();
      const clientId = clientEl.value.trim() || "console";
      const name = eventSelect.value;
      const secret = secretEl.value.trim();
      if (!roomId || !name || !secret) {
        setResult("roomId, event and secret are required.", false);
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
          body: JSON.stringify({ roomId, clientId, name, detail })
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

function loadEventCatalog(options = {}, env = process.env) {
  if (options.eventCatalog) return normalizeEventCatalog(options.eventCatalog);
  const catalogPath = options.eventCatalogPath || env.REALTIME_EVENT_CATALOG_PATH || "";
  if (!catalogPath) return normalizeEventCatalog(DEFAULT_EVENT_CATALOG);
  return normalizeEventCatalog(JSON.parse(fs.readFileSync(catalogPath, "utf8")));
}

function loadConfig(options = {}) {
  const env = options.env || process.env;
  const roomSecret = options.roomSecret ?? env.REALTIME_ROOM_SECRET ?? "";
  const emitSecret = options.emitSecret ?? env.REALTIME_EMIT_SECRET ?? "";
  const nodeEnv = options.nodeEnv || env.NODE_ENV || "development";
  const allowUnsignedRooms = options.allowUnsignedRooms ?? (
    String(env.REALTIME_ALLOW_UNSIGNED_ROOMS || "").toLowerCase() === "true"
  );

  return {
    host: options.host || env.REALTIME_HOST || DEFAULT_HOST,
    port: parseInteger(options.port ?? env.REALTIME_PORT, DEFAULT_PORT, 1, 65535),
    path: options.path || env.REALTIME_PATH || DEFAULT_PATH,
    tokenPath: options.tokenPath || env.REALTIME_TOKEN_PATH || DEFAULT_TOKEN_PATH,
    eventsPath: options.eventsPath || env.REALTIME_EVENTS_PATH || DEFAULT_EVENTS_PATH,
    emitPath: options.emitPath || env.REALTIME_EMIT_PATH || DEFAULT_EMIT_PATH,
    consolePath: options.consolePath || env.REALTIME_CONSOLE_PATH || DEFAULT_CONSOLE_PATH,
    versionPath: options.versionPath || env.REALTIME_VERSION_PATH || DEFAULT_VERSION_PATH,
    allowedOrigins: parseList(
      options.allowedOrigins ?? env.REALTIME_ALLOWED_ORIGINS,
      DEFAULT_ALLOWED_ORIGINS
    ),
    maxPayload: parseInteger(options.maxPayload ?? env.REALTIME_MAX_PAYLOAD_BYTES, 64 * 1024, 1024),
    heartbeatMs: parseInteger(options.heartbeatMs ?? env.REALTIME_HEARTBEAT_MS, 30000, 1000),
    rateLimitWindowMs: parseInteger(options.rateLimitWindowMs ?? env.REALTIME_RATE_WINDOW_MS, 10000, 1000),
    rateLimitMax: parseInteger(options.rateLimitMax ?? env.REALTIME_RATE_LIMIT, 360, 1),
    tokenTtlMs: parseInteger(options.tokenTtlMs ?? env.REALTIME_ROOM_TOKEN_TTL_MS, 60 * 60 * 1000, 1000),
    transientHighWaterMark: parseInteger(
      options.transientHighWaterMark ?? env.REALTIME_TRANSIENT_HIGH_WATER_BYTES,
      512 * 1024,
      1024
    ),
    roomSecret,
    emitSecret,
    release: options.release || loadReleaseInfo({ env, path: options.releaseFile }),
    eventCatalog: loadEventCatalog(options, env),
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

function sanitizeStatePath(value) {
  const text = String(value || "").trim();
  if (!text || text.length > MAX_STATE_PATH_LENGTH) return "";
  return /^[a-zA-Z_][a-zA-Z0-9_:-]*(?:\.[a-zA-Z_][a-zA-Z0-9_:-]*)*$/.test(text) ? text : "";
}

function normalizeValueType(value) {
  const type = String(value || "").trim().toLowerCase();
  return VALID_VALUE_TYPES.has(type) ? type : "text";
}

function normalizeDetailSchema(value) {
  if (!isPlainObject(value)) return {};
  const out = {};
  for (const [path, type] of Object.entries(value).slice(0, 64)) {
    const cleanPath = sanitizeStatePath(path);
    if (cleanPath) out[cleanPath] = normalizeValueType(type);
  }
  return out;
}

function normalizeEventBindings(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 64).map(binding => {
    if (!isPlainObject(binding)) return null;
    const from = sanitizeStatePath(binding.from || "");
    const to = sanitizeStatePath(binding.to || "");
    if (!from || !to) return null;
    return { from, to, type: normalizeValueType(binding.type) };
  }).filter(Boolean);
}

function normalizeEventCatalog(value) {
  const source = isPlainObject(value) ? value : {};
  const providerSource = isPlainObject(source.provider) ? source.provider : {};
  const stateSource = isPlainObject(source.state) ? source.state : {};
  const provider = {
    id: sanitizeId(providerSource.id || source.providerId || DEFAULT_EVENT_CATALOG.provider.id) || DEFAULT_EVENT_CATALOG.provider.id,
    label: String(providerSource.label || source.label || DEFAULT_EVENT_CATALOG.provider.label).trim(),
    version: parseInteger(providerSource.version ?? source.version, DEFAULT_EVENT_CATALOG.provider.version, 1)
  };
  const events = [];
  const seen = new Set();
  for (const item of Array.isArray(source.events) ? source.events : []) {
    if (!isPlainObject(item)) continue;
    const name = sanitizeEventName(item.name || "");
    if (!name || !name.startsWith("realtime.") || seen.has(name)) continue;
    seen.add(name);
    events.push({
      name,
      label: String(item.label || name).trim(),
      description: String(item.description || "").trim(),
      detail: normalizeDetailSchema(item.detail),
      bindings: normalizeEventBindings(item.bindings)
    });
  }
  return {
    provider,
    state: {
      path: sanitizeStatePath(stateSource.path || DEFAULT_EVENT_CATALOG.state.path) || DEFAULT_EVENT_CATALOG.state.path,
      schema: normalizeDetailSchema(stateSource.schema || DEFAULT_EVENT_CATALOG.state.schema)
    },
    events
  };
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
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
    "content-security-policy": "default-src 'none'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
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
    events: config.eventCatalog.events
  };
}

function releaseResponse(config) {
  return {
    ok: true,
    serviceWorkerId: config.release.id,
    releaseSequence: config.release.sequence,
    builtAt: config.release.builtAt,
    sourceCommit: config.release.sourceCommit,
    deployedCommit: config.release.deployedCommit
  };
}

function createRoom(roomId) {
  return {
    id: roomId,
    clients: new Set(),
    rev: 0,
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

  if (message.type === "presence.cursor") {
    return {
      ...base,
      cursor: {
        x: message.cursor.x,
        y: message.cursor.y,
        worldX: isFiniteNumber(message.cursor.worldX) ? message.cursor.worldX : undefined,
        worldY: isFiniteNumber(message.cursor.worldY) ? message.cursor.worldY : undefined,
        stateId: sanitizeId(message.cursor.stateId) || undefined
      }
    };
  }

  if (message.type === "runtime.event") {
    return {
      ...base,
      name: message.name,
      detail: message.detail || {}
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

function validateRealtimeMessage(message, offeredEventNames = new Set()) {
  if (!message || !MESSAGE_TYPES.has(message.type)) return { ok: false, code: "invalid_type" };
  if (message.seq !== undefined && !Number.isSafeInteger(message.seq)) return { ok: false, code: "invalid_seq" };

  if (message.type === "presence.cursor") {
    if (!isPlainObject(message.cursor)) return { ok: false, code: "invalid_cursor" };
    if (!isFiniteNumber(message.cursor.x) || !isFiniteNumber(message.cursor.y)) {
      return { ok: false, code: "invalid_cursor" };
    }
  }

  if (message.type === "runtime.event") {
    const name = sanitizeEventName(message.name);
    if (!name || !name.startsWith("realtime.")) return { ok: false, code: "invalid_event_name" };
    if (!offeredEventNames.has(name)) return { ok: false, code: "event_not_offered" };
    if (message.detail !== undefined && !isPlainObject(message.detail)) return { ok: false, code: "invalid_detail" };
    message.name = name;
    message.detail = message.detail || {};
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
  const offeredEventNames = new Set(config.eventCatalog.events.map(event => event.name));
  const offeredEventsByName = new Map(config.eventCatalog.events.map(event => [event.name, event]));
  const rooms = new Map();
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

  const server = options.server || http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/healthz") {
      const clients = [...rooms.values()].reduce((sum, room) => sum + room.clients.size, 0);
      writeJson(response, 200, { ...releaseResponse(config), rooms: rooms.size, clients });
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
    if ((request.method === "GET" || request.method === "OPTIONS") && url.pathname === config.eventsPath) {
      const prepared = prepareCatalogResponse(request, response);
      if (prepared.done) return;
      writeJson(response, 200, eventCatalogResponse(config), prepared.headers);
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

  function broadcast(room, sourceSocket, payload, transient = false) {
    const body = JSON.stringify(payload);
    let delivered = 0;
    for (const peer of room.clients) {
      if (peer === sourceSocket || peer.readyState !== WebSocket.OPEN) continue;
      if (transient && peer.bufferedAmount > config.transientHighWaterMark) continue;
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
    if (!roomId) return { ok: false, code: "invalid_room" };
    if (!clientId) return { ok: false, code: "invalid_client" };
    if (!name || !name.startsWith("realtime.")) return { ok: false, code: "invalid_event_name" };
    if (!offeredEventNames.has(name)) return { ok: false, code: "event_not_offered" };
    if (payload.detail !== undefined && !isPlainObject(payload.detail)) return { ok: false, code: "invalid_detail" };
    return {
      ok: true,
      roomId,
      clientId,
      name,
      detail: isPlainObject(payload.detail) ? payload.detail : {}
    };
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
      event: offeredEventsByName.get(emit.name)
    }) : 0;
    writeJson(response, 202, {
      ok: true,
      roomId: emit.roomId,
      name: emit.name,
      delivered
    }, headers);
  }

  function removeFromRoom(socket, notify = true) {
    const state = socket.realtimeState;
    if (!state?.joined) return;
    const room = rooms.get(state.roomId);
    state.joined = false;
    if (!room) return;
    room.clients.delete(socket);
    if (notify) {
      broadcast(room, socket, {
        type: "peer.leave",
        roomId: state.roomId,
        clientId: state.clientId,
        serverTime: Date.now()
      });
    }
    if (!room.clients.size) rooms.delete(state.roomId);
  }

  function replaceDuplicateClient(room, clientId) {
    for (const peer of room.clients) {
      if (peer.realtimeState?.clientId !== clientId) continue;
      sendError(peer, "client_replaced", true);
      removeFromRoom(peer, false);
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
      rev: room.rev,
      serverTime: Date.now()
    });
    broadcast(room, socket, {
      type: "peer.join",
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

    const validated = validateRealtimeMessage(message, offeredEventNames);
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
    if (payload.type === "runtime.event") payload.event = offeredEventsByName.get(payload.name);
    broadcast(room, socket, payload, TRANSIENT_TYPES.has(message.type));
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
