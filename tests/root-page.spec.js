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

  test("serves the repositioned business-standard landing at root @smoke", async ({ page }) => {
    const html = fs.readFileSync("index.html", "utf8");
    expect(html).toContain("EXPORTED_STATE_BLUEPRINT");
    expect(html).toContain("<title>Digitalisierungsplanung</title>");
    expect(html).toContain('name: "Digitalisierungsplanung"');
    expect(html).toContain('initial: "site_home"');
    expect(html).toContain("/manifest.webmanifest");
    expect(html).toContain("/assets/share-card.png");
    expect(html).toContain("state.html?demo=zustand");
    expect(html).not.toContain('id="appFrame"');
    expect(html).not.toContain('id="btnNew"');
    expect(html).not.toContain("flow-debug");
    expect(html).not.toContain("flowDebug");
    expect(html).not.toContain("runtimeFlowDebug");
    expect(html).toContain('history.scrollRestoration = "manual"');
    expect(html).toContain("beginInitialViewportReset");
    expect(html).toContain("window.visualViewport?.addEventListener");
    expect(html).not.toMatch(/(?:cdn\.jsdelivr\.net|unpkg\.com)\/.*daisyui/i);

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

    const visibleText = await page.locator("body").innerText();
    expect(visibleText).toContain("Unternehmen brauchen Standards, nicht Helden");
    expect(visibleText).toContain("Die meisten Unternehmen dokumentieren ihre Prozesse. Zustand sorgt dafür, dass sie tatsächlich so ausgeführt werden.");
    expect(visibleText).toContain("Zustand verwandelt kritisches Prozesswissen in ausführbare Unternehmensstandards");
    expect(visibleText).toContain("Ihr wichtigstes Unternehmenswissen verlässt jeden Abend das Gebäude.");
    expect(visibleText).toContain("Prozesswissen wird zum ausführbaren Standard.");
    expect(visibleText).not.toMatch(/State Machine|Workflow|Low Code|No Code|BPMN|JSON|Realtime|MCP|Diagrammeditor/i);

    await expect(page.getByRole("heading", { name: "Die meisten Unternehmen dokumentieren ihre Prozesse. Zustand sorgt dafür, dass sie tatsächlich so ausgeführt werden.", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Kritischen Prozess analysieren" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Unternehmenswissen sichern" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Kritische Prozesse leben in Köpfen statt im Unternehmen.", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Prozesswissen wird zum ausführbaren Standard.", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Audits prüfen Dokumente. Unternehmen brauchen gelebte Abläufe.", exact: true })).toBeVisible();

    await page.getByLabel("Der Ablauf hängt an wenigen erfahrenen Personen.").check();
    await expect(page.locator("#score")).toContainText("1 Signal markiert.");
    await page.getByLabel("Verschiedene Teams machen denselben Prozess unterschiedlich.").check();
    await page.getByLabel("Digitalisierung ist geplant, aber der Ablauf ist noch nicht eindeutig.").check();
    await expect(page.locator("#score")).toContainText("3 Signale markiert.");
    await expect(page.locator("#score")).toContainText("Kandidat für einen verbindlichen Unternehmensstandard");

    const manifest = await page.request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBe(true);
    expect((await manifest.json()).name).toBe("Digitalisierungsplanung.de");

    const blueprint = await page.evaluate(() => window.EXPORTED_STATE_BLUEPRINT || EXPORTED_STATE_BLUEPRINT);
    expect(blueprint).toMatchObject({
      version: 2,
      name: "Digitalisierungsplanung",
      initial: "site_home"
    });
    expect(blueprint.states.map(state => state.id)).toEqual(["site_home", "site_problem", "site_standard", "site_check"]);

    await page.reload({ waitUntil: "load" });
    await expect.poll(() => page.evaluate(() => window.__safariLateRestoreApplied === true)).toBe(true);
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY)), { timeout: 3000 }).toBe(0);
    expect(await page.evaluate(() => history.scrollRestoration)).toBe("manual");

    await page.mouse.wheel(0, 500);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    const userScrollY = await page.evaluate(() => window.scrollY);
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => window.scrollY)).toBe(userScrollY);
  });
});

test.describe("Preset designer", () => {
  test("turns an official Daisy snippet into a managed category preset @smoke", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("digitalisierungsplanung.realtime.adminSecret", "admin-secret");
    });
    await page.goto("/presets-admin.html");

    await expect(page.getByRole("heading", { name: /Preset Designer/ })).toBeVisible();
    await expect(page.locator("#status")).toContainText(/Presets geladen/);
    await expect(page.locator("#category")).toHaveValue("websuite-builder");

    await page.locator("#snippet").fill('<footer class="footer sm:footer-horizontal bg-base-200 text-base-content p-10"><aside><p class="footer-title">ACME</p><p>Aus Erfahrung wird Software.</p></aside><nav><h6 class="footer-title">Produkt</h6><a class="link link-hover">Start</a></nav></footer>');
    await page.locator("#title").fill("ACME Footer");
    await page.locator("#category").selectOption("__new__");
    await page.locator("#categoryId").fill("portal");
    await page.locator("#categoryLabel").fill("Portal");
    await page.locator("#package").selectOption("__new__");
    await page.locator("#packageId").fill("portal.pro");
    await page.locator("#packageLabel").fill("Portal Pro");
    await page.getByRole("button", { name: "Snippet einlesen" }).click();

    await expect(page.locator("#status")).toContainText("Definition fuer footer aus Snippet gelesen");
    const definition = JSON.parse(await page.locator("#definition").inputValue());
    expect(definition).toMatchObject({
      id: "custom_acme_footer",
      variant: "footer",
      categoryId: "portal",
      packageIds: ["portal.pro"],
      data: { brand: "ACME" }
    });
    const { _snippet, ...structuredData } = definition.data;
    expect(JSON.stringify(structuredData)).not.toContain("<footer");
    expect(typeof _snippet).toBe("string");
    expect(_snippet).toContain("<footer");

    await page.getByRole("button", { name: "In Contract speichern" }).click();
    await expect(page.locator("#status")).toContainText("Gespeichert und gepusht: browser-test");
    await expect(page.locator("#existingPreset")).toContainText("ACME Footer");
    await expect(page.locator("#managedCategory")).toContainText("Portal");
    await expect(page.locator("#managedPackage")).toContainText("Portal Pro");

    await page.getByRole("button", { name: "Leeres neues Preset", exact: true }).click();
    await page.locator("#sourceMode").selectOption("api");
    await page.locator("#apiUrl").fill("https://preset.example.test/card");
    await page.getByRole("button", { name: "URL einlesen" }).click();
    await expect(page.locator("#status")).toContainText("Definition fuer card von URL geladen");
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
