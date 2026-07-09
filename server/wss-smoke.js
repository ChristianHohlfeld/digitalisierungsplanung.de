"use strict";

const { existsSync, readFileSync } = require("node:fs");
const WebSocket = require("ws");
const { createRoomToken } = require("./server");

const args = parseArgs(process.argv.slice(2));
loadEnvFile(args.envFile || process.env.REALTIME_ENV_FILE || "/etc/digitalisierungsplanung-realtime.env");

const url = args.url || process.env.REALTIME_WSS_URL || "wss://realtime.digitalisierungsplanung.de/ws";
const origin = args.origin || process.env.REALTIME_ORIGIN || "https://digitalisierungsplanung.de";
const roomId = args.roomId || process.env.REALTIME_ROOM_ID || "smoke";
const clientId = args.clientId || process.env.REALTIME_CLIENT_ID || `smoke-${Date.now()}`;
const explicitToken = args.token || process.env.REALTIME_JOIN_TOKEN || "";
const roomSecret = process.env.REALTIME_ROOM_SECRET || "";
const timeoutMs = Number.parseInt(args.timeoutMs || process.env.REALTIME_SMOKE_TIMEOUT_MS || "8000", 10);
const forceIp = args.forceIp || process.env.REALTIME_FORCE_IP || "";

let settled = false;
const timer = setTimeout(() => {
  fail(`timeout after ${timeoutMs}ms`);
}, timeoutMs);

function finish(message) {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  console.log(message);
  process.exit(0);
}

function fail(message) {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  console.error(message);
  process.exit(1);
}

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

function joinToken() {
  if (explicitToken) return explicitToken;
  if (!roomSecret) return "";
  return createRoomToken({ roomId, clientId, secret: roomSecret, ttlMs: 60 * 1000 });
}

const token = joinToken();
const options = {
  headers: { Origin: origin }
};

if (forceIp) {
  const family = forceIp.includes(":") ? 6 : 4;
  options.lookup = (_hostname, lookupOptions, callback) => {
    if (typeof lookupOptions === "function") {
      callback = lookupOptions;
      lookupOptions = {};
    }
    if (lookupOptions?.all) {
      callback(null, [{ address: forceIp, family }]);
      return;
    }
    callback(null, forceIp, family);
  };
}

const ws = new WebSocket(url, options);

ws.on("open", () => {
  console.log(`wss open ${url}`);
  if (!token) {
    ws.close();
    return;
  }
  ws.send(JSON.stringify({
    type: "join",
    roomId,
    clientId,
    token
  }));
});

ws.on("message", data => {
  const text = String(data);
  console.log(text);
  let message;
  try {
    message = JSON.parse(text);
  } catch (_) {
    fail("received non-json message");
    return;
  }
  if (message.type === "joined") {
    ws.close();
    finish(`joined room=${message.roomId} client=${message.clientId} rev=${message.rev}`);
    return;
  }
  if (message.type === "error") {
    fail(`server error: ${message.code}`);
  }
});

ws.on("close", (code, reason) => {
  if (token) {
    fail(`wss closed before join code=${code} reason=${reason.toString()}`);
    return;
  }
  finish(`wss close code=${code} reason=${reason.toString()}`);
});

ws.on("error", error => {
  fail(`wss error: ${error.message}`);
});
