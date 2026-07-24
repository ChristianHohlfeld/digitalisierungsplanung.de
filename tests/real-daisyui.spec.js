import { expect, test } from "@playwright/test";

test("@smoke state editor renders official DaisyUI preview and export", async ({ page }) => {
  await page.goto("/state.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#presetSelect")).toBeVisible();
  await expect(page.locator("#preview")).toBeVisible();

  const options = await page.locator("#presetSelect option").allTextContents();
  expect(options.some(option => /Button/.test(option))).toBe(true);
  expect(options.some(option => /Card/.test(option))).toBe(true);

  await page.locator("#presetSelect").selectOption("builtin_daisy_card");
  await page.locator("#applyData").click();

  const srcdoc = await page.locator("#preview").getAttribute("srcdoc");
  expect(srcdoc).toContain("https://cdn.jsdelivr.net/npm/daisyui@5");
  expect(srcdoc).toContain("https://cdn.jsdelivr.net/npm/daisyui@5/themes.css");
  expect(srcdoc).toContain("https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4");
  expect(srcdoc).toContain("card bg-base-100 w-96 shadow-sm");
  expect(srcdoc).toContain("card-actions justify-end");

  await page.locator("#addState").click();
  await expect(page.locator("#stateList .app-state-item")).toHaveCount(1);
});
