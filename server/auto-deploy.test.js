"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: "utf8"
  });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function git(cwd, ...args) {
  return run("git", args, { cwd }).stdout.trim();
}

function bashPath(value) {
  const normalized = path.resolve(value).replaceAll("\\", "/");
  if (process.platform !== "win32") return normalized;
  const match = normalized.match(/^([a-zA-Z]):\/(.*)$/);
  if (!match) return normalized;
  const drive = match[1].toLowerCase();
  const rest = match[2];
  return BASH_PATH_STYLE === "git" ? `/${drive}/${rest}` : `/mnt/${drive}/${rest}`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function writeExecutable(file, source) {
  fs.writeFileSync(file, source, { encoding: "utf8", mode: 0o755 });
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (_) {
    return "";
  }
}

function releaseSource(sequence) {
  return `globalThis.ZUSTAND_RELEASE_SEQUENCE = ${sequence};\n` +
    `globalThis.ZUSTAND_RELEASE_ID = "release-${sequence}";\n` +
    `globalThis.ZUSTAND_RELEASE_BUILT_AT = "2026-07-12T00:00:00Z";\n` +
    `globalThis.ZUSTAND_RELEASE_SOURCE = "${String(sequence).padStart(7, "0")}";\n`;
}

test("auto deploy advances only verified green releases and retries failed deploys without rollback", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zustand-auto-deploy-"));
  try {
    const sourceRepo = path.join(root, "source");
    const bareRepo = path.join(root, "remote.git");
    const appDir = path.join(root, "app");
    const stateDir = path.join(root, "state");
    const fakeBin = path.join(root, "bin");
    const healthFile = path.join(root, "health.json");
    const logFile = path.join(root, "fake.log");
    fs.mkdirSync(path.join(sourceRepo, "server"), { recursive: true });
    fs.mkdirSync(fakeBin, { recursive: true });

    const fakeDeploy = `#!/usr/bin/env bash
set -euo pipefail
release_id="$(sed -n 's/^globalThis\\.ZUSTAND_RELEASE_ID = "\\([a-zA-Z0-9._-]*\\)";$/\\1/p' "$APP_DIR/release-version.js")"
printf 'deploy %s app=%s fail=%s\n' "$release_id" "$APP_DIR" "\${FAKE_FAIL_RELEASE:-}" >> "$FAKE_LOG_FILE"
if [[ "\${FAKE_FAIL_RELEASE:-}" == "$release_id" ]]; then
  exit 1
fi
printf '{"ok":true,"releaseId":"%s"}\n' "$release_id" > "$FAKE_HEALTH_FILE"
`;
    fs.writeFileSync(path.join(sourceRepo, "release-version.js"), releaseSource(58));
    writeExecutable(path.join(sourceRepo, "server", "deploy.sh"), fakeDeploy);
    git(sourceRepo, "init", "--initial-branch=main");
    git(sourceRepo, "config", "user.name", "Deploy Test");
    git(sourceRepo, "config", "user.email", "deploy-test@example.invalid");
    git(sourceRepo, "add", ".");
    git(sourceRepo, "commit", "-m", "release 58");
    const release58 = git(sourceRepo, "rev-parse", "HEAD");

    fs.writeFileSync(path.join(sourceRepo, "release-version.js"), releaseSource(59));
    git(sourceRepo, "add", "release-version.js");
    git(sourceRepo, "commit", "-m", "release 59");
    const release59 = git(sourceRepo, "rev-parse", "HEAD");
    run("git", ["clone", "--bare", sourceRepo, bareRepo]);
    run("git", ["clone", bareRepo, appDir]);
    git(appDir, "checkout", "--detach", release58);

    writeExecutable(path.join(fakeBin, "id"), "#!/usr/bin/env bash\nprintf '0\\n'\n");
    writeExecutable(path.join(fakeBin, "flock"), "#!/usr/bin/env bash\nexit 0\n");
    writeExecutable(path.join(fakeBin, "nginx"), "#!/usr/bin/env bash\nprintf 'nginx %s\\n' \"$*\" >> \"$FAKE_LOG_FILE\"\nexit 0\n");
    writeExecutable(path.join(fakeBin, "systemctl"), "#!/usr/bin/env bash\nexit 0\n");
    writeExecutable(path.join(fakeBin, "pm2"), `#!/usr/bin/env bash
if [[ "\${1:-}" == "jlist" ]]; then
  printf 'pm2 jlist\n' >> "$FAKE_LOG_FILE"
  printf '[{"name":"digitalisierungsplanung-realtime","pm2_env":{"status":"online"}}]\n'
fi
exit 0
`);
    writeExecutable(path.join(fakeBin, "curl"), "#!/usr/bin/env bash\nprintf 'curl %s\\n' \"$*\" >> \"$FAKE_LOG_FILE\"\ncat \"$FAKE_HEALTH_FILE\"\n");
    writeExecutable(path.join(fakeBin, "node"), `#!/usr/bin/env bash
if [[ "\${1:-}" == "-e" ]]; then
  script_file="$(mktemp)"
  printf '%s' "$2" > "$script_file"
  printf 'node-e %q\n' "$2" >> "$FAKE_LOG_FILE"
  shift 2
  ${shellQuote(bashPath(process.execPath))} "$script_file" "$@"
  status=$?
  printf 'node-status %s\n' "$status" >> "$FAKE_LOG_FILE"
  rm -f "$script_file"
  exit "$status"
fi
exec ${shellQuote(bashPath(process.execPath))} "$@"
`);
    fs.writeFileSync(healthFile, '{"ok":true}\n');

    const script = bashPath(path.join(__dirname, "auto-deploy.sh"));
    const commonEnv = {
      ...process.env,
      APP_DIR: bashPath(appDir),
      BRANCH: "main",
      REPO_URL: bashPath(bareRepo),
      ENV_FILE: bashPath(path.join(root, "realtime.env")),
      STATE_DIR: bashPath(stateDir),
      LOCK_FILE: bashPath(path.join(root, "auto.lock")),
      MARKER_FILE: bashPath(path.join(stateDir, "deployed-release.env")),
      DEPLOY_RUNNER: bashPath(path.join(stateDir, "deploy-runner.sh")),
      UPDATE_ATTEMPTS: "1",
      UPDATE_RETRY_DELAY: "0",
      HEALTH_ATTEMPTS: "1",
      HEALTH_RETRY_DELAY: "0",
      FAKE_HEALTH_FILE: bashPath(healthFile),
      FAKE_LOG_FILE: bashPath(logFile)
    };
    const command = `export PATH=${shellQuote(bashPath(fakeBin))}:"$PATH"; bash ${shellQuote(script)} --once`;
    const first = run(BASH, ["-c", command], { env: commonEnv, allowFailure: true });
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}\n${readIfExists(logFile)}`);
    assert.match(first.stdout, /Deployment complete: release-59/);
    assert.equal(git(appDir, "rev-parse", "HEAD"), release59);
    assert.match(fs.readFileSync(path.join(stateDir, "deployed-release.env"), "utf8"), /RELEASE_ID=release-59/);
    assert.equal(JSON.parse(fs.readFileSync(healthFile, "utf8")).releaseId, "release-59");

    git(sourceRepo, "remote", "add", "origin", bareRepo);
    fs.writeFileSync(path.join(sourceRepo, "release-version.js"), releaseSource(60));
    git(sourceRepo, "add", "release-version.js");
    git(sourceRepo, "commit", "-m", "release 60");
    git(sourceRepo, "push", "origin", "main");

    const failed = run(BASH, ["-c", command], {
      env: { ...commonEnv, FAKE_FAIL_RELEASE: "release-60" },
      allowFailure: true
    });
    assert.equal(failed.status, 1, `${failed.stdout}\n${failed.stderr}`);
    assert.match(failed.stdout, /Deployment of release-60 failed\. Marker remains on release-59/);
    assert.doesNotMatch(failed.stdout, /Rollback|Restoring/);
    assert.equal(git(appDir, "rev-parse", "HEAD"), git(sourceRepo, "rev-parse", "HEAD"));
    assert.match(fs.readFileSync(path.join(stateDir, "deployed-release.env"), "utf8"), /RELEASE_ID=release-59/);
    assert.equal(JSON.parse(fs.readFileSync(healthFile, "utf8")).releaseId, "release-59");

    const retried = run(BASH, ["-c", command], { env: commonEnv, allowFailure: true });
    assert.equal(retried.status, 0, `${retried.stdout}\n${retried.stderr}\n${readIfExists(logFile)}`);
    assert.match(retried.stdout, /Deployment complete: release-60/);
    assert.match(fs.readFileSync(path.join(stateDir, "deployed-release.env"), "utf8"), /RELEASE_ID=release-60/);
    assert.equal(JSON.parse(fs.readFileSync(healthFile, "utf8")).releaseId, "release-60");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
