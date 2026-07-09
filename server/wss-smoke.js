"use strict";

const WebSocket = require("ws");
const { createRoomToken } = require("./server");

const url = process.env.REALTIME_WSS_URL || "wss://realtime.digitalisierungsplanung.de/ws";
const origin = process.env.REALTIME_ORIGIN || "https://digitalisierungsplanung.de";
const roomId = process.env.REALTIME_ROOM_ID || "smoke";
const clientId = process.env.REALTIME_CLIENT_ID || `smoke-${Date.now()}`;
const explicitToken = process.env.REALTIME_JOIN_TOKEN || "";
const roomSecret = process.env.REALTIME_ROOM_SECRET || "";
const timeoutMs = Number.parseInt(process.env.REALTIME_SMOKE_TIMEOUT_MS || "8000", 10);
const forceIp = process.env.REALTIME_FORCE_IP || "";

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
