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

function fakeTaskStore() {
  return {
    start() {},
    stop() {},
    list: async () => [],
    create: async value => value,
    run: async () => ({ status: "success" }),
    remove: async () => ({ ok: true })
  };
}

test("local recorder agent serves the real-browser controller", async t => {
  const runtime = createLocalRecorderServer({ host: "127.0.0.1", port: 0, taskStore: fakeTaskStore() });
  await listen(runtime.server);
  t.after(async () => { runtime.taskStore.stop(); await close(runtime.server); });

  const health = await request(runtime.server, "/healthz");
  assert.equal(health.response.statusCode, 200);
  assert.deepEqual(JSON.parse(health.body), { ok: true, service: "local-recorder-agent", recording: false });

  const page = await request(runtime.server, "/local-recorder.html");
  assert.equal(page.response.statusCode, 200);
  assert.match(page.body, /Echter Browser-Recorder/);
  assert.match(page.body, /wob-app15\.wobak\.de/);
  assert.match(page.body, /Browser öffnen \+ aufnehmen/);
  assert.match(page.body, /Website jetzt ganz normal bedienen/);
});

test("local recorder UI has no screenshot remote-control workflow", () => {
  const html = localRecorderHtml();
  assert.doesNotMatch(html, /class=\"viewport\"/);
  assert.doesNotMatch(html, /id=\"typeText\"/);
  assert.doesNotMatch(html, /Text senden/);
  assert.doesNotMatch(html, /\/recorder\/sessions/);
  assert.match(html, /Fertig → State-Chart/);
  assert.match(html, /Echten Replay starten/);
  assert.match(html, /Als Replay-Task speichern/);
  assert.match(html, /Im Editor öffnen/);
});
