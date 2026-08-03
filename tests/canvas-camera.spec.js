const { test, expect } = require("@playwright/test");

const STORAGE_KEY = "stateBlueprintHotLinked.model.v2";

function wideDesktopModel() {
  return {
    version: 2,
    name: "Wide desktop camera contract",
    initial: "start",
    states: [
      { id: "start", title: "Start", body: "", components: [], x: 96, y: 192 },
      { id: "end", title: "Ende", body: "", components: [], x: 5000, y: 192 }
    ],
    transitions: [
      { id: "start_end", from: "start", to: "end", label: "Weiter", condition: "", set: {} }
    ]
  };
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

async function emptyCanvasPoint(page) {
  const point = await page.locator("#map").evaluate(map => {
    const rect = map.getBoundingClientRect();
    const blocked = ".node, .edge, .edge-arrow, .edge-pin, .edge-label, .edge-tip-hit, .hit, .svg-port, button, input, textarea, select";
    for (let y = rect.top + 96; y < rect.bottom - 96; y += 42) {
      for (let x = rect.left + 72; x < rect.right - 72; x += 46) {
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

test("desktop boot cannot refit or zoom during the first left or right pan @smoke", async ({ page }) => {
  await page.addInitScript(({ key, model }) => {
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) =>
      nativeSetTimeout(callback, delay === 50 ? 1200 : delay, ...args);
    for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.ui`]) {
      localStorage.removeItem(name);
    }
    localStorage.setItem(`${key}.editor`, JSON.stringify({ model }));
  }, { key: STORAGE_KEY, model: wideDesktopModel() });

  await page.goto("/state.html");
  await expect(page.locator('[data-id="start"]')).toBeVisible();
  const map = page.locator("#map");

  for (const button of ["left", "right"]) {
    const start = await emptyCanvasPoint(page);
    const scaleBefore = await worldScale(page);
    const transformBefore = await worldTransform(page);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button });
    await page.mouse.move(start.x + 84, start.y + 42, { steps: 6 });
    await expect(map).toHaveClass(/panning/);
    await expect.poll(() => worldTransform(page)).not.toBe(transformBefore);
    await page.waitForTimeout(1350);
    await expect.poll(() => worldScale(page)).toBe(scaleBefore);
    await page.mouse.up({ button });

    await expect(map).not.toHaveClass(/panning/);
    await expect.poll(() => worldScale(page)).toBe(scaleBefore);
  }
});
