const { defineConfig } = require("@playwright/test");
const os = require("node:os");

function configuredWorkers() {
  const raw = process.env.PLAYWRIGHT_WORKERS || process.env.TEST_WORKERS;
  const requested = Number(raw);
  if (Number.isFinite(requested) && requested > 0) return Math.floor(requested);
  const cores = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  return process.env.CI ? Math.min(2, Math.max(1, cores)) : Math.min(6, Math.max(2, cores));
}

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 30000,
  expect: {
    timeout: 5000
  },
  fullyParallel: true,
  workers: configuredWorkers(),
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:8124",
    trace: "on-first-retry",
    viewport: { width: 1280, height: 820 }
  },
  webServer: {
    command: "node tests/serve-state.mjs",
    url: "http://127.0.0.1:8124/state.html",
    reuseExistingServer: !process.env.CI,
    timeout: 60000
  }
});
