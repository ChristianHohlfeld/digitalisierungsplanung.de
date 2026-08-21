"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createLocalRecorderServer, localRecorderHtml } = require("./local-recorder-agent");

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

function request(server, path) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: address.port, path }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve({ response, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("local recorder agent serves an intranet-first recorder shell", async t => {
  const runtime = createLocalRecorderServer({
    host: "127.0.0.1",
    port: 0,
    manager: { close: async () => {} },
    publicBaseUrl: "http://127.0.0.1:8799"
  });
  await listen(runtime.server);
  t.after(() => close(runtime.server));

  const health = await request(runtime.server, "/healthz");
  assert.equal(health.response.statusCode, 200);
  assert.equal(JSON.parse(health.body).service, "local-recorder-agent");

  const page = await request(runtime.server, "/local-recorder.html");
  assert.equal(page.response.statusCode, 200);
  assert.match(page.body, /Lokaler Recorder/);
  assert.match(page.body, /wob-app15\.wobak\.de/);
});

test("local recorder UI records like a browser window instead of a manual text sender", () => {
  const html = localRecorderHtml();
  assert.match(html, /addEventListener\("keydown"/);
  assert.match(html, /addEventListener\("paste"/);
  assert.match(html, /addEventListener\("wheel"/);
  assert.match(html, /queueText\(e\.key\)/);
  assert.match(html, /Mausrad/);
  assert.doesNotMatch(html, /id=\"typeText\"/);
  assert.doesNotMatch(html, /Text senden/);
});
