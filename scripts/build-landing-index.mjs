import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = resolve(process.cwd());
const definitionPath = resolve(root, "landing.state.json");
const definition = JSON.parse(await readFile(definitionPath, "utf8"));
const model = definition.model;

if (!model || !Array.isArray(model.states) || !Array.isArray(model.transitions)) {
  throw new Error("landing.state.json must contain a complete State Blueprint model.");
}

const storageKey = "stateBlueprintHotLinked.model.v2";
const browser = await chromium.launch();

try {
  const context = await browser.newContext({ acceptDownloads: true });
  await context.addInitScript(
    ({ storageKey, model }) => {
      localStorage.setItem(
        `${storageKey}.editor`,
        JSON.stringify({
          model,
          stateTemplates: [],
          selected: null,
          currentLayerId: null
        })
      );
      localStorage.removeItem(storageKey);
      localStorage.removeItem(`${storageKey}.camera`);
    },
    { storageKey, model }
  );

  const page = await context.newPage();
  await page.goto(pathToFileURL(resolve(root, "state.html")).href, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#btnExport", { state: "visible" });

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#btnExport").click()
  ]);
  await download.saveAs(resolve(root, "index.html"));
  await context.close();
} finally {
  await browser.close();
}
