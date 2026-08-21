"use strict";

const http = require("node:http");
const { URL } = require("node:url");
const externalRecorder = require("./external-recorder");

const host = process.env.RECORDER_HOST || "127.0.0.1";
const port = Math.max(1, Math.min(65535, Number(process.env.RECORDER_PORT) || 8789));
const publicBaseUrl = process.env.RECORDER_PUBLIC_BASE_URL || "https://realtime.digitalisierungsplanung.de";
const allowedOrigins = (process.env.RECORDER_ALLOWED_ORIGINS || "https://digitalisierungsplanung.de,https://www.digitalisierungsplanung.de")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean);
const allowedOriginSet = new Set(allowedOrigins);
const manager = externalRecorder.createRecorderManager();

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

const server = http.createServer((request, response) => {
  const origin = String(request.headers.origin || "");
  if (origin) {
    if (!allowedOriginSet.has(origin)) {
      writeJson(response, 403, { error: "origin_not_allowed" });
      return;
    }
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
    response.setHeader("access-control-allow-headers", "content-type");
    response.setHeader("vary", "Origin");
  }

  const url = new URL(request.url || "/", "http://localhost");
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

server.listen(port, host, () => {
  console.log(`External recorder listening on http://${host}:${port}`);
});

async function shutdown() {
  server.close();
  await manager.close().catch(() => {});
}

process.on("SIGTERM", () => { void shutdown().finally(() => process.exit(0)); });
process.on("SIGINT", () => { void shutdown().finally(() => process.exit(0)); });

module.exports = { server, manager };
