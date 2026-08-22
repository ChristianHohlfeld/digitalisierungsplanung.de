const { test, expect } = require("@playwright/test");

const STORAGE_KEY = "stateBlueprintHotLinked.model.v2";

function interactionModel() {
  return {
    version: 2,
    name: "Interaction contract",
    initial: "start",
    states: [
      { id: "start", title: "Start", body: "", components: [], x: 120, y: 168 },
      { id: "review", title: "Prüfen", body: "", components: [], x: 456, y: 168 },
      { id: "done", title: "Fertig", body: "", components: [], x: 792, y: 336 }
    ],
    transitions: [
      { id: "start_review", from: "start", to: "review", label: "Weiter", condition: "", set: {} },
      { id: "review_done", from: "review", to: "done", label: "Freigeben", condition: "", set: {} }
    ]
  };
}

async function openTool(page, model = interactionModel()) {
  await page.addInitScript(({ key, model }) => {
    for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
      localStorage.removeItem(name);
    }
    localStorage.setItem(`${key}.editor`, JSON.stringify({ model }));
  }, { key: STORAGE_KEY, model });
  await page.goto("/state.html");
  await expect(page.locator('[data-id="start"]')).toBeVisible();
  await expect(page.locator(".component-preset-card")).toHaveCount(13);
}

async function worldTransform(page) {
  return page.locator("#world").evaluate(element => getComputedStyle(element).transform);
}

async function worldScale(page) {
  return page.locator("#world").evaluate(element => {
    const transform = getComputedStyle(element).transform;
    return new DOMMatrixReadOnly(transform === "none" ? undefined : transform).a;
  });
}

async function savedModel(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(`${key}.editor`)).model, STORAGE_KEY);
}

async function emptyCanvasPoint(page) {
  const point = await page.locator("#map").evaluate(map => {
    const rect = map.getBoundingClientRect();
    const blocked = ".node, .edge, .edge-arrow, .edge-pin, .edge-label, .edge-tip-hit, .hit, .svg-port, button, input, textarea, select";
    for (let y = rect.top + 92; y < rect.bottom - 92; y += 38) {
      for (let x = rect.left + 72; x < rect.right - 72; x += 42) {
        const target = document.elementFromPoint(x, y);
        if (!target || !map.contains(target) || target.closest(blocked)) continue;
        if (typeof isEmptyCanvasTarget === "function" && !isEmptyCanvasTarget(target)) continue;
        return { x, y };
      }
    }
    return null;
  });
  if (!point) throw new Error("Could not find an empty canvas point");
  return point;
}

test.describe("established editor interaction contract", () => {
  test("keeps left inspector, right preview and bottom preset drawer @smoke", async ({ page }) => {
    await openTool(page);
    const workspace = page.locator(".workspace");
    const initialInspectorWidth = await page.locator("#stateInspector").evaluate(element => element.getBoundingClientRect().width);
    if (initialInspectorWidth < 300) {
      await page.locator("#btnToggleInspector").click();
      await expect.poll(() => page.locator("#stateInspector").evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(300);
    }
    const layout = await page.evaluate(() => {
      const box = selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
      };
      return {
        inspector: box("#stateInspector"),
        canvas: box("#map"),
        presets: box(".state-explorer"),
        preview: box(".preview")
      };
    });

    expect(layout.inspector.width).toBeGreaterThanOrEqual(300);
    expect(layout.inspector.right).toBeLessThanOrEqual(layout.canvas.x + 1);
    expect(layout.preview.x).toBeGreaterThanOrEqual(layout.canvas.right - 1);
    expect(layout.presets.x).toBeCloseTo(layout.canvas.x, 0);
    expect(layout.presets.bottom).toBeCloseTo(layout.canvas.bottom, 0);
    expect(layout.presets.y).toBeGreaterThan(layout.canvas.y + layout.canvas.height / 2);
    await expect(page.getByRole("button", { name: "Eigenschaften einklappen" })).toBeVisible();
    await expect(page.getByRole("button", { name: "App-Vorschau einklappen" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Vorlagen einklappen" })).toBeVisible();
    await expect(page.locator(".component-preset-card .template-title")).toHaveText([
      "Bild", "Button", "Checkbox", "Datum", "Dropdown", "E-Mail-Feld", "Passwortfeld",
      "Radio", "Suche", "Textfeld", "Toast", "Überschrift", "Zahlenfeld"
    ]);
  });

  test("single click selects and desktop drag moves the existing state @smoke", async ({ page }) => {
    await openTool(page);
    const node = page.locator('[data-id="review"]');
    await node.click();
    await expect(node).toHaveClass(/selected/);
    await expect(page.locator("#pTitle")).toHaveValue("Prüfen");

    const before = await savedModel(page).then(model => model.states.find(state => state.id === "review"));
    const box = await node.locator(".title").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 101, box.y + box.height / 2 + 43, { steps: 8 });
    await page.mouse.up();

    await expect.poll(async () => {
      const model = await savedModel(page);
      const state = model.states.find(item => item.id === "review");
      return state.x !== before.x || state.y !== before.y;
    }).toBe(true);
  });

  test("node double click enters a layer and empty-canvas double click creates a child @smoke", async ({ page }) => {
    await openTool(page);
    await page.locator('[data-id="start"]').dblclick();
    await expect(page.locator("#layerFrameLabel")).toHaveText("In Start");
    await expect(page.locator("#layerBack")).toBeVisible();

    const before = await savedModel(page).then(model => model.states.length);
    const point = await emptyCanvasPoint(page);
    await page.mouse.dblclick(point.x, point.y);
    await expect.poll(() => savedModel(page).then(model => model.states.length)).toBe(before + 1);
    const created = await savedModel(page).then(model => model.states.find(state => state.parentId === "start"));
    expect(created).toBeTruthy();
  });

  test("empty drag pans, vertical wheel zooms and long press rectangle-selects @smoke", async ({ page }) => {
    await openTool(page);
    const point = await emptyCanvasPoint(page);
    const beforePan = await worldTransform(page);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 84, point.y + 38, { steps: 7 });
    await page.mouse.up();
    await expect.poll(() => worldTransform(page)).not.toBe(beforePan);

    const mapBox = await page.locator("#map").boundingBox();
    await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
    const beforeZoom = await worldScale(page);
    await page.mouse.wheel(0, -180);
    await expect.poll(() => worldScale(page)).toBeGreaterThan(beforeZoom);

    await page.getByRole("button", { name: "Einpassen" }).click();
    const nodeBox = await page.locator('[data-id="start"]').boundingBox();
    const selectStart = await emptyCanvasPoint(page);
    await page.mouse.move(selectStart.x, selectStart.y);
    await page.mouse.down();
    await page.waitForTimeout(410);
    await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator("#selectionActions")).toBeVisible();
    await expect(page.locator("#selectionCount")).toContainText("Zustand");
  });

  test("touch double tap enters layers and hold-to-drag moves states @smoke", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:8124",
      viewport: { width: 900, height: 820 },
      hasTouch: true
    });
    const page = await context.newPage();
    await openTool(page);
    const node = page.locator('[data-id="start"]');
    const box = await node.boundingBox();
    const first = { x: box.x + box.width / 2 - 14, y: box.y + box.height / 2 - 8 };
    const second = { x: first.x + 28, y: first.y + 18 };
    const tap = async (point, pointerId) => {
      await node.dispatchEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "touch", pointerId, clientX: point.x, clientY: point.y });
      await page.locator("#map").dispatchEvent("pointerup", { bubbles: true, cancelable: true, pointerType: "touch", pointerId, clientX: point.x, clientY: point.y });
    };
    await tap(first, 201);
    await tap(second, 202);
    await expect(page.locator("#layerFrameLabel")).toHaveText("In Start");

    await page.locator("#layerBack").click();
    const before = await savedModel(page).then(model => model.states.find(state => state.id === "review"));
    const dragNode = page.locator('[data-id="review"]');
    const dragBox = await dragNode.boundingBox();
    const start = { x: dragBox.x + dragBox.width / 2, y: dragBox.y + dragBox.height / 2 };
    await dragNode.dispatchEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "touch", pointerId: 302, clientX: start.x, clientY: start.y });
    await expect(dragNode).toHaveClass(/touch-drag-ready/, { timeout: 900 });
    await page.evaluate(point => window.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true, cancelable: true, pointerType: "touch", pointerId: 302,
      clientX: point.x + 96, clientY: point.y + 30
    })), start);
    await page.evaluate(point => window.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true, cancelable: true, pointerType: "touch", pointerId: 302,
      clientX: point.x + 96, clientY: point.y + 30
    })), start);
    await expect.poll(async () => {
      const state = await savedModel(page).then(model => model.states.find(item => item.id === "review"));
      return state.x !== before.x || state.y !== before.y;
    }).toBe(true);
    await context.close();
  });

  test("two-finger touch pinch zooms without changing the model @smoke", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:8124",
      viewport: { width: 900, height: 820 },
      hasTouch: true
    });
    const page = await context.newPage();
    await openTool(page);
    const beforeModel = await savedModel(page);
    const beforeScale = await worldScale(page);
    const mapBox = await page.locator("#map").boundingBox();
    const center = { x: mapBox.x + mapBox.width / 2, y: mapBox.y + mapBox.height / 2 };
    await page.locator("#map").evaluate((map, point) => {
      const fire = (target, type, pointerId, x, y) => target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerType: "touch", pointerId,
        clientX: x, clientY: y, buttons: type === "pointerup" ? 0 : 1
      }));
      fire(map, "pointerdown", 31, point.x - 58, point.y);
      fire(map, "pointerdown", 32, point.x + 58, point.y);
      fire(window, "pointermove", 31, point.x - 92, point.y);
      fire(window, "pointermove", 32, point.x + 92, point.y);
      fire(window, "pointerup", 31, point.x - 92, point.y);
      fire(window, "pointerup", 32, point.x + 92, point.y);
    }, center);
    await expect.poll(() => worldScale(page)).toBeGreaterThan(beforeScale * 1.5);
    expect(await savedModel(page)).toEqual(beforeModel);
    await context.close();
  });

  test("mobile keeps the established presets, canvas, edit and app views @smoke", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:8124",
      viewport: { width: 390, height: 820 },
      hasTouch: true,
      isMobile: true
    });
    const page = await context.newPage();
    await openTool(page);
    for (const view of ["presets", "canvas", "edit", "app"]) {
      await expect(page.locator(`[data-mobile-view="${view}"]`)).toBeVisible();
    }
    await page.locator('[data-mobile-view="presets"]').tap();
    await expect(page.locator(".workspace")).toHaveClass(/mobile-presets-active/);
    await expect(page.locator(".component-preset-card")).toHaveCount(13);
    await page.locator('[data-mobile-view="canvas"]').tap();
    await expect(page.locator(".workspace")).toHaveClass(/mobile-canvas-active/);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await context.close();
  });
});
