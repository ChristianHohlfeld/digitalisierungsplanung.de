const fs = require("node:fs");
const { test, expect } = require("@playwright/test");

test.describe("Root demo export", () => {
  test("serves the single Zustand demo at root @smoke", async ({ page }) => {
    const html = fs.readFileSync("index.html", "utf8");
    expect(html).toContain("EXPORTED_STATE_BLUEPRINT");
    expect(html).toContain("<title>Zustand Demo</title>");
    expect(html).toContain('"name":"Zustand Demo"');
    expect(html).toContain('"initial":"site_home"');
    expect(html).toContain('"site_checkout"');
    expect(html).toContain("state.html?demo=zustand");
    expect(html).toContain("/manifest.webmanifest");
    expect(html).toContain("/assets/share-card.png");
    expect(html).not.toContain('id="appFrame"');
    expect(html).not.toContain('id="btnNew"');
    expect(html).not.toContain("_editor");

    await page.goto("/");
    await expect(page).toHaveTitle("Zustand Demo");
    await expect(page.getByRole("button", { name: "Neu" })).toHaveCount(0);
    await expect(page.locator("#statePill")).toHaveText("site_home");
    await expect(page.getByRole("heading", { name: "Erst Klarheit. Dann digitalisieren.", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Erstgespraech anfragen" })).toBeVisible();
    await expect(page.locator(".hero .card-actions.justify-center")).toHaveCSS("justify-content", "center");

    const manifest = await page.request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBe(true);
    expect((await manifest.json()).name).toBe("Zustand Digitalisierungsplanung");

    await page.locator(".navbar").getByRole("button", { name: "Nutzen", exact: true }).click();
    await expect(page.locator("#statePill")).toHaveText("site_features");
    await expect(page.getByRole("heading", { name: "Was Sie danach konkret besser koennen" })).toBeVisible();

    await page.locator(".navbar").getByRole("button", { name: "Angebot", exact: true }).click();
    await expect(page.locator("#statePill")).toHaveText("site_pricing");
    await page.getByRole("button", { name: "Blueprint anfragen" }).click();
    await expect(page.locator("#statePill")).toHaveText("site_checkout");
    await expect(page.getByRole("heading", { name: "Anfrage" })).toBeVisible();

    await page.locator(".navbar").getByRole("button", { name: "Kontakt", exact: true }).click();
    await expect(page.locator("#statePill")).toHaveText("site_contact");
    await page.getByRole("button", { name: "Anfrage senden" }).click();
    await expect(page.locator("#statePill")).toHaveText("site_thanks");
  });
});
