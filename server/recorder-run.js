"use strict";

const http = require("node:http");
const { URL } = require("node:url");
const externalRecorder = require("./external-recorder");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8789;
const DEFAULT_PUBLIC_BASE_URL = "https://realtime.digitalisierungsplanung.de";
const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  "https://digitalisierungsplanung.de",
  "https://www.digitalisierungsplanung.de"
]);
const CORS_METHODS = "GET, POST, DELETE, OPTIONS";
const CORS_HEADERS = "content-type";

function envAllowedOrigins() {
  return (process.env.RECORDER_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(","))
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
}

function appendVary(response, value) {
  const existing = response.getHeader("vary");
  const values = String(existing || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
  if (!values.some(item => item.toLowerCase() === value.toLowerCase())) values.push(value);
  response.setHeader("vary", values.join(", "));
}

function writeJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

function createRecorderServer(options = {}) {
  const host = options.host || process.env.RECORDER_HOST || DEFAULT_HOST;
  const port = Math.max(1, Math.min(65535, Number(options.port ?? process.env.RECORDER_PORT) || DEFAULT_PORT));
  const publicBaseUrl = options.publicBaseUrl || process.env.RECORDER_PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL;
  const allowedOrigins = Array.isArray(options.allowedOrigins) ? options.allowedOrigins : envAllowedOrigins();
  const allowedOriginSet = new Set(allowedOrigins);
  const manager = options.manager || externalRecorder.createRecorderManager();

  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://localhost");
    const origin = String(request.headers.origin || "");

    if (origin) {
      if (!allowedOriginSet.has(origin)) {
        writeJson(response, 403, { error: "origin_not_allowed" });
        return;
      }
      response.setHeader("access-control-allow-origin", origin);
      response.setHeader("access-control-allow-methods", CORS_METHODS);
      response.setHeader("access-control-allow-headers", CORS_HEADERS);
      response.setHeader("access-control-max-age", "600");
      appendVary(response, "Origin");
    }

    if (request.method === "OPTIONS") {
      if (!externalRecorder.matchesRecorderPath(url.pathname)) {
        writeJson(response, 404, { error: "not_found" });
        return;
      }
      response.writeHead(204, {
        "cache-control": "no-store",
        "content-length": "0"
      });
      response.end();
      return;
    }

    if (request.method === "GET" && url.pathname === "/healthz") {
      writeJson(response, 200, { ok: true, service: "external-recorder" });
      return;
    }
    if (!externalRecorder.matchesRecorderPath(url.pathname)) {
      writeJson(response, 404, { error: "not_found" });
      return;
    }
    void externalRecorder.handleRecorderRequest(request, response, url, {
      manager,
      allowedOrigins,
      publicBaseUrl
    }).catch(error => {
      if (response.headersSent) {
        response.end();
        return;
      }
      writeJson(response, 500, { error: "recorder_failed", message: String(error?.message || error) });
    });
  });

  return { server, manager, host, port };
}

function startRecorderServer(options = {}) {
  const runtime = createRecorderServer(options);
  runtime.server.listen(runtime.port, runtime.host, () => {
    console.log(`External recorder listening on http://${runtime.host}:${runtime.port}`);
  });
  return runtime;
}

if (require.main === module) {
  const runtime = startRecorderServer();
  async function shutdown() {
    runtime.server.close();
    await runtime.manager.close().catch(() => {});
  }
  process.on("SIGTERM", () => { void shutdown().finally(() => process.exit(0)); });
  process.on("SIGINT", () => { void shutdown().finally(() => process.exit(0)); });
}

module.exports = {
  CORS_HEADERS,
  CORS_METHODS,
  createRecorderServer,
  startRecorderServer
};
