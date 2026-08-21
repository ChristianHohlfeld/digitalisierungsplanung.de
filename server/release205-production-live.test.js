"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  waitForProductionRelease,
  verifyEditorSurface,
  verifyRecorderCors,
  verifyRecorderSession
} = require("./production-release-smoke");

const RELEASE_ID = "release-205";
const SOURCE_COMMIT = "519a11a5e8bfd8be0ae5e758beae0cf927b8c318";

test("release-205 is externally live including a real recorder session", { timeout: 180000 }, async () => {
  const state = await waitForProductionRelease(RELEASE_ID, SOURCE_COMMIT, 120000);
  assert.equal(state.frontend.id, RELEASE_ID);
  assert.equal(state.version.releaseId, RELEASE_ID);
  assert.equal(state.health.releaseId, RELEASE_ID);
  await verifyEditorSurface(RELEASE_ID);
  await verifyRecorderCors();
  const recorder = await verifyRecorderSession();
  assert.ok(recorder.sessionId);
});
