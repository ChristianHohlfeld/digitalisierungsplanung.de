const fs = require("node:fs");
const { test, expect } = require("@playwright/test");

test.describe("Root demo export", () => {
  test("service workers stay disabled and every old app cache is removed @smoke", async ({ request }) => {
    const sw = await request.get("/sw.js");
    const cleanup = await request.get("/disable-sw.js");
    expect(sw.ok()).toBe(true);
    expect(cleanup.ok()).toBe(true);

    const swSource = await sw.text();
    const cleanupSource = await cleanup.text();
    expect(swSource).toContain("clearAllCaches");
    expect(swSource).toContain("names.map(name => caches.delete(name))");
    expect(swSource).toContain("self.registration.unregister()");
    expect(swSource).not.toContain('addEventListener("fetch"');
    expect(swSource).not.toContain("caches.open");
    expect(swSource).not.toContain("APP_SHELL");
    expect(swSource).not.toContain("staleWhileRevalidate");
    expect(cleanupSource).toContain("registration.unregister()");
    expect(cleanupSource).toContain("names.map(name => caches.delete(name))");
    expect(cleanupSource).not.toContain("serviceWorker.register");
  });

  test("serves the single Zustand demo at root @smoke", async ({ page }) => {
    const html = fs.readFileSync("index.html", "utf8");
    expect(html).toContain("EXPORTED_STATE_BLUEPRINT");
    expect(html).toContain("<title>Digitalisierungsplanung</title>");
    expect(html).toContain('"name":"Digitalisierungsplanung"');
    expect(html).toContain('"initial":"site_home"');
    expect(html).toContain('"site_checkout"');
    expect(html).toContain("state.html?demo=zustand");
    expect(html).toContain("/manifest.webmanifest");
    expect(html).toContain("/assets/share-card.png");
    expect(html).not.toContain('id="appFrame"');
    expect(html).not.toContain('id="btnNew"');
    expect(html).not.toContain("_editor");
    expect(html).not.toContain("flow-debug");
    expect(html).not.toContain("flowDebug");
    expect(html).not.toContain("runtimeFlowDebug");
    expect(html).toContain('history.scrollRestoration = "manual"');
    expect(html).toContain("beginInitialViewportReset");
    expect(html).toContain("window.visualViewport?.addEventListener");
    expect(html).toContain("Array.isArray(cursor) && /^\\d+$/.test(part)");
    expect(html).not.toContain("Array.isArray(cursor) && /^d+$/.test(part)");

    await page.addInitScript(() => {
      const key = "safari-refresh-probe";
      const loadCount = Number(sessionStorage.getItem(key) || 0);
      sessionStorage.setItem(key, String(loadCount + 1));
      if (loadCount === 0) return;
      window.addEventListener("pageshow", () => {
        setTimeout(() => {
          window.scrollTo(0, Math.min(600, document.documentElement.scrollHeight - window.innerHeight));
          window.__safariLateRestoreApplied = window.scrollY > 100;
        }, 40);
      }, { once: true });
    });

    const expectFunnel = async (current, prefix) => {
      await expect(page.locator(".steps")).toHaveCount(1);
      await expect(page.locator("li.step-primary")).toContainText(current);
      await expect(page.locator("li.step-primary")).toHaveAttribute("aria-current", "step");
      await expect(page.locator(`.steps button[data-transition-id="${prefix}_nav_features"]`)).toHaveCount(1);
      await expect(page.locator(`.steps button[data-transition-id="${prefix}_nav_pricing"]`)).toHaveCount(1);
      await expect(page.locator(`.steps button[data-transition-id="${prefix}_nav_contact"]`)).toHaveCount(1);
    };

    await page.goto("/");
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
    await expect.poll(() => page.evaluate(async () => "caches" in window ? (await caches.keys()).length : 0)).toBe(0);
    await expect(page).toHaveTitle("Digitalisierungsplanung");
    await expect(page.getByRole("button", { name: "Neu" })).toHaveCount(0);
    await expect(page.locator("#flowDebug")).toHaveCount(0);
    await expect(page.locator("#statePill")).toHaveText("site_home");
    await expect(page.getByRole("heading", { name: "Aus Erfahrungswissen wird Software.", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Erstgespräch anfragen" })).toBeVisible();
    await expect(page.locator(".hero .card-actions.justify-center")).toHaveCSS("justify-content", "center");
    await expectFunnel("Ablauf verstehen", "site_home");

    const manifest = await page.request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBe(true);
    expect((await manifest.json()).name).toBe("Digitalisierungsplanung.de");

    await page.locator('.steps button[data-transition-id="site_home_nav_features"]').click();
    await expect(page.locator("#statePill")).toHaveText("site_features");
    await expect(page.getByRole("heading", { name: "Was Ihr Unternehmen gewinnt" })).toBeVisible();
    await expectFunnel("Ablauf verstehen", "site_features");

    await page.locator('.steps button[data-transition-id="site_features_nav_pricing"]').click();
    await expect(page.locator("#statePill")).toHaveText("site_pricing");
    await expectFunnel("Blueprint prüfen", "site_pricing");
    await page.getByRole("button", { name: "Blueprint anfragen" }).click();
    await expect(page.locator("#statePill")).toHaveText("site_checkout");
    await expect(page.getByRole("heading", { name: "Anfrage" })).toBeVisible();
    await expectFunnel("Gespräch starten", "site_checkout");

    await page.locator('.steps button[data-transition-id="site_checkout_nav_contact"]').click();
    await expect(page.locator("#statePill")).toHaveText("site_contact");
    await expectFunnel("Gespräch starten", "site_contact");
    await page.getByRole("button", { name: "Anfrage senden" }).click();
    await expect(page.locator("#statePill")).toHaveText("site_thanks");
    await expectFunnel("Gespräch starten", "site_thanks");

    await page.reload({ waitUntil: "load" });
    await expect.poll(() => page.evaluate(() => window.__safariLateRestoreApplied === true)).toBe(true);
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY)), { timeout: 3000 }).toBe(0);
    await expect.poll(() => page.locator(".app").evaluate(el => Math.round(el.getBoundingClientRect().top))).toBeLessThanOrEqual(24);
    expect(await page.evaluate(() => history.scrollRestoration)).toBe("manual");

    await page.mouse.wheel(0, 500);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    const userScrollY = await page.evaluate(() => window.scrollY);
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => window.scrollY)).toBe(userScrollY);
  });
});
