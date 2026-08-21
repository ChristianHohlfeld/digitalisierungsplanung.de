"use strict";

const dns = require("node:dns");
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

function normalizeHost(value) {
  return String(value || "").trim().toLowerCase().replace(/\.$/, "");
}

function parseHostAliases(value = process.env.RECORDER_HOST_ALIASES || "") {
  const aliases = new Map();
  for (const item of String(value || "").split(/[\s,]+/)) {
    const clean = item.trim();
    if (!clean) continue;
    const separator = clean.includes("=") ? "=" : clean.includes(":") ? ":" : "";
    if (!separator) continue;
    const [rawHost, rawAddress] = clean.split(separator, 2);
    const host = normalizeHost(rawHost);
    const address = String(rawAddress || "").trim();
    if (!host || !address) continue;
    aliases.set(host, address);
  }
  return aliases;
}

function hostResolverRulesFromAliases(aliases, extraRules = process.env.RECORDER_CHROMIUM_HOST_RESOLVER_RULES || "") {
  const mapped = [...aliases]
    .map(([host, address]) => `MAP ${host} ${address}`);
  const extra = String(extraRules || "")
    .split(",")
    .map(rule => rule.trim())
    .filter(Boolean);
  return [...mapped, ...extra].join(",");
}

function createAliasLookup(aliases, fallbackLookup = dns.promises.lookup.bind(dns.promises)) {
  return async function aliasLookup(hostname, options = {}) {
    const host = normalizeHost(hostname);
    const address = aliases.get(host);
    if (address) {
      const family = address.includes(":") ? 6 : 4;
      if (options && options.all) return [{ address, family }];
      return { address, family };
    }
    return fallbackLookup(hostname, options);
  };
}

function createDefaultRecorderManager() {
  const hostAliases = parseHostAliases();
  const hostResolverRules = hostResolverRulesFromAliases(hostAliases);
  return externalRecorder.createRecorderManager({
    lookup: createAliasLookup(hostAliases),
    launchBrowser: async () => {
      const { chromium } = require("playwright");
      const args = ["--disable-dev-shm-usage"];
      if (hostResolverRules) args.push(`--host-resolver-rules=${hostResolverRules}`);
      return chromium.launch({ headless: true, args });
    }
  });
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
  const manager = options.manager || createDefaultRecorderManager();

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
  createAliasLookup,
  createDefaultRecorderManager,
  createRecorderServer,
  hostResolverRulesFromAliases,
  parseHostAliases,
  startRecorderServer
};
