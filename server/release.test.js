"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadReleaseInfo, parseReleaseSource } = require("./release");

const ROOT = path.resolve(__dirname, "..");

test("parses the canonical release file and supports matching process metadata", () => {
  const parsed = parseReleaseSource(`
self.ZUSTAND_RELEASE_SEQUENCE = 59;
self.ZUSTAND_SW_VERSION = "release-59";
self.ZUSTAND_SW_BUILT_AT = "2026-07-12T00:00:00Z";
self.ZUSTAND_RELEASE_SOURCE = "1234567890abcdef";
`);
  assert.deepEqual(parsed, {
    id: "release-59",
    sequence: 59,
    builtAt: "2026-07-12T00:00:00Z",
    sourceCommit: "1234567890abcdef",
    deployedCommit: ""
  });
  assert.equal(parseReleaseSource('self.ZUSTAND_SW_VERSION = "deploy-58-1";').sequence, 58);

  const fromEnvironment = loadReleaseInfo({
    path: path.join(ROOT, "missing-release.js"),
    env: {
      ZUSTAND_RELEASE_ID: "release-59",
      ZUSTAND_RELEASE_SEQUENCE: "59",
      ZUSTAND_RELEASE_BUILT_AT: "2026-07-12T00:00:00Z",
      ZUSTAND_RELEASE_SOURCE: "1234567890abcdef",
      ZUSTAND_DEPLOY_COMMIT: "abcdef1234567890"
    }
  });
  assert.deepEqual(fromEnvironment, {
    id: "release-59",
    sequence: 59,
    builtAt: "2026-07-12T00:00:00Z",
    sourceCommit: "1234567890abcdef",
    deployedCommit: "abcdef1234567890"
  });
});

test("keeps automatic deployment locked, release-gated, force-synced, verified, and rollback-safe", () => {
  const autoDeploy = fs.readFileSync(path.join(__dirname, "auto-deploy.sh"), "utf8");
  const deploy = fs.readFileSync(path.join(__dirname, "deploy.sh"), "utf8");
  const ecosystem = fs.readFileSync(path.join(__dirname, "ecosystem.config.cjs"), "utf8");
  const runScript = fs.readFileSync(path.join(__dirname, "run.sh"), "utf8");
  const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "deploy.yml"), "utf8");
  const writer = fs.readFileSync(path.join(ROOT, "scripts", "write-sw-version.mjs"), "utf8");
  const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";

  for (const script of ["auto-deploy.sh", "deploy.sh", "run.sh"]) {
    const syntax = spawnSync(bash, ["-n", path.join(__dirname, script)], { encoding: "utf8" });
    assert.equal(syntax.status, 0, syntax.stderr || `${script} failed bash -n`);
  }

  assert.match(autoDeploy, /flock -n 9/);
  assert.match(autoDeploy, /fetch --prune --force origin/);
  assert.match(autoDeploy, /reset --hard/);
  assert.match(autoDeploy, /clean -ffdx/);
  assert.match(autoDeploy, /Waiting for the green CI release stamp/);
  assert.match(autoDeploy, /running_release_id/);
  assert.match(autoDeploy, /commit_for_release/);
  assert.match(autoDeploy, /previous_release_commit/);
  assert.match(autoDeploy, /prepare_deploy_runner/);
  assert.match(autoDeploy, /bash "\$DEPLOY_RUNNER"/);
  assert.match(autoDeploy, /Deployment of .* failed\. Restoring/);
  assert.match(autoDeploy, /Rollback is healthy/);
  assert.match(autoDeploy, /OnUnitInactiveSec=\$\{AUTO_DEPLOY_INTERVAL\}/);

  const deployGate = autoDeploy.indexOf('if deploy_checked_out_release "$target_release"; then');
  const markerWrite = autoDeploy.indexOf('write_marker "$target_release"', deployGate);
  assert.ok(deployGate >= 0 && markerWrite > deployGate, "the marker may advance only after verified deployment");

  assert.match(deploy, /pm2 startOrReload .* --update-env/);
  assert.match(deploy, /nginx -t/);
  assert.match(deploy, /serviceWorkerId !== expected/);
  assert.match(deploy, /legacyRollback/);
  assert.match(ecosystem, /process\.env\.APP_DIR/);
  assert.match(ecosystem, /REALTIME_ENV_FILE: envFile/);
  assert.match(runScript, /REALTIME_ENV_FILE/);
  assert.match(workflow, /needs: contract-tests/);
  assert.match(workflow, /paths-ignore:\s*\n\s*- sw-version\.js/);
  assert.match(workflow, /SW_INCREMENT: "1"/);
  assert.doesNotMatch(workflow, /\[skip ci\]/);
  assert.match(writer, /previousSequence \+ 1/);
  assert.match(writer, /ZUSTAND_RELEASE_SEQUENCE/);
});
