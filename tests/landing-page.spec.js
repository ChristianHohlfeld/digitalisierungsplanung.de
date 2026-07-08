const fs = require("node:fs");
const { test, expect } = require("@playwright/test");

test.describe("Landing page export", () => {
  test("serves the generated German Zustand landing page at root @smoke", async ({ page }) => {
    const html = fs.readFileSync("index.html", "utf8");
    expect(html).toContain("EXPORTED_STATE_BLUEPRINT");
    expect(html).toContain("Zustand macht Prozesse sichtbar");
    expect(html).toContain('"url":"./state.html"');
    expect(html).toContain("/manifest.webmanifest");
    expect(html).toContain("/assets/share-card.png");
    expect(html).toContain("/assets/hero-process.png");
    expect(html).not.toContain('document.addEventListener("click", evt =>');
    expect(html).not.toContain("window.location.replace");
    expect(html).not.toContain('"editorGroups"');
    expect(html).not.toContain('id="appFrame"');
    expect(html).not.toContain('id="btnNew"');
    expect(html).not.toContain("_editor");

    const landingDefinition = JSON.parse(fs.readFileSync("landing.state.json", "utf8"));
    expect(landingDefinition.model.states.map(state => state.id)).toEqual([
      "startseite",
      "prinzipien",
      "werkzeug",
      "schnittstellen"
    ]);
    expect(landingDefinition.model.transitions.some(transition => transition.to === "editor")).toBe(false);

    await page.goto("/");
    await expect(page).toHaveTitle("Digitalisierungsplanung");
    await expect(page.getByRole("button", { name: "New" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Zustand macht Prozesse sichtbar" })).toBeVisible();
    await expect(page.locator(".hero")).toHaveCSS("background-image", /hero-process\.png/);

    const manifest = await page.request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBe(true);
    expect((await manifest.json()).name).toBe("Zustand Digitalisierungsplanung");

    const editorLink = page.locator('a[href="./state.html"]').first();
    await expect(editorLink).toHaveAttribute("href", /state\.html$/);

    await page.locator(".navbar").getByRole("button", { name: "Prinzip", exact: true }).click();
    await expect(page.locator("#statePill")).toHaveText("prinzipien");
    await expect(page.locator(".steps button[data-transition-id] .daisy-step-label")).toHaveText([
      "Verstehen",
      "Visualisieren",
      "Digitalisieren"
    ]);
    await page.locator(".steps").getByRole("button", { name: /Visualisieren/ }).click();
    await expect(page.locator("#statePill")).toHaveText("werkzeug");

    await editorLink.click();
    await expect(page).toHaveURL(/state\.html$/);
  });
});
