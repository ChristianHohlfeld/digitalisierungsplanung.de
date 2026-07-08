import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(process.cwd());
const screenshotDir = resolve(root, "assets", "screenshots");
const port = Number(process.env.SCREENSHOT_PORT || 8125);
const baseUrl = `http://127.0.0.1:${port}`;

const screenshotFiles = {
  editor: "assets/screenshots/zustand-editor-flow.png",
  preview: "assets/screenshots/zustand-preview-checkout.png",
  inspector: "assets/screenshots/zustand-inspector-widgets.png"
};

const types = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8"
};

function startServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", baseUrl);
    const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const file = normalize(join(root, pathname));

    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "content-type": types[extname(file)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    createReadStream(file).pipe(res);
  });

  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolveServer(server);
    });
  });
}

async function loadZustandDemo(page) {
  await page.goto(`${baseUrl}/state.html`, { waitUntil: "domcontentloaded" });
  await page.locator("#topbarMore summary").waitFor({ state: "visible" });
  await page.locator("#topbarMore summary").click();
  await page.getByRole("button", { name: "Zustand Demo", exact: true }).click();
  await page.getByRole("button", { name: "Demo laden", exact: true }).click();
  await page.locator('[data-id="site_home"]').waitFor({ state: "visible" });
  await page.locator("#btnFit").click();
  await page.waitForTimeout(250);
}

async function waitForRuntimeState(page, stateId) {
  await page.waitForFunction(id => {
    const frame = document.querySelector("#appFrame");
    const doc = frame?.contentDocument;
    return doc?.querySelector("#statePill")?.textContent?.trim() === id;
  }, stateId);
}

async function updateReadme() {
  const readmePath = resolve(root, "README.md");
  const readme = await readFile(readmePath, "utf8");
  const section = `## Screenshots

These screenshots are generated from the real \`state.html\` app in CI after successful pushes, so the README stays aligned with the current UI.

The editor keeps the process, the generated app, and the global-state contract visible in one place.

![Zustand editor canvas with a demo business flow](${screenshotFiles.editor})

The preview is the same FSM running as an app. Buttons and widgets fire real transitions and write through the global JSON bus.

![Generated app preview showing checkout flow](${screenshotFiles.preview})

The state inspector edits the selected state's trigger, widgets, screen fields, and scoped bus data without creating hidden local state.

![State inspector with widget and screen-field controls](${screenshotFiles.inspector})
`;
  const next = readme.replace(/## Screenshots[\s\S]*?(?=\n## Contract\n)/, section);
  if (next !== readme) await writeFile(readmePath, next);
}

await mkdir(screenshotDir, { recursive: true });

const server = await startServer();
const browser = await chromium.launch();

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1
  });
  await context.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("stateBlueprintHotLinked.")) localStorage.removeItem(key);
    }
  });

  const page = await context.newPage();
  await loadZustandDemo(page);
  await page.screenshot({
    path: resolve(root, screenshotFiles.editor),
    fullPage: false
  });

  const app = page.frameLocator("#appFrame");
  await app.locator(".navbar").getByRole("button", { name: "Pricing", exact: true }).click();
  await waitForRuntimeState(page, "site_pricing");
  await app.getByRole("button", { name: "Buy Team", exact: true }).click();
  await waitForRuntimeState(page, "site_checkout");
  await app.getByText("Team plan").waitFor({ state: "visible" });
  await page.locator(".preview").screenshot({
    path: resolve(root, screenshotFiles.preview)
  });

  await loadZustandDemo(page);
  await page.locator('[data-id="site_home"]').hover();
  await page.locator('[data-id="site_home"] .node-edit').click({ force: true });
  await page.locator("#pTitle").waitFor({ state: "visible" });
  const headerWidget = page.locator("#pComponents .component-editor").filter({ hasText: "Widget: Header navigation" }).first();
  await headerWidget.waitFor({ state: "visible" });
  if (!await headerWidget.evaluate(el => el.open)) {
    await headerWidget.locator("summary").click();
  }
  await page.locator("#stateInspector").screenshot({
    path: resolve(root, screenshotFiles.inspector)
  });

  await updateReadme();
  await context.close();
} finally {
  await browser.close();
  await new Promise(resolveServer => server.close(resolveServer));
}
