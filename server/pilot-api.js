"use strict";

const crypto = require("node:crypto");
const net = require("node:net");
const { URL } = require("node:url");
const { PilotError, PilotStore, ROLES, SCHEMA_VERSION, normalizeEmail } = require("./pilot-store");
const { validateModel } = require("../mcp/state-blueprint-core");

const DEFAULT_PREFIX = "/api/v1";
const DEFAULT_MAX_JSON_BYTES = 1024 * 1024;
const DEFAULT_RATE_WINDOW_MS = 60 * 1000;
const DEFAULT_RATE_MAX = 240;
const DEFAULT_LOGIN_RATE_MAX = 12;
const TRUSTED_PROXY_ADDRESSES = new Set(["127.0.0.1", "::1"]);

function parseInteger(value, fallback, min, max) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function bearerToken(request) {
  const match = String(request.headers.authorization || "").match(/^Bearer\s+([^\s]+)$/i);
  return match ? match[1] : "";
}

function publicBaseUrl(request) {
  const proto = String(request.headers["x-forwarded-proto"] || "http").split(",")[0].trim() || "http";
  const host = String(request.headers["x-forwarded-host"] || request.headers.host || "localhost").split(",")[0].trim();
  return `${proto}://${host}`;
}

function securityHeaders(extra = {}) {
  return {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    ...extra
  };
}

function writeJson(response, status, payload, headers = {}) {
  const body = payload === undefined ? "" : JSON.stringify(payload);
  response.writeHead(status, securityHeaders({
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...headers
  }));
  response.end(body);
}

function readStrictJson(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const contentType = String(request.headers["content-type"] || "");
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) {
      reject(new PilotError("application_json_required", 415));
      request.resume();
      return;
    }
    const declared = Number(request.headers["content-length"] || 0);
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(new PilotError("payload_too_large", 413));
      request.resume();
      return;
    }
    const chunks = [];
    let bytes = 0;
    let oversized = false;
    request.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        oversized = true;
        return;
      }
      chunks.push(chunk);
    });
    request.once("error", reject);
    request.once("aborted", () => reject(new PilotError("request_aborted", 400)));
    request.once("end", () => {
      if (oversized) {
        reject(new PilotError("payload_too_large", 413));
        return;
      }
      let payload;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch (_) {
        reject(new PilotError("invalid_json", 400));
        return;
      }
      if (!isPlainObject(payload)) {
        reject(new PilotError("json_object_required", 400));
        return;
      }
      resolve(payload);
    });
  });
}

function rejectUnknownFields(payload, allowed) {
  const unexpected = Object.keys(payload).filter(key => !allowed.includes(key));
  if (unexpected.length) throw new PilotError("unexpected_fields", 400, { fields: unexpected });
}

function requiredString(value, field, { min = 1, max = 200 } = {}) {
  const text = String(value ?? "").trim();
  if (text.length < min || text.length > max) throw new PilotError("invalid_field", 400, { field });
  return text;
}

function optionalString(value, field, { max = 2000, fallback = "" } = {}) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length > max) throw new PilotError("invalid_field", 400, { field });
  return value.trim();
}

function validEmail(value) {
  const email = normalizeEmail(value);
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new PilotError("invalid_field", 400, { field: "email" });
  }
  return email;
}

function validPassword(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > 1024) {
    throw new PilotError("invalid_field", 400, { field: "password", minimumLength: 12 });
  }
  return value;
}

function validRole(value) {
  if (!ROLES.has(value)) throw new PilotError("invalid_field", 400, { field: "role" });
  return value;
}

function validModel(value) {
  if (!isPlainObject(value)) throw new PilotError("invalid_field", 400, { field: "model" });
  const queue = [{ value, depth: 0 }];
  let nodes = 0;
  while (queue.length) {
    const current = queue.pop();
    nodes += 1;
    if (nodes > 50000 || current.depth > 64) throw new PilotError("model_too_complex", 422);
    if (!current.value || typeof current.value !== "object") continue;
    for (const key of Object.keys(current.value)) {
      if (key.length > 500) throw new PilotError("model_too_complex", 422);
      queue.push({ value: current.value[key], depth: current.depth + 1 });
    }
  }
  const validation = validateModel(value);
  if (!validation.ok) {
    const issues = validation.issues.slice(0, 25).map(issue => ({
      code: String(issue.code || "invalid_model").slice(0, 100),
      path: String(issue.path || (issue.stateId ? `states.${issue.stateId}` : issue.transitionId ? `transitions.${issue.transitionId}` : "model")).slice(0, 300)
    }));
    throw new PilotError("invalid_model_contract", 422, {
      issues,
      issueCount: validation.issues.length,
      truncated: validation.issues.length > issues.length
    });
  }
  return validation.model;
}

function parseId(value, field = "id") {
  const text = String(value || "");
  if (!/^[a-z]+_[0-9a-f-]{36}$/i.test(text)) throw new PilotError("invalid_field", 400, { field });
  return text;
}

function parseOptionalExpectedVersion(value) {
  if (value === undefined || value === null || value === "") return undefined;
  return parseId(value, "expectedCurrentVersionId");
}

function requireRole(actor, roles) {
  if (!roles.includes(actor.user.role)) throw new PilotError("forbidden", 403);
}

function normalizedAddress(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.includes(",")) return "";
  const address = raw.replace(/^::ffff:/i, "");
  return net.isIP(address) ? address : "";
}

function clientAddress(request) {
  const direct = normalizedAddress(request.socket?.remoteAddress) || "unknown";
  if (!TRUSTED_PROXY_ADDRESSES.has(direct)) return direct;

  // The production proxy overwrites both headers with the address of its
  // direct client. Trust them only from that known hop and only when they are
  // singular and identical; malformed/appended chains fail closed to the
  // proxy address instead of creating attacker-controlled rate-limit keys.
  const real = normalizedAddress(request.headers["x-real-ip"]);
  const forwarded = normalizedAddress(request.headers["x-forwarded-for"]);
  return real && real === forwarded ? real : direct;
}

function createRateLimiter({ windowMs, max, loginMax }) {
  const buckets = new Map();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
  }, Math.max(1000, windowMs));
  cleanup.unref?.();

  return {
    consume(key, login = false) {
      const now = Date.now();
      const limit = login ? loginMax : max;
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      return {
        allowed: bucket.count <= limit,
        limit,
        remaining: Math.max(0, limit - bucket.count),
        resetAt: bucket.resetAt,
        retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
      };
    },
    close() {
      clearInterval(cleanup);
      buckets.clear();
    }
  };
}

function createPilotApi(options = {}) {
  const prefix = options.prefix || DEFAULT_PREFIX;
  const allowedOrigins = new Set(options.allowedOrigins || []);
  const bootstrapToken = String(options.bootstrapToken || "");
  const provisioningConfigured = bootstrapToken.length >= 32;
  const maxJsonBytes = parseInteger(options.maxJsonBytes, DEFAULT_MAX_JSON_BYTES, 1024, 8 * 1024 * 1024);
  const store = options.store || new PilotStore({
    dataDir: options.dataDir,
    backupDir: options.backupDir,
    requireExternalBackup: options.requireExternalBackup,
    backupSigningKey: options.backupSigningKey,
    sessionTtlMs: options.sessionTtlMs,
    maxProjectsPerOrganization: options.maxProjectsPerOrganization,
    maxVersionsPerProject: options.maxVersionsPerProject,
    maxTenantBytes: options.maxTenantBytes
  });
  const limiter = createRateLimiter({
    windowMs: parseInteger(options.rateLimitWindowMs, DEFAULT_RATE_WINDOW_MS, 1000, 60 * 60 * 1000),
    max: parseInteger(options.rateLimitMax, DEFAULT_RATE_MAX, 1, 100000),
    loginMax: parseInteger(options.loginRateLimitMax, DEFAULT_LOGIN_RATE_MAX, 1, 10000)
  });

  function corsHeaders(request) {
    const origin = String(request.headers.origin || "");
    if (!origin) return {};
    const sameOrigin = origin === publicBaseUrl(request);
    if (!sameOrigin && !allowedOrigins.has("*") && !allowedOrigins.has(origin)) return null;
    return {
      "access-control-allow-origin": allowedOrigins.has("*") ? "*" : origin,
      "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-expose-headers": "content-disposition, x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset",
      "access-control-max-age": "600",
      vary: "Origin"
    };
  }

  async function actorFor(request) {
    const token = bearerToken(request);
    if (!token) throw new PilotError("unauthorized", 401);
    const actor = await store.authenticate(token);
    return { ...actor, token };
  }

  function sendError(response, error, headers, requestId) {
    const status = Number(error?.status) || 500;
    const code = status >= 500 && !(error instanceof PilotError) ? "internal_error" : error?.code || "internal_error";
    const payload = { error: code, requestId };
    if (error?.details) payload.details = error.details;
    writeJson(response, status, payload, headers);
  }

  async function readiness() {
    try {
      const storage = await store.ready();
      const bootstrapped = await store.hasUsers();
      const backupIntegrityProtected = store.backupSigningConfigured === true && store.backupStorageSeparated === true;
      const backupStorageExternal = storage.backupStorageDeviceSeparated === true;
      const backupProtected = backupIntegrityProtected && backupStorageExternal;
      const backupReady = backupIntegrityProtected && (!store.requireExternalBackup || backupStorageExternal);
      const ok = (bootstrapped || provisioningConfigured) && backupReady;
      return {
        ok,
        status: ok ? 200 : 503,
        payload: {
          ok,
          service: "managed-pilot",
          schemaVersion: SCHEMA_VERSION,
          storage: storage.ok ? "ready" : "unavailable",
          databaseRevision: storage.revision,
          bootstrapped,
          bootstrapConfigured: provisioningConfigured,
          backupProtected,
          backupIntegrityProtected,
          backupStorageExternal,
          backupExternalRequired: store.requireExternalBackup
        }
      };
    } catch (_) {
      return {
        ok: false,
        status: 503,
        payload: {
          ok: false,
          service: "managed-pilot",
          schemaVersion: SCHEMA_VERSION,
          storage: "unavailable",
          backupProtected: false,
          backupExternalRequired: store.requireExternalBackup
        }
      };
    }
  }

  async function route(request, response) {
    const requestId = crypto.randomUUID();
    const url = new URL(request.url || "/", "http://localhost");
    const headers = corsHeaders(request);
    if (!headers) {
      writeJson(response, 403, { error: "origin_not_allowed", requestId });
      return;
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204, securityHeaders(headers));
      response.end();
      return;
    }

    const loginRoute = url.pathname === `${prefix}/auth/login` || url.pathname === `${prefix}/bootstrap` || url.pathname === `${prefix}/organizations/provision`;
    const rate = limiter.consume(`${clientAddress(request)}:${loginRoute ? url.pathname : "api"}`, loginRoute);
    const rateHeaders = {
      ...headers,
      "x-ratelimit-limit": String(rate.limit),
      "x-ratelimit-remaining": String(rate.remaining),
      "x-ratelimit-reset": String(Math.ceil(rate.resetAt / 1000))
    };
    if (!rate.allowed) {
      writeJson(response, 429, { error: "rate_limited", requestId }, { ...rateHeaders, "retry-after": String(rate.retryAfter) });
      return;
    }

    try {
      if (request.method === "GET" && url.pathname === `${prefix}/health`) {
        const ready = await readiness();
        writeJson(response, ready.status, ready.payload, rateHeaders);
        return;
      }

      if (request.method === "POST" && url.pathname === `${prefix}/bootstrap`) {
        if (!provisioningConfigured) throw new PilotError("bootstrap_not_configured", 503);
        if (!safeEqual(bearerToken(request), bootstrapToken)) throw new PilotError("unauthorized", 401);
        const body = await readStrictJson(request, maxJsonBytes);
        rejectUnknownFields(body, ["organizationName", "email", "name", "password"]);
        const result = await store.bootstrap({
          organizationName: requiredString(body.organizationName, "organizationName", { max: 160 }),
          email: validEmail(body.email),
          name: requiredString(body.name, "name", { max: 160 }),
          password: validPassword(body.password)
        });
        writeJson(response, 201, result, rateHeaders);
        return;
      }

      if (request.method === "POST" && url.pathname === `${prefix}/organizations/provision`) {
        if (!provisioningConfigured) throw new PilotError("provisioning_not_configured", 503);
        if (!safeEqual(bearerToken(request), bootstrapToken)) throw new PilotError("unauthorized", 401);
        if (!await store.hasUsers()) throw new PilotError("bootstrap_required", 409);
        const body = await readStrictJson(request, maxJsonBytes);
        rejectUnknownFields(body, ["organizationName", "email", "name", "password"]);
        const result = await store.provisionOrganization({
          organizationName: requiredString(body.organizationName, "organizationName", { max: 160 }),
          email: validEmail(body.email),
          name: requiredString(body.name, "name", { max: 160 }),
          password: validPassword(body.password)
        });
        writeJson(response, 201, result, rateHeaders);
        return;
      }

      if (request.method === "POST" && url.pathname === `${prefix}/auth/login`) {
        const body = await readStrictJson(request, Math.min(maxJsonBytes, 16 * 1024));
        rejectUnknownFields(body, ["email", "password"]);
        const result = await store.login({ email: validEmail(body.email), password: validPassword(body.password) });
        writeJson(response, 200, result, rateHeaders);
        return;
      }

      const actor = await actorFor(request);
      const organizationId = actor.organization.id;

      if (request.method === "POST" && url.pathname === `${prefix}/auth/logout`) {
        await store.logout(actor.token, actor);
        writeJson(response, 200, { ok: true }, rateHeaders);
        return;
      }
      if (request.method === "GET" && url.pathname === `${prefix}/auth/me`) {
        writeJson(response, 200, {
          user: actor.user,
          organization: actor.organization,
          session: actor.session
        }, rateHeaders);
        return;
      }
      if (request.method === "POST" && url.pathname === `${prefix}/auth/password`) {
        const body = await readStrictJson(request, Math.min(maxJsonBytes, 16 * 1024));
        rejectUnknownFields(body, ["currentPassword", "newPassword"]);
        if (typeof body.currentPassword !== "string" || !body.currentPassword || body.currentPassword.length > 1024) {
          throw new PilotError("invalid_field", 400, { field: "currentPassword" });
        }
        await store.changeOwnPassword(
          organizationId,
          actor.user.id,
          actor.session.id,
          body.currentPassword,
          validPassword(body.newPassword)
        );
        writeJson(response, 200, { ok: true }, rateHeaders);
        return;
      }

      if (request.method === "GET" && url.pathname === `${prefix}/organization`) {
        writeJson(response, 200, actor.organization, rateHeaders);
        return;
      }
      if (request.method === "PATCH" && url.pathname === `${prefix}/organization`) {
        requireRole(actor, ["owner"]);
        const body = await readStrictJson(request, maxJsonBytes);
        rejectUnknownFields(body, ["name"]);
        const organization = await store.updateOrganization(organizationId, actor.user.id, {
          name: requiredString(body.name, "name", { max: 160 })
        });
        writeJson(response, 200, organization, rateHeaders);
        return;
      }

      if (request.method === "GET" && url.pathname === `${prefix}/users`) {
        requireRole(actor, ["owner"]);
        writeJson(response, 200, { users: await store.listUsers(organizationId) }, rateHeaders);
        return;
      }
      if (request.method === "POST" && url.pathname === `${prefix}/users`) {
        requireRole(actor, ["owner"]);
        const body = await readStrictJson(request, maxJsonBytes);
        rejectUnknownFields(body, ["email", "name", "role", "password"]);
        const user = await store.createUser(organizationId, actor.user.id, {
          email: validEmail(body.email),
          name: requiredString(body.name, "name", { max: 160 }),
          role: validRole(body.role),
          password: validPassword(body.password)
        });
        writeJson(response, 201, user, rateHeaders);
        return;
      }
      const userMatch = url.pathname.match(new RegExp(`^${prefix}/users/([a-z0-9_-]+)$`, "i"));
      if (userMatch && (request.method === "PATCH" || request.method === "DELETE")) {
        requireRole(actor, ["owner"]);
        const userId = parseId(userMatch[1], "userId");
        let changes;
        if (request.method === "DELETE") {
          changes = { active: false };
        } else {
          const body = await readStrictJson(request, maxJsonBytes);
          rejectUnknownFields(body, ["name", "role", "active", "password"]);
          if (!Object.keys(body).length) throw new PilotError("empty_update", 400);
          changes = {};
          if (body.name !== undefined) changes.name = requiredString(body.name, "name", { max: 160 });
          if (body.role !== undefined) changes.role = validRole(body.role);
          if (body.active !== undefined) {
            if (typeof body.active !== "boolean") throw new PilotError("invalid_field", 400, { field: "active" });
            changes.active = body.active;
          }
          if (body.password !== undefined) changes.password = validPassword(body.password);
        }
        writeJson(response, 200, await store.updateUser(organizationId, actor.user.id, userId, changes), rateHeaders);
        return;
      }

      if (request.method === "GET" && url.pathname === `${prefix}/projects`) {
        writeJson(response, 200, { projects: await store.listProjects(organizationId) }, rateHeaders);
        return;
      }
      if (request.method === "POST" && url.pathname === `${prefix}/projects`) {
        requireRole(actor, ["owner", "editor"]);
        const body = await readStrictJson(request, maxJsonBytes);
        rejectUnknownFields(body, ["name", "description", "model", "message"]);
        const project = await store.createProject(organizationId, actor.user.id, {
          name: requiredString(body.name, "name", { max: 200 }),
          description: optionalString(body.description, "description", { max: 4000 }),
          model: validModel(body.model),
          message: optionalString(body.message, "message", { max: 500, fallback: "Initial version" }) || "Initial version"
        });
        writeJson(response, 201, project, rateHeaders);
        return;
      }

      const projectMatch = url.pathname.match(new RegExp(`^${prefix}/projects/([a-z0-9_-]+)$`, "i"));
      if (projectMatch) {
        const projectId = parseId(projectMatch[1], "projectId");
        if (request.method === "GET") {
          writeJson(response, 200, await store.getProject(organizationId, projectId, true), rateHeaders);
          return;
        }
        if (request.method === "PATCH") {
          requireRole(actor, ["owner", "editor"]);
          const body = await readStrictJson(request, maxJsonBytes);
          rejectUnknownFields(body, ["name", "description"]);
          if (!Object.keys(body).length) throw new PilotError("empty_update", 400);
          const changes = {};
          if (body.name !== undefined) changes.name = requiredString(body.name, "name", { max: 200 });
          if (body.description !== undefined) changes.description = optionalString(body.description, "description", { max: 4000 });
          writeJson(response, 200, await store.updateProject(organizationId, actor.user.id, projectId, changes), rateHeaders);
          return;
        }
        if (request.method === "DELETE") {
          requireRole(actor, ["owner", "editor"]);
          await store.deleteProject(organizationId, actor.user.id, projectId);
          writeJson(response, 200, { ok: true }, rateHeaders);
          return;
        }
      }

      const versionsMatch = url.pathname.match(new RegExp(`^${prefix}/projects/([a-z0-9_-]+)/versions$`, "i"));
      if (versionsMatch) {
        const projectId = parseId(versionsMatch[1], "projectId");
        if (request.method === "GET") {
          writeJson(response, 200, { versions: await store.listVersions(organizationId, projectId) }, rateHeaders);
          return;
        }
        if (request.method === "POST") {
          requireRole(actor, ["owner", "editor"]);
          const body = await readStrictJson(request, maxJsonBytes);
          rejectUnknownFields(body, ["model", "message", "expectedCurrentVersionId"]);
          const version = await store.createVersion(organizationId, actor.user.id, projectId, {
            model: validModel(body.model),
            message: optionalString(body.message, "message", { max: 500, fallback: "Saved version" }) || "Saved version",
            expectedCurrentVersionId: parseOptionalExpectedVersion(body.expectedCurrentVersionId)
          });
          writeJson(response, 201, version, rateHeaders);
          return;
        }
      }

      const versionMatch = url.pathname.match(new RegExp(`^${prefix}/projects/([a-z0-9_-]+)/versions/([a-z0-9_-]+)$`, "i"));
      if (versionMatch && request.method === "GET") {
        const projectId = parseId(versionMatch[1], "projectId");
        const versionId = parseId(versionMatch[2], "versionId");
        writeJson(response, 200, await store.getVersion(organizationId, projectId, versionId), rateHeaders);
        return;
      }

      const restoreMatch = url.pathname.match(new RegExp(`^${prefix}/projects/([a-z0-9_-]+)/restore$`, "i"));
      if (restoreMatch && request.method === "POST") {
        requireRole(actor, ["owner", "editor"]);
        const projectId = parseId(restoreMatch[1], "projectId");
        const body = await readStrictJson(request, maxJsonBytes);
        rejectUnknownFields(body, ["versionId", "expectedCurrentVersionId", "message"]);
        const version = await store.restoreVersion(organizationId, actor.user.id, projectId, {
          versionId: parseId(body.versionId, "versionId"),
          expectedCurrentVersionId: parseOptionalExpectedVersion(body.expectedCurrentVersionId),
          message: optionalString(body.message, "message", { max: 500, fallback: "Restored version" }) || "Restored version"
        });
        writeJson(response, 201, version, rateHeaders);
        return;
      }

      const exportMatch = url.pathname.match(new RegExp(`^${prefix}/projects/([a-z0-9_-]+)/export$`, "i"));
      if (exportMatch && request.method === "GET") {
        const projectId = parseId(exportMatch[1], "projectId");
        const exported = await store.exportProject(organizationId, projectId);
        writeJson(response, 200, exported, {
          ...rateHeaders,
          "content-disposition": `attachment; filename="project-${projectId}.json"`
        });
        return;
      }

      if (request.method === "GET" && url.pathname === `${prefix}/audit`) {
        requireRole(actor, ["owner"]);
        const afterSequence = parseInteger(url.searchParams.get("after"), 0, 0, Number.MAX_SAFE_INTEGER);
        const limit = parseInteger(url.searchParams.get("limit"), 100, 1, 200);
        const entries = await store.listAudit(organizationId, { afterSequence, limit });
        writeJson(response, 200, { entries, nextAfter: entries.at(-1)?.sequence || afterSequence }, rateHeaders);
        return;
      }

      if (url.pathname === `${prefix}/backups`) {
        requireRole(actor, ["owner"]);
        if (request.method === "GET") {
          writeJson(response, 200, { backups: await store.listOrganizationBackups(organizationId) }, rateHeaders);
          return;
        }
        if (request.method === "POST") {
          writeJson(response, 201, await store.createOrganizationBackup(organizationId, actor.user.id), rateHeaders);
          return;
        }
      }

      const backupRestoreMatch = url.pathname.match(new RegExp(`^${prefix}/backups/(backup_[0-9]+_[a-f0-9]+)/restore$`, "i"));
      if (backupRestoreMatch && request.method === "POST") {
        requireRole(actor, ["owner"]);
        const backupId = backupRestoreMatch[1];
        const body = await readStrictJson(request, Math.min(maxJsonBytes, 16 * 1024));
        rejectUnknownFields(body, ["confirmation", "expectedDatabaseRevision", "dryRun"]);
        if (body.confirmation !== `RESTORE ${backupId}`) throw new PilotError("restore_confirmation_required", 400);
        if (!Number.isSafeInteger(body.expectedDatabaseRevision) || body.expectedDatabaseRevision < 0) {
          throw new PilotError("invalid_field", 400, { field: "expectedDatabaseRevision" });
        }
        if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") throw new PilotError("invalid_field", 400, { field: "dryRun" });
        const result = await store.restoreOrganizationBackup(organizationId, actor.user.id, backupId, {
          expectedDatabaseRevision: body.expectedDatabaseRevision,
          dryRun: body.dryRun === true
        });
        writeJson(response, 200, result, rateHeaders);
        return;
      }

      throw new PilotError("not_found", 404);
    } catch (error) {
      if (!(error instanceof PilotError)) console.error(`[pilot-api] request ${requestId} failed`, error);
      sendError(response, error, rateHeaders, requestId);
    }
  }

  return {
    prefix,
    store,
    matches(pathname) {
      return pathname === "/readyz" || pathname === prefix || pathname.startsWith(`${prefix}/`);
    },
    async handle(request, response) {
      const pathname = new URL(request.url || "/", "http://localhost").pathname;
      if (pathname === "/readyz") {
        const ready = await readiness();
        writeJson(response, ready.status, ready.payload);
        return;
      }
      await route(request, response);
    },
    readiness,
    close() {
      limiter.close();
    }
  };
}

module.exports = {
  createPilotApi,
  readStrictJson,
  validModel,
  writeJson
};
