const fs = require("node:fs");
const { test, expect } = require("@playwright/test");

test.describe("root export", () => {
  test("service workers remain disabled @smoke", async ({ request }) => {
    for (const file of ["/sw.js", "/disable-sw.js"]) {
      const response = await request.get(file);
      expect(response.ok()).toBe(true);
      const source = await response.text();
      expect(source).toContain("registration.unregister");
      expect(source).not.toContain('addEventListener("fetch"');
      expect(source).not.toContain("caches.open");
    }
  });

  test("root remains one self-contained generated process app @smoke", async ({ page }) => {
    const html = fs.readFileSync("index.html", "utf8");
    expect(html).toContain("EXPORTED_STATE_BLUEPRINT");
    expect(html).not.toContain("serviceWorker.register");
    await page.goto("/");
    await expect(page.locator("#screen")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  });
});
