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
    expect(html).toContain('"actionLabel":"Editor öffnen","url":"/state.html"');
    expect(html).not.toContain("state.html?demo=zustand");
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
    expect(html).toContain("DaisyUI v5.6.18 / Tailwind preflight parity");
    expect(html).not.toMatch(/(?:cdn\.jsdelivr\.net|unpkg\.com)\/.*daisyui/i);
    expect(html).toContain("Managed Pilot");
    expect(html).toContain("2.500–7.500 €");
    expect(html).toContain("6–12 Wochen");
    expect(html).not.toMatch(/(?:249|749|1\.990) EUR/);
    expect(html).not.toContain("/Monat");

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

    await page.goto("/");
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
    await expect.poll(() => page.evaluate(async () => "caches" in window ? (await caches.keys()).length : 0)).toBe(0);
    await expect(page).toHaveTitle("Digitalisierungsplanung");
    await expect(page.getByRole("button", { name: "Neu" })).toHaveCount(0);
    await expect(page.locator("#flowDebug")).toHaveCount(0);
    await expect(page.locator("#statePill")).toHaveText("site_home");
    await expect(page.getByRole("heading", { name: "Geschäftsprozesse direkt im Editor modellieren.", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pilot ansehen" })).toHaveClass(/btn-ghost/);
    const editorLink = page.getByRole("link", { name: "Editor öffnen", exact: true });
    await expect(editorLink).toHaveAttribute(
      "href",
      "/state.html"
    );
    await expect(editorLink).toHaveClass(/btn-primary/);
    await expect(page.locator(".hero .card-actions.justify-center")).toHaveCSS("justify-content", "center");
    await expect(page.locator(".navbar").getByRole("button", { name: "Pilot", exact: true })).toBeVisible();

    const footerGeometry = () => page.locator(".footer").evaluate(footer => {
      const style = getComputedStyle(footer);
      const children = [...footer.children]
        .filter(child => !["SCRIPT", "STYLE", "TEMPLATE"].includes(child.tagName))
        .map(child => {
          const box = child.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
        });
      const brand = footer.querySelector("aside p");
      const horizontalOverlap = children.some((box, index) => index > 0 && box.left < children[index - 1].right - 1);
      const verticalOverlap = children.some((box, index) => index > 0 && box.top < children[index - 1].bottom - 1);
      return {
        flow: style.gridAutoFlow,
        paddingTop: style.paddingTop,
        borderTopWidth: style.borderTopWidth,
        borderRadius: style.borderRadius,
        topSpread: Math.max(...children.map(box => box.top)) - Math.min(...children.map(box => box.top)),
        leftSpread: Math.max(...children.map(box => box.left)) - Math.min(...children.map(box => box.left)),
        horizontalOverlap,
        verticalOverlap,
        brandFits: !brand || brand.scrollWidth <= brand.clientWidth + 1,
        hasOverflow: footer.scrollWidth > footer.clientWidth + 1
      };
    });

    await expect(page.locator('footer.footer[class~="sm:footer-horizontal"].bg-base-200.text-base-content.p-10')).toBeVisible();
    const wideFooter = await footerGeometry();
    expect(wideFooter).toMatchObject({
      flow: "column",
      paddingTop: "40px",
      borderTopWidth: "0px",
      borderRadius: "0px",
      horizontalOverlap: false,
      brandFits: true,
      hasOverflow: false
    });
    expect(wideFooter.topSpread).toBeLessThanOrEqual(1);

    await page.setViewportSize({ width: 390, height: 844 });
    const narrowFooter = await footerGeometry();
    expect(narrowFooter).toMatchObject({
      flow: "row",
      horizontalOverlap: true,
      verticalOverlap: false,
      brandFits: true,
      hasOverflow: false
    });
    expect(narrowFooter.leftSpread).toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 1280, height: 820 });

    const manifest = await page.request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBe(true);
    expect((await manifest.json()).name).toBe("Digitalisierungsplanung.de");

    await page.locator(".navbar").getByRole("button", { name: "Nutzen", exact: true }).click();
    await expect(page.locator("#statePill")).toHaveText("site_features");
    await expect(page.getByRole("heading", { name: "Was Ihr Unternehmen gewinnt" })).toBeVisible();

    await page.locator(".navbar").getByRole("button", { name: "Pilot", exact: true }).click();
    await expect(page.locator("#statePill")).toHaveText("site_pricing");
    await expect(page.getByRole("heading", { name: "Pilot", exact: true })).toBeVisible();
    await expect(page.locator(".daisy-pricing .card-title")).toContainText(["Managed Pilot"]);
    await expect(page.locator(".daisy-pricing .daisy-card-price")).toContainText("2.500–7.500 €");
    await expect(page.getByText("6–12 Wochen", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Pilot qualifizieren" }).click();
    await expect(page.locator("#statePill")).toHaveText("site_checkout");
    await expect(page.getByRole("heading", { name: "Qualifizierung" })).toBeVisible();
    await expect(page.getByText("Managed Pilot", { exact: true })).toBeVisible();

    await page.locator(".navbar").getByRole("button", { name: "Kontakt", exact: true }).click();
    await expect(page.locator("#statePill")).toHaveText("site_contact");
    await page.getByRole("button", { name: "Qualifizierung vorbereiten" }).click();
    await expect(page.locator("#statePill")).toHaveText("site_thanks");
    await expect(page.getByText("Diese Demo versendet keine Daten", { exact: false })).toBeVisible();

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

test.describe("Preset designer", () => {
  test("turns an official Daisy snippet into a managed category preset @smoke", async ({ page, request }) => {
    const tokenResponse = await request.get("/__test/presets-admin-token");
    expect(tokenResponse.ok()).toBe(true);
    const { token } = await tokenResponse.json();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await page.addInitScript(adminToken => {
      localStorage.setItem("digitalisierungsplanung.realtime.adminSecret", adminToken);
    }, token);
    await page.goto("/presets-admin.html");

    await expect(page.getByRole("heading", { name: /Preset Designer/ })).toBeVisible();
    await expect(page.locator("#status")).toContainText("0 eigene Presets");
    await expect(page.locator("#category")).toHaveValue("websuite-builder");

    await page.locator("#snippet").fill('<footer class="footer sm:footer-horizontal bg-base-200 text-base-content p-10"><aside><p class="footer-title">ACME</p><p>Aus Erfahrung wird Software.</p></aside><nav><h6 class="footer-title">Produkt</h6><a class="link link-hover">Start</a></nav></footer>');
    await page.locator("#title").fill("ACME Footer");
    await page.locator("#category").selectOption("__new__");
    await page.locator("#categoryId").fill("portal");
    await page.locator("#categoryLabel").fill("Portal");
    await page.locator("#package").selectOption("__new__");
    await page.locator("#packageId").fill("portal.pro");
    await page.locator("#packageLabel").fill("Portal Pro");
    await page.getByRole("button", { name: "Definition erzeugen" }).click();

    await expect(page.locator("#status")).toContainText("Definition für footer erzeugt");
    const definition = JSON.parse(await page.locator("#definition").inputValue());
    expect(definition).toMatchObject({
      id: "custom_acme_footer",
      variant: "footer",
      categoryId: "portal",
      packageIds: ["portal.pro"],
      data: { brand: "ACME" }
    });
    expect(JSON.stringify(definition)).not.toContain("<footer");

    await page.getByRole("button", { name: "In Contract speichern" }).click();
    await expect(page.locator("#status")).toContainText("Commit browser-test auf Review-Branch admin/presets-browser-test");
    await expect(page.locator("#existingPreset")).toContainText("ACME Footer");
    await expect(page.locator("#managedCategory")).toContainText("Portal");
    await expect(page.locator("#managedPackage")).toContainText("Portal Pro");

    await page.getByRole("button", { name: "Neu", exact: true }).click();
    await page.locator("#sourceMode").selectOption("api");
    await page.locator("#apiUrl").fill("https://preset.example.test/card");
    await page.getByRole("button", { name: "API abrufen" }).click();
    await expect(page.locator("#status")).toContainText("API-Definition für card erzeugt");
    const apiDefinition = JSON.parse(await page.locator("#definition").inputValue());
    expect(apiDefinition).toMatchObject({
      id: "custom_api_card",
      variant: "card",
      categoryId: "websuite-builder",
      packageIds: ["website.builder"]
    });
    expect(JSON.stringify(apiDefinition)).not.toContain("preset.example.test");

    await page.getByRole("button", { name: "In Contract speichern" }).click();
    await expect(page.locator("#existingPreset")).toContainText("API Card");
  });
});
