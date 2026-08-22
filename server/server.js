"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createRecorderManager, validatePublicUrl, recorderError } = require("./recorder");
const { productContractResponse } = require("./product-contract");
const { loadReleaseInfo } = require("./release");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8788;
const MAX_JSON_BYTES = 128 * 1024;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);
const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  "https://digitalisierungsplanung.de",
  "https://www.digitalisierungsplanung.de",
  "http://127.0.0.1:8124",
  "http://localhost:8124"
]);

function configuredOrigins(env = process.env) {
  return String(env.ALLOWED_ORIGINS || env.REALTIME_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(","))
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
}

function writeJson(response, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-length": Buffer.byteLength(body),
    ...headers
  });
  response.end(body);
}

function writeHtml(response, body) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors https://digitalisierungsplanung.de https://www.digitalisierungsplanung.de http://127.0.0.1:* http://localhost:*; base-uri 'none'; form-action 'none'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

async function readJson(request, maxBytes = MAX_JSON_BYTES) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw recorderError("request_too_large", "Anfrage ist zu groß.", 413);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch (_) { throw recorderError("invalid_json", "Anfrage muss gültiges JSON enthalten.", 400); }
}

function requestClientKey(request) {
  const forwarded = String(request.headers["x-forwarded-for"] || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  return forwarded.at(-1) || String(request.socket?.remoteAddress || "unknown");
}

function appendCors(request, response, allowedOrigins) {
  const origin = String(request.headers.origin || "");
  if (!origin) return true;
  if (!allowedOrigins.has(origin)) return false;
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("access-control-max-age", "600");
  response.setHeader("vary", "Origin");
  return true;
}

function recorderExecutableReady(options = {}) {
  if (options.recorderReady !== undefined) return Boolean(options.recorderReady);
  try {
    const executable = require("playwright").chromium.executablePath();
    return Boolean(executable && fs.existsSync(executable));
  } catch (_) {
    return false;
  }
}

async function fetchImageDataUri(inputUrl, options = {}) {
  const fetcher = options.fetcher || globalThis.fetch;
  let current = await validatePublicUrl(inputUrl, options);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await fetcher(current, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(12_000), headers: { accept: "image/*" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === 3) throw recorderError("image_redirect_invalid", "Bild-Weiterleitung ist ungültig.", 502);
      current = await validatePublicUrl(new URL(location, current).href, options);
      continue;
    }
    if (!response.ok) throw recorderError("image_fetch_failed", "Bild konnte nicht geladen werden.", 502);
    const type = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(type)) throw recorderError("image_type_invalid", "URL liefert kein unterstütztes Bild.", 415);
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_IMAGE_BYTES) throw recorderError("image_too_large", "Bild ist zu groß.", 413);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES) throw recorderError("image_too_large", "Bild ist zu groß.", 413);
    return { dataUri: `data:${type};base64,${buffer.toString("base64")}`, contentType: type, bytes: buffer.length, sourceUrl: current };
  }
  throw recorderError("image_fetch_failed", "Bild konnte nicht geladen werden.", 502);
}

function createAppServer(options = {}) {
  const env = options.env || process.env;
  const host = options.host || env.APP_HOST || env.REALTIME_HOST || DEFAULT_HOST;
  const requestedPort = Number(options.port ?? env.APP_PORT ?? env.REALTIME_PORT);
  const port = options.port === 0 ? 0 : Math.max(1, Math.min(65535, requestedPort || DEFAULT_PORT));
  const allowedOrigins = new Set(options.allowedOrigins || configuredOrigins(env));
  const release = options.release || loadReleaseInfo({ env, path: options.releasePath });
  const contract = options.contract || productContractResponse();
  const manager = options.recorderManager || createRecorderManager({
    ttlMs: Number(env.RECORDER_SESSION_TTL_MS) || undefined,
    maxSessions: Number(env.RECORDER_MAX_SESSIONS) || undefined,
    maxSessionsPerClient: Number(env.RECORDER_MAX_SESSIONS_PER_CLIENT) || undefined,
    launchBrowser: options.launchBrowser,
    lookup: options.lookup
  });
  const recorderHtmlPath = options.recorderHtmlPath || path.resolve(__dirname, "..", "recorder.html");
  const ready = recorderExecutableReady(options);

  const server = http.createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url || "/", "http://localhost");
      if (!appendCors(request, response, allowedOrigins)) {
        writeJson(response, 403, { error: "origin_not_allowed" });
        return;
      }
      if (request.method === "OPTIONS") {
        response.writeHead(204, { "cache-control": "no-store", "content-length": "0" });
        response.end();
        return;
      }
      if (request.method === "GET" && url.pathname === "/healthz") {
        writeJson(response, 200, { ok: true, service: "flow-runtime", recorderReady: ready, releaseId: release.id, releaseSequence: release.sequence });
        return;
      }
      if (request.method === "GET" && url.pathname === "/version") {
        writeJson(response, 200, { ...release, service: "flow-runtime", recorderReady: ready });
        return;
      }
      if (request.method === "GET" && url.pathname === "/contract") {
        writeJson(response, 200, { ...contract, release });
        return;
      }
      if (request.method === "GET" && url.pathname === "/recorder.html") {
        writeHtml(response, fs.readFileSync(recorderHtmlPath, "utf8"));
        return;
      }
      if (request.method === "POST" && url.pathname === "/assets/inline-image") {
        const body = await readJson(request, 8 * 1024);
        writeJson(response, 200, await fetchImageDataUri(body.url, { fetcher: options.fetcher, lookup: options.lookup }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/recorder/sessions") {
        writeJson(response, 201, await manager.startSession((await readJson(request)).url, requestClientKey(request)));
        return;
      }
      if (request.method === "POST" && url.pathname === "/recorder/replays") {
        writeJson(response, 201, await manager.startPackageReplay((await readJson(request)).recording, requestClientKey(request)));
        return;
      }
      const match = url.pathname.match(/^\/recorder\/sessions\/([0-9a-f-]+)(?:\/(actions|finish|replay\/start|replay\/next|replay\/stop))?$/i);
      if (match) {
        const [, id, action = ""] = match;
        if (request.method === "POST" && action === "actions") writeJson(response, 200, await manager.performAction(id, await readJson(request)));
        else if (request.method === "POST" && action === "finish") writeJson(response, 200, await manager.finishSession(id));
        else if (request.method === "POST" && action === "replay/start") writeJson(response, 200, await manager.startReplay(id));
        else if (request.method === "POST" && action === "replay/next") writeJson(response, 200, await manager.replayNext(id, await readJson(request)));
        else if (request.method === "POST" && action === "replay/stop") writeJson(response, 200, await manager.stopReplay(id));
        else if (request.method === "DELETE" && !action) writeJson(response, 200, { ok: await manager.cancelSession(id) });
        else writeJson(response, 405, { error: "method_not_allowed" });
        return;
      }
      writeJson(response, 404, { error: "not_found" });
    })().catch(error => {
      if (response.headersSent) { response.end(); return; }
      writeJson(response, Number(error.statusCode) || 500, { error: String(error.code || "request_failed"), message: String(error.message || "Anfrage fehlgeschlagen.") });
    });
  });

  return {
    server, manager, host, port, release, contract,
    listen() { return new Promise(resolve => server.listen(port, host, resolve)); },
    async close() { await new Promise(resolve => server.close(resolve)); await manager.close?.(); }
  };
}

async function main() {
  const app = createAppServer();
  await app.listen();
  console.log(`Flow runtime listening on http://${app.host}:${app.port}`);
  const shutdown = () => void app.close().finally(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exit(1); });

module.exports = {
  DEFAULT_ALLOWED_ORIGINS,
  configuredOrigins,
  recorderExecutableReady,
  fetchImageDataUri,
  createAppServer,
  readJson,
  writeJson
};
