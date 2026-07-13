"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const nginxDir = path.join(__dirname, "nginx");

function config(name) {
  return fs.readFileSync(path.join(nginxDir, name), "utf8");
}

test("static hosting sends every public app response through a no-store boundary", () => {
  for (const name of ["digitalisierungsplanung.de.conf", "digitalisierungsplanung.de.bootstrap.conf"]) {
    const source = config(name);
    assert.match(source, /server_name digitalisierungsplanung\.de;/);
    assert.match(source, /add_header Cache-Control "no-store, max-age=0" always;/);
    assert.match(source, /etag off;/);
    assert.match(source, /if_modified_since off;/);
    for (const publicPath of ["/index.html", "/state.html", "/manifest.webmanifest", "/disable-sw.js", "/release-version.js", "/sw.js"]) {
      assert.match(source, new RegExp(`location = ${publicPath.replace(/[.]/g, "\\.")} \\{`));
    }
    assert.match(source, /location \^~ \/assets\//);
    assert.match(source, /location \/ \{\s*return 404;/s);
  }
});

test("retired service worker tombstone is no-store and grants no worker scope", () => {
  const source = config("digitalisierungsplanung.de.conf");
  const block = source.match(/location = \/sw\.js \{([\s\S]*?)\n    \}/)?.[1] || "";
  assert.match(block, /Cache-Control "no-store, max-age=0" always/);
  assert.doesNotMatch(block, /Service-Worker-Allowed/);
});
