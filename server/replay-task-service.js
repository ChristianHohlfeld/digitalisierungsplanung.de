"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { requiredSecretKeys, sanitizeRecordingForTask } = require("./replay-engine");

const LIMITS = Object.freeze([
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6]
]);

function taskError(code, message, statusCode = 400) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function fieldMatchesPart(value, part, min, max) {
  const [base, rawStep] = String(part || "").split("/", 2);
  const step = rawStep === undefined ? 1 : Number(rawStep);
  if (!Number.isInteger(step) || step < 1) return false;
  if (base === "*") return (value - min) % step === 0;
  const range = base.match(/^(\d+)-(\d+)$/);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    return start >= min && end <= max && start <= end && value >= start && value <= end && (value - start) % step === 0;
  }
  if (!/^\d+$/.test(base)) return false;
  const exact = Number(base);
  return exact >= min && exact <= max && value === exact;
}

function cronFieldMatches(value, source, min, max) {
  const parts = String(source || "").split(",").map(item => item.trim()).filter(Boolean);
  return parts.length > 0 && parts.some(part => fieldMatchesPart(value, part, min, max));
}

function validateCron(expression) {
  const fields = String(expression || "").trim().split(/\s+/);
  if (fields.length !== 5) return { ok: false, error: "Cron needs 5 fields: minute hour day month weekday." };
  for (let index = 0; index < fields.length; index += 1) {
    const [min, max] = LIMITS[index];
    const probeValues = Array.from({ length: max - min + 1 }, (_, offset) => min + offset);
    if (!probeValues.some(value => cronFieldMatches(value, fields[index], min, max))) return { ok: false, error: `Invalid cron field ${index + 1}.` };
  }
  return { ok: true, expression: fields.join(" ") };
}

function cronMatches(expression, date = new Date()) {
  const valid = validateCron(expression);
  if (!valid.ok) return false;
  const fields = valid.expression.split(" ");
  const values = [date.getMinutes(), date.getHours(), date.getDate(), date.getMonth() + 1, date.getDay()];
  return fields.every((field, index) => cronFieldMatches(values[index], field, ...LIMITS[index]));
}

function minuteKey(date = new Date()) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes()].map(value => String(value).padStart(2, "0")).join(":");
}

function normalizeSchedule(input = {}) {
  const type = String(input.type || (input.expression ? "cron" : "manual")).trim();
  if (type === "manual") return { type: "manual", expression: "" };
  if (type !== "cron") throw taskError("task_schedule_invalid", "Schedule type must be manual or cron.");
  const valid = validateCron(input.expression);
  if (!valid.ok) throw taskError("task_cron_invalid", valid.error);
  return { type: "cron", expression: valid.expression };
}

function normalizeSecretEnv(recording, input = {}) {
  const required = requiredSecretKeys(recording);
  const supplied = input && typeof input === "object" ? input : {};
  const out = {};
  for (const key of required) {
    const envName = String(supplied[key] || "").trim();
    if (envName && /^[A-Z_][A-Z0-9_]*$/.test(envName)) out[key] = envName;
  }
  return out;
}

class ReplayTaskStore {
  constructor(options = {}) {
    this.filePath = path.resolve(options.filePath || process.env.REPLAY_TASKS_FILE || "/var/lib/digitalisierungsplanung/replay-tasks.json");
    this.runner = options.runner;
    this.now = options.now || (() => new Date());
    this.maxRuns = Math.max(1, Math.min(100, Number(options.maxRuns) || 20));
    this.state = { version: 1, tasks: [], runs: [] };
    this.loaded = false;
    this.running = new Set();
    this.timer = null;
  }

  async load() {
    if (this.loaded) return this.state;
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      if (parsed && typeof parsed === "object") this.state = { version: 1, tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [], runs: Array.isArray(parsed.runs) ? parsed.runs : [] };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    this.loaded = true;
    return this.state;
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    await fs.rename(temp, this.filePath);
  }

  async list() {
    await this.load();
    return this.state.tasks.map(task => ({ ...task, recording: undefined, runCount: this.state.runs.filter(run => run.taskId === task.id).length, lastRun: this.state.runs.find(run => run.taskId === task.id) || null }));
  }

  async get(id) {
    await this.load();
    return this.state.tasks.find(task => task.id === String(id || "")) || null;
  }

  async create(input = {}) {
    await this.load();
    const recording = sanitizeRecordingForTask(input.recording || input.package || {});
    const schedule = normalizeSchedule(input.schedule || {});
    const id = `task_${crypto.randomBytes(8).toString("hex")}`;
    const now = this.now();
    const task = {
      id,
      name: String(input.name || new URL(recording.startUrl).hostname || "Replay Task").trim().slice(0, 140),
      enabled: input.enabled !== false,
      runner: String(input.runner || "cloud") === "local" ? "local" : "cloud",
      schedule,
      recording,
      requiredSecrets: requiredSecretKeys(recording),
      secretEnv: normalizeSecretEnv(recording, input.secretEnv),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      lastScheduledMinute: ""
    };
    this.state.tasks.push(task);
    await this.save();
    return { ...task, recording: undefined };
  }

  async update(id, patch = {}) {
    const task = await this.get(id);
    if (!task) throw taskError("task_not_found", "Replay task not found.", 404);
    if (Object.prototype.hasOwnProperty.call(patch, "name")) task.name = String(patch.name || task.name).trim().slice(0, 140);
    if (Object.prototype.hasOwnProperty.call(patch, "enabled")) task.enabled = patch.enabled === true;
    if (patch.schedule) task.schedule = normalizeSchedule(patch.schedule);
    if (patch.secretEnv) task.secretEnv = normalizeSecretEnv(task.recording, patch.secretEnv);
    task.updatedAt = this.now().toISOString();
    await this.save();
    return { ...task, recording: undefined };
  }

  async remove(id) {
    await this.load();
    const before = this.state.tasks.length;
    this.state.tasks = this.state.tasks.filter(task => task.id !== String(id || ""));
    this.state.runs = this.state.runs.filter(run => run.taskId !== String(id || ""));
    if (this.state.tasks.length === before) throw taskError("task_not_found", "Replay task not found.", 404);
    await this.save();
    return { ok: true };
  }

  taskSecrets(task) {
    const secrets = {};
    for (const key of task.requiredSecrets || []) {
      const envName = task.secretEnv?.[key];
      if (envName && Object.prototype.hasOwnProperty.call(process.env, envName)) secrets[key] = process.env[envName];
    }
    return secrets;
  }

  async run(id, options = {}) {
    const task = await this.get(id);
    if (!task) throw taskError("task_not_found", "Replay task not found.", 404);
    if (this.running.has(task.id)) throw taskError("task_already_running", "Replay task is already running.", 409);
    if (typeof this.runner !== "function") throw taskError("task_runner_missing", "Replay task runner is not configured.", 500);
    const missing = (task.requiredSecrets || []).filter(key => !Object.prototype.hasOwnProperty.call(options.secrets || this.taskSecrets(task), key));
    if (missing.length) throw taskError("task_secrets_missing", `Missing secrets: ${missing.join(", ")}.`, 422);
    this.running.add(task.id);
    const started = this.now();
    let run;
    try {
      const result = await this.runner(task.recording, { ...options, secrets: options.secrets || this.taskSecrets(task), task });
      run = { id: `run_${crypto.randomBytes(8).toString("hex")}`, taskId: task.id, status: "success", startedAt: started.toISOString(), finishedAt: this.now().toISOString(), durationMs: Number(result?.durationMs) || 0, actionCount: Number(result?.actionCount) || 0, url: String(result?.url || ""), title: String(result?.title || ""), image: String(result?.image || "") };
      return { ...run, result };
    } catch (error) {
      run = { id: `run_${crypto.randomBytes(8).toString("hex")}`, taskId: task.id, status: "failed", startedAt: started.toISOString(), finishedAt: this.now().toISOString(), durationMs: Number(error?.durationMs) || 0, actionCount: Number(error?.actionCount) || 0, error: String(error?.message || error), failedAction: error?.failedAction || null, url: String(error?.url || ""), image: String(error?.image || "") };
      throw Object.assign(error instanceof Error ? error : new Error(run.error), { run });
    } finally {
      if (run) {
        this.state.runs.unshift(run);
        this.state.runs = this.state.runs.slice(0, this.maxRuns);
        await this.save().catch(() => {});
      }
      this.running.delete(task.id);
    }
  }

  async history(taskId = "") {
    await this.load();
    return this.state.runs.filter(run => !taskId || run.taskId === String(taskId));
  }

  async tick(date = this.now()) {
    await this.load();
    const key = minuteKey(date);
    for (const task of this.state.tasks) {
      if (!task.enabled || task.schedule?.type !== "cron" || task.lastScheduledMinute === key) continue;
      if (!cronMatches(task.schedule.expression, date)) continue;
      task.lastScheduledMinute = key;
      await this.save().catch(() => {});
      void this.run(task.id).catch(() => {});
    }
  }

  start(intervalMs = 15_000) {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, Math.max(5_000, Number(intervalMs) || 15_000));
    this.timer.unref?.();
    void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { ReplayTaskStore, cronFieldMatches, cronMatches, minuteKey, normalizeSchedule, validateCron };
