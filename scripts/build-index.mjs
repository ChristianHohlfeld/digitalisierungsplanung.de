import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = resolve(process.cwd());
const storageKey = "stateBlueprintHotLinked.model.v2";
const browser = await chromium.launch();

try {
  const context = await browser.newContext({ acceptDownloads: true });
  await context.addInitScript(key => {
    for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
      localStorage.removeItem(name);
    }
  }, storageKey);

  const page = await context.newPage();
  await page.goto(`${pathToFileURL(resolve(root, "state.html")).href}?demo=zustand`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#btnExport", { state: "visible" });
  await page.waitForSelector('[data-id="site_home"]', { state: "visible" });

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#btnExport").click()
  ]);
  await download.saveAs(resolve(root, "index.html"));
  await context.close();
} finally {
  await browser.close();
}
