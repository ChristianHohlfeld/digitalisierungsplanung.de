"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  createAliasLookup,
  createRecorderServer,
  createReplacingRecorderManager,
  envInteger,
  hostResolverRulesFromAliases,
  parseHostAliases
} = require("./recorder-run");

const APP_ORIGIN = "https://digitalisierungsplanung.de";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise(resolve => server.close(() => resolve()));
}

function request(server, options) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port: address.port,
      ...options
    }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve({ response, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("recorder API answers browser CORS preflight directly", async t => {
  const runtime = createRecorderServer({
    allowedOrigins: [APP_ORIGIN],
    manager: { close: async () => {} }
  });
  await listen(runtime.server);
  t.after(() => close(runtime.server));

  const { response, body } = await request(runtime.server, {
    method: "OPTIONS",
    path: "/recorder/sessions",
    headers: {
      origin: APP_ORIGIN,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type"
    }
  });

  assert.equal(response.statusCode, 204);
  assert.equal(body, "");
  assert.equal(response.headers["access-control-allow-origin"], APP_ORIGIN);
  assert.match(response.headers["access-control-allow-methods"], /POST/);
  assert.match(response.headers["access-control-allow-methods"], /OPTIONS/);
  assert.equal(response.headers["access-control-allow-headers"], "content-type");
  assert.equal(response.headers["access-control-max-age"], "600");
  assert.match(response.headers.vary, /Origin/i);
});

test("recorder API rejects untrusted CORS origins", async t => {
  const runtime = createRecorderServer({
    allowedOrigins: [APP_ORIGIN],
    manager: { close: async () => {} }
  });
  await listen(runtime.server);
  t.after(() => close(runtime.server));

  const { response, body } = await request(runtime.server, {
    method: "OPTIONS",
    path: "/recorder/sessions",
    headers: {
      origin: "https://evil.example",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type"
    }
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.headers["access-control-allow-origin"], undefined);
  assert.deepEqual(JSON.parse(body), { error: "origin_not_allowed" });
});

test("recorder maps approved intranet host aliases for Node DNS and Chromium", async () => {
  const aliases = parseHostAliases("aida.wobak.de=10.42.0.15 wob-app15.wobak.de:10.42.0.16");
  assert.deepEqual([...aliases], [
    ["aida.wobak.de", "10.42.0.15"],
    ["wob-app15.wobak.de", "10.42.0.16"]
  ]);
  assert.equal(
    hostResolverRulesFromAliases(aliases, "MAP extra.wobak.de 10.42.0.17"),
    "MAP aida.wobak.de 10.42.0.15,MAP wob-app15.wobak.de 10.42.0.16,MAP extra.wobak.de 10.42.0.17"
  );

  const fallbackCalls = [];
  const lookup = createAliasLookup(aliases, async (hostname, options) => {
    fallbackCalls.push([hostname, options]);
    return [{ address: "93.184.216.34", family: 4 }];
  });

  assert.deepEqual(await lookup("aida.wobak.de", { all: true }), [{ address: "10.42.0.15", family: 4 }]);
  assert.deepEqual(await lookup("example.com", { all: true }), [{ address: "93.184.216.34", family: 4 }]);
  assert.equal(fallbackCalls.length, 1);
});

test("recorder replaces stale client sessions instead of leaving the UI stuck", async () => {
  let factoryCalls = 0;
  let closeCalls = 0;
  const manager = createReplacingRecorderManager(() => {
    factoryCalls += 1;
    const instance = factoryCalls;
    return {
      async startSession(url, clientKey) {
        if (instance === 1) {
          const error = new Error("This client already has an active recorder session.");
          error.code = "recorder_client_capacity";
          throw error;
        }
        return { sessionId: `session-${instance}`, status: "recording", url, clientKey };
      },
      async close() { closeCalls += 1; }
    };
  }, { replaceOnClientCapacity: true });

  const state = await manager.startSession("https://example.com", "client-a");
  assert.equal(state.sessionId, "session-2");
  assert.equal(state.status, "recording");
  assert.equal(factoryCalls, 2);
  assert.equal(closeCalls, 1);
});

test("recorder env session limits stay bounded", () => {
  process.env.RECORDER_TEST_INT = "999";
  assert.equal(envInteger("RECORDER_TEST_INT", 1, 2, 8), 8);
  process.env.RECORDER_TEST_INT = "bad";
  assert.equal(envInteger("RECORDER_TEST_INT", 7, 2, 8), 7);
  delete process.env.RECORDER_TEST_INT;
});
