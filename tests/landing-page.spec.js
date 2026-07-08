const fs = require("node:fs");
const { test, expect } = require("@playwright/test");

test.describe("Landing page export", () => {
  test("serves the German State Blueprint landing page at root @smoke", async ({ page }) => {
    const html = fs.readFileSync("index.html", "utf8");
    expect(html).toContain("EXPORTED_STATE_BLUEPRINT");
    expect(html).toContain("Zustand macht Prozesse sichtbar");
    expect(html).toContain('href="./state.html"');
    expect(html).not.toContain("window.location.replace");
    expect(html).not.toContain('"editorGroups"');
    expect(html).not.toContain('id="appFrame"');
    expect(html).not.toContain('id="btnNew"');

    await page.goto("/");
    await expect(page).toHaveTitle("Digitalisierungsplanung");
    await expect(page.getByRole("button", { name: "New" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Zustand macht Prozesse sichtbar" })).toBeVisible();

    const editorLink = page.getByRole("link", { name: "Tool öffnen" });
    await expect(editorLink).toHaveAttribute("href", /state\.html$/);

    await page.locator(".navbar").getByRole("button", { name: "Prinzip", exact: true }).click();
    await expect(page.locator("#statePill")).toHaveText("prinzipien");
  });
});
