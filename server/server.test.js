"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const WebSocket = require("ws");
const adminTools = require("./admin-tools");
const presetCatalog = require("./preset-catalog");
const productContract = require("./product-contract");
const { createRealtimeServer, createRoomToken, verifyRoomToken } = require("./server");

const ORIGIN = "https://digitalisierungsplanung.de";
const SECRET = "test-room-secret";
const NGINX_CONFIG_PATH = `${__dirname}/nginx/realtime.digitalisierungsplanung.de.conf`;
const FOCUSED_PRESET_IDS = [
  "builtin_daisy_dropdown",
  "builtin_daisy_button",
  "builtin_daisy_toast",
  "builtin_daisy_checkbox",
  "builtin_daisy_input",
  "builtin_daisy_input_number",
  "builtin_daisy_search",
  "builtin_daisy_input_email",
  "builtin_daisy_input_password",
  "builtin_page_heading",
  "builtin_media_image",
  "builtin_daisy_date",
  "builtin_daisy_radio"
];
const REMOVED_ROUTES = [
  "/presets-admin.html",
  "/presets-admin/catalog",
  "/presets-admin/parse",
  "/presets-admin/import",
  "/agent.html",
  "/agent/config",
  "/agent/chat",
  "/agent/mcp/tool",
  "/agent/editor/prompt",
  "/assets/agent-widget.js",
  "/mcp"
];

function httpUrl(realtime, routePath) {
  const { port } = realtime.address();
  return `http://127.0.0.1:${port}${routePath}`;
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

function socketUrl(realtime) {
  const { port } = realtime.address();
  return `ws://127.0.0.1:${port}/ws`;
}

function waitForOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function nextMessage(socket, predicate = () => true, timeoutMs = 700) {
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

test("signed room tokens protect runtime rooms", () => {
  const token = createRoomToken({ roomId: "room", clientId: "alice", secret: SECRET, ttlMs: 60000 });
  assert.equal(verifyRoomToken(token, { roomId: "room", clientId: "alice", secret: SECRET }).ok, true);
  assert.equal(verifyRoomToken(token, { roomId: "other", clientId: "alice", secret: SECRET }).code, "room_mismatch");
});

test("product contract exposes the focused preset contract only", async () => {
  const contract = productContract.productContractResponse({});
  assert.deepEqual(presetCatalog.presetCatalogResponse().map(preset => preset.id), FOCUSED_PRESET_IDS);
  assert.deepEqual(contract.presets.map(preset => preset.id), FOCUSED_PRESET_IDS);
  assert.equal(contract.presets.some(preset => preset.builtIn === false), false);
  assert.equal(contract.presets.some(preset => preset.contractOnly || preset.managedOnly || preset.legacy || preset.hidden), false);
  for (const blocked of ["builtin_daisy_bi_kpi_board", "builtin_daisy_stripe_pricing", "custom_acme_footer"]) {
    assert.equal(contract.presets.some(preset => preset.id === blocked), false, blocked);
  }
  assert.ok(contract.triggerTypes.some(type => type.id === "realtime"));
  assert.ok(contract.triggerTypes.some(type => type.id === "timer"));
  assert.ok(contract.valueTypes.some(type => type.id === "email"));
});

test("lean admin route index keeps events, console, contract and system only", () => {
  const index = adminTools.adminRouteIndex({});
  assert.deepEqual(index.tools.map(tool => tool.id), ["events", "console", "contract", "system"]);
  const routeText = JSON.stringify(index);
  for (const removed of REMOVED_ROUTES) assert.equal(routeText.includes(removed), false, `${removed} must not be advertised`);
  assert.ok(index.endpoints.some(endpoint => endpoint.path === "/events-admin/catalog"));
  assert.ok(index.endpoints.some(endpoint => endpoint.path === "/emit"));
  assert.ok(index.endpoints.some(endpoint => endpoint.path === "/ws"));
});

test("nginx exposes only the lean realtime/admin surface", () => {
  const nginx = fs.readFileSync(NGINX_CONFIG_PATH, "utf8");
  const normalized = nginx.replace(/\\\./g, ".");
  const routeIndex = adminTools.adminRouteIndex({});
  for (const endpoint of routeIndex.endpoints) {
    assert.ok(normalized.includes(`location = ${endpoint.path}`), `${endpoint.id} missing from nginx`);
  }
  for (const removed of REMOVED_ROUTES) assert.equal(normalized.includes(removed), false, `${removed} must not be public`);
  assert.match(nginx, /proxy_pass\s+http:\/\/127\.0\.0\.1:8788;/);
});

test("event catalog stays usable as webhook/runtime trigger source", async () => {
  await withRealtimeServer({ roomSecret: SECRET, emitSecret: "emit-secret" }, async realtime => {
    const events = await fetch(httpUrl(realtime, "/events"), { headers: { Origin: ORIGIN } });
    assert.equal(events.status, 200);
    assert.equal(events.headers.get("access-control-allow-origin"), ORIGIN);
    const catalog = await events.json();
    assert.ok(catalog.events.some(event => event.name === "realtime.sip.call.incoming"));

    const socket = new WebSocket(socketUrl(realtime), { headers: { Origin: ORIGIN } });
    await waitForOpen(socket);
    socket.send(JSON.stringify({
      type: "join",
      roomId: "room",
      clientId: "alice",
      token: createRoomToken({ roomId: "room", clientId: "alice", secret: SECRET, ttlMs: 60000 })
    }));
    const joined = await nextMessage(socket, message => message.type === "joined");
    assert.equal(joined.clientId, "alice");

    const runtimeEvent = nextMessage(socket, message => message.type === "runtime.event");
    const emitted = await fetch(httpUrl(realtime, "/emit"), {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        authorization: "Bearer emit-secret",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        roomId: "room",
        clientId: "webhook",
        emitterId: "sip.threecx",
        name: "realtime.sip.call.incoming",
        detail: { caller: "+491234", callee: "100", callId: "call-1" }
      })
    });
    assert.equal(emitted.status, 202);
    const received = await runtimeEvent;
    assert.equal(received.name, "realtime.sip.call.incoming");
    assert.equal(received.emitterId, "sip.threecx");
    socket.close();
  });
});

test("server reports health and release without caching", async () => {
  const release = {
    id: "release-test",
    sequence: 999,
    builtAt: "2026-08-21T12:00:00Z",
    sourceCommit: "abc123",
    deployedCommit: "def456"
  };
  await withRealtimeServer({ roomSecret: SECRET, release }, async realtime => {
    const version = await fetch(httpUrl(realtime, "/version"), { headers: { Origin: ORIGIN } });
    assert.equal(version.status, 200);
    assert.equal(version.headers.get("cache-control"), "no-store");
    assert.deepEqual(await version.json(), {
      ok: true,
      releaseId: "release-test",
      releaseSequence: 999,
      builtAt: release.builtAt,
      sourceCommit: "abc123",
      deployedCommit: "def456"
    });

    const health = await fetch(httpUrl(realtime, "/healthz"));
    assert.equal(health.status, 200);
    const payload = await health.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.releaseId, "release-test");
  });
});
