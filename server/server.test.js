"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const WebSocket = require("ws");
const {
  createRealtimeServer,
  createRoomToken,
  verifyRoomToken
} = require("./server");

const ORIGIN = "https://digitalisierungsplanung.de";
const SECRET = "test-room-secret";
const NGINX_CONFIG_PATH = `${__dirname}/nginx/realtime.digitalisierungsplanung.de.conf`;

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

test("serves event definitions only to allowed origins", async () => {
  await withRealtimeServer({ roomSecret: SECRET }, async realtime => {
    const response = await fetch(httpUrl(realtime, "/events"), {
      headers: { Origin: ORIGIN }
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);

    const payload = await response.json();
    assert.equal(payload.provider, undefined);
    assert.equal(payload.state, undefined);
    assert.equal(payload.transport, undefined);
    assert.ok(payload.events.some(event => event.name === "realtime.sip.call.incoming"));
    assert.deepEqual(payload.events
      .find(event => event.name === "realtime.sip.call.incoming")
      .bindings, []);

    const rejected = await fetch(httpUrl(realtime, "/events"), {
      headers: { Origin: "https://evil.example" }
    });
    assert.equal(rejected.status, 403);
  });
});

test("exposes one shared frontend and backend release without caching it", async () => {
  const release = {
    id: "release-59",
    sequence: 59,
    builtAt: "2026-07-12T00:00:00Z",
    sourceCommit: "1234567890abcdef",
    deployedCommit: "abcdef1234567890"
  };
  await withRealtimeServer({ roomSecret: SECRET, release }, async realtime => {
    const versionResponse = await fetch(httpUrl(realtime, "/version"), {
      headers: { Origin: ORIGIN }
    });
    assert.equal(versionResponse.status, 200);
    assert.equal(versionResponse.headers.get("cache-control"), "no-store");
    assert.equal(versionResponse.headers.get("access-control-allow-origin"), ORIGIN);
    assert.deepEqual(await versionResponse.json(), {
      ok: true,
      releaseId: "release-59",
      releaseSequence: 59,
      builtAt: release.builtAt,
      sourceCommit: release.sourceCommit,
      deployedCommit: release.deployedCommit
    });

    const healthResponse = await fetch(httpUrl(realtime, "/healthz"));
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), {
      ok: true,
      releaseId: "release-59",
      releaseSequence: 59,
      builtAt: release.builtAt,
      sourceCommit: release.sourceCommit,
      deployedCommit: release.deployedCommit,
      rooms: 0,
      clients: 0
    });
  });
});

test("returns not_found for non-core realtime routes", async () => {
  await withRealtimeServer({ roomSecret: SECRET }, async realtime => {
    for (const path of ["/", "/catalog", "/schema", "/api"]) {
      const response = await fetch(httpUrl(realtime, path), { headers: { Origin: ORIGIN } });
      assert.equal(response.status, 404, `${path} should stay out of the lean realtime API`);
      assert.deepEqual(await response.json(), { error: "not_found" });
    }
  });
});

test("nginx proxies only lean public realtime routes", () => {
  const nginx = fs.readFileSync(NGINX_CONFIG_PATH, "utf8");
  const normalized = nginx.replace(/\\\./g, ".");
  for (const route of [
    "console.html",
    "/healthz",
    "/version",
    "/token",
    "/events",
    "/emit",
    "/ws"
  ]) {
    assert.ok(normalized.includes(route), `${route} route is missing`);
  }
  assert.match(normalized, /location = \/ws/);
  assert.match(nginx, /proxy_pass\s+http:\/\/127\.0\.0\.1:8788;/);
});

test("serves a stateless event console for catalogued test emits", async () => {
  await withRealtimeServer({ roomSecret: SECRET, emitSecret: "emit-secret" }, async realtime => {
    const consoleResponse = await fetch(httpUrl(realtime, "/console.html"));
    assert.equal(consoleResponse.status, 200);
    assert.match(consoleResponse.headers.get("content-type") || "", /text\/html/);
    const html = await consoleResponse.text();
    assert.match(html, /Realtime Event Console/);
    assert.match(html, /fetch\("\/events"/);
    assert.match(html, /fetch\("\/emit"/);
    assert.doesNotMatch(html, /emit-secret/);

    const socket = await connectClient(realtime, { clientId: "alice" });
    const runtimeEvent = nextMessage(socket, message => message.type === "runtime.event");
    const origin = httpUrl(realtime, "");
    const response = await fetch(httpUrl(realtime, "/emit"), {
      method: "POST",
      headers: {
        authorization: "Bearer emit-secret",
        "content-type": "application/json",
        origin
      },
      body: JSON.stringify({
        roomId: "room",
        clientId: "console",
        name: "realtime.sip.call.incoming",
        detail: { caller: "+491234", callee: "100", callId: "console-123" }
      })
    });
    assert.equal(response.status, 202);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);

    const received = await runtimeEvent;
    assert.equal(received.clientId, "console");
    assert.equal(received.name, "realtime.sip.call.incoming");
    assert.deepEqual(received.detail, { caller: "+491234", callee: "100", callId: "console-123" });
    assert.equal(received.event?.name, "realtime.sip.call.incoming");
    assert.deepEqual(received.event?.detail, { caller: "text", callee: "text", callId: "text" });
  });
});

test("relays runtime events to peers without echoing them to the sender", async () => {
  await withRealtimeServer({ roomSecret: SECRET }, async realtime => {
    const alice = await connectClient(realtime, { clientId: "alice" });
    const bob = await connectClient(realtime, { clientId: "bob" });

    alice.send(JSON.stringify({
      type: "runtime.event",
      seq: 1,
      name: "realtime.sip.call.incoming",
      detail: { caller: "+491234", callee: "100", callId: "ws-123" }
    }));

    const received = await nextMessage(bob, message => message.type === "runtime.event");
    assert.equal(received.clientId, "alice");
    assert.equal(received.name, "realtime.sip.call.incoming");
    assert.deepEqual(received.detail, { caller: "+491234", callee: "100", callId: "ws-123" });
    assert.equal(received.event?.name, "realtime.sip.call.incoming");
    await assertNoMessage(alice, message => message.type === "runtime.event");
  });
});

test("rejects uncatalogued runtime events over WebSocket", async () => {
  await withRealtimeServer({ roomSecret: SECRET }, async realtime => {
    const alice = await connectClient(realtime, { clientId: "alice" });
    const bob = await connectClient(realtime, { clientId: "bob" });
    const errorMessage = nextMessage(alice, message => message.type === "error");

    alice.send(JSON.stringify({
      type: "runtime.event",
      seq: 1,
      name: "realtime.canvas.clicked",
      detail: { stateId: "start" }
    }));

    const error = await errorMessage;
    assert.equal(error.code, "event_not_offered");
    await assertNoMessage(bob, message => message.type === "runtime.event");
  });
});

test("emits catalogued server events into a room without server-side state", async () => {
  await withRealtimeServer({ roomSecret: SECRET, emitSecret: "emit-secret" }, async realtime => {
    const alice = await connectClient(realtime, { clientId: "alice" });
    const bob = await connectClient(realtime, { clientId: "bob" });
    const aliceRuntimeEvent = nextMessage(alice, message => message.type === "runtime.event");
    const bobRuntimeEvent = nextMessage(bob, message => message.type === "runtime.event");

    const response = await fetch(httpUrl(realtime, "/emit"), {
      method: "POST",
      headers: {
        authorization: "Bearer emit-secret",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        roomId: "room",
        name: "realtime.sip.call.incoming",
        detail: { caller: "+491234", callee: "100", callId: "abc-123" }
      })
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      ok: true,
      roomId: "room",
      name: "realtime.sip.call.incoming",
      delivered: 2
    });

    const [aliceEvent, bobEvent] = await Promise.all([aliceRuntimeEvent, bobRuntimeEvent]);
    for (const received of [aliceEvent, bobEvent]) {
      assert.equal(received.clientId, "server");
      assert.equal(received.name, "realtime.sip.call.incoming");
      assert.deepEqual(received.detail, { caller: "+491234", callee: "100", callId: "abc-123" });
      assert.equal(received.event?.name, "realtime.sip.call.incoming");
    }

    const unauthorized = await fetch(httpUrl(realtime, "/emit"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomId: "room", name: "realtime.sip.call.incoming" })
    });
    assert.equal(unauthorized.status, 401);

    const unknown = await fetch(httpUrl(realtime, "/emit"), {
      method: "POST",
      headers: {
        authorization: "Bearer emit-secret",
        "content-type": "application/json"
      },
      body: JSON.stringify({ roomId: "room", name: "realtime.unknown.event" })
    });
    assert.equal(unknown.status, 400);
    assert.deepEqual(await unknown.json(), { error: "event_not_offered" });
  });
});

test("drops duplicate runtime event client sequences", async () => {
  await withRealtimeServer({ roomSecret: SECRET }, async realtime => {
    const alice = await connectClient(realtime, { clientId: "alice" });
    const bob = await connectClient(realtime, { clientId: "bob" });

    const event = {
      type: "runtime.event",
      seq: 1,
      name: "realtime.sip.call.incoming",
      detail: { caller: "+491234", callee: "100", callId: "dupe-123" }
    };
    alice.send(JSON.stringify(event));
    alice.send(JSON.stringify(event));

    const received = await nextMessage(bob, message => message.type === "runtime.event");
    assert.equal(received.clientId, "alice");
    assert.equal(received.name, "realtime.sip.call.incoming");
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

    socket.send(JSON.stringify({ type: "runtime.event", seq: 1, name: "realtime.sip.call.incoming", detail: { callId: "1" } }));
    socket.send(JSON.stringify({ type: "runtime.event", seq: 2, name: "realtime.sip.call.incoming", detail: { callId: "2" } }));
    socket.send(JSON.stringify({ type: "runtime.event", seq: 3, name: "realtime.sip.call.incoming", detail: { callId: "3" } }));

    const error = await nextMessage(socket, message => message.type === "error");
    assert.equal(error.code, "rate_limited");
  });
});

test("rejects removed presence and never broadcasts peer lifecycle messages", async () => {
  await withRealtimeServer({ roomSecret: SECRET }, async realtime => {
    const alice = await connectClient(realtime, { clientId: "alice" });
    const bob = await connectClient(realtime, { clientId: "bob" });

    await assertNoMessage(alice, message => message.type === "peer.join");
    bob.send(JSON.stringify({ type: "presence.cursor", seq: 1, cursor: { x: 1, y: 1 } }));
    const error = await nextMessage(bob, message => message.type === "error");
    assert.equal(error.code, "invalid_type");
    bob.close();
    await assertNoMessage(alice, message => message.type === "peer.leave");
  });
});
