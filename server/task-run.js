"use strict";

const http = require("node:http");
const { URL } = require("node:url");
const externalRecorder = require("./external-recorder");
const { replayRecording } = require("./replay-engine");
const { ReplayTaskStore } = require("./replay-task-service");

const HOST = process.env.TASK_HOST || "127.0.0.1";
const PORT = Math.max(1, Math.min(65535, Number(process.env.TASK_PORT) || 8790));
const MAX_BODY = 3 * 1024 * 1024;
const DEFAULT_ORIGINS = ["https://digitalisierungsplanung.de", "https://www.digitalisierungsplanung.de"];

function allowedOrigins() {
  return String(process.env.TASK_ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(",")).split(",").map(value => value.trim()).filter(Boolean);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch (_) {
    const error = new Error("Invalid JSON body.");
    error.statusCode = 400;
    throw error;
  }
}

function writeJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "content-length": Buffer.byteLength(body) });
  response.end(body);
}

function applyCors(request, response, origins) {
  const origin = String(request.headers.origin || "");
  if (!origin) return true;
  if (!origins.has(origin)) return false;
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("access-control-max-age", "600");
  response.setHeader("vary", "Origin");
  return true;
}

function createTaskServer(options = {}) {
  const origins = new Set(options.allowedOrigins || allowedOrigins());
  const validateUrl = options.validateUrl || (url => externalRecorder.validatePublicUrl(url));
  const runner = options.runner || ((recording, runOptions = {}) => replayRecording(recording, {
    headless: true,
    validateUrl,
    secrets: runOptions.secrets || {},
    respectTiming: true
  }));
  const store = options.store || new ReplayTaskStore({ filePath: options.filePath, runner });
  store.start();

  const server = http.createServer(async (request, response) => {
    try {
      if (!applyCors(request, response, origins)) return writeJson(response, 403, { error: "origin_not_allowed" });
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (request.method === "OPTIONS") return writeJson(response, 204, {});
      if (request.method === "GET" && url.pathname === "/healthz") return writeJson(response, 200, { ok: true, service: "replay-tasks" });
      if (request.method === "GET" && url.pathname === "/tasks") return writeJson(response, 200, { tasks: await store.list() });
      if (request.method === "GET" && url.pathname === "/tasks/history") return writeJson(response, 200, { runs: await store.history(url.searchParams.get("taskId") || "") });
      if (request.method === "POST" && url.pathname === "/tasks/replay") {
        const body = await readJson(request);
        const result = await runner(body.recording || body.package || {}, { secrets: body.secrets || {} });
        return writeJson(response, 200, result);
      }
      if (request.method === "POST" && url.pathname === "/tasks") {
        const body = await readJson(request);
        return writeJson(response, 201, { task: await store.create(body) });
      }
      const match = url.pathname.match(/^\/tasks\/([^/]+)(?:\/(run))?$/);
      if (match) {
        const id = decodeURIComponent(match[1]);
        if (request.method === "GET" && !match[2]) {
          const task = await store.get(id);
          if (!task) return writeJson(response, 404, { error: "task_not_found" });
          return writeJson(response, 200, { task: { ...task, recording: undefined }, runs: await store.history(id) });
        }
        if (request.method === "POST" && match[2] === "run") {
          const body = await readJson(request);
          const run = await store.run(id, { secrets: body.secrets || undefined });
          return writeJson(response, 200, run);
        }
        if (request.method === "PATCH" && !match[2]) return writeJson(response, 200, { task: await store.update(id, await readJson(request)) });
        if (request.method === "DELETE" && !match[2]) return writeJson(response, 200, await store.remove(id));
      }
      writeJson(response, 404, { error: "not_found" });
    } catch (error) {
      const run = error?.run || null;
      writeJson(response, Number(error?.statusCode) || (error?.code === "replay_secret_missing" ? 422 : 500), { error: error?.code || "task_failed", message: String(error?.message || error), run });
    }
  });
  return { server, store, host: options.host || HOST, port: options.port || PORT };
}

function startTaskServer(options = {}) {
  const runtime = createTaskServer(options);
  runtime.server.listen(runtime.port, runtime.host, () => console.log(`Replay task service listening on http://${runtime.host}:${runtime.port}`));
  const shutdown = async () => { runtime.store.stop(); runtime.server.close(); };
  process.on("SIGTERM", () => { void shutdown().finally(() => process.exit(0)); });
  process.on("SIGINT", () => { void shutdown().finally(() => process.exit(0)); });
  return runtime;
}

if (require.main === module) startTaskServer();

module.exports = { createTaskServer, startTaskServer };
