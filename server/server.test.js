"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const WebSocket = require("ws");
const {
  createRealtimeServer,
  createRoomToken,
  verifyRoomToken
} = require("./server");

const ORIGIN = "https://digitalisierungsplanung.de";
const SECRET = "test-room-secret";

function socketUrl(realtime) {
  const { port } = realtime.address();
  return `ws://127.0.0.1:${port}/ws`;
}

function httpUrl(realtime, path) {
  const { port } = realtime.address();
  return `http://127.0.0.1:${port}${path}`;
}

async function withRealtimeServer(options, fn) {
  const realtime = createRealtimeServer({
    host: "127.0.0.1",
    port: 0,
    allowedOrigins: [ORIGIN],
    heartbeatMs: 1000,
    ...options
  });
  await realtime.listen(0, "127.0.0.1");
  try {
    await fn(realtime);
  } finally {
    await realtime.close();
  }
}

function connectRaw(realtime, origin = ORIGIN) {
  return new WebSocket(socketUrl(realtime), {
    headers: { Origin: origin }
  });
}

function waitForOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function waitForError(socket) {
  return new Promise(resolve => {
    socket.once("error", resolve);
  });
}

function nextMessage(socket, predicate = () => true, timeoutMs = 600) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("message timeout"));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      socket.off("message", onMessage);
      socket.off("error", onError);
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    function onMessage(data) {
      const message = JSON.parse(String(data));
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    }

    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}

async function assertNoMessage(socket, predicate, timeoutMs = 150) {
  try {
    await nextMessage(socket, predicate, timeoutMs);
  } catch (error) {
    if (error.message === "message timeout") return;
    throw error;
  }
  throw new Error("unexpected message");
}

async function connectClient(realtime, { roomId = "room", clientId, token = null } = {}) {
  const socket = connectRaw(realtime);
  await waitForOpen(socket);
  socket.send(JSON.stringify({
    type: "join",
    roomId,
    clientId,
    token: token || createRoomToken({ roomId, clientId, secret: SECRET, ttlMs: 60000 })
  }));
  const joined = await nextMessage(socket, message => message.type === "joined");
  assert.equal(joined.roomId, roomId);
  assert.equal(joined.clientId, clientId);
  return socket;
}

test("rejects WebSocket upgrades from disallowed origins", async () => {
  await withRealtimeServer({ roomSecret: SECRET }, async realtime => {
    const socket = connectRaw(realtime, "https://evil.example");
    const error = await waitForError(socket);
    assert.match(error.message, /403/);
  });
});

test("requires a signed room token when unsigned rooms are disabled", async () => {
  await withRealtimeServer({ roomSecret: SECRET, allowUnsignedRooms: false }, async realtime => {
    const socket = connectRaw(realtime);
    await waitForOpen(socket);
    socket.send(JSON.stringify({
      type: "join",
      roomId: "secure-room",
      clientId: "client-a"
    }));
    const error = await nextMessage(socket, message => message.type === "error");
    assert.equal(error.code, "invalid_token");
  });
});

test("issues signed room tokens only to allowed origins", async () => {
  await withRealtimeServer({ roomSecret: SECRET, tokenTtlMs: 60000 }, async realtime => {
    const response = await fetch(httpUrl(realtime, "/token?roomId=room&clientId=alice"), {
      headers: { Origin: ORIGIN }
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);

    const payload = await response.json();
    assert.equal(payload.roomId, "room");
    assert.equal(payload.clientId, "alice");
    assert.equal(payload.expiresInMs, 60000);
    assert.equal(verifyRoomToken(payload.token, {
      roomId: "room",
      clientId: "alice",
      secret: SECRET
    }).ok, true);

    const rejected = await fetch(httpUrl(realtime, "/token?roomId=room&clientId=alice"), {
      headers: { Origin: "https://evil.example" }
    });
    assert.equal(rejected.status, 403);
  });
});

test("does not issue room tokens without a server secret", async () => {
  await withRealtimeServer({ roomSecret: "", allowUnsignedRooms: true }, async realtime => {
    const response = await fetch(httpUrl(realtime, "/token?roomId=room&clientId=alice"), {
      headers: { Origin: ORIGIN }
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "room_secret_required" });
  });
});

test("relays runtime events to peers without echoing them to the sender", async () => {
  await withRealtimeServer({ roomSecret: SECRET }, async realtime => {
    const alice = await connectClient(realtime, { clientId: "alice" });
    const bob = await connectClient(realtime, { clientId: "bob" });

    alice.send(JSON.stringify({
      type: "runtime.event",
      seq: 1,
      name: "realtime.canvas.clicked",
      detail: { stateId: "start" }
    }));

    const received = await nextMessage(bob, message => message.type === "runtime.event");
    assert.equal(received.clientId, "alice");
    assert.equal(received.name, "realtime.canvas.clicked");
    assert.deepEqual(received.detail, { stateId: "start" });
    await assertNoMessage(alice, message => message.type === "runtime.event");
  });
});

test("drops duplicate runtime event client sequences", async () => {
  await withRealtimeServer({ roomSecret: SECRET }, async realtime => {
    const alice = await connectClient(realtime, { clientId: "alice" });
    const bob = await connectClient(realtime, { clientId: "bob" });

    const event = {
      type: "runtime.event",
      seq: 1,
      name: "realtime.canvas.clicked",
      detail: { stateId: "start" }
    };
    alice.send(JSON.stringify(event));
    alice.send(JSON.stringify(event));

    const received = await nextMessage(bob, message => message.type === "runtime.event");
    assert.equal(received.clientId, "alice");
    assert.equal(received.name, "realtime.canvas.clicked");
    assert.deepEqual(received.detail, event.detail);
    await assertNoMessage(bob, message => message.type === "runtime.event");
  });
});

test("rejects graph patches and snapshots because model writes stay in the canonical API", async () => {
  await withRealtimeServer({ roomSecret: SECRET }, async realtime => {
    const socket = await connectClient(realtime, { clientId: "alice" });

    socket.send(JSON.stringify({
      type: "graph.patch",
      seq: 1,
      ops: [{ op: "state.move", id: "start", x: 100, y: 160 }]
    }));
    const patchError = await nextMessage(socket, message => message.type === "error");
    assert.equal(patchError.code, "invalid_type");

    socket.send(JSON.stringify({
      type: "snapshot",
      seq: 2,
      model: {}
    }));
    const snapshotError = await nextMessage(socket, message => message.type === "error");
    assert.equal(snapshotError.code, "invalid_type");
  });
});

test("rate limits noisy realtime clients", async () => {
  await withRealtimeServer({
    roomSecret: SECRET,
    rateLimitMax: 2,
    rateLimitWindowMs: 1000
  }, async realtime => {
    const socket = await connectClient(realtime, { clientId: "noisy" });

    socket.send(JSON.stringify({ type: "presence.cursor", seq: 1, cursor: { x: 1, y: 1 } }));
    socket.send(JSON.stringify({ type: "presence.cursor", seq: 2, cursor: { x: 2, y: 2 } }));
    socket.send(JSON.stringify({ type: "presence.cursor", seq: 3, cursor: { x: 3, y: 3 } }));

    const error = await nextMessage(socket, message => message.type === "error");
    assert.equal(error.code, "rate_limited");
  });
});
