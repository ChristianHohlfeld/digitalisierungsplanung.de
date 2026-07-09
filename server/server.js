"use strict";

const crypto = require("node:crypto");
const http = require("node:http");
const { URL } = require("node:url");
const { WebSocketServer, WebSocket } = require("ws");

const DEFAULT_ALLOWED_ORIGINS = ["https://digitalisierungsplanung.de"];
const DEFAULT_PATH = "/ws";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8788;
const MAX_ID_LENGTH = 128;
const MAX_EVENT_NAME_LENGTH = 160;
const MAX_OPS_PER_PATCH = 100;
const MESSAGE_TYPES = new Set([
  "presence.cursor",
  "runtime.event",
  "graph.patch",
  "snapshot.request",
  "snapshot"
]);
const TRANSIENT_TYPES = new Set(["presence.cursor"]);

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

function loadConfig(options = {}) {
  const env = options.env || process.env;
  const roomSecret = options.roomSecret ?? env.REALTIME_ROOM_SECRET ?? "";
  const nodeEnv = options.nodeEnv || env.NODE_ENV || "development";
  const allowUnsignedRooms = options.allowUnsignedRooms ?? (
    String(env.REALTIME_ALLOW_UNSIGNED_ROOMS || "").toLowerCase() === "true"
  );

  return {
    host: options.host || env.REALTIME_HOST || DEFAULT_HOST,
    port: parseInteger(options.port ?? env.REALTIME_PORT, DEFAULT_PORT, 1, 65535),
    path: options.path || env.REALTIME_PATH || DEFAULT_PATH,
    allowedOrigins: parseList(
      options.allowedOrigins ?? env.REALTIME_ALLOWED_ORIGINS,
      DEFAULT_ALLOWED_ORIGINS
    ),
    maxPayload: parseInteger(options.maxPayload ?? env.REALTIME_MAX_PAYLOAD_BYTES, 64 * 1024, 1024),
    heartbeatMs: parseInteger(options.heartbeatMs ?? env.REALTIME_HEARTBEAT_MS, 30000, 1000),
    rateLimitWindowMs: parseInteger(options.rateLimitWindowMs ?? env.REALTIME_RATE_WINDOW_MS, 10000, 1000),
    rateLimitMax: parseInteger(options.rateLimitMax ?? env.REALTIME_RATE_LIMIT, 360, 1),
    transientHighWaterMark: parseInteger(
      options.transientHighWaterMark ?? env.REALTIME_TRANSIENT_HIGH_WATER_BYTES,
      512 * 1024,
      1024
    ),
    roomSecret,
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

function writeJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
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

  if (message.type === "graph.patch") {
    room.rev += 1;
    return {
      ...base,
      baseRev: Number.isSafeInteger(message.baseRev) ? message.baseRev : null,
      rev: room.rev,
      ops: message.ops
    };
  }

  if (message.type === "snapshot.request") {
    return {
      ...base,
      rev: room.rev
    };
  }

  if (message.type === "snapshot") {
    return {
      ...base,
      rev: Number.isSafeInteger(message.rev) ? message.rev : room.rev,
      model: message.model
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

function validateRealtimeMessage(message) {
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
    if (!name) return { ok: false, code: "invalid_event_name" };
    if (message.detail !== undefined && !isPlainObject(message.detail)) return { ok: false, code: "invalid_detail" };
    message.name = name;
    message.detail = message.detail || {};
  }

  if (message.type === "graph.patch") {
    if (message.baseRev !== undefined && message.baseRev !== null && !Number.isSafeInteger(message.baseRev)) {
      return { ok: false, code: "invalid_base_rev" };
    }
    if (!Array.isArray(message.ops) || message.ops.length > MAX_OPS_PER_PATCH || !message.ops.every(isPlainObject)) {
      return { ok: false, code: "invalid_ops" };
    }
  }

  if (message.type === "snapshot") {
    if (!isPlainObject(message.model)) return { ok: false, code: "invalid_model" };
    if (message.rev !== undefined && !Number.isSafeInteger(message.rev)) return { ok: false, code: "invalid_rev" };
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
  const rooms = new Map();
  const server = options.server || http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/healthz") {
      const clients = [...rooms.values()].reduce((sum, room) => sum + room.clients.size, 0);
      writeJson(response, 200, { ok: true, rooms: rooms.size, clients });
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
    for (const peer of room.clients) {
      if (peer === sourceSocket || peer.readyState !== WebSocket.OPEN) continue;
      if (transient && peer.bufferedAmount > config.transientHighWaterMark) continue;
      peer.send(body);
    }
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

    const validated = validateRealtimeMessage(message);
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
    broadcast(room, socket, payload, TRANSIENT_TYPES.has(message.type));
  }

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname !== config.path) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    const origin = request.headers.origin || "";
    if (!allowedOrigins.has("*") && !allowedOrigins.has(origin)) {
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
