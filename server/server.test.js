"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const WebSocket = require("ws");
const eventCatalog = require("./event-catalog");
const presetLibrary = require("./preset-library");
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
    assert.deepEqual(
      productContractPayload.subscriptionPlans.map(plan => plan.id),
      ["starter", "business", "scale"]
    );
    assert.ok(productContractPayload.presetPackages.some(pack =>
      pack.id === "website.builder" &&
      pack.includedInPlanIds.includes("business") &&
      pack.presetCount > 0
    ));
    assert.ok(productContractPayload.presetPackages.some(pack =>
      pack.id === "bi.analytics" &&
      pack.upsell === true &&
      pack.includedInPlanIds.length === 0 &&
      pack.presetIds.includes("builtin_daisy_bi_kpi_board")
    ));
    const flowTrigger = productContractPayload.triggerTypes.find(type => type.id === "flow");
    assert.ok(flowTrigger);
    assert.equal(flowTrigger.internal, true);
    assert.ok(flowTrigger.events.some(event =>
      event.id === "flow.child.entry" &&
      event.name === "flow.child.entry" &&
      event.internal === true
    ));
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
    assert.deepEqual(buttonPreset.packageIds, ["core.process"]);
    const chartPreset = productContractPayload.presets.find(preset => preset.id === "builtin_daisy_bi_kpi_board");
    assert.ok(chartPreset);
    assert.deepEqual(chartPreset.packageIds, ["bi.analytics"]);
    assert.equal(chartPreset.components[0].variant, "chart");
    assert.equal(chartPreset.stateContribution.root, "states.bi_kpi_board");
    assert.equal(chartPreset.stateContribution.fieldSchemas["states.bi_kpi_board.items"].type, "list");
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
    for (const path of ["/admin", "/catalog", "/schema", "/api", "/process/contract", "/process/analyze"]) {
      const response = await fetch(httpUrl(realtime, path), { headers: { Origin: ORIGIN } });
      assert.equal(response.status, 404, `${path} should stay out of the lean realtime API`);
      assert.deepEqual(await response.json(), { error: "not_found" });
    }
    const removedAnalyzer = await fetch(httpUrl(realtime, "/process/analyze"), {
      method: "POST",
      headers: { Origin: ORIGIN, "content-type": "application/json" },
      body: "{}"
    });
    assert.equal(removedAnalyzer.status, 404);
    assert.deepEqual(await removedAnalyzer.json(), { error: "not_found" });
  });
});

test("serves one central admin hub from the server route index", async () => {
  const release = {
    id: "release-60",
    sequence: 60,
    builtAt: "2026-07-14T10:00:00.000Z",
    sourceCommit: "abcdef1",
    deployedCommit: "abcdef1"
  };
  await withRealtimeServer({ roomSecret: SECRET, release }, async realtime => {
    for (const path of ["/", "/admin.html"]) {
      const response = await fetch(httpUrl(realtime, path));
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, /Realtime Admin/);
      assert.match(html, /fetch\("\/admin\/routes"/);
      assert.doesNotMatch(html, /REALTIME_ADMIN_SECRET|admin-secret|emit-secret/);
      assert.doesNotMatch(html, /events-admin\.html.*presets-admin\.html.*console\.html/s);
    }

    const indexResponse = await fetch(httpUrl(realtime, "/admin/routes"), {
      headers: { Origin: ORIGIN }
    });
    assert.equal(indexResponse.status, 200);
    assert.equal(indexResponse.headers.get("access-control-allow-origin"), ORIGIN);
    const index = await indexResponse.json();
    assert.equal(index.schemaVersion, 1);
    assert.equal(index.release.releaseId, "release-60");
    assert.deepEqual(index.tools.map(tool => tool.id), ["events", "presets", "console", "contract", "system"]);
    assert.ok(index.endpoints.some(endpoint => endpoint.path === "/admin.html"));
    assert.ok(index.endpoints.some(endpoint => endpoint.path === "/admin/routes"));
    assert.ok(index.endpoints.some(endpoint => endpoint.method === "WSS" && endpoint.path === "/ws"));
    assert.ok(index.endpoints.some(endpoint => endpoint.method === "POST" && endpoint.path === "/emit"));
  });
});

test("nginx proxies only lean public realtime routes", () => {
  const nginx = fs.readFileSync(NGINX_CONFIG_PATH, "utf8");
  const serverSource = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  const normalized = nginx.replace(/\\\./g, ".");
  for (const route of [
    "location = /",
    "admin.html",
    "/admin/routes",
    "console.html",
    "events-admin.html",
    "/events-admin/catalog",
    "presets-admin.html",
    "/presets-admin/catalog",
    "/presets-admin/parse",
    "/presets-admin/import",
    "/contract",
    "/events/contract",
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
  assert.doesNotMatch(normalized, /\/process\//);
  assert.doesNotMatch(serverSource, /PROCESS_RECORDER|OPENAI_API_KEY|\/process\/analyze/);
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

test("converts official Daisy snippets into managed contract presets and pushes them", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "preset-library-"));
  const libraryPath = path.join(tempDir, "server", "preset-library.json");
  const calls = [];
  const importedUrls = [];
  fs.mkdirSync(path.dirname(libraryPath), { recursive: true });
  fs.copyFileSync(presetLibrary.DEFAULT_PRESET_LIBRARY_PATH, libraryPath);

  const gitRunner = args => {
    calls.push(args);
    if (args[0] === "diff") return { status: 1, stdout: "", stderr: "" };
    if (args[0] === "rev-parse") return { status: 0, stdout: "def456\n", stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };

  try {
    await withRealtimeServer({
      roomSecret: SECRET,
      adminSecret: "admin-secret",
      presetLibraryPath: libraryPath,
      repoDir: tempDir,
      gitRunner,
      presetApiFetcher: async url => {
        importedUrls.push(url);
        return {
          id: "custom_api_card",
          variant: "card",
          title: "API Card",
          description: "Imported from API.",
          categoryId: "websuite-builder",
          packageIds: ["website.builder"],
          data: { title: "API Card", body: "Canonical response", image: "", imageAlt: "", actionLabel: "Weiter" }
        };
      }
    }, async realtime => {
      const htmlResponse = await fetch(httpUrl(realtime, "/presets-admin.html"));
      assert.equal(htmlResponse.status, 200);
      const html = await htmlResponse.text();
      assert.match(html, /Preset Designer/);
      assert.match(html, /DaisyUI-Snippet/);
      assert.match(html, /Webhook\/API-URL/);
      assert.match(html, /API abrufen/);
      assert.match(html, /In Contract speichern/);
      assert.match(html, /\+ Neue Kategorie/);
      assert.match(html, /\+ Neues Paket/);
      assert.doesNotMatch(html, /admin-secret/);

      const unauthorized = await fetch(httpUrl(realtime, "/presets-admin/catalog"));
      assert.equal(unauthorized.status, 401);

      const load = await fetch(httpUrl(realtime, "/presets-admin/catalog"), {
        headers: { authorization: "Bearer admin-secret" }
      });
      assert.equal(load.status, 200);
      const loaded = await load.json();
      assert.deepEqual(loaded.library.categories.map(category => category.id), ["websuite-builder"]);
      assert.equal(loaded.library.daisyVersion, "5.6.18");

      const privateImport = await fetch(httpUrl(realtime, "/presets-admin/import"), {
        method: "POST",
        headers: { authorization: "Bearer admin-secret", "content-type": "application/json" },
        body: JSON.stringify({ url: "https://127.0.0.1/preset", library: loaded.library })
      });
      assert.equal(privateImport.status, 400);
      assert.deepEqual(await privateImport.json(), { error: "preset_api_target_not_public" });

      const importedResponse = await fetch(httpUrl(realtime, "/presets-admin/import"), {
        method: "POST",
        headers: { authorization: "Bearer admin-secret", "content-type": "application/json" },
        body: JSON.stringify({ url: "https://preset.example.test/card", library: loaded.library })
      });
      assert.equal(importedResponse.status, 200);
      const imported = await importedResponse.json();
      assert.equal(imported.preset.id, "custom_api_card");
      assert.equal(imported.preset.variant, "card");
      assert.deepEqual(importedUrls, ["https://preset.example.test/card"]);
      assert.equal(Object.hasOwn(imported.preset, "url"), false);

      const snippet = '<footer class="footer sm:footer-horizontal bg-base-200 text-base-content p-10"><aside><p class="footer-title">ACME</p><p>Aus Erfahrung wird Software.</p></aside><nav><h6 class="footer-title">Produkt</h6><a class="link link-hover">Start</a><a class="link link-hover">Kontakt</a></nav></footer>';
      const parsedResponse = await fetch(httpUrl(realtime, "/presets-admin/parse"), {
        method: "POST",
        headers: { authorization: "Bearer admin-secret", "content-type": "application/json" },
        body: JSON.stringify({
          snippet,
          title: "ACME Footer",
          categoryId: "portal",
          packageIds: ["portal.pro"]
        })
      });
      assert.equal(parsedResponse.status, 200);
      const parsed = await parsedResponse.json();
      assert.equal(parsed.preset.id, "custom_acme_footer");
      assert.equal(parsed.preset.variant, "footer");
      assert.equal(parsed.preset.data.brand, "ACME");
      assert.deepEqual(parsed.preset.data.columns[0].items, [
        { label: "Start", transitionId: "" },
        { label: "Kontakt", transitionId: "" }
      ]);
      assert.equal(Object.hasOwn(parsed.preset, "snippet"), false);

      const accordionResponse = await fetch(httpUrl(realtime, "/presets-admin/parse"), {
        method: "POST",
        headers: { authorization: "Bearer admin-secret", "content-type": "application/json" },
        body: JSON.stringify({
          snippet: '<div class="collapse collapse-arrow bg-base-100 border border-base-300"><input type="radio" name="faq" checked><div class="collapse-title">Versand</div><div class="collapse-content">Zwei Werktage.</div></div><div class="collapse collapse-arrow bg-base-100 border border-base-300"><input type="radio" name="faq"><div class="collapse-title">Rückgabe</div><div class="collapse-content">Dreißig Tage.</div></div>',
          title: "FAQ",
          categoryId: "websuite-builder",
          packageIds: ["knowledge.portal"]
        })
      });
      assert.equal(accordionResponse.status, 200);
      const accordion = await accordionResponse.json();
      assert.equal(accordion.preset.variant, "accordion");
      assert.deepEqual(accordion.preset.data.items, [
        { label: "Versand", body: "Zwei Werktage." },
        { label: "Rückgabe", body: "Dreißig Tage." }
      ]);

      const unsafeResponse = await fetch(httpUrl(realtime, "/presets-admin/parse"), {
        method: "POST",
        headers: { authorization: "Bearer admin-secret", "content-type": "application/json" },
        body: JSON.stringify({ snippet: '<div class="card"><script>alert(1)</script></div>' })
      });
      assert.equal(unsafeResponse.status, 400);
      assert.deepEqual(await unsafeResponse.json(), { error: "unsafe_snippet_element" });

      const unsafeAttributeResponse = await fetch(httpUrl(realtime, "/presets-admin/parse"), {
        method: "POST",
        headers: { authorization: "Bearer admin-secret", "content-type": "application/json" },
        body: JSON.stringify({ snippet: '<button class="btn" onclick="alert(1)">Weiter</button>' })
      });
      assert.equal(unsafeAttributeResponse.status, 400);
      assert.deepEqual(await unsafeAttributeResponse.json(), { error: "unsafe_snippet_attribute" });

      loaded.library.categories.push({ id: "portal", label: "Portal", description: "Kundenportal", sort: 20 });
      loaded.library.packages.push({ id: "portal.pro", label: "Portal Pro", category: "package", description: "Portalbausteine", buyerValue: "Kundenportal", upsell: true, sort: 90 });
      loaded.library.presets.push(parsed.preset);
      loaded.library.presets.push(imported.preset);

      const validateOnly = await fetch(httpUrl(realtime, "/presets-admin/catalog?validate=1"), {
        method: "POST",
        headers: { authorization: "Bearer admin-secret", "content-type": "application/json" },
        body: JSON.stringify({ library: loaded.library, validateOnly: true })
      });
      assert.equal(validateOnly.status, 200);
      assert.equal((await validateOnly.json()).ok, true);

      const saved = await fetch(httpUrl(realtime, "/presets-admin/catalog"), {
        method: "POST",
        headers: { authorization: "Bearer admin-secret", "content-type": "application/json" },
        body: JSON.stringify({ library: loaded.library, message: "Add portal footer preset" })
      });
      assert.equal(saved.status, 200);
      const savedPayload = await saved.json();
      assert.equal(savedPayload.ok, true);
      assert.equal(savedPayload.changed, true);
      assert.equal(savedPayload.commit, "def456");
      assert.equal(savedPayload.releaseId, "release-1");

      const persisted = fs.readFileSync(libraryPath, "utf8");
      assert.match(persisted, /custom_acme_footer/);
      assert.match(persisted, /custom_api_card/);
      assert.doesNotMatch(persisted, /preset\.example\.test/);
      assert.doesNotMatch(persisted, /<footer|<script/);

      const contractResponse = await fetch(httpUrl(realtime, "/contract"));
      assert.equal(contractResponse.status, 200);
      const contract = await contractResponse.json();
      assert.ok(contract.presetCategories.some(category => category.id === "portal"));
      assert.ok(contract.presetPackages.some(pack => pack.id === "portal.pro"));
      const preset = contract.presets.find(item => item.id === "custom_acme_footer");
      assert.equal(preset.builtIn, false);
      assert.equal(preset.categoryId, "portal");
      assert.equal(preset.components[0].variant, "footer");
      assert.equal(preset.components[0].dataPath, "states.custom_acme_footer");
      assert.ok(calls.some(args => args[0] === "add" && args.includes("server/preset-library.json") && args.includes("release-version.js")));
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
