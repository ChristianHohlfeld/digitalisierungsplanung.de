const fs = require("node:fs");
const { test, expect } = require("@playwright/test");

test.describe("Landing page export", () => {
  test("serves the generated German Zustand landing page at root @smoke", async ({ page }) => {
    const html = fs.readFileSync("index.html", "utf8");
    expect(html).toContain("EXPORTED_STATE_BLUEPRINT");
    expect(html).toContain("Erst verstehen, dann digitalisieren.");
    expect(html).toContain("Viele Projekte scheitern nicht an Technik");
    expect(html).toContain('"url":"./state.html?demo=zustand"');
    expect(html).toContain('"actionLabel":"Editor öffnen"');
    expect(html).toContain('"secondaryTransitionId":"nav_startseite_nutzen"');
    expect(html).toContain("button.link.daisy-transition-button:hover");
    expect(html).toContain("/manifest.webmanifest");
    expect(html).toContain("/assets/share-card.png");
    expect(html).toContain("/assets/landing-hero-business.png");
    expect(html).toContain("/assets/landing-understand-business.png");
    expect(html).not.toContain("data:image/svg+xml;base64");
    expect(html).not.toContain('document.addEventListener("click", evt =>');
    expect(html).not.toContain("window.location.replace");
    expect(html).not.toContain('"editorGroups"');
    expect(html).not.toContain('id="appFrame"');
    expect(html).not.toContain('id="btnNew"');
    expect(html).not.toContain("_editor");

    const landingDefinition = JSON.parse(fs.readFileSync("landing.state.json", "utf8"));
    expect(landingDefinition.model.states.map(state => state.id)).toEqual([
      "startseite",
      "nutzen",
      "vorgehen",
      "ergebnis"
    ]);
    expect(landingDefinition.model.transitions.some(transition => transition.to === "editor")).toBe(false);

    await page.goto("/");
    await expect(page).toHaveTitle("Digitalisierungsplanung");
    await expect(page.getByRole("button", { name: "New" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Erst verstehen, dann digitalisieren." })).toBeVisible();
    await expect(page.locator(".hero")).toHaveCSS("background-image", /landing-hero-business\.png/);
    const hero = page.locator(".hero").first();
    const heroEditorLink = hero.getByRole("link", { name: "Editor öffnen" });
    await expect(heroEditorLink).toHaveAttribute("href", /state\.html\?demo=zustand$/);
    await expect(heroEditorLink).toHaveClass(/btn-primary/);
    const heroSecondary = hero.getByRole("button", { name: "Nutzen ansehen" });
    await expect(heroSecondary).toHaveAttribute("data-transition-id", "nav_startseite_nutzen");
    await expect(heroSecondary).toHaveClass(/btn-ghost/);
    await heroSecondary.click();
    await expect(page.locator("#statePill")).toHaveText("nutzen");

    const manifest = await page.request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBe(true);
    expect((await manifest.json()).name).toBe("Zustand Digitalisierungsplanung");

    const editorLink = page.locator('a[href="./state.html?demo=zustand"]').first();
    await expect(editorLink).toHaveAttribute("href", /state\.html\?demo=zustand$/);
    await expect(editorLink).toHaveCSS("text-decoration-line", "none");

    await page.locator(".navbar").getByRole("button", { name: "Nutzen", exact: true }).click();
    await expect(page.locator("#statePill")).toHaveText("nutzen");
    await expect(page.locator(".steps button[data-transition-id] .daisy-step-label")).toHaveText([
      "Klarheit",
      "Entscheidung",
      "Umsetzung"
    ]);
    await expect(page.locator(".steps button[data-transition-id] .daisy-step-label").first()).toHaveCSS("text-decoration-line", "none");
    await page.locator(".steps").getByRole("button", { name: /Entscheidung/ }).click();
    await expect(page.locator("#statePill")).toHaveText("vorgehen");
    await expect(page.getByRole("heading", { name: "Aus einem unklaren Prozess wird ein prüfbarer Plan" })).toBeVisible();
    await page.locator(".navbar").getByRole("button", { name: "Ergebnis", exact: true }).click();
    await expect(page.locator("#statePill")).toHaveText("ergebnis");
    await expect(page.getByRole("heading", { name: "Ein Plan, den Business und IT gemeinsam tragen." })).toBeVisible();
    await expect(page.locator(".daisy-feature-cards .daisy-feature-card")).toHaveCount(3);
    await expect.poll(async () => page.locator(".daisy-feature-cards .card-actions").evaluateAll(actions => {
      const tops = actions.map(action => Math.round(action.getBoundingClientRect().top));
      return new Set(tops).size;
    })).toBe(1);
    const footerTransitionButton = page.locator(".footer button[data-transition-id]").first();
    await expect(footerTransitionButton).toBeVisible();
    await footerTransitionButton.hover();
    await expect(footerTransitionButton).toHaveCSS("filter", /brightness/);

    await editorLink.click();
    await expect(page).toHaveURL(/state\.html$/);
  });
});
