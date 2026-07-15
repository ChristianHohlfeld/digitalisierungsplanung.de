"use strict";

const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createRealtimeServer } = require("./server");
const { PilotStore } = require("./pilot-store");

const ORIGIN = "https://digitalisierungsplanung.de";
const BOOTSTRAP_TOKEN = randomBytes(48).toString("base64url");
const BACKUP_SIGNING_KEY = randomBytes(48).toString("base64url");
const ROOM_SECRET = randomBytes(48).toString("base64url");
const OWNER_PASSWORD = `T3st-${randomBytes(32).toString("base64url")}`;

function stateModel(data = {}) {
  return {
    version: 2,
    initial: "start",
    states: [{ id: "start", title: "Start", data }],
    transitions: []
  };
}

function url(server, route) {
  return `http://127.0.0.1:${server.address().port}${route}`;
}

async function request(server, route, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.origin !== false) headers.origin = options.origin || ORIGIN;
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  let body;
  if (options.body !== undefined) {
    headers["content-type"] = options.contentType || "application/json";
    body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }
  return fetch(url(server, route), {
    method: options.method || "GET",
    headers,
    body
  });
}

async function json(response) {
  return response.json();
}

async function start(dataDir, options = {}) {
  const realtime = createRealtimeServer({
    host: "127.0.0.1",
    port: 0,
    roomSecret: ROOM_SECRET,
    allowedOrigins: [ORIGIN],
    heartbeatMs: 1000,
    pilotDataDir: dataDir,
    pilotBackupDir: `${dataDir}-backups`,
    pilotBackupSigningKey: BACKUP_SIGNING_KEY,
    pilotBootstrapToken: BOOTSTRAP_TOKEN,
    ...options
  });
  await realtime.listen(0, "127.0.0.1");
  return realtime;
}

async function bootstrap(server, overrides = {}) {
  const response = await request(server, "/api/v1/bootstrap", {
    method: "POST",
    token: BOOTSTRAP_TOKEN,
    body: {
      organizationName: "Pilot GmbH",
      email: "owner@pilot.example",
      name: "Pilot Owner",
      password: OWNER_PASSWORD,
      ...overrides
    }
  });
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  return json(response);
}

async function login(server, email = "owner@pilot.example", password = OWNER_PASSWORD) {
  const response = await request(server, "/api/v1/auth/login", {
    method: "POST",
    body: { email, password }
  });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  return json(response);
}

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "digital-pilot-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  t.after(() => fs.rmSync(`${directory}-backups`, { recursive: true, force: true }));
  return directory;
}

test("bootstraps securely, persists users and stores only password/token hashes", async t => {
  const dataDir = temporaryDirectory(t);
  let server = await start(dataDir);
  t.after(async () => server.close());

  const readyBefore = await request(server, "/readyz", { origin: false });
  assert.equal(readyBefore.status, 200);
  assert.deepEqual(await json(readyBefore), {
    ok: true,
    service: "managed-pilot",
    schemaVersion: 1,
    storage: "ready",
    databaseRevision: 0,
    bootstrapped: false,
    bootstrapConfigured: true,
    backupProtected: false,
    backupIntegrityProtected: true,
    backupStorageExternal: false,
    backupExternalRequired: false
  });

  const rejected = await request(server, "/api/v1/bootstrap", {
    method: "POST",
    token: "wrong-token",
    body: { organizationName: "Wrong", email: "wrong@example.com", name: "Wrong", password: OWNER_PASSWORD }
  });
  assert.equal(rejected.status, 401);
  assert.equal((await json(rejected)).error, "unauthorized");

  const created = await bootstrap(server);
  assert.equal(created.user.role, "owner");
  assert.equal(created.user.organizationId, created.organization.id);
  assert.equal(created.user.password, undefined);

  const duplicate = await request(server, "/api/v1/bootstrap", {
    method: "POST",
    token: BOOTSTRAP_TOKEN,
    body: { organizationName: "Again", email: "again@example.com", name: "Again", password: OWNER_PASSWORD }
  });
  assert.equal(duplicate.status, 409);
  assert.equal((await json(duplicate)).error, "already_bootstrapped");

  const authenticated = await login(server);
  assert.match(authenticated.token, /^ps_[A-Za-z0-9_-]{43}$/);
  const me = await request(server, "/api/v1/auth/me", { token: authenticated.token });
  assert.equal(me.status, 200);
  assert.equal((await json(me)).user.email, "owner@pilot.example");

  const databasePath = path.join(dataDir, "pilot.json");
  const stored = fs.readFileSync(databasePath, "utf8");
  assert.equal(stored.includes(OWNER_PASSWORD), false);
  assert.ok(!stored.includes(authenticated.token));
  const database = JSON.parse(stored);
  assert.equal(database.users[0].password.algorithm, "scrypt");
  assert.equal(database.sessions[0].tokenHash.length, 43);
  if (process.platform !== "win32") assert.equal(fs.statSync(databasePath).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(dataDir).filter(name => name.endsWith(".tmp")), []);

  await server.close();
  server = await start(dataDir);
  const persistedLogin = await login(server);
  assert.equal(persistedLogin.user.id, created.user.id);

  const passwordChange = await request(server, "/api/v1/auth/password", {
    method: "POST",
    token: persistedLogin.token,
    body: { currentPassword: OWNER_PASSWORD, newPassword: "a replacement password with 20 chars" }
  });
  assert.equal(passwordChange.status, 200);
  assert.equal((await request(server, "/api/v1/auth/me", { token: persistedLogin.token })).status, 200);
  const oldPassword = await request(server, "/api/v1/auth/login", {
    method: "POST",
    body: { email: "owner@pilot.example", password: OWNER_PASSWORD }
  });
  assert.equal(oldPassword.status, 401);
  const replacementLogin = await login(server, "owner@pilot.example", "a replacement password with 20 chars");
  assert.equal(replacementLogin.user.id, created.user.id);

  const logout = await request(server, "/api/v1/auth/logout", { method: "POST", token: persistedLogin.token });
  assert.equal(logout.status, 200);
  const afterLogout = await request(server, "/api/v1/auth/me", { token: persistedLogin.token });
  assert.equal(afterLogout.status, 401);
});

test("provisions isolated organizations and enforces owner/editor/viewer roles", async t => {
  const dataDir = temporaryDirectory(t);
  const server = await start(dataDir);
  t.after(() => server.close());
  await bootstrap(server);
  const ownerA = await login(server);

  const provision = await request(server, "/api/v1/organizations/provision", {
    method: "POST",
    token: BOOTSTRAP_TOKEN,
    body: {
      organizationName: "Other AG",
      email: "owner@other.example",
      name: "Other Owner",
      password: OWNER_PASSWORD
    }
  });
  assert.equal(provision.status, 201);
  const organizationB = await json(provision);
  assert.notEqual(organizationB.organization.id, ownerA.organization.id);
  const ownerB = await login(server, "owner@other.example");

  const editorResponse = await request(server, "/api/v1/users", {
    method: "POST",
    token: ownerA.token,
    body: { email: "editor@pilot.example", name: "Editor", role: "editor", password: OWNER_PASSWORD }
  });
  assert.equal(editorResponse.status, 201);
  const viewerResponse = await request(server, "/api/v1/users", {
    method: "POST",
    token: ownerA.token,
    body: { email: "viewer@pilot.example", name: "Viewer", role: "viewer", password: OWNER_PASSWORD }
  });
  assert.equal(viewerResponse.status, 201);
  const editor = await login(server, "editor@pilot.example");
  const viewer = await login(server, "viewer@pilot.example");

  const projectResponse = await request(server, "/api/v1/projects", {
    method: "POST",
    token: editor.token,
    body: { name: "Process A", description: "Tenant A only", model: stateModel({ tenant: "a" }) }
  });
  assert.equal(projectResponse.status, 201);
  const project = await json(projectResponse);

  const anonymousRead = await request(server, `/api/v1/projects/${project.id}`);
  assert.equal(anonymousRead.status, 401);
  assert.equal((await json(anonymousRead)).error, "unauthorized");

  const foreignRead = await request(server, `/api/v1/projects/${project.id}`, { token: ownerB.token });
  assert.equal(foreignRead.status, 404);
  assert.equal((await json(foreignRead)).error, "project_not_found");
  const foreignList = await request(server, "/api/v1/projects", { token: ownerB.token });
  assert.deepEqual((await json(foreignList)).projects, []);

  const viewerRead = await request(server, `/api/v1/projects/${project.id}`, { token: viewer.token });
  assert.equal(viewerRead.status, 200);
  const viewerWrite = await request(server, `/api/v1/projects/${project.id}`, {
    method: "PATCH",
    token: viewer.token,
    body: { name: "Forbidden" }
  });
  assert.equal(viewerWrite.status, 403);
  const viewerBackup = await request(server, "/api/v1/backups", { method: "POST", token: viewer.token });
  assert.equal(viewerBackup.status, 403);
  const viewerAudit = await request(server, "/api/v1/audit", { token: viewer.token });
  assert.equal(viewerAudit.status, 403);
  const editorManageUsers = await request(server, "/api/v1/users", { token: editor.token });
  assert.equal(editorManageUsers.status, 403);

  const ownerUsers = await request(server, "/api/v1/users", { token: ownerA.token });
  assert.deepEqual((await json(ownerUsers)).users.map(user => user.role).sort(), ["editor", "owner", "viewer"]);
  const otherUsers = await request(server, "/api/v1/users", { token: ownerB.token });
  assert.deepEqual((await json(otherUsers)).users.map(user => user.email), ["owner@other.example"]);

  const database = JSON.parse(fs.readFileSync(path.join(dataDir, "pilot.json"), "utf8"));
  for (const organizationId of [ownerA.organization.id, organizationB.organization.id]) {
    let previousHash = null;
    for (const entry of database.audit.filter(item => item.organizationId === organizationId)) {
      assert.equal(entry.previousHash, previousHash);
      previousHash = entry.hash;
    }
  }
});

test("creates immutable versions, detects conflicts, restores by copying, exports and deletes", async t => {
  const dataDir = temporaryDirectory(t);
  const server = await start(dataDir);
  t.after(() => server.close());
  await bootstrap(server);
  const owner = await login(server);

  const createResponse = await request(server, "/api/v1/projects", {
    method: "POST",
    token: owner.token,
    body: { name: "Versioned", model: stateModel({ value: 1 }), message: "v1" }
  });
  const project = await json(createResponse);
  const versionOne = project.currentVersion;
  assert.equal(versionOne.number, 1);
  assert.deepEqual(versionOne.model.states[0].components, []);

  const secondResponse = await request(server, `/api/v1/projects/${project.id}/versions`, {
    method: "POST",
    token: owner.token,
    body: { model: stateModel({ value: 2 }), message: "v2", expectedCurrentVersionId: versionOne.id }
  });
  assert.equal(secondResponse.status, 201);
  const versionTwo = await json(secondResponse);
  assert.equal(versionTwo.number, 2);
  assert.equal(versionTwo.sourceVersionId, versionOne.id);

  const conflict = await request(server, `/api/v1/projects/${project.id}/versions`, {
    method: "POST",
    token: owner.token,
    body: { model: stateModel({ value: 99 }), expectedCurrentVersionId: versionOne.id }
  });
  assert.equal(conflict.status, 409);
  const conflictPayload = await json(conflict);
  assert.equal(conflictPayload.error, "version_conflict");
  assert.equal(conflictPayload.details.currentVersionId, versionTwo.id);

  const restoreResponse = await request(server, `/api/v1/projects/${project.id}/restore`, {
    method: "POST",
    token: owner.token,
    body: { versionId: versionOne.id, expectedCurrentVersionId: versionTwo.id, message: "Back to v1" }
  });
  assert.equal(restoreResponse.status, 201);
  const restored = await json(restoreResponse);
  assert.equal(restored.number, 3);
  assert.equal(restored.sourceVersionId, versionOne.id);
  assert.equal(restored.model.states[0].data.value, 1);
  assert.notEqual(restored.id, versionOne.id);

  const originalResponse = await request(server, `/api/v1/projects/${project.id}/versions/${versionOne.id}`, { token: owner.token });
  assert.equal((await json(originalResponse)).model.states[0].data.value, 1);
  const listResponse = await request(server, `/api/v1/projects/${project.id}/versions`, { token: owner.token });
  assert.deepEqual((await json(listResponse)).versions.map(version => version.number), [3, 2, 1]);

  const exportResponse = await request(server, `/api/v1/projects/${project.id}/export`, { token: owner.token });
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get("content-disposition"), /attachment/);
  const exported = await json(exportResponse);
  assert.equal(exported.schema, "digitalisierungsplanung.project-export.v1");
  assert.deepEqual(exported.versions.map(version => version.number), [1, 2, 3]);
  assert.equal(exported.versions[0].model.states[0].data.value, 1);

  const concurrent = await Promise.all(Array.from({ length: 5 }, (_, index) => request(server, `/api/v1/projects/${project.id}/versions`, {
    method: "POST",
    token: owner.token,
    body: { model: stateModel({ value: index + 10 }), message: `parallel-${index}` }
  }).then(async response => ({ status: response.status, payload: await json(response) }))));
  assert.ok(concurrent.every(result => result.status === 201));
  assert.deepEqual(concurrent.map(result => result.payload.number).sort((a, b) => a - b), [4, 5, 6, 7, 8]);

  const deleted = await request(server, `/api/v1/projects/${project.id}`, { method: "DELETE", token: owner.token });
  assert.equal(deleted.status, 200);
  assert.equal((await request(server, `/api/v1/projects/${project.id}`, { token: owner.token })).status, 404);
  assert.deepEqual((await json(await request(server, "/api/v1/projects", { token: owner.token }))).projects, []);
});

test("protects the last owner and creates tenant-scoped backups with chained audit entries", async t => {
  const dataDir = temporaryDirectory(t);
  const server = await start(dataDir);
  t.after(() => server.close());
  const bootstrapped = await bootstrap(server);
  const owner = await login(server);

  const lastOwner = await request(server, `/api/v1/users/${bootstrapped.user.id}`, {
    method: "PATCH",
    token: owner.token,
    body: { role: "editor" }
  });
  assert.equal(lastOwner.status, 409);
  assert.equal((await json(lastOwner)).error, "last_owner_required");

  const projectResponse = await request(server, "/api/v1/projects", {
    method: "POST",
    token: owner.token,
    body: { name: "Backup project", model: stateModel({ state: "safe" }) }
  });
  assert.equal(projectResponse.status, 201);
  const project = await json(projectResponse);
  const backupResponse = await request(server, "/api/v1/backups", { method: "POST", token: owner.token });
  assert.equal(backupResponse.status, 201);
  const backup = await json(backupResponse);
  assert.match(backup.id, /^backup_[0-9]+_[a-f0-9]+$/);
  assert.equal(backup.digest.length, 64);
  assert.equal(backup.signed, true);

  const listedResponse = await request(server, "/api/v1/backups", { token: owner.token });
  const listed = await json(listedResponse);
  assert.equal(listed.backups.length, 1);
  assert.equal(listed.backups[0].id, backup.id);
  assert.equal(listed.backups[0].digest, backup.digest);
  assert.equal(listed.backups[0].signed, true);

  const backupPath = path.join(`${dataDir}-backups`, bootstrapped.organization.id, `${backup.id}.json`);
  const storedBackup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  const storedManifest = JSON.parse(fs.readFileSync(backupPath.replace(/\.json$/, ".manifest.json"), "utf8"));
  assert.equal(storedManifest.digest, backup.digest);
  assert.equal(storedManifest.signature.length, 64);
  assert.equal(storedBackup.organization.id, bootstrapped.organization.id);
  assert.equal(storedBackup.projects.length, 1);
  assert.equal(storedBackup.versions.length, 1);
  assert.equal(storedBackup.sessions, undefined);
  assert.equal(storedBackup.users[0].password.algorithm, "scrypt");

  const auditResponse = await request(server, "/api/v1/audit?limit=2", { token: owner.token });
  const firstPage = await json(auditResponse);
  assert.equal(firstPage.entries.length, 2);
  const nextResponse = await request(server, `/api/v1/audit?limit=200&after=${firstPage.nextAfter}`, { token: owner.token });
  const nextPage = await json(nextResponse);
  assert.ok(nextPage.entries.some(entry => entry.action === "backup.create"));
  const fullDatabase = JSON.parse(fs.readFileSync(path.join(dataDir, "pilot.json"), "utf8"));
  const audit = fullDatabase.audit.filter(entry => entry.organizationId === bootstrapped.organization.id);
  assert.equal(audit[0].previousHash, null);
  for (let index = 1; index < audit.length; index += 1) assert.equal(audit[index].previousHash, audit[index - 1].hash);

  const changedVersionResponse = await request(server, `/api/v1/projects/${project.id}/versions`, {
    method: "POST",
    token: owner.token,
    body: {
      model: stateModel({ state: "changed-after-backup" }),
      expectedCurrentVersionId: project.currentVersion.id,
      message: "after backup"
    }
  });
  assert.equal(changedVersionResponse.status, 201);
  const ready = await json(await request(server, "/readyz", { origin: false }));
  const dryRun = await request(server, `/api/v1/backups/${backup.id}/restore`, {
    method: "POST",
    token: owner.token,
    body: { confirmation: `RESTORE ${backup.id}`, expectedDatabaseRevision: ready.databaseRevision, dryRun: true }
  });
  assert.equal(dryRun.status, 200);
  assert.equal((await json(dryRun)).dryRun, true);
  const restoredResponse = await request(server, `/api/v1/backups/${backup.id}/restore`, {
    method: "POST",
    token: owner.token,
    body: { confirmation: `RESTORE ${backup.id}`, expectedDatabaseRevision: ready.databaseRevision }
  });
  assert.equal(restoredResponse.status, 200);
  assert.equal((await json(restoredResponse)).requiresLogin, true);
  assert.equal((await request(server, "/api/v1/auth/me", { token: owner.token })).status, 401);
  const restoredOwner = await login(server);
  const restoredProject = await json(await request(server, `/api/v1/projects/${project.id}`, { token: restoredOwner.token }));
  assert.equal(restoredProject.currentVersion.model.states[0].data.state, "safe");
});

test("enforces CORS, strict JSON limits, model complexity and per-IP login rate limits", async t => {
  const dataDir = temporaryDirectory(t);
  const server = await start(dataDir, {
    pilotMaxJsonBytes: 1024,
    pilotLoginRateLimitMax: 3,
    pilotRateLimitMax: 50
  });
  t.after(() => server.close());
  await bootstrap(server);
  const owner = await login(server);

  const cors = await request(server, "/api/v1/health", { origin: "https://evil.example" });
  assert.equal(cors.status, 403);
  assert.equal((await json(cors)).error, "origin_not_allowed");

  const preflight = await request(server, "/api/v1/projects", {
    method: "OPTIONS",
    headers: {
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization, content-type"
    }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), ORIGIN);

  const wrongType = await request(server, "/api/v1/projects", {
    method: "POST",
    token: owner.token,
    contentType: "text/plain",
    body: JSON.stringify({ name: "No", model: {} })
  });
  assert.equal(wrongType.status, 415);
  assert.equal((await json(wrongType)).error, "application_json_required");

  const unknownField = await request(server, "/api/v1/projects", {
    method: "POST",
    token: owner.token,
    body: { name: "No", model: {}, tenantOverride: "other" }
  });
  assert.equal(unknownField.status, 400);
  assert.equal((await json(unknownField)).error, "unexpected_fields");

  const oversized = await request(server, "/api/v1/projects", {
    method: "POST",
    token: owner.token,
    body: { name: "Large", model: { data: "x".repeat(2000) } }
  });
  assert.equal(oversized.status, 413);
  assert.equal((await json(oversized)).error, "payload_too_large");

  const invalidContract = await request(server, "/api/v1/projects", {
    method: "POST",
    token: owner.token,
    body: {
      name: "Invalid contract",
      model: {
        version: 2,
        initial: "duplicate",
        states: [{ id: "duplicate" }, { id: "duplicate" }],
        transitions: [{ id: "broken", from: "duplicate", to: "missing", triggerType: "button", event: "click", set: {} }]
      }
    }
  });
  assert.equal(invalidContract.status, 422);
  const invalidContractPayload = await json(invalidContract);
  assert.equal(invalidContractPayload.error, "invalid_model_contract");
  assert.deepEqual(invalidContractPayload.details.issues, [
    { code: "duplicate_state_id", path: "states.duplicate" },
    { code: "missing_transition_endpoint", path: "transitions.broken" }
  ]);
  assert.equal(invalidContractPayload.details.truncated, false);

  const reservedRuntimeId = await request(server, "/api/v1/projects", {
    method: "POST",
    token: owner.token,
    body: {
      name: "Reserved runtime ID",
      model: {
        version: 2,
        name: "Reserved",
        initial: "__runtime_state",
        states: [{ id: "__runtime_state", title: "Reserved", components: [], data: {}, x: 96, y: 120 }],
        transitions: []
      }
    }
  });
  assert.equal(reservedRuntimeId.status, 422);
  assert.equal((await json(reservedRuntimeId)).details.issues[0].code, "reserved_state_id");

  let deep = {};
  for (let index = 0; index < 70; index += 1) deep = { child: deep };
  const tooDeep = await request(server, "/api/v1/projects", {
    method: "POST",
    token: owner.token,
    body: { name: "Deep", model: deep }
  });
  assert.equal(tooDeep.status, 422);
  assert.equal((await json(tooDeep)).error, "model_too_complex");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const wrongLogin = await request(server, "/api/v1/auth/login", {
      method: "POST",
      body: { email: "owner@pilot.example", password: "wrong password value" }
    });
    assert.equal(wrongLogin.status, 401);
    assert.equal((await json(wrongLogin)).error, "invalid_credentials");
  }
  const limited = await request(server, "/api/v1/auth/login", {
    method: "POST",
    body: { email: "owner@pilot.example", password: "wrong password value" }
  });
  assert.equal(limited.status, 429);
  assert.equal((await json(limited)).error, "rate_limited");
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);
});

test("does not let attacker-controlled forwarded chains rotate login rate-limit identities", async t => {
  const dataDir = temporaryDirectory(t);
  const server = await start(dataDir, {
    pilotLoginRateLimitMax: 2,
    pilotRateLimitMax: 50
  });
  t.after(() => server.close());
  await bootstrap(server);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request(server, "/api/v1/auth/login", {
      method: "POST",
      headers: {
        "x-real-ip": "203.0.113.20",
        "x-forwarded-for": `198.51.100.${attempt + 1}, 203.0.113.20`
      },
      body: { email: "owner@pilot.example", password: "wrong password value" }
    });
    assert.equal(response.status, 401);
    assert.equal((await json(response)).error, "invalid_credentials");
  }

  const limited = await request(server, "/api/v1/auth/login", {
    method: "POST",
    headers: {
      "x-real-ip": "203.0.113.20",
      "x-forwarded-for": "198.51.100.200, 203.0.113.20"
    },
    body: { email: "owner@pilot.example", password: "wrong password value" }
  });
  assert.equal(limited.status, 429);
  assert.equal((await json(limited)).error, "rate_limited");
});

test("reports not-ready when an empty deployment has no provisioning secret", async t => {
  const dataDir = temporaryDirectory(t);
  const server = await start(dataDir, { pilotBootstrapToken: "" });
  t.after(() => server.close());
  const ready = await request(server, "/readyz", { origin: false });
  assert.equal(ready.status, 503);
  assert.deepEqual(await json(ready), {
    ok: false,
    service: "managed-pilot",
    schemaVersion: 1,
    storage: "ready",
    databaseRevision: 0,
    bootstrapped: false,
    bootstrapConfigured: false,
    backupProtected: false,
    backupIntegrityProtected: true,
    backupStorageExternal: false,
    backupExternalRequired: false
  });
});

test("production storage readiness rejects a backup directory on the data filesystem", async t => {
  const dataDir = temporaryDirectory(t);
  const backupDir = `${dataDir}-backups`;
  fs.mkdirSync(backupDir, { recursive: true });
  const store = new PilotStore({
    dataDir,
    backupDir,
    backupSigningKey: BACKUP_SIGNING_KEY,
    requireExternalBackup: true
  });
  await assert.rejects(() => store.ready(), error => error.code === "backup_volume_not_external");
  assert.equal(store.backupStorageSeparated, true);
  assert.equal(store.backupStorageDeviceSeparated, false);
});

test("production nginx exposes readiness and the versioned pilot API with bounded bodies", () => {
  const nginx = fs.readFileSync(path.join(__dirname, "nginx", "realtime.digitalisierungsplanung.de.conf"), "utf8");
  assert.match(nginx, /location = \/readyz/);
  assert.match(nginx, /location = \/pilot-admin\.html/);
  assert.match(nginx, /location = \/studio\.html/);
  assert.match(nginx, /location = \/api\/v1/);
  assert.match(nginx, /location \^~ \/api\/v1\//);
  assert.match(nginx, /client_max_body_size 8m/);
  const forwardedHeaders = [...nginx.matchAll(/proxy_set_header\s+X-Forwarded-For\s+([^;]+);/g)];
  assert.ok(forwardedHeaders.length > 0);
  assert.ok(forwardedHeaders.every(match => match[1].trim() === "$remote_addr"));
  assert.doesNotMatch(nginx, /\$proxy_add_x_forwarded_for/);
});

test("serves the internal pilot console and same-origin managed studio contract", async t => {
  const dataDir = temporaryDirectory(t);
  const server = await start(dataDir);
  t.after(() => server.close());

  const consoleResponse = await request(server, "/pilot-admin.html");
  assert.equal(consoleResponse.status, 200);
  assert.match(consoleResponse.headers.get("content-type"), /text\/html/);
  assert.match(consoleResponse.headers.get("content-security-policy"), /connect-src 'self'/);
  const html = await consoleResponse.text();
  assert.match(html, /Zustand Pilot-Konsole/);
  assert.match(html, /zustand\.pilot\.session\.v1/);
  assert.match(html, /sessionStorage\.setItem\(SESSION_KEY, JSON\.stringify\(session\)\)/);
  assert.match(html, /\/auth\/login/);
  assert.match(html, /\/auth\/logout/);
  assert.match(html, /\/projects\/\$\{encodeURIComponent\(project\.id\)\}\/versions/);
  assert.match(html, /\/backups/);
  assert.match(html, /\/studio\.html\?project=\$\{encodeURIComponent\(project\.id\)\}&api=\/api\/v1/);
  assert.match(html, /if \(session\.user\.role !== "viewer"\)/);
  assert.doesNotMatch(html, /studio\.html[^\n]*(?:token|authorization)=/i);
  assert.match(html, /Export JSON/);
  assert.doesNotMatch(html, /localStorage|PILOT_BOOTSTRAP_TOKEN/);
  assert.equal(html.includes(OWNER_PASSWORD), false);

  const studioResponse = await request(server, "/studio.html");
  assert.equal(studioResponse.status, 200);
  assert.match(studioResponse.headers.get("content-security-policy"), /frame-src blob:/);
  assert.match(await studioResponse.text(), /<title>Zustand<\/title>/);
});

test("coordinates atomic writes across store instances without losing tenant data", async t => {
  const dataDir = temporaryDirectory(t);
  const first = new PilotStore({ dataDir });
  const bootstrapped = await first.bootstrap({
    organizationName: "Concurrent GmbH",
    email: "owner@concurrent.example",
    name: "Owner",
    password: OWNER_PASSWORD
  });
  const second = new PilotStore({ dataDir });
  await second.ready();
  await Promise.all(Array.from({ length: 6 }, (_, index) => (index % 2 ? first : second).createUser(
    bootstrapped.organization.id,
    bootstrapped.user.id,
    {
      email: `user-${index}@concurrent.example`,
      name: `User ${index}`,
      role: index % 3 === 0 ? "editor" : "viewer",
      password: OWNER_PASSWORD
    }
  )));
  const usersFromFirst = await first.listUsers(bootstrapped.organization.id);
  const usersFromSecond = await second.listUsers(bootstrapped.organization.id);
  assert.equal(usersFromFirst.length, 7);
  assert.deepEqual(usersFromSecond.map(user => user.id).sort(), usersFromFirst.map(user => user.id).sort());
  const database = JSON.parse(fs.readFileSync(path.join(dataDir, "pilot.json"), "utf8"));
  assert.equal(database.revision, 7);
  assert.equal(fs.existsSync(path.join(dataDir, ".write-lock")), false);
});

test("rejects a tampered audit chain instead of serving altered history", async t => {
  const dataDir = temporaryDirectory(t);
  const store = new PilotStore({ dataDir });
  await store.bootstrap({
    organizationName: "Audit GmbH",
    email: "owner@audit.example",
    name: "Audit Owner",
    password: OWNER_PASSWORD
  });
  const databasePath = path.join(dataDir, "pilot.json");
  const database = JSON.parse(fs.readFileSync(databasePath, "utf8"));
  database.audit[0].action = "organization.tampered";
  fs.writeFileSync(databasePath, JSON.stringify(database));
  const reopened = new PilotStore({ dataDir });
  await assert.rejects(() => reopened.ready(), error => error.code === "invalid_audit_chain");
});

test("rejects tampered version data and signed backup artifacts", async t => {
  const dataDir = temporaryDirectory(t);
  const server = await start(dataDir);
  t.after(() => server.close());
  const bootstrapped = await bootstrap(server);
  const owner = await login(server);
  const project = await json(await request(server, "/api/v1/projects", {
    method: "POST",
    token: owner.token,
    body: { name: "Integrity", model: stateModel({ value: "original" }) }
  }));
  const backup = await json(await request(server, "/api/v1/backups", { method: "POST", token: owner.token }));
  const backupPath = path.join(`${dataDir}-backups`, bootstrapped.organization.id, `${backup.id}.json`);
  const backupPayload = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  backupPayload.versions[0].model.states[0].data.value = "tampered";
  fs.writeFileSync(backupPath, `${JSON.stringify(backupPayload)}\n`);
  const listed = await request(server, "/api/v1/backups", { token: owner.token });
  assert.equal(listed.status, 422);
  assert.equal((await json(listed)).error, "invalid_backup_integrity");

  await server.close();
  const databasePath = path.join(dataDir, "pilot.json");
  const database = JSON.parse(fs.readFileSync(databasePath, "utf8"));
  const version = database.versions.find(item => item.id === project.currentVersion.id);
  version.model.states[0].data.value = "tampered";
  fs.writeFileSync(databasePath, JSON.stringify(database));
  const reopened = new PilotStore({ dataDir });
  await assert.rejects(() => reopened.ready(), error => error.code === "invalid_version_digest");
});

test("enforces bounded project, version and tenant storage quotas", async t => {
  const dataDir = temporaryDirectory(t);
  const server = await start(dataDir, {
    pilotMaxProjectsPerOrganization: 1,
    pilotMaxVersionsPerProject: 2,
    pilotMaxTenantBytes: 32 * 1024
  });
  t.after(() => server.close());
  await bootstrap(server);
  const owner = await login(server);
  const first = await json(await request(server, "/api/v1/projects", {
    method: "POST",
    token: owner.token,
    body: { name: "First", model: stateModel({ value: 1 }) }
  }));
  const secondProject = await request(server, "/api/v1/projects", {
    method: "POST",
    token: owner.token,
    body: { name: "Second", model: stateModel({ value: 2 }) }
  });
  assert.equal(secondProject.status, 409);
  assert.equal((await json(secondProject)).error, "project_quota_exceeded");
  const secondVersion = await request(server, `/api/v1/projects/${first.id}/versions`, {
    method: "POST",
    token: owner.token,
    body: { model: stateModel({ value: 2 }), expectedCurrentVersionId: first.currentVersion.id }
  });
  assert.equal(secondVersion.status, 201);
  const thirdVersion = await request(server, `/api/v1/projects/${first.id}/versions`, {
    method: "POST",
    token: owner.token,
    body: { model: stateModel({ value: 3 }) }
  });
  assert.equal(thirdVersion.status, 409);
  assert.equal((await json(thirdVersion)).error, "version_quota_exceeded");

  const tenantDir = temporaryDirectory(t);
  const quotaStore = new PilotStore({ dataDir: tenantDir, maxTenantBytes: 8 * 1024 });
  const tenant = await quotaStore.bootstrap({
    organizationName: "Quota GmbH",
    email: "owner@quota.example",
    name: "Quota Owner",
    password: OWNER_PASSWORD
  });
  await assert.rejects(() => quotaStore.createProject(tenant.organization.id, tenant.user.id, {
    name: "Oversized",
    description: "",
    model: stateModel({ payload: "x".repeat(20 * 1024) }),
    message: "quota"
  }), error => error.code === "tenant_storage_quota_exceeded");

  const auditDir = temporaryDirectory(t);
  const auditStore = new PilotStore({ dataDir: auditDir, maxTenantBytes: 8 * 1024 });
  const auditTenant = await auditStore.bootstrap({
    organizationName: "Audit Quota GmbH",
    email: "owner@audit-quota.example",
    name: "Audit Quota Owner",
    password: OWNER_PASSWORD
  });
  let quotaError = null;
  for (let index = 0; index < 300 && !quotaError; index += 1) {
    try {
      await auditStore.updateOrganization(auditTenant.organization.id, auditTenant.user.id, { name: "Audit Quota GmbH" });
    } catch (error) {
      quotaError = error;
    }
  }
  assert.equal(quotaError?.code, "tenant_storage_quota_exceeded");
  const persistedAuditDatabase = JSON.parse(fs.readFileSync(path.join(auditDir, "pilot.json"), "utf8"));
  assert.ok(persistedAuditDatabase.audit.length < 300);
});

test("tenant restore rejects user identities and emails claimed by another organization", async t => {
  const dataDir = temporaryDirectory(t);
  const store = new PilotStore({
    dataDir,
    backupDir: `${dataDir}-backups`,
    backupSigningKey: BACKUP_SIGNING_KEY
  });
  const tenantA = await store.bootstrap({
    organizationName: "Tenant A",
    email: "owner-a@restore.example",
    name: "Owner A",
    password: OWNER_PASSWORD
  });
  const tenantB = await store.provisionOrganization({
    organizationName: "Tenant B",
    email: "owner-b@restore.example",
    name: "Owner B",
    password: OWNER_PASSWORD
  });
  const oldBackup = await store.createOrganizationBackup(tenantA.organization.id, tenantA.user.id);
  await store.createUser(tenantA.organization.id, tenantA.user.id, {
    email: "shared@restore.example",
    name: "Shared A",
    role: "editor",
    password: OWNER_PASSWORD
  });
  const conflictingBackup = await store.createOrganizationBackup(tenantA.organization.id, tenantA.user.id);
  let revision = (await store.ready()).revision;
  await store.restoreOrganizationBackup(tenantA.organization.id, tenantA.user.id, oldBackup.id, {
    expectedDatabaseRevision: revision
  });
  await store.createUser(tenantB.organization.id, tenantB.user.id, {
    email: "shared@restore.example",
    name: "Shared B",
    role: "editor",
    password: OWNER_PASSWORD
  });
  revision = (await store.ready()).revision;
  await assert.rejects(() => store.restoreOrganizationBackup(tenantA.organization.id, tenantA.user.id, conflictingBackup.id, {
    expectedDatabaseRevision: revision,
    dryRun: true
  }), error => error.code === "backup_identity_conflict" && error.status === 409 && error.details?.kind === "email");
  await assert.rejects(() => store.restoreOrganizationBackup(tenantA.organization.id, tenantA.user.id, conflictingBackup.id, {
    expectedDatabaseRevision: revision
  }), error => error.code === "backup_identity_conflict" && error.status === 409 && error.details?.kind === "email");
});
