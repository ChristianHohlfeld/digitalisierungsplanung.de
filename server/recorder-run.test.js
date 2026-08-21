"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createRecorderServer } = require("./recorder-run");

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
