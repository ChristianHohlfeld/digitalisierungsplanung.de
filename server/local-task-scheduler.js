"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_TASK_FILE = process.env.ZUSTAND_TASK_FILE || path.join(os.homedir(), ".zustand", "tasks.json");
const MAX_RUNS = 20;

function taskError(code, message, statusCode = 400) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function cleanSchedule(value = {}) {
  const type = ["manual", "hourly", "daily"].includes(String(value.type || "")) ? String(value.type) : "manual";
  if (type !== "daily") return { type };
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value.time || "")) ? String(value.time) : "07:00";
  return { type, time };
}

function publicTask(task) {
  return {
    id: task.id,
    name: task.name,
    enabled: task.enabled !== false,
    schedule: { ...task.schedule },
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    lastRunAt: task.lastRunAt || "",
    nextRunAt: task.nextRunAt || "",
    recording: {
      startUrl: String(task.recording?.startUrl || ""),
      actionCount: Array.isArray(task.recording?.actions) ? task.recording.actions.length : 0,
      hasProtectedInputs: Array.isArray(task.recording?.actions) && task.recording.actions.some(action => action?.redacted === true)
    },
    runs: Array.isArray(task.runs) ? task.runs.map(run => ({ ...run })) : []
  };
}

function nextRunAt(schedule, fromValue = Date.now()) {
  const from = new Date(fromValue);
  if (!Number.isFinite(from.getTime()) || !schedule || schedule.type === "manual") return "";
  if (schedule.type === "hourly") {
    const next = new Date(from);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next.toISOString();
  }
  if (schedule.type === "daily") {
    const [hour, minute] = String(schedule.time || "07:00").split(":").map(Number);
    const next = new Date(from);
    next.setHours(hour, minute, 0, 0);
    if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1);
    return next.toISOString();
  }
  return "";
}

function due(task, nowValue = Date.now()) {
  if (!task || task.enabled === false || task.schedule?.type === "manual" || !task.nextRunAt) return false;
  const next = new Date(task.nextRunAt).getTime();
  return Number.isFinite(next) && next <= Number(nowValue);
}

function normalizeRecording(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.actions)) throw taskError("task_recording_invalid", "Task benötigt ein echtes Recorder-Paket mit Actions.");
  if (!value.startUrl) throw taskError("task_recording_invalid", "Task benötigt eine Start-URL.");
  return JSON.parse(JSON.stringify(value));
}

function createTaskScheduler(options = {}) {
  const file = options.file || DEFAULT_TASK_FILE;
  const runRecording = options.runRecording;
  if (typeof runRecording !== "function") throw new TypeError("createTaskScheduler requires runRecording(recording, options)");
  const now = options.now || Date.now;
  const intervalMs = Math.max(5_000, Number(options.intervalMs) || 30_000);
  let tasks = [];
  let timer = null;
  let loaded = false;
  const running = new Set();

  async function persist() {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = file + ".tmp";
    await fs.writeFile(temp, JSON.stringify({ version: 1, tasks }, null, 2), { mode: 0o600 });
    await fs.rename(temp, file);
  }

  async function load() {
    if (loaded) return;
    loaded = true;
    try {
      const data = JSON.parse(await fs.readFile(file, "utf8"));
      tasks = Array.isArray(data.tasks) ? data.tasks : [];
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      tasks = [];
    }
    for (const task of tasks) {
      task.schedule = cleanSchedule(task.schedule);
      task.runs = Array.isArray(task.runs) ? task.runs.slice(0, MAX_RUNS) : [];
      if (!task.nextRunAt && task.schedule.type !== "manual") task.nextRunAt = nextRunAt(task.schedule, now());
    }
  }

  async function list() {
    await load();
    return tasks.map(publicTask);
  }

  async function get(id) {
    await load();
    const task = tasks.find(item => item.id === String(id || ""));
    if (!task) throw taskError("task_not_found", "Task wurde nicht gefunden.", 404);
    return task;
  }

  async function create(input = {}) {
    await load();
    const schedule = cleanSchedule(input.schedule);
    const createdAt = new Date(now()).toISOString();
    const task = {
      id: crypto.randomUUID(),
      name: String(input.name || "Replay Task").trim().slice(0, 120) || "Replay Task",
      enabled: input.enabled !== false,
      schedule,
      recording: normalizeRecording(input.recording),
      secrets: input.secrets && typeof input.secrets === "object" && !Array.isArray(input.secrets) ? { ...input.secrets } : {},
      createdAt,
      updatedAt: createdAt,
      lastRunAt: "",
      nextRunAt: schedule.type === "manual" ? "" : nextRunAt(schedule, now()),
      runs: []
    };
    tasks.unshift(task);
    await persist();
    return publicTask(task);
  }

  async function remove(id) {
    await load();
    const index = tasks.findIndex(item => item.id === String(id || ""));
    if (index < 0) throw taskError("task_not_found", "Task wurde nicht gefunden.", 404);
    const [removed] = tasks.splice(index, 1);
    await persist();
    return publicTask(removed);
  }

  async function update(id, input = {}) {
    const task = await get(id);
    if (Object.prototype.hasOwnProperty.call(input, "name")) task.name = String(input.name || "Replay Task").trim().slice(0, 120) || "Replay Task";
    if (Object.prototype.hasOwnProperty.call(input, "enabled")) task.enabled = input.enabled !== false;
    if (input.schedule) task.schedule = cleanSchedule(input.schedule);
    if (input.recording) task.recording = normalizeRecording(input.recording);
    if (input.secrets && typeof input.secrets === "object" && !Array.isArray(input.secrets)) task.secrets = { ...input.secrets };
    task.updatedAt = new Date(now()).toISOString();
    task.nextRunAt = task.schedule.type === "manual" ? "" : nextRunAt(task.schedule, now());
    await persist();
    return publicTask(task);
  }

  async function run(id, runOptions = {}) {
    const task = await get(id);
    if (running.has(task.id)) throw taskError("task_already_running", "Task läuft bereits.", 409);
    running.add(task.id);
    const startedAtMs = now();
    const startedAt = new Date(startedAtMs).toISOString();
    const runEntry = { id: crypto.randomUUID(), startedAt, finishedAt: "", status: "running", durationMs: 0, error: "", finalUrl: "", actionCount: Array.isArray(task.recording.actions) ? task.recording.actions.length : 0 };
    task.runs.unshift(runEntry);
    task.runs = task.runs.slice(0, MAX_RUNS);
    task.lastRunAt = startedAt;
    task.nextRunAt = task.schedule.type === "manual" ? "" : nextRunAt(task.schedule, startedAtMs + 1000);
    await persist();

    try {
      const result = await runRecording(task.recording, {
        headless: runOptions.headless !== false,
        secrets: { ...(task.secrets || {}), ...(runOptions.secrets || {}) }
      });
      runEntry.status = "success";
      runEntry.finalUrl = String(result.url || "");
      runEntry.actionCount = Number(result.actionCount) || runEntry.actionCount;
      runEntry.finishedAt = new Date(now()).toISOString();
      runEntry.durationMs = Math.max(0, now() - startedAtMs);
      await persist();
      return { task: publicTask(task), result };
    } catch (error) {
      runEntry.status = "failed";
      runEntry.error = String(error.message || error).slice(0, 800);
      runEntry.finishedAt = new Date(now()).toISOString();
      runEntry.durationMs = Math.max(0, now() - startedAtMs);
      await persist();
      throw error;
    } finally {
      running.delete(task.id);
    }
  }

  async function tick() {
    await load();
    const candidates = tasks.filter(task => due(task, now()) && !running.has(task.id));
    for (const task of candidates) {
      await run(task.id, { headless: true }).catch(() => {});
    }
  }

  async function start() {
    await load();
    if (timer) return;
    timer = setInterval(() => { void tick(); }, intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { create, due, get, list, load, nextRunAt, remove, run, start, stop, tick, update, file };
}

module.exports = { cleanSchedule, createTaskScheduler, due, nextRunAt, publicTask, taskError };