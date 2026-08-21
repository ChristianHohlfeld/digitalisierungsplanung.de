"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseReleaseScript, validateReleaseState } = require("./production-release-smoke");

test("production release smoke parses the canonical release stamp", () => {
  const parsed = parseReleaseScript(`
    globalThis.ZUSTAND_RELEASE_SEQUENCE = 204;
    globalThis.ZUSTAND_RELEASE_ID = "release-204";
    globalThis.ZUSTAND_RELEASE_BUILT_AT = "2026-08-21T20:00:00Z";
    globalThis.ZUSTAND_RELEASE_SOURCE = "abc123";
  `);
  assert.deepEqual(parsed, {
    id: "release-204",
    sequence: 204,
    builtAt: "2026-08-21T20:00:00Z",
    sourceCommit: "abc123"
  });
});

test("production release smoke requires frontend, version and health to converge", () => {
  const input = {
    expectedReleaseId: "release-204",
    expectedSourceCommit: "abc123",
    frontend: { id: "release-204", sourceCommit: "abc123" },
    version: { releaseId: "release-204", sourceCommit: "abc123" },
    health: { ok: true, releaseId: "release-204" }
  };
  assert.equal(validateReleaseState(input), true);
  assert.throws(
    () => validateReleaseState({ ...input, version: { releaseId: "release-203", sourceCommit: "old" } }),
    /Release not converged/
  );
  assert.throws(
    () => validateReleaseState({ ...input, health: { ok: false, releaseId: "release-204" } }),
    /health\.ok=false/
  );
});

test("production release smoke rejects incomplete release stamps", () => {
  assert.throws(() => parseReleaseScript('globalThis.ZUSTAND_RELEASE_ID = "release-204";'), /Invalid release-version/);
});
