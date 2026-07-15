"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);
const SCHEMA_VERSION = 1;
const ROLES = new Set(["owner", "editor", "viewer"]);
const SESSION_PREFIX = "ps_";
const PASSWORD_KEY_BYTES = 64;
const DEFAULT_MAX_PROJECTS_PER_ORGANIZATION = 100;
const DEFAULT_MAX_VERSIONS_PER_PROJECT = 200;
const DEFAULT_MAX_TENANT_BYTES = 100 * 1024 * 1024;
const DUMMY_PASSWORD = Object.freeze({
  algorithm: "scrypt",
  salt: "AAAAAAAAAAAAAAAAAAAAAA",
  hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  keyBytes: PASSWORD_KEY_BYTES
});

class PilotError extends Error {
  constructor(code, status = 400, details = undefined) {
    super(code);
    this.name = "PilotError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("base64url");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function newDatabase() {
  const timestamp = nowIso();
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    organizations: [],
    users: [],
    sessions: [],
    projects: [],
    versions: [],
    audit: [],
    nextAuditSequence: 1
  };
}

function validateDatabase(db) {
  if (!db || typeof db !== "object" || Array.isArray(db)) throw new PilotError("invalid_database", 500);
  if (db.schemaVersion !== SCHEMA_VERSION) throw new PilotError("unsupported_database_schema", 500);
  for (const key of ["organizations", "users", "sessions", "projects", "versions", "audit"]) {
    if (!Array.isArray(db[key])) throw new PilotError("invalid_database", 500, { field: key });
  }
  if (!Number.isSafeInteger(db.revision) || db.revision < 0) throw new PilotError("invalid_database", 500);
  if (!Number.isSafeInteger(db.nextAuditSequence) || db.nextAuditSequence < 1) throw new PilotError("invalid_database", 500);
  const organizationIds = new Set();
  for (const organization of db.organizations) {
    if (!organization?.id || organizationIds.has(organization.id)) throw new PilotError("invalid_database_organization", 500);
    organizationIds.add(organization.id);
  }
  const previousHashByOrganization = new Map();
  let previousSequence = 0;
  for (const entry of db.audit) {
    const previousHash = previousHashByOrganization.get(entry?.organizationId) || null;
    if (!entry || !organizationIds.has(entry.organizationId) || !Number.isSafeInteger(entry.sequence) || entry.sequence <= previousSequence || entry.previousHash !== previousHash) {
      throw new PilotError("invalid_audit_chain", 500);
    }
    const { hash, ...base } = entry;
    const expected = crypto.createHash("sha256").update(canonicalJson(base)).digest("hex");
    if (!safeEqual(hash, expected)) throw new PilotError("invalid_audit_chain", 500);
    previousHashByOrganization.set(entry.organizationId, hash);
    previousSequence = entry.sequence;
  }
  if (db.nextAuditSequence <= previousSequence) throw new PilotError("invalid_audit_sequence", 500);
  const userIds = new Set();
  const userEmails = new Set();
  for (const user of db.users) {
    const email = normalizeEmail(user?.email);
    if (!organizationIds.has(user?.organizationId) || !user?.id || userIds.has(user.id) || !email || email !== user.email || userEmails.has(email) ||
        !ROLES.has(user.role) || user.password?.algorithm !== "scrypt") {
      throw new PilotError("invalid_database_user", 500);
    }
    userIds.add(user.id);
    userEmails.add(email);
  }
  const sessionIds = new Set();
  const sessionTokenHashes = new Set();
  for (const session of db.sessions) {
    if (!session?.id || sessionIds.has(session.id) || !userIds.has(session.userId) || !session.tokenHash || sessionTokenHashes.has(session.tokenHash) ||
        !Number.isFinite(Date.parse(session.createdAt)) || !Number.isFinite(Date.parse(session.expiresAt))) {
      throw new PilotError("invalid_database_session", 500);
    }
    sessionIds.add(session.id);
    sessionTokenHashes.add(session.tokenHash);
  }
  const projectIds = new Set();
  const versionIds = new Set();
  const versionNumbersByProject = new Map();
  for (const version of db.versions) {
    if (!organizationIds.has(version.organizationId) || versionIds.has(version.id)) throw new PilotError("invalid_database_version", 500);
    const expectedDigest = crypto.createHash("sha256").update(canonicalJson(version.model)).digest("hex");
    if (!safeEqual(version.digest, expectedDigest)) throw new PilotError("invalid_version_digest", 500, { versionId: version.id });
    const numbers = versionNumbersByProject.get(version.projectId) || new Set();
    if (!Number.isSafeInteger(version.number) || version.number < 1 || numbers.has(version.number)) throw new PilotError("invalid_version_number", 500);
    numbers.add(version.number);
    versionNumbersByProject.set(version.projectId, numbers);
    versionIds.add(version.id);
  }
  for (const project of db.projects) {
    if (!organizationIds.has(project.organizationId) || projectIds.has(project.id)) throw new PilotError("invalid_database_project", 500);
    const current = db.versions.find(version => version.id === project.currentVersionId);
    if (!current || current.projectId !== project.id || current.organizationId !== project.organizationId) {
      throw new PilotError("invalid_project_current_version", 500, { projectId: project.id });
    }
    if (db.versions.some(version => version.projectId === project.id && version.organizationId !== project.organizationId)) {
      throw new PilotError("invalid_cross_tenant_version", 500, { projectId: project.id });
    }
    projectIds.add(project.id);
  }
  for (const version of db.versions) if (!projectIds.has(version.projectId)) throw new PilotError("orphan_version", 500, { versionId: version.id });
  return db;
}

function publicOrganization(org) {
  return cloneJson({
    id: org.id,
    name: org.name,
    createdAt: org.createdAt,
    updatedAt: org.updatedAt
  });
}

function publicUser(user) {
  return cloneJson({
    id: user.id,
    organizationId: user.organizationId,
    email: user.email,
    name: user.name,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt || null
  });
}

function publicProject(project, currentVersion = null) {
  return cloneJson({
    id: project.id,
    organizationId: project.organizationId,
    name: project.name,
    description: project.description,
    currentVersionId: project.currentVersionId,
    currentVersionNumber: currentVersion?.number || null,
    createdBy: project.createdBy,
    updatedBy: project.updatedBy,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    deletedAt: project.deletedAt || null
  });
}

function publicVersion(version, includeModel = false) {
  const output = {
    id: version.id,
    organizationId: version.organizationId,
    projectId: version.projectId,
    number: version.number,
    message: version.message,
    sourceVersionId: version.sourceVersionId || null,
    createdBy: version.createdBy,
    createdAt: version.createdAt,
    digest: version.digest
  };
  if (includeModel) output.model = cloneJson(version.model);
  return output;
}

function tenantStorageValue(db, organization) {
  const users = db.users.filter(user => user.organizationId === organization.id);
  const userIds = new Set(users.map(user => user.id));
  const projects = db.projects.filter(project => project.organizationId === organization.id);
  const projectIds = new Set(projects.map(project => project.id));
  return {
    organization,
    users,
    sessions: db.sessions.filter(session => userIds.has(session.userId)),
    projects,
    versions: db.versions.filter(version => version.organizationId === organization.id && projectIds.has(version.projectId)),
    audit: db.audit.filter(entry => entry.organizationId === organization.id)
  };
}

function assertRestoreIdentitiesAvailable(db, organizationId, payload) {
  const otherUsers = db.users.filter(user => user.organizationId !== organizationId);
  const otherUserIds = new Set(otherUsers.map(user => user.id));
  const otherEmails = new Set(otherUsers.map(user => normalizeEmail(user.email)));
  const otherProjectIds = new Set(db.projects.filter(project => project.organizationId !== organizationId).map(project => project.id));
  const otherVersionIds = new Set(db.versions.filter(version => version.organizationId !== organizationId).map(version => version.id));
  const conflictingUser = payload.users.find(user => otherUserIds.has(user.id) || otherEmails.has(normalizeEmail(user.email)));
  if (conflictingUser) {
    throw new PilotError("backup_identity_conflict", 409, {
      kind: otherUserIds.has(conflictingUser.id) ? "user_id" : "email",
      value: otherUserIds.has(conflictingUser.id) ? conflictingUser.id : normalizeEmail(conflictingUser.email)
    });
  }
  const conflictingProject = payload.projects.find(project => otherProjectIds.has(project.id));
  if (conflictingProject) throw new PilotError("backup_identity_conflict", 409, { kind: "project_id", value: conflictingProject.id });
  const conflictingVersion = payload.versions.find(version => otherVersionIds.has(version.id));
  if (conflictingVersion) throw new PilotError("backup_identity_conflict", 409, { kind: "version_id", value: conflictingVersion.id });
}

async function passwordRecord(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(String(password), salt, PASSWORD_KEY_BYTES);
  return {
    algorithm: "scrypt",
    salt: salt.toString("base64url"),
    hash: Buffer.from(derived).toString("base64url"),
    keyBytes: PASSWORD_KEY_BYTES
  };
}

async function passwordMatches(password, record) {
  const candidate = record && record.algorithm === "scrypt" ? record : DUMMY_PASSWORD;
  let derived;
  try {
    derived = await scrypt(String(password), Buffer.from(candidate.salt, "base64url"), candidate.keyBytes || PASSWORD_KEY_BYTES);
  } catch (_) {
    derived = Buffer.alloc(PASSWORD_KEY_BYTES);
  }
  return safeEqual(Buffer.from(derived).toString("base64url"), candidate.hash);
}

function appendAudit(db, entry) {
  const sequence = db.nextAuditSequence++;
  const previous = [...db.audit].reverse().find(item => item.organizationId === entry.organizationId);
  const previousHash = previous?.hash || null;
  const base = {
    sequence,
    id: id("audit"),
    at: nowIso(),
    organizationId: entry.organizationId,
    actorUserId: entry.actorUserId || null,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    metadata: cloneJson(entry.metadata || {}),
    previousHash
  };
  const hash = crypto.createHash("sha256").update(canonicalJson(base)).digest("hex");
  const audit = { ...base, hash };
  db.audit.push(audit);
  return audit;
}

function validateOrganizationBackupPayload(payload, organizationId) {
  if (!payload || payload.schema !== "digitalisierungsplanung.organization-backup.v1" || payload.organization?.id !== organizationId) {
    throw new PilotError("invalid_backup_payload", 422);
  }
  for (const key of ["users", "projects", "versions", "audit"]) {
    if (!Array.isArray(payload[key])) throw new PilotError("invalid_backup_payload", 422, { field: key });
  }
  if (!payload.users.some(user => user.organizationId === organizationId && user.active && user.role === "owner")) {
    throw new PilotError("invalid_backup_owner", 422);
  }
  if (payload.users.some(user => user.organizationId !== organizationId) ||
      payload.projects.some(project => project.organizationId !== organizationId) ||
      payload.versions.some(version => version.organizationId !== organizationId)) {
    throw new PilotError("cross_tenant_backup_payload", 422);
  }
  const userIds = new Set();
  const userEmails = new Set();
  for (const user of payload.users) {
    const email = normalizeEmail(user?.email);
    if (!user.id || userIds.has(user.id) || !email || email !== user.email || userEmails.has(email) ||
        !ROLES.has(user.role) || user.password?.algorithm !== "scrypt") {
      throw new PilotError("invalid_backup_user", 422);
    }
    userIds.add(user.id);
    userEmails.add(email);
  }
  const projectById = new Map();
  for (const project of payload.projects) {
    if (!project.id || projectById.has(project.id)) throw new PilotError("invalid_backup_project", 422);
    projectById.set(project.id, project);
  }
  const versionById = new Map();
  const versionNumbers = new Map();
  for (const version of payload.versions) {
    if (!projectById.has(version.projectId) || versionById.has(version.id)) throw new PilotError("invalid_backup_version", 422);
    const expected = crypto.createHash("sha256").update(canonicalJson(version.model)).digest("hex");
    if (!safeEqual(version.digest, expected)) throw new PilotError("invalid_backup_version_digest", 422, { versionId: version.id });
    const numbers = versionNumbers.get(version.projectId) || new Set();
    if (!Number.isSafeInteger(version.number) || numbers.has(version.number)) throw new PilotError("invalid_backup_version_number", 422);
    numbers.add(version.number);
    versionNumbers.set(version.projectId, numbers);
    versionById.set(version.id, version);
  }
  for (const project of payload.projects) {
    const current = versionById.get(project.currentVersionId);
    if (!current || current.projectId !== project.id) throw new PilotError("invalid_backup_current_version", 422, { projectId: project.id });
  }
  let previousHash = null;
  let previousSequence = 0;
  for (const entry of payload.audit) {
    if (entry.organizationId !== organizationId || entry.previousHash !== previousHash || !Number.isSafeInteger(entry.sequence) || entry.sequence <= previousSequence) {
      throw new PilotError("invalid_backup_audit_chain", 422);
    }
    const { hash, ...base } = entry;
    const expected = crypto.createHash("sha256").update(canonicalJson(base)).digest("hex");
    if (!safeEqual(hash, expected)) throw new PilotError("invalid_backup_audit_chain", 422);
    previousHash = hash;
    previousSequence = entry.sequence;
  }
  return payload;
}

class PilotStore {
  constructor(options = {}) {
    this.dataDir = path.resolve(options.dataDir || path.join(process.cwd(), ".pilot-data"));
    this.databasePath = path.join(this.dataDir, "pilot.json");
    this.backupDir = path.resolve(options.backupDir || path.join(this.dataDir, "backups"));
    this.backupSigningKey = String(options.backupSigningKey || "");
    this.backupSigningConfigured = Buffer.byteLength(this.backupSigningKey) >= 32;
    this.backupStorageSeparated = !this.backupDir.startsWith(`${this.dataDir}${path.sep}`) && this.backupDir !== this.dataDir;
    this.requireExternalBackup = options.requireExternalBackup === true;
    this.backupStorageDeviceSeparated = false;
    this.writeLockPath = path.join(this.dataDir, ".write-lock");
    this.sessionTtlMs = Number(options.sessionTtlMs) || 12 * 60 * 60 * 1000;
    this.maxProjectsPerOrganization = Number(options.maxProjectsPerOrganization) || DEFAULT_MAX_PROJECTS_PER_ORGANIZATION;
    this.maxVersionsPerProject = Number(options.maxVersionsPerProject) || DEFAULT_MAX_VERSIONS_PER_PROJECT;
    this.maxTenantBytes = Number(options.maxTenantBytes) || DEFAULT_MAX_TENANT_BYTES;
    this._database = null;
    this._initializing = null;
    this._queue = Promise.resolve();
  }

  async ready() {
    await this._initialize();
    await this._reloadFromDisk();
    await fs.promises.access(this.dataDir, fs.constants.R_OK | fs.constants.W_OK);
    await this._assertBackupStorageReady();
    return {
      ok: true,
      schemaVersion: SCHEMA_VERSION,
      revision: this._database.revision,
      dataDir: this.dataDir,
      backupStorageDeviceSeparated: this.backupStorageDeviceSeparated
    };
  }

  async _assertBackupStorageReady() {
    let dataStat;
    let backupStat;
    try {
      [dataStat, backupStat] = await Promise.all([
        fs.promises.stat(this.dataDir),
        fs.promises.stat(this.backupDir)
      ]);
      await fs.promises.access(this.backupDir, fs.constants.R_OK | fs.constants.W_OK);
    } catch (error) {
      if (this.requireExternalBackup && error?.code === "ENOENT") throw new PilotError("backup_volume_not_mounted", 503);
      throw error;
    }
    this.backupStorageDeviceSeparated = dataStat.dev !== backupStat.dev;
    if (this.requireExternalBackup && !this.backupStorageDeviceSeparated) {
      throw new PilotError("backup_volume_not_external", 503);
    }
    return this.backupStorageDeviceSeparated;
  }

  async _initialize() {
    if (this._database) return;
    if (this._initializing) return this._initializing;
    this._initializing = (async () => {
      await fs.promises.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
      const stat = await fs.promises.lstat(this.dataDir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new PilotError("unsafe_data_directory", 500);
      await fs.promises.chmod(this.dataDir, 0o700).catch(() => {});
      if (!this.requireExternalBackup) {
        await fs.promises.mkdir(this.backupDir, { recursive: true, mode: 0o700 });
      }
      if (this.requireExternalBackup && !await fs.promises.lstat(this.backupDir).catch(() => null)) {
        throw new PilotError("backup_volume_not_mounted", 503);
      }
      const backupStat = await fs.promises.lstat(this.backupDir);
      if (!backupStat.isDirectory() || backupStat.isSymbolicLink()) throw new PilotError("unsafe_backup_directory", 500);
      await fs.promises.chmod(this.backupDir, 0o700).catch(() => {});
      try {
        const contents = await fs.promises.readFile(this.databasePath, "utf8");
        this._database = validateDatabase(JSON.parse(contents));
      } catch (error) {
        if (error.code !== "ENOENT") {
          if (error instanceof SyntaxError) throw new PilotError("invalid_database_json", 500);
          throw error;
        }
        const db = newDatabase();
        await this._atomicWriteJson(this.databasePath, db);
        this._database = db;
      }
    })();
    try {
      await this._initializing;
    } finally {
      this._initializing = null;
    }
  }

  async _atomicWriteJson(targetPath, value) {
    const resolved = path.resolve(targetPath);
    const dataRoot = `${this.dataDir}${path.sep}`;
    const backupRoot = `${this.backupDir}${path.sep}`;
    if (resolved !== this.databasePath && !resolved.startsWith(dataRoot) && !resolved.startsWith(backupRoot)) {
      throw new PilotError("unsafe_storage_path", 500);
    }
    await fs.promises.mkdir(path.dirname(resolved), { recursive: true, mode: 0o700 });
    const temporary = path.join(path.dirname(resolved), `.${path.basename(resolved)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`);
    const contents = `${JSON.stringify(value)}\n`;
    let handle;
    try {
      handle = await fs.promises.open(temporary, "wx", 0o600);
      await handle.writeFile(contents, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.promises.rename(temporary, resolved);
      await fs.promises.chmod(resolved, 0o600).catch(() => {});
      let directory;
      try {
        directory = await fs.promises.open(path.dirname(resolved), "r");
        await directory.sync();
      } catch (_) {
        // Directory fsync is not available on every supported platform.
      } finally {
        await directory?.close().catch(() => {});
      }
    } finally {
      await handle?.close().catch(() => {});
      await fs.promises.unlink(temporary).catch(() => {});
    }
    return Buffer.byteLength(contents);
  }

  async _reloadFromDisk() {
    const contents = await fs.promises.readFile(this.databasePath, "utf8");
    const database = validateDatabase(JSON.parse(contents));
    if (this._database && database.revision < this._database.revision) {
      throw new PilotError("storage_revision_regressed", 503);
    }
    this._database = database;
    return database;
  }

  async _acquireWriteLock(timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      try {
        await fs.promises.mkdir(this.writeLockPath, { mode: 0o700 });
        await fs.promises.writeFile(path.join(this.writeLockPath, "owner.json"), JSON.stringify({
          pid: process.pid,
          createdAt: nowIso()
        }), { mode: 0o600 });
        return async () => fs.promises.rm(this.writeLockPath, { recursive: true, force: true });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        let removeStale = false;
        try {
          const owner = JSON.parse(await fs.promises.readFile(path.join(this.writeLockPath, "owner.json"), "utf8"));
          if (Number.isSafeInteger(owner.pid) && owner.pid > 0) {
            try {
              process.kill(owner.pid, 0);
            } catch (signalError) {
              if (signalError.code === "ESRCH") removeStale = true;
            }
          }
        } catch (_) {
          const stat = await fs.promises.stat(this.writeLockPath).catch(() => null);
          removeStale = Boolean(stat && Date.now() - stat.mtimeMs > 120000);
        }
        if (removeStale) {
          await fs.promises.rm(this.writeLockPath, { recursive: true, force: true });
          continue;
        }
        if (Date.now() >= deadline) throw new PilotError("storage_busy", 503);
        await new Promise(resolve => setTimeout(resolve, 20 + Math.floor(Math.random() * 30)));
      }
    }
  }

  _serialized(operation) {
    const run = this._queue.then(async () => {
      await this._initialize();
      return operation();
    });
    this._queue = run.catch(() => {});
    return run;
  }

  async _read(operation) {
    await this._initialize();
    await this._queue;
    await this._reloadFromDisk();
    return operation(this._database);
  }

  async _mutate(operation) {
    return this._serialized(async () => {
      const releaseLock = await this._acquireWriteLock();
      try {
        await this._reloadFromDisk();
        const next = cloneJson(this._database);
        const result = await operation(next);
        this._assertTenantStorageQuotas(next);
        next.revision += 1;
        next.updatedAt = nowIso();
        validateDatabase(next);
        await this._atomicWriteJson(this.databasePath, next);
        this._database = next;
        return cloneJson(result);
      } finally {
        await releaseLock();
      }
    });
  }

  _assertTenantStorageQuotas(db) {
    for (const organization of db.organizations) {
      if (Buffer.byteLength(canonicalJson(tenantStorageValue(db, organization))) > this.maxTenantBytes) {
        throw new PilotError("tenant_storage_quota_exceeded", 413, { limit: this.maxTenantBytes });
      }
    }
  }

  async hasUsers() {
    return this._read(db => db.users.length > 0);
  }

  async listOrganizations() {
    return this._read(db => db.organizations.map(publicOrganization));
  }

  async bootstrap({ organizationName, email, name, password }) {
    const credentials = await passwordRecord(password);
    return this._mutate(db => {
      if (db.users.length) throw new PilotError("already_bootstrapped", 409);
      const timestamp = nowIso();
      const organization = {
        id: id("org"),
        name: organizationName,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      const user = {
        id: id("usr"),
        organizationId: organization.id,
        email: normalizeEmail(email),
        name,
        role: "owner",
        active: true,
        password: credentials,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastLoginAt: null
      };
      db.organizations.push(organization);
      db.users.push(user);
      appendAudit(db, {
        organizationId: organization.id,
        actorUserId: user.id,
        action: "organization.bootstrap",
        targetType: "organization",
        targetId: organization.id,
        metadata: { ownerUserId: user.id }
      });
      return { organization: publicOrganization(organization), user: publicUser(user) };
    });
  }

  async provisionOrganization({ organizationName, email, name, password }) {
    const credentials = await passwordRecord(password);
    return this._mutate(db => {
      const normalizedEmail = normalizeEmail(email);
      if (db.users.some(user => user.email === normalizedEmail)) throw new PilotError("email_already_exists", 409);
      const timestamp = nowIso();
      const organization = {
        id: id("org"),
        name: organizationName,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      const user = {
        id: id("usr"),
        organizationId: organization.id,
        email: normalizedEmail,
        name,
        role: "owner",
        active: true,
        password: credentials,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastLoginAt: null
      };
      db.organizations.push(organization);
      db.users.push(user);
      appendAudit(db, {
        organizationId: organization.id,
        actorUserId: user.id,
        action: "organization.provision",
        targetType: "organization",
        targetId: organization.id,
        metadata: { ownerUserId: user.id }
      });
      return { organization: publicOrganization(organization), user: publicUser(user) };
    });
  }

  async login({ email, password }) {
    await this._initialize();
    await this._queue;
    await this._reloadFromDisk();
    const normalizedEmail = normalizeEmail(email);
    const candidate = this._database.users.find(item => item.email === normalizedEmail);
    const valid = await passwordMatches(password, candidate?.password);
    if (!candidate || !candidate.active || !valid) throw new PilotError("invalid_credentials", 401);

    const token = `${SESSION_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
    const tokenHash = hashToken(token);
    const expiresAt = nowIso(Date.now() + this.sessionTtlMs);
    const result = await this._mutate(db => {
      const user = db.users.find(item => item.id === candidate.id);
      if (!user?.active || user.password?.hash !== candidate.password?.hash || user.password?.salt !== candidate.password?.salt) {
        throw new PilotError("invalid_credentials", 401);
      }
      const timestamp = nowIso();
      db.sessions = db.sessions.filter(session => !session.revokedAt && Date.parse(session.expiresAt) > Date.now());
      db.sessions.push({
        id: id("ses"),
        userId: user.id,
        tokenHash,
        createdAt: timestamp,
        expiresAt,
        revokedAt: null
      });
      user.lastLoginAt = timestamp;
      user.updatedAt = timestamp;
      appendAudit(db, {
        organizationId: user.organizationId,
        actorUserId: user.id,
        action: "session.login",
        targetType: "user",
        targetId: user.id
      });
      const organization = db.organizations.find(item => item.id === user.organizationId);
      return { user: publicUser(user), organization: publicOrganization(organization), expiresAt };
    });
    return { token, ...result };
  }

  async authenticate(token) {
    if (!String(token || "").startsWith(SESSION_PREFIX)) throw new PilotError("unauthorized", 401);
    const tokenHash = hashToken(token);
    return this._read(db => {
      const session = db.sessions.find(item => !item.revokedAt && safeEqual(item.tokenHash, tokenHash));
      const expiresAt = Date.parse(session?.expiresAt || "");
      if (!session || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new PilotError("unauthorized", 401);
      const user = db.users.find(item => item.id === session.userId);
      if (!user?.active) throw new PilotError("unauthorized", 401);
      const organization = db.organizations.find(item => item.id === user.organizationId);
      if (!organization) throw new PilotError("unauthorized", 401);
      return {
        session: { id: session.id, expiresAt: session.expiresAt },
        user: publicUser(user),
        organization: publicOrganization(organization)
      };
    });
  }

  async logout(token, actor) {
    const tokenHash = hashToken(token);
    return this._mutate(db => {
      const session = db.sessions.find(item => !item.revokedAt && safeEqual(item.tokenHash, tokenHash));
      if (!session || session.userId !== actor.user.id) return { ok: true };
      session.revokedAt = nowIso();
      appendAudit(db, {
        organizationId: actor.organization.id,
        actorUserId: actor.user.id,
        action: "session.logout",
        targetType: "user",
        targetId: actor.user.id
      });
      return { ok: true };
    });
  }

  async changeOwnPassword(organizationId, userId, sessionId, currentPassword, newPassword) {
    const snapshot = await this._read(db => {
      const user = db.users.find(item => item.id === userId && item.organizationId === organizationId);
      return user ? cloneJson(user.password) : null;
    });
    if (!snapshot || !await passwordMatches(currentPassword, snapshot)) throw new PilotError("invalid_credentials", 401);
    const replacement = await passwordRecord(newPassword);
    return this._mutate(db => {
      const user = db.users.find(item => item.id === userId && item.organizationId === organizationId);
      if (!user?.active || user.password?.hash !== snapshot.hash || user.password?.salt !== snapshot.salt) {
        throw new PilotError("password_changed", 409);
      }
      user.password = replacement;
      user.updatedAt = nowIso();
      for (const session of db.sessions) {
        if (session.userId === user.id && session.id !== sessionId && !session.revokedAt) session.revokedAt = nowIso();
      }
      appendAudit(db, {
        organizationId,
        actorUserId: userId,
        action: "user.password.change",
        targetType: "user",
        targetId: userId
      });
      return { ok: true };
    });
  }

  async updateOrganization(organizationId, actorUserId, { name }) {
    return this._mutate(db => {
      const organization = db.organizations.find(item => item.id === organizationId);
      if (!organization) throw new PilotError("organization_not_found", 404);
      organization.name = name;
      organization.updatedAt = nowIso();
      appendAudit(db, {
        organizationId,
        actorUserId,
        action: "organization.update",
        targetType: "organization",
        targetId: organizationId,
        metadata: { fields: ["name"] }
      });
      return publicOrganization(organization);
    });
  }

  async listUsers(organizationId) {
    return this._read(db => db.users.filter(user => user.organizationId === organizationId).map(publicUser));
  }

  async createUser(organizationId, actorUserId, { email, name, role, password }) {
    const credentials = await passwordRecord(password);
    return this._mutate(db => {
      const normalizedEmail = normalizeEmail(email);
      if (db.users.some(user => user.email === normalizedEmail)) throw new PilotError("email_already_exists", 409);
      if (!db.organizations.some(org => org.id === organizationId)) throw new PilotError("organization_not_found", 404);
      const timestamp = nowIso();
      const user = {
        id: id("usr"),
        organizationId,
        email: normalizedEmail,
        name,
        role,
        active: true,
        password: credentials,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastLoginAt: null
      };
      db.users.push(user);
      appendAudit(db, {
        organizationId,
        actorUserId,
        action: "user.create",
        targetType: "user",
        targetId: user.id,
        metadata: { role }
      });
      return publicUser(user);
    });
  }

  async updateUser(organizationId, actorUserId, userId, changes) {
    if (changes.password) changes = { ...changes, password: await passwordRecord(changes.password) };
    return this._mutate(db => {
      const user = db.users.find(item => item.id === userId && item.organizationId === organizationId);
      if (!user) throw new PilotError("user_not_found", 404);
      const nextRole = changes.role || user.role;
      const nextActive = changes.active === undefined ? user.active : changes.active;
      if (user.role === "owner" && user.active && (nextRole !== "owner" || !nextActive)) {
        const activeOwners = db.users.filter(item => item.organizationId === organizationId && item.active && item.role === "owner");
        if (activeOwners.length <= 1) throw new PilotError("last_owner_required", 409);
      }
      const fields = [];
      for (const key of ["name", "role", "active"]) {
        if (changes[key] === undefined) continue;
        user[key] = changes[key];
        fields.push(key);
      }
      if (changes.password) {
        user.password = changes.password;
        fields.push("password");
      }
      user.updatedAt = nowIso();
      if (!user.active || changes.password) {
        for (const session of db.sessions) {
          if (session.userId === user.id && !session.revokedAt) session.revokedAt = nowIso();
        }
      }
      appendAudit(db, {
        organizationId,
        actorUserId,
        action: "user.update",
        targetType: "user",
        targetId: user.id,
        metadata: { fields }
      });
      return publicUser(user);
    });
  }

  async listProjects(organizationId) {
    return this._read(db => db.projects
      .filter(project => project.organizationId === organizationId && !project.deletedAt)
      .map(project => publicProject(project, db.versions.find(version => version.id === project.currentVersionId))));
  }

  async getProject(organizationId, projectId, includeModel = true) {
    return this._read(db => {
      const project = db.projects.find(item => item.id === projectId && item.organizationId === organizationId && !item.deletedAt);
      if (!project) throw new PilotError("project_not_found", 404);
      const currentVersion = db.versions.find(version => version.id === project.currentVersionId);
      return {
        ...publicProject(project, currentVersion),
        currentVersion: currentVersion ? publicVersion(currentVersion, includeModel) : null
      };
    });
  }

  async createProject(organizationId, actorUserId, { name, description, model, message }) {
    return this._mutate(db => {
      if (db.projects.filter(project => project.organizationId === organizationId).length >= this.maxProjectsPerOrganization) {
        throw new PilotError("project_quota_exceeded", 409, { limit: this.maxProjectsPerOrganization });
      }
      const timestamp = nowIso();
      const project = {
        id: id("prj"),
        organizationId,
        name,
        description,
        currentVersionId: null,
        createdBy: actorUserId,
        updatedBy: actorUserId,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null
      };
      const version = {
        id: id("ver"),
        organizationId,
        projectId: project.id,
        number: 1,
        model: cloneJson(model),
        message,
        sourceVersionId: null,
        createdBy: actorUserId,
        createdAt: timestamp,
        digest: crypto.createHash("sha256").update(canonicalJson(model)).digest("hex")
      };
      project.currentVersionId = version.id;
      db.projects.push(project);
      db.versions.push(version);
      appendAudit(db, {
        organizationId,
        actorUserId,
        action: "project.create",
        targetType: "project",
        targetId: project.id,
        metadata: { versionId: version.id, versionNumber: 1 }
      });
      return { ...publicProject(project, version), currentVersion: publicVersion(version, true) };
    });
  }

  async updateProject(organizationId, actorUserId, projectId, changes) {
    return this._mutate(db => {
      const project = db.projects.find(item => item.id === projectId && item.organizationId === organizationId && !item.deletedAt);
      if (!project) throw new PilotError("project_not_found", 404);
      const fields = [];
      for (const key of ["name", "description"]) {
        if (changes[key] === undefined) continue;
        project[key] = changes[key];
        fields.push(key);
      }
      project.updatedAt = nowIso();
      project.updatedBy = actorUserId;
      appendAudit(db, {
        organizationId,
        actorUserId,
        action: "project.update",
        targetType: "project",
        targetId: project.id,
        metadata: { fields }
      });
      return publicProject(project, db.versions.find(version => version.id === project.currentVersionId));
    });
  }

  async deleteProject(organizationId, actorUserId, projectId) {
    return this._mutate(db => {
      const project = db.projects.find(item => item.id === projectId && item.organizationId === organizationId && !item.deletedAt);
      if (!project) throw new PilotError("project_not_found", 404);
      project.deletedAt = nowIso();
      project.updatedAt = project.deletedAt;
      project.updatedBy = actorUserId;
      appendAudit(db, {
        organizationId,
        actorUserId,
        action: "project.delete",
        targetType: "project",
        targetId: project.id
      });
      return { ok: true };
    });
  }

  async listVersions(organizationId, projectId) {
    return this._read(db => {
      const project = db.projects.find(item => item.id === projectId && item.organizationId === organizationId && !item.deletedAt);
      if (!project) throw new PilotError("project_not_found", 404);
      return db.versions.filter(version => version.projectId === projectId && version.organizationId === organizationId)
        .sort((a, b) => b.number - a.number).map(version => publicVersion(version));
    });
  }

  async getVersion(organizationId, projectId, versionId) {
    return this._read(db => {
      const project = db.projects.find(item => item.id === projectId && item.organizationId === organizationId && !item.deletedAt);
      if (!project) throw new PilotError("project_not_found", 404);
      const version = db.versions.find(item => item.id === versionId && item.projectId === projectId && item.organizationId === organizationId);
      if (!version) throw new PilotError("version_not_found", 404);
      return publicVersion(version, true);
    });
  }

  async createVersion(organizationId, actorUserId, projectId, { model, message, expectedCurrentVersionId }) {
    return this._mutate(db => {
      const project = db.projects.find(item => item.id === projectId && item.organizationId === organizationId && !item.deletedAt);
      if (!project) throw new PilotError("project_not_found", 404);
      if (expectedCurrentVersionId && expectedCurrentVersionId !== project.currentVersionId) {
        throw new PilotError("version_conflict", 409, { currentVersionId: project.currentVersionId });
      }
      const existing = db.versions.filter(version => version.projectId === projectId);
      if (existing.length >= this.maxVersionsPerProject) {
        throw new PilotError("version_quota_exceeded", 409, { limit: this.maxVersionsPerProject });
      }
      const version = {
        id: id("ver"),
        organizationId,
        projectId,
        number: existing.reduce((max, item) => Math.max(max, item.number), 0) + 1,
        model: cloneJson(model),
        message,
        sourceVersionId: project.currentVersionId,
        createdBy: actorUserId,
        createdAt: nowIso(),
        digest: crypto.createHash("sha256").update(canonicalJson(model)).digest("hex")
      };
      db.versions.push(version);
      project.currentVersionId = version.id;
      project.updatedAt = version.createdAt;
      project.updatedBy = actorUserId;
      appendAudit(db, {
        organizationId,
        actorUserId,
        action: "project.version.create",
        targetType: "project",
        targetId: projectId,
        metadata: { versionId: version.id, versionNumber: version.number, sourceVersionId: version.sourceVersionId }
      });
      return publicVersion(version, true);
    });
  }

  async restoreVersion(organizationId, actorUserId, projectId, { versionId, expectedCurrentVersionId, message }) {
    return this._mutate(db => {
      const project = db.projects.find(item => item.id === projectId && item.organizationId === organizationId && !item.deletedAt);
      if (!project) throw new PilotError("project_not_found", 404);
      if (expectedCurrentVersionId && expectedCurrentVersionId !== project.currentVersionId) {
        throw new PilotError("version_conflict", 409, { currentVersionId: project.currentVersionId });
      }
      const source = db.versions.find(item => item.id === versionId && item.projectId === projectId && item.organizationId === organizationId);
      if (!source) throw new PilotError("version_not_found", 404);
      if (db.versions.filter(version => version.projectId === projectId).length >= this.maxVersionsPerProject) {
        throw new PilotError("version_quota_exceeded", 409, { limit: this.maxVersionsPerProject });
      }
      const number = db.versions.filter(version => version.projectId === projectId)
        .reduce((max, item) => Math.max(max, item.number), 0) + 1;
      const restored = {
        id: id("ver"),
        organizationId,
        projectId,
        number,
        model: cloneJson(source.model),
        message,
        sourceVersionId: source.id,
        createdBy: actorUserId,
        createdAt: nowIso(),
        digest: source.digest
      };
      db.versions.push(restored);
      project.currentVersionId = restored.id;
      project.updatedAt = restored.createdAt;
      project.updatedBy = actorUserId;
      appendAudit(db, {
        organizationId,
        actorUserId,
        action: "project.version.restore",
        targetType: "project",
        targetId: projectId,
        metadata: { versionId: restored.id, versionNumber: number, restoredFromVersionId: source.id }
      });
      return publicVersion(restored, true);
    });
  }

  async exportProject(organizationId, projectId) {
    return this._read(db => {
      const organization = db.organizations.find(item => item.id === organizationId);
      const project = db.projects.find(item => item.id === projectId && item.organizationId === organizationId && !item.deletedAt);
      if (!project) throw new PilotError("project_not_found", 404);
      const versions = db.versions.filter(version => version.projectId === projectId && version.organizationId === organizationId)
        .sort((a, b) => a.number - b.number).map(version => publicVersion(version, true));
      return {
        schema: "digitalisierungsplanung.project-export.v1",
        exportedAt: nowIso(),
        organization: publicOrganization(organization),
        project: publicProject(project, db.versions.find(version => version.id === project.currentVersionId)),
        versions
      };
    });
  }

  async listAudit(organizationId, { afterSequence = 0, limit = 100 } = {}) {
    return this._read(db => db.audit
      .filter(entry => entry.organizationId === organizationId && entry.sequence > afterSequence)
      .slice(0, limit).map(cloneJson));
  }

  async createOrganizationBackup(organizationId, actorUserId, options = {}) {
    if (!this.backupSigningConfigured) throw new PilotError("backup_signing_key_required", 503);
    await this.ready();
    return this._serialized(async () => {
      const releaseLock = options.recordAudit === false ? null : await this._acquireWriteLock();
      try {
        await this._assertBackupStorageReady();
        await this._reloadFromDisk();
        const db = cloneJson(this._database);
        const organization = db.organizations.find(item => item.id === organizationId);
        if (!organization) throw new PilotError("organization_not_found", 404);
        const backupId = `backup_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
        const createdAt = nowIso();
        const projectIds = new Set(db.projects.filter(project => project.organizationId === organizationId).map(project => project.id));
        const payload = {
          schema: "digitalisierungsplanung.organization-backup.v1",
          id: backupId,
          createdAt,
          databaseRevision: db.revision + (options.recordAudit === false ? 0 : 1),
          organization: cloneJson(organization),
          users: db.users.filter(user => user.organizationId === organizationId).map(cloneJson),
          projects: db.projects.filter(project => project.organizationId === organizationId).map(cloneJson),
          versions: db.versions.filter(version => version.organizationId === organizationId && projectIds.has(version.projectId)).map(cloneJson),
          audit: db.audit.filter(entry => entry.organizationId === organizationId).map(cloneJson)
        };
        const contents = canonicalJson(payload);
        const digest = crypto.createHash("sha256").update(contents).digest("hex");
        const organizationBackupDir = path.join(this.backupDir, organizationId);
        const backupPath = path.join(organizationBackupDir, `${backupId}.json`);
        const manifestPath = path.join(organizationBackupDir, `${backupId}.manifest.json`);
        if (options.recordAudit !== false) {
          appendAudit(db, {
            organizationId,
            actorUserId,
            action: "backup.create",
            targetType: "backup",
            targetId: backupId,
            metadata: { digest, bytes: Buffer.byteLength(`${JSON.stringify(payload)}\n`) }
          });
          this._assertTenantStorageQuotas(db);
        }
        let bytes;
        try {
          bytes = await this._atomicWriteJson(backupPath, payload);
          const manifestBase = {
            schema: "digitalisierungsplanung.backup-manifest.v1",
            id: backupId,
            organizationId,
            createdAt,
            databaseRevision: payload.databaseRevision,
            digest,
            bytes
          };
          const manifest = {
            ...manifestBase,
            signature: crypto.createHmac("sha256", this.backupSigningKey).update(canonicalJson(manifestBase)).digest("hex")
          };
          await this._atomicWriteJson(manifestPath, manifest);
          await this._assertBackupStorageReady();
          if (options.recordAudit !== false) {
            const audit = db.audit.at(-1);
            audit.metadata.bytes = bytes;
            const { hash, ...base } = audit;
            audit.hash = crypto.createHash("sha256").update(canonicalJson(base)).digest("hex");
            db.revision += 1;
            db.updatedAt = nowIso();
            validateDatabase(db);
            await this._atomicWriteJson(this.databasePath, db);
            this._database = db;
          }
        } catch (error) {
          await fs.promises.unlink(backupPath).catch(() => {});
          await fs.promises.unlink(manifestPath).catch(() => {});
          throw error;
        }
        if (options.recordAudit === false) return { id: backupId, createdAt, digest, bytes, signed: true };
        return { id: backupId, createdAt, digest, bytes, signed: true };
      } finally {
        await releaseLock?.();
      }
    });
  }

  async listOrganizationBackups(organizationId) {
    if (!this.backupSigningConfigured) throw new PilotError("backup_signing_key_required", 503);
    await this.ready();
    await this._queue;
    const directory = path.join(this.backupDir, organizationId);
    let names;
    try {
      names = await fs.promises.readdir(directory);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const backups = [];
    for (const name of names.filter(name => /^backup_[0-9]+_[a-f0-9]+\.json$/.test(name)).sort().reverse()) {
      backups.push((await this._readVerifiedOrganizationBackup(organizationId, name.slice(0, -5))).summary);
    }
    return backups;
  }

  async _readVerifiedOrganizationBackup(organizationId, backupId) {
    if (!this.backupSigningConfigured) throw new PilotError("backup_signing_key_required", 503);
    await this.ready();
    if (!/^backup_[0-9]+_[a-f0-9]+$/.test(String(backupId || ""))) throw new PilotError("invalid_backup_id", 400);
    const directory = path.join(this.backupDir, organizationId);
    const backupPath = path.join(directory, `${backupId}.json`);
    const manifestPath = path.join(directory, `${backupId}.manifest.json`);
    let payload;
    let manifest;
    let raw;
    try {
      await this._assertBackupStorageReady();
      raw = await fs.promises.readFile(backupPath, "utf8");
      payload = JSON.parse(raw);
      manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
      await this._assertBackupStorageReady();
    } catch (error) {
      if (error instanceof PilotError && error.status >= 500) throw error;
      if (error.code === "ENOENT") throw new PilotError("backup_not_found", 404);
      throw new PilotError("invalid_backup_integrity", 422);
    }
    const { signature, ...manifestBase } = manifest || {};
    const expectedSignature = crypto.createHmac("sha256", this.backupSigningKey).update(canonicalJson(manifestBase)).digest("hex");
    const digest = crypto.createHash("sha256").update(canonicalJson(payload)).digest("hex");
    if (manifestBase.schema !== "digitalisierungsplanung.backup-manifest.v1" ||
        manifestBase.id !== backupId || manifestBase.organizationId !== organizationId ||
        manifestBase.digest !== digest || manifestBase.bytes !== Buffer.byteLength(raw) ||
        !safeEqual(signature, expectedSignature)) {
      throw new PilotError("invalid_backup_integrity", 422);
    }
    validateOrganizationBackupPayload(payload, organizationId);
    return {
      payload,
      summary: {
        id: backupId,
        createdAt: payload.createdAt,
        databaseRevision: payload.databaseRevision,
        bytes: manifestBase.bytes,
        digest,
        signed: true,
        projects: payload.projects.length,
        versions: payload.versions.length,
        users: payload.users.length
      }
    };
  }

  async inspectOrganizationBackup(organizationId, backupId) {
    await this._initialize();
    await this._queue;
    return cloneJson((await this._readVerifiedOrganizationBackup(organizationId, backupId)).summary);
  }

  async restoreOrganizationBackup(organizationId, actorUserId, backupId, options = {}) {
    const verified = await this._readVerifiedOrganizationBackup(organizationId, backupId);
    if (verified.payload.projects.length > this.maxProjectsPerOrganization) {
      throw new PilotError("project_quota_exceeded", 409, { limit: this.maxProjectsPerOrganization });
    }
    for (const project of verified.payload.projects) {
      if (verified.payload.versions.filter(version => version.projectId === project.id).length > this.maxVersionsPerProject) {
        throw new PilotError("version_quota_exceeded", 409, { limit: this.maxVersionsPerProject });
      }
    }
    const applyRestore = db => {
      if (Number.isSafeInteger(options.expectedDatabaseRevision) && options.expectedDatabaseRevision !== db.revision) {
        throw new PilotError("database_revision_conflict", 409, { currentRevision: db.revision });
      }
      const existingOrganization = db.organizations.find(organization => organization.id === organizationId);
      if (!existingOrganization) throw new PilotError("organization_not_found", 404);
      const payload = verified.payload;
      assertRestoreIdentitiesAvailable(db, organizationId, payload);
      const previousUserIds = new Set(db.users.filter(user => user.organizationId === organizationId).map(user => user.id));
      db.sessions = db.sessions.filter(session => !previousUserIds.has(session.userId));
      db.organizations = db.organizations.filter(organization => organization.id !== organizationId).concat(cloneJson(payload.organization));
      db.users = db.users.filter(user => user.organizationId !== organizationId).concat(cloneJson(payload.users));
      db.projects = db.projects.filter(project => project.organizationId !== organizationId).concat(cloneJson(payload.projects));
      db.versions = db.versions.filter(version => version.organizationId !== organizationId).concat(cloneJson(payload.versions));
      appendAudit(db, {
        organizationId,
        actorUserId,
        action: "backup.restore",
        targetType: "backup",
        targetId: backupId,
        metadata: { digest: verified.summary.digest, sourceDatabaseRevision: payload.databaseRevision }
      });
    };
    if (options.dryRun === true) {
      await this._read(db => {
        const candidate = cloneJson(db);
        applyRestore(candidate);
        this._assertTenantStorageQuotas(candidate);
        validateDatabase(candidate);
      });
      return { ok: true, dryRun: true, ...verified.summary };
    }
    return this._mutate(db => {
      applyRestore(db);
      return { ok: true, restored: true, requiresLogin: true, ...verified.summary };
    });
  }
}

module.exports = {
  PilotError,
  PilotStore,
  ROLES,
  SCHEMA_VERSION,
  normalizeEmail,
  passwordMatches,
  publicOrganization,
  publicProject,
  publicUser,
  publicVersion
};
