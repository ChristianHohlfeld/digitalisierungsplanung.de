"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const deployScript = fs.readFileSync("server/deploy.sh", "utf8");

test("deploy installs recorder browser through the local Playwright CLI", () => {
  assert.match(deployScript, /node \.\/node_modules\/playwright\/cli\.js install --with-deps chromium/);
  assert.doesNotMatch(deployScript, /npx playwright install/);
});

test("deploy creates swap before Playwright browser install on tiny hosts", () => {
  const swapIndex = deployScript.indexOf("ensure_deploy_swap");
  const browserInstallIndex = deployScript.indexOf("node ./node_modules/playwright/cli.js install --with-deps chromium");
  assert.ok(swapIndex > 0);
  assert.ok(browserInstallIndex > swapIndex);
  assert.match(deployScript, /DEPLOY_SWAP_SIZE_MB/);
  assert.match(deployScript, /swapon/);
});
