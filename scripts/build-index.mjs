import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const root = resolve(process.cwd());
const require = createRequire(import.meta.url);
const { DEFAULT_EVENT_CATALOG } = require("../server/event-catalog");
const { productContractResponse } = require("../server/product-contract");
const contract = JSON.stringify(productContractResponse(DEFAULT_EVENT_CATALOG));
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};
const buildServer = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
    if (pathname === "/contract") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(contract);
      return;
    }
    const filePath = resolve(root, pathname === "/" ? "state.html" : pathname.slice(1));
    if (filePath !== root && !filePath.startsWith(root + "\\") && !filePath.startsWith(root + "/")) {
      response.writeHead(403).end();
      return;
    }
    const body = await readFile(filePath);
    response.writeHead(200, { "content-type": contentTypes[extname(filePath)] || "application/octet-stream", "cache-control": "no-store" });
    response.end(body);
  } catch (_) {
    response.writeHead(404).end();
  }
});
await new Promise((resolveListen, reject) => {
  buildServer.once("error", reject);
  buildServer.listen(0, "127.0.0.1", resolveListen);
});
const buildAddress = buildServer.address();
const buildOrigin = `http://127.0.0.1:${buildAddress.port}`;
const browser = await chromium.launch();

try {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 820 } });
  const page = await context.newPage();
  await page.goto(`${buildOrigin}/state.html?demo=zustand`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#btnExport", { state: "visible" });
  await page.waitForSelector('[data-id="site_home"]', { state: "visible" });

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 10000 }),
    page.locator("#btnExport").click()
  ]);
  await download.saveAs(resolve(root, "index.html"));
  await context.close();
} finally {
  await browser.close();
  await new Promise(resolveClose => buildServer.close(resolveClose));
}
