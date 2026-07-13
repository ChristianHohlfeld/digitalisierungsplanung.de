"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadReleaseInfo, parseReleaseSource } = require("./release");

const ROOT = path.resolve(__dirname, "..");

function resolveBash() {
  const candidates = [
    process.env.BASH,
    process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "",
    process.platform === "win32" && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe") : "",
    process.platform === "win32" ? "C:\\Program Files (x86)\\Git\\bin\\bash.exe" : "",
    "bash"
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (result.status === 0) return candidate;
  }
  return "bash";
}

const BASH = resolveBash();
const BASH_PATH_STYLE = (() => {
  if (process.platform !== "win32") return "posix";
  const probe = spawnSync(BASH, ["-lc", "pwd -W >/dev/null 2>&1 && printf git || printf wsl"], { encoding: "utf8" });
  return probe.stdout.trim() === "git" ? "git" : "wsl";
})();

function bashPath(value) {
  const normalized = path.resolve(value).replaceAll("\\", "/");
  if (process.platform !== "win32") return normalized;
  const match = normalized.match(/^([a-zA-Z]):\/(.*)$/);
  if (!match) return normalized;
  const drive = match[1].toLowerCase();
  const rest = match[2];
  return BASH_PATH_STYLE === "git" ? `/${drive}/${rest}` : `/mnt/${drive}/${rest}`;
}

test("parses the canonical release file and supports matching process metadata", () => {
  const parsed = parseReleaseSource(`
globalThis.ZUSTAND_RELEASE_SEQUENCE = 59;
globalThis.ZUSTAND_RELEASE_ID = "release-59";
globalThis.ZUSTAND_RELEASE_BUILT_AT = "2026-07-12T00:00:00Z";
globalThis.ZUSTAND_RELEASE_SOURCE = "1234567890abcdef";
`);
  assert.deepEqual(parsed, {
    id: "release-59",
    sequence: 59,
    builtAt: "2026-07-12T00:00:00Z",
    sourceCommit: "1234567890abcdef",
    deployedCommit: ""
  });
  assert.equal(parseReleaseSource('globalThis.ZUSTAND_RELEASE_ID = "release-58";').sequence, 58);
  assert.equal(parseReleaseSource('globalThis.ZUSTAND_RELEASE_ID = "deploy-58-1";').sequence, 0);

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

test("keeps automatic deployment locked, release-gated, force-synced, verified, and retry-only", () => {
  const autoDeploy = fs.readFileSync(path.join(__dirname, "auto-deploy.sh"), "utf8");
  const deploy = fs.readFileSync(path.join(__dirname, "deploy.sh"), "utf8");
  const ecosystem = fs.readFileSync(path.join(__dirname, "ecosystem.config.cjs"), "utf8");
  const runScript = fs.readFileSync(path.join(__dirname, "run.sh"), "utf8");
  const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "deploy.yml"), "utf8");
  const writer = fs.readFileSync(path.join(ROOT, "scripts", "write-release-version.mjs"), "utf8");
  for (const script of ["auto-deploy.sh", "deploy.sh", "run.sh"]) {
    const syntax = spawnSync(BASH, ["-n", bashPath(path.join(__dirname, script))], { encoding: "utf8" });
    assert.equal(syntax.status, 0, syntax.stderr || `${script} failed bash -n`);
  }

  assert.match(autoDeploy, /flock -n 9/);
  assert.match(autoDeploy, /fetch --prune --force origin/);
  assert.match(autoDeploy, /reset --hard/);
  assert.match(autoDeploy, /clean -ffdx/);
  assert.match(autoDeploy, /Waiting for the green CI release stamp/);
  assert.match(autoDeploy, /prepare_deploy_runner/);
  assert.match(autoDeploy, /bash "\$DEPLOY_RUNNER"/);
  assert.match(autoDeploy, /Marker remains on/);
  assert.doesNotMatch(autoDeploy, /running_release_id|commit_for_release|previous_release_commit/);
  assert.doesNotMatch(autoDeploy, /Rollback|rollback|failed\. Restoring/);
  assert.match(autoDeploy, /OnUnitInactiveSec=\$\{AUTO_DEPLOY_INTERVAL\}/);

  const deployGate = autoDeploy.indexOf('if deploy_checked_out_release "$target_release"; then');
  const markerWrite = autoDeploy.indexOf('write_marker "$target_release"', deployGate);
  assert.ok(deployGate >= 0 && markerWrite > deployGate, "the marker may advance only after verified deployment");

  assert.match(deploy, /pm2 startOrReload .* --update-env/);
  assert.match(deploy, /nginx -t/);
  assert.match(deploy, /releaseId !== expected/);
  assert.doesNotMatch(deploy, /legacyRollback|deploy-\d/);
  assert.doesNotMatch(autoDeploy, /legacyRollback|deploy-\d/);
  assert.match(ecosystem, /process\.env\.APP_DIR/);
  assert.match(ecosystem, /REALTIME_ENV_FILE: envFile/);
  assert.match(runScript, /REALTIME_ENV_FILE/);
  assert.match(workflow, /needs: contract-tests/);
  assert.match(workflow, /paths-ignore:\s*\n\s*- release-version\.js/);
  assert.match(workflow, /RELEASE_INCREMENT: "1"/);
  assert.doesNotMatch(workflow, /\[skip ci\]/);
  assert.match(writer, /previousSequence \+ 1/);
  assert.match(writer, /ZUSTAND_RELEASE_SEQUENCE/);
});
