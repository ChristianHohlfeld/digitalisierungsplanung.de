"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { ReplayTaskStore, cronMatches, validateCron } = require("./replay-task-service");

function recording() {
  return {
    startUrl: "https://example.com/",
    viewport: { width: 1024, height: 640 },
    actions: [
      { index: 1, type: "click", selector: "#go", delayMs: 120 },
      { index: 2, type: "input", selector: "#email", value: "user@example.com", delayMs: 80 }
    ]
  };
}

test("cron parser supports a simple five-field sellable scheduler", () => {
  assert.equal(validateCron("0 7 * * 1-5").ok, true);
  assert.equal(validateCron("bad cron").ok, false);
  assert.equal(cronMatches("0 7 * * 1-5", new Date(2026, 7, 21, 7, 0, 0)), true);
  assert.equal(cronMatches("0 7 * * 1-5", new Date(2026, 7, 21, 7, 1, 0)), false);
});

test("task store persists task, runs real runner and records history", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zustand-task-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "tasks.json");
  const store = new ReplayTaskStore({
    filePath,
    runner: async input => ({ ok: true, actionCount: input.actions.length, durationMs: 42, url: input.startUrl, title: "Done", image: "data:image/jpeg;base64,AA==" })
  });
  const task = await store.create({ name: "Morning flow", recording: recording(), schedule: { type: "cron", expression: "0 7 * * 1-5" } });
  assert.equal(task.name, "Morning flow");
  assert.equal(task.schedule.expression, "0 7 * * 1-5");

  const run = await store.run(task.id);
  assert.equal(run.status, "success");
  assert.equal(run.actionCount, 2);
  const history = await store.history(task.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].status, "success");

  const reloaded = new ReplayTaskStore({ filePath, runner: async () => ({ actionCount: 0 }) });
  const tasks = await reloaded.list();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, task.id);
  assert.equal(tasks[0].runCount, 1);
});

test("failed replay records failing action for visual run diagnosis", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zustand-task-fail-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new ReplayTaskStore({
    filePath: path.join(dir, "tasks.json"),
    runner: async () => { throw Object.assign(new Error("Button disappeared"), { actionCount: 3, failedAction: { index: 4, selector: "#submit", type: "click" } }); }
  });
  const task = await store.create({ name: "Failing flow", recording: recording(), schedule: { type: "manual" } });
  await assert.rejects(() => store.run(task.id), /Button disappeared/);
  const history = await store.history(task.id);
  assert.equal(history[0].status, "failed");
  assert.deepEqual(history[0].failedAction, { index: 4, selector: "#submit", type: "click" });
});
