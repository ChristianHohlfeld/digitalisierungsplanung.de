"use strict";

const http = require("node:http");
const { URL } = require("node:url");
const { createLocalNativeManager } = require("./local-native-manager");
const { replayRecording } = require("./local-replay");
const { createTaskScheduler } = require("./local-task-scheduler");

const DEFAULT_HOST = process.env.LOCAL_RECORDER_HOST || "127.0.0.1";
const DEFAULT_PORT = Math.max(1, Math.min(65535, Number(process.env.LOCAL_RECORDER_PORT) || 8799));
const DEFAULT_ORIGIN = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  "https://digitalisierungsplanung.de",
  "https://www.digitalisierungsplanung.de",
  "http://127.0.0.1:8799",
  "http://localhost:8799"
]);

function agentError(code, message, statusCode = 400) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function localAgentHtml() {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zustand Local Agent</title><style>:root{color-scheme:dark;--bg:#07111d;--panel:#0b1b2a;--line:#20425f;--text:#e6f2ff;--muted:#9fb6cc;--ok:#34d399}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif}.card{width:min(680px,calc(100% - 28px));border:1px solid var(--line);border-radius:16px;background:var(--panel);padding:22px;box-shadow:0 24px 70px rgba(0,0,0,.35)}h1{margin:0 0 6px;font-size:26px}.ok{color:var(--ok);font-weight:900}.muted{color:var(--muted)}code{color:#bae6fd}</style></head><body><main class="card"><h1>Zustand Local Agent</h1><div class="ok">● Bereit</div><p>Der Agent öffnet echte Chromium-Fenster für Aufnahme und Replay und führt lokale Replay-Tasks im Kundennetz aus.</p><p class="muted">Zur Bedienung <code>https://digitalisierungsplanung.de/state.html</code> öffnen. Diese Seite ist nur die lokale Runtime-Statusseite.</p></main></body></html>`;
}

function json(response, statusCode, body, extraHeaders = {}) {
  const text = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-length": Buffer.byteLength(text),
    ...extraHeaders
  });
  response.end(text);
}

function html(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

function corsHeaders(request, allowedOrigins) {
  const origin = String(request.headers.origin || "").trim();
  if (!origin || !allowedOrigins.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    "vary": "Origin"
  };
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw agentError("body_too_large", "Request ist zu groß.", 413);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object required");
    return value;
  } catch (_) {
    throw agentError("invalid_json", "Request muss gültiges JSON sein.");
  }
}

function originAllowed(request, allowedOrigins) {
  const origin = String(request.headers.origin || "").trim();
  return !origin || allowedOrigins.includes(origin);
}

function createLocalRecorderServer(options = {}) {
  const host = options.host || DEFAULT_HOST;
  const port = options.port || DEFAULT_PORT;
  const publicBaseUrl = options.publicBaseUrl || `http://${host}:${port}`;
  const allowedOrigins = Array.isArray(options.allowedOrigins) ? options.allowedOrigins : [...DEFAULT_ALLOWED_ORIGINS];
  const native = options.nativeManager || createLocalNativeManager(options.nativeOptions || {});
  const scheduler = options.scheduler || createTaskScheduler({
    file: options.taskFile,
    runRecording: options.runRecording || replayRecording,
    intervalMs: options.taskIntervalMs
  });

  const server = http.createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url || "/", publicBaseUrl);
      const cors = corsHeaders(request, allowedOrigins);
      if (request.method === "OPTIONS") {
        if (!originAllowed(request, allowedOrigins)) return json(response, 403, { error: "origin_forbidden" });
        response.writeHead(204, cors);
        response.end();
        return;
      }
      if (!originAllowed(request, allowedOrigins)) return json(response, 403, { error: "origin_forbidden" });

      if (request.method === "GET" && url.pathname === "/") return html(response, 200, localAgentHtml());
      if (request.method === "GET" && url.pathname === "/healthz") {
        return json(response, 200, {
          ok: true,
          service: "zustand-local-agent",
          capabilities: ["native-record", "real-replay", "tasks", "intranet"],
          taskFile: scheduler.file
        }, cors);
      }

      if (request.method === "POST" && url.pathname === "/native/sessions") {
        const body = await readJson(request);
        return json(response, 201, await native.startSession(body.url), cors);
      }
      const nativeMatch = url.pathname.match(/^\/native\/sessions\/([0-9a-f-]+)(?:\/(finish))?$/i);
      if (nativeMatch) {
        const [, id, action] = nativeMatch;
        if (request.method === "GET" && !action) return json(response, 200, native.getState(id), cors);
        if (request.method === "POST" && action === "finish") return json(response, 200, await native.finishSession(id), cors);
        if (request.method === "DELETE" && !action) return json(response, 200, await native.cancelSession(id), cors);
      }

      if (request.method === "POST" && url.pathname === "/replay") {
        const body = await readJson(request);
        const recording = body.recording || body.package?.recording;
        const result = await replayRecording(recording, {
          headless: body.headless === true,
          secrets: body.secrets && typeof body.secrets === "object" ? body.secrets : {},
          skipDelay: body.skipDelay === true
        });
        return json(response, 200, result, cors);
      }

      if (request.method === "GET" && url.pathname === "/tasks") return json(response, 200, { tasks: await scheduler.list() }, cors);
      if (request.method === "POST" && url.pathname === "/tasks") {
        const body = await readJson(request);
        return json(response, 201, await scheduler.create(body), cors);
      }
      const taskMatch = url.pathname.match(/^\/tasks\/([0-9a-f-]+)(?:\/(run))?$/i);
      if (taskMatch) {
        const [, id, action] = taskMatch;
        if (request.method === "PATCH" && !action) return json(response, 200, await scheduler.update(id, await readJson(request)), cors);
        if (request.method === "DELETE" && !action) return json(response, 200, await scheduler.remove(id), cors);
        if (request.method === "POST" && action === "run") {
          const body = await readJson(request);
          return json(response, 200, await scheduler.run(id, { headless: body.headless !== false, secrets: body.secrets || {} }), cors);
        }
      }

      return json(response, 404, { error: "not_found" }, cors);
    })().catch(error => {
      if (response.headersSent) return response.end();
      const status = Number(error?.statusCode) || 500;
      json(response, status, {
        error: String(error?.code || "local_agent_failed"),
        message: String(error?.message || error || "Local Agent failed.")
      }, corsHeaders(request, allowedOrigins));
    });
  });

  async function start() {
    await scheduler.start();
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve(runtime);
      });
    });
  }

  async function close() {
    scheduler.stop();
    await native.close().catch(() => {});
    await new Promise(resolve => server.close(() => resolve()));
  }

  const runtime = { server, native, scheduler, host, port, publicBaseUrl, allowedOrigins, start, close };
  return runtime;
}

async function startLocalRecorderServer(options = {}) {
  const runtime = createLocalRecorderServer(options);
  await runtime.start();
  console.log(`Zustand Local Agent listening on http://${runtime.host}:${runtime.port}`);
  console.log("Open https://digitalisierungsplanung.de/state.html and use 'Browser aufnehmen'.");
  const shutdown = async () => {
    await runtime.close().catch(() => {});
    process.exit(0);
  };
  process.once("SIGTERM", () => { void shutdown(); });
  process.once("SIGINT", () => { void shutdown(); });
  return runtime;
}

if (require.main === module) {
  startLocalRecorderServer().catch(error => {
    console.error(error.stack || error.message || error);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_ALLOWED_ORIGINS,
  createLocalRecorderServer,
  localAgentHtml,
  startLocalRecorderServer
};