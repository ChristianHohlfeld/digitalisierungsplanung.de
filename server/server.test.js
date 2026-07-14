"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const WebSocket = require("ws");
const eventCatalog = require("./event-catalog");
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

test("serves the event and connector catalog only to allowed origins", async () => {
  await withRealtimeServer({ roomSecret: SECRET }, async realtime => {
    const response = await fetch(httpUrl(realtime, "/events"), {
      headers: { Origin: ORIGIN }
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);

    const payload = await response.json();
    assert.equal(payload.provider.id, "digitalisierungsplanung.realtime");
    assert.equal(payload.state.path, "realtime");
    assert.equal(payload.transport, undefined);
    assert.ok(payload.emitters.some(emitter => emitter.id === "sip.threecx"));
    assert.ok(payload.emitters.some(emitter => emitter.id === "mail.gmail"));
    const incoming = payload.events.find(event => event.name === "realtime.sip.call.incoming");
    assert.ok(incoming);
    assert.deepEqual(incoming.bindings, []);
    assert.equal(incoming.contributes.root, "events.realtime.sip.call.incoming");
    assert.ok(incoming.contributes.fields.includes("events.realtime.sip.call.incoming.detail.callId"));

    const rejected = await fetch(httpUrl(realtime, "/events"), {
      headers: { Origin: "https://evil.example" }
    });
    assert.equal(rejected.status, 403);

    const contract = await fetch(httpUrl(realtime, "/events/contract"), {
      headers: { Origin: ORIGIN }
    });
    assert.equal(contract.status, 200);
    const contractPayload = await contract.json();
    assert.ok(contractPayload.events.some(event => event.name === "realtime.sip.call.incoming"));
    assert.deepEqual(
      contractPayload.events.find(event => event.name === "realtime.sip.call.incoming").detail,
      { caller: "text", callee: "text", callId: "text" }
    );

    const productContract = await fetch(httpUrl(realtime, "/contract"), {
      headers: { Origin: ORIGIN }
    });
    assert.equal(productContract.status, 200);
    assert.equal(productContract.headers.get("access-control-allow-origin"), ORIGIN);
    const productContractPayload = await productContract.json();
    assert.equal(productContractPayload.schemaVersion, 1);
    assert.ok(productContractPayload.triggerTypes.some(type => type.id === "button"));
    assert.ok(productContractPayload.triggerTypes.some(type => type.id === "timer"));
    assert.ok(productContractPayload.triggerTypes.some(type => type.id === "api"));
    const realtimeTrigger = productContractPayload.triggerTypes.find(type => type.id === "realtime");
    assert.ok(realtimeTrigger);
    assert.ok(realtimeTrigger.events.some(event => event.name === "realtime.sip.call.incoming"));
    assert.ok(productContractPayload.valueTypes.some(type => type.id === "text" && type.jsonType === "string"));
    assert.ok(productContractPayload.valueTypes.some(type =>
      type.id === "number" &&
      type.jsonType === "number" &&
      type.constraints.finite === true &&
      Number.isFinite(type.constraints.min) &&
      Number.isFinite(type.constraints.max)
    ));
    assert.ok(productContractPayload.valueTypes.some(type =>
      type.id === "email" &&
      type.jsonType === "string" &&
      type.constraints.format === "email" &&
      type.constraints.maxLength === 320
    ));
    assert.ok(productContractPayload.datasets.some(dataset =>
      dataset.id === "realtime.sip.call.incoming" &&
      dataset.fields.callId === "text" &&
      dataset.fieldSchemas.callId.type === "text" &&
      dataset.fieldSchemas.callId.constraints.maxLength === 20000
    ));
    assert.ok(productContractPayload.stateContributions.some(contribution =>
      contribution.root === "events.realtime.sip.call.incoming" &&
      contribution.fields.includes("events.realtime.sip.call.incoming.detail.callId") &&
      contribution.fieldTypes["events.realtime.sip.call.incoming.detail.callId"] === "text" &&
      contribution.fieldSchemas["events.realtime.sip.call.incoming.detail.callId"].type === "text"
    ));
    const buttonPreset = productContractPayload.presets.find(preset => preset.id === "builtin_daisy_button");
    assert.ok(buttonPreset);
    assert.equal(buttonPreset.dataTypes.clicked, "boolean");
    assert.equal(buttonPreset.stateContribution.root, "states.button");
    assert.equal(buttonPreset.stateContribution.fieldSchemas["states.button.clicked"].type, "boolean");
    assert.equal(buttonPreset.stateContribution.fieldSchemas["states.button.clicked"].jsonType, "boolean");
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
    "events-admin.html",
    "/events-admin/catalog",
    "/contract",
    "/events/contract",
    "/healthz",
    "/version",
    "/token",
    "/events",
    "/emit",
    "/process/contract",
    "/process/analyze",
    "/ws"
  ]) {
    assert.ok(normalized.includes(route), `${route} route is missing`);
  }
  assert.match(normalized, /location = \/ws/);
  assert.match(normalized, /location = \/process\/analyze/);
  assert.match(nginx, /location = \/process\/analyze[\s\S]*proxy_request_buffering off;/);
  assert.match(nginx, /proxy_pass\s+http:\/\/127\.0\.0\.1:8788;/);
});

test("serves an admin event designer that validates, commits, and pushes the catalog", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "realtime-catalog-"));
  const catalogPath = path.join(tempDir, "server", "event-catalog.json");
  const calls = [];
  fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
  fs.writeFileSync(catalogPath, eventCatalog.serializeEventCatalog(eventCatalog.DEFAULT_EVENT_CATALOG));

  const gitRunner = (args) => {
    calls.push(args);
    if (args[0] === "diff") return { status: 1, stdout: "", stderr: "" };
    if (args[0] === "rev-parse") return { status: 0, stdout: "abc123\n", stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };

  try {
    await withRealtimeServer({
      roomSecret: SECRET,
      adminSecret: "admin-secret",
      eventCatalogPath: catalogPath,
      repoDir: tempDir,
      gitRunner
    }, async realtime => {
      const htmlResponse = await fetch(httpUrl(realtime, "/events-admin.html"));
      assert.equal(htmlResponse.status, 200);
      const html = await htmlResponse.text();
      assert.match(html, /Realtime Event Designer/);
      assert.match(html, /Save to GitHub/);
      assert.match(html, /fetch\("\/events"/);
      assert.match(html, /fetch\("\/contract"/);
      assert.match(html, /localStorage\.setItem\(ADMIN_SECRET_STORAGE_KEY/);
      assert.match(html, /Existing datasets/);
      assert.match(html, /datasetOverview/);
      assert.match(html, /New blank dataset/);
      assert.match(html, /placeholder="custom\.dataset"/);
      assert.match(html, /pathInput\.placeholder = "fieldName"/);
      assert.match(html, /return "custom\.dataset"/);
      assert.match(html, /detail: \{\}/);
      assert.match(html, /Add field/);
      assert.doesNotMatch(html, /placeholder="sip\.call\.incoming"/);
      assert.doesNotMatch(html, /detail: \{ value: "text" \}/);
      assert.doesNotMatch(html, /admin-secret/);

      const unauthorized = await fetch(httpUrl(realtime, "/events-admin/catalog"));
      assert.equal(unauthorized.status, 401);

      const load = await fetch(httpUrl(realtime, "/events-admin/catalog"), {
        headers: { authorization: "Bearer admin-secret" }
      });
      assert.equal(load.status, 200);
      const loaded = await load.json();
      assert.equal(loaded.catalog.provider.id, "digitalisierungsplanung.realtime");

      const invalid = await fetch(httpUrl(realtime, "/events-admin/catalog"), {
        method: "POST",
        headers: {
          authorization: "Bearer admin-secret",
          "content-type": "application/json"
        },
        body: JSON.stringify({ catalog: { ...loaded.catalog, unknown: true } })
      });
      assert.equal(invalid.status, 400);
      assert.deepEqual(await invalid.json(), { error: "unknown_field" });

      const missedCall = {
        name: "realtime.sip.call.missed",
        label: "Missed call",
        description: "SIP call was not answered",
        detail: { caller: "text", callId: "text", missedAt: "text" },
        bindings: []
      };
      loaded.catalog.events.push(missedCall);
      loaded.catalog.emitters[0].events.push(missedCall.name);
      const validateOnly = await fetch(httpUrl(realtime, "/events-admin/catalog?validate=1"), {
        method: "POST",
        headers: {
          authorization: "Bearer admin-secret",
          "content-type": "application/json"
        },
        body: JSON.stringify({ catalog: loaded.catalog, validateOnly: true })
      });
      assert.equal(validateOnly.status, 200);
      assert.equal((await validateOnly.json()).ok, true);

      const saved = await fetch(httpUrl(realtime, "/events-admin/catalog"), {
        method: "POST",
        headers: {
          authorization: "Bearer admin-secret",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          catalog: loaded.catalog,
          message: "Add missed call dataset"
        })
      });
      assert.equal(saved.status, 200);
      const savedPayload = await saved.json();
      assert.equal(savedPayload.ok, true);
      assert.equal(savedPayload.changed, true);
      assert.equal(savedPayload.commit, "abc123");
      assert.equal(savedPayload.releaseId, "release-1");
      assert.equal(savedPayload.releaseSequence, 1);
      assert.match(fs.readFileSync(catalogPath, "utf8"), /realtime\.sip\.call\.missed/);
      assert.match(fs.readFileSync(path.join(tempDir, "release-version.js"), "utf8"), /ZUSTAND_RELEASE_ID = "release-1"/);
      const refreshed = await fetch(httpUrl(realtime, "/events"));
      assert.equal(refreshed.status, 200);
      const refreshedCatalog = await refreshed.json();
      assert.ok(refreshedCatalog.events.some(event => event.name === "realtime.sip.call.missed"));
      assert.equal(refreshedCatalog.release.releaseId, "release-1");
      const refreshedContract = await fetch(httpUrl(realtime, "/events/contract"));
      assert.equal(refreshedContract.status, 200);
      const refreshedContractPayload = await refreshedContract.json();
      assert.ok(refreshedContractPayload.events.some(event => event.name === "realtime.sip.call.missed"));
      assert.ok(calls.some(args => args[0] === "add" && args.includes("server/event-catalog.json") && args.includes("release-version.js")));
      assert.ok(calls.some(args => args[0] === "commit" || args.includes("commit")));
      assert.ok(calls.some(args => args[0] === "push" || args.includes("push")));
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
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
    assert.match(html, /localStorage\.setItem\(EMIT_SECRET_STORAGE_KEY/);
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
        emitterId: "sip.threecx",
        name: "realtime.sip.call.incoming",
        detail: { caller: "+491234", callee: "100", callId: "console-123" }
      })
    });
    assert.equal(response.status, 202);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);

    const received = await runtimeEvent;
    assert.equal(received.clientId, "console");
    assert.equal(received.emitterId, "sip.threecx");
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
        emitterId: "sip.threecx",
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
      assert.equal(received.emitterId, "sip.threecx");
      assert.equal(received.name, "realtime.sip.call.incoming");
      assert.deepEqual(received.detail, { caller: "+491234", callee: "100", callId: "abc-123" });
      assert.equal(received.event?.name, "realtime.sip.call.incoming");
    }

    const unauthorized = await fetch(httpUrl(realtime, "/emit"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomId: "room", emitterId: "sip.threecx", name: "realtime.sip.call.incoming" })
    });
    assert.equal(unauthorized.status, 401);

    const unknown = await fetch(httpUrl(realtime, "/emit"), {
      method: "POST",
      headers: {
        authorization: "Bearer emit-secret",
        "content-type": "application/json"
      },
      body: JSON.stringify({ roomId: "room", emitterId: "sip.threecx", name: "realtime.unknown.event" })
    });
    assert.equal(unknown.status, 400);
    assert.deepEqual(await unknown.json(), { error: "event_not_offered" });

    const missingDetail = await fetch(httpUrl(realtime, "/emit"), {
      method: "POST",
      headers: {
        authorization: "Bearer emit-secret",
        "content-type": "application/json"
      },
      body: JSON.stringify({ roomId: "room", emitterId: "sip.threecx", name: "realtime.sip.call.incoming", detail: { callId: "abc-123" } })
    });
    assert.equal(missingDetail.status, 400);
    assert.deepEqual(await missingDetail.json(), { error: "missing_detail_field" });

    const unknownDetail = await fetch(httpUrl(realtime, "/emit"), {
      method: "POST",
      headers: {
        authorization: "Bearer emit-secret",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        roomId: "room",
        emitterId: "sip.threecx",
        name: "realtime.sip.call.incoming",
        detail: { caller: "+491234", callee: "100", callId: "abc-123", extra: true }
      })
    });
    assert.equal(unknownDetail.status, 400);
    assert.deepEqual(await unknownDetail.json(), { error: "unknown_detail_field" });

    const invalidEmail = await fetch(httpUrl(realtime, "/emit"), {
      method: "POST",
      headers: {
        authorization: "Bearer emit-secret",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        roomId: "room",
        emitterId: "mail.gmail",
        name: "realtime.mail.received",
        detail: { from: "not-an-email", subject: "Hello", messageId: "m-123" }
      })
    });
    assert.equal(invalidEmail.status, 400);
    assert.deepEqual(await invalidEmail.json(), { error: "invalid_detail_value" });

    const wrongEmitter = await fetch(httpUrl(realtime, "/emit"), {
      method: "POST",
      headers: {
        authorization: "Bearer emit-secret",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        roomId: "room",
        emitterId: "mail.gmail",
        name: "realtime.sip.call.incoming",
        detail: { caller: "+491234", callee: "100", callId: "abc-123" }
      })
    });
    assert.equal(wrongEmitter.status, 400);
    assert.deepEqual(await wrongEmitter.json(), { error: "emitter_event_not_allowed" });
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

    socket.send(JSON.stringify({ type: "runtime.event", seq: 1, name: "realtime.sip.call.incoming", detail: { caller: "+491", callee: "100", callId: "1" } }));
    socket.send(JSON.stringify({ type: "runtime.event", seq: 2, name: "realtime.sip.call.incoming", detail: { caller: "+491", callee: "100", callId: "2" } }));
    socket.send(JSON.stringify({ type: "runtime.event", seq: 3, name: "realtime.sip.call.incoming", detail: { caller: "+491", callee: "100", callId: "3" } }));

    const error = await nextMessage(socket, message => message.type === "error");
    assert.equal(error.code, "rate_limited");
  });
});

test("rejects runtime events whose detail does not match the catalog", async () => {
  await withRealtimeServer({ roomSecret: SECRET }, async realtime => {
    const alice = await connectClient(realtime, { clientId: "alice" });
    const bob = await connectClient(realtime, { clientId: "bob" });

    alice.send(JSON.stringify({
      type: "runtime.event",
      seq: 1,
      name: "realtime.sip.call.ended",
      detail: { callId: "call-1", duration: "12" }
    }));
    const error = await nextMessage(alice, message => message.type === "error");
    assert.equal(error.code, "invalid_detail_type");
    await assertNoMessage(bob, message => message.type === "runtime.event");
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

test("serves stateless process-recorder capability and a validated no-store model", async () => {
  let receivedCapture = null;
  await withRealtimeServer({
    processAnalyzer: async capture => {
      receivedCapture = capture;
      return {
        title: "Anfrage bearbeiten",
        steps: [
          { title: "Anfrage", description: "Anfrage liegt vor.", actionToNext: "Prüfen" },
          { title: "Geprüft", description: "Anfrage wurde geprüft.", actionToNext: "" }
        ]
      };
    }
  }, async realtime => {
    const contract = await fetch(httpUrl(realtime, "/process/contract"), { headers: { Origin: ORIGIN } });
    assert.equal(contract.status, 200);
    assert.match(contract.headers.get("cache-control"), /no-store/);
    const capability = await contract.json();
    assert.equal(capability.enabled, true);
    assert.deepEqual(capability.capture.sources, ["windows-companion"]);
    assert.equal(capability.capture.persisted, false);

    const response = await fetch(httpUrl(realtime, "/process/analyze"), {
      method: "POST",
      headers: { Origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "session",
        startedAt: 1,
        endedAt: 2,
        events: [
          { seq: 1, at: 1, kind: "application", app: "browser", window: "Anfrage" },
          { seq: 2, at: 2, kind: "click", app: "browser", window: "Anfrage", button: "left", control: { name: "Prüfen", type: "Button", password: false } }
        ],
        frames: []
      })
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /no-store/);
    const body = await response.json();
    assert.equal(body.contract, "zustand-process-model-v1");
    assert.equal(body.model.states.length, 2);
    assert.equal(body.model.transitions[0].triggerEvent, `button.${body.model.transitions[0].id}`);
    assert.equal(receivedCapture.events.length, 2);

    const forbidden = await fetch(httpUrl(realtime, "/process/analyze"), {
      method: "POST",
      headers: { Origin: "https://evil.example", "content-type": "application/json" },
      body: "{}"
    });
    assert.equal(forbidden.status, 403);
  });
});

test("bounds concurrent process agents and releases the slot after completion", async () => {
  let releaseFirst;
  let firstEntered;
  const entered = new Promise(resolve => { firstEntered = resolve; });
  const firstResult = new Promise(resolve => { releaseFirst = resolve; });
  let calls = 0;
  const trace = {
    title: "Ablauf",
    steps: [{ title: "Start", description: "Beginn", actionToNext: "" }]
  };
  const payload = {
    sessionId: "session",
    startedAt: 1,
    endedAt: 2,
    events: [{ seq: 1, at: 1, kind: "application", app: "browser", window: "Start" }],
    frames: []
  };
  await withRealtimeServer({
    processMaxConcurrent: 1,
    processAnalyzer: async () => {
      calls += 1;
      if (calls === 1) {
        firstEntered();
        return firstResult;
      }
      return trace;
    }
  }, async realtime => {
    const request = () => fetch(httpUrl(realtime, "/process/analyze"), {
      method: "POST",
      headers: { Origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const first = request();
    await entered;
    const busy = await request();
    assert.equal(busy.status, 429);
    assert.deepEqual(await busy.json(), { error: "process_analyzer_busy" });
    releaseFirst(trace);
    assert.equal((await first).status, 200);
    assert.equal((await request()).status, 200);
    assert.equal(calls, 2);
  });
});
