"use strict";

const { existsSync, readFileSync } = require("node:fs");
const http = require("node:http");
const https = require("node:https");

const args = parseArgs(process.argv.slice(2));
loadEnvFile(args.envFile || process.env.REALTIME_ENV_FILE || "/etc/digitalisierungsplanung-realtime.env");

const url = args.url || process.env.REALTIME_EMIT_URL || "https://realtime.digitalisierungsplanung.de/emit";
const roomId = args.roomId || process.env.REALTIME_ROOM_ID || "smoke";
const name = args.name || process.env.REALTIME_EVENT_NAME || "realtime.sip.call.incoming";
const detail = parseDetail(args.detail || process.env.REALTIME_EVENT_DETAIL || '{"caller":"+491234","callee":"100","callId":"smoke-123"}');
const secret = args.secret || process.env.REALTIME_EMIT_SECRET || "";
const origin = args.origin || process.env.REALTIME_ORIGIN || "";
const timeoutMs = Number.parseInt(args.timeoutMs || process.env.REALTIME_SMOKE_TIMEOUT_MS || "8000", 10);
const forceIp = args.forceIp || process.env.REALTIME_FORCE_IP || "";

if (!secret) fail("missing REALTIME_EMIT_SECRET");

postJson(url, {
  roomId,
  name,
  detail
}, {
  authorization: `Bearer ${secret}`,
  ...(origin ? { origin } : {})
}).then(({ statusCode, body }) => {
  let payload;
  try {
    payload = JSON.parse(body || "{}");
  } catch (_) {
    fail(`emit returned non-json status=${statusCode} body=${body}`);
    return;
  }

  if (statusCode !== 202 || payload.ok !== true || payload.roomId !== roomId || payload.name !== name) {
    fail(`emit failed status=${statusCode} body=${JSON.stringify(payload)}`);
    return;
  }

  console.log(`emit ok room=${payload.roomId} name=${payload.name} delivered=${payload.delivered ?? 0}`);
}).catch(error => {
  fail(`emit error: ${error.message}`);
});

function parseArgs(values) {
  const parsed = {};
  for (const value of values) {
    const match = String(value).match(/^--([^=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    parsed[key] = match[2];
  }
  return parsed;
}

function loadEnvFile(path) {
  if (!path || !existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const text = line.trim();
    if (!text || text.startsWith("#")) continue;
    const index = text.indexOf("=");
    if (index <= 0) continue;
    const key = text.slice(0, index).trim();
    let value = text.slice(index + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function parseDetail(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("detail must be an object");
    return parsed;
  } catch (error) {
    fail(`invalid detail json: ${error.message}`);
  }
}

function postJson(rawUrl, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(rawUrl);
    const body = JSON.stringify(payload);
    const transport = target.protocol === "https:" ? https : http;
    const request = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method: "POST",
      timeout: timeoutMs,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
        ...headers
      },
      lookup: forceIp ? forcedLookup(forceIp) : undefined
    }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode || 0,
          body: Buffer.concat(chunks).toString("utf8")
        });
      });
    });
    request.on("timeout", () => {
      request.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });
    request.on("error", reject);
    request.end(body);
  });
}

function forcedLookup(address) {
  const family = address.includes(":") ? 6 : 4;
  return (_hostname, lookupOptions, callback) => {
    if (typeof lookupOptions === "function") {
      callback = lookupOptions;
      lookupOptions = {};
    }
    if (lookupOptions?.all) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
