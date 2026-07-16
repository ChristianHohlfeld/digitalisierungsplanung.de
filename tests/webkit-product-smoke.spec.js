const { test, expect } = require("@playwright/test");
const { randomBytes } = require("node:crypto");

const EDITOR_STORAGE_KEY = "stateBlueprintHotLinked.model.v2.editor";
const MANAGED_SESSION_KEY = "zustand.pilot.session.v1";
const pageErrors = new WeakMap();

function productModel(overrides = {}) {
  return {
    version: 2,
    name: "Managed Pilot Smoke",
    initial: "start",
    states: [
      {
        id: "start",
        title: "Pilot startklar",
        body: "",
        components: [
          {
            id: "component_start_status",
            type: "text",
            text: "Der Pilot-Prozess ist bereit.",
            url: ""
          }
        ],
        data: {},
        x: 120,
        y: 160
      }
    ],
    transitions: [],
    ...overrides
  };
}

test.describe("WebKit product smoke", () => {
  test.beforeEach(async ({ page }) => {
    const errors = [];
    pageErrors.set(page, errors);
    page.on("pageerror", error => errors.push(error.message));
  });

  test.afterEach(async ({ page }) => {
    expect(pageErrors.get(page), "uncaught browser errors").toEqual([]);
  });

  test("public site presents one Managed Pilot offer and its qualification path", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle("Digitalisierungsplanung");
    await expect(page.getByRole("heading", { name: "Geschäftsprozesse direkt im Editor modellieren.", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pilot ansehen" })).toHaveClass(/btn-ghost/);
    const editorLink = page.getByRole("link", { name: "Editor öffnen", exact: true });
    await expect(editorLink).toHaveAttribute(
      "href",
      "/state.html"
    );
    await expect(editorLink).toHaveClass(/btn-primary/);
    await expect(page.locator('a[href*="studio.html"]')).toHaveCount(0);

    await page.locator(".navbar").getByRole("button", { name: "Pilot", exact: true }).click();
    await expect(page.locator("#statePill")).toHaveText("site_pricing");
    await expect(page.getByRole("heading", { name: "Pilot", exact: true })).toBeVisible();
    await expect(page.locator(".daisy-pricing .card-title")).toHaveText("Managed Pilot");
    await expect(page.locator(".daisy-pricing .daisy-card-price")).toContainText("2.500–7.500 €");
    await expect(page.getByText("6–12 Wochen", { exact: true })).toBeVisible();
    await expect(page.getByText(/(?:249|749|1\.990) EUR|\/Monat/)).toHaveCount(0);

    await page.getByRole("button", { name: "Pilot qualifizieren" }).click();
    await expect(page.locator("#statePill")).toHaveText("site_checkout");
    await expect(page.getByRole("heading", { name: "Qualifizierung" })).toBeVisible();
    await expect(page.getByText("Managed Pilot", { exact: true })).toBeVisible();
    await expect(page.locator("input").first()).toBeVisible();
    await expect(page.locator("textarea").first()).toBeVisible();
    await page.locator("input").first().fill("pilot@example.test");
    await page.locator("textarea").first().fill("Auftragsfreigabe mit zwei beteiligten Teams.");
    await page.getByRole("button", { name: "Qualifizierung vorbereiten", exact: true }).click();
    await expect(page.locator("#statePill")).toHaveText("site_thanks");
    await expect(page.getByText("Diese Demo versendet keine Daten", { exact: false })).toBeVisible();
  });

  test("public local editor boots and renders the persisted workspace", async ({ page }) => {
    const model = productModel({ name: "Studio Boot Smoke" });
    await page.addInitScript(({ key, value }) => {
      localStorage.setItem(key, JSON.stringify({ model: value }));
    }, { key: EDITOR_STORAGE_KEY, value: model });

    await page.goto("/state.html");

    await expect(page.locator("#btnNew")).toBeVisible();
    await expect(page.locator("#btnSave")).toBeVisible();
    await expect(page.locator("#publicEditorNotice")).toContainText("Modelle bleiben in diesem Browser");
    await expect(page.locator("#publicEditorNotice")).toContainText("keine Cloud-Sicherung");
    await expect(page.locator('[data-id="start"]')).toBeVisible();
    const runtime = page.frameLocator("#appFrame");
    await expect(runtime.locator("#statePill")).toHaveText("start");
    await expect(runtime.getByRole("heading", { name: "Pilot startklar" })).toBeVisible();
    await expect(runtime.getByText("Der Pilot-Prozess ist bereit.", { exact: true })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("#publicEditorNotice")).toBeVisible();
    const noticeBox = await page.locator("#publicEditorNotice").boundingBox();
    expect(noticeBox).not.toBeNull();
    expect(noticeBox.x).toBeGreaterThanOrEqual(0);
    expect(noticeBox.x + noticeBox.width).toBeLessThanOrEqual(390);
    expect(noticeBox.y).toBeGreaterThanOrEqual(0);
    expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(844);
    const mobileControlsTop = await page.evaluate(() => Math.min(
      document.querySelector("#mobileCommandBar").getBoundingClientRect().top,
      document.querySelector("#mobileTabs").getBoundingClientRect().top
    ));
    expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(mobileControlsTop);
  });

  test("managed studio loads and saves an immutable project version", async ({ page }) => {
    const projectId = "prj_00000000-0000-4000-8000-000000000101";
    const versionOneId = "ver_00000000-0000-4000-8000-000000000101";
    const versionTwoId = "ver_00000000-0000-4000-8000-000000000102";
    const token = randomBytes(32).toString("base64url");
    const model = productModel();
    let loadAuthorization = "";
    let saveAuthorization = "";
    let savedVersion = null;

    await page.addInitScript(({ key, session }) => {
      sessionStorage.setItem(key, JSON.stringify(session));
    }, {
      key: MANAGED_SESSION_KEY,
      session: {
        token,
        user: {
          id: "usr_00000000-0000-4000-8000-000000000101",
          role: "editor",
          name: "WebKit Pilot Editor"
        },
        organization: {
          id: "org_00000000-0000-4000-8000-000000000101",
          name: "WebKit Pilot"
        }
      }
    });
    await page.route(`**/api/v1/projects/${projectId}`, async route => {
      loadAuthorization = await route.request().headerValue("authorization") || "";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: projectId,
          name: "WebKit Verwaltungsprozess",
          currentVersionId: versionOneId,
          currentVersionNumber: 1,
          currentVersion: { id: versionOneId, number: 1, model }
        })
      });
    });
    await page.route(`**/api/v1/projects/${projectId}/versions`, async route => {
      saveAuthorization = await route.request().headerValue("authorization") || "";
      savedVersion = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: versionTwoId, number: 2 })
      });
    });

    await page.goto(`/state.html?project=${projectId}&api=/api/v1`);
    await expect(page.locator("#publicEditorNotice")).toBeHidden();
    await expect(page.locator('[data-id="start"]')).toBeVisible();
    await expect(page.frameLocator("#appFrame").locator("#statePill")).toHaveText("start");
    await expect(page.locator("#managedProjectStatus")).toContainText("WebKit Verwaltungsprozess · v1 · gespeichert");
    expect(loadAuthorization).toBe(`Bearer ${token}`);

    await page.evaluate(() => {
      model.name = "Managed Pilot Smoke Revised";
      saveModel("webkit-product-smoke");
    });
    await expect(page.locator("#managedProjectStatus")).toContainText("ungespeichert");
    await page.locator("#btnSave").click();
    await expect(page.locator("#managedProjectStatus")).toContainText("v2 · gespeichert");

    expect(saveAuthorization).toBe(`Bearer ${token}`);
    expect(savedVersion).toMatchObject({
      expectedCurrentVersionId: versionOneId,
      message: "Im Studio gespeichert",
      model: { name: "Managed Pilot Smoke Revised" }
    });
    expect(page.url()).not.toContain(token);
  });
});
