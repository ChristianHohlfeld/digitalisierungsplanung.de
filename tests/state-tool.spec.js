const fs = require("node:fs");
const { test, expect } = require("@playwright/test");

const STORAGE_KEY = "stateBlueprintHotLinked.model.v2";
const GRID_SIZE = 24;

function gridRemainder(value) {
  const remainder = value % GRID_SIZE;
  return Object.is(remainder, -0) ? 0 : remainder;
}

function defaultTestModel() {
  return {
    version: 2,
    name: "Standard Auth Flow",
    initial: "auth_start",
    states: [
      { id: "auth_start", title: "Auth start", body: "", components: [{ id: "c_auth_start", type: "text", text: "User chooses login or registration.", url: "" }], x: 90, y: 210 },
      { id: "login", title: "Login", body: "", components: [{ id: "c_login", type: "text", text: "Email and password are entered.", url: "" }], x: 360, y: 100 },
      { id: "register", title: "Register", body: "", components: [{ id: "c_register", type: "text", text: "Create a new account with email and accepted terms.", url: "" }], x: 360, y: 320 },
      { id: "error", title: "Error", body: "", components: [{ id: "c_error", type: "text", text: "Invalid credentials or registration data.", url: "" }], x: 630, y: 320 },
      { id: "logged_in", title: "Logged in", body: "", components: [{ id: "c_logged_in", type: "text", text: "Authenticated app area.", url: "" }], x: 900, y: 100 },
      { id: "logged_out", title: "Logged out", body: "", components: [{ id: "c_logged_out", type: "text", text: "Session ended. User can return to login.", url: "" }], x: 900, y: 320 }
    ],
    transitions: [
      { id: "t_auth_login", from: "auth_start", to: "login", label: "Login", condition: "", set: {} },
      { id: "t_auth_register", from: "auth_start", to: "register", label: "Registrieren", condition: "", set: {} },
      { id: "t_login_success", from: "login", to: "logged_in", label: "Einloggen", condition: "email == \"user@example.com\" && password == \"secret123\"", set: {} },
      { id: "t_login_error", from: "login", to: "error", label: "Fehler", condition: "", set: {} },
      { id: "t_register_success", from: "register", to: "logged_in", label: "Account erstellen", condition: "email == \"new@example.com\" && accepted_terms", set: {} },
      { id: "t_register_error", from: "register", to: "error", label: "Fehler", condition: "", set: {} },
      { id: "t_logout", from: "logged_in", to: "logged_out", label: "Logout", condition: "", set: {} },
      { id: "t_relogin", from: "logged_out", to: "login", label: "Wieder einloggen", condition: "", set: {} },
      { id: "t_error_back", from: "error", to: "auth_start", label: "Zurueck", condition: "", set: {} }
    ]
  };
}
async function openTool(page, options = {}) {
  const model = options.model || defaultTestModel();
  const stateTemplates = Array.isArray(options.stateTemplates) ? options.stateTemplates : [];
  await page.addInitScript(({ key, model, stateTemplates }) => {
    for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
      localStorage.removeItem(name);
    }
    localStorage.setItem(key, JSON.stringify(model));
    if (stateTemplates.length) localStorage.setItem(`${key}.stateExplorer`, JSON.stringify(stateTemplates));
  }, { key: STORAGE_KEY, model, stateTemplates });
  await page.goto("/state.html");
  if (options.pauseRuntime) {
    await page.getByRole("button", { name: "Pausieren" }).click();
    await expect(page.getByRole("button", { name: "Fortsetzen" })).toHaveAttribute("aria-pressed", "true");
  }
  await expect(page.locator('[data-id="auth_start"]')).toBeVisible();
  await expect(page.locator(".node")).toHaveCount(8);
  await expect(appFrame(page).locator("#statePill")).toHaveText(model.initial || "auth_start");
}

function appFrame(page) {
  return page.frameLocator("#appFrame");
}

async function openStateInspector(page, id) {
  const node = page.locator('[data-id="' + id + '"]');
  await expect(node).toBeVisible();
  await node.hover();
  await node.locator(".node-edit").click({ force: true });
  await expect(page.locator("#pTitle")).toBeVisible();
}

async function openInspectorDetails(page, selector) {
  const details = page.locator(selector);
  await expect(details).toBeAttached();
  if (!await details.evaluate(el => el.open)) {
    await details.locator("summary").first().click();
  }
  await expect(details).toHaveJSProperty("open", true);
}

async function openInitialValuesEditor(page) {
  await openInspectorDetails(page, "#pDataCard");
  await openInspectorDetails(page, "#pDefaultsCard");
  await openInspectorDetails(page, "#pAdvancedDataCard");
}

async function openFetchEditor(page) {
  await openInspectorDetails(page, "#pDataCard");
  await openInspectorDetails(page, "#pFetchCard");
}

async function openRepeatEditor(page) {
  await openInspectorDetails(page, "#pDataCard");
  await openInspectorDetails(page, "#pRepeatCard");
}

async function openStateLayer(page, id) {
  const node = page.locator('[data-id="' + id + '"]');
  await expect(node).toBeVisible();
  const title = (await node.locator(".title").textContent())?.trim() || id;
  const expectedLabel = `In ${title}`;
  const label = page.locator("#layerFrameLabel");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await node.dblclick();
    try {
      await expect(label).toHaveText(expectedLabel, { timeout: 2000 });
      return;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
}

async function centerOf(locator) {
  const box = await visibleBox(locator);
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  };
}

async function visibleBox(locator) {
  let box = null;
  await expect(locator).toBeVisible();
  await expect.poll(async () => {
    box = await locator.boundingBox();
    return Boolean(box && box.width && box.height);
  }).toBe(true);
  return box;
}

function statePort(page, stateId, side) {
  return page.locator(`svg#ports .svg-port[data-state-id="${stateId}"][data-port-side="${side}"]`);
}

function expectCleanPortApproach(route) {
  expect(route.points.length).toBeGreaterThanOrEqual(2);
  const start = route.points[0];
  const afterStart = route.points[1];
  const end = route.points.at(-1);
  const beforeEnd = route.points.at(-2);

  expect(afterStart.y).toBe(start.y);
  expect(afterStart.x).toBeGreaterThanOrEqual(start.x + GRID_SIZE);
  expect(beforeEnd.y).toBe(end.y);
  expect(beforeEnd.x).toBeLessThanOrEqual(end.x - GRID_SIZE);
}

function canvasStateNodes(page) {
  return page.locator(".node:not(.boundary-proxy)");
}

function boundaryProxyNodes(page) {
  return page.locator(".node.boundary-proxy");
}

async function savedModel(page) {
  return page.evaluate(key => {
    const stored = JSON.parse(localStorage.getItem(`${key}.editor`) || localStorage.getItem(key) || "null");
    if (stored) return stored.model || stored;
    if (typeof model !== "undefined") return JSON.parse(JSON.stringify(model));
    return null;
  }, STORAGE_KEY);
}

async function runtimeContext(page) {
  return page.evaluate(() => JSON.parse(JSON.stringify(
    typeof latestRuntimeContext !== "undefined" && latestRuntimeContext ? latestRuntimeContext : {}
  )));
}

async function expectRenderedBreadcrumbs(app, labels, options = {}) {
  await expect(app.locator(".breadcrumbs")).toBeVisible();
  await expect(app.locator(".breadcrumbs li")).toHaveText(labels);
  await expect(app.locator(".breadcrumbs a")).toHaveCount(0);
  const clickableLabels = options.clickableLabels || labels.slice(0, -1);
  const buttons = app.locator(".breadcrumbs button.breadcrumb-action");
  await expect(buttons).toHaveCount(clickableLabels.length);
  if (clickableLabels.length) await expect(buttons).toHaveText(clickableLabels);
  if (options.transitionIds) {
    await expect.poll(async () => buttons.evaluateAll(items => items.map(item => item.dataset.transitionId || ""))).toEqual(options.transitionIds);
  }
  await expect(app.locator(".breadcrumbs li").last()).toHaveText(labels[labels.length - 1]);
  const box = await app.locator(".breadcrumbs").evaluate(root => {
    const rect = root.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  expect(box.width).toBeGreaterThan(80);
  expect(box.height).toBeGreaterThan(16);
}

async function firstChildStateId(page, parentId) {
  const id = await page.evaluate(({ key, parentId }) => {
    const stored = JSON.parse(localStorage.getItem(`${key}.editor`) || localStorage.getItem(key) || "null");
    const model = stored?.model || stored;
    return model.states.find(state => state.parentId === parentId)?.id || "";
  }, { key: STORAGE_KEY, parentId });
  expect(id).toBeTruthy();
  return id;
}

async function savedStateTemplates(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(`${key}.stateExplorer`) || "[]"), STORAGE_KEY);
}

async function savedUiState(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(`${key}.ui`) || "{}"), STORAGE_KEY);
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function localizedComponentTitle(title) {
  const direct = {
    Heading: "Ueberschrift",
    Image: "Bild",
    List: "Liste",
    Note: "Hinweis",
    Divider: "Trenner",
    Button: "Schaltflaeche",
    Field: "Feld"
  };
  const prefix = [
    ["Button: ", "Schaltflaeche: "],
    ["Field: ", "Feld: "]
  ];
  const directTitle = direct[title];
  if (directTitle) return directTitle;
  const match = prefix.find(([from]) => title.startsWith(from));
  return match ? `${match[1]}${title.slice(match[0].length)}` : title;
}

function componentEditor(page, title) {
  const resolvedTitle = localizedComponentTitle(title);
  return page.locator(".component-editor").filter({
    has: page.locator(".component-editor-head span").filter({ hasText: new RegExp(`^${escapeRegExp(resolvedTitle)}$`) })
  });
}

async function expandComponentEditor(page, title) {
  const editor = componentEditor(page, title);
  await expect(editor).toBeVisible();
  await editor.evaluate(el => {
    if (el.matches("details") && !el.open) {
      el.open = true;
      el.dispatchEvent(new Event("toggle"));
    }
  });
  return editor;
}

async function expandComponentEditorIfPresent(page, title) {
  const editor = componentEditor(page, title);
  if (await editor.count()) {
    await editor.evaluate(el => {
      if (el.matches("details") && !el.open) {
        el.open = true;
        el.dispatchEvent(new Event("toggle"));
      }
    });
  }
  return editor;
}

function dataRenderRows(page) {
  return page.locator(".component-editor").filter({
    has: page.locator(".component-editor-title").filter({ hasText: /^(Field|Feld): / })
  });
}

async function expandDataRenderRows(page) {
  const rows = dataRenderRows(page);
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    await row.evaluate(el => {
      if (el.matches("details") && !el.open) {
        el.open = true;
        el.dispatchEvent(new Event("toggle"));
      }
    });
  }
  return rows;
}

function componentPreset(page, title) {
  const presetTitle = PRESET_TITLE_ALIASES[title] || title;
  return page.locator(".component-preset-card").filter({
    has: page.locator(".template-title").filter({ hasText: new RegExp(`^${escapeRegExp(presetTitle)}$`) })
  });
}

const PRESET_TITLE_ALIASES = {
  "FAQ accordion": "FAQ-Akkordeon",
  "Alert banner": "Hinweisbanner",
  "User avatar": "Benutzer-Avatar",
  "Status badge": "Status-Badge",
  "Mobile bottom nav": "Mobile Fußnavigation",
  "Breadcrumb path": "Breadcrumb-Pfad",
  "Action button": "Aktionsbutton",
  "Product card": "Produktkarte",
  "Feature grid": "Feature-Raster",
  "Pricing cards": "Preiskarten",
  "Image carousel": "Bildkarussell",
  "Checkbox field": "Checkbox-Feld",
  "Countdown timer": "Countdown-Timer",
  "Side menu drawer": "Seitenmenü",
  "Dropdown menu": "Dropdown-Menü",
  "File upload": "Datei-Upload",
  "Footer links": "Footer-Links",
  "Hero section": "Hero-Bereich",
  "Hero with image": "Hero mit Bild",
  "Hero with image reverse": "Hero mit Bild rechts",
  "Hero login form": "Hero mit Login-Formular",
  "Hero image overlay": "Hero mit Bild-Overlay",
  "Notification badge": "Benachrichtigungs-Badge",
  "Text input": "Textfeld",
  "Loading state": "Lade-State",
  "Image mask": "Bildmaske",
  "Navigation menu": "Navigationsmenü",
  "Confirm dialog": "Bestätigungsdialog",
  "Navbar basic": "Navbar einfach",
  "Navbar menu": "Navbar mit Menü",
  "Navbar search/profile": "Navbar Suche/Profil",
  "Navbar shop/cart": "Navbar Shop/Warenkorb",
  "Progress bar": "Fortschrittsbalken",
  "Progress ring": "Fortschrittsring",
  "Radio group": "Radio-Gruppe",
  "Slider input": "Schieberegler",
  "Star rating": "Sternebewertung",
  "Select field": "Auswahlfeld",
  "Metric stat": "Kennzahl",
  "Process steps": "Prozessschritte",
  "Data table": "Datentabelle",
  "Content tabs": "Inhalts-Tabs",
  "Textarea field": "Textbereich",
  "Timeline": "Zeitachse",
  "Toast message": "Toast-Meldung",
  "Toggle switch": "Schalter",
  "Page heading": "Seitenüberschrift",
  "Text block": "Textblock",
  "Image block": "Bildblock",
  "Task checklist": "Aufgaben-Checkliste",
  "External link": "Externer Link",
  "Info note": "Infobox",
  "Section divider": "Abschnittstrenner",
  "Content list": "Inhaltsliste"
};

const CORE_PRESET_ALIASES = {
  Heading: "Seitenüberschrift",
  Text: "Textblock",
  Image: "Bildblock",
  List: "Aufgaben-Checkliste",
  Link: "Externer Link",
  Note: "Infobox",
  Divider: "Abschnittstrenner"
};

function cssAttributeValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function nodeByTitle(page, title) {
  return page.locator(".node").filter({
    has: page.locator(".title").filter({ hasText: new RegExp(`^${escapeRegExp(title)}$`) })
  });
}

async function addComponentState(page, title, options = {}) {
  const presetTitle = CORE_PRESET_ALIASES[title] || PRESET_TITLE_ALIASES[title] || title;
  const beforeIds = new Set((await savedModel(page)).states.map(state => state.id));
  await page.evaluate(templateTitle => {
    const template = builtinStateTemplates().find(item => item.title === templateTitle);
    if (!template) throw new Error("Missing built-in template: " + templateTitle);
    addTemplateToCurrentLayer(template);
  }, presetTitle);
  let createdId = "";
  await expect.poll(async () => {
    const model = await savedModel(page);
    const created = model.states.find(state => !beforeIds.has(state.id) && state.title === presetTitle);
    createdId = created?.id || "";
    return createdId;
  }).not.toBe("");
  await expect(page.locator(`.node[data-id="${cssAttributeValue(createdId)}"]`)).toBeVisible();
  if (options.openInspector !== false) {
    await openStateInspector(page, createdId);
  }
  if (presetTitle !== title) {
    if (options.openInspector === false) await openStateInspector(page, createdId);
    await page.locator("#pTitle").fill(title);
    await expect(page.locator("#pTitle")).toHaveValue(title);
  }
  if (options.openInspector !== false && options.expandEditor !== false) {
    await expandComponentEditorIfPresent(page, title);
  }
  return createdId;
}

async function worldTransform(page) {
  return page.locator("#world").evaluate(el => getComputedStyle(el).transform);
}

async function worldScale(page) {
  return page.locator("#world").evaluate(el => {
    const transform = getComputedStyle(el).transform;
    return new DOMMatrixReadOnly(transform === "none" ? undefined : transform).a;
  });
}

async function assertVisibleInViewport(page, selector) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} is not visible`);
  const viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

async function emptyCanvasPoint(page) {
  const point = await page.evaluate(() => {
    const map = document.querySelector("#map");
    const rect = map.getBoundingClientRect();
    const frame = document.querySelector("#layerFrame");
    const frameRect = frame && getComputedStyle(frame).display !== "none" ? frame.getBoundingClientRect() : null;
    const scan = frameRect && frameRect.width > 120 && frameRect.height > 120
      ? {
        left: Math.max(rect.left, frameRect.left + 28),
        right: Math.min(rect.right, frameRect.right - 28),
        top: Math.max(rect.top, frameRect.top + 28),
        bottom: Math.min(rect.bottom, frameRect.bottom - 28)
      }
      : {
        left: rect.left + 80,
        right: rect.left + rect.width - 80,
        top: rect.top + 100,
        bottom: rect.top + rect.height - 120
      };
    const nodeBoxes = [...document.querySelectorAll(".node")].map(node => {
      const box = node.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height
      };
    }).filter(box => box.width && box.height);
    const referenceBox = nodeBoxes.find(box => box.width > 90 && box.height > 50);
    const candidateWidth = referenceBox?.width || 168;
    const candidateHeight = referenceBox?.height || 96;
    const margin = 24;
    const overlapsExistingNode = (x, y) => {
      const candidate = {
        left: x - candidateWidth / 2 - margin,
        right: x + candidateWidth / 2 + margin,
        top: y - candidateHeight / 2 - margin,
        bottom: y + candidateHeight / 2 + margin
      };
      return nodeBoxes.some(box =>
        candidate.left < box.right &&
        candidate.right > box.left &&
        candidate.top < box.bottom &&
        candidate.bottom > box.top
      );
    };
    const findPoint = (requireClearStateBox) => {
      for (let y = scan.top; y < scan.bottom; y += 38) {
        for (let x = scan.left; x < scan.right; x += 46) {
          const el = document.elementFromPoint(x, y);
          if (!el || !map.contains(el)) continue;
          if (el.closest(".state-explorer, .node, .svg-port, .edge, .edge-arrow, .edge-pin, .hit, .edge-label, .edge-tip-hit, .help, .layer-frame-comment, .selection-actions, .canvas-history-actions")) continue;
          if (requireClearStateBox && overlapsExistingNode(x, y)) continue;
          return { x, y };
        }
      }
      return null;
    };
    return findPoint(true) || findPoint(false);
  });
  if (!point) throw new Error("Could not find an empty canvas point");
  return point;
}

async function addChildByDoubleClick(page, parentId, excludeIds = []) {
  const beforeIds = new Set(await page.locator(".node").evaluateAll(nodes => nodes.map(node => node.dataset.id).filter(Boolean)));
  excludeIds.forEach(id => beforeIds.add(id));
  await expect.poll(async () => page.evaluate(() => {
    try {
      return Date.now() >= suppressEmptyCanvasDblClickUntil;
    } catch (_) {
      return true;
    }
  })).toBe(true);
  const point = await emptyCanvasPoint(page);
  await page.mouse.dblclick(point.x, point.y);
  let createdId = "";
  await expect.poll(async () => {
    const ids = await page.locator(".node").evaluateAll(nodes => nodes.map(node => node.dataset.id).filter(Boolean));
    createdId = ids.find(id => !beforeIds.has(id)) || "";
    return createdId;
  }).not.toBe("");
  return createdId;
}

async function dragComponentEditorBefore(page, sourceTitle, targetTitle) {
  await expect(componentEditor(page, sourceTitle)).toBeVisible();
  await expect(componentEditor(page, targetTitle)).toBeVisible();
  const resolvedSourceTitle = localizedComponentTitle(sourceTitle);
  const resolvedTargetTitle = localizedComponentTitle(targetTitle);
  const moved = await page.evaluate(({ sourceTitle, targetTitle }) => {
    const rowTitle = row => row.querySelector(".component-editor-title")?.textContent?.trim() ||
      row.querySelector(".component-editor-head span")?.textContent?.trim() ||
      "";
    const rows = [...document.querySelectorAll(".component-editor")];
    const source = rows.find(row => rowTitle(row) === sourceTitle);
    const target = rows.find(row => rowTitle(row) === targetTitle);
    const handle = source?.querySelector(".component-drag-handle");
    if (!source || !target || !handle) return false;
    const dataTransfer = new DataTransfer();
    const dispatchDrag = (element, type, clientY) => {
      const rect = element.getBoundingClientRect();
      const event = new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer,
        clientX: rect.left + Math.min(12, Math.max(1, rect.width / 2)),
        clientY
      });
      return element.dispatchEvent(event);
    };
    const sourceRect = source.getBoundingClientRect();
    dispatchDrag(handle, "dragstart", sourceRect.top + 4);
    const targetRect = target.getBoundingClientRect();
    dispatchDrag(target, "dragover", targetRect.top + 2);
    dispatchDrag(target, "drop", targetRect.top + 2);
    dispatchDrag(handle, "dragend", sourceRect.top + 4);
    return true;
  }, { sourceTitle: resolvedSourceTitle, targetTitle: resolvedTargetTitle });
  expect(moved).toBe(true);
}

async function dispatchLostDesktopMouseRelease(page, point = { x: 18, y: 18 }) {
  await page.evaluate(({ x, y }) => {
    window.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      buttons: 0
    }));
  }, point);
}

async function dragNodeToStateExplorer(page, node) {
  const nodeBox = await visibleBox(node);
  const explorerBox = await visibleBox(page.locator("#stateExplorer"));
  await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(explorerBox.x + explorerBox.width / 2, explorerBox.y + explorerBox.height / 2, { steps: 8 });
  await page.mouse.up();
}

async function dragTransition(page, output, input, via = null) {
  const start = await centerOf(output);
  const end = await centerOf(input);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  if (via) await page.mouse.move(via.x, via.y, { steps: 8 });
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}

async function clickTransitionById(page, transitionId) {
  const escaped = transitionId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const hit = page.locator(`.hit[data-edge-id="${escaped}"]`);
  await expect(hit).toHaveCount(1);
  const point = await page.evaluate(id => {
    const selector = `.hit[data-edge-id="${CSS.escape(id)}"]`;
    const path = document.querySelector(selector);
    if (!path || typeof path.getTotalLength !== "function") return null;
    const matrix = path.getScreenCTM();
    if (!matrix) return null;
    const blockedSelector = ".state-explorer, .node, .svg-port, .edge-label, .edge-tip-hit, .help, .selection-actions";
    const total = path.getTotalLength();
    for (let step = 1; step < 24; step += 1) {
      const point = path.getPointAtLength(total * step / 24);
      const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      const el = document.elementFromPoint(screen.x, screen.y);
      if (!el) continue;
      if (el.closest(selector)) return { x: screen.x, y: screen.y };
      if (!el.closest(blockedSelector)) return { x: screen.x, y: screen.y };
    }
    return null;
  }, transitionId);
  if (point) await page.mouse.click(point.x, point.y);
  else await hit.click({ force: true });
}

async function gridGeometryReport(page) {
  return page.evaluate(gridSize => {
    const numberList = value => (value.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    const pointsFromPath = value => {
      const numbers = numberList(value);
      const points = [];
      for (let i = 0; i < numbers.length; i += 2) points.push({ x: numbers[i], y: numbers[i + 1] });
      return points;
    };
    const onGrid = value => Math.abs(value / gridSize - Math.round(value / gridSize)) < 0.001;
    return {
      nodes: [...document.querySelectorAll(".node")].map(node => {
        const style = getComputedStyle(node);
        const left = Number.parseFloat(node.style.left);
        const top = Number.parseFloat(node.style.top);
        const width = Number.parseFloat(node.style.width);
        const height = Number.parseFloat(node.style.height || style.height);
        return {
          id: node.dataset.id,
          boundaryProxy: node.classList.contains("boundary-proxy"),
          left,
          top,
          width,
          height,
          overflow: style.overflow,
          isolation: style.isolation,
          output: { x: left + width, y: top + height / 2 },
          input: { x: left, y: top + height / 2 }
        };
      }),
      paths: [...document.querySelectorAll(".edge[data-edge-id]")].map(edge => {
        const d = edge.getAttribute("d") || "";
        const points = pointsFromPath(d);
        const segments = points.slice(1).map((point, index) => {
          const previous = points[index];
          const vertical = point.x === previous.x && point.y !== previous.y;
          const horizontal = point.y === previous.y && point.x !== previous.x;
          if (!vertical && !horizontal) return null;
          return {
            id: edge.dataset.edgeId,
            orientation: vertical ? "vertical" : "horizontal",
            coordinate: vertical ? point.x : point.y,
            min: vertical ? Math.min(previous.y, point.y) : Math.min(previous.x, point.x),
            max: vertical ? Math.max(previous.y, point.y) : Math.max(previous.x, point.x),
            x: vertical ? point.x : null,
            y: horizontal ? point.y : null,
            y1: vertical ? Math.min(previous.y, point.y) : null,
            y2: vertical ? Math.max(previous.y, point.y) : null,
            x1: horizontal ? Math.min(previous.x, point.x) : null,
            x2: horizontal ? Math.max(previous.x, point.x) : null
          };
        }).filter(Boolean);
        return {
          id: edge.dataset.edgeId,
          d,
          points,
          stroke: getComputedStyle(edge).stroke,
          segments,
          verticalSegments: segments.filter(segment => segment.orientation === "vertical"),
          horizontalSegments: segments.filter(segment => segment.orientation === "horizontal"),
          usesOnlyGridLines: /^M -?\d+(?:\.\d+)? -?\d+(?:\.\d+)?(?: L -?\d+(?:\.\d+)? -?\d+(?:\.\d+)?)*$/.test(d),
          allPointsOnGrid: points.every(point => onGrid(point.x) && onGrid(point.y)),
          allSegmentsOrthogonal: points.slice(1).every((point, index) => {
            const previous = points[index];
            return point.x === previous.x || point.y === previous.y;
          })
        };
      }),
      pins: [...document.querySelectorAll(".edge-pin[data-edge-id]")].map(pin => ({
        id: pin.dataset.edgeId,
        side: pin.dataset.edgePin,
        x: Number.parseFloat(pin.getAttribute("cx")),
        y: Number.parseFloat(pin.getAttribute("cy")),
        fill: getComputedStyle(pin).fill,
        stroke: getComputedStyle(pin).stroke
      })),
      portSlots: [...document.querySelectorAll(".port-slot")].map(slot => {
        const node = slot.closest(".node");
        const nodeStyle = getComputedStyle(node);
        const left = Number.parseFloat(node.style.left);
        const top = Number.parseFloat(node.style.top);
        const width = Number.parseFloat(node.style.width);
        const localY = Number.parseFloat(slot.style.top);
        const side = slot.dataset.portSlot;
        return {
          id: slot.dataset.edgeId,
          nodeId: node.dataset.id,
          side,
          x: side === "out" ? left + width : left,
          y: top + localY,
          fill: getComputedStyle(slot).backgroundColor,
          zIndex: Number.parseInt(getComputedStyle(slot).zIndex, 10) || 0,
          width: Number.parseFloat(node.style.width || nodeStyle.width)
        };
      }),
      arrows: [...document.querySelectorAll(".edge-arrow[data-edge-id]")].map(arrow => ({
        id: arrow.dataset.edgeId,
        fill: getComputedStyle(arrow).fill,
        stroke: getComputedStyle(arrow).stroke,
        d: arrow.getAttribute("d") || "",
        points: pointsFromPath(arrow.getAttribute("d") || "")
      }))
    };
  }, GRID_SIZE);
}

function segmentIntersectsNode(segment, node, margin = 0) {
  const x1 = node.left - margin;
  const x2 = node.left + node.width + margin;
  const y1 = node.top - margin;
  const y2 = node.top + node.height + margin;
  if (segment.orientation === "horizontal") {
    return segment.coordinate > y1 &&
      segment.coordinate < y2 &&
      Math.max(segment.min, x1) < Math.min(segment.max, x2);
  }
  return segment.coordinate > x1 &&
    segment.coordinate < x2 &&
    Math.max(segment.min, y1) < Math.min(segment.max, y2);
}

function userTransitions(model) {
  return model.transitions.filter(transition =>
    !transition.boundaryFlow &&
    !String(transition.from || "").startsWith("proxy:") &&
    !String(transition.to || "").startsWith("proxy:")
  );
}

test.describe("State Blueprint tool", () => {
  test("creates a complete Zustandsdiagramm from the UI with data, templates, conditions, sets, preview, and export", async ({ page }) => {
    await openTool(page);
    await page.locator("#btnNew").click();
    await page.getByRole("button", { name: "Neu starten" }).click();

    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(1);
    await expect(page.locator(".node.boundary-proxy")).toHaveCount(2);
    await expect(page.locator('[data-id="start"]')).toBeVisible();

    await page.locator('[data-id="start"]').click();
    await page.locator("#pTitle").fill("Collect details");
    await openInitialValuesEditor(page);
    await page.locator("#pData").fill('{"userName":"Ada","profile":{"tier":"starter"}}');
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.id === "start").data.profile?.tier;
    }).toBe("starter");

    await openStateLayer(page, "start");
    await addComponentState(page, "Heading");
    await componentEditor(page, "Heading").locator("input").fill("Welcome {{userName}}");
    await addComponentState(page, "Text");
    await componentEditor(page, "Text").locator("textarea").fill("Tier: {{profile.tier}}");
    await addComponentState(page, "List");
    const listInputs = componentEditor(page, "List").locator(".list-item-editor input");
    await listInputs.nth(0).fill("Confirm email");
    await listInputs.nth(1).fill("Accept terms");
    await addComponentState(page, "Link");
    await componentEditor(page, "Link").locator("input").nth(0).fill("Example docs for {{userName}}");
    await componentEditor(page, "Link").locator("input").nth(1).fill("https://example.com/docs");
    await expect.poll(async () => {
      const model = await savedModel(page);
      const linkState = model.states.find(state => state.parentId === "start" && state.title === "Link");
      return linkState?.components.find(component => component.type === "link")?.url;
    }).toBe("https://example.com/docs");
    await addComponentState(page, "Note");
    await componentEditor(page, "Note").locator("textarea").fill("Stored from state.data: {{userName}}");
    await page.keyboard.press("Alt+ArrowLeft");

    const startPort = await centerOf(statePort(page, "start", "out"));
    const map = await page.locator("#map").boundingBox();
    await page.mouse.move(startPort.x, startPort.y);
    await page.mouse.down();
    await page.mouse.move(map.x + 430, map.y + 230, { steps: 12 });
    await page.mouse.up();

    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(2);
    await expect(page.locator(".node.boundary-proxy")).toHaveCount(2);
    const createdTransitionId = await page.evaluate(key => {
      const stored = JSON.parse(localStorage.getItem(`${key}.editor`) || localStorage.getItem(key) || "null");
      const model = stored?.model || stored;
      return model.transitions.find(transition => transition.from === "start" && !String(transition.to || "").startsWith("proxy:"))?.id || "";
    }, STORAGE_KEY);
    expect(createdTransitionId).toBeTruthy();
    await page.keyboard.press("Escape");
    await clickTransitionById(page, createdTransitionId);
    await page.locator("#pLabel").fill("Submit");
    await page.locator("#pTransitionConditionCard > summary").click();
    await page.locator("#pCond").fill('email == "ada@example.com" && accepted_terms');
    await page.locator("#pSetVariableName").fill("userName");
    await page.locator("#pSetVariableAdd").click();
    await page.locator('.state-variable-row[data-transition-set-path="userName"] [data-transition-set-value="true"]').fill("Grace");
    await page.locator("#pSetVariableName").fill("role");
    await page.locator("#pSetVariableAdd").click();
    await page.locator('.state-variable-row[data-transition-set-path="role"] [data-transition-set-value="true"]').fill("member");

    const createdStateId = await page.evaluate(key => {
      const stored = JSON.parse(localStorage.getItem(`${key}.editor`) || localStorage.getItem(key) || "null");
      const model = stored?.model || stored;
      return model.states.find(state => !state.parentId && state.id !== "start").id;
    }, STORAGE_KEY);

    await page.locator(`[data-id="${createdStateId}"]`).click();
    await page.locator("#pTitle").fill("Lesson ready");
    await openStateLayer(page, createdStateId);
    await addComponentState(page, "Note");
    await componentEditor(page, "Note").locator("textarea").fill("Ready for {{userName}} as {{role}}");
    await page.keyboard.press("Alt+ArrowLeft");

    const app = appFrame(page);
    await page.locator(`[data-id="${createdStateId}"]`).click();
    await expect(app.locator("#statePill")).toHaveText(createdStateId);
    await page.locator('[data-id="start"]').click();
    await expect(app.locator("#statePill")).toHaveText("start");
    await expect(app.getByText("Welcome Ada")).toBeVisible();
    await expect(app.getByText("Tier: starter")).toBeVisible();
    await expect(app.getByText("Stored from state.data: Ada")).toBeVisible();
    await expect(app.getByRole("link", { name: "Example docs for Ada" })).toHaveAttribute("href", "https://example.com/docs");

    await app.getByRole("button", { name: "Submit" }).click();
    await expect(app.locator("#statePill")).toHaveText("start");
    await expect(app.locator(".action.invalid").filter({ hasText: "Submit" }).locator(".condition-feedback"))
      .toContainText("Condition not met");

    await app.locator(".field").filter({ hasText: "email" }).locator("input").fill("ada@example.com");
    await app.locator(".field").filter({ hasText: "accepted_terms" }).locator(".switch").click();
    await app.getByRole("button", { name: "Submit" }).click();

    await expect(app.locator("#statePill")).toHaveText(createdStateId);
    await expect(app.getByText("Ready for Grace as member")).toBeVisible();

    const model = await savedModel(page);
    const start = model.states.find(state => state.id === "start");
    const done = model.states.find(state => state.id === createdStateId);
    const transition = model.transitions.find(item => item.from === "start" && item.to === createdStateId);
    expect(start.data.userName).toBe("Ada");
    expect(start.data.profile.tier).toBe("starter");
    expect(model.states.filter(state => state.parentId === "start").map(state => state.components[0]?.type)).toEqual(["heading", "text", "list", "link", "note"]);
    expect(model.states.find(state => state.parentId === done.id && state.title === "Note").components[0].text).toBe("Ready for {{userName}} as {{role}}");
    expect(transition.label).toBe("Submit");
    expect(transition.condition).toBe('email == "ada@example.com" && accepted_terms');
    expect(transition.set).toEqual({ userName: "Grace", role: "member" });

    const saveDownload = page.waitForEvent("download");
    await page.keyboard.press("Control+S");
    const definitionDownload = await saveDownload;
    const definition = JSON.parse(fs.readFileSync(await definitionDownload.path(), "utf8"));
    expect(definition.model.states.find(state => state.id === "start").data.userName).toBe("Ada");
    expect(definition.model.transitions.find(item => item.label === "Submit").set.role).toBe("member");
  });

  test("renders state data defaults and transition set data in templates", async ({ page }) => {
    const model = {
      version: 2,
      name: "Data Flow",
      initial: "login",
      states: [
        {
          id: "login",
          title: "Login",
          body: "",
          x: 120,
          y: 140,
          data: { userName: "Ada" },
          components: [{ id: "c_welcome", type: "text", text: "Welcome {{userName}}", url: "" }]
        },
        {
          id: "logged_in",
          title: "Logged in",
          body: "",
          x: 430,
          y: 140,
          data: {},
          components: [{ id: "c_done", type: "note", text: "Signed in as {{userName}} with role {{role}}", url: "" }]
        }
      ],
      transitions: [
        {
          id: "t_login",
          from: "login",
          to: "logged_in",
          label: "Einloggen",
          condition: "email == \"user@example.com\" && password == \"secret123\"",
          set: { userName: "Grace", role: "admin" }
        }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");

    const app = appFrame(page);
    await expect(page.locator('[data-id="login"]')).toBeVisible();
    await expect(app.locator("#statePill")).toHaveText("login");
    await expect(app.getByText("Welcome Ada")).toBeVisible();

    await app.locator(".field").filter({ hasText: "email" }).locator("input").fill("user@example.com");
    await app.locator(".field").filter({ hasText: "password" }).locator("input").fill("secret123");
    await app.getByRole("button", { name: "Einloggen" }).click();

    await expect(app.locator("#statePill")).toHaveText("logged_in");
    await expect(app.getByText("Signed in as Grace with role admin")).toBeVisible();

    const saveDownload = page.waitForEvent("download");
    await page.keyboard.press("Control+S");
    const definitionDownload = await saveDownload;
    const definition = JSON.parse(fs.readFileSync(await definitionDownload.path(), "utf8"));
    expect(definition.model.states.find(state => state.id === "login").data.userName).toBe("Ada");
    expect(definition.model.transitions.find(transition => transition.id === "t_login").set.role).toBe("admin");
  });

  test("state initial values expose typed variables as a scoped global state view", async ({ page }) => {
    const model = defaultTestModel();
    const login = model.states.find(state => state.id === "login");
    login.data = { email: "user@example.com", password: "secret123" };
    login.dataTypes = { email: "email", password: "password" };

    await openTool(page, { model });
    await openStateInspector(page, "login");
    await openInitialValuesEditor(page);

    const emailRow = page.locator('.state-variable-row[data-variable-path="email"]');
    const passwordRow = page.locator('.state-variable-row[data-variable-path="password"]');
    await expect(emailRow.locator('[data-state-variable-name="true"]')).toHaveValue("email");
    await expect(emailRow.locator('[data-state-variable-type="true"]')).toHaveValue("email");
    await expect(emailRow.locator('[data-state-variable-value="true"]')).toHaveValue("user@example.com");
    await expect(passwordRow.locator('[data-state-variable-name="true"]')).toHaveValue("password");
    await expect(passwordRow.locator('[data-state-variable-type="true"]')).toHaveValue("password");
    await expect(passwordRow.locator('[data-state-variable-value="true"]')).toHaveValue("secret123");
    await expect(page.locator("#pData")).toHaveValue(/"email": "user@example.com"/);

    await page.locator("#pStateVariableName").fill("avatar");
    await page.locator("#pStateVariableType").selectOption("image");
    await page.locator("#pStateVariableAdd").click();

    const avatarRow = page.locator('.state-variable-row[data-variable-path="states.login.avatar"]');
    await expect(avatarRow.locator('[data-state-variable-name="true"]')).toHaveValue("avatar");
    await expect(avatarRow.locator('[data-state-variable-type="true"]')).toHaveValue("image");
    await avatarRow.locator('[data-state-variable-value="true"]').fill("https://example.com/avatar.png");

    await expect.poll(async () => {
      const saved = await savedModel(page);
      const state = saved.states.find(item => item.id === "login");
      return {
        data: state?.data,
        dataTypes: state?.dataTypes
      };
    }).toEqual({
      data: {
        email: "user@example.com",
        password: "secret123",
        "states.login": {
          avatar: "https://example.com/avatar.png"
        }
      },
      dataTypes: {
        email: "email",
        password: "password",
        "states.login.avatar": "image"
      }
    });
  });

  test("state explorer promotes known bus paths to typed own variables without local state @smoke", async ({ page }) => {
    await openTool(page);
    const app = appFrame(page);
    await app.getByRole("button", { name: "Login" }).click();
    await app.locator(".field").filter({ hasText: "email" }).locator("input").fill("user@example.com");

    await openStateInspector(page, "login");
    await openInspectorDetails(page, "#pDataCard");

    const emailCard = page.locator('#pSubscriptionPaths .global-state-key-card[data-path="email"]').first();
    await expect(emailCard).toBeVisible();
    await expect(emailCard.locator(".global-state-key-meta")).toContainText("E-Mail");
    await expect(emailCard.locator(".global-state-key-meta")).not.toContainText("preview");
    await emailCard.getByRole("button", { name: "Variable" }).click();

    const emailRow = page.locator('.state-variable-row[data-variable-path="states.login.email"]');
    await expect(emailRow.locator('[data-state-variable-name="true"]')).toHaveValue("email");
    await expect(emailRow.locator('[data-state-variable-type="true"]')).toHaveValue("email");
    await expect(emailRow.locator('[data-state-variable-value="true"]')).toHaveValue("user@example.com");

    await expect.poll(async () => {
      const saved = await savedModel(page);
      const state = saved.states.find(item => item.id === "login");
      return {
        data: state?.data,
        dataTypes: state?.dataTypes,
        subscriptions: state?.subscriptions || [],
        dataWires: state?.dataWires || []
      };
    }).toEqual({
      data: { "states.login": { email: "user@example.com" } },
      dataTypes: { "states.login.email": "email" },
      subscriptions: [],
      dataWires: []
    });

    await expect(page.locator('#pSubscriptionPaths .global-state-key-card[data-path="email"]').first().getByRole("button", { name: "Variable" })).toHaveCount(0);
  });

  test("state and transition editors hide raw bus jargon from the main workflow @smoke", async ({ page }) => {
    await openTool(page);
    await openStateInspector(page, "login");
    await openInspectorDetails(page, "#pDataCard");

    const inspector = page.locator("#stateInspectorBody");
    await expect(inspector).toContainText("Sichtbare Felder");
    await expect(inspector).toContainText("Daten laden");
    await expect(inspector).toContainText("Liste anzeigen");
    await expect(inspector).not.toContainText(/globalState|React|Watch|Own var/i);
    await expect(page.locator("#pData")).toBeHidden();

    const currentScreenCard = page.locator('#pSubscriptionPaths .global-state-key-card[data-path="state.current"]').first();
    await expect(currentScreenCard).toContainText("Aktueller Zustand");
    await expect(currentScreenCard.locator(".global-state-key-path")).toHaveText("Aktiver Zustand");
    await expect(currentScreenCard).toContainText("Text");
    await expect(currentScreenCard).not.toContainText(/state\.current|runtime|mapped|already|shown|live update|saved|app flow/i);

    await page.keyboard.press("Escape");
    await page.locator("svg text.edge-label").filter({ hasText: /^Einloggen/ }).click();
    await expect(page.locator("#stateInspectorBody")).toContainText("Startet wenn");
    await expect(page.locator("#stateInspectorBody")).toContainText("Regel");
    await expect(page.locator("#stateInspectorBody")).toContainText("Werte schreiben");
    await expect(page.locator("#pSetVariableName")).toBeVisible();
    await expect(page.locator("#pSet")).toBeHidden();
    await expect(page.locator("#pCond")).toBeHidden();

    const currentRuleOption = page.locator('#pRuleField option[value="state.current"]');
    await expect(currentRuleOption).toHaveText("Aktueller Zustand");
    await expect(page.locator("#pRuleField")).not.toContainText(/state\.current|runtime|mapped/i);
  });

  test("state data defaults flow through the global bus and match change transitions @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "Bus Matching",
      initial: "seed",
      states: [
        {
          id: "seed",
          title: "Seed",
          body: "",
          x: 120,
          y: 140,
          data: { ready: true },
          subscriptions: ["ready"],
          components: [{ id: "seed_text", type: "text", text: "Waiting for ready", url: "" }]
        },
        {
          id: "matched",
          title: "Matched",
          body: "",
          x: 480,
          y: 140,
          data: {},
          components: [{ id: "matched_text", type: "note", text: "Ready constellation matched", url: "" }]
        }
      ],
      transitions: [
        {
          id: "ready_change",
          from: "seed",
          to: "matched",
          label: "Ready",
          condition: "ready",
          set: {},
          triggerType: "change",
          triggerEvent: "change.ready"
        }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");

    const app = appFrame(page);
    await expect(page.locator('[data-id="seed"]')).toBeVisible();
    await expect(app.locator("#statePill")).toHaveText("matched");
    await expect(app.getByText("Ready constellation matched")).toBeVisible();
  });

  test("state data defaults enter the runtime bus only on active state entry and never overwrite existing keys @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "State data entry contract",
      initial: "start",
      states: [
        {
          id: "start",
          title: "Start",
          body: "",
          x: 120,
          y: 140,
          data: { startOnly: "start-default", shared: "start-default" },
          components: [{ id: "c_start", type: "text", text: "Start {{startOnly}} {{shared}}", url: "" }]
        },
        {
          id: "next",
          title: "Next",
          body: "",
          x: 480,
          y: 140,
          data: { nextOnly: "next-default", shared: "next-default" },
          components: [{ id: "c_next", type: "note", text: "Next {{startOnly}} {{nextOnly}} {{shared}}", url: "" }]
        }
      ],
      transitions: [
        { id: "go_next", from: "start", to: "next", label: "Go", condition: "", set: { shared: "transition-set" } }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");

    const app = appFrame(page);
    await expect(page.locator('[data-id="start"]')).toBeVisible();
    await expect(app.locator("#statePill")).toHaveText("start");
    await expect(app.getByText("Start start-default start-default")).toBeVisible();
    await expect.poll(async () => {
      const context = await runtimeContext(page);
      return {
        startOnly: context.startOnly,
        nextOnly: context.nextOnly,
        shared: context.shared
      };
    }).toEqual({
      startOnly: "start-default",
      nextOnly: undefined,
      shared: "start-default"
    });

    await app.getByRole("button", { name: "Go" }).click();
    await expect(app.locator("#statePill")).toHaveText("next");
    await expect(app.getByText("Next start-default next-default transition-set")).toBeVisible();
    await expect.poll(async () => {
      const context = await runtimeContext(page);
      return {
        startOnly: context.startOnly,
        nextOnly: context.nextOnly,
        shared: context.shared
      };
    }).toEqual({
      startOnly: "start-default",
      nextOnly: "next-default",
      shared: "transition-set"
    });
  });

  test("state explorer preset data stays outside the runtime bus until the preset becomes a canvas state @smoke", async ({ page }) => {
    await openTool(page, {
      stateTemplates: [{
        id: "tpl_runtime_contract",
        rootStateId: "tpl_runtime_contract",
        title: "Runtime contract preset",
        body: "",
        components: [{ id: "tpl_contract_text", type: "text", text: "Preset value {{presetOnly}}", url: "" }],
        data: { presetOnly: "from-preset-template" },
        states: [],
        transitions: []
      }]
    });

    await expect(page.locator(".state-template-card").filter({ hasText: "Runtime contract preset" })).toBeVisible();
    await expect.poll(async () => {
      const templates = await savedStateTemplates(page);
      const context = await runtimeContext(page);
      return {
        templateData: templates[0]?.data?.presetOnly,
        runtimeValue: context.presetOnly
      };
    }).toEqual({
      templateData: "from-preset-template",
      runtimeValue: undefined
    });

    await page.locator(".state-template-card").filter({ hasText: "Runtime contract preset" }).getByRole("button", { name: "Verwenden" }).click();
    await expect(page.locator("#pTitle")).toHaveValue("Runtime contract preset");
    await expect(appFrame(page).getByText("Preset value from-preset-template")).toBeVisible();
    await expect.poll(async () => (await runtimeContext(page)).presetOnly).toBe("from-preset-template");
  });

  test("child states render as closed flow steps unless explicitly marked as parent components @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "Closed Child Render Contract",
      initial: "shell",
      states: [
        {
          id: "shell",
          title: "Shell",
          body: "",
          x: 120,
          y: 160,
          data: { shellOnly: "shell-default" },
          components: [{ id: "shell_text", type: "text", text: "Parent shell {{shellOnly}}", url: "" }]
        },
        {
          id: "inline_component",
          parentId: "shell",
          title: "Inline component",
          body: "",
          renderMode: "component",
          x: 120,
          y: 120,
          data: { inlineOnly: "inline-default" },
          components: [{ id: "inline_text", type: "note", text: "Inline block {{inlineOnly}}", url: "" }]
        },
        {
          id: "child_step",
          parentId: "shell",
          title: "Child step",
          body: "",
          x: 420,
          y: 120,
          data: { childOnly: "child-default" },
          components: [{ id: "child_text", type: "text", text: "Child step body {{childOnly}}", url: "" }]
        }
      ],
      transitions: []
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");

    const app = appFrame(page);
    await expect(page.locator('[data-id="shell"]')).toBeVisible();
    await expect(app.locator("#statePill")).toHaveText("shell");
    await expect(app.getByText("Parent shell shell-default")).toBeVisible();
    await expect(app.getByText("Inline block inline-default")).toBeVisible();
    await expect(app.getByText("Child step body child-default")).toHaveCount(0);
    await expect(app.getByRole("button", { name: "Child step" })).toBeVisible();
    await expect.poll(async () => {
      const context = await runtimeContext(page);
      return {
        shellOnly: context.shellOnly,
        inlineOnly: context.inlineOnly,
        childOnly: context.childOnly
      };
    }).toEqual({
      shellOnly: "shell-default",
      inlineOnly: "inline-default",
      childOnly: undefined
    });

    await app.getByRole("button", { name: "Child step" }).click();
    await expect(app.locator("#statePill")).toHaveText("child_step");
    await expect(app.getByText("Child step body child-default")).toBeVisible();
    await expect(app.getByText("Parent shell shell-default")).toHaveCount(0);
    await expect(app.getByText("Inline block inline-default")).toHaveCount(0);
    await expect.poll(async () => (await runtimeContext(page)).childOnly).toBe("child-default");
  });

  test("transition bus key cards set change triggers and filters without mutating subscriptions @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "Transition Bus Key Editor",
      initial: "start",
      states: [
        {
          id: "start",
          title: "Start",
          body: "",
          x: 120,
          y: 180,
          data: { ready: false },
          components: [{ id: "c_start", type: "text", text: "Waiting", url: "" }]
        },
        {
          id: "done",
          title: "Done",
          body: "",
          x: 430,
          y: 180,
          components: [{ id: "c_done", type: "text", text: "Done", url: "" }]
        }
      ],
      transitions: [
        { id: "start_done", from: "start", to: "done", label: "Continue", condition: "", triggerType: "button", triggerEvent: "", set: {} }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    await expect(page.locator('[data-id="start"]')).toBeVisible();

    await page.locator("svg text.edge-label").filter({ hasText: "Continue" }).click();
    await page.locator("#pTriggerType").selectOption("change");
    await page.locator("#pRuleField").selectOption("ready");
    await expect(page.locator("#pRuleOperator")).toHaveValue("true");
    await page.locator("#pRuleApply").click();
    await expect(page.locator("#pTriggerType")).toHaveValue("change");
    await expect(page.locator("#pTriggerEvent")).toHaveValue("change.ready");
    await expect(page.locator("#pRulePreview")).toContainText("Ready checked");

    const stored = await savedModel(page);
    const transition = stored.transitions.find(item => item.id === "start_done");
    const start = stored.states.find(item => item.id === "start");
    expect(transition).toMatchObject({
      triggerType: "change",
      triggerEvent: "change.ready",
      condition: "ready == true"
    });
    expect(start.subscriptions || []).toEqual([]);
  });

  test("builds typed transition rules without editing raw data paths @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "Typed Regels",
      initial: "start",
      states: [
        {
          id: "start",
          title: "Media form",
          body: "",
          x: 120,
          y: 180,
          data: {
            accepted: false,
            heroImage: "",
            ctaUrl: "",
            score: 0
          },
          dataTypes: {
            accepted: "boolean",
            heroImage: "image",
            ctaUrl: "url",
            score: "number"
          },
          components: [{ id: "c_start", type: "text", text: "Media setup", url: "" }]
        },
        {
          id: "done",
          title: "Done",
          body: "",
          x: 430,
          y: 180,
          components: [{ id: "c_done", type: "text", text: "Done", url: "" }]
        }
      ],
      transitions: [
        { id: "start_done", from: "start", to: "done", label: "Continue", condition: "", triggerType: "button", triggerEvent: "", set: {} }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    await expect(page.locator('[data-id="start"]')).toBeVisible();

    await page.locator("svg text.edge-label").filter({ hasText: "Continue" }).click();
    await expect(page.locator("#pCond")).toBeHidden();
    await expect(page.locator('#pRuleField option[value="accepted"]')).toHaveText("Accepted");
    await expect(page.locator('#pRuleField option[value="heroImage"]')).toHaveText("Hero Image");
    await expect(page.locator('#pRuleField option[value="ctaUrl"]')).toHaveText("Cta Url");
    await expect(page.locator("#pRuleField")).not.toContainText(/states\.|global|json|bus/i);

    await page.locator("#pRuleField").selectOption("accepted");
    await expect(page.locator("#pRuleOperator")).toHaveValue("true");
    await page.locator("#pRuleApply").click();
    await expect.poll(async () => (await savedModel(page)).transitions.find(item => item.id === "start_done").condition)
      .toBe("accepted == true");

    await page.locator("#pRuleField").selectOption("heroImage");
    await expect(page.locator("#pRuleOperator")).toHaveValue("filled");
    await expect(page.locator("#pRuleOperator option:checked")).toHaveText("Image is set");
    await page.locator("#pRuleApply").click();
    await expect.poll(async () => (await savedModel(page)).transitions.find(item => item.id === "start_done").condition)
      .toBe('heroImage != ""');

    await page.locator("#pRuleField").selectOption("ctaUrl");
    await expect(page.locator("#pRuleOperator option:checked")).toHaveText("Link is set");
    await page.locator("#pRuleApply").click();
    await expect.poll(async () => (await savedModel(page)).transitions.find(item => item.id === "start_done").condition)
      .toBe('ctaUrl != ""');

    await page.locator("#pRuleField").selectOption("score");
    await page.locator("#pRuleOperator").selectOption("gte");
    await page.locator("#pRuleValue").fill("3");
    await page.locator("#pRuleApply").click();
    await expect.poll(async () => (await savedModel(page)).transitions.find(item => item.id === "start_done").condition)
      .toBe("score >= 3");
  });

  test("drops unsupported body fields instead of remapping them into render state", async ({ page }) => {
    const unsupportedModel = {
      version: 2,
      name: "Unsupported body flow",
      initial: "unsupported_body",
      states: [
        { id: "unsupported_body", title: "Unsupported", body: "Unsupported screen body", components: [], data: {}, x: 120, y: 140 }
      ],
      transitions: []
    };
    const unsupportedTemplates = [
      { id: "tpl_unsupported_body", title: "Unsupported preset", body: "Unsupported preset body", components: [], data: {} }
    ];

    await page.addInitScript(({ key, model, templates }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.setItem(`${key}.stateExplorer`, JSON.stringify(templates));
    }, { key: STORAGE_KEY, model: unsupportedModel, templates: unsupportedTemplates });

    await page.goto("/state.html");
    await page.locator('[data-id="unsupported_body"]').click();
    await expect(componentEditor(page, "Text")).toHaveCount(0);
    await expect(appFrame(page).getByText("Unsupported screen body")).toHaveCount(0);
    await expect.poll(async () => {
      const model = await savedModel(page);
      const state = model.states.find(item => item.id === "unsupported_body");
      return {
        hasBody: Object.prototype.hasOwnProperty.call(state, "body"),
        components: state.components
      };
    }).toEqual({ hasBody: false, components: [] });

    const preset = page.locator(".state-template-card").filter({ hasText: "Unsupported preset" });
    await expect(preset).not.toContainText("Unsupported preset body");
    await preset.click();
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Vorlage: Unsupported preset");
    await expect(componentEditor(page, "Text")).toHaveCount(0);
    await expect.poll(async () => {
      const templates = await savedStateTemplates(page);
      return {
        hasBody: Object.prototype.hasOwnProperty.call(templates[0], "body"),
        components: templates[0].components
      };
    }).toEqual({ hasBody: false, components: [] });
  });

  test("navigates into nested state canvases and keeps child states inside their parent @smoke", async ({ page }) => {
    await openTool(page);
    await expect(page.locator("#layerFrame")).toBeVisible();
    await expect(page.locator("#layerFrameLabel")).toHaveText("Wurzel");

    await openStateLayer(page, "login");
    const childId = await addChildByDoubleClick(page, "login");
    await openStateInspector(page, childId);

    await expect(page.locator("#layerNav")).toBeHidden();
    await expect(page.locator("#layerFrame")).toBeVisible();
    await expect(page.locator("#layerFrameLabel")).toHaveText("In Login");
    await expect(page.locator("#layerBack")).toBeVisible();
    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(1);
    await expect(page.locator(".node.boundary-proxy")).toHaveCount(2);

    await expect(page.locator("#pTitle")).toBeVisible();
    await page.locator("#pTitle").fill("Email step");
    await expect(page.locator(`[data-id="${childId}"] .title`)).toHaveText("Email step");

    await expect.poll(async () => {
      const model = await savedModel(page);
      const child = model.states.find(state => state.id === childId);
      return {
        childParent: child?.parentId,
        rootCount: model.states.filter(state => !state.parentId).length,
        childCount: model.states.filter(state => state.parentId === "login").length
      };
    }).toEqual({ childParent: "login", rootCount: 6, childCount: 1 });
    const childFlow = await gridGeometryReport(page);
    const childNode = childFlow.nodes.find(node => node.id === childId);
    expect(childNode.overflow).toBe("visible");
    expect(childNode.isolation).toBe("isolate");

    await page.locator("#layerBack").click();
    await expect(page.locator("#layerFrame")).toBeVisible();
    await expect(page.locator("#layerFrameLabel")).toHaveText("Wurzel");
    await expect(page.locator('[data-id="login"] .layer-badge')).toHaveText("1 state");
    await expect(page.locator(`[data-id="${childId}"]`)).toHaveCount(0);
    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(6);

    await openStateLayer(page, "login");
    await expect(page.locator("#layerFrameLabel")).toHaveText("In Login");
    await expect(page.locator(`[data-id="${childId}"] .title`)).toHaveText("Email step");
    await expect(page.locator(".node")).toHaveCount(3);
  });

  test("opens nested state canvases with a node double click @smoke", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"]').click();
    await expect(page.locator("#pEnterLayer")).toHaveCount(0);
    await openStateLayer(page, "login");
    await expect(page.locator("#layerFrameLabel")).toHaveText("In Login");
    await expect(page.locator("#layerBack")).toBeVisible();
  });

  test("keeps root boundary proxy dots enabled without forcing a boundary flow @smoke", async ({ page }) => {
    const rootFlowModel = boundary => ({
      version: 2,
      name: "Root Boundary Contract",
      initial: "left",
      ...(boundary ? { boundary } : {}),
      states: [
        { id: "left", title: "Left", body: "", components: [], x: 96, y: 192 },
        { id: "right", title: "Right", body: "", components: [], x: 504, y: 192 }
      ],
      transitions: [
        { id: "left_to_right", from: "left", to: "right", label: "Next", condition: "", set: {} }
      ]
    });

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model: rootFlowModel(null) });
    await page.goto("/state.html");

    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(2);
    await expect(page.locator(".node.boundary-proxy")).toHaveCount(2);
    await expect(page.locator('.node.boundary-input[data-id="proxy:__root__:input:__boundary_input"]')).toHaveCount(1);
    await expect(page.locator('.node.boundary-output[data-id="proxy:__root__:output:__boundary_output"]')).toHaveCount(1);
    await expect(page.locator('.edge[data-edge-id="left_to_right"]')).toHaveCount(1);
    await expect(page.locator('.edge[data-edge-id="boundary-flow:__root__:input"]')).toHaveCount(0);
    await expect(page.locator('.edge[data-edge-id="boundary-flow:__root__:output"]')).toHaveCount(0);
    await expect(page.locator('svg#ports .svg-port[data-state-id="proxy:__root__:input:__boundary_input"][data-port-side="out"]')).toHaveCount(1);
    await expect(page.locator('svg#ports .svg-port[data-state-id="proxy:__root__:output:__boundary_output"][data-port-side="in"]')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => ({
      entryId: model.boundary?.entryId || "",
      exitId: model.boundary?.exitId || "",
      inputFlow: model.transitions.some(transition => transition.id === "boundary-flow:__root__:input" && transition.from === "proxy:__root__:input:__boundary_input"),
      outputFlow: model.transitions.some(transition => transition.id === "boundary-flow:__root__:output" && transition.to === "proxy:__root__:output:__boundary_output")
    }))).toEqual({ entryId: "", exitId: "", inputFlow: false, outputFlow: false });

    await page.evaluate(model => loadEditorModel(model, false), rootFlowModel({
      entryId: "",
      exitId: "",
      entryDisabled: true,
      exitDisabled: true
    }));
    await expect(page.locator(".node")).toHaveCount(2);
    await expect(page.locator(".node.boundary-proxy")).toHaveCount(0);
    await expect(page.locator('.edge[data-edge-id="left_to_right"]')).toHaveCount(1);
    await expect(page.locator('[data-edge-id^="boundary-flow:"]')).toHaveCount(0);
  });

  test("wires root boundary proxy dots to the first fresh state @smoke", async ({ page }) => {
    await openTool(page);
    await page.locator("#btnNew").click();
    await page.getByRole("button", { name: "Neu starten" }).click();

    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(1);
    await expect(page.locator(".node.boundary-proxy")).toHaveCount(2);
    await expect(page.locator('.node.boundary-input[data-id="proxy:__root__:input:__boundary_input"]')).toHaveCount(1);
    await expect(page.locator('.node.boundary-output[data-id="proxy:__root__:output:__boundary_output"]')).toHaveCount(1);
    await expect(page.locator('.edge[data-edge-id="boundary-flow:__root__:input"]')).toHaveCount(1);
    await expect(page.locator('.edge[data-edge-id="boundary-flow:__root__:output"]')).toHaveCount(1);
    await expect(page.locator('svg#ports .svg-port[data-state-id="proxy:__root__:input:__boundary_input"][data-port-side="out"]')).toHaveCount(1);
    await expect(page.locator('svg#ports .svg-port[data-state-id="proxy:__root__:output:__boundary_output"][data-port-side="in"]')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => ({
      entryDisabled: Boolean(model.boundary?.entryDisabled),
      exitDisabled: Boolean(model.boundary?.exitDisabled),
      entryId: model.boundary?.entryId || "",
      exitId: model.boundary?.exitId || "",
      inputFlow: model.transitions.some(transition => transition.id === "boundary-flow:__root__:input" && transition.from === "proxy:__root__:input:__boundary_input" && transition.to === "start"),
      outputFlow: model.transitions.some(transition => transition.id === "boundary-flow:__root__:output" && transition.from === "start" && transition.to === "proxy:__root__:output:__boundary_output")
    }))).toEqual({ entryDisabled: false, exitDisabled: false, entryId: "start", exitId: "start", inputFlow: true, outputFlow: true });

    await page.evaluate(() => loadEditorModel(blankModel(), true));
    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(0);
    await expect(page.locator(".node.boundary-proxy")).toHaveCount(2);
    await expect(page.locator('.edge[data-edge-id="boundary-flow:__root__:input"]')).toHaveCount(0);
    await expect(page.locator('.edge[data-edge-id="boundary-flow:__root__:output"]')).toHaveCount(0);
    await expect(page.locator('svg#ports .svg-port[data-state-id="proxy:__root__:input:__boundary_input"][data-port-side="out"]')).toHaveCount(1);
    await expect(page.locator('svg#ports .svg-port[data-state-id="proxy:__root__:output:__boundary_output"][data-port-side="in"]')).toHaveCount(1);
    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(0);
    const point = await emptyCanvasPoint(page);
    await page.mouse.dblclick(point.x, point.y);

    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(1);
    await expect(page.locator(".node.boundary-proxy")).toHaveCount(2);
    await expect(page.locator('.edge[data-edge-id="boundary-flow:__root__:input"]')).toHaveCount(1);
    await expect(page.locator('.edge[data-edge-id="boundary-flow:__root__:output"]')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => ({
      entryDisabled: Boolean(model.boundary?.entryDisabled),
      exitDisabled: Boolean(model.boundary?.exitDisabled),
      stateIds: model.states.map(state => state.id),
      entryId: model.boundary?.entryId || "",
      exitId: model.boundary?.exitId || "",
      inputFlow: model.transitions.some(transition => transition.id === "boundary-flow:__root__:input" && transition.to === model.boundary?.entryId),
      outputFlow: model.transitions.some(transition => transition.id === "boundary-flow:__root__:output" && transition.from === model.boundary?.exitId)
    }))).toEqual({ entryDisabled: false, exitDisabled: false, stateIds: ["state_1"], entryId: "state_1", exitId: "state_1", inputFlow: true, outputFlow: true });
  });

  test("repairs stale child boundary endpoints when the first child state is created @smoke", async ({ page }) => {
    const staleBoundaryModel = {
      version: 2,
      name: "Stale Child Boundary",
      initial: "parent",
      states: [
        {
          id: "parent",
          title: "Parent",
          body: "",
          components: [],
          boundary: {
            entryId: "deleted_child",
            exitId: "deleted_child",
            entryDisabled: false,
            exitDisabled: false
          },
          x: 260,
          y: 180
        }
      ],
      transitions: []
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model: staleBoundaryModel });
    await page.goto("/state.html");

    await openStateLayer(page, "parent");
    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(0);
    await expect(page.locator(".node.boundary-proxy")).toHaveCount(2);

    const childId = await addChildByDoubleClick(page, "parent");
    const inputProxyId = "proxy:parent:input:__boundary_input";
    const outputProxyId = "proxy:parent:output:__boundary_output";

    await expect(page.locator(`.edge[data-edge-id="boundary-flow:parent:input"]`)).toHaveCount(1);
    await expect(page.locator(`.edge[data-edge-id="boundary-flow:parent:output"]`)).toHaveCount(1);
    await expect(page.locator(`svg#ports .svg-port[data-state-id="${inputProxyId}"][data-port-side="out"]`)).toHaveCount(1);
    await expect(page.locator(`svg#ports .svg-port[data-state-id="${outputProxyId}"][data-port-side="in"]`)).toHaveCount(1);
    await expect.poll(async () => {
      const model = await savedModel(page);
      const parent = model.states.find(state => state.id === "parent");
      const boundary = parent?.boundary || {};
      return {
        entryId: boundary.entryId || "",
        exitId: boundary.exitId || "",
        inputFlow: model.transitions.some(transition =>
          transition.id === "boundary-flow:parent:input" &&
          transition.from === inputProxyId &&
          transition.to === childId
        ),
        outputFlow: model.transitions.some(transition =>
          transition.id === "boundary-flow:parent:output" &&
          transition.from === childId &&
          transition.to === outputProxyId
        )
      };
    }).toEqual({
      entryId: childId,
      exitId: childId,
      inputFlow: true,
      outputFlow: true
    });
  });

  test("starts new canvases from the fresh starter flow without demo shortcuts @smoke", async ({ page }) => {
    await openTool(page);
    await expect(page.locator("#btnDemo")).toHaveCount(0);
    await expect(page.locator("#btnWebsiteExample")).toHaveText("Zustand Demo");

    await page.locator("#btnNew").click();
    await page.getByRole("button", { name: "Neu starten" }).click();
    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(1);
    await expect(page.locator('[data-id="start"]')).toBeVisible();
    await expect.poll(async () => {
      const model = await savedModel(page);
      return {
        name: model.name,
        initial: model.initial,
        stateIds: model.states.map(state => state.id),
        userTransitions: userTransitions(model).length,
        boundary: {
          entryId: model.boundary?.entryId || "",
          exitId: model.boundary?.exitId || ""
        },
        boundaryTransitions: model.transitions
          .filter(transition => transition.boundaryFlow?.parentId === "__root__")
          .map(transition => ({ id: transition.id, from: transition.from, to: transition.to, side: transition.boundaryFlow.side }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        hasDemoAuthData: JSON.stringify(model).includes("user@example.com") || JSON.stringify(model).includes("secret123")
      };
    }).toEqual({
      name: "Zustand",
      initial: "start",
      stateIds: ["start"],
      userTransitions: 0,
      boundary: { entryId: "start", exitId: "start" },
      boundaryTransitions: [
        { id: "boundary-flow:__root__:input", from: "proxy:__root__:input:__boundary_input", to: "start", side: "input" },
        { id: "boundary-flow:__root__:output", from: "start", to: "proxy:__root__:output:__boundary_output", side: "output" }
      ],
      hasDemoAuthData: false
    });
  });

  test("opens the new canvas modal with Ctrl+N instead of a browser tab @smoke", async ({ page, context }) => {
    await openTool(page);

    const expectNoNewBrowserPage = async action => {
      const pageOpened = context.waitForEvent("page", { timeout: 300 }).then(() => true).catch(() => false);
      await action();
      await expect(page.getByRole("dialog", { name: "Neue Arbeitsflaeche" })).toBeVisible();
      expect(await pageOpened).toBe(false);
    };

    await expectNoNewBrowserPage(() => page.keyboard.press("Control+N"));
    await page.getByRole("button", { name: "Abbrechen" }).click();
    await expect(page.getByRole("dialog", { name: "Neue Arbeitsflaeche" })).toBeHidden();

    await appFrame(page).locator("#screen").click();
    await expectNoNewBrowserPage(() => page.keyboard.press("Control+N"));
    await page.getByRole("button", { name: "Neu starten" }).click();

    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(1);
    await expect(page.locator('[data-id="start"]')).toBeVisible();
  });

  test("loads the Zustand demo scene from the editor entry URL when no scene is stored @smoke", async ({ page }) => {
    await page.addInitScript(key => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
    }, STORAGE_KEY);

    await page.goto("/state.html?demo=zustand");

    await expect(page).toHaveURL(/\/state\.html$/);
    await expect(page.getByRole("dialog", { name: "Zustand Demo" })).toBeHidden();
    await expect(page.locator('[data-id="site_home"]')).toBeVisible();
    await expect(appFrame(page).locator("#statePill")).toHaveText("site_home");
    await expect.poll(async () => {
      const model = await savedModel(page);
      return {
        name: model?.name || "",
        initial: model?.initial || "",
        loginHeroTransitionId: model?.states?.find(state => state.id === "site_login")?.data?.["states.site_login.hero"]?.transitionId || ""
      };
    }).toEqual({
      name: "Zustand Demo",
      initial: "site_home",
      loginHeroTransitionId: "site_login_submit"
    });
  });

  test("asks before replacing stored work from the demo entry URL @smoke", async ({ page }) => {
    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model: defaultTestModel() });

    await page.goto("/state.html?demo=zustand");

    await expect(page).toHaveURL(/\/state\.html$/);
    await expect(page.locator('[data-id="auth_start"]')).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Zustand Demo" })).toBeVisible();
    await expect.poll(async () => {
      const model = await savedModel(page);
      return {
        name: model?.name || "",
        initial: model?.initial || "",
        hasStoredWork: Boolean(model?.states?.some(state => state.id === "auth_start"))
      };
    }).toEqual({
      name: "Standard Auth Flow",
      initial: "auth_start",
      hasStoredWork: true
    });

    await page.getByRole("button", { name: "Demo laden" }).click();

    await expect(page.locator('[data-id="site_home"]')).toBeVisible();
    await expect(appFrame(page).locator("#statePill")).toHaveText("site_home");
    await expect.poll(async () => {
      const model = await savedModel(page);
      return {
        name: model?.name || "",
        initial: model?.initial || "",
        hasOldLocalModel: Boolean(model?.states?.some(state => state.id === "auth_start")),
        loginHeroTransitionId: model?.states?.find(state => state.id === "site_login")?.data?.["states.site_login.hero"]?.transitionId || ""
      };
    }).toEqual({
      name: "Zustand Demo",
      initial: "site_home",
      hasOldLocalModel: false,
      loginHeroTransitionId: "site_login_submit"
    });
  });

  test("loads a clean website demo scene with real FSM navigation @smoke", async ({ page }) => {
    await openTool(page);

    await page.locator("#topbarMore summary").click();
    await page.getByRole("button", { name: "Zustand Demo" }).click();
    await page.getByRole("button", { name: "Demo laden" }).click();

    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(8);
    await expect(page.locator('[data-id="site_home"]')).toBeVisible();
    await expect(page.locator('[data-id="site_login"]')).toBeVisible();
    await expect(page.locator('[data-id="site_profile"]')).toBeVisible();
    await expect(page.locator('[data-id="site_thanks"]')).toBeVisible();

    await expect.poll(async () => {
      const model = await savedModel(page);
      const loginState = model.states.find(state => state.id === "site_login");
      return {
        name: model.name,
        initial: model.initial,
        stateIds: model.states.map(state => state.id).sort(),
        userTransitions: userTransitions(model).length,
        loginHeroTransitionId: loginState?.data?.["states.site_login.hero"]?.transitionId || "",
        boundary: {
          entryId: model.boundary?.entryId || "",
          exitId: model.boundary?.exitId || ""
        },
        scopedDataOnly: model.states.every(state =>
          Object.keys(state.data || {}).every(key => key.startsWith(`states.${state.id}.`))
        ),
        hasOldAuthDemoData: JSON.stringify(model).includes("user@example.com") || JSON.stringify(model).includes("secret123")
      };
    }).toEqual({
      name: "Zustand Demo",
      initial: "site_home",
      stateIds: [
        "site_checkout",
        "site_checkout_flow",
        "site_contact",
        "site_features",
        "site_home",
        "site_login",
        "site_pricing",
        "site_profile",
        "site_thanks"
      ],
      userTransitions: 47,
      loginHeroTransitionId: "site_login_submit",
      boundary: { entryId: "site_home", exitId: "site_thanks" },
      scopedDataOnly: true,
      hasOldAuthDemoData: false
    });

    const [routeReport, routeModel, layerFrame] = await Promise.all([
      gridGeometryReport(page),
      savedModel(page),
      page.locator("#layerFrame").evaluate(el => ({
        left: Number.parseFloat(el.style.left),
        top: Number.parseFloat(el.style.top),
        right: Number.parseFloat(el.style.left) + Number.parseFloat(el.style.width),
        bottom: Number.parseFloat(el.style.top) + Number.parseFloat(el.style.height)
      }))
    ]);
    const internalTransitionIds = new Set(userTransitions(routeModel).map(transition => transition.id));
    const internalRouteViolations = routeReport.paths
      .filter(route => internalTransitionIds.has(route.id))
      .flatMap(route => route.points
        .filter(point =>
          point.x < layerFrame.left + GRID_SIZE / 2 ||
          point.x > layerFrame.right - GRID_SIZE / 2 ||
          point.y < layerFrame.top + GRID_SIZE / 2 ||
          point.y > layerFrame.bottom - GRID_SIZE / 2
        )
        .map(point => ({ id: route.id, point, frame: layerFrame }))
      );
    expect(internalRouteViolations).toEqual([]);
    const layerRouteViolations = routeReport.paths
      .flatMap(route => route.points
        .filter(point =>
          point.x < layerFrame.left - 0.5 ||
          point.x > layerFrame.right + 0.5 ||
          point.y < layerFrame.top - 0.5 ||
          point.y > layerFrame.bottom + 0.5
        )
        .map(point => ({ id: route.id, point, frame: layerFrame }))
      );
    expect(layerRouteViolations).toEqual([]);

    const app = appFrame(page);
    const expectedNavLabels = ["Zustand", "Start", "Nutzen", "Angebot", "Kontakt", "Konto"];
    const expectedTitles = {
      site_home: "Start",
      site_features: "Nutzen",
      site_pricing: "Angebot",
      site_checkout: "Anfrage",
      site_contact: "Kontakt",
      site_thanks: "Danke",
      site_login: "Konto",
      site_profile: "Profil"
    };
    const expectDemoShell = async stateId => {
      await expect.poll(async () => app.locator("body").evaluate(() => {
        const text = element => (element?.textContent || "").trim();
        return {
          state: text(document.querySelector("#statePill")),
          title: text(document.querySelector("#screen > h1")),
          navbarCount: document.querySelectorAll(".navbar").length,
          breadcrumbsCount: document.querySelectorAll(".breadcrumbs").length,
          footerHasBrand: text(document.querySelector(".footer")).includes("Zustand GmbH"),
          footerButtons: document.querySelectorAll(".footer button[data-transition-id]").length,
          navLabels: [...document.querySelectorAll(".navbar button,.navbar a")]
            .map(item => text(item))
            .filter(Boolean)
        };
      })).toEqual({
        state: stateId,
        title: expectedTitles[stateId],
        navbarCount: 1,
        breadcrumbsCount: 0,
        footerHasBrand: true,
        footerButtons: 5,
        navLabels: expectedNavLabels
      });
    };
    const navButton = label => app.locator(".navbar").getByRole("button", { name: label, exact: true });
    const expectNoHorizontalOverflow = async () => {
      await expect.poll(async () => app.locator("body").evaluate(body =>
        Math.round(body.scrollWidth - body.clientWidth)
      )).toBeLessThanOrEqual(2);
    };

    await expectDemoShell("site_home");
    await expect(app.getByRole("heading", { name: "Erst Klarheit. Dann digitalisieren.", exact: true })).toBeVisible();
    await expect(app.locator('.hero[style*="photo-1556761175-b413da4baf72"]')).toBeVisible();
    await expect(app.locator(".daisy-feature-grid")).toHaveCount(1);
    await expect(app.locator(".daisy-feature-cards > .card")).toHaveCount(3);
    await expect(app.locator(".daisy-feature-image")).toHaveCount(3);
    await expect.poll(async () => app.locator(".daisy-feature-image").evaluateAll(images =>
      images.map(image => image.getAttribute("src") || "")
    )).toEqual([
      expect.stringContaining("images.unsplash.com"),
      expect.stringContaining("images.unsplash.com"),
      expect.stringContaining("images.unsplash.com")
    ]);
    await expect(app.locator(".daisy-feature-grid button[data-transition-id]")).toHaveCount(3);
    await expectNoHorizontalOverflow();

    const homeTransitionIds = await app.locator(".daisy-transition-button[data-transition-id]").evaluateAll(buttons =>
      buttons.map(button => button.dataset.transitionId)
    );
    expect(homeTransitionIds.length).toBeGreaterThanOrEqual(7);
    await expect(app.locator(".actions [data-transition-id]")).toHaveCount(0);

    await app.locator('.footer button[data-transition-id="site_home_nav_pricing"]').click();
    await expectDemoShell("site_pricing");
    await navButton("Start").click();
    await expectDemoShell("site_home");

    await expect(navButton("Nutzen")).toHaveCount(1);
    await navButton("Nutzen").click();
    await expectDemoShell("site_features");
    await expect(app.getByText("Was Sie danach konkret besser koennen")).toBeVisible();
    await expect(app.getByText("Umsetzung bekommt Leitplanken")).toBeVisible();
    await expect(app.locator(".daisy-feature-grid")).toHaveCount(1);
    await expect(app.locator(".daisy-feature-cards > .card")).toHaveCount(3);
    await expect(app.locator(".daisy-feature-image")).toHaveCount(3);
    await expect(app.locator(".daisy-feature-grid button[data-transition-id]")).toHaveCount(3);
    await expect(app.locator(".steps button[data-transition-id] .daisy-step-label")).toHaveText([
      "Klaeren",
      "Modellieren",
      "Entscheiden"
    ]);
    await expect(app.locator(".steps .daisy-step-copy")).toContainText([
      "Den echten Ablauf mit Verantwortlichen aufnehmen.",
      "Zustaende, Daten und Ausloeser sichtbar verbinden.",
      "Budget, Umsetzung und naechste Schritte belastbar festlegen."
    ]);
    await expect(app.locator("li.step-primary")).toContainText("Modellieren");
    await expect(navButton("Nutzen")).toHaveCount(1);
    await expectNoHorizontalOverflow();

    await expect(navButton("Angebot")).toHaveCount(1);
    await navButton("Angebot").click();
    await expectDemoShell("site_pricing");
    await expect(app.getByText("Starten Sie dort, wo das Risiko am groessten ist")).toBeVisible();
    await expect(app.locator(".daisy-pricing")).toHaveCount(1);
    await expect(app.locator(".daisy-pricing > .card")).toHaveCount(3);
    await expect(app.locator(".daisy-pricing .card .card-title")).toContainText(["Klarheits-Workshop", "Prozess-Blueprint", "Umsetzungsbegleitung"]);
    await expect(app.locator(".daisy-pricing .daisy-card-price")).toContainText(["1.900 EUR", "4.900 EUR", "auf Anfrage"]);
    await expect(app.locator(".daisy-pricing button[data-transition-id]")).toHaveCount(3);
    await expect(app.locator(".actions [data-transition-id]")).toHaveCount(0);
    await expect(app.getByRole("button", { name: "Workshop anfragen", exact: true })).toHaveCount(1);
    await expect(app.getByRole("button", { name: "Blueprint anfragen", exact: true })).toHaveCount(1);
    await expect(app.getByRole("button", { name: "Begleitung anfragen", exact: true })).toHaveCount(1);
    await expectNoHorizontalOverflow();
    await expect.poll(async () => app.locator("body").evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      return Math.round(window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0);
    })).toBeGreaterThan(0);
    await app.getByRole("button", { name: "Blueprint anfragen", exact: true }).click();
    await expectDemoShell("site_checkout");
    await expect.poll(async () => app.locator("body").evaluate(() =>
      Math.round(window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0)
    )).toBe(0);
    await expect(app.getByText("Prozess-Blueprint")).toBeVisible();
    await expect(app.getByText("4.900 EUR")).toBeVisible();
    await app.locator('input').fill("billing@example.test");
    await expect(app.getByRole("button", { name: "Anfrage senden", exact: true })).toHaveCount(1);
    await app.getByRole("button", { name: "Anfrage senden", exact: true }).click();
    await expectDemoShell("site_thanks");
    await expect.poll(async () => (await runtimeContext(page)).states?.site_thanks?.order).toMatchObject({
      plan: "Prozess-Blueprint",
      price: "4.900 EUR",
      completed: true
    });

    await navButton("Kontakt").click();
    await expectDemoShell("site_contact");
    await expect(app.getByText("Beschreiben Sie kurz den Ablauf")).toBeVisible();

    await expect(app.getByRole("button", { name: "Anfrage senden", exact: true })).toHaveCount(1);
    await app.getByRole("button", { name: "Anfrage senden", exact: true }).click();
    await expectDemoShell("site_thanks");
    await expect(app.getByText("Anfrage erhalten")).toBeVisible();

    await expect(navButton("Konto")).toHaveCount(1);
    await navButton("Konto").click();
    await expectDemoShell("site_login");
    await expect(app.getByText("Anmelden und fortfahren")).toBeVisible();
    await app.locator('input[type="email"]').fill("mira@example.test");
    await app.locator('input[type="password"]').fill("demo-password");

    const signInButton = app.locator('.hero button[data-transition-id="site_login_submit"]').filter({ hasText: "Anmelden" });
    await expect(signInButton).toHaveCount(1);
    await signInButton.click();
    await expectDemoShell("site_profile");
    await expect(app.getByText("Willkommen zurueck")).toBeVisible();
    await expect(app.locator('.avatar img[alt="Mira Keller"]')).toBeVisible();
    await expect(app.getByText("Parent")).toHaveCount(0);

    await expect(app.getByRole("button", { name: "Abmelden", exact: true })).toHaveCount(1);
    await app.getByRole("button", { name: "Abmelden", exact: true }).click();
    await expectDemoShell("site_login");
    await expect(app.getByText("Anmelden und fortfahren")).toBeVisible();
  });

  test("click-traverses every website demo state and transition by contract id @smoke", async ({ page }) => {
    test.setTimeout(90000);
    await openTool(page);

    await page.locator("#topbarMore summary").click();
    await page.getByRole("button", { name: "Zustand Demo" }).click();
    await page.getByRole("button", { name: "Demo laden" }).click();

    const model = await savedModel(page);
    const states = model.states;
    const transitions = userTransitions(model);
    const stateIds = states.map(state => state.id);
    const transitionIds = transitions.map(transition => transition.id);
    const allEntityIds = [...stateIds, ...transitionIds];
    expect(new Set(allEntityIds).size).toBe(allEntityIds.length);
    expect(stateIds).toHaveLength(9);
    expect(transitionIds).toHaveLength(47);

    const stateIdSet = new Set(stateIds);
    for (const transition of transitions) {
      expect(stateIdSet.has(transition.from), transition.id).toBe(true);
      expect(stateIdSet.has(transition.to), transition.id).toBe(true);
      expect(transition.triggerType, transition.id).toBe("button");
      expect(transition.triggerEvent, transition.id).toBe(`button.${transition.id}.clicked`);
    }

    const byStateId = new Map(states.map(state => [state.id, state]));
    const boundaryFor = state => state && typeof state.boundary === "object" ? state.boundary : {};
    const isAutoEntryParent = state => boundaryFor(state).entryTriggerType === "auto" && boundaryFor(state).entryId;
    const runtimeTargetFor = transition => {
      const target = byStateId.get(transition.to);
      return isAutoEntryParent(target) ? boundaryFor(target).entryId : transition.to;
    };
    const renderSourceFor = transition => {
      const source = byStateId.get(transition.from);
      const boundary = boundaryFor(source);
      return boundary.exitId && byStateId.has(boundary.exitId) ? boundary.exitId : transition.from;
    };

    const reachable = new Set([model.initial]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const state of states) {
        if (!reachable.has(state.id) || !isAutoEntryParent(state) || reachable.has(boundaryFor(state).entryId)) continue;
        reachable.add(boundaryFor(state).entryId);
        changed = true;
      }
      for (const transition of transitions) {
        const renderSourceId = renderSourceFor(transition);
        if (!reachable.has(transition.from) && !reachable.has(renderSourceId)) continue;
        for (const id of [transition.to, runtimeTargetFor(transition)]) {
          if (!id || reachable.has(id)) continue;
          reachable.add(id);
          changed = true;
        }
      }
    }
    expect([...reachable].sort()).toEqual([...stateIds].sort());

    const testedTransitions = new Set();
    const visitedStates = new Set([model.initial]);
    const failures = [];
    const app = appFrame(page);
    const frameHandle = await page.locator("#appFrame").elementHandle();
    const frame = frameHandle ? await frameHandle.contentFrame() : null;
    expect(frame).toBeTruthy();

    const clickTargetFor = transitionId =>
      app.locator(`[data-transition-id="${cssAttributeValue(transitionId)}"]`).filter({ visible: true }).first();
    const resetRuntimeTo = async sourceId => {
      await frame.evaluate(id => {
        setRuntimeCurrent(id, "runtime", true);
        render();
      }, sourceId);
      visitedStates.add(sourceId);
      await expect(app.locator("#statePill")).toHaveText(sourceId);
    };
    const typeInto = async (selector, value, index = 0) => {
      const input = app.locator(selector).nth(index);
      await expect(input, `missing input ${selector} for ${await app.locator("#statePill").textContent()}`).toBeVisible();
      await input.click();
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await page.keyboard.press("Backspace");
      if (value) await input.pressSequentially(value);
    };
    const prepare = async transition => {
      const shortId = String(transition.from || "").replace(/^site_/, "");
      if (transition.id === "site_login_submit") {
        await typeInto('input[type="email"]', "mira@example.test");
        await typeInto('input[type="password"]', "demo-password");
      } else if (transition.id === "site_checkout_complete") {
        await typeInto("input", `${shortId}@example.test`);
      } else if (transition.id === "site_contact_send") {
        await typeInto("input", "Mira Keller", 0);
        await typeInto("input", "mira@example.test", 1);
        await typeInto("textarea", "Bitte den Prozess pruefen.");
      }
    };
    const transitionsBySource = transitions
      .map(transition => ({
        id: transition.id,
        from: transition.from,
        to: transition.to,
        renderSourceId: renderSourceFor(transition),
        expectedCurrent: runtimeTargetFor(transition)
      }))
      .reduce((groups, transition) => {
        if (!groups.has(transition.renderSourceId)) groups.set(transition.renderSourceId, []);
        groups.get(transition.renderSourceId).push(transition);
        return groups;
      }, new Map());

    for (const [sourceId, sourceTransitions] of transitionsBySource) {
      await resetRuntimeTo(sourceId);

      for (const transition of sourceTransitions) {
        const trigger = clickTargetFor(transition.id);
        if (!await trigger.count()) {
          failures.push(`${transition.id}: no visible trigger in ${transition.renderSourceId}`);
          continue;
        }
        if (!await trigger.isEnabled()) {
          failures.push(`${transition.id}: trigger is disabled`);
          continue;
        }
      }
      if (failures.length) break;

      for (const transition of sourceTransitions) {
        await resetRuntimeTo(sourceId);
        await prepare(transition);
        const trigger = clickTargetFor(transition.id);
        await trigger.click();
        const actual = await frame.evaluate(() => {
          const state = context?.state || {};
          return {
            current: state.current || "",
            previous: state.previous || "",
            lastTransition: state.lastTransition || ""
          };
        });
        const expected = {
          current: transition.expectedCurrent,
          previous: transition.renderSourceId,
          lastTransition: transition.id
        };
        if (actual.current !== expected.current ||
          actual.previous !== expected.previous ||
          actual.lastTransition !== expected.lastTransition) {
          failures.push(`${transition.id}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
          continue;
        }
        testedTransitions.add(transition.id);
        visitedStates.add(transition.to);
      }
      if (failures.length) break;
    }

    expect(failures).toEqual([]);

    expect([...visitedStates].sort()).toEqual([...stateIds].sort());
    expect([...testedTransitions].sort()).toEqual([...transitionIds].sort());
    await expect(app.locator("#screen")).toBeVisible();
  });

  test("edits and reorders navbar widget data through the render editor @smoke", async ({ page }) => {
    await openTool(page);

    await page.locator("#topbarMore summary").click();
    await page.getByRole("button", { name: "Zustand Demo" }).click();
    await page.getByRole("button", { name: "Demo laden" }).click();
    await openStateInspector(page, "site_home");

    const editor = await expandComponentEditor(page, "Widget: Kopf-Navigation");
    await editor.getByLabel("Marke").fill("Site Header");
    await editor.getByLabel("Menuepunkte Eintrag 3").fill("Plans");
    await editor.getByLabel("Widget-Name").fill("Site Header");

    await expect(appFrame(page).locator(".navbar")).toContainText("Site Header");
    await expect(appFrame(page).locator(".navbar")).not.toContainText("Zustand");
    await expect.poll(async () => (await runtimeContext(page)).states?.site_home?.nav?.brand).toBe("Site Header");

    const itemRows = page.locator('.component-editor[open] .widget-list-row[data-widget-list-key="items"]');
    const sourceHandleBox = await itemRows.nth(2).locator(".widget-list-drag-handle").boundingBox();
    const targetRowBox = await itemRows.nth(1).boundingBox();
    expect(sourceHandleBox).toBeTruthy();
    expect(targetRowBox).toBeTruthy();
    await page.mouse.move(sourceHandleBox.x + sourceHandleBox.width / 2, sourceHandleBox.y + sourceHandleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(sourceHandleBox.x + sourceHandleBox.width / 2, sourceHandleBox.y + sourceHandleBox.height / 2 + 12);
    await page.mouse.move(targetRowBox.x + 8, targetRowBox.y + 2, { steps: 8 });
    await page.mouse.up();

    await expect.poll(async () => {
      const model = await savedModel(page);
      const state = model.states.find(item => item.id === "site_home");
      const navData = state?.data?.["states.site_home.nav"] || {};
      return {
        componentLabel: state?.components.find(component => component.id === "site_home_nav")?.dataLabel || "",
        brand: navData.brand || "",
        labels: Array.isArray(navData.items) ? navData.items.map(item => item.label) : [],
        transitionIds: Array.isArray(navData.items) ? navData.items.map(item => item.transitionId) : [],
        pricingLabel: model.transitions.find(transition => transition.id === "site_home_nav_pricing")?.label || ""
      };
    }).toEqual({
      componentLabel: "Site Header",
      brand: "Site Header",
      labels: ["Start", "Plans", "Nutzen", "Kontakt", "Konto"],
      transitionIds: [
        "site_home_nav_home",
        "site_home_nav_pricing",
        "site_home_nav_features",
        "site_home_nav_contact",
        "site_home_nav_login"
      ],
      pricingLabel: "Plans"
    });

    await expect.poll(async () => appFrame(page).locator(".navbar button,.navbar a").evaluateAll(items =>
      items.map(item => item.textContent.trim()).filter(Boolean)
    )).toEqual(["Site Header", "Start", "Plans", "Nutzen", "Kontakt", "Konto"]);

    await appFrame(page).locator(".navbar").getByRole("button", { name: "Plans", exact: true }).click();
    await expect(appFrame(page).locator("#statePill")).toHaveText("site_pricing");
  });

  test("exports the website demo as a self-contained runnable FSM website @smoke", async ({ page }) => {
    await openTool(page);

    await page.locator("#topbarMore summary").click();
    await page.getByRole("button", { name: "Zustand Demo" }).click();
    await page.getByRole("button", { name: "Demo laden" }).click();
    await expect(appFrame(page).locator("#statePill")).toHaveText("site_home");

    const exportDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "HTML exportieren" }).click();
    const htmlDownload = await exportDownload;
    const html = fs.readFileSync(await htmlDownload.path(), "utf8");

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>Zustand Demo</title>");
    expect(html).toContain("const IS_STANDALONE_EXPORT = true");
    expect(html).toContain("const EXPORTED_STATE_BLUEPRINT = ");
    expect(html).toContain('"name":"Zustand Demo"');
    expect(html).toContain('"site_pricing"');
    expect(html).toContain('"site_checkout"');
    expect(html).toContain("flow-debug-toggle");
    expect(html).not.toContain("let model = loadModel() || blankModel();");
    expect(html).not.toContain('id="appFrame"');
    expect(html).not.toContain('id="btnExport"');
    expect(html).not.toContain("state-blueprint-definition");

    const standalone = await page.context().newPage();
    const pageErrors = [];
    standalone.on("pageerror", error => pageErrors.push(error.message));
    await standalone.setContent(html, { waitUntil: "domcontentloaded" });

    const expectStandaloneShell = async (stateId, title) => {
      await expect.poll(async () => standalone.locator("body").evaluate(() => {
        const text = element => (element?.textContent || "").trim();
        return {
          state: text(document.querySelector("#statePill")),
          title: text(document.querySelector("#screen > h1")),
          navbarCount: document.querySelectorAll(".navbar").length,
          footerHasBrand: text(document.querySelector(".footer")).includes("Zustand GmbH"),
          footerButtons: document.querySelectorAll(".footer button[data-transition-id]").length,
          editorExportButtons: document.querySelectorAll("#btnExport").length
        };
      })).toEqual({
        state: stateId,
        title,
        navbarCount: 1,
        footerHasBrand: true,
        footerButtons: 5,
        editorExportButtons: 0
      });
    };
    const navButton = label => standalone.locator(".navbar").getByRole("button", { name: label, exact: true });
    const footerButton = label => standalone.locator(".footer").getByRole("button", { name: label, exact: true });
    const flowDebug = standalone.locator("#flowDebug");
    const expectStandaloneNoHorizontalOverflow = async () => {
      await expect.poll(async () => standalone.locator("body").evaluate(body =>
        Math.round(body.scrollWidth - body.clientWidth)
      )).toBeLessThanOrEqual(2);
    };
    const openPricing = async () => {
      await navButton("Angebot").click();
      await expectStandaloneShell("site_pricing", "Angebot");
      await expect(standalone.locator(".daisy-pricing > .card")).toHaveCount(3);
      await expect(standalone.locator(".daisy-pricing .card .card-title")).toContainText(["Klarheits-Workshop", "Prozess-Blueprint", "Umsetzungsbegleitung"]);
      await expect(standalone.locator(".daisy-pricing button[data-transition-id]")).toHaveCount(3);
      await expect(standalone.locator(".actions [data-transition-id]")).toHaveCount(0);
      await expectStandaloneNoHorizontalOverflow();
    };

    await expectStandaloneShell("site_home", "Start");
    await expect(standalone.getByRole("heading", { name: "Erst Klarheit. Dann digitalisieren.", exact: true })).toBeVisible();
    await expect(standalone.locator(".daisy-feature-grid")).toHaveCount(1);
    await expect(standalone.locator(".daisy-feature-cards > .card")).toHaveCount(3);
    await expect(standalone.locator(".daisy-feature-grid button[data-transition-id]")).toHaveCount(3);
    await expectStandaloneNoHorizontalOverflow();
    await expect.poll(async () => standalone.locator(".daisy-transition-button[data-transition-id]").count()).toBeGreaterThanOrEqual(7);
    await expect(standalone.locator(".actions [data-transition-id]")).toHaveCount(0);
    await expect(flowDebug).toHaveClass(/available/);
    await expect(flowDebug.locator(".flow-debug-panel")).toBeHidden();
    await flowDebug.locator(".flow-debug-toggle").click();
    await expect(flowDebug).toHaveClass(/open/);
    await expect(flowDebug.locator('[data-flow-debug="current"]')).toHaveText("site_home");
    await expect(flowDebug.locator('[data-flow-debug="route"]')).toContainText("site_home");

    await navButton("Nutzen").click();
    await expectStandaloneShell("site_features", "Nutzen");
    await expect(flowDebug.locator('[data-flow-debug="current"]')).toHaveText("site_features");
    await expect(flowDebug.locator('[data-flow-debug="route"]')).toContainText("site_home -> site_features");
    await expect(flowDebug.locator('[data-flow-debug="transition"]')).toContainText("Nutzen");
    await expect(standalone.getByText("Umsetzung bekommt Leitplanken")).toBeVisible();
    await expect(standalone.locator(".daisy-feature-grid")).toHaveCount(1);
    await expect(standalone.locator(".daisy-feature-cards > .card")).toHaveCount(3);
    await expect(standalone.locator(".daisy-feature-grid button[data-transition-id]")).toHaveCount(3);
    await expect(standalone.locator(".steps button[data-transition-id] .daisy-step-label")).toHaveText([
      "Klaeren",
      "Modellieren",
      "Entscheiden"
    ]);
    await expectStandaloneNoHorizontalOverflow();
    await navButton("Start").click();
    await expectStandaloneShell("site_home", "Start");

    await footerButton("Angebot").click();
    await expectStandaloneShell("site_pricing", "Angebot");
    await openPricing();
    for (const plan of [
      { label: "Klarheits-Workshop", action: "Workshop anfragen", stateId: "site_checkout", title: "Anfrage", price: "1.900 EUR" },
      { label: "Prozess-Blueprint", action: "Blueprint anfragen", stateId: "site_checkout", title: "Anfrage", price: "4.900 EUR" },
      { label: "Umsetzungsbegleitung", action: "Begleitung anfragen", stateId: "site_checkout", title: "Anfrage", price: "auf Anfrage" }
    ]) {
      await expect(standalone.getByRole("button", { name: plan.action, exact: true })).toBeVisible();
      await standalone.getByRole("button", { name: plan.action, exact: true }).click();
      await expectStandaloneShell(plan.stateId, plan.title);
      await expect(standalone.getByText(plan.label)).toBeVisible();
      await expect(standalone.getByText(plan.price)).toBeVisible();
      await standalone.locator('input').fill(`${plan.label.toLowerCase()}@example.test`);
      await standalone.getByRole("button", { name: "Anfrage senden", exact: true }).click();
      await expectStandaloneShell("site_thanks", "Danke");
      await expect(standalone.getByText("Anfrage erhalten")).toBeVisible();
      await openPricing();
    }

    await navButton("Kontakt").click();
    await expectStandaloneShell("site_contact", "Kontakt");
    await expect(standalone.getByText("Beschreiben Sie kurz den Ablauf")).toBeVisible();
    await standalone.getByRole("button", { name: "Anfrage senden", exact: true }).click();
    await expectStandaloneShell("site_thanks", "Danke");
    await expect(standalone.getByText("Anfrage erhalten")).toBeVisible();

    await footerButton("Konto").click();
    await expectStandaloneShell("site_login", "Konto");
    await expect(standalone.getByText("Anmelden und fortfahren")).toBeVisible();
    await standalone.locator('input[type="email"]').fill("mira@example.test");
    await standalone.locator('input[type="password"]').fill("demo-password");
    const standaloneSignInButton = standalone.locator('.hero button[data-transition-id="site_login_submit"]').filter({ hasText: "Anmelden" });
    await expect(standaloneSignInButton).toHaveCount(1);
    await standaloneSignInButton.click();
    await expectStandaloneShell("site_profile", "Profil");
    await expect(standalone.getByText("Willkommen zurueck")).toBeVisible();
    await expect(standalone.locator('.avatar img[alt="Mira Keller"]')).toBeVisible();
    await standalone.getByRole("button", { name: "Abmelden", exact: true }).click();
    await expectStandaloneShell("site_login", "Konto");
    await expect(standalone.getByText("Anmelden und fortfahren")).toBeVisible();

    await footerButton("Start").click();
    await expectStandaloneShell("site_home", "Start");

    expect(pageErrors).toEqual([]);
    await standalone.close();
  });

  test("loads saved definitions with nullable root parent ids as root states @smoke", async ({ page }) => {
    await openTool(page);

    const loaded = await page.evaluate(() => {
      const definition = {
        kind: "state-blueprint-definition",
        schemaVersion: 2,
        app: "Zustand",
        savedAt: new Date().toISOString(),
        model: {
          version: 2,
          name: "Nullable root parent",
          initial: "start",
          boundary: { entryId: "", exitId: "", entryDisabled: false, exitDisabled: false },
          states: [
            {
              id: "start",
              title: "Start",
              renderMode: "components",
              components: [],
              data: {},
              dataTypes: {},
              dataWires: [],
              subscriptions: [],
              boundary: { entryId: "", exitId: "", entryDisabled: false, exitDisabled: false },
              parentId: null,
              x: 96,
              y: 120
            }
          ],
          transitions: []
        },
        stateTemplates: [],
        camera: { x: 32, y: 32, scale: 1 },
        previewCollapsed: false
      };
      importBlueprintDefinition(definition);
      return {
        name: model.name,
        initial: model.initial,
        state: model.states[0],
        rootStates: model.states.filter(state => !state.parentId).length
      };
    });

    await expect(page.locator('[data-id="start"]')).toBeVisible();
    expect(loaded).toEqual({
      name: "Nullable root parent",
      initial: "start",
      state: expect.objectContaining({ id: "start", title: "Start", parentId: null }),
      rootStates: 1
    });
  });

  test("deletes selected substates with the same Delete key path as root states", async ({ page }) => {
    await openTool(page);

    await openStateLayer(page, "login");
    const childId = await addChildByDoubleClick(page, "login");
    await openStateInspector(page, childId);
    await expect(page.locator("#layerFrameLabel")).toHaveText("In Login");
    await expect(page.locator(".node")).toHaveCount(3);
    await page.locator("#pTitle").fill("Temporary child");
    await page.locator(`[data-id="${childId}"]`).click();
    await expect(page.locator(`[data-id="${childId}"]`)).toHaveClass(/selected/);
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(false);
    await expect.poll(() => page.locator("#map").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Delete");
    await expect(page.locator(`[data-id="${childId}"]`)).toHaveCount(0);
    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(0);
    await expect(page.locator(".node.boundary-proxy")).toHaveCount(2);
    await expect(page.locator("#stateInspectorBody")).toContainText("Kein Zustand ausgewaehlt");
    await expect.poll(async () => {
      const model = await savedModel(page);
      return {
        hasChild: model.states.some(state => state.id === childId),
        linkedToChild: model.transitions.some(transition => transition.from === childId || transition.to === childId),
        currentLayer: model.states.filter(state => state.parentId === "login").length
      };
    }).toEqual({ hasChild: false, linkedToChild: false, currentLayer: 0 });
  });

  test("projects parent wiring through child states in the opened state canvas @smoke", async ({ page }) => {
    await openTool(page);

    const wiringModel = await savedModel(page);
    const wiring = {
      inputIds: wiringModel.transitions.filter(transition => transition.to === "login").map(transition => transition.id),
      outputIds: wiringModel.transitions.filter(transition => transition.from === "login").map(transition => transition.id)
    };
    expect(wiring.inputIds).toHaveLength(2);
    expect(wiring.outputIds).toHaveLength(2);

    await openStateLayer(page, "login");
    const childId = await addChildByDoubleClick(page, "login");

    await expect(page.locator(".node")).toHaveCount(3);
    await expect(page.locator(".edge[data-edge-id]")).toHaveCount(4);
    for (const id of [...wiring.inputIds, ...wiring.outputIds]) {
      await expect(page.locator(`.edge[data-edge-id="${id}"]`)).toHaveCount(1);
    }
    const directFlow = await gridGeometryReport(page);
    expect(directFlow.paths).toHaveLength(4);
    expect(directFlow.paths.every(path => path.points.length >= 2)).toBe(true);
    const projectionPorts = await page.evaluate(({ inputIds, outputIds }) => {
      const nums = value => (value.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      const pathPoints = value => {
        const values = nums(value);
        const points = [];
        for (let i = 0; i < values.length; i += 2) points.push({ x: values[i], y: values[i + 1] });
        return points;
      };
      const portPoint = selector => {
        const transform = document.querySelector(selector)?.getAttribute("transform") || "";
        const values = nums(transform);
        return { x: values[0], y: values[1] };
      };
      const inputProxyId = document.querySelector('.node.boundary-input')?.dataset.id || "";
      const outputProxyId = document.querySelector('.node.boundary-output')?.dataset.id || "";
      const inputPort = portPoint(`svg#ports .svg-port[data-state-id="${CSS.escape(inputProxyId)}"][data-port-side="out"]`);
      const outputPort = portPoint(`svg#ports .svg-port[data-state-id="${CSS.escape(outputProxyId)}"][data-port-side="in"]`);
      const edgePoints = id => pathPoints(document.querySelector(`.edge[data-edge-id="${CSS.escape(id)}"]`)?.getAttribute("d") || "");
      return {
        inputProxyId,
        outputProxyId,
        inputPort,
        outputPort,
        inputStarts: inputIds.map(id => edgePoints(id)[0]),
        outputEnds: outputIds.map(id => {
          const points = edgePoints(id);
          return points[points.length - 1];
        }),
        inputStrokes: inputIds.map(id => getComputedStyle(document.querySelector(`.edge[data-edge-id="${CSS.escape(id)}"]`)).stroke),
        outputStrokes: outputIds.map(id => getComputedStyle(document.querySelector(`.edge[data-edge-id="${CSS.escape(id)}"]`)).stroke)
      };
    }, wiring);
    expect(projectionPorts.inputProxyId).toBeTruthy();
    expect(projectionPorts.outputProxyId).toBeTruthy();
    for (const point of projectionPorts.inputStarts) expect(point.x).toBe(projectionPorts.inputPort.x);
    for (const point of projectionPorts.outputEnds) expect(point.x).toBe(projectionPorts.outputPort.x);
    expect(new Set(projectionPorts.inputStarts.map(point => point.y)).size).toBe(projectionPorts.inputStarts.length);
    expect(new Set(projectionPorts.outputEnds.map(point => point.y)).size).toBe(projectionPorts.outputEnds.length);
    expect(new Set(projectionPorts.inputStrokes).size).toBe(projectionPorts.inputStrokes.length);
    expect(new Set(projectionPorts.outputStrokes).size).toBe(projectionPorts.outputStrokes.length);
    await expect(page.locator(`svg#ports .svg-port[data-state-id="${childId}"][data-port-side="in"]`)).toHaveCount(1);
    await expect(page.locator(`svg#ports .svg-port[data-state-id="${childId}"][data-port-side="out"]`)).toHaveCount(1);

    await page.locator("#layerBack").click();
    await expect(page.locator("#layerFrame")).toBeVisible();
    await expect(page.locator("#layerFrameLabel")).toHaveText("Wurzel");
    await expect(page.locator("#layerHud")).toBeVisible();
  });

  test("keeps unprojected boundary proxy edges when only one parent side has wiring @smoke", async ({ page }) => {
    await openTool(page);
    await page.evaluate(() => {
      model.transitions = model.transitions.filter(transition => transition.to !== "login");
      saveModel("test:asymmetric-boundary-proxy");
      draw();
    });

    await openStateLayer(page, "login");
    const childId = await addChildByDoubleClick(page, "login");
    const boundaryInputId = "boundary-flow:login:input";
    const boundaryOutputId = "boundary-flow:login:output";

    await expect.poll(async () => {
      const model = await savedModel(page);
      const parent = model.states.find(state => state.id === "login");
      return {
        entryId: parent?.boundary?.entryId || "",
        exitId: parent?.boundary?.exitId || "",
        inputFlow: model.transitions.some(transition => transition.id === boundaryInputId && transition.to === childId),
        outputFlow: model.transitions.some(transition => transition.id === boundaryOutputId && transition.from === childId)
      };
    }).toEqual({ entryId: childId, exitId: childId, inputFlow: true, outputFlow: true });

    await expect(page.locator(`.edge[data-edge-id="${boundaryInputId}"]`)).toHaveCount(1);
    await expect(page.locator(`.edge[data-edge-id="t_login_success"]`)).toHaveCount(1);
    await expect(page.locator(`.edge[data-edge-id="t_login_error"]`)).toHaveCount(1);

    const boundaryRoute = await page.evaluate(({ boundaryInputId, childId }) => {
      const nums = value => (value.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      const points = value => {
        const values = nums(value);
        const out = [];
        for (let i = 0; i < values.length; i += 2) out.push({ x: values[i], y: values[i + 1] });
        return out;
      };
      const portPoint = selector => {
        const values = nums(document.querySelector(selector)?.getAttribute("transform") || "");
        return { x: values[0], y: values[1] };
      };
      const inputProxyId = document.querySelector(".node.boundary-input")?.dataset.id || "";
      const route = points(document.querySelector(`.edge[data-edge-id="${CSS.escape(boundaryInputId)}"]`)?.getAttribute("d") || "");
      return {
        inputProxyId,
        start: route[0],
        end: route[route.length - 1],
        proxyOut: portPoint(`svg#ports .svg-port[data-state-id="${CSS.escape(inputProxyId)}"][data-port-side="out"]`),
        childIn: portPoint(`svg#ports .svg-port[data-state-id="${CSS.escape(childId)}"][data-port-side="in"]`)
      };
    }, { boundaryInputId, childId });
    expect(boundaryRoute.inputProxyId).toBeTruthy();
    expect(boundaryRoute.start).toMatchObject(boundaryRoute.proxyOut);
    expect(boundaryRoute.end.x).toBe(boundaryRoute.childIn.x);
    expect(Math.abs(boundaryRoute.end.y - boundaryRoute.childIn.y)).toBeLessThanOrEqual(GRID_SIZE);
  });

  test("renders explicit layer frame comments without defaulting to state titles @smoke", async ({ page }) => {
    await openTool(page);

    await openStateLayer(page, "login");
    await expect(page.locator("#layerFrameLabel")).toHaveText("In Login");
    await expect(page.locator("#layerFrameComment")).toBeVisible();
    await expect(page.locator("#layerFrameCommentTitle")).toHaveAttribute("aria-label", "Ebenentitel");
    await expect(page.locator("#layerFrameCommentBody")).toHaveAttribute("aria-label", "Ebenen-Kommentar");
    await expect(page.locator("#layerFrameCommentTitle")).toHaveValue("");
    await expect(page.locator("#layerFrameCommentBody")).toHaveValue("");
    await page.locator("#layerFrameCommentTitle").fill("Credential gate");
    await page.locator("#layerFrameCommentBody").fill("Validate identity before app access.");

    await expect.poll(async () => {
      const model = await savedModel(page);
      const state = model.states.find(item => item.id === "login");
      return {
        title: state?.boundary?.title || "",
        note: state?.boundary?.note || ""
      };
    }).toEqual({
      title: "Credential gate",
      note: "Validate identity before app access."
    });

    await expect(page.locator("#layerFrameComment")).toBeVisible();
    await expect(page.locator("#layerFrameCommentTitle")).toHaveValue("Credential gate");
    await expect(page.locator("#layerFrameCommentBody")).toHaveValue("Validate identity before app access.");
    await expect(page.locator("#layerFrameComment")).not.toContainText("Login");

    await page.locator("#layerFrameCommentTitle").click();
    await expect.poll(async () => page.evaluate(() => document.activeElement?.id || "")).toBe("layerFrameCommentTitle");
    await page.keyboard.press("End");
    await page.keyboard.type(" v2");
    await expect(page.locator("#layerFrameCommentTitle")).toHaveValue("Credential gate v2");
    await page.locator("#layerFrameCommentBody").click();
    await expect.poll(async () => page.evaluate(() => document.activeElement?.id || "")).toBe("layerFrameCommentBody");
    await page.locator("#layerFrameCommentBody").evaluate(el => el.setSelectionRange(el.value.length, el.value.length));
    await page.keyboard.type(" Second edit stays focusable.");
    await expect(page.locator("#layerFrameCommentBody")).toHaveValue("Validate identity before app access. Second edit stays focusable.");
    await expect.poll(async () => page.evaluate(() => document.activeElement?.id || "")).toBe("layerFrameCommentBody");
    await page.locator("#layerFrameLabel").click();

    await expect.poll(async () => {
      const model = await savedModel(page);
      const state = model.states.find(item => item.id === "login");
      return {
        title: state?.boundary?.title || "",
        note: state?.boundary?.note || ""
      };
    }).toEqual({
      title: "Credential gate v2",
      note: "Validate identity before app access. Second edit stays focusable."
    });

    const commentBlock = await page.evaluate(() => {
      const box = layerFrameCommentBox(0);
      return {
        box,
        routedAsBlocker: routeBlockingBoxes({ from: "", to: "" }, 0).some(item => item.id === "__layer_frame_comment")
      };
    });
    expect(commentBlock.box).toBeTruthy();
    expect(commentBlock.box.x2).toBeGreaterThan(commentBlock.box.x1);
    expect(commentBlock.box.y2).toBeGreaterThan(commentBlock.box.y1);
    expect(commentBlock.routedAsBlocker).toBe(true);

    await page.locator("#layerBack").click();
    await expect(page.locator("#layerFrameLabel")).toHaveText("Wurzel");

    await openStateInspector(page, "login");
    await expect(page.locator("#pLayerTitle")).toHaveCount(0);
    await expect(page.locator("#pLayerNote")).toHaveCount(0);
  });

  test("keeps boundary input anchors after deleting a selected boundary flow @smoke", async ({ page }) => {
    await openTool(page);
    const parentInputIds = await savedModel(page).then(model =>
      model.transitions.filter(transition => transition.to === "login").map(transition => transition.id)
    );
    expect(parentInputIds).toHaveLength(2);

    await openStateLayer(page, "login");
    const childId = await addChildByDoubleClick(page, "login");
    const boundaryInputId = "boundary-flow:login:input";
    const inputProxyId = "proxy:login:input:__boundary_input";

    await expect(page.locator(`svg#ports .svg-port[data-state-id="${inputProxyId}"][data-port-side="out"]`)).toHaveCount(1);

    const removedParentInputs = await page.evaluate(parentInputIds => {
      selected = selectionFromParts([], parentInputIds);
      return deleteSelectedItems();
    }, parentInputIds);
    expect(removedParentInputs).toBe(true);

    await expect(page.locator(`.edge[data-edge-id="${boundaryInputId}"]`)).toHaveCount(1);
    await expect(page.locator(`svg#ports .svg-port[data-state-id="${inputProxyId}"][data-port-side="out"]`)).toHaveCount(1);
    await expect(page.locator(`svg#ports .svg-port[data-state-id="${childId}"][data-port-side="in"]`)).toHaveCount(1);
    await expect.poll(async () => {
      const model = await savedModel(page);
      const parent = model.states.find(state => state.id === "login");
      const boundary = parent?.boundary || {};
      return {
        entryId: boundary.entryId || "",
        entryDisabled: Boolean(boundary.entryDisabled),
        inputFlow: model.transitions.some(transition =>
          transition.id === boundaryInputId &&
          transition.from === inputProxyId &&
          transition.to === childId
        )
      };
    }).toEqual({ entryId: childId, entryDisabled: false, inputFlow: true });

    const removedAnchorDelete = await page.evaluate(boundaryInputId => {
      selected = selectionFromParts([], [boundaryInputId]);
      return deleteSelectedItems();
    }, boundaryInputId);
    expect(removedAnchorDelete).toBe(true);

    await expect(page.locator(`.edge[data-edge-id="${boundaryInputId}"]`)).toHaveCount(0);
    await expect(page.locator(`svg#ports .svg-port[data-state-id="${inputProxyId}"][data-port-side="out"]`)).toHaveCount(1);
    await expect.poll(async () => {
      const model = await savedModel(page);
      const parent = model.states.find(state => state.id === "login");
      const boundary = parent?.boundary || {};
      return {
        entryId: boundary.entryId || "",
        entryDisabled: Boolean(boundary.entryDisabled),
        inputFlow: model.transitions.some(transition =>
          transition.id === boundaryInputId &&
          transition.from === inputProxyId &&
          transition.to === childId
        )
      };
    }).toEqual({ entryId: "", entryDisabled: false, inputFlow: false });
  });

  test("keeps boundary proxy anchors by reassigning after deleting the anchored child state @smoke", async ({ page }) => {
    await openTool(page);
    await openStateLayer(page, "login");
    const firstChildId = await addChildByDoubleClick(page, "login");
    const secondChildId = await addChildByDoubleClick(page, "login", [firstChildId]);
    const inputProxyId = "proxy:login:input:__boundary_input";
    const outputProxyId = "proxy:login:output:__boundary_output";

    await page.evaluate(firstChildId => {
      const parent = byId("login");
      setBoundaryEndpoint(parent, "input", firstChildId);
      setBoundaryEndpoint(parent, "output", firstChildId);
      ensureDefaultBoundaryTransitions(parent, statesInLayer("login"));
      saveModel("test:boundary-anchor-first-child");
      draw();
    }, firstChildId);

    await expect(page.locator(".node.boundary-proxy")).toHaveCount(2);
    await expect.poll(async () => {
      const model = await savedModel(page);
      const parent = model.states.find(state => state.id === "login");
      const boundary = parent?.boundary || {};
      return {
        entryId: boundary.entryId || "",
        exitId: boundary.exitId || "",
        inputFlow: model.transitions.some(transition =>
          transition.id === "boundary-flow:login:input" &&
          transition.from === inputProxyId &&
          transition.to === firstChildId
        ),
        outputFlow: model.transitions.some(transition =>
          transition.id === "boundary-flow:login:output" &&
          transition.from === firstChildId &&
          transition.to === outputProxyId
        )
      };
    }).toEqual({ entryId: firstChildId, exitId: firstChildId, inputFlow: true, outputFlow: true });

    const deleted = await page.evaluate(firstChildId => {
      selected = selectionFromParts([firstChildId], []);
      return deleteSelectedItems();
    }, firstChildId);
    expect(deleted).toBe(true);

    await expect(page.locator(`[data-id="${firstChildId}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-id="${secondChildId}"]`)).toBeVisible();
    await expect(page.locator(".node.boundary-proxy")).toHaveCount(2);
    await expect(page.locator(`svg#ports .svg-port[data-state-id="${inputProxyId}"][data-port-side="out"]`)).toHaveCount(1);
    await expect(page.locator(`svg#ports .svg-port[data-state-id="${outputProxyId}"][data-port-side="in"]`)).toHaveCount(1);
    await expect(page.locator(`svg#ports .svg-port[data-state-id="${secondChildId}"][data-port-side="in"]`)).toHaveCount(1);
    await expect(page.locator(`svg#ports .svg-port[data-state-id="${secondChildId}"][data-port-side="out"]`)).toHaveCount(1);
    await expect.poll(async () => {
      const model = await savedModel(page);
      const parent = model.states.find(state => state.id === "login");
      const boundary = parent?.boundary || {};
      return {
        entryId: boundary.entryId || "",
        exitId: boundary.exitId || "",
        entryDisabled: Boolean(boundary.entryDisabled),
        exitDisabled: Boolean(boundary.exitDisabled),
        inputFlow: model.transitions.some(transition =>
          transition.id === "boundary-flow:login:input" &&
          transition.from === inputProxyId &&
          transition.to === secondChildId
        ),
        outputFlow: model.transitions.some(transition =>
          transition.id === "boundary-flow:login:output" &&
          transition.from === secondChildId &&
          transition.to === outputProxyId
        )
      };
    }).toEqual({
      entryId: secondChildId,
      exitId: secondChildId,
      entryDisabled: false,
      exitDisabled: false,
      inputFlow: true,
      outputFlow: true
    });
  });

  test("keeps layer boundary proxies reusable after deleting the last child state @smoke", async ({ page }) => {
    await openTool(page);
    await openStateLayer(page, "login");
    const childId = await addChildByDoubleClick(page, "login");
    const inputProxyId = "proxy:login:input:__boundary_input";
    const outputProxyId = "proxy:login:output:__boundary_output";

    await page.evaluate(childId => {
      const parent = byId("login");
      setBoundaryEndpoint(parent, "input", childId);
      setBoundaryEndpoint(parent, "output", childId);
      ensureDefaultBoundaryTransitions(parent, statesInLayer("login"));
      saveModel("test:boundary-last-child");
      draw();
    }, childId);

    await expect(page.locator(".node.boundary-proxy")).toHaveCount(2);
    const deleted = await page.evaluate(childId => {
      selected = selectionFromParts([childId], []);
      return deleteSelectedItems();
    }, childId);
    expect(deleted).toBe(true);

    await expect(page.locator(`[data-id="${childId}"]`)).toHaveCount(0);
    await expect(page.locator(".node.boundary-proxy")).toHaveCount(2);
    await expect(page.locator(`svg#ports .svg-port[data-state-id="${inputProxyId}"][data-port-side="out"]`)).toHaveCount(1);
    await expect(page.locator(`svg#ports .svg-port[data-state-id="${outputProxyId}"][data-port-side="in"]`)).toHaveCount(1);
    await expect(page.locator(`.edge[data-edge-id="boundary-flow:login:input"]`)).toHaveCount(0);
    await expect(page.locator(`.edge[data-edge-id="boundary-flow:login:output"]`)).toHaveCount(0);
    await expect.poll(async () => {
      const model = await savedModel(page);
      const parent = model.states.find(state => state.id === "login");
      const boundary = parent?.boundary || {};
      return {
        childCount: model.states.filter(state => state.parentId === "login").length,
        entryId: boundary.entryId || "",
        exitId: boundary.exitId || "",
        entryDisabled: Boolean(boundary.entryDisabled),
        exitDisabled: Boolean(boundary.exitDisabled),
        inputFlow: model.transitions.some(transition => transition.id === "boundary-flow:login:input"),
        outputFlow: model.transitions.some(transition => transition.id === "boundary-flow:login:output")
      };
    }).toEqual({
      childCount: 0,
      entryId: "",
      exitId: "",
      entryDisabled: false,
      exitDisabled: false,
      inputFlow: false,
      outputFlow: false
    });

    const replacementId = await page.evaluate(() => {
      const point = nextChildPosition("login");
      addStateAt(point.x, point.y, point.x, point.y);
      return lastCreatedStateId || "";
    });
    expect(replacementId).toBeTruthy();
    await expect(page.locator(".node.boundary-proxy")).toHaveCount(2);
    await expect(page.locator(`svg#ports .svg-port[data-state-id="${inputProxyId}"][data-port-side="out"]`)).toHaveCount(1);
    await expect(page.locator(`svg#ports .svg-port[data-state-id="${outputProxyId}"][data-port-side="in"]`)).toHaveCount(1);
    await expect.poll(async () => {
      const model = await savedModel(page);
      const parent = model.states.find(state => state.id === "login");
      const boundary = parent?.boundary || {};
      return {
        entryId: boundary.entryId || "",
        exitId: boundary.exitId || "",
        entryDisabled: Boolean(boundary.entryDisabled),
        exitDisabled: Boolean(boundary.exitDisabled),
        inputFlow: model.transitions.some(transition =>
          transition.id === "boundary-flow:login:input" &&
          transition.from === inputProxyId &&
          transition.to === replacementId
        ),
        outputFlow: model.transitions.some(transition =>
          transition.id === "boundary-flow:login:output" &&
          transition.from === replacementId &&
          transition.to === outputProxyId
        )
      };
    }).toEqual({
      entryId: replacementId,
      exitId: replacementId,
      entryDisabled: false,
      exitDisabled: false,
      inputFlow: true,
      outputFlow: true
    });
  });

  test("keeps boundary proxies enabled after deleting a selected boundary transition @smoke", async ({ page }) => {
    await openTool(page);
    await openStateLayer(page, "login");
    const childId = await addChildByDoubleClick(page, "login");
    const inputProxyId = "proxy:login:input:__boundary_input";
    const manualBoundaryId = "manual-boundary-login-input";

    const deleted = await page.evaluate(({ childId, manualBoundaryId }) => {
      const parent = byId("login");
      setBoundaryEndpoint(parent, "input", childId);
      ensureDefaultBoundaryTransitions(parent, statesInLayer("login"));
      model.transitions = model.transitions.filter(transition => transition.id !== "boundary-flow:login:input");
      model.transitions.push({
        id: manualBoundaryId,
        from: "proxy:login:input:__boundary_input",
        to: childId,
        label: "IN",
        condition: "",
        set: {},
        boundaryFlow: { parentId: "login", side: "input", stateId: childId }
      });
      const removed = deleteBoundaryFlowById(manualBoundaryId);
      saveModel("test:delete-boundary-flow");
      draw();
      return removed;
    }, { childId, manualBoundaryId });
    expect(deleted).toBe(true);

    await expect(page.locator(".node.boundary-proxy")).toHaveCount(2);
    await expect(page.locator(`svg#ports .svg-port[data-state-id="${inputProxyId}"][data-port-side="out"]`)).toHaveCount(1);
    await expect.poll(async () => {
      const model = await savedModel(page);
      const parent = model.states.find(state => state.id === "login");
      const boundary = parent?.boundary || {};
      return {
        entryId: boundary.entryId || "",
        entryDisabled: Boolean(boundary.entryDisabled),
        removedFlow: model.transitions.some(transition => transition.id === manualBoundaryId),
        inputFlow: model.transitions.some(transition =>
          transition.id === "boundary-flow:login:input" &&
          transition.from === inputProxyId &&
          transition.to === childId
        )
      };
    }).toEqual({
      entryId: "",
      entryDisabled: false,
      removedFlow: false,
      inputFlow: false
    });
  });

  test("selects output proxy references without creating new transitions @smoke", async ({ page }) => {
    await openTool(page);
    await openStateLayer(page, "login");
    await addChildByDoubleClick(page, "login");
    await expect(page.locator(`.edge[data-edge-id="t_login_success"]`)).toHaveCount(1);

    const before = await savedModel(page);
    const outputProxyId = await page.locator(".node.boundary-output").getAttribute("data-id");
    expect(outputProxyId).toBeTruthy();
    const port = page.locator(`svg#ports .svg-port[data-state-id="${outputProxyId}"][data-port-side="in"]`);
    const point = await centerOf(port);
    await page.mouse.click(point.x, point.y);

    await expect.poll(async () => page.evaluate(() => ({
      selectedEdge: selected?.edges?.[0] || "",
      stateCount: model.states.length,
      transitionCount: model.transitions.length
    }))).toEqual({
      selectedEdge: "t_login_success",
      stateCount: before.states.length,
      transitionCount: before.transitions.length
    });
  });

  test("rewires projected parent entry by dragging it to another child state @smoke", async ({ page }) => {
    await openTool(page);

    const inputModel = await savedModel(page);
    const inputId = inputModel.transitions.find(transition => transition.from === "auth_start" && transition.to === "login")?.id || "";
    expect(inputId).toBeTruthy();

    await openStateLayer(page, "login");
    const firstChildId = await addChildByDoubleClick(page, "login");
    const secondChildId = await addChildByDoubleClick(page, "login", [firstChildId]);

    await expect(page.locator(".node")).toHaveCount(4);
    await expect(page.locator(`[data-id="${firstChildId}"]`)).toBeVisible();
    await expect(page.locator(`[data-id="${secondChildId}"]`)).toBeVisible();
    const edgeTip = await centerOf(page.locator(`.edge-tip-hit[data-edge-id="${inputId}"]`));
    const secondBox = await visibleBox(page.locator(`[data-id="${secondChildId}"]`));
    const target = { x: secondBox.x + 8, y: secondBox.y + secondBox.height / 2 };

    await page.mouse.move(edgeTip.x, edgeTip.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 12 });
    await page.mouse.up();

    await expect.poll(async () => {
      const model = await savedModel(page);
      const transition = model.transitions.find(item => item.id === inputId);
      return {
        groupEntryId: transition?.groupEntryId
      };
    }).toEqual({ groupEntryId: secondChildId });

    await expect(page.locator(`.edge[data-edge-id="${inputId}"]`)).toHaveCount(1);
  });

  test("preview runtime steps into child canvases and keeps the editor viewport on the active layer @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "Nested Runtime Flow",
      initial: "start",
      states: [
        { id: "start", title: "Start", body: "", x: 96, y: 160 },
        { id: "lesson", title: "Lesson", body: "", boundary: { entryId: "step_one", exitId: "step_two", entryDisabled: false, exitDisabled: false }, x: 360, y: 160 },
        { id: "done", title: "Done", body: "", x: 660, y: 160 },
        { id: "step_one", parentId: "lesson", title: "Step One", body: "", x: 120, y: 120 },
        { id: "step_two", parentId: "lesson", title: "Step Two", body: "", x: 420, y: 120 }
      ],
      transitions: [
        { id: "start_lesson", from: "start", to: "lesson", label: "Enter", condition: "" },
        { id: "step_one_two", from: "step_one", to: "step_two", label: "Continue", condition: "" },
        { id: "lesson_done", from: "lesson", to: "done", label: "Finish", condition: "" }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("start");

    await app.getByRole("button", { name: "Enter" }).click();
    await expect(app.locator("#statePill")).toHaveText("lesson");
    await expect(page.locator('[data-id="lesson"]')).toHaveClass(/active/);

    await app.getByRole("button", { name: "Step One" }).click();
    await expect(app.locator("#statePill")).toHaveText("step_one");
    await expect(page.locator("#layerFrameLabel")).toHaveText("In Lesson");
    await expect(page.locator(".node")).toHaveCount(4);
    await expect(page.locator('[data-id="step_one"]')).toHaveClass(/active/);

    await app.getByRole("button", { name: "Continue" }).click();
    await expect(app.locator("#statePill")).toHaveText("step_two");
    await expect(page.locator("#layerFrameLabel")).toHaveText("In Lesson");
    await expect(page.locator('[data-id="step_two"]')).toHaveClass(/active/);
    await expect(app.getByRole("button", { name: "Lesson" })).toHaveCount(0);
    await app.getByRole("button", { name: "Finish" }).click();
    await expect(app.locator("#statePill")).toHaveText("done");
    await expect(page.locator("#layerFrameLabel")).toHaveText("Wurzel");
    await expect(page.locator('[data-id="step_two"]')).toHaveCount(0);
    await expect(page.locator('[data-id="done"]')).toHaveClass(/active/);
  });

  test("restarts child boundary entry when a parent state is entered again @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "Nested Reentry Flow",
      initial: "alert_banner",
      boundary: { entryId: "alert_banner", exitId: "alert_banner", entryDisabled: false, exitDisabled: false },
      states: [
        {
          id: "alert_banner",
          title: "Hinweisbanner",
          x: -48,
          y: 72,
          boundary: { entryId: "user_avatar", exitId: "user_avatar", entryDisabled: false, exitDisabled: false },
          components: [{ id: "alert_component", type: "daisy", variant: "alert", dataPath: "states.alert_banner", dataRole: "widget", dataLabel: "Hinweisbanner" }],
          data: { "states.alert_banner": { tone: "info", message: "New software update available." } },
          dataTypes: { "states.alert_banner": "object" }
        },
        {
          id: "user_avatar",
          parentId: "alert_banner",
          title: "Benutzer-Avatar",
          x: -336,
          y: 144,
          boundary: { entryId: "state_3", exitId: "state_3", entryDisabled: false, exitDisabled: false },
          components: [{ id: "avatar_component", type: "daisy", variant: "avatar", dataPath: "states.user_avatar", dataRole: "widget", dataLabel: "Benutzer-Avatar" }],
          data: { "states.user_avatar": { name: "Mira Keller", image: "", status: "online", size: "w-16", shape: "rounded-full", ring: true, initials: "MK", avatars: [] } },
          dataTypes: { "states.user_avatar": "object" }
        },
        {
          id: "state_3",
          parentId: "user_avatar",
          title: "State 3",
          x: -336,
          y: 144
        }
      ],
      transitions: [
        { id: "loop_parent", from: "user_avatar", to: "user_avatar", label: "To Benutzer-Avatar", condition: "", triggerType: "button", triggerEvent: "button.loop_parent.clicked", set: {} }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    const app = appFrame(page);

    await expect(app.locator("#statePill")).toHaveText("alert_banner");
    await app.getByRole("button", { name: "Benutzer-Avatar" }).click();
    await expect(app.locator("#statePill")).toHaveText("user_avatar");
    await expect(app.getByRole("button", { name: "State 3" })).toBeVisible();

    await app.getByRole("button", { name: "State 3" }).click();
    await expect(app.locator("#statePill")).toHaveText("state_3");
    await expect(page.locator("#layerFrameLabel")).toHaveText("In Benutzer-Avatar");
    await expect(page.locator('[data-id="state_3"]')).toHaveClass(/active/);

    await app.getByRole("button", { name: "To Benutzer-Avatar" }).click();
    await expect(app.locator("#statePill")).toHaveText("user_avatar");
    await expect(page.locator("#layerFrameLabel")).toHaveText("In Hinweisbanner");
    await expect(app.getByRole("button", { name: "State 3" })).toBeVisible();
    await expect(app.getByRole("button", { name: "To Benutzer-Avatar" })).toHaveCount(0);

    await app.getByRole("button", { name: "State 3" }).click();
    await expect(app.locator("#statePill")).toHaveText("state_3");
    await expect(page.locator("#layerFrameLabel")).toHaveText("In Benutzer-Avatar");
    await expect(page.locator('[data-id="state_3"]')).toHaveClass(/active/);
  });

  test("selecting a composite state follows its child layer on the first runtime update @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "Selected Composite Runtime Flow",
      initial: "start",
      states: [
        { id: "start", title: "Start", body: "", x: 96, y: 160 },
        { id: "lesson", title: "Lesson", body: "", boundary: { entryId: "step_one", exitId: "step_two", entryDisabled: false, exitDisabled: false }, x: 360, y: 160 },
        { id: "done", title: "Done", body: "", x: 660, y: 160 },
        { id: "step_one", parentId: "lesson", title: "Step One", body: "", x: 120, y: 120 },
        { id: "step_two", parentId: "lesson", title: "Step Two", body: "", x: 420, y: 120 }
      ],
      transitions: [
        { id: "start_lesson", from: "start", to: "lesson", label: "Enter", condition: "" },
        { id: "step_one_two", from: "step_one", to: "step_two", label: "Continue", condition: "" },
        { id: "lesson_done", from: "lesson", to: "done", label: "Finish", condition: "" }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("start");

    await page.locator('[data-id="lesson"]').click();
    await expect(app.locator("#statePill")).toHaveText("lesson");
    await app.getByRole("button", { name: "Step One" }).click();
    await expect(app.locator("#statePill")).toHaveText("step_one");
    await expect(page.locator("#layerFrameLabel")).toHaveText("In Lesson");
    await expect(page.locator('[data-id="step_one"]')).toHaveClass(/active/);
    await expect(page.locator('[data-id="step_one"]')).toHaveClass(/runtime-enter/);
    const stepOneInputPort = page.locator('svg#ports .svg-port[data-state-id="step_one"][data-port-side="in"]');
    await expect(stepOneInputPort).toHaveCount(1);
    await expect(stepOneInputPort).not.toHaveClass(/runtime-enter/);

    await app.getByRole("button", { name: "Continue" }).click();
    await expect(app.locator("#statePill")).toHaveText("step_two");
    await expect(page.locator("#layerFrameLabel")).toHaveText("In Lesson");
    await expect(page.locator('[data-id="step_two"]')).toHaveClass(/active/);
    await expect(page.locator('[data-id="step_one"]')).toHaveClass(/runtime-exit/);
    await expect(page.locator('[data-id="step_two"]')).toHaveClass(/runtime-enter/);
    await expect(app.getByRole("button", { name: "Lesson" })).toHaveCount(0);
    await app.getByRole("button", { name: "Finish" }).click();
    await expect(app.locator("#statePill")).toHaveText("done");
    await expect(page.locator("#layerFrameLabel")).toHaveText("Wurzel");
    await expect(page.locator('[data-id="step_two"]')).toHaveCount(0);
    await expect(page.locator('[data-id="done"]')).toHaveClass(/active/);
    await expect(page.locator('[data-id="done"]')).toHaveClass(/runtime-enter/);
    const doneEdge = page.locator('.edge[data-edge-id="lesson_done"]');
    await expect(doneEdge).toHaveClass(/runtime-pulse/);
    await expect(doneEdge).toHaveClass(/runtime-pulse-[ab]/);
    await expect(doneEdge).not.toHaveCSS("animation-name", "none");
    await expect(doneEdge.evaluate(el => el.style.strokeDashoffset)).resolves.toBe("");
  });

  test("starts runtime state highlight without waiting for the next host animation frame @smoke", async ({ page }) => {
    await openTool(page);
    await page.evaluate(() => {
      window.__heldRuntimeRafs = [];
      window.__realRuntimeRequestAnimationFrame = window.requestAnimationFrame;
      window.__realRuntimeCancelAnimationFrame = window.cancelAnimationFrame;
      window.requestAnimationFrame = callback => {
        window.__heldRuntimeRafs.push(callback);
        return window.__heldRuntimeRafs.length;
      };
      window.cancelAnimationFrame = () => {};
    });

    const app = appFrame(page);
    await app.getByRole("button", { name: "Login", exact: true }).click();
    await expect(app.locator("#statePill")).toHaveText("login");
    await expect(page.locator('[data-id="login"]')).toHaveClass(/runtime-enter/);
    await expect(page.locator('.edge[data-edge-id="t_auth_login"]')).toHaveClass(/runtime-pulse/);

    await page.evaluate(() => {
      const callbacks = window.__heldRuntimeRafs || [];
      window.requestAnimationFrame = window.__realRuntimeRequestAnimationFrame || window.requestAnimationFrame;
      window.cancelAnimationFrame = window.__realRuntimeCancelAnimationFrame || window.cancelAnimationFrame;
      const now = performance.now();
      while (callbacks.length) callbacks.shift()(now);
    });
  });

  test("collapse creates a real parent and recursively traverses nested child proxies @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "Real Parent Collapse",
      initial: "start",
      states: [
        { id: "start", title: "Start", body: "", components: [{ id: "c_start", type: "text", text: "Start screen", url: "" }], x: 120, y: 180 },
        { id: "parent_a", title: "Parent A", body: "", components: [], boundary: { entryId: "leaf", exitId: "leaf", entryDisabled: false, exitDisabled: false }, x: 420, y: 120 },
        { id: "leaf", parentId: "parent_a", title: "Leaf", body: "", components: [{ id: "c_leaf", type: "text", text: "Nested leaf", url: "" }], x: 360, y: 120 },
        { id: "state_b", title: "State B", body: "", components: [{ id: "c_b", type: "text", text: "Second grouped screen", url: "" }], x: 420, y: 300 },
        { id: "done", title: "Done", body: "", components: [{ id: "c_done", type: "text", text: "Done screen", url: "" }], x: 720, y: 180 }
      ],
      transitions: [
        { id: "start_parent", from: "start", to: "parent_a", label: "Open Nested", condition: "", set: {} },
        { id: "parent_b", from: "parent_a", to: "state_b", label: "Continue", condition: "", set: {} },
        { id: "b_done", from: "state_b", to: "done", label: "Finish", condition: "", set: {} },
        { id: "done_start", from: "done", to: "start", label: "Restart", condition: "", set: {} }
      ]
    };
    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    await expect(page.locator('[data-id="start"]')).toBeVisible();
    await page.locator('[data-id="parent_a"]').click();
    await page.locator('[data-id="state_b"]').click({ modifiers: ["Shift"] });
    await expect(page.locator("#selectionCount")).toContainText("2 Zustaende");
    await expect(page.locator("#btnSelectionCollapse")).toHaveText("Gruppieren");
    await page.locator("#btnSelectionCollapse").click();
    await expect(page.locator('[data-id="group"]')).toBeVisible();
    await expect(page.locator('[data-id="parent_a"]')).toHaveCount(0);
    await expect(page.locator('[data-id="state_b"]')).toHaveCount(0);
    await expect.poll(async () => {
      const stored = await savedModel(page);
      const byId = id => stored.states.find(state => state.id === id);
      const edge = id => stored.transitions.find(transition => transition.id === id);
      const definition = await page.evaluate(() => JSON.parse(JSON.stringify(definitionPayload().model)));
      const runtime = await page.evaluate(() => JSON.parse(JSON.stringify(snapshotModelForRuntime())));
      return {
        hasEditorGroups: "editorGroups" in stored || "editorGroups" in definition || "editorGroups" in runtime,
        groupBoundary: byId("group")?.boundary || null,
        parentAParent: byId("parent_a")?.parentId || null,
        leafParent: byId("leaf")?.parentId || null,
        stateBParent: byId("state_b")?.parentId || null,
        startParent: { from: edge("start_parent")?.from, to: edge("start_parent")?.to, groupEntryId: edge("start_parent")?.groupEntryId || "" },
        parentB: { from: edge("parent_b")?.from, to: edge("parent_b")?.to },
        bDone: { from: edge("b_done")?.from, to: edge("b_done")?.to, groupExitId: edge("b_done")?.groupExitId || "" }
      };
    }).toEqual({
      hasEditorGroups: false,
      groupBoundary: expect.objectContaining({
        entryId: "parent_a",
        exitId: "state_b",
        entryDisabled: false,
        exitDisabled: false,
        entryTriggerType: "auto"
      }),
      parentAParent: "group",
      leafParent: "parent_a",
      stateBParent: "group",
      startParent: { from: "start", to: "group", groupEntryId: "parent_a" },
      parentB: { from: "parent_a", to: "state_b" },
      bDone: { from: "group", to: "done", groupExitId: "state_b" }
    });

    const app = appFrame(page);
    await page.evaluate(() => startAppAtState("start", { preserveFocus: true, allowLayerFollow: true }));
    await expect(app.locator("#statePill")).toHaveText("start");
    await app.getByRole("button", { name: "Open Nested", exact: true }).click();
    await expect(app.locator("#statePill")).toHaveText("parent_a");
    await expect(page.locator("#layerFrameLabel")).toHaveText("In Group");
    await expect(page.locator('[data-id="parent_a"]')).toHaveClass(/active/);
    await app.getByRole("button", { name: "Leaf", exact: true }).click();
    await expect(app.locator("#statePill")).toHaveText("leaf");
    await expect(page.locator("#layerFrameLabel")).toHaveText("In Parent A");
    await expect(page.locator('[data-id="leaf"]')).toHaveClass(/active/);
    await app.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(app.locator("#statePill")).toHaveText("state_b");
    await expect(page.locator("#layerFrameLabel")).toHaveText("In Group");
    await app.getByRole("button", { name: "Finish", exact: true }).click();
    await expect(app.locator("#statePill")).toHaveText("done");
  });

  test("edits collapsed parent child-entry trigger without creating hidden transitions @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "Parent Entry Trigger",
      initial: "start",
      states: [
        { id: "start", title: "Start", components: [], x: 120, y: 180 },
        { id: "parent", title: "Parent", components: [], boundary: { entryId: "child", exitId: "child", entryDisabled: false, exitDisabled: false }, x: 420, y: 180 },
        { id: "child", title: "Child", components: [], parentId: "parent", x: 160, y: 140 }
      ],
      transitions: [
        { id: "start_parent", from: "start", to: "parent", label: "Open Parent", condition: "", set: {} }
      ]
    };
    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    await expect(page.locator('[data-id="start"]')).toBeVisible();
    await openStateInspector(page, "parent");

    const childEntryId = "__runtime_enter_child:parent:child";
    const transitionSelect = page.locator("#pStateFlowTransition");
    const triggerType = page.locator("#pStateTriggerType");
    await expect(transitionSelect).toHaveValue(childEntryId);
    await expect(transitionSelect.locator("option")).toContainText(["Child (Eingang)"]);
    await expect(triggerType).toBeEnabled();
    await expect(triggerType).toHaveValue("button");

    const app = appFrame(page);
    await page.evaluate(() => startAppAtState("start", { preserveFocus: true, suppressLayerFollow: true }));
    await expect(app.locator("#statePill")).toHaveText("start");
    await app.getByRole("button", { name: "Open Parent", exact: true }).click();
    await expect(app.locator("#statePill")).toHaveText("parent");
    await expect(app.getByRole("button", { name: "Child", exact: true })).toBeVisible();

    await triggerType.selectOption("auto");
    await expect.poll(async () => {
      const stored = await savedModel(page);
      const parent = stored.states.find(state => state.id === "parent");
      return {
        transitionCount: stored.transitions.length,
        syntheticTransitions: stored.transitions.filter(transition => String(transition.id || "").startsWith("__runtime_enter_child")).length,
        entryTriggerType: parent?.boundary?.entryTriggerType || "",
        entryTriggerEvent: parent?.boundary?.entryTriggerEvent || ""
      };
    }).toEqual({
      transitionCount: 1,
      syntheticTransitions: 0,
      entryTriggerType: "auto",
      entryTriggerEvent: "auto.runtime.enter.child.parent.child"
    });

    await page.evaluate(() => startAppAtState("start", { preserveFocus: true, suppressLayerFollow: true }));
    await expect(app.locator("#statePill")).toHaveText("start");
    await app.getByRole("button", { name: "Open Parent", exact: true }).click();
    await expect(app.locator("#statePill")).toHaveText("child");
    await expect(app.getByRole("button", { name: "Child", exact: true })).toHaveCount(0);
  });

  test("lists real selected-state outs and nested parent proxy outs in the state trigger dropdown @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "Nested Outgoing Inspector",
      initial: "start",
      states: [
        { id: "start", title: "Start", components: [], x: 90, y: 180 },
        { id: "parent", title: "Parent", components: [], boundary: { entryId: "child", exitId: "nested", entryDisabled: false, exitDisabled: false }, x: 330, y: 180 },
        { id: "done", title: "Done", components: [], x: 690, y: 120 },
        { id: "retry", title: "Retry", components: [], x: 690, y: 300 },
        { id: "child", title: "Child", components: [], parentId: "parent", x: 90, y: 120 },
        { id: "nested", title: "Nested", components: [], parentId: "parent", boundary: { entryId: "leaf", exitId: "leaf", entryDisabled: false, exitDisabled: false }, x: 360, y: 160 },
        { id: "leaf", title: "Leaf", components: [], parentId: "nested", x: 120, y: 150 },
        { id: "leaf_local", title: "Leaf local", components: [], parentId: "nested", x: 360, y: 150 }
      ],
      transitions: [
        { id: "start_parent", from: "start", to: "parent", label: "Open Parent", condition: "", set: {} },
        { id: "parent_done", from: "parent", to: "done", label: "Finish Parent", condition: "", set: {} },
        { id: "parent_retry", from: "parent", to: "retry", label: "Retry Parent", condition: "", set: {} },
        { id: "child_nested", from: "child", to: "nested", label: "Open Nested", condition: "", set: {} },
        { id: "t_leaf_local", from: "leaf", to: "leaf_local", label: "Leaf Local", condition: "", set: {} }
      ]
    };
    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    await expect(page.locator('[data-id="start"]')).toBeVisible();

    await openStateInspector(page, "parent");
    const parentOptions = await page.locator("#pStateFlowTransition option").evaluateAll(options =>
      options.map(option => ({ value: option.value, text: option.textContent || "" }))
    );
    expect(parentOptions.map(option => option.value)).toEqual([
      "parent_done",
      "parent_retry",
      "__runtime_enter_child:parent:child"
    ]);
    expect(parentOptions.map(option => option.text)).toContain("Child (Eingang)");
    await page.locator("#pStateFlowTransition").selectOption("parent_retry");
    await page.locator("#pStateTriggerType").selectOption("timer");
    await expect.poll(async () => {
      const stored = await savedModel(page);
      const transition = stored.transitions.find(item => item.id === "parent_retry");
      const parent = stored.states.find(item => item.id === "parent");
      return {
        transitionCount: stored.transitions.length,
        syntheticTransitions: stored.transitions.filter(item => String(item.id || "").startsWith("__runtime_enter_child")).length,
        parentBoundaryTrigger: parent?.boundary?.entryTriggerType || "",
        retryTrigger: transition?.triggerType,
        retryEvent: transition?.triggerEvent
      };
    }).toEqual({
      transitionCount: 5,
      syntheticTransitions: 0,
      parentBoundaryTrigger: "",
      retryTrigger: "timer",
      retryEvent: "timer.parent.retry.done"
    });

    await openStateLayer(page, "parent");
    await openStateLayer(page, "nested");
    await openStateInspector(page, "leaf");
    const leafOptions = await page.locator("#pStateFlowTransition option").evaluateAll(options =>
      options.map(option => ({ value: option.value, text: option.textContent || "" }))
    );
    expect(leafOptions.map(option => option.value)).toEqual(["t_leaf_local", "parent_done", "parent_retry"]);
    expect(leafOptions.map(option => option.text)).toContain("Finish Parent -> Done (Ausgang)");
    expect(leafOptions.map(option => option.text)).toContain("Retry Parent -> Retry (Ausgang)");
  });

  test("child output proxy stops when the collapsed parent has no real outgoing transition @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "Collapsed Stop",
      initial: "start",
      states: [
        { id: "start", title: "Start", components: [{ id: "c_start", type: "text", text: "Start screen", url: "" }], x: 120, y: 180 },
        { id: "one", title: "One", components: [{ id: "c_one", type: "text", text: "First grouped screen", url: "" }], x: 420, y: 120 },
        { id: "two", title: "Two", components: [{ id: "c_two", type: "text", text: "Second grouped screen", url: "" }], x: 420, y: 300 }
      ],
      transitions: [
        { id: "start_one", from: "start", to: "one", label: "Open One", condition: "", set: {} },
        { id: "one_two", from: "one", to: "two", label: "Open Two", condition: "", set: {} }
      ]
    };
    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");

    await page.locator('[data-id="one"]').click();
    await page.locator('[data-id="two"]').click({ modifiers: ["Shift"] });
    await page.locator("#btnSelectionCollapse").click();
    await expect(page.locator('[data-id="group"]')).toBeVisible();
    await expect(page.locator('[data-id="one"]')).toHaveCount(0);
    const app = appFrame(page);
    await page.evaluate(() => startAppAtState("start", { preserveFocus: true, suppressLayerFollow: true }));
    await expect(app.locator("#statePill")).toHaveText("start");
    await app.getByRole("button", { name: "Open One", exact: true }).click();
    await expect(app.locator("#statePill")).toHaveText("one");
    await app.getByRole("button", { name: "Open Two", exact: true }).click();
    await expect(app.locator("#statePill")).toHaveText("two");
    await expect(app.locator("#screen button[data-transition-id]")).toHaveCount(0);
    await expect.poll(async () => {
      const stored = await savedModel(page);
      return {
        twoParent: stored.states.find(state => state.id === "two")?.parentId || null,
        groupOut: stored.transitions.filter(transition => transition.from === "group" && !transition.boundaryFlow).length
      };
    }).toEqual({
      twoParent: "group",
      groupOut: 0
    });
  });

  test("degroup restores the real parent collapse without editor metadata @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "Degroup Contract",
      initial: "start",
      states: [
        { id: "start", title: "Start", components: [], x: 120, y: 180 },
        { id: "one", title: "One", components: [], boundary: { entryId: "one_child", exitId: "one_child", entryDisabled: false, exitDisabled: false }, x: 420, y: 120 },
        { id: "one_child", parentId: "one", title: "One child", components: [], x: 360, y: 120 },
        { id: "two", title: "Two", components: [], x: 420, y: 300 },
        { id: "done", title: "Done", components: [], x: 720, y: 180 }
      ],
      transitions: [
        { id: "start_one", from: "start", to: "one", label: "Open One", condition: "", set: {} },
        { id: "one_two", from: "one", to: "two", label: "Open Two", condition: "", set: {} },
        { id: "two_done", from: "two", to: "done", label: "Finish", condition: "", set: {} }
      ]
    };
    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    const beforeDegroup = await page.evaluate(() => JSON.parse(JSON.stringify(definitionPayload().model)));
    const beforeDegroupOrder = {
      states: beforeDegroup.states.map(state => state.id),
      transitions: beforeDegroup.transitions.map(transition => transition.id)
    };
    await page.locator('[data-id="one"]').click();
    await page.locator('[data-id="two"]').click({ modifiers: ["Shift"] });
    await page.locator("#btnSelectionCollapse").click();
    await expect(page.locator('[data-id="group"]')).toBeVisible();
    await page.locator('[data-id="group"]').click();
    await expect(page.locator("#btnSelectionCollapse")).toHaveText("Gruppe aufloesen");
    await page.locator("#btnSelectionCollapse").click();
    await expect(page.locator('[data-id="group"]')).toHaveCount(0);
    await expect(page.locator('[data-id="one"]')).toBeVisible();
    await expect(page.locator('[data-id="two"]')).toBeVisible();

    await expect.poll(async () => {
      const stored = await savedModel(page);
      const edge = id => stored.transitions.find(transition => transition.id === id);
      return {
        hasEditorGroups: "editorGroups" in stored,
        parents: Object.fromEntries(stored.states.map(state => [state.id, state.parentId || null])),
        startOne: { from: edge("start_one")?.from, to: edge("start_one")?.to, groupEntryId: edge("start_one")?.groupEntryId || "" },
        twoDone: { from: edge("two_done")?.from, to: edge("two_done")?.to, groupExitId: edge("two_done")?.groupExitId || "" }
      };
    }).toEqual({
      hasEditorGroups: false,
      parents: { start: null, one: null, one_child: "one", two: null, done: null },
      startOne: { from: "start", to: "one", groupEntryId: "" },
      twoDone: { from: "two", to: "done", groupExitId: "" }
    });
    await expect.poll(async () => page.evaluate(() => {
      const model = JSON.parse(JSON.stringify(definitionPayload().model));
      return {
        model,
        stateOrder: model.states.map(state => state.id),
        transitionOrder: model.transitions.map(transition => transition.id)
      };
    })).toEqual({
      model: beforeDegroup,
      stateOrder: beforeDegroupOrder.states,
      transitionOrder: beforeDegroupOrder.transitions
    });
  });

  test("keeps transition wires scoped to the opened state canvas @smoke", async ({ page }) => {
    await openTool(page);
    const rootEdgeCount = await page.locator(".edge[data-edge-id]").count();

    await openStateLayer(page, "login");
    const firstChildId = await addChildByDoubleClick(page, "login");
    const secondChildId = await addChildByDoubleClick(page, "login", [firstChildId]);
    const firstPort = await centerOf(statePort(page, firstChildId, "out"));
    const secondBox = await visibleBox(page.locator(`[data-id="${secondChildId}"]`));
    await page.mouse.move(firstPort.x, firstPort.y);
    await page.mouse.down();
    await page.mouse.move(secondBox.x + 8, secondBox.y + secondBox.height / 2, { steps: 12 });
    await page.mouse.up();

    await expect(page.locator("#layerFrameLabel")).toHaveText("In Login");
    await expect(page.locator(".node")).toHaveCount(4);
    await expect(page.locator(`[data-id="${firstChildId}"]`)).toBeVisible();
    await expect(page.locator(`[data-id="${secondChildId}"]`)).toBeVisible();
    const innerEdgeId = await page.evaluate(({ key, from, to }) => {
      const stored = JSON.parse(localStorage.getItem(`${key}.editor`) || localStorage.getItem(key) || "null");
      const model = stored?.model || stored;
      return model.transitions.find(transition => transition.from === from && transition.to === to)?.id || "";
    }, { key: STORAGE_KEY, from: firstChildId, to: secondChildId });
    expect(innerEdgeId).toBeTruthy();

    await page.locator("#layerBack").click();
    await expect(page.locator("#layerFrame")).toBeVisible();
    await expect(page.locator("#layerFrameLabel")).toHaveText("Wurzel");
    await expect(page.locator(".edge[data-edge-id]")).toHaveCount(rootEdgeCount);
    await expect(page.locator(`.edge[data-edge-id="${innerEdgeId}"]`)).toHaveCount(0);

    await openStateLayer(page, "login");
    await expect(page.locator("#layerFrameLabel")).toHaveText("In Login");
    await expect(page.locator(`.edge[data-edge-id="${innerEdgeId}"]`)).toHaveCount(1);
  });

  test("drops state explorer presets into a state's inner canvas", async ({ page }) => {
    await openTool(page);

    await addComponentState(page, "Text");
    await page.locator("#pTitle").fill("Inner lesson");
    await componentEditor(page, "Text").locator("textarea").fill("Nested preset text");
    const sourceId = await page.locator(".node.selected").getAttribute("data-id");
    await dragNodeToStateExplorer(page, page.locator(`[data-id="${sourceId}"]`));
    await page.locator(`[data-id="${sourceId}"]`).click();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Delete");

    const preset = page.locator(".state-template-card").filter({ hasText: "Inner lesson" });
    await expect(preset).toBeVisible();

    const login = page.locator('[data-id="login"]');
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await preset.dispatchEvent("dragstart", { dataTransfer, bubbles: true, cancelable: true });
    await login.dispatchEvent("dragover", { dataTransfer, bubbles: true, cancelable: true });
    await expect(login).toHaveClass(/inner-drop-target/);
    await login.dispatchEvent("drop", { dataTransfer, bubbles: true, cancelable: true });

    await expect(login.locator(".layer-badge")).toHaveText("1 state");
    await openStateLayer(page, "login");
    await expect(page.locator("#layerFrameLabel")).toHaveText("In Login");
    await expect(canvasStateNodes(page)).toHaveCount(1);
    await expect(canvasStateNodes(page).locator(".title")).toHaveText("Inner lesson");
    await canvasStateNodes(page).first().click();
    await expandComponentEditor(page, "Text");
    await expect(componentEditor(page, "Text").locator("textarea")).toHaveValue("Nested preset text");

    await expect.poll(async () => {
      const model = await savedModel(page);
      const child = model.states.find(state => state.title === "Inner lesson");
      return {
        parentId: child?.parentId,
        text: child?.components.find(component => component.type === "text")?.text
      };
    }).toEqual({ parentId: "login", text: "Nested preset text" });

    await page.locator("#layerBack").click();
    await expect(page.locator('[data-id="login"] .layer-badge')).toHaveText("1 state");
    await expect(canvasStateNodes(page)).toHaveCount(6);
    await expect(boundaryProxyNodes(page)).toHaveCount(2);
  });

  test("reparents a dragged canvas state into a hovered state canvas @smoke", async ({ page }) => {
    await openTool(page);

    const source = page.locator('[data-id="register"]');
    const target = page.locator('[data-id="login"]');
    const sourceCenter = await centerOf(source);
    const targetCenter = await centerOf(target);
    await page.mouse.move(sourceCenter.x, sourceCenter.y);
    await page.mouse.down();
    await page.mouse.move(targetCenter.x, targetCenter.y, { steps: 16 });
    await expect(target).toHaveClass(/inner-drop-target/);
    await page.mouse.up();

    await expect(page.locator('[data-id="register"]')).toHaveCount(0);
    await expect(target).toHaveClass(/has-children/);
    await expect(target.locator(".layer-badge")).toHaveText("1 state");

    await expect.poll(async () => {
      const model = await savedModel(page);
      const state = model.states.find(item => item.id === "register");
      const parent = model.states.find(item => item.id === "login");
      const byId = Object.fromEntries(model.transitions.map(transition => [transition.id, transition]));
      const boundaryFlows = model.transitions
        .filter(transition => transition.boundaryFlow?.parentId === "login")
        .map(transition => [transition.boundaryFlow.side, transition.from, transition.to])
        .sort((a, b) => a[0].localeCompare(b[0]));
      return {
        parentId: state?.parentId,
        entryId: parent?.boundary?.entryId,
        exitId: parent?.boundary?.exitId,
        boundaryFlows,
        authRegister: {
          from: byId.t_auth_register?.from,
          to: byId.t_auth_register?.to,
          groupEntryId: byId.t_auth_register?.groupEntryId || ""
        },
        registerSuccess: {
          from: byId.t_register_success?.from,
          to: byId.t_register_success?.to,
          groupExitId: byId.t_register_success?.groupExitId || ""
        },
        registerError: {
          from: byId.t_register_error?.from,
          to: byId.t_register_error?.to,
          groupExitId: byId.t_register_error?.groupExitId || ""
        }
      };
    }).toEqual({
      parentId: "login",
      entryId: "register",
      exitId: "register",
      boundaryFlows: [
        ["input", "proxy:login:input:__boundary_input", "register"],
        ["output", "register", "proxy:login:output:__boundary_output"]
      ],
      authRegister: { from: "auth_start", to: "login", groupEntryId: "register" },
      registerSuccess: { from: "login", to: "logged_in", groupExitId: "register" },
      registerError: { from: "login", to: "error", groupExitId: "register" }
    });

    await openStateLayer(page, "login");
    await expect(page.locator("#layerFrameLabel")).toHaveText("In Login");
    await expect(canvasStateNodes(page)).toHaveCount(1);
    await expect(page.locator('[data-id="register"]')).toBeVisible();
    await expect(boundaryProxyNodes(page)).toHaveCount(2);
    await expect(page.locator('.edge[data-edge-id="t_auth_register"]')).toHaveCount(1);
    await expect(page.locator('.edge[data-edge-id="t_register_success"]')).toHaveCount(1);
    await expect(page.locator('.edge[data-edge-id="t_register_error"]')).toHaveCount(1);
  });

  test("preserves inner state canvases when a state is saved to and reused from the explorer", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"]').click();
    await openStateLayer(page, "login");
    await addComponentState(page, "Text");
    await componentEditor(page, "Text").locator("textarea").fill("Reusable nested child");
    const originalChildId = await page.locator(".node.selected").getAttribute("data-id");
    await page.keyboard.press("Alt+ArrowLeft");

    await dragNodeToStateExplorer(page, page.locator('[data-id="login"]'));
    const preset = page.locator(".state-template-card").filter({ hasText: "Login" });
    await expect(preset).toBeVisible();
    await expect.poll(async () => {
      const templates = await savedStateTemplates(page);
      return {
        childCount: templates[0]?.states?.length,
        childText: templates[0]?.states?.find(state => state.id === originalChildId)?.components?.[0]?.text
      };
    }).toEqual({ childCount: 1, childText: "Reusable nested child" });

    await preset.getByRole("button", { name: "Verwenden" }).click();
    const reusedId = await page.locator(".node.selected").getAttribute("data-id");
    await expect(page.locator(`[data-id="${reusedId}"] .layer-badge`)).toHaveText("1 state");
    await openStateLayer(page, reusedId);
    await expect(canvasStateNodes(page)).toHaveCount(1);
    await expect(boundaryProxyNodes(page)).toHaveCount(2);
    await expect(nodeByTitle(page, "Text")).toBeVisible();
    await nodeByTitle(page, "Text").click();
    await expandComponentEditor(page, "Text");
    await expect(componentEditor(page, "Text").locator("textarea")).toHaveValue("Reusable nested child");
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.parentId === reusedId)?.components?.[0]?.text;
    }).toBe("Reusable nested child");
  });

  test("keeps invalid data and transition set JSON out of the saved model", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"] .node-edit').click();
    await openInitialValuesEditor(page);
    await expect(page.locator("#pData")).toBeVisible();
    await page.locator("#pData").click();
    await page.locator("#pData").fill('{"userName":"Ada"}');
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.id === "login").data.userName;
    }).toBe("Ada");
    await page.locator("#pData").fill('{"userName":');
    await expect(page.locator("#pDataPreview")).toContainText("Unexpected end of JSON input");

    let model = await savedModel(page);
    expect(model.states.find(state => state.id === "login").data).toEqual({ userName: "Ada" });

    await page.keyboard.press("Escape");
    await page.locator("svg text.edge-label").filter({ hasText: /^Einloggen/ }).click();
    await page.locator("#pSetVariableName").fill("role");
    await page.locator("#pSetVariableAdd").click();
    await page.locator('.state-variable-row[data-transition-set-path="role"] [data-transition-set-value="true"]').fill("admin");
    await openInspectorDetails(page, "#pTransitionRawSetCard");
    await page.locator("#pSet").fill('{"role":');
    await expect(page.locator("#pSetPreview")).toContainText("Unexpected end of JSON input");

    model = await savedModel(page);
    expect(model.transitions.find(transition => transition.label === "Einloggen").set).toEqual({ role: "admin" });
  });

  test("persists newly added component text immediately and renders it in preview", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"]').click();
    await openInitialValuesEditor(page);
    await page.locator("#pData").fill('{"userName":"Ada"}');
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.id === "login").data.userName;
    }).toBe("Ada");
    await openStateLayer(page, "login");
    await addComponentState(page, "Note");
    await componentEditor(page, "Note").locator("textarea").fill("Manual note for {{userName}}");

    await expect.poll(async () => {
      const model = await savedModel(page);
      const note = model.states.find(state => state.parentId === "login" && state.title === "Note");
      return note?.components.find(component => component.type === "note")?.text || "";
    }).toBe("Manual note for {{userName}}");

    await page.keyboard.press("Alt+ArrowLeft");
    await page.locator('[data-id="login"]').click();
    await expect(appFrame(page).getByText("Manual note for Ada")).toBeVisible();
  });

  test("keeps selected state screen blocks collapsed and reorderable @smoke", async ({ page }) => {
    const model = defaultTestModel();
    const screen = model.states.find(state => state.id === "auth_start");
    screen.data = { widget: { label: "Save" } };
    screen.components = [
      { id: "heading_block", type: "heading", text: "Title", url: "" },
      { id: "text_block", type: "text", text: "Body", url: "" },
      { id: "widget_block", type: "daisy", variant: "button", dataPath: "widget", dataLabel: "Save button", text: "", url: "" }
    ];
    await openTool(page, { model });
    await openStateInspector(page, "auth_start");

    await expect(page.locator("#pRenderCard > summary")).toContainText("Darstellung");
    await expect(page.getByText("Daisy UI")).toHaveCount(0);
    await expect(componentEditor(page, "Heading")).not.toHaveAttribute("open", "");
    await expect(componentEditor(page, "Text")).not.toHaveAttribute("open", "");
    await expect(componentEditor(page, "Widget: Save button")).not.toHaveAttribute("open", "");
    await expect(componentEditor(page, "Heading").locator("input")).toBeHidden();

    await componentEditor(page, "Heading").getByRole("button", { name: "Ueberschrift nach unten verschieben" }).click();
    await expect.poll(async () => {
      const saved = await savedModel(page);
      return saved.states.find(state => state.id === "auth_start").components
        .filter(component => component.type !== "transitionButton")
        .map(component => component.type);
    }).toEqual(["text", "heading", "daisy"]);

    await expandComponentEditor(page, "Heading");
    await expect(componentEditor(page, "Heading").locator("input")).toBeVisible();
  });

  test("collapses state and render categories independently @smoke", async ({ page }) => {
    await openTool(page);
    await openStateInspector(page, "auth_start");

    const stateCard = page.locator("#pStateBasicsCard");
    const renderCard = page.locator("#pRenderCard");
    await expect(stateCard).toHaveJSProperty("open", true);
    await expect(renderCard).toHaveJSProperty("open", true);
    await expect(page.locator("#pTitle")).toBeVisible();
    await expect(componentEditor(page, "Text")).toBeVisible();

    await stateCard.locator("summary").first().click();
    await expect(stateCard).toHaveJSProperty("open", false);
    await expect(page.locator("#pTitle")).toBeHidden();
    await expect(componentEditor(page, "Text")).toBeVisible();

    await renderCard.locator("summary").first().click();
    await expect(renderCard).toHaveJSProperty("open", false);
    await expect(componentEditor(page, "Text")).toBeHidden();

    await stateCard.locator("summary").first().click();
    await renderCard.locator("summary").first().click();
    await expect(page.locator("#pTitle")).toBeVisible();
    await expect(componentEditor(page, "Text")).toBeVisible();
  });

  test("keeps state action controls inside the inspector drawer @smoke", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 820 });
    await openTool(page);
    await openStateInspector(page, "auth_start");

    await expect(page.locator("#pActionsCard > summary")).toContainText("Aktionen");
    await expect(page.locator("#pActionsCard")).toHaveJSProperty("open", true);
    await expect(page.getByRole("button", { name: "Komponente exportieren" })).toBeVisible();
    await expect(page.locator("#pExportState .state-action-label")).toHaveText("Exportieren");
    await expect(page.locator("#pImportState .state-action-label")).toHaveText("Importieren");
    await expect(page.locator("#pInitial")).toHaveClass(/active/);
    await expect(page.locator("#pInitial")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => page.locator("#stateInspectorBody").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

    const bounds = await page.locator("#pActionsCard").evaluate(card => {
      const inspector = card.closest(".inspector");
      const inspectorRect = inspector.getBoundingClientRect();
      return [...card.querySelectorAll("button")].map(button => {
        const rect = button.getBoundingClientRect();
        return {
          id: button.id,
          left: rect.left,
          right: rect.right,
          inspectorLeft: inspectorRect.left,
          inspectorRight: inspectorRect.right
        };
      });
    });
    for (const button of bounds) {
      expect(button.left).toBeGreaterThanOrEqual(button.inspectorLeft);
      expect(button.right).toBeLessThanOrEqual(button.inspectorRight);
    }

    await page.evaluate(() => showNodeInspector(byId("register"), { forceOpen: true }));
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Register");
    await expect(page.locator("#pInitial")).not.toHaveClass(/active/);
    await expect(page.locator("#pInitial")).toHaveAttribute("aria-pressed", "false");
    await page.locator("#pInitial").click();
    await expect(page.locator("#pInitial")).toHaveClass(/active/);
    await expect(page.locator("#pInitial")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await savedModel(page)).initial).toBe("register");
  });

  test("syncs render editor changes to preview without reloading the state @smoke", async ({ page }) => {
    await openTool(page);
    await openStateInspector(page, "auth_start");

    await expect(appFrame(page).getByText("User chooses login or registration.")).toBeVisible();
    await expandComponentEditor(page, "Text");
    await componentEditor(page, "Text").locator("textarea").fill("Live render update");
    await expect(appFrame(page).getByText("Live render update")).toBeVisible();

    await componentEditor(page, "Text").getByRole("button", { name: "Loeschen" }).click();
    await expect(appFrame(page).getByText("Live render update")).toHaveCount(0);
    await expect(appFrame(page).getByRole("button", { name: "Login" })).toBeVisible();
  });

  test("image component preset starts with a visible placeholder image @smoke", async ({ page }) => {
    await openTool(page);
    await openStateLayer(page, "login");

    const imageStateId = await addComponentState(page, "Image");
    const imageUrl = await componentEditor(page, "Image").locator("input").nth(1).inputValue();
    expect(imageUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(imageUrl).not.toBe("https://");

    await expect.poll(async () => {
      const model = await savedModel(page);
      const state = model.states.find(item => item.id === imageStateId);
      return state?.components.find(component => component.type === "image")?.url || "";
    }).toBe(imageUrl);

    await page.keyboard.press("Alt+ArrowLeft");
    await page.locator('[data-id="login"]').click();
    const image = appFrame(page).locator(".component-image").first();
    await expect(image).toHaveAttribute("alt", "Bildbeschreibung");
    await expect(image).toHaveAttribute("src", imageUrl);
    await expect(image).toBeVisible();
  });

  test("persists every state component field across reopening and renders them in the app", async ({ page }) => {
    test.setTimeout(45000);
    await openTool(page);
    const imageUrl = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjAiIGhlaWdodD0iNjAiPjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iNjAiIGZpbGw9IiMyNTYzZWIiLz48L3N2Zz4=";

    await page.locator('[data-id="login"]').click();
    await openInitialValuesEditor(page);
    await page.locator("#pData").fill('{"userName":"Ada"}');
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.id === "login").data.userName;
    }).toBe("Ada");

    await openStateLayer(page, "login");
    await addComponentState(page, "Heading");
    await componentEditor(page, "Heading").locator("input").fill("Account heading {{userName}}");

    await addComponentState(page, "Text");
    await componentEditor(page, "Text").locator("textarea").fill("Body paragraph for {{userName}}");

    await addComponentState(page, "Image");
    await componentEditor(page, "Image").locator("input").nth(0).fill("Chart for {{userName}}");
    await componentEditor(page, "Image").locator("input").nth(1).fill(imageUrl);

    await addComponentState(page, "List");
    const listEditor = componentEditor(page, "List");
    await listEditor.locator(".list-item-editor input").nth(0).fill("First step for {{userName}}");
    await listEditor.locator(".list-item-editor input").nth(1).fill("Second step");
    await listEditor.locator(".component-add-item").click();
    await expect(listEditor.locator(".list-item-editor input")).toHaveCount(5);
    await listEditor.locator(".list-item-editor input").nth(4).fill("Third persisted step");

    await addComponentState(page, "Link");
    await componentEditor(page, "Link").locator("input").nth(0).fill("Docs for {{userName}}");
    await componentEditor(page, "Link").locator("input").nth(1).fill("https://example.com/{{userName}}/docs");

    await addComponentState(page, "Note");
    await componentEditor(page, "Note").locator("textarea").fill("Note survives for {{userName}}");

    await addComponentState(page, "Divider");

    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.filter(state => state.parentId === "login").map(state => ({
        title: state.title,
        type: state.components[0]?.type,
        text: state.components[0]?.text,
        url: state.components[0]?.url
      }));
    }).toEqual([
      { title: "Heading", type: "heading", text: "Account heading {{userName}}", url: "" },
      { title: "Text", type: "text", text: "Body paragraph for {{userName}}", url: "" },
      { title: "Image", type: "image", text: "Chart for {{userName}}", url: imageUrl },
      { title: "List", type: "list", text: "First step for {{userName}}\nSecond step\nAttach evidence\nMark done\nThird persisted step", url: "" },
      { title: "Link", type: "link", text: "Docs for {{userName}}", url: "https://example.com/{{userName}}/docs" },
      { title: "Note", type: "note", text: "Note survives for {{userName}}", url: "" },
      { title: "Divider", type: "divider", text: "", url: "" }
    ]);

    await page.keyboard.press("Alt+ArrowLeft");
    await page.locator('[data-id="login"]').click();
    await openStateLayer(page, "login");

    await nodeByTitle(page, "Heading").click();
    await expect(componentEditor(page, "Heading").locator("input")).toHaveValue("Account heading {{userName}}");
    await nodeByTitle(page, "Text").click();
    await expect(componentEditor(page, "Text").locator("textarea")).toHaveValue("Body paragraph for {{userName}}");
    await nodeByTitle(page, "Image").click();
    await expect(componentEditor(page, "Image").locator("input").nth(0)).toHaveValue("Chart for {{userName}}");
    await expect(componentEditor(page, "Image").locator("input").nth(1)).toHaveValue(imageUrl);
    await nodeByTitle(page, "List").click();
    await expect(componentEditor(page, "List").locator(".list-item-editor input")).toHaveCount(5);
    await expect(componentEditor(page, "List").locator(".list-item-editor input").nth(0)).toHaveValue("First step for {{userName}}");
    await expect(componentEditor(page, "List").locator(".list-item-editor input").nth(1)).toHaveValue("Second step");
    await expect(componentEditor(page, "List").locator(".list-item-editor input").nth(2)).toHaveValue("Attach evidence");
    await expect(componentEditor(page, "List").locator(".list-item-editor input").nth(3)).toHaveValue("Mark done");
    await expect(componentEditor(page, "List").locator(".list-item-editor input").nth(4)).toHaveValue("Third persisted step");
    await nodeByTitle(page, "Link").click();
    await expect(componentEditor(page, "Link").locator("input").nth(0)).toHaveValue("Docs for {{userName}}");
    await expect(componentEditor(page, "Link").locator("input").nth(1)).toHaveValue("https://example.com/{{userName}}/docs");
    await nodeByTitle(page, "Note").click();
    await expect(componentEditor(page, "Note").locator("textarea")).toHaveValue("Note survives for {{userName}}");
    await nodeByTitle(page, "Divider").click();
    await expect(componentEditor(page, "Divider")).toBeVisible();

    await page.keyboard.press("Alt+ArrowLeft");
    await page.locator('[data-id="login"]').click();

    const app = appFrame(page);
    await expect(app.getByRole("heading", { name: "Account heading Ada" })).toBeVisible();
    await expect(app.getByText("Body paragraph for Ada")).toBeVisible();
    await expect(app.locator(".component-image")).toHaveAttribute("alt", "Chart for Ada");
    await expect(app.locator(".component-image")).toHaveAttribute("src", imageUrl);
    await expect(app.getByText("First step for Ada")).toBeVisible();
    await expect(app.getByText("Second step")).toBeVisible();
    await expect(app.getByText("Attach evidence")).toBeVisible();
    await expect(app.getByText("Mark done")).toBeVisible();
    await expect(app.getByText("Third persisted step")).toBeVisible();
    await expect(app.getByRole("link", { name: "Docs for Ada" })).toHaveAttribute("href", "https://example.com/Ada/docs");
    await expect(app.getByText("Note survives for Ada")).toBeVisible();
    await expect(app.locator('[role="separator"]')).toHaveCount(1);
  });

  test("keeps the preview app in its flow after external link clicks @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "External Link Flow",
      initial: "docs",
      states: [
        {
          id: "docs",
          title: "Docs",
          body: "",
          x: 120,
          y: 160,
          components: [{ id: "docs_link", type: "link", text: "Dokumentation öffnen", url: "https://example.com/docs" }]
        },
        {
          id: "details",
          title: "Details",
          body: "",
          x: 460,
          y: 160,
          components: [{ id: "details_text", type: "note", text: "Still inside the preview flow", url: "" }]
        }
      ],
      transitions: [
        { id: "to_details", from: "docs", to: "details", label: "Details", condition: "", set: {} }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    await page.evaluate(() => {
      window.__openedExternalUrls = [];
      window.open = (url, target, features) => {
        window.__openedExternalUrls.push({ url: String(url), target: String(target || ""), features: String(features || "") });
        return { closed: false, postMessage() {}, focus() {} };
      };
    });

    const app = appFrame(page);
    await expect(page.locator('[data-id="docs"]')).toBeVisible();
    await expect(app.locator("#statePill")).toHaveText("docs");
    const docsLink = app.getByRole("link", { name: "Dokumentation öffnen" });
    await expect(docsLink).toHaveAttribute("href", "https://example.com/docs");
    await expect(docsLink).toHaveCSS("text-decoration-line", "none");
    const runtimeUrl = await app.locator("#statePill").evaluate(() => window.location.href);

    await docsLink.click();
    await expect.poll(() => page.evaluate(() => window.__openedExternalUrls?.[0]?.url || "")).toBe("https://example.com/docs");
    await expect(app.locator("#statePill")).toHaveText("docs");
    await expect(docsLink).toBeVisible();
    await expect.poll(() => app.locator("#statePill").evaluate(() => window.location.href)).toBe(runtimeUrl);

    await page.locator("#appFrame").evaluate(frame => {
      frame.src = "data:text/html,<p>escaped external document</p>";
    });
    await page.locator('[data-id="details"]').click();
    await expect(app.locator("#statePill")).toHaveText("details");
    await expect(app.getByText("Still inside the preview flow")).toBeVisible();
  });

  test("preserves runtime inputs while editing the current state and clears them only on reset", async ({ page }) => {
    await openTool(page);
    const app = appFrame(page);

    await page.locator('[data-id="login"]').click();
    await app.locator(".field").filter({ hasText: "email" }).locator("input").fill("draft@example.com");
    await app.locator(".field").filter({ hasText: "password" }).locator("input").fill("draft-secret");

    await page.locator('[data-id="login"] .node-edit').click();
    await openInitialValuesEditor(page);
    await expect(page.locator("#pData")).toBeVisible();
    await page.locator("#pData").fill('{"helperText":"Resume safely"}');
    await openStateLayer(page, "login");
    await addComponentState(page, "Note");
    await componentEditor(page, "Note").locator("textarea").fill("Helper: {{helperText}}");
    await page.keyboard.press("Alt+ArrowLeft");

    await expect(app.getByText("Helper: Resume safely")).toBeVisible();
    await expect(app.locator(".field").filter({ hasText: "email" }).locator("input")).toHaveValue("draft@example.com");
    await expect(app.locator(".field").filter({ hasText: "password" }).locator("input")).toHaveValue("draft-secret");

    await page.getByRole("button", { name: "App zuruecksetzen" }).click();
    await expect(app.locator("#statePill")).toHaveText("auth_start");
    await page.locator('[data-id="login"]').click();
    await expect(app.locator(".field").filter({ hasText: "email" }).locator("input")).toHaveValue("");
    await expect(app.locator(".field").filter({ hasText: "password" }).locator("input")).toHaveValue("");
    await expect(app.getByText("Helper: Resume safely")).toBeVisible();
  });

  test("pauses runtime timers through the global state bus and resumes with play @smoke", async ({ page }) => {
    const model = defaultTestModel();
    model.transitions.push({
      id: "t_auth_auto_done",
      from: "auth_start",
      to: "logged_in",
      label: "Auto done",
      condition: "",
      triggerType: "timer",
      triggerEvent: "",
      timerMs: 1000,
      set: {}
    });
    await openTool(page, { model, pauseRuntime: true });
    const app = appFrame(page);

    await expect(page.getByRole("button", { name: "Fortsetzen" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#runtimeState")).toContainText("Pausiert: auth_start");
    await expect.poll(async () => (await runtimeContext(page)).runtime?.paused).toBe(true);

    await page.waitForTimeout(1250);
    await expect(app.locator("#statePill")).toHaveText("auth_start");
    await expect(page.locator('[data-id="auth_start"]')).toHaveClass(/active/);

    await page.getByRole("button", { name: "Fortsetzen" }).click();
    await expect(page.getByRole("button", { name: "Pausieren" })).toHaveAttribute("aria-pressed", "false");
    await expect.poll(async () => (await runtimeContext(page)).runtime?.paused).toBe(false);
    await expect(app.locator("#statePill")).toHaveText("logged_in", { timeout: 2400 });
    await expect(page.locator("#runtimeState")).toContainText("Zustand: logged_in");
  });

  test("pauses runtime change events without queueing stale transitions @smoke", async ({ page }) => {
    const model = defaultTestModel();
    model.transitions.push({
      id: "t_auth_email_change",
      from: "login",
      to: "logged_in",
      label: "Email changed",
      condition: "email != \"\"",
      triggerType: "change",
      triggerEvent: "change.email",
      set: {}
    });
    await openTool(page, { model });
    const app = appFrame(page);

    await page.locator('[data-id="login"]').click();
    await expect(app.locator("#statePill")).toHaveText("login");
    await page.getByRole("button", { name: "Pausieren" }).click();
    await expect.poll(async () => (await runtimeContext(page)).runtime?.paused).toBe(true);
    const eventCountBeforePause = (await runtimeContext(page)).events?.change?.email?.count || 0;
    const emailInput = app.locator(".field").filter({ hasText: "email" }).locator("input");
    await expect(emailInput).toBeVisible();
    await emailInput.fill("paused@example.com");
    await expect.poll(async () => (await runtimeContext(page)).email).toBe("paused@example.com");
    await expect.poll(async () => (await runtimeContext(page)).events?.change?.email?.count || 0).toBe(eventCountBeforePause);
    await page.waitForTimeout(300);
    await expect(app.locator("#statePill")).toHaveText("login");

    await page.getByRole("button", { name: "Fortsetzen" }).click();
    await expect.poll(async () => (await runtimeContext(page)).runtime?.paused).toBe(false);
    await page.waitForTimeout(300);
    await expect(app.locator("#statePill")).toHaveText("login");
    await expect.poll(async () => (await runtimeContext(page)).events?.change?.email?.count || 0).toBe(eventCountBeforePause);
  });

  test("loads the default model and starts preview from a selected state", async ({ page }) => {
    await openTool(page);

    await expect(appFrame(page).getByRole("heading", { name: "Auth start" })).toBeVisible();

    await page.locator('[data-id="login"]').click();

    await expect(appFrame(page).locator("#statePill")).toHaveText("login");
    await expect(appFrame(page).getByRole("heading", { name: "Login" })).toBeVisible();
    await expect(page.locator('[data-id="login"]')).toHaveClass(/active/);
  });

  test("uses DOM and SVG as the only canvas renderer", async ({ page }) => {
    await openTool(page);

    await expect(page.locator("#mapCanvas")).toHaveCount(0);
    await expect(canvasStateNodes(page)).toHaveCount(6);
    await expect(boundaryProxyNodes(page)).toHaveCount(2);
    await expect.poll(() => page.locator("#mapScene").evaluate(el => el.parentElement?.id)).toBe("map");
  });

  test("selects states from the canvas and focuses title only from the edit action", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"]').click();
    await expect(page.locator("#stateInspectorBody")).toBeVisible();
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Login");
    await expect(page.locator("#pTitle")).toHaveValue("Login");
    await expect(page.locator("#pTitle")).toHaveAttribute("tabindex", "0");
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(false);
    await expect.poll(() => page.locator("#map").evaluate(el => document.activeElement === el)).toBe(true);
    await expect(page.locator('[data-id="login"]')).toHaveClass(/selected/);
    await expect(appFrame(page).locator("#statePill")).toHaveText("login");

    await page.locator('[data-id="login"] .node-edit').click();
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);
    await page.locator("#pTitle").fill("Sign in");
    await expect(page.locator('[data-id="login"] .title')).toHaveText("Sign in");
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Sign in");
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.id === "login").title;
    }).toBe("Sign in");

    await page.keyboard.press("Enter");
    await expect(page.locator("#pTitle")).toHaveCount(0);
    await expect(page.locator("#stateInspectorBody")).toContainText("Kein Zustand ausgewaehlt");
    await expect(page.locator('[data-id="login"] .title')).toHaveText("Sign in");

    const reloaded = await page.context().newPage();
    await reloaded.goto("/state.html");
    await expect(reloaded.locator('[data-id="login"] .title')).toHaveText("Sign in");
    await reloaded.locator('[data-id="login"] .node-edit').click();
    await expect(reloaded.locator("#pTitle")).toHaveValue("Sign in");
    await expect.poll(() => reloaded.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);
    await reloaded.close();
  });

  test("keeps inspector collapsible and switches between state and transition properties", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"] .node-edit').click();
    await expect(page.locator("#pTitle")).toBeVisible();
    await expect(page.locator("#pTitle")).toHaveValue("Login");
    const mapBefore = await visibleBox(page.locator("#map"));

    await page.locator("#btnToggleInspector").click();
    await expect(page.locator(".workspace")).toHaveClass(/inspector-collapsed/);
    await expect(page.locator("#btnToggleInspector")).toHaveAttribute("aria-label", "Expand state inspector");
    await expect(page.locator("#pTitle")).toBeHidden();
    const mapCollapsed = await visibleBox(page.locator("#map"));
    expect(mapCollapsed.width).toBeGreaterThan(mapBefore.width);

    await page.locator('[data-id="register"]').click();
    await expect(page.locator(".workspace")).toHaveClass(/inspector-collapsed/);
    await expect(page.locator("#stateInspector")).toHaveClass(/inspector-pulse/);
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Register");
    await expect(page.locator("#pTitle")).toBeHidden();

    await page.locator("#btnToggleInspector").click();
    await expect(page.locator(".workspace")).not.toHaveClass(/inspector-collapsed/);
    await expect(page.locator("#pTitle")).toHaveValue("Register");

    const label = page.locator("svg text.edge-label").filter({ hasText: "Login" });
    await expect(label).toHaveCount(1);
    await page.locator("#btnToggleInspector").click();
    await expect(page.locator(".workspace")).toHaveClass(/inspector-collapsed/);
    await label.click();
    await expect(page.locator(".workspace")).toHaveClass(/inspector-collapsed/);
    await expect(page.locator("#stateInspector")).toHaveClass(/transition-inspector/);
    await expect(page.locator("#stateInspector")).toHaveClass(/inspector-pulse/);
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Transition: Login");
    await expect(page.locator("#pLabel")).toBeHidden();
    await page.locator("#btnToggleInspector").click();
    await expect(page.locator("#pLabel")).toBeVisible();
    await expect(page.locator("#pTitle")).toHaveCount(0);
    await expect(page.locator("#stateInspector")).toHaveClass(/transition-inspector/);
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Transition: Login");

    await page.keyboard.press("Escape");
    await page.locator('[data-id="register"]').click();
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Register");
    await expect(page.locator("#pTitle")).toHaveValue("Register");
  });

  test("persists desktop panel and explorer layout across reopening", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 });
    await openTool(page);

    if (await page.locator("#btnToggleInspector").getAttribute("aria-label") === "Collapse state inspector") {
      await page.locator("#btnToggleInspector").click();
    }
    if (await page.locator("#btnTogglePreview").getAttribute("aria-label") === "Collapse app preview") {
      await page.locator("#btnTogglePreview").click();
    }
    if (await page.locator("#btnToggleStateExplorer").getAttribute("aria-label") === "Collapse presets") {
      await page.locator("#btnToggleStateExplorer").click();
    }
    await expect(page.locator(".workspace")).toHaveClass(/inspector-collapsed/);
    await expect(page.locator(".workspace")).toHaveClass(/preview-collapsed/);
    await expect(page.locator("#stateExplorer")).toHaveClass(/collapsed/);

    const uiState = await savedUiState(page);
    expect(uiState).toMatchObject({
      inspectorCollapsed: true,
      previewCollapsed: true,
      stateExplorerCollapsed: true,
      mobileWorkspaceView: "canvas"
    });

    const reopened = await page.context().newPage();
    await reopened.goto("/state.html");
    await expect(reopened.locator('[data-id="auth_start"]')).toBeVisible();
    await expect(reopened.locator(".workspace")).toHaveClass(/inspector-collapsed/);
    await expect(reopened.locator(".workspace")).toHaveClass(/preview-collapsed/);
    await expect(reopened.locator("#stateExplorer")).toHaveClass(/collapsed/);
    await reopened.close();
  });

  test("restores collapsed app preview before the workspace can flash open on reload @smoke", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }      localStorage.setItem(key, JSON.stringify(model));
      localStorage.setItem(`${key}.ui`, JSON.stringify({
        inspectorCollapsed: false,
        previewCollapsed: true,
        stateExplorerCollapsed: false,
        mobileWorkspaceView: "canvas",
        inspectorWidth: 340,
        previewWidth: 520
      }));
      window.__STATE_BLUEPRINT_PREVIEW_STARTUP_SAMPLES = [];
      const sample = reason => {
        const workspace = document.getElementById("workspace");
        const preview = document.querySelector(".preview");
        if (!workspace || !preview) return;
        window.__STATE_BLUEPRINT_PREVIEW_STARTUP_SAMPLES.push({
          reason,
          width: Math.round(preview.getBoundingClientRect().width),
          className: workspace.className,
          attr: document.documentElement.dataset.previewCollapsed || "",
          columns: getComputedStyle(workspace).gridTemplateColumns
        });
      };
      const installObserver = () => {
        if (!document.documentElement) return false;
        const observer = new MutationObserver(() => sample("mutation"));
        observer.observe(document.documentElement, {
          attributes: true,
          childList: true,
          subtree: true,
          attributeFilter: ["class", "data-preview-collapsed"]
        });
        document.addEventListener("DOMContentLoaded", () => sample("domcontentloaded"), { once: true });
        requestAnimationFrame(() => sample("raf"));
        return true;
      };
      if (!installObserver()) {
        new MutationObserver((_, observer) => {
          if (!installObserver()) return;
          observer.disconnect();
        }).observe(document, { childList: true });
      }
    }, { key: STORAGE_KEY, model: defaultTestModel() });

    await page.goto("/state.html");
    await expect(page.locator('[data-id="auth_start"]')).toBeVisible();
    await expect(page.locator(".workspace")).toHaveClass(/preview-collapsed/);
    await expect(page.locator("#btnTogglePreview")).toHaveAttribute("aria-label", "App-Vorschau ausklappen");

    const samples = await page.evaluate(() => window.__STATE_BLUEPRINT_PREVIEW_STARTUP_SAMPLES || []);
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.filter(sample => sample.width > 120 && !sample.className.includes("preview-collapsed"))).toEqual([]);
    expect(samples.some(sample => sample.attr === "true")).toBe(true);
  });

  test("resizes left and right desktop panels as local UI state without touching the model", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 });
    await openTool(page);

    if ((await page.locator("#btnToggleInspector").getAttribute("aria-label") || "").includes("ausklappen")) {
      await page.locator("#btnToggleInspector").click();
    }
    if ((await page.locator("#btnTogglePreview").getAttribute("aria-label") || "").includes("ausklappen")) {
      await page.locator("#btnTogglePreview").click();
    }
    await expect(page.locator(".workspace")).not.toHaveClass(/inspector-collapsed/);
    await expect(page.locator(".workspace")).not.toHaveClass(/preview-collapsed/);
    const beforeModel = await savedModel(page);

    const inspectorHandle = await visibleBox(page.locator("#inspectorResizeHandle"));
    await page.mouse.move(inspectorHandle.x + inspectorHandle.width / 2, inspectorHandle.y + 80);
    await page.mouse.down();
    await page.mouse.move(inspectorHandle.x + inspectorHandle.width / 2 + 84, inspectorHandle.y + 80);
    await page.mouse.up();

    const previewHandle = await visibleBox(page.locator("#previewResizeHandle"));
    await page.mouse.move(previewHandle.x + previewHandle.width / 2, previewHandle.y + 80);
    await page.mouse.down();
    await page.mouse.move(previewHandle.x + previewHandle.width / 2 - 64, previewHandle.y + 80);
    await page.mouse.up();

    const uiState = await savedUiState(page);
    expect(uiState.inspectorWidth).toBeGreaterThan(380);
    expect(uiState.previewWidth).toBeGreaterThan(420);
    expect(await savedModel(page)).toEqual(beforeModel);

    const reopened = await page.context().newPage();
    await reopened.setViewportSize({ width: 1280, height: 820 });
    await reopened.goto("/state.html");
    await expect(reopened.locator('[data-id="auth_start"]')).toBeVisible();
    await expect.poll(async () => reopened.locator("#workspace").evaluate(el => {
      const style = getComputedStyle(el);
      return {
        inspectorWidth: parseFloat(style.getPropertyValue("--inspector-panel-width")),
        previewWidth: parseFloat(style.getPropertyValue("--preview-panel-width"))
      };
    })).toMatchObject({
      inspectorWidth: uiState.inspectorWidth,
      previewWidth: uiState.previewWidth
    });
    await reopened.close();
  });

  test("resizes the tablet state editor without horizontal inspector scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 820 });
    await openTool(page);

    if (await page.locator("#btnToggleInspector").getAttribute("aria-label") === "Expand state inspector") {
      await page.locator("#btnToggleInspector").click();
    }
    await expect(page.locator(".workspace")).not.toHaveClass(/inspector-collapsed/);
    const beforeModel = await savedModel(page);

    const inspectorHandle = await visibleBox(page.locator("#inspectorResizeHandle"));
    await page.mouse.move(inspectorHandle.x + inspectorHandle.width / 2, inspectorHandle.y + 80);
    await page.mouse.down();
    await page.mouse.move(inspectorHandle.x + inspectorHandle.width / 2 + 112, inspectorHandle.y + 80);
    await page.mouse.up();

    const uiState = await savedUiState(page);
    expect(uiState.inspectorWidth).toBeGreaterThan(430);
    expect(await savedModel(page)).toEqual(beforeModel);
    await expect.poll(() => page.locator("#stateInspectorBody").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

    const reopened = await page.context().newPage();
    await reopened.setViewportSize({ width: 900, height: 820 });
    await reopened.goto("/state.html");
    await expect(reopened.locator('[data-id="auth_start"]')).toBeVisible();
    await expect.poll(() => reopened.locator("#workspace").evaluate(el => (
      parseFloat(getComputedStyle(el).getPropertyValue("--inspector-panel-width"))
    ))).toBe(uiState.inspectorWidth);
    await reopened.close();
  });

  test("keeps widescreen tablet side panels shrinkable around the canvas @smoke", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 768 });
    await openTool(page);

    await openStateInspector(page, "auth_start");
    if ((await page.locator("#btnTogglePreview").getAttribute("aria-label") || "").includes("ausklappen")) {
      await page.locator("#btnTogglePreview").click();
    }
    await expect(page.locator(".workspace")).not.toHaveClass(/inspector-collapsed/);
    await expect(page.locator(".workspace")).not.toHaveClass(/preview-collapsed/);
    await expect(page.locator("#previewResizeHandle")).toBeVisible();

    const beforeModel = await savedModel(page);
    const startLayout = await page.locator("#workspace").evaluate(el => {
      const workspace = el.getBoundingClientRect();
      const preview = document.querySelector(".preview")?.getBoundingClientRect();
      const handleStyle = getComputedStyle(document.querySelector("#previewResizeHandle"));
      return {
        columns: getComputedStyle(el).gridTemplateColumns.split(" ").length,
        previewDisplay: handleStyle.display,
        previewTop: Math.round(preview?.top || 0),
        workspaceTop: Math.round(workspace.top)
      };
    });
    expect(startLayout.columns).toBe(3);
    expect(startLayout.previewDisplay).not.toBe("none");
    expect(startLayout.previewTop).toBe(startLayout.workspaceTop);

    const dragHandle = async (selector, dx) => {
      const handle = await visibleBox(page.locator(selector));
      const start = {
        x: handle.x + handle.width / 2,
        y: handle.y + Math.min(96, Math.max(24, handle.height / 2))
      };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + dx, start.y, { steps: 5 });
      await page.mouse.up();
    };

    await dragHandle("#inspectorResizeHandle", -180);
    await dragHandle("#previewResizeHandle", 220);

    await expect.poll(() => page.locator("#workspace").evaluate(el => {
      const style = getComputedStyle(el);
      return {
        inspectorWidth: parseFloat(style.getPropertyValue("--inspector-panel-width")),
        previewWidth: parseFloat(style.getPropertyValue("--preview-panel-width")),
        columns: style.gridTemplateColumns.split(" ").map(value => Math.round(parseFloat(value))).filter(Number.isFinite)
      };
    })).toMatchObject({
      inspectorWidth: 240,
      previewWidth: 240
    });

    const uiState = await savedUiState(page);
    expect(uiState.inspectorWidth).toBe(240);
    expect(uiState.previewWidth).toBe(240);
    expect(await savedModel(page)).toEqual(beforeModel);
  });

  test("sizes each node to fit its title instead of truncating with ellipsis", async ({ page }) => {
    await openTool(page);
    const longTitle = "Collect detailed learner preferences before recommending lessons";

    const registerBefore = await visibleBox(page.locator('[data-id="register"]'));
    await page.locator('[data-id="login"] .node-edit').click();
    await expect(page.locator("#pTitle")).toHaveValue("Login");
    await page.locator("#pTitle").fill(longTitle);
    await expect(page.locator("#pTitle")).toHaveValue(longTitle);
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.id === "login").title;
    }).toBe(longTitle);

    const login = page.locator('[data-id="login"]');
    await expect(login.locator(".title")).toHaveText(longTitle);
    await expect(login.locator(".title")).toHaveCSS("text-overflow", "clip");

    const loginBox = await visibleBox(login);
    expect(loginBox.width).toBeGreaterThan(registerBefore.width + 160);

    const output = await centerOf(statePort(page, "login", "out"));
    expect(Math.abs(output.x - (loginBox.x + loginBox.width))).toBeLessThan(3);

    await page.getByRole("button", { name: "Fit" }).click();
    await assertVisibleInViewport(page, '[data-id="login"]');
  });

  test("clamps canvas state render text to two clean lines", async ({ page }) => {
    const model = defaultTestModel();
    model.states.find(state => state.id === "login").components[0].text =
      "This state has a deliberately long render text preview that should wrap into several visual lines on the canvas, but only two clean lines should stay visible.";
    await openTool(page, { model });

    const body = page.locator('[data-id="login"] .body');
    await expect(body).toContainText("deliberately long render text preview");
    const metrics = await body.evaluate(el => {
      const style = getComputedStyle(el);
      return {
        height: el.getBoundingClientRect().height,
        lineHeight: parseFloat(style.lineHeight),
        overflow: style.overflow,
        textOverflow: style.textOverflow,
        webkitLineClamp: style.webkitLineClamp
      };
    });

    expect(metrics.webkitLineClamp).toBe("2");
    expect(metrics.overflow).toBe("hidden");
    expect(metrics.textOverflow).toBe("ellipsis");
    expect(metrics.height).toBeLessThanOrEqual(metrics.lineHeight * 2 + 1);
  });

  test("keeps state status badges away from the Open node action", async ({ page }) => {
    await openTool(page);

    const chrome = await page.locator('[data-id="auth_start"]').evaluate(node => {
      const rectFor = selector => {
        const el = node.querySelector(selector);
        const style = el ? getComputedStyle(el) : null;
        if (!el || style.display === "none") return null;
        const rect = el.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom
        };
      };
      const overlaps = (a, b) => Boolean(a && b &&
        a.left < b.right &&
        a.right > b.left &&
        a.top < b.bottom &&
        a.bottom > b.top
      );
      const open = rectFor(".node-edit");
      const initial = rectFor(".badge");
      const live = rectFor(".live-badge");
      return {
        open,
        initial,
        live,
        initialOverlapsOpen: overlaps(initial, open),
        liveOverlapsOpen: overlaps(live, open)
      };
    });

    expect(chrome.open).toBeTruthy();
    expect(chrome.initial).toBeTruthy();
    expect(chrome.initialOverlapsOpen).toBe(false);
    expect(chrome.liveOverlapsOpen).toBe(false);
    expect(chrome.initial.right).toBeLessThan(chrome.open.left);
  });

  test("snaps nodes, ports, and transition paths exactly to the canvas grid", async ({ page }) => {
    await openTool(page);

    const assertGridGeometry = async () => {
      const [report, model] = await Promise.all([gridGeometryReport(page), savedModel(page)]);
      const nodes = new Map(report.nodes.map(node => [node.id, node]));

      for (const node of report.nodes) {
        for (const value of [node.left, node.top, node.width, node.height, node.input.x, node.input.y, node.output.x, node.output.y]) {
          expect(gridRemainder(value)).toBe(0);
        }
      }

      for (const path of report.paths) {
        const transition = model.transitions.find(item => item.id === path.id);
        const first = path.points[0];
        const last = path.points[path.points.length - 1];
        const outPin = report.pins.find(pin => pin.id === path.id && pin.side === "out");
        const inPin = report.pins.find(pin => pin.id === path.id && pin.side === "in");

        expect(path.usesOnlyGridLines).toBe(true);
        expect(path.allPointsOnGrid).toBe(true);
        expect(path.allSegmentsOrthogonal).toBe(true);
        expectCleanPortApproach(path);
        expect(outPin).toBeTruthy();
        expect(inPin).toBeTruthy();
        expect(first).toEqual({ x: outPin.x, y: outPin.y });
        expect(last).toEqual({ x: inPin.x, y: inPin.y });
        if (!transition) {
          expect(path.id).toMatch(/^boundary-flow:/);
          continue;
        }
        const from = nodes.get(transition.from);
        const to = nodes.get(transition.to);
        expect(first.x).toBe(from.output.x);
        expect(last.x).toBe(to.input.x);
        expect(gridRemainder(first.y)).toBe(0);
        expect(gridRemainder(last.y)).toBe(0);
      }

      for (const state of model.states) {
        const outgoing = model.transitions.filter(transition => transition.from === state.id);
        const incoming = model.transitions.filter(transition => transition.to === state.id);
        const outStarts = outgoing
          .map(transition => report.paths.find(path => path.id === transition.id)?.points[0])
          .filter(Boolean)
          .map(point => `${point.x},${point.y}`);
        const inEnds = incoming
          .map(transition => report.paths.find(path => path.id === transition.id)?.points.at(-1))
          .filter(Boolean)
          .map(point => `${point.x},${point.y}`);

        expect(new Set(outStarts).size).toBe(outStarts.length);
        expect(new Set(inEnds).size).toBe(inEnds.length);
      }
    };

    await assertGridGeometry();

    const login = page.locator('[data-id="login"]');
    const box = await visibleBox(login);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 37, box.y + box.height / 2 + 29, { steps: 8 });
    await page.mouse.up();

    await expect.poll(async () => {
      const model = await savedModel(page);
      const state = model.states.find(item => item.id === "login");
      return [gridRemainder(state.x), gridRemainder(state.y)];
    }).toEqual([0, 0]);
    await assertGridGeometry();
  });

  test("renders shared transition pins on distinct grid lanes", async ({ page }) => {
    await openTool(page);

    const [report, model] = await Promise.all([gridGeometryReport(page), savedModel(page)]);
    const paths = new Map(report.paths.map(path => [path.id, path]));
    const transitionPath = (from, to) => {
      const transition = model.transitions.find(item => item.from === from && item.to === to);
      expect(transition).toBeTruthy();
      const path = paths.get(transition.id);
      expect(path).toBeTruthy();
      return path;
    };
    const startLogin = transitionPath("auth_start", "login");
    const startRegister = transitionPath("auth_start", "register");
    const loginSuccess = transitionPath("login", "logged_in");
    const registerSuccess = transitionPath("register", "logged_in");

    expect(startLogin.points[0].x).toBe(startRegister.points[0].x);
    expect(startLogin.points[0].y).not.toBe(startRegister.points[0].y);
    expect(startLogin.points[1].y).not.toBe(startRegister.points[1].y);
    const authStartOutputSlots = [startLogin, startRegister].map(path =>
      report.pins.find(pin => pin.id === path.id && pin.side === "out")
    );
    expect(authStartOutputSlots).toHaveLength(2);
    expect(authStartOutputSlots.every(Boolean)).toBe(true);
    expect(new Set(authStartOutputSlots.map(slot => slot.y)).size).toBe(2);
    for (const path of [startLogin, startRegister]) {
      const slot = authStartOutputSlots.find(item => item.id === path.id);
      expect(slot).toBeTruthy();
      expect({ x: slot.x, y: slot.y }).toEqual(path.points[0]);
      expect(slot.fill).toBe(path.stroke);
    }

    const loginEnd = loginSuccess.points.at(-1);
    const registerEnd = registerSuccess.points.at(-1);
    expect(loginEnd.x).toBe(registerEnd.x);
    expect(loginEnd.y).not.toBe(registerEnd.y);
    const loggedInInputSlots = [loginSuccess, registerSuccess].map(path =>
      report.pins.find(pin => pin.id === path.id && pin.side === "in")
    );
    expect(loggedInInputSlots).toHaveLength(2);
    expect(loggedInInputSlots.every(Boolean)).toBe(true);
    expect(new Set(loggedInInputSlots.map(slot => slot.y)).size).toBe(2);
    for (const path of [loginSuccess, registerSuccess]) {
      const slot = loggedInInputSlots.find(item => item.id === path.id);
      expect(slot).toBeTruthy();
      expect({ x: slot.x, y: slot.y }).toEqual(path.points.at(-1));
      expect(slot.fill).toBe(path.stroke);
    }

    for (const transition of model.transitions.filter(item =>
      item.from === "auth_start" ||
      item.to === "logged_in"
    )) {
      expect(report.pins.filter(pin => pin.id === transition.id)).toHaveLength(2);
    }
  });

  test("keeps input arrowheads entering ports from the left after vertical detours", async ({ page }) => {
    await openTool(page);

    const [report, model] = await Promise.all([gridGeometryReport(page), savedModel(page)]);
    const detouredIds = new Set(model.transitions
      .filter(transition =>
        (transition.from === "logged_out" && transition.to === "login") ||
        (transition.from === "error" && transition.to === "auth_start")
      )
      .map(transition => transition.id));
    const detouredPaths = report.paths.filter(path => detouredIds.has(path.id));

    expect(detouredPaths).toHaveLength(2);
    for (const path of detouredPaths) {
      const end = path.points.at(-1);
      const beforeEnd = path.points.at(-2);
      const arrow = report.arrows.find(item => item.id === path.id);

      expect(beforeEnd.y).toBe(end.y);
      expect(beforeEnd.x).toBeLessThan(end.x);
      expect(arrow).toBeTruthy();
      expect(arrow.points[0]).toEqual(end);
      expect(Math.max(...arrow.points.slice(1).map(point => point.x))).toBeLessThan(end.x);
    }
  });

  test("separates overlapping horizontal and vertical cable lanes and colors each path", async ({ page }) => {
    const crossingModel = {
      version: 2,
      name: "Cable management",
      initial: "a",
      states: [
        { id: "a", title: "A", body: "Upper left", x: 96, y: 96 },
        { id: "b", title: "B", body: "Upper right", x: 600, y: 96 },
        { id: "c", title: "C", body: "Lower left", x: 96, y: 288 },
        { id: "d", title: "D", body: "Lower right", x: 600, y: 288 },
        { id: "s", title: "S", body: "Shared source", x: 96, y: 528 },
        { id: "t1", title: "T1", body: "First target", x: 600, y: 720 },
        { id: "t2", title: "T2", body: "Second target", x: 600, y: 768 }
      ],
      transitions: [
        { id: "a_to_d", from: "a", to: "d", label: "A to D", condition: "" },
        { id: "c_to_b", from: "c", to: "b", label: "C to B", condition: "" },
        { id: "s_to_t1", from: "s", to: "t1", label: "S to T1", condition: "" },
        { id: "s_to_t2", from: "s", to: "t2", label: "S to T2", condition: "" }
      ]
    };
    await page.addInitScript(({ key, model }) => {
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.removeItem(`${key}.editor`);
      localStorage.removeItem(`${key}.camera`);
      localStorage.removeItem(`${key}.previewCollapsed`);
      localStorage.removeItem(`${key}.stateExplorer`);
      localStorage.removeItem(`${key}.ui`);
    }, { key: STORAGE_KEY, model: crossingModel });
    await page.goto("/state.html");
    await expect(canvasStateNodes(page)).toHaveCount(7);
    await expect(boundaryProxyNodes(page)).toHaveCount(2);

    const report = await gridGeometryReport(page);
    const paths = new Map(report.paths.map(path => [path.id, path]));
    const diagonalDown = paths.get("a_to_d");
    const diagonalUp = paths.get("c_to_b");
    const sharedSourceFirst = paths.get("s_to_t1");
    const sharedSourceSecond = paths.get("s_to_t2");

    expect(diagonalDown.stroke).not.toBe(diagonalUp.stroke);
    expect(report.pins.filter(pin => pin.id === "a_to_d").map(pin => pin.fill)).toEqual([diagonalDown.stroke, diagonalDown.stroke]);
    expect(report.pins.filter(pin => pin.id === "c_to_b").map(pin => pin.fill)).toEqual([diagonalUp.stroke, diagonalUp.stroke]);
    expect(report.arrows.find(arrow => arrow.id === "a_to_d")?.fill).toBe(diagonalDown.stroke);
    expect(report.arrows.find(arrow => arrow.id === "c_to_b")?.fill).toBe(diagonalUp.stroke);

    const longestHorizontal = path => path.horizontalSegments
      .slice()
      .sort((a, b) => (b.max - b.min) - (a.max - a.min))[0];
    expect(longestHorizontal(diagonalDown).coordinate).not.toBe(longestHorizontal(diagonalUp).coordinate);

    const sharedOutputPins = report.pins
      .filter(pin => ["s_to_t1", "s_to_t2"].includes(pin.id) && pin.side === "out")
      .map(pin => `${pin.x},${pin.y}`);
    expect(new Set(sharedOutputPins).size).toBe(2);

    const userPathIds = new Set(crossingModel.transitions.map(transition => transition.id));
    const userTransitionById = new Map(crossingModel.transitions.map(transition => [transition.id, transition]));
    const segments = report.paths
      .filter(path => userPathIds.has(path.id))
      .flatMap(path => path.segments.map(segment => ({ ...segment, pathId: path.id })));
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        const a = segments[i];
        const b = segments[j];
        if (a.pathId === b.pathId || a.orientation !== b.orientation || a.coordinate !== b.coordinate) continue;
        const transitionA = userTransitionById.get(a.pathId);
        const transitionB = userTransitionById.get(b.pathId);
        const sharesEndpoint = transitionA && transitionB && (
          transitionA.from === transitionB.from ||
          transitionA.to === transitionB.to
        );
        if (sharesEndpoint) continue;
        const overlapLength = Math.max(0, Math.min(a.max, b.max) - Math.max(a.min, b.min));
        expect(overlapLength).toBeLessThanOrEqual(GRID_SIZE);
      }
    }
  });

  test("renders an unobstructed aligned horizontal transition as a straight direct path", async ({ page }) => {
    const directModel = {
      version: 2,
      name: "Direct path",
      initial: "left",
      states: [
        { id: "left", title: "Left", body: "", x: 96, y: 192 },
        { id: "right", title: "Right", body: "", x: 504, y: 192 }
      ],
      transitions: [
        { id: "left_to_right", from: "left", to: "right", label: "Direct", condition: "" }
      ]
    };
    await page.addInitScript(({ key, model }) => {
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.removeItem(`${key}.editor`);
      localStorage.removeItem(`${key}.camera`);
      localStorage.removeItem(`${key}.previewCollapsed`);
      localStorage.removeItem(`${key}.stateExplorer`);
      localStorage.removeItem(`${key}.ui`);
    }, { key: STORAGE_KEY, model: directModel });
    await page.goto("/state.html");
    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(2);

    const report = await gridGeometryReport(page);
    const route = report.paths.find(path => path.id === "left_to_right");
    const nodes = new Map(report.nodes.map(node => [node.id, node]));

    expect(route).toBeTruthy();
    expectCleanPortApproach(route);
    expect(route.points).toHaveLength(2);
    expect(route.points[0]).toEqual(nodes.get("left").output);
    expect(route.points[1]).toEqual(nodes.get("right").input);
    expect(route.points[0].y).toBe(route.points[1].y);
    expect(route.horizontalSegments).toHaveLength(1);
    expect(route.verticalSegments).toHaveLength(0);
  });

  test("uses a short forward bend instead of looping for slightly offset transitions", async ({ page }) => {
    const nearDirectModel = {
      version: 2,
      name: "Short bend path",
      initial: "left",
      states: [
        { id: "left", title: "Left", body: "", x: 96, y: 192 },
        { id: "right", title: "Right", body: "", x: 504, y: 216 }
      ],
      transitions: [
        { id: "left_to_right", from: "left", to: "right", label: "Short", condition: "" }
      ]
    };
    await page.addInitScript(({ key, model }) => {
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.removeItem(`${key}.editor`);
      localStorage.removeItem(`${key}.camera`);
      localStorage.removeItem(`${key}.previewCollapsed`);
      localStorage.removeItem(`${key}.stateExplorer`);
      localStorage.removeItem(`${key}.ui`);
    }, { key: STORAGE_KEY, model: nearDirectModel });
    await page.goto("/state.html");
    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(2);

    const report = await gridGeometryReport(page);
    const route = report.paths.find(path => path.id === "left_to_right");
    const nodes = new Map(report.nodes.map(node => [node.id, node]));
    const startY = nodes.get("left").output.y;
    const endY = nodes.get("right").input.y;

    expect(route).toBeTruthy();
    expectCleanPortApproach(route);
    expect(route.points).toHaveLength(4);
    expect(route.verticalSegments).toHaveLength(1);
    expect(route.horizontalSegments).toHaveLength(2);
    expect(route.points.every(point => point.y >= Math.min(startY, endY) && point.y <= Math.max(startY, endY))).toBe(true);
    expect(report.arrows.find(arrow => arrow.id === "left_to_right")?.fill).toBe(route.stroke);
  });

  test("keeps clear offset transitions on a long port-stub route", async ({ page }) => {
    const offsetModel = {
      version: 2,
      name: "Clean offset route",
      initial: "left",
      states: [
        { id: "left", title: "Left", body: "", x: 96, y: 96 },
        { id: "right", title: "Right", body: "", x: 744, y: 384 }
      ],
      transitions: [
        { id: "left_to_right", from: "left", to: "right", label: "Clean", condition: "" }
      ]
    };
    await page.addInitScript(({ key, model }) => {
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.removeItem(`${key}.editor`);
      localStorage.removeItem(`${key}.camera`);
      localStorage.removeItem(`${key}.previewCollapsed`);
      localStorage.removeItem(`${key}.stateExplorer`);
      localStorage.removeItem(`${key}.ui`);
    }, { key: STORAGE_KEY, model: offsetModel });
    await page.goto("/state.html");
    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(2);

    const report = await gridGeometryReport(page);
    const route = report.paths.find(path => path.id === "left_to_right");

    expect(route).toBeTruthy();
    expectCleanPortApproach(route);
    expect(route.points).toHaveLength(4);
    expect(route.verticalSegments).toHaveLength(1);
    expect(route.horizontalSegments).toHaveLength(2);

    const [start, outStub, inputLane, end] = route.points;
    expect(outStub).toEqual({ x: start.x + GRID_SIZE * 2, y: start.y });
    expect(inputLane).toEqual({ x: outStub.x, y: end.y });
    expect(route.horizontalSegments.some(segment => segment.max - segment.min >= GRID_SIZE * 18)).toBe(true);
  });

  test("routes transition cables around state bounding boxes", async ({ page }) => {
    const obstacleModel = {
      version: 2,
      name: "Obstacle routing",
      initial: "left",
      states: [
        { id: "left", title: "Left", body: "", x: 96, y: 96 },
        { id: "middle", title: "Middle obstacle", body: "A state in the way", x: 384, y: 144 },
        { id: "right", title: "Right", body: "", x: 696, y: 96 }
      ],
      transitions: [
        { id: "left_to_right", from: "left", to: "right", label: "Around", condition: "" }
      ]
    };
    await page.addInitScript(({ key, model }) => {
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.removeItem(`${key}.editor`);
      localStorage.removeItem(`${key}.camera`);
      localStorage.removeItem(`${key}.previewCollapsed`);
      localStorage.removeItem(`${key}.stateExplorer`);
      localStorage.removeItem(`${key}.ui`);
    }, { key: STORAGE_KEY, model: obstacleModel });
    await page.goto("/state.html");
    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(3);

    const [report, model] = await Promise.all([gridGeometryReport(page), savedModel(page)]);
    const transition = model.transitions.find(item => item.id === "left_to_right");
    const route = report.paths.find(path => path.id === "left_to_right");
    const obstacle = report.nodes.find(node => node.id === "middle");
    expect(transition).toBeTruthy();
    expect(route).toBeTruthy();
    expect(obstacle).toBeTruthy();
    expectCleanPortApproach(route);
    expect(route.allPointsOnGrid).toBe(true);
    expect(route.allSegmentsOrthogonal).toBe(true);

    for (const node of report.nodes.filter(item => !item.boundaryProxy && item.id !== transition.from && item.id !== transition.to)) {
      for (const segment of route.segments) {
        expect(segmentIntersectsNode(segment, node, 0)).toBe(false);
      }
    }

    const entersObstacleInterior = route.segments.some(segment => segmentIntersectsNode(segment, obstacle, 0));
    expect(entersObstacleInterior).toBe(false);
  });

  test("keeps dense transition routes out of state bounding boxes", async ({ page }) => {
    const denseObstacleModel = {
      version: 2,
      name: "Dense obstacle routing",
      initial: "left",
      states: [
        { id: "left", title: "Left", body: "", x: 96, y: 96 },
        { id: "middle", title: "Middle obstacle", body: "A state in the way", x: 384, y: 144 },
        { id: "right", title: "Right", body: "", x: 696, y: 96 },
        { id: "a", title: "A", body: "", x: 96, y: 408 },
        { id: "b", title: "B", body: "", x: 360, y: 408 },
        { id: "c", title: "C", body: "", x: 624, y: 408 },
        { id: "d", title: "D", body: "", x: 888, y: 408 },
        { id: "e", title: "E", body: "", x: 1152, y: 408 },
        { id: "f", title: "F", body: "", x: 1416, y: 408 }
      ],
      transitions: [
        { id: "left_to_right", from: "left", to: "right", label: "Around", condition: "" },
        { id: "a_to_b", from: "a", to: "b", label: "A to B", condition: "" },
        { id: "b_to_c", from: "b", to: "c", label: "B to C", condition: "" },
        { id: "c_to_d", from: "c", to: "d", label: "C to D", condition: "" },
        { id: "d_to_e", from: "d", to: "e", label: "D to E", condition: "" },
        { id: "e_to_f", from: "e", to: "f", label: "E to F", condition: "" },
        { id: "f_to_a", from: "f", to: "a", label: "F to A", condition: "" }
      ]
    };
    await page.addInitScript(({ key, model }) => {
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.removeItem(`${key}.editor`);
      localStorage.removeItem(`${key}.camera`);
      localStorage.removeItem(`${key}.previewCollapsed`);
      localStorage.removeItem(`${key}.stateExplorer`);
      localStorage.removeItem(`${key}.ui`);
    }, { key: STORAGE_KEY, model: denseObstacleModel });
    await page.goto("/state.html");
    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(9);

    const report = await gridGeometryReport(page);
    const route = report.paths.find(path => path.id === "left_to_right");
    const obstacle = report.nodes.find(node => node.id === "middle");

    expect(route).toBeTruthy();
    expect(obstacle).toBeTruthy();
    expectCleanPortApproach(route);
    expect(route.allPointsOnGrid).toBe(true);
    expect(route.allSegmentsOrthogonal).toBe(true);
    for (const segment of route.segments) {
      expect(segmentIntersectsNode(segment, obstacle, 0)).toBe(false);
    }
  });

  test("keeps transition cables clear of nearby state bounding boxes", async ({ page }) => {
    const clearanceModel = {
      version: 2,
      name: "Clearance routing",
      initial: "left",
      states: [
        { id: "left", title: "Left", body: "", x: 96, y: 96 },
        { id: "middle", title: "Middle obstacle", body: "", x: 384, y: 240 },
        { id: "right", title: "Right", body: "", x: 696, y: 288 }
      ],
      transitions: [
        { id: "left_to_right", from: "left", to: "right", label: "Avoid box", condition: "" }
      ]
    };
    await page.addInitScript(({ key, model }) => {
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.removeItem(`${key}.editor`);
      localStorage.removeItem(`${key}.camera`);
      localStorage.removeItem(`${key}.previewCollapsed`);
      localStorage.removeItem(`${key}.stateExplorer`);
      localStorage.removeItem(`${key}.ui`);
    }, { key: STORAGE_KEY, model: clearanceModel });
    await page.goto("/state.html");
    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(3);

    const [report, model] = await Promise.all([gridGeometryReport(page), savedModel(page)]);
    const transition = model.transitions.find(item => item.id === "left_to_right");
    const route = report.paths.find(path => path.id === "left_to_right");
    const obstacle = report.nodes.find(node => node.id === "middle");

    expect(route).toBeTruthy();
    expect(obstacle).toBeTruthy();
    expectCleanPortApproach(route);
    expect(route.allSegmentsOrthogonal).toBe(true);
    for (const segment of route.segments) {
      expect(segmentIntersectsNode(segment, obstacle, GRID_SIZE / 2)).toBe(false);
    }
    expect(route.points.some(point => point.y < obstacle.top - GRID_SIZE / 2 || point.y > obstacle.top + obstacle.height + GRID_SIZE / 2)).toBe(true);
    expect(transition).toBeTruthy();
  });

  test("uses tool undo and redo even when an editor input is focused", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"] .node-edit').click();
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);

    await page.locator("#pTitle").fill("Sign in");
    await expect(page.locator('[data-id="login"] .title')).toHaveText("Sign in");
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Control+KeyZ");
    await expect(page.locator('[data-id="login"] .title')).toHaveText("Login");

    await page.keyboard.press("Control+KeyY");
    await expect(page.locator('[data-id="login"] .title')).toHaveText("Sign in");
  });

  test("keeps undo redo deterministic across unchanged saves", async ({ page }) => {
    await openTool(page);
    const undo = page.locator("#btnUndo");
    const redo = page.locator("#btnRedo");

    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();
    await page.evaluate(() => {
      saveModel("test:noop");
      saveModel("test:noop");
      saveSelection("test:noop-selection");
    });
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();

    await openStateInspector(page, "login");
    await page.locator("#pTitle").fill("Sign in");
    await expect(page.locator('[data-id="login"] .title')).toHaveText("Sign in");
    await expect(undo).toBeEnabled();
    await expect(redo).toBeDisabled();

    await undo.click();
    await expect(page.locator('[data-id="login"] .title')).toHaveText("Login");
    await expect(redo).toBeEnabled();
    await page.evaluate(() => saveModel("test:noop-after-undo"));
    await expect(redo).toBeEnabled();

    await redo.click();
    await expect(page.locator('[data-id="login"] .title')).toHaveText("Sign in");
    await expect(redo).toBeDisabled();
  });

  test("keeps undo redo reachable from the canvas history actions @smoke", async ({ page }) => {
    await openTool(page);
    const historyActions = page.locator("#canvasHistoryActions");
    const undo = page.locator("#btnCanvasUndo");
    const redo = page.locator("#btnCanvasRedo");

    await expect(historyActions).toBeVisible();
    await assertVisibleInViewport(page, "#canvasHistoryActions");
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();

    await openStateInspector(page, "login");
    await page.locator("#pTitle").fill("Sign in");
    await expect(page.locator('[data-id="login"] .title')).toHaveText("Sign in");
    await expect(undo).toBeEnabled();
    await expect(redo).toBeDisabled();

    await undo.click();
    await expect(page.locator('[data-id="login"] .title')).toHaveText("Login");
    await expect(redo).toBeEnabled();

    await redo.click();
    await expect(page.locator('[data-id="login"] .title')).toHaveText("Sign in");
    await expect(undo).toBeEnabled();
    await expect(redo).toBeDisabled();
  });

  test("keeps mobile history actions in the bottom tab bar without covering canvas selection @smoke", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://localhost:8124",
      viewport: { width: 390, height: 820 },
      hasTouch: true,
      isMobile: true
    });
    const page = await context.newPage();
    try {
      await openTool(page);
      await expect(page.locator("#canvasHistoryActions")).toBeHidden();
      await expect(page.locator("#btnMobileUndo")).toBeVisible();
      await assertVisibleInViewport(page, "#btnMobileUndo");
      await expect(page.locator("#btnMobileRedo")).toBeVisible();
      await assertVisibleInViewport(page, "#btnMobileRedo");
      await page.locator('[data-id="login"]').tap();
      await expect(page.locator("#selectionActions")).toBeVisible();
      await assertVisibleInViewport(page, "#selectionActions");
      await expect.poll(async () => page.evaluate(() => {
        const map = document.querySelector("#map")?.getBoundingClientRect();
        const selection = document.querySelector("#selectionActions")?.getBoundingClientRect();
        const mobileTabs = document.querySelector("#mobileTabs")?.getBoundingClientRect();
        if (!map || !selection || !mobileTabs) return { inCanvas: false, nearCanvasBottom: false, aboveTabs: false };
        return {
          inCanvas: selection.top >= map.top && selection.bottom <= map.bottom + 1,
          nearCanvasBottom: map.bottom - selection.bottom <= 28,
          aboveTabs: selection.bottom <= mobileTabs.top
        };
      })).toEqual({ inCanvas: true, nearCanvasBottom: true, aboveTabs: true });

      await page.evaluate(() => {
        const state = model.states.find(item => item.id === "login");
        state.title = "Sign in";
        saveModel("test:touch-canvas-history");
        draw();
      });
      await expect(page.locator('[data-id="login"] .title')).toHaveText("Sign in");
      await expect(page.locator("#btnMobileUndo")).toBeEnabled();

      await page.locator("#btnMobileUndo").tap();
      await expect(page.locator('[data-id="login"] .title')).toHaveText("Login");
      await expect(page.locator("#btnMobileRedo")).toBeEnabled();
    } finally {
      await context.close();
    }
  });

  test("keeps state editor focus and tab order predictable", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"] .node-edit').click();
    await expect(page.locator("#pTitle")).toHaveAttribute("tabindex", "0");
    await expect(page.locator("#pData")).toHaveAttribute("tabindex", "-1");
    await expect(page.locator("#pDataSourceUrl")).toHaveAttribute("tabindex", "-1");
    await expect(page.locator("#pRepeatPath")).toHaveAttribute("tabindex", "-1");
    await expect(componentEditor(page, "Text").getByRole("button", { name: "Loeschen" })).toHaveAttribute("tabindex", "0");
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);

    await openInitialValuesEditor(page);
    await openFetchEditor(page);
    await openRepeatEditor(page);
    await expect(page.locator("#pData")).toHaveAttribute("tabindex", "0");
    await expect(page.locator("#pDataSourceUrl")).toHaveAttribute("tabindex", "0");
    await expect(page.locator("#pRepeatPath")).toHaveAttribute("tabindex", "0");
    await expect(page.locator("#pRepeatAs")).toHaveAttribute("tabindex", "-1");
    await expect(page.locator("#pRepeatIndex")).toHaveAttribute("tabindex", "-1");
    await page.locator("#pData").focus();
    await expect.poll(() => page.locator("#pData").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Tab");
    await expect.poll(() => page.locator("#pFetchCard > summary").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Tab");
    await expect.poll(() => page.locator("#pDataSourceUrl").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Tab");
    await expect.poll(() => page.locator("#pDataSourceTarget").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Tab");
    await expect.poll(() => page.locator("#pDataSourceSelect").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Tab");
    await expect.poll(() => page.locator("#pRepeatCard > summary").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Tab");
    await expect.poll(() => page.locator("#pRepeatPath").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Tab");
    await expect.poll(() => page.locator("#pRepeatAdvancedCard > summary").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Tab");
    await expect.poll(() => page.locator("#pSubscriptionPaths button").first().evaluate(el => document.activeElement === el)).toBe(true);
  });

  test("keeps transition editor focus, tab order, and Enter commit close predictable", async ({ page }) => {
    await openTool(page);

    const label = page.locator("svg text.edge-label").filter({ hasText: "Login" });
    await expect(label).toHaveCount(1);
    await label.click();

    await expect(page.locator("#pLabel")).toBeVisible();
    await expect(page.locator("#pLabel")).toHaveAttribute("tabindex", "0");
    await expect(page.locator("#pRuleField")).toHaveAttribute("tabindex", "0");
    await expect(page.locator("#pRuleOperator")).toHaveAttribute("tabindex", "0");
    await expect(page.locator("#pSetVariableName")).toHaveAttribute("tabindex", "0");
    await expect.poll(() => page.locator("#pLabel").evaluate(el => document.activeElement === el)).toBe(true);
    await expect.poll(() => page.locator("#pLabel").evaluate(el => ({
      value: el.value,
      selectionStart: el.selectionStart,
      selectionEnd: el.selectionEnd
    }))).toEqual({
      value: "Login",
      selectionStart: 0,
      selectionEnd: 5
    });
    await page.keyboard.type("Sign in action");
    await expect(page.locator("#pLabel")).toHaveValue("Sign in action");

    await page.keyboard.press("Tab");
    await expect.poll(() => page.locator("#pTriggerType").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Tab");
    await expect.poll(() => page.locator("#pRuleField").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Tab");
    await expect.poll(() => page.locator("#pRuleOperator").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Tab");
    await expect.poll(() => page.locator("#pRuleApply").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Shift+Tab");
    await expect.poll(() => page.locator("#pRuleOperator").evaluate(el => document.activeElement === el)).toBe(true);

    await page.locator("#pLabel").focus();
    await expect.poll(() => page.locator("#pLabel").evaluate(el => document.activeElement === el)).toBe(true);
    await page.keyboard.press("Enter");
    await expect(page.locator("#pLabel")).toHaveCount(0);
    await expect(page.locator("#stateInspectorBody")).toContainText("Kein Zustand ausgewaehlt");
    await expect(page.locator("svg text.edge-label").filter({ hasText: "Sign in action" })).toHaveCount(1);
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.transitions.find(transition => transition.from === "auth_start" && transition.to === "login")?.label;
    }).toBe("Sign in action");
  });

  test("keeps Delete native inside focused editors and deletes selected canvas items after commit", async ({ page }) => {
    await openTool(page);
    const loginEdgeId = await savedModel(page).then(model =>
      model.transitions.find(t => t.from === "auth_start" && t.to === "login").id
    );
    const loginEdge = page.locator(`.edge[data-edge-id="${loginEdgeId}"]`);
    const loginLabel = page.locator(`.edge-label[data-edge-id="${loginEdgeId}"]`);

    await loginLabel.click();
    await expect(loginEdge).toHaveClass(/selected/);
    await expect(loginLabel).toHaveClass(/selected/);
    await expect(page.locator("#pLabel")).toBeVisible();
    await expect.poll(() => page.locator("#pLabel").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Delete");
    await expect(page.locator("#pLabel")).toHaveValue("");
    await expect(loginEdge).toHaveCount(1);
    await expect(loginEdge).toHaveClass(/selected/);
    await expect(loginLabel).toHaveText("To Login");

    await page.keyboard.press("Enter");
    await expect(page.locator("#pLabel")).toHaveCount(0);
    await page.keyboard.press("Delete");
    await expect(loginEdge).toHaveCount(0);
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.transitions.some(t => t.id === loginEdgeId);
    }).toBe(false);

    await openTool(page);
    const login = page.locator('[data-id="login"]');
    await page.locator('[data-id="login"] .node-edit').click();
    await expect(login).toHaveClass(/selected/);
    await expect(page.locator("#pTitle")).toBeVisible();
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Control+A");
    await page.keyboard.press("Delete");
    await expect(login).toHaveCount(1);
    await expect(login).toHaveClass(/selected/);
    await expect(page.locator("#pTitle")).toHaveValue("");

    await page.keyboard.press("Enter");
    await expect(page.locator("#stateInspectorBody")).toContainText("Kein Zustand ausgewaehlt");
    await login.click();
    await expect(login).toHaveClass(/selected/);
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(false);
    await expect.poll(() => page.locator("#map").evaluate(el => document.activeElement === el)).toBe(true);
    await page.keyboard.press("Delete");
    await expect(login).toHaveCount(0);
    await expect(page.locator("#pTitle")).toHaveCount(0);
    await expect(page.locator("#stateInspectorBody")).toContainText("Kein Zustand ausgewaehlt");
    await expect.poll(async () => {
      const model = await savedModel(page);
      return {
        hasLogin: model.states.some(state => state.id === "login"),
        linkedToLogin: model.transitions.some(t => t.from === "login" || t.to === "login")
      };
    }).toEqual({ hasLogin: false, linkedToLogin: false });
  });

  test("highlights hovered transitions with their own cable color", async ({ page }) => {
    await openTool(page);
    const registerEdgeId = await savedModel(page).then(model =>
      model.transitions.find(t => t.from === "auth_start" && t.to === "register").id
    );
    const hit = page.locator(`.hit[data-edge-id="${registerEdgeId}"]`);
    const edge = page.locator(`.edge[data-edge-id="${registerEdgeId}"]`);
    const label = page.locator(`.edge-label[data-edge-id="${registerEdgeId}"]`);
    const pin = page.locator(`.edge-pin[data-edge-id="${registerEdgeId}"]`).first();
    const accent = await page.locator("body").evaluate(el => getComputedStyle(el).getPropertyValue("--accent").trim());
    const accentRgb = await page.evaluate(color => {
      const probe = document.createElement("span");
      probe.style.color = color;
      document.body.appendChild(probe);
      const rgb = getComputedStyle(probe).color;
      probe.remove();
      return rgb;
    }, accent);
    const cableColor = await edge.evaluate(el => getComputedStyle(el).stroke);

    expect(cableColor).not.toBe(accentRgb);

    await hit.evaluate(el => {
      el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, cancelable: true }));
    });
    await expect(edge).toHaveClass(/hovered/);
    await expect(label).toHaveClass(/hovered/);
    await expect.poll(() => edge.evaluate(el => getComputedStyle(el).stroke)).toBe(cableColor);
    await expect.poll(() => label.evaluate(el => getComputedStyle(el).fill)).toBe(cableColor);
    await expect.poll(() => pin.evaluate(el => getComputedStyle(el).fill)).toBe(cableColor);
  });

  test("validates transition conditions and advances only on matching typed inputs", async ({ page }) => {
    await openTool(page);
    const app = appFrame(page);

    await page.locator('[data-id="login"]').click();
    await expect(app.locator("#statePill")).toHaveText("login");

    await app.getByRole("button", { name: "Einloggen" }).click();
    await expect(app.locator(".action.invalid").filter({ hasText: "Einloggen" }).locator(".condition-feedback"))
      .toContainText("Condition not met");
    await expect(app.locator("#statePill")).toHaveText("login");

    await app.locator(".field").filter({ hasText: "email" }).locator("input").fill("user@example.com");
    await app.locator(".field").filter({ hasText: "password" }).locator("input").fill("secret123");
    await app.getByRole("button", { name: "Einloggen" }).click();

    await expect(app.locator("#statePill")).toHaveText("logged_in");
    await expect(app.getByRole("heading", { name: "Logged in" })).toBeVisible();
  });

  test("adds daisy button as a state-scoped global-state preset and prunes it on delete", async ({ page }) => {
    await openTool(page);

    await addComponentState(page, "Aktionsbutton");

    const model = await savedModel(page);
    const buttonState = model.states.find(state => state.title === "Aktionsbutton");
    expect(buttonState).toBeTruthy();
    expect(buttonState.components).toHaveLength(1);

    const component = buttonState.components[0];
    expect(component).toMatchObject({
      type: "daisy",
      variant: "button",
      dataRole: "widget",
      dataLabel: "Aktionsbutton"
    });
    expect(component.html).toBeUndefined();

    const dataEntries = Object.entries(buttonState.data);
    expect(dataEntries).toHaveLength(1);
    const [scopePath, defaults] = dataEntries[0];
    expect(scopePath).toBe(`states.${buttonState.id}`);
    expect(component.dataPath).toBe(scopePath);
    expect(defaults).toMatchObject({
      label: "Continue",
      clicked: false,
      clickedAt: 0
    });
    expect(buttonState.dataTypes?.[scopePath]).toBe("object");
    const transition = model.transitions.find(item => item.from === buttonState.id);
    expect(transition).toBeTruthy();
    expect(transition).toMatchObject({
      label: "Continue",
      triggerType: "button",
      set: { [`${scopePath}.clicked`]: true }
    });
    const nextState = model.states.find(state => state.id === transition.to);
    expect(nextState).toBeTruthy();
    expect(nextState.title).toBe("Next");
    expect(nextState.parentId || null).toBe(buttonState.parentId || null);

    await page.locator(`[data-id="${buttonState.id}"]`).click();
    const app = appFrame(page);
    await expect(app.getByRole("button", { name: "Continue" })).toBeVisible();
    await app.getByRole("button", { name: "Continue" }).click();
    await expect(app.locator("#statePill")).toHaveText(nextState.id);
    await expect.poll(async () => page.evaluate(path => {
      const read = (source, dottedPath) => dottedPath.split(".").reduce((value, key) => value?.[key], source);
      const context = typeof latestRuntimeContext !== "undefined" ? latestRuntimeContext : {};
      return read(context, path);
    }, scopePath)).toMatchObject({
      label: "Continue",
      clicked: true
    });

    await page.locator(`[data-id="${buttonState.id}"]`).click();
    await page.locator("#pDelete").click();
    await expect(page.locator(`[data-id="${buttonState.id}"]`)).toHaveCount(0);
    await expect.poll(async () => page.evaluate(path => {
      const read = (source, dottedPath) => dottedPath.split(".").reduce((value, key) => value?.[key], source);
      const context = typeof latestRuntimeContext !== "undefined" ? latestRuntimeContext : {};
      return read(context, path);
    }, scopePath)).toBeUndefined();
  });

  test("renders daisy toast as a bus-timer message without an implicit button", async ({ page }) => {
    await openTool(page);

    await addComponentState(page, "Toast-Meldung");

    const model = await savedModel(page);
    const toastState = model.states.find(state => state.title === "Toast-Meldung");
    expect(toastState).toBeTruthy();

    const component = toastState.components[0];
    expect(component).toMatchObject({
      type: "daisy",
      variant: "toast",
      dataRole: "widget",
      dataLabel: "Toast-Meldung"
    });

    const dataEntries = Object.entries(toastState.data);
    expect(dataEntries).toHaveLength(1);
    const [scopePath, defaults] = dataEntries[0];
    expect(component.dataPath).toBe(scopePath);
    expect(defaults).toMatchObject({
      visible: true,
      tone: "info",
      message: "New message arrived."
    });
    const dismissTransition = model.transitions.find(transition =>
      transition.from === toastState.id &&
      transition.to === toastState.id &&
      transition.triggerType === "timer"
    );
    expect(dismissTransition).toBeTruthy();
    expect(dismissTransition).toMatchObject({
      label: "Hide toast",
      condition: `${scopePath}.visible == true`,
      timerMs: 3000,
      set: { [`${scopePath}.visible`]: false }
    });
    expect(dismissTransition.triggerEvent).toBe(
      `timer.${dismissTransition.id.replace(/[^a-zA-Z0-9_.:-]+/g, ".").replace(/^\.+|\.+$/g, "").toLowerCase()}.done`
    );

    await page.locator(`[data-id="${toastState.id}"]`).click();
    const toast = appFrame(page).locator(".toast");
    await expect(toast).toBeVisible();
    await expect(toast.locator(".alert.alert-info")).toContainText("New message arrived.");
    await expect(toast.getByRole("button")).toHaveCount(0);
    await expect(toast).toHaveCount(0, { timeout: 4500 });
  });

  test("materializes every built-in daisy preset as a scoped global-state contract @smoke", async ({ page }) => {
    await openTool(page);

    const audit = await page.evaluate(() => builtinStateTemplates()
      .filter(template => (template.components || []).some(component => component.type === "daisy"))
      .map((template, index) => {
        const root = makeStateFromTemplate(template, 120 + index * 4, 120 + index * 4, null);
        return {
          title: template.title,
          rootId: root.id,
          dataKeys: Object.keys(root.data || {}),
          dataSource: root.dataSource || {},
          dataTypes: root.dataTypes || {},
          components: (root.components || [])
            .filter(component => component.type === "daisy")
            .map(component => ({
              variant: component.variant,
              dataPath: component.dataPath,
              data: component.data,
              html: component.html
            }))
        };
      }));

    expect(audit.length).toBeGreaterThan(30);
    for (const preset of audit) {
      expect(preset.dataKeys, preset.title).toHaveLength(1);
      const [scopePath] = preset.dataKeys;
      expect(scopePath, preset.title).toMatch(/^states\.[a-z0-9_]+$/);
      expect(preset.dataTypes[scopePath], preset.title).toBe("object");
      expect(preset.dataSource.target, preset.title).toBe(`states.${preset.rootId}.fetch`);
      expect(preset.components, preset.title).toHaveLength(1);
      expect(preset.components[0].dataPath, preset.title).toBe(scopePath);
      expect(preset.components[0].data, preset.title).toBeUndefined();
      expect(preset.components[0].html, preset.title).toBeUndefined();
    }
  });

  test("autowires every action-capable built-in daisy preset into connected FSM states @smoke", async ({ page }) => {
    await openTool(page);

    const audit = await page.evaluate(() => builtinStateTemplates()
      .filter(template => (template.components || []).some(component => component.type === "daisy"))
      .map(template => {
        loadEditorModel(blankModel(), true);
        const parent = makeState(48, 48, "Parent", null);
        parent.id = "parent";
        model.states.push(parent);
        const instance = instantiateStateTemplate(template, 120, 120, parent.id);
        const root = instance.root;
        const component = root.components.find(item => item.type === "daisy");
        const data = stateScopedComponentData(root, component);
        const expectedLabels = daisyFlowActionLabels(component, data);
        const stateIds = new Set(instance.states.map(state => state.id));
        const transitions = instance.transitions.filter(transition => transition.from === root.id);
        const itemTransitionIds = items => Array.isArray(items)
          ? items.map(item => item && typeof item === "object" && !Array.isArray(item) ? item.transitionId || "" : "")
          : [];
        const structuredActionTransitionIds = (() => {
          const variant = component?.variant || "";
          if (["bottom-navigation", "drawer", "menu", "steps", "tabs"].includes(variant)) return itemTransitionIds(data.items);
          if (variant === "dropdown") return itemTransitionIds(Array.isArray(data.options) ? data.options : data.items);
          if (variant === "navbar") {
            const layout = String(data.layout || "menu-submenu").trim() || "menu-submenu";
            if (layout === "cart-profile") return [data.transitionId || "", ...itemTransitionIds(data.menuItems)];
            if (layout === "search-dropdown") return itemTransitionIds(data.menuItems);
            return [...itemTransitionIds(data.items), ...itemTransitionIds(data.submenu)];
          }
          return [];
        })();
        return {
          id: template.id,
          title: template.title,
          variant: component?.variant || "",
          scopePath: component?.dataPath || "",
          expectedLabels,
          structuredActionTransitionIds,
          breadcrumbTransitionIds: component?.variant === "breadcrumbs" && Array.isArray(data.items)
            ? data.items.slice(0, -1).map(item => item.transitionId || "")
            : [],
          footerTransitionIds: component?.variant === "footer" && Array.isArray(data.columns)
            ? data.columns.flatMap(column => Array.isArray(column.items) ? column.items.map(item => item?.transitionId || "") : [])
            : [],
          simpleActionTransitionId: ["button", "card", "hero", "modal", "checkbox", "toggle"].includes(component?.variant || "")
            ? data.transitionId || ""
            : "",
          pricingTransitionIds: component?.variant === "pricing" && Array.isArray(data.plans)
            ? data.plans.map(plan => plan?.transitionId || "")
            : [],
          featureTransitionIds: component?.variant === "feature-grid" && Array.isArray(data.items)
            ? data.items.map(item => item?.transitionId || "")
            : [],
          featureImages: component?.variant === "feature-grid" && Array.isArray(data.items)
            ? data.items.map(item => item?.image || "")
            : [],
          hasImageTransitionId: component?.variant === "card"
            ? Object.prototype.hasOwnProperty.call(data, "imageTransitionId")
            : false,
          rootParentId: root.parentId || null,
          transitions: transitions.map(transition => {
            const target = instance.states.find(state => state.id === transition.to);
            return {
              id: transition.id,
              label: transition.label,
              fromExists: stateIds.has(transition.from),
              toExists: stateIds.has(transition.to),
              targetTitle: target?.title || "",
              targetParentId: target?.parentId || null,
              triggerType: transition.triggerType,
              triggerEvent: transition.triggerEvent || "",
              timerMs: transition.timerMs,
              condition: transition.condition || "",
              set: transition.set || {}
            };
          })
        };
      }));

    const actionPresets = audit.filter(item => item.expectedLabels.length);
    expect(actionPresets.map(item => item.title)).toEqual([
      "Mobile Fußnavigation",
      "Breadcrumb-Pfad",
      "Aktionsbutton",
      "Produktkarte",
      "Feature-Raster",
      "Preiskarten",
      "Checkbox-Feld",
      "Countdown-Timer",
      "Seitenmenü",
      "Dropdown-Menü",
      "Fusszeile",
      "Hero-Bereich",
      "Hero mit Bild",
      "Hero mit Bild rechts",
      "Hero mit Login-Formular",
      "Hero mit Bild-Overlay",
      "Lade-State",
      "Navigationsmenü",
      "Bestätigungsdialog",
      "Navbar mit Menü",
      "Navbar Suche/Profil",
      "Navbar Shop/Warenkorb",
      "Prozessschritte",
      "Inhalts-Tabs",
      "Schalter"
    ]);

    for (const item of audit) {
      const labels = item.transitions.map(transition => transition.label);
      if (item.variant === "toast") {
        expect(labels, item.title).toEqual(["Toast ausblenden"]);
        expect(item.transitions).toHaveLength(1);
        expect(item.transitions[0]).toMatchObject({
          fromExists: true,
          toExists: true,
          targetTitle: "Toast-Meldung",
          targetParentId: "parent",
          triggerType: "timer",
          timerMs: 3000,
          condition: `${item.scopePath}.visible == true`,
          set: { [`${item.scopePath}.visible`]: false }
        });
        expect(item.transitions[0].triggerEvent, item.title).toBe(
          `timer.${item.transitions[0].id.replace(/[^a-zA-Z0-9_.:-]+/g, ".").replace(/^\.+|\.+$/g, "").toLowerCase()}.done`
        );
        continue;
      }
      expect(labels, item.title).toEqual(item.expectedLabels);
      if (!item.expectedLabels.length) {
        expect(item.transitions, item.title).toEqual([]);
        continue;
      }
      expect(item.rootParentId, item.title).toBe("parent");
      for (const transition of item.transitions) {
        expect(transition.fromExists, item.title).toBe(true);
        expect(transition.toExists, item.title).toBe(true);
        expect(transition.targetTitle, item.title).toBe(
          item.variant === "pricing"
            ? transition.label
            : transition.label
        );
        expect(transition.targetParentId, item.title).toBe("parent");
        expect(Object.keys(transition.set).every(key => key === item.scopePath || key.startsWith(item.scopePath + ".")), item.title).toBe(true);
        if (item.variant === "checkbox" || item.variant === "toggle") {
          expect(transition.condition, item.title).toBe(`${item.scopePath}.checked == true`);
          expect(transition.set, item.title).toEqual({ [`${item.scopePath}.submitted`]: true });
        }
        if (item.variant === "countdown") {
          expect(transition.triggerType, item.title).toBe("change");
          expect(transition.triggerEvent, item.title).toBe(`change.${item.scopePath}.finished`);
          expect(transition.condition, item.title).toBe(`${item.scopePath}.finished == true`);
        }
        if (item.variant === "loading") {
          expect(transition.triggerType, item.title).toBe("timer");
          expect(transition.triggerEvent, item.title).toBe(
            `timer.${transition.id.replace(/[^a-zA-Z0-9_.:-]+/g, ".").replace(/^\.+|\.+$/g, "").toLowerCase()}.done`
          );
          expect(transition.timerMs, item.title).toBe(2000);
          expect(transition.condition, item.title).toBe("");
        }
        if (item.variant === "breadcrumbs") {
          expect(item.breadcrumbTransitionIds, item.title).toEqual(item.transitions.map(t => t.id));
          expect(transition.set, item.title).toEqual({});
        }
        if (item.variant === "footer") {
          expect(item.footerTransitionIds, item.title).toEqual(item.transitions.map(t => t.id));
          expect(transition.set, item.title).toEqual({});
        }
        if (["button", "card", "hero", "modal", "checkbox", "toggle"].includes(item.variant)) {
          expect(item.simpleActionTransitionId, item.title).toBe(item.transitions[0].id);
        }
        if (item.variant === "pricing") {
          expect(item.pricingTransitionIds, item.title).toEqual(item.transitions.map(t => t.id));
          expect(transition.set, item.title).toEqual({ [`${item.scopePath}.selectedPlan`]: transition.label.replace(/\s+kaufen$/i, "") });
        }
        if (item.variant === "feature-grid") {
          expect(item.featureTransitionIds, item.title).toEqual(item.transitions.map(t => t.id));
          expect(item.featureImages, item.title).toEqual([
            expect.stringContaining("images.unsplash.com"),
            expect.stringContaining("images.unsplash.com"),
            expect.stringContaining("images.unsplash.com")
          ]);
          expect(transition.set, item.title).toEqual({ [`${item.scopePath}.selected`]: transition.label });
        }
        if (item.variant === "card") {
          expect(item.hasImageTransitionId, item.title).toBe(false);
        }
        if (item.structuredActionTransitionIds.length) {
          expect(item.structuredActionTransitionIds, item.title).toEqual(item.transitions.map(t => t.id));
        }
        if (["bottom-navigation", "drawer", "dropdown", "menu", "steps", "tabs"].includes(item.variant)) {
          const key = item.variant === "steps" ? "current" : "selected";
          expect(transition.set, item.title).toMatchObject({ [`${item.scopePath}.${key}`]: transition.label });
        }
      }
    }
  });

  test("dropdown preset binds every option to a real transition and click traverses @smoke", async ({ page }) => {
    await openTool(page);

    const stateId = await addComponentState(page, "Dropdown-Menü", { openInspector: false });
    const model = await savedModel(page);
    const state = model.states.find(item => item.id === stateId);
    const transitions = model.transitions.filter(transition => transition.from === stateId);
    const options = state.data[`states.${stateId}`].options;

    expect(transitions.map(transition => transition.label)).toEqual(["Option A", "Option B", "Option C"]);
    expect(options.map(item => item.label)).toEqual(["Option A", "Option B", "Option C"]);
    expect(options.map(item => item.transitionId)).toEqual(transitions.map(transition => transition.id));

    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText(stateId);
    await app.getByRole("button", { name: "Option A" }).first().click();
    const menuButtons = app.locator(".dropdown-content button[data-transition-id]");
    await expect(menuButtons).toHaveCount(3);
    await expect(menuButtons).toHaveText(["Option A", "Option B", "Option C"]);
    await expect.poll(async () => menuButtons.evaluateAll(buttons => buttons.map(button => button.dataset.transitionId || ""))).toEqual(transitions.map(transition => transition.id));

    await menuButtons.nth(1).click();
    await expect(app.locator("#statePill")).toHaveText(transitions[1].to);
  });

  test("keeps all built-in presets named and populated with usable defaults @smoke", async ({ page }) => {
    await openTool(page);

    const audit = await page.evaluate(() => builtinStateTemplates().map(template => {
      const root = makeStateFromTemplate(template, 120, 120, null);
      return {
        id: template.id,
        title: root.title,
        renderMode: root.renderMode,
        components: root.components.map(component => ({
          type: component.type,
          variant: component.variant || "",
          url: component.url || "",
          dataPath: component.dataPath || ""
        })),
        data: root.data,
        dataSource: root.dataSource,
        repeat: root.repeat,
        dataWires: root.dataWires.map(wire => ({
          sourcePath: wire.sourcePath,
          scopePath: wire.scopePath,
          itemPath: wire.itemPath,
          role: wire.role,
          componentType: wire.componentType
        }))
      };
    }));

    const titles = audit.map(item => item.title);
    const daisyVariants = audit.flatMap(item => item.components.map(component => component.variant).filter(Boolean));
    const presetDefaults = JSON.stringify(audit);
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles).not.toContain("Body copy");
    expect(titles).not.toContain("Media image");
    expect(daisyVariants).not.toContain("kbd");
    expect(presetDefaults).not.toMatch(/Provident cupiditate|Box Office News|Hello there|daisyUI|Ada Lovelace|Linus/);
    for (const removedTitle of [
      "Artboard",
      "Chat Bubble",
      "Join",
      "Kbd",
      "Stack",
      "Swap",
      "Theme Controller",
      "Tooltip",
      "Navbar - colors",
      "Hero - reverse figure"
    ]) {
      expect(titles.some(title => title.includes(removedTitle)), removedTitle).toBe(false);
    }

    for (const preset of audit) {
      expect(preset.title.trim(), preset.id).not.toBe("");
      expect(preset.components.length + preset.dataWires.length, preset.title).toBeGreaterThan(0);
      for (const component of preset.components) {
        if (component.type === "image") {
          expect(component.url, preset.title).toMatch(/^(https:\/\/|data:image\/)/);
          expect(component.url, preset.title).not.toBe("https://");
        }
        if (component.type === "daisy") {
          expect(component.dataPath, preset.title).toMatch(/^states\.[a-z0-9_]+$/);
          expect(preset.data[component.dataPath], preset.title).toBeTruthy();
        }
      }
    }

    const contentList = audit.find(item => item.title === "Inhaltsliste");
    const contentListScope = contentList?.dataSource?.target || "";
    const contentListDataPath = `${contentListScope}.data`;
    expect(contentList).toBeTruthy();
    expect(contentListScope).toMatch(/^states\.[a-z0-9_]+\.fetch$/);
    expect(contentList.dataSource.target).toBe(contentListScope);
    expect(contentList.repeat).toEqual({ path: contentListDataPath, as: "item", index: "i", manual: true });
    expect(contentList.data[contentListScope].data).toHaveLength(2);
    expect(contentList.dataWires.map(wire => wire.sourcePath)).toEqual([
      `${contentListDataPath}.image`,
      `${contentListDataPath}.title`,
      `${contentListDataPath}.description`,
      `${contentListDataPath}.price`
    ]);
  });

  test("renders every built-in preset preview without broken images or horizontal page overflow @smoke", async ({ page }) => {
    await openTool(page);

    const templates = await page.evaluate(() => builtinStateTemplates().map((template, index) => ({
      index,
      id: template.id,
      title: template.title,
      variant: (template.components || []).find(component => component.type === "daisy")?.variant || ""
    })));
    expect(templates.length).toBeGreaterThan(40);
    expect(templates.length).toBeLessThan(55);

    for (const template of templates) {
      await page.evaluate(index => showPresetComposer(builtinStateTemplates()[index]), template.index);
      const screen = appFrame(page).locator("#screen");
      if (template.variant) {
        await expect(screen.locator(".daisy-widget").first()).toHaveCount(1);
      } else {
        await expect(screen).toContainText(template.title);
      }
      const metrics = await appFrame(page).locator("body").evaluate(body => {
        const brokenImages = [...document.images]
          .filter(img => !img.complete || img.naturalWidth === 0)
          .map(img => ({ alt: img.alt, src: img.currentSrc || img.src }));
        return {
          brokenImages,
          brokenLocalImages: brokenImages.filter(img => /^data:image\//.test(img.src)),
          hasHorizontalScroll: body.scrollWidth > body.clientWidth + 2,
          scrollHeight: body.scrollHeight,
          clientHeight: document.documentElement.clientHeight,
          text: document.querySelector("#screen")?.innerText || "",
          badges: [...document.querySelectorAll(".daisy-badges .badge")].map(badge => {
            const box = badge.getBoundingClientRect();
            return {
              text: badge.textContent || "",
              className: badge.className,
              width: box.width,
              height: box.height,
              display: getComputedStyle(badge).display
            };
          }),
          avatars: [...document.querySelectorAll(".avatar > div")].map(wrapper => {
            const box = wrapper.getBoundingClientRect();
            return {
              className: wrapper.className,
              width: box.width,
              height: box.height
            };
          }),
          progress: [...document.querySelectorAll("progress")].map(progress => ({
            value: progress.value,
            max: progress.max,
            className: progress.className,
            height: progress.getBoundingClientRect().height,
            dataValue: progress.dataset.value || "",
            cssValue: progress.style.getPropertyValue("--value")
          })),
          rating: [...document.querySelectorAll(".daisy-rating .rating")].map(row => ({
            stars: [...row.querySelectorAll("input.mask.mask-star")].map(star => {
              const style = getComputedStyle(star);
              const box = star.getBoundingClientRect();
              return {
                text: star.textContent || "",
                clipPath: style.clipPath,
                width: box.width,
                height: box.height,
                checked: star.checked,
                type: star.getAttribute("type"),
                name: star.getAttribute("name"),
                filled: star.classList.contains("filled"),
                background: style.backgroundColor
              };
            })
          })),
          accordion: [...document.querySelectorAll(".daisy-accordion")].map(root => ({
            sections: [...root.querySelectorAll(".collapse")].map(section => ({
              className: section.className,
              inputType: section.querySelector('input[type="radio"]')?.type || "",
              inputName: section.querySelector('input[type="radio"]')?.name || "",
              checked: Boolean(section.querySelector('input[type="radio"]')?.checked),
              title: section.querySelector(".collapse-title")?.textContent || "",
              content: section.querySelector(".collapse-content")?.textContent || "",
              buttonCount: section.querySelectorAll("button").length
            }))
          })),
          breadcrumbs: [...document.querySelectorAll(".breadcrumbs")].map(root => ({
            items: [...root.querySelectorAll("li")].map(item => item.textContent || ""),
            linkCount: root.querySelectorAll("a").length,
            buttonCount: root.querySelectorAll('button.breadcrumb-action[type="button"]').length,
            selectCount: root.querySelectorAll("select").length,
            summaryCount: root.querySelectorAll("summary").length,
            currentCount: root.querySelectorAll("span").length
          }))
        };
      });

      expect(metrics.brokenLocalImages, template.title).toEqual([]);
      expect(metrics.hasHorizontalScroll, template.title).toBe(false);
      if (template.id === "builtin_daisy_progress") {
        expect(metrics.text).not.toContain("45%");
        expect(metrics.progress).toEqual([{ value: 45, max: 100, className: "progress progress-primary w-56", height: 8, dataValue: "45", cssValue: "45%" }]);
      }
      if (template.id === "builtin_daisy_rating") {
        expect(metrics.rating).toHaveLength(1);
        expect(metrics.rating[0].stars).toHaveLength(5);
        expect(metrics.rating[0].stars.map(star => star.text)).toEqual(["", "", "", "", ""]);
        expect(metrics.rating[0].stars.every(star => star.clipPath !== "none")).toBe(true);
        expect(metrics.rating[0].stars.map(star => star.filled)).toEqual([true, true, true, false, false]);
        expect(metrics.rating[0].stars.map(star => star.type)).toEqual(["radio", "radio", "radio", "radio", "radio"]);
        expect(metrics.rating[0].stars.map(star => star.checked)).toEqual([false, false, true, false, false]);
        expect(new Set(metrics.rating[0].stars.map(star => star.name)).size).toBe(1);
      }
      if (template.id === "builtin_daisy_accordion") {
        expect(metrics.accordion).toHaveLength(1);
        expect(metrics.accordion[0].sections).toHaveLength(2);
        expect(metrics.accordion[0].sections.map(section => section.title)).toEqual(["Versand", "Rückgabe"]);
        expect(metrics.accordion[0].sections.map(section => section.inputType)).toEqual(["radio", "radio"]);
        expect(new Set(metrics.accordion[0].sections.map(section => section.inputName)).size).toBe(1);
        expect(metrics.accordion[0].sections.map(section => section.checked)).toEqual([true, false]);
        expect(metrics.accordion[0].sections.map(section => section.buttonCount)).toEqual([0, 0]);
      }
      if (template.id === "builtin_daisy_avatar") {
        expect(metrics.text).toContain("MK");
        expect(metrics.brokenImages, template.title).toEqual([]);
        expect(metrics.avatars).toContainEqual(expect.objectContaining({
          className: expect.stringContaining("w-16"),
          width: 64,
          height: 64
        }));
      }
      if (template.id === "builtin_daisy_badge") {
        expect(metrics.badges).toEqual([expect.objectContaining({
          text: "Neu",
          className: expect.stringContaining("badge-primary")
        })]);
        expect(["inline-flex", "flex"]).toContain(metrics.badges[0].display);
        expect(metrics.badges[0].width).toBeLessThan(96);
      }
      if (template.id === "builtin_daisy_breadcrumbs") {
        expect(metrics.breadcrumbs).toEqual([{
          items: ["Start", "Projekte", "Aktuell"],
          linkCount: 0,
          buttonCount: 2,
          selectCount: 0,
          summaryCount: 0,
          currentCount: 1
        }]);
      }
      if (template.id === "builtin_content_list") {
        expect(metrics.brokenImages, template.title).toEqual([]);
        expect(metrics.scrollHeight, template.title).toBeLessThanOrEqual(metrics.clientHeight + 20);
      }
    }
  });

  test("renders breadcrumb preset items from its scoped global state after adding it to the canvas @smoke", async ({ page }) => {
    await openTool(page);

    const stateId = await addComponentState(page, "Breadcrumb-Pfad", { openInspector: false });
    const scopePath = `states.${stateId}`;
    const model = await savedModel(page);
    const state = model.states.find(item => item.id === stateId);
    expect(state).toBeTruthy();
    const breadcrumbTransitions = model.transitions.filter(transition => transition.from === stateId);
    expect(breadcrumbTransitions.map(transition => transition.label)).toEqual(["Start", "Projekte"]);
    expect(state.data[scopePath].items.map(item => item.label)).toEqual(["Start", "Projekte", "Aktuell"]);
    expect(state.data[scopePath].items.map(item => item.transitionId || "")).toEqual([
      breadcrumbTransitions[0].id,
      breadcrumbTransitions[1].id,
      ""
    ]);
    expect(state.components[0]).toMatchObject({
      type: "daisy",
      variant: "breadcrumbs",
      dataPath: scopePath
    });

    await expect.poll(async () => {
      const context = await runtimeContext(page);
      return (context.states?.[stateId]?.items || []).map(item => ({
        label: item.label,
        transitionId: item.transitionId || ""
      }));
    }).toEqual([
      { label: "Start", transitionId: breadcrumbTransitions[0].id },
      { label: "Projekte", transitionId: breadcrumbTransitions[1].id },
      { label: "Aktuell", transitionId: "" }
    ]);

    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText(stateId);
    await expectRenderedBreadcrumbs(app, ["Start", "Projekte", "Aktuell"], {
      transitionIds: breadcrumbTransitions.map(transition => transition.id)
    });
    await expect(app.locator(".breadcrumbs select, .breadcrumbs summary, .breadcrumbs a")).toHaveCount(0);
    await expect.poll(async () => app.locator(".breadcrumbs button.breadcrumb-action").nth(1).evaluate(button => {
      const style = getComputedStyle(button);
      return {
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        boxShadow: style.boxShadow,
        filter: style.filter,
        transform: style.transform
      };
    })).toEqual({
      backgroundColor: "rgba(0, 0, 0, 0)",
      backgroundImage: "none",
      boxShadow: "none",
      filter: "none",
      transform: "none"
    });
    await app.locator(".breadcrumbs button.breadcrumb-action").nth(1).click();
    await expect(app.locator("#statePill")).toHaveText(breadcrumbTransitions[1].to);
    await expect.poll(async () => {
      const context = await runtimeContext(page);
      return Object.prototype.hasOwnProperty.call(context.states?.[stateId] || {}, "selected");
    }).toBe(false);
  });

  test("renders breadcrumb preset defaults after starting from a new empty scene @smoke", async ({ page }) => {
    await openTool(page);
    await page.locator("#btnNew").click();
    await page.getByRole("button", { name: "Neu starten" }).click();
    await expect(page.locator('[data-id="start"]')).toBeVisible();

    const stateId = await addComponentState(page, "Breadcrumb-Pfad", { openInspector: false });
    const scopePath = `states.${stateId}`;
    await expect.poll(async () => {
      const context = await runtimeContext(page);
      return (context.states?.[stateId]?.items || []).map(item => item.label);
    }).toEqual(["Start", "Projekte", "Aktuell"]);

    await expect(appFrame(page).locator("#statePill")).toHaveText(stateId);
    await expectRenderedBreadcrumbs(appFrame(page), ["Start", "Projekte", "Aktuell"]);
    const model = await savedModel(page);
    const state = model.states.find(item => item.id === stateId);
    const breadcrumbTransitions = model.transitions.filter(transition => transition.from === stateId);
    expect(state.data[scopePath].items.map(item => item.label)).toEqual(["Start", "Projekte", "Aktuell"]);
    expect(state.data[scopePath].items.slice(0, 2).map(item => item.transitionId)).toEqual(breadcrumbTransitions.map(transition => transition.id));
  });

  test("autowires daisy countdown finished changes into a real FSM transition", async ({ page }) => {
    await openTool(page);

    await addComponentState(page, "Countdown-Timer");
    const model = await savedModel(page);
    const countdownState = model.states.find(state => state.title === "Countdown-Timer");
    expect(countdownState).toBeTruthy();

    const scopePath = `states.${countdownState.id}`;
    expect(countdownState.data[scopePath]).toMatchObject({
      duration: 20,
      value: 20,
      running: true,
      finished: false,
      startedAt: 0,
      endsAt: 0
    });
    expect(countdownState.components[0]).toMatchObject({
      type: "daisy",
      variant: "countdown",
      dataPath: scopePath
    });

    const doneTransition = model.transitions.find(transition => transition.from === countdownState.id && transition.label === "Done");
    expect(doneTransition).toBeTruthy();
    expect(doneTransition).toMatchObject({
      triggerType: "change",
      triggerEvent: `change.${scopePath}.finished`,
      condition: `${scopePath}.finished == true`,
      set: {}
    });
    const doneState = model.states.find(state => state.id === doneTransition.to);
    expect(doneState).toMatchObject({ title: "Done", parentId: countdownState.parentId || null });
  });

  test("duplicates countdown state variables into a fresh scoped bus branch @smoke", async ({ page }) => {
    await openTool(page);

    const originalId = await addComponentState(page, "Countdown-Timer");
    const originalScope = `states.${originalId}`;

    await page.locator("#pDuplicate").click();
    await expect.poll(async () => {
      const stored = await savedModel(page);
      return stored.states.find(state => state.id !== originalId && state.title === "Countdown-Timer Copy")?.id || "";
    }).not.toBe("");

    let model = await savedModel(page);
    const directCopy = model.states.find(state => state.id !== originalId && state.title === "Countdown-Timer Copy");
    const directScope = `states.${directCopy.id}`;
    expect(directScope).not.toBe(originalScope);
    expect(directCopy.data[directScope]).toMatchObject({ duration: 20, value: 20, finished: false });
    expect(directCopy.data[originalScope]).toBeUndefined();
    expect(directCopy.dataTypes[directScope]).toBe("object");
    expect(Object.keys(directCopy.dataTypes)).not.toContain(originalScope);
    expect(directCopy.components[0]).toMatchObject({ type: "daisy", variant: "countdown", dataPath: directScope });

    const templateCopyId = await page.evaluate(sourceId => {
      const source = byId(sourceId);
      addStateTemplateFromState(source);
      return addTemplateToCurrentLayer(stateTemplates[0]).id;
    }, originalId);

    model = await savedModel(page);
    const templateCopy = model.states.find(state => state.id === templateCopyId);
    const templateScope = `states.${templateCopy.id}`;
    expect(templateScope).not.toBe(originalScope);
    expect(templateCopy.data[templateScope]).toMatchObject({ duration: 20, value: 20, finished: false });
    expect(templateCopy.data[originalScope]).toBeUndefined();
    expect(templateCopy.dataTypes[templateScope]).toBe("object");
    expect(Object.keys(templateCopy.dataTypes)).not.toContain(originalScope);

    expect(templateCopy.components[0]).toMatchObject({ type: "daisy", variant: "countdown", dataPath: templateScope });
  });

  test("autowires daisy loading into a two second FSM timer transition @smoke", async ({ page }) => {
    await openTool(page);

    const loadingId = await addComponentState(page, "Lade-State");
    const model = await savedModel(page);
    const loadingState = model.states.find(state => state.id === loadingId);
    const scopePath = `states.${loadingId}`;
    expect(loadingState.data[scopePath]).toMatchObject({
      label: "Lädt...",
      active: true,
      durationMs: 2000,
      nextLabel: "Weiter"
    });
    expect(loadingState.components[0]).toMatchObject({
      type: "daisy",
      variant: "loading",
      dataPath: scopePath
    });
    expect(loadingState.components.some(component => component.type === "transitionButton")).toBe(false);

    const nextTransition = model.transitions.find(transition => transition.from === loadingId && transition.label === "Weiter");
    expect(nextTransition).toMatchObject({
      triggerType: "timer",
      triggerEvent: `timer.${nextTransition.id.replace(/[^a-zA-Z0-9_.:-]+/g, ".").replace(/^\.+|\.+$/g, "").toLowerCase()}.done`,
      timerMs: 2000,
      condition: "",
      set: {}
    });
    const nextState = model.states.find(state => state.id === nextTransition.to);
    expect(nextState).toMatchObject({ title: "Weiter", parentId: loadingState.parentId || null });
    expect(await page.evaluate(({ loadingId, transitionId }) => {
      const state = model.states.find(item => item.id === loadingId);
      state.components.push({ id: "bad_timer_button", type: "transitionButton", transitionId, text: "", url: "", variant: "" });
      normalizeModel(model);
      return state.components.some(component => component.type === "transitionButton" && component.transitionId === transitionId);
    }, { loadingId, transitionId: nextTransition.id })).toBe(false);
    await expect(componentEditor(page, "Button: Weiter")).toHaveCount(0);
    await expect(page.locator("#pComponents .component-editor.transition-button-render")).toHaveCount(0);

    const app = appFrame(page);
    await page.locator('[data-id="auth_start"]').click();
    await expect(app.locator("#statePill")).toHaveText("auth_start");
    await page.locator(`[data-id="${cssAttributeValue(loadingId)}"]`).click();
    await expect(app.locator("#statePill")).toHaveText(loadingId);
    await expect(app.locator(".daisy-loading-state")).toBeVisible();
    await expect(app.locator(".daisy-loading-state .loading-spinner")).toBeVisible();
    await expect(app.locator(".daisy-loading-wrap .daisy-mini")).toHaveText("Lädt...");
    const loadingLayout = await app.locator(".daisy-loading-state").evaluate(el => {
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      const spinner = el.querySelector(".loading-spinner")?.getBoundingClientRect();
      return {
        display: style.display,
        justifyItems: style.justifyItems,
        spinnerCenterDelta: spinner ? Math.abs((spinner.left + spinner.width / 2) - (box.left + box.width / 2)) : 999
      };
    });
    expect(loadingLayout.display).toBe("grid");
    expect(loadingLayout.justifyItems).toBe("center");
    expect(loadingLayout.spinnerCenterDelta).toBeLessThan(4);
    await expect(app.locator("button[data-transition-id]")).toHaveCount(0);
    await expect(app.locator("#statePill")).toHaveText(nextState.id, { timeout: 3000 });
  });

  test("sets state flow trigger modes on real outgoing transitions @smoke", async ({ page }) => {
    await openTool(page);
    await openStateInspector(page, "auth_start");

    const transitionSelect = page.locator("#pStateFlowTransition");
    const triggerType = page.locator("#pStateTriggerType");
    const triggerEvent = page.locator("#pStateTriggerEvent");
    const timerInput = page.locator("#pStateTriggerTimer");
    await expect(transitionSelect).toBeVisible();
    await transitionSelect.selectOption("t_auth_login");
    await expect(triggerType).toHaveValue("button");

    await triggerType.selectOption("api");
    await expect.poll(async () => {
      const model = await savedModel(page);
      const transition = model.transitions.find(item => item.id === "t_auth_login");
      return {
        triggerType: transition?.triggerType,
        triggerEvent: transition?.triggerEvent,
        condition: transition?.condition
      };
    }).toEqual({
      triggerType: "change",
      triggerEvent: "change.states.auth_start.fetch.ok",
      condition: "states.auth_start.fetch.ok == true"
    });
    await expect(triggerEvent).toBeVisible();
    await expect(triggerEvent).toHaveValue("change.states.auth_start.fetch.ok");
    await triggerEvent.selectOption("change.states.auth_start.fetch.error");
    await expect.poll(async () => {
      const model = await savedModel(page);
      const transition = model.transitions.find(item => item.id === "t_auth_login");
      return {
        triggerType: transition?.triggerType,
        triggerEvent: transition?.triggerEvent,
        condition: transition?.condition
      };
    }).toEqual({
      triggerType: "change",
      triggerEvent: "change.states.auth_start.fetch.error",
      condition: "states.auth_start.fetch.error != \"\""
    });
    await triggerEvent.selectOption("change.states.auth_start.fetch.ok");
    await expect(page.locator("#pDataCard")).toHaveJSProperty("open", true);
    await expect(page.locator("#pFetchCard")).toHaveJSProperty("open", true);

    await triggerType.selectOption("event");
    await expect.poll(async () => {
      const model = await savedModel(page);
      const transition = model.transitions.find(item => item.id === "t_auth_login");
      return {
        triggerType: transition?.triggerType,
        triggerEvent: transition?.triggerEvent,
        condition: transition?.condition
      };
    }).toEqual({
      triggerType: "event",
      triggerEvent: "",
      condition: ""
    });
    await expect(triggerEvent).toBeVisible();
    await expect(triggerEvent).toHaveJSProperty("length", 0);
    await expect(appFrame(page).locator('button[data-transition-id="t_auth_login"]')).toHaveCount(0);
    await expect(appFrame(page).locator('button[data-transition-id="t_auth_register"]')).toBeVisible();

    await triggerType.selectOption("realtime");
    await expect.poll(async () => {
      const model = await savedModel(page);
      const transition = model.transitions.find(item => item.id === "t_auth_login");
      return {
        triggerType: transition?.triggerType,
        triggerEvent: transition?.triggerEvent,
        condition: transition?.condition
      };
    }).toEqual({
      triggerType: "realtime",
      triggerEvent: "",
      condition: ""
    });
    await expect(page.locator("#pStateTriggerEventLabel")).toHaveText("Realtime-/WSS-Ereignis");
    await expect(triggerEvent).toBeVisible();
    await expect(triggerEvent).toHaveJSProperty("length", 0);
    await expect(page.locator("#pStateTriggerEventImport")).toBeVisible();
    await expect(appFrame(page).locator('button[data-transition-id="t_auth_login"]')).toHaveCount(0);
    await expect(page.locator("#pStateTriggerPreview")).toContainText("Realtime-Raumereignis");

    await triggerType.selectOption("button");
    await expect.poll(async () => {
      const model = await savedModel(page);
      const transition = model.transitions.find(item => item.id === "t_auth_login");
      return {
        triggerType: transition?.triggerType,
        triggerEvent: transition?.triggerEvent,
        condition: transition?.condition
      };
    }).toEqual({
      triggerType: "button",
      triggerEvent: "button.t.auth.login.clicked",
      condition: ""
    });

    await triggerType.selectOption("timer");
    await timerInput.fill("2000");
    await timerInput.press("Enter");
    await expect.poll(async () => {
      const model = await savedModel(page);
      const state = model.states.find(item => item.id === "auth_start");
      const transition = model.transitions.find(item => item.id === "t_auth_login");
      return {
        triggerType: transition?.triggerType,
        triggerEvent: transition?.triggerEvent,
        timerMs: transition?.timerMs,
        loadingData: state?.data?.["states.auth_start"]?.loading,
        loadingComponent: state?.components?.some(component =>
          component.type === "daisy" &&
          component.variant === "loading" &&
          component.dataPath === "states.auth_start.loading"
        )
      };
    }).toEqual({
      triggerType: "timer",
      triggerEvent: "timer.t.auth.login.done",
      timerMs: 2000,
      loadingData: { label: "Lädt...", active: true, durationMs: 2000 },
      loadingComponent: true
    });

    const app = appFrame(page);
    await page.evaluate(() => startAppAtState("auth_start", { preserveFocus: true, suppressLayerFollow: true }));
    await expect(app.locator(".daisy-loading-state")).toBeVisible();
    await expect(app.locator(`button[data-transition-id="t_auth_login"]`)).toHaveCount(0);
    await expect(app.locator(`button[data-transition-id="t_auth_register"]`)).toBeVisible();
    await expect(app.locator("#statePill")).toHaveText("login", { timeout: 3000 });
  });

  test("uses realtime event catalog without persisting a local contract @smoke", async ({ page }) => {
    let catalogVersion = 1;
    const eventsPayload = () => ([
      {
        name: "realtime.sip.call.incoming",
        label: "Incoming call",
        detail: { caller: "text", callId: "text" },
        bindings: [
          { from: "detail.caller", to: "realtime.sip.call.incoming.caller", type: "text" },
          { from: "detail.callId", to: "realtime.sip.call.incoming.callId", type: "text" }
        ]
      },
      ...(catalogVersion > 1 ? [{
        name: "realtime.sip.call.answered",
        label: "Call answered",
        detail: { callId: "text", agent: "text" },
        bindings: [
          { from: "detail.callId", to: "realtime.sip.call.answered.callId", type: "text" },
          { from: "detail.agent", to: "realtime.sip.call.answered.agent", type: "text" }
        ]
      }] : [])
    ]);
    await page.route("https://realtime.digitalisierungsplanung.de/events", route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ events: eventsPayload() })
    }));
    await openTool(page);
    await page.evaluate(() => clearSelection());
    await expect(page.locator("#pRealtimeServerEvents")).toHaveText(/realtime events/i);
    await expect(page.locator("#pRealtimeEventList")).toContainText("Incoming call");
    await expect.poll(async () => page.locator("#stateInspectorBody").evaluate(root => {
      const realtime = root.querySelector("#pRealtimeCatalogCard");
      const empty = root.querySelector(".inspector-empty");
      if (!realtime || !empty) return false;
      return realtime.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false;
    })).toBe(true);
    await expect.poll(async () => (await savedModel(page)).realtime).toBeUndefined();
    await expect.poll(() => page.evaluate(() => Boolean(window.__stateBlueprintRealtime?.emit))).toBe(true);
    await expect(page.evaluate(() => window.__stateBlueprintRealtime.emit("realtime.unknown.event", { value: "nope" }))).resolves.toBe(false);
    await page.waitForTimeout(120);
    expect(await page.evaluate(() => latestRuntimeContext?.lastEvent || "")).not.toBe("realtime.unknown.event");
    await expect(page.evaluate(() => window.__stateBlueprintRealtime.emit("realtime.sip.call.incoming", {
      caller: "+491234",
      callId: "local-123"
    }))).resolves.toBe(true);
    await expect.poll(() => page.evaluate(() => latestRuntimeContext?.lastEvent || "")).toBe("realtime.sip.call.incoming");

    await openStateInspector(page, "auth_start");
    await page.locator("#pStateFlowTransition").selectOption("t_auth_login");
    await page.locator("#pStateTriggerType").selectOption("realtime");
    await expect(page.locator("#pStateTriggerEvent")).toBeVisible();
    await expect(page.locator("#pStateTriggerEvent")).toHaveValue("realtime.sip.call.incoming");
    await expect(page.locator("#pStateTriggerEventImport")).toBeVisible();
    await expect(page.locator("#pStateTriggerEventImport")).toHaveText("Realtime-Ereignisse neu laden");
    await expect.poll(async () => {
      const model = await savedModel(page);
      const transition = model.transitions.find(item => item.id === "t_auth_login");
      return {
        triggerType: transition?.triggerType,
        triggerEvent: transition?.triggerEvent
      };
    }).toEqual({
      triggerType: "realtime",
      triggerEvent: "realtime.sip.call.incoming"
    });
    await expect.poll(async () => (await savedModel(page)).realtime).toBeUndefined();

    catalogVersion = 2;
    await page.locator("#pStateTriggerEventImport").click();
    await expect(page.locator("#pStateTriggerEvent")).toContainText("Call answered - realtime.sip.call.answered");
    await expect.poll(async () => (await savedModel(page)).realtime).toBeUndefined();
  });

  test("normalizes bus-event transitions away from owned runtime event namespaces @smoke", async ({ page }) => {
    const model = defaultTestModel();
    const buttonTransition = model.transitions.find(item => item.id === "t_auth_login");
    buttonTransition.triggerType = "event";
    buttonTransition.triggerEvent = "button.t_auth_login.clicked";
    const realtimeTransition = model.transitions.find(item => item.id === "t_auth_register");
    realtimeTransition.triggerType = "event";
    realtimeTransition.triggerEvent = "realtime.sip.call.incoming";

    await openTool(page, { model });

    await expect.poll(async () => page.evaluate(() => {
      const buttonTransition = model.transitions.find(item => item.id === "t_auth_login");
      const realtimeTransition = model.transitions.find(item => item.id === "t_auth_register");
      return {
        button: {
          triggerType: buttonTransition?.triggerType,
          triggerEvent: buttonTransition?.triggerEvent
        },
        realtime: {
          triggerType: realtimeTransition?.triggerType,
          triggerEvent: realtimeTransition?.triggerEvent
        }
      };
    })).toEqual({
      button: {
        triggerType: "event",
        triggerEvent: ""
      },
      realtime: {
        triggerType: "event",
        triggerEvent: ""
      }
    });
    await expect(appFrame(page).locator('button[data-transition-id="t_auth_login"]')).toHaveCount(0);
    await expect(appFrame(page).locator('button[data-transition-id="t_auth_register"]')).toHaveCount(0);
  });

  test("copies selected countdown flows without reusing scoped transition data", async ({ page }) => {
    await openTool(page);

    const originalId = await addComponentState(page, "Countdown-Timer");
    const originalScope = `states.${originalId}`;
    const copied = await page.evaluate(sourceId => {
      const sourceScope = `states.${sourceId}`;
      const transition = model.transitions.find(item => item.from === sourceId && item.label === "Done");
      if (!transition) throw new Error("Missing countdown done transition");
      transition.set = { [`${sourceScope}.completed`]: true };
      selected = selectionFromParts([sourceId, transition.to], [transition.id]);
      const ok = duplicateSelectionBundle(clipboardSelectionPayload());
      return {
        ok,
        nodeIds: selectedNodeIdList(),
        edgeIds: selectedEdgeIdList(),
        originalTargetId: transition.to
      };
    }, originalId);
    expect(copied.ok).toBe(true);

    const model = await savedModel(page);
    const timerCopy = model.states.find(state => copied.nodeIds.includes(state.id) && state.title === "Countdown-Timer Copy");
    expect(timerCopy).toBeTruthy();
    const copyScope = `states.${timerCopy.id}`;
    const copiedTransition = model.transitions.find(transition => copied.edgeIds.includes(transition.id) && transition.from === timerCopy.id);
    expect(copiedTransition).toBeTruthy();
    expect(copiedTransition.to).not.toBe(copied.originalTargetId);
    expect(copiedTransition).toMatchObject({
      triggerType: "change",
      triggerEvent: `change.${copyScope}.finished`,
      condition: `${copyScope}.finished == true`,
      set: { [`${copyScope}.completed`]: true }
    });
    expect(timerCopy.data[originalScope]).toBeUndefined();
    expect(copiedTransition.triggerEvent).not.toBe(`change.${originalScope}.finished`);
    expect(copiedTransition.condition).not.toBe(`${originalScope}.finished == true`);
    expect(Object.keys(copiedTransition.set)).not.toContain(`${originalScope}.completed`);
  });

  test("keeps countdown setup out of the selected state drawer while preserving bus defaults", async ({ page }) => {
    await openTool(page);

    await addComponentState(page, "Countdown-Timer");
    const model = await savedModel(page);
    const countdownState = model.states.find(state => state.title === "Countdown-Timer");
    const scopePath = `states.${countdownState.id}`;

    await expect(page.locator("#pTimerQuickPanel")).toHaveCount(0);
    await expect(page.locator("#pTimerDuration")).toHaveCount(0);
    await expect(page.locator("#pTimerLabel")).toHaveCount(0);

    await expect.poll(async () => {
      const saved = await savedModel(page);
      return saved.states.find(state => state.id === countdownState.id)?.data?.[scopePath];
    }).toMatchObject({
      duration: 20,
      value: 20,
      label: "Seconds left",
      running: true,
      finished: false,
      startedAt: 0,
      endsAt: 0
    });
  });

  test("autowires daisy checkbox into a conditional FSM transition @smoke", async ({ page }) => {
    await openTool(page);

    await addComponentState(page, "Checkbox-Feld");
    const model = await savedModel(page);
    const checkboxState = model.states.find(state => state.title === "Checkbox-Feld");
    expect(checkboxState).toBeTruthy();
    const scopePath = `states.${checkboxState.id}`;
    expect(checkboxState.data[scopePath]).toMatchObject({
      legend: "Einstellungen",
      items: [{ label: "Angemeldet bleiben", checked: false }],
      checked: false
    });
    expect(checkboxState.components[0]).toMatchObject({
      type: "daisy",
      variant: "checkbox",
      dataPath: scopePath
    });

    const transition = model.transitions.find(item => item.from === checkboxState.id && item.label === "Continue");
    expect(transition).toBeTruthy();
    expect(transition).toMatchObject({
      triggerType: "button",
      condition: `${scopePath}.checked == true`,
      set: { [`${scopePath}.submitted`]: true }
    });
    expect(transition.triggerEvent).toMatch(/^button\..+\.clicked$/);
    const target = model.states.find(state => state.id === transition.to);
    expect(target).toMatchObject({ title: "Continue", parentId: checkboxState.parentId || null });

    await page.locator(`[data-id="${checkboxState.id}"]`).click();
    const app = appFrame(page);
    await expect(app.locator("fieldset.fieldset.bg-base-100.border-base-300.rounded-box.w-64.border.p-4")).toBeVisible();
    await expect(app.locator("legend.fieldset-legend")).toHaveText("Einstellungen");
    await expect(app.locator("input.checkbox.checkbox-primary")).toBeVisible();
    await expect(app.locator(`button[data-transition-id="${transition.id}"]`, { hasText: "Continue" })).toBeVisible();
  });

  test("adds checkbox choices in the state editor using the same scoped preset data @smoke", async ({ page }) => {
    await openTool(page);

    const preset = componentPreset(page, "Checkbox-Feld");
    await expect(preset).toBeVisible();
    await preset.getByRole("button", { name: "Checkbox-Feld hinzufügen" }).click();
    await expect(page.locator("#pTitle")).toHaveValue("Checkbox-Feld");

    let model = await savedModel(page);
    const checkboxState = model.states.find(state => state.title === "Checkbox-Feld");
    expect(checkboxState).toBeTruthy();
    const scopePath = `states.${checkboxState.id}`;
    const stateItems = page.locator(`.state-variable-row[data-variable-path="${cssAttributeValue(scopePath + ".items")}"] .choice-list-editor`);
    await expect(stateItems).toBeVisible();
    await stateItems.getByRole("textbox", { name: "New checkbox label" }).fill("Accept newsletter");
    await stateItems.getByRole("button", { name: "+ Checkbox" }).click();
    await expect(stateItems.getByRole("textbox", { name: "Checkbox label", exact: true })).toHaveCount(2);
    await expect(page.locator(`.state-variable-row[data-variable-path="${cssAttributeValue(scopePath + ".checked")}"]`)).toHaveCount(0);

    await expect.poll(async () => {
      model = await savedModel(page);
      return model.states.find(state => state.id === checkboxState.id)?.data?.[scopePath]?.items || [];
    }).toEqual([
      { label: "Angemeldet bleiben", checked: false },
      { label: "Accept newsletter", checked: false }
    ]);

    const app = appFrame(page);
    await expect(app.locator("input.checkbox.checkbox-primary")).toHaveCount(2);
    await expect(app.getByText("Accept newsletter")).toBeVisible();
  });

  test("runs daisy countdown through global-state bus and finished transition @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "Countdown flow",
      initial: "timer",
      states: [
        {
          id: "timer",
          title: "Countdown",
          x: 160,
          y: 160,
          data: {
            "states.timer": {
              duration: 2,
              value: 2,
              label: "Seconds left",
              running: true,
              finished: false,
              startedAt: 0,
              endsAt: 0
            }
          },
          components: [
            { id: "timer_countdown", type: "daisy", variant: "countdown", dataPath: "states.timer", dataRole: "widget", dataLabel: "Countdown" }
          ]
        },
        {
          id: "done",
          title: "Done",
          x: 480,
          y: 160,
          data: {},
          components: [{ id: "done_text", type: "text", text: "Timer complete", url: "" }]
        }
      ],
      transitions: [
        {
          id: "timer_done",
          from: "timer",
          to: "done",
          label: "Done",
          condition: "states.timer.finished == true",
          triggerType: "change",
          triggerEvent: "change.states.timer.finished",
          set: {}
        }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");

    const app = appFrame(page);
    await expect(page.locator('[data-id="timer"]')).toBeVisible();
    await expect(app.locator("#statePill")).toHaveText("timer");
    await expect(app.locator(".countdown")).toHaveText("2");
    await expect(app.locator(".countdown")).toHaveText("1", { timeout: 3000 });

    await expect.poll(async () => {
      const context = await runtimeContext(page);
      return context.states?.timer?.value;
    }, { timeout: 5000 }).toBe(0);
    await expect.poll(async () => {
      const context = await runtimeContext(page);
      return context.states?.timer?.finished;
    }, { timeout: 5000 }).toBe(true);
    await expect(app.locator("#statePill")).toHaveText("done", { timeout: 5000 });
    await expect(app.getByText("Timer complete")).toBeVisible();
  });

  test("runs daisy carousel next and previous through scoped global-state index @smoke", async ({ page }) => {
    await openTool(page);

    await addComponentState(page, "Bildkarussell");
    const model = await savedModel(page);
    const carouselState = model.states.find(state => state.title === "Bildkarussell");
    expect(carouselState).toBeTruthy();
    const scopePath = `states.${carouselState.id}`;
    expect(carouselState.components[0]).toMatchObject({
      type: "daisy",
      variant: "carousel",
      dataPath: scopePath
    });
    expect(carouselState.data[scopePath]).toMatchObject({
      index: 0,
      images: [
        "https://picsum.photos/seed/state-1/640/360",
        "https://picsum.photos/seed/state-2/640/360",
        "https://picsum.photos/seed/state-3/640/360"
      ]
    });
    expect(model.transitions.filter(transition => transition.from === carouselState.id)).toHaveLength(0);

    const app = appFrame(page);
    await expect(app.locator(".daisy-carousel-image")).toHaveAttribute("src", /state-1/);
    await app.getByRole("button", { name: "Next" }).click();
    await expect.poll(async () => (await runtimeContext(page)).states?.[carouselState.id]?.index).toBe(1);
    await expect(app.locator(".daisy-carousel-image")).toHaveAttribute("src", /state-2/);

    await app.getByRole("button", { name: "Prev" }).click();
    await expect.poll(async () => (await runtimeContext(page)).states?.[carouselState.id]?.index).toBe(0);
    await expect(app.locator(".daisy-carousel-image")).toHaveAttribute("src", /state-1/);
  });

  test("renders daisy steps as transition-bound actions without hidden local state @smoke", async ({ page }) => {
    await openTool(page);

    await addComponentState(page, "Prozessschritte");
    const model = await savedModel(page);
    const stepsState = model.states.find(state => state.title === "Prozessschritte");
    expect(stepsState).toBeTruthy();
    const scopePath = `states.${stepsState.id}`;
    expect(stepsState.components[0]).toMatchObject({
      type: "daisy",
      variant: "steps",
      dataPath: scopePath
    });
    const stepTransitions = model.transitions
      .filter(transition => transition.from === stepsState.id)
      .sort((a, b) => a.label.localeCompare(b.label));
    expect(stepTransitions.map(transition => transition.label)).toEqual(["Bauen", "Planen", "Veröffentlichen"]);
    for (const transition of stepTransitions) {
      expect(transition.set).toEqual({ [`${scopePath}.current`]: transition.label });
    }

    const app = appFrame(page);
    await expect(app.locator("li.step-primary")).toContainText("Bauen");
    await expect(app.locator(".steps button[data-transition-id] .daisy-step-label")).toHaveText(["Planen", "Bauen", "Veröffentlichen"]);
    await expect(app.locator(".steps .daisy-step-copy")).toContainText([
      "Screen und Datenvertrag definieren.",
      "Komponenten mit echten Transitions verdrahten.",
      "Vorschau prüfen, testen und exportieren."
    ]);
    await app.locator(".steps").getByRole("button", { name: /Veröffentlichen/ }).click();
    await expect.poll(async () => (await runtimeContext(page)).states?.[stepsState.id]?.current).toBe("Veröffentlichen");
    const shipTarget = model.states.find(state => state.title === "Veröffentlichen" && state.parentId === stepsState.parentId);
    expect(shipTarget).toBeTruthy();
    await expect(app.locator("#statePill")).toHaveText(shipTarget.id);

    const noWireModel = defaultTestModel();
    noWireModel.states[0] = {
      ...noWireModel.states[0],
      components: [{
        id: "auth_steps",
        type: "daisy",
        variant: "steps",
        dataPath: "states.auth_start.steps",
        dataRole: "widget",
        dataLabel: "Steps"
      }],
      data: {
        "states.auth_start.steps": {
          current: "Wire",
          items: [
            { label: "Model", description: "Define scoped data." },
            { label: "Wire", description: "Connect real transitions." },
            { label: "Preview", description: "Run the current FSM." }
          ]
        }
      },
      dataTypes: {
        "states.auth_start.steps": "object"
      }
    };
    noWireModel.transitions = noWireModel.transitions.filter(transition => transition.from !== "auth_start");
    await openTool(page, { model: noWireModel });
    await expect(app.locator(".steps button[data-transition-id]")).toHaveCount(0);
    await expect(app.locator(".steps .daisy-step-copy")).toContainText([
      "Define scoped data.",
      "Connect real transitions.",
      "Run the current FSM."
    ]);
    const previewStep = app.locator("li.step", { hasText: "Preview" });
    const previewBox = await previewStep.boundingBox();
    expect(previewBox).toBeTruthy();
    await previewStep.click({ position: { x: Math.max(40, previewBox.width - 8), y: previewBox.height / 2 } });
    await expect.poll(async () => (await runtimeContext(page)).states?.auth_start?.steps?.current).toBe("Wire");
    await expect(app.locator("li.step-primary")).toContainText("Wire");
  });

  test("keeps add render on user data instead of bus event or object branches @smoke", async ({ page }) => {
    await openTool(page);

    await addComponentState(page, "Inhalts-Tabs");
    let model = await savedModel(page);
    const tabsState = model.states.find(state => state.title === "Inhalts-Tabs");
    expect(tabsState).toBeTruthy();
    const scopePath = `states.${tabsState.id}`;

    const app = appFrame(page);
    const addRenderSelect = page.locator('.data-wire-render-panel select[aria-label="Sichtbares Feld hinzufuegen"]');
    await expect(addRenderSelect).toBeVisible();
    await expect(addRenderSelect.locator('option[value="events"]')).toHaveCount(0);
    await expect(addRenderSelect.locator(`option[value="${scopePath}"]`)).toHaveCount(0);
    await expect(addRenderSelect.locator(`option[value="${scopePath}.selected"]`)).toHaveCount(1);
    await expect(addRenderSelect.locator(`option[value="${scopePath}.items"]`)).toHaveCount(1);

    const stateBranchButton = page.locator(`.global-state-json-line[data-path="${scopePath}"] .global-state-json-toggle`);
    await expect(stateBranchButton).toHaveText("Nutzen");

    await addRenderSelect.selectOption(`${scopePath}.selected`);
    await page.locator(".data-wire-render-panel").getByRole("button", { name: "Ausgewaehltes Feld anzeigen" }).click();
    await expect(app.locator("#screen")).toContainText("Selected: Übersicht");
    await expect(app.locator("#screen")).not.toContainText("Events:");
    await expect(app.locator("#screen")).not.toContainText('{"change"');

    model = await savedModel(page);
    const updated = model.states.find(state => state.id === tabsState.id);
    expect(updated.data).toEqual(tabsState.data);
    expect(updated.dataWires.map(wire => wire.sourcePath)).toContain(`${scopePath}.selected`);
  });

  test("toggles screen fields in and out without raw JSON editing @smoke", async ({ page }) => {
    await openTool(page);

    await addComponentState(page, "Inhalts-Tabs");
    let model = await savedModel(page);
    const tabsState = model.states.find(state => state.title === "Inhalts-Tabs");
    const scopePath = `states.${tabsState.id}`;
    const selectedPath = `${scopePath}.selected`;
    const panel = page.locator(".data-wire-render-panel");
    const addRenderSelect = panel.locator('select[aria-label="Sichtbares Feld hinzufuegen"]');

    await addRenderSelect.selectOption(selectedPath);
    await expect(panel.getByRole("button", { name: "Ausgewaehltes Feld anzeigen" })).toBeVisible();
    await panel.getByRole("button", { name: "Ausgewaehltes Feld anzeigen" }).click();
    await expect(panel.getByRole("button", { name: "Ausgewaehltes Feld entfernen" })).toBeVisible();
    await expect(page.locator(`.global-state-key-card[data-path="${selectedPath}"] .global-state-key-status`)).toContainText("In der Darstellung");
    await expect(page.locator(`.global-state-json-line[data-path="${selectedPath}"]`)).toHaveClass(/wired/);
    await expect.poll(async () => {
      const stored = await savedModel(page);
      return stored.states.find(state => state.id === tabsState.id).dataWires.map(wire => wire.sourcePath);
    }).toContain(selectedPath);

    await panel.getByRole("button", { name: "Ausgewaehltes Feld entfernen" }).click();
    await expect(panel.getByRole("button", { name: "Ausgewaehltes Feld anzeigen" })).toBeVisible();
    await expect.poll(async () => {
      const stored = await savedModel(page);
      return stored.states.find(state => state.id === tabsState.id).dataWires.map(wire => wire.sourcePath);
    }).not.toContain(selectedPath);
  });

  test("toggles daisy widgets on a selected state with scoped bus data @smoke", async ({ page }) => {
    await openTool(page);
    await openStateInspector(page, "auth_start");
    const before = await savedModel(page);
    const widgetPanel = page.locator("#pWidgetLibrary");
    await expect(widgetPanel).toBeVisible();
    await expect(widgetPanel).toHaveCSS("scrollbar-color", "rgb(49, 95, 140) rgb(7, 19, 33)");
    await expect(widgetPanel).toHaveCSS("scrollbar-width", "thin");
    await expect.poll(async () => widgetPanel.evaluate(panel => {
      const select = panel.querySelector('select[aria-label="Widget-Vorlage"]');
      const button = [...panel.querySelectorAll("button")].find(item => item.textContent.trim() === "Widget hinzufügen");
      return {
        select: Math.round(select?.getBoundingClientRect().height || 0),
        button: Math.round(button?.getBoundingClientRect().height || 0)
      };
    })).toEqual({ select: 32, button: 32 });
    await expect(componentPreset(page, "Benutzer-Avatar").getByRole("button", { name: "Show on selected state screen: Benutzer-Avatar" })).toHaveCount(0);

    await widgetPanel.getByLabel("Widget-Vorlage").selectOption("builtin_daisy_avatar");
    await widgetPanel.getByRole("button", { name: "Widget hinzufügen" }).click();
    await expect.poll(async () => {
      const stored = await savedModel(page);
      const state = stored.states.find(item => item.id === "auth_start");
      return {
        states: stored.states.length,
        component: state.components.find(component => component.type === "daisy" && component.variant === "avatar"),
        data: state.data["states.auth_start.avatar"]
      };
    }).toMatchObject({
      states: before.states.length,
      component: { dataPath: "states.auth_start.avatar", dataRole: "widget", dataLabel: "Benutzer-Avatar" },
      data: { name: "Mira Keller" }
    });

    await page.locator("#pWidgetLibrary").getByLabel("Widget-Vorlage").selectOption("builtin_daisy_avatar");
    await expect(page.locator("#pWidgetLibrary").getByRole("button", { name: "Remove" })).toHaveCount(0);
    await expect(page.locator("#pWidgetLibrary").getByRole("button", { name: "Widget hinzufügen" })).toBeDisabled();
    const avatarEditor = await expandComponentEditor(page, "Widget: Benutzer-Avatar");
    await avatarEditor.getByRole("button", { name: "Loeschen" }).click();
    await expect.poll(async () => {
      const stored = await savedModel(page);
      const state = stored.states.find(item => item.id === "auth_start");
      return {
        componentCount: state.components.filter(component => component.type === "daisy" && component.variant === "avatar").length,
        hasData: Object.prototype.hasOwnProperty.call(state.data, "states.auth_start.avatar")
      };
    }).toEqual({ componentCount: 0, hasData: false });
    await expect(page.locator("#pWidgetLibrary").getByRole("button", { name: "Widget hinzufügen" })).toBeEnabled();

    const preset = componentPreset(page, "Benutzer-Avatar");
    await preset.scrollIntoViewIfNeeded();
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await preset.dispatchEvent("dragstart", { dataTransfer, bubbles: true, cancelable: true });
    await page.locator("#pWidgetLibrary").dispatchEvent("dragover", { dataTransfer, bubbles: true, cancelable: true });
    await page.locator("#pWidgetLibrary").dispatchEvent("drop", { dataTransfer, bubbles: true, cancelable: true });
    await expect.poll(async () => {
      const stored = await savedModel(page);
      const state = stored.states.find(item => item.id === "auth_start");
      return {
        component: state.components.find(component => component.type === "daisy" && component.variant === "avatar"),
        data: state.data["states.auth_start.avatar"]
      };
    }).toMatchObject({
      component: { dataPath: "states.auth_start.avatar", dataRole: "widget", dataLabel: "Benutzer-Avatar" },
      data: { name: "Mira Keller" }
    });
  });

  test("autowires daisy card actions into real FSM states and transition buttons @smoke", async ({ page }) => {
    await openTool(page);

    await addComponentState(page, "Produktkarte");
    const model = await savedModel(page);
    const cardState = model.states.find(state => state.title === "Produktkarte");
    const cardTransition = model.transitions.find(transition => transition.from === cardState.id && transition.label === "Jetzt kaufen");
    const cardTarget = model.states.find(state => state.id === cardTransition?.to);
    expect(cardTransition).toBeTruthy();
    expect(cardTransition.triggerType).toBe("button");
    expect(cardTransition.set).toEqual({ [`states.${cardState.id}.clicked`]: true });
    expect(cardTarget).toMatchObject({ title: "Jetzt kaufen", parentId: cardState.parentId || null });
    await page.locator(`[data-id="${cardState.id}"]`).click();
    let app = appFrame(page);
    await expect(app.locator(`button.card-image-action[data-transition-id="${cardTransition.id}"]`)).toHaveCount(0);
    const imageLink = app.locator(".runtime-image-link").first();
    await expect(imageLink.locator("img")).toHaveAttribute("alt", "Schuhe");
    await page.evaluate(() => {
      window.__stateBlueprintOpenedUrls = [];
      window.open = url => {
        window.__stateBlueprintOpenedUrls.push(String(url || ""));
        return null;
      };
    });
    await imageLink.click();
    await expect(app.locator("#statePill")).toHaveText(cardState.id);
    await expect.poll(() => page.evaluate(() => window.__stateBlueprintOpenedUrls?.length || 0)).toBe(1);
    await expect(app.locator(`button[data-transition-id="${cardTransition.id}"]`, { hasText: "Jetzt kaufen" })).toBeVisible();
    await app.locator(`button[data-transition-id="${cardTransition.id}"]`, { hasText: "Jetzt kaufen" }).click();
    await expect(app.locator("#statePill")).toHaveText(cardTarget.id);
  });

  test("wires empty-canvas boundary proxies to an interactive daisy preset root on drop @smoke", async ({ page }) => {
    await openTool(page);
    await page.evaluate(() => loadEditorModel(blankModel(), true));
    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(0);
    await expect(page.locator(".node.boundary-proxy")).toHaveCount(2);

    const point = await emptyCanvasPoint(page);
    await page.evaluate(({ x, y }) => {
      const template = builtinStateTemplates().find(item => item.title === "Produktkarte");
      addTemplateAt(template.id, x, y);
    }, point);

    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(2);
    await expect(page.locator(".node.boundary-proxy")).toHaveCount(2);
    await expect(page.locator('.edge[data-edge-id="boundary-flow:__root__:input"]')).toHaveCount(1);
    await expect(page.locator('.edge[data-edge-id="boundary-flow:__root__:output"]')).toHaveCount(1);

    await expect.poll(() => page.evaluate(() => {
      const card = model.states.find(state => state.title === "Produktkarte");
      const action = card ? model.transitions.find(transition => transition.from === card.id && transition.label === "Jetzt kaufen") : null;
      return {
        actionTargetExists: Boolean(action && model.states.some(state => state.id === action.to && state.title === "Jetzt kaufen")),
        entryMatchesCard: Boolean(card && model.boundary?.entryId === card.id),
        exitMatchesCard: Boolean(card && model.boundary?.exitId === card.id),
        inputFlow: model.transitions.some(transition =>
          transition.id === "boundary-flow:__root__:input" &&
          transition.from === "proxy:__root__:input:__boundary_input" &&
          transition.to === card?.id
        ),
        outputFlow: model.transitions.some(transition =>
          transition.id === "boundary-flow:__root__:output" &&
          transition.from === card?.id &&
          transition.to === "proxy:__root__:output:__boundary_output"
        )
      };
    })).toEqual({
      actionTargetExists: true,
      entryMatchesCard: true,
      exitMatchesCard: true,
      inputFlow: true,
      outputFlow: true
    });
  });

  test("autowires daisy modal actions into real FSM states and transition buttons @smoke", async ({ page }) => {
    await openTool(page);

    await addComponentState(page, "Bestätigungsdialog");
    const model = await savedModel(page);
    const modalState = model.states.find(state => state.title === "Bestätigungsdialog");
    const modalTransition = model.transitions.find(transition => transition.from === modalState.id && transition.label === "Bestätigen");
    const modalTarget = model.states.find(state => state.id === modalTransition?.to);
    expect(modalTransition).toBeTruthy();
    expect(modalTransition.set).toEqual({
      [`states.${modalState.id}.confirmed`]: true,
      [`states.${modalState.id}.open`]: false
    });
    expect(modalTarget).toMatchObject({ title: "Bestätigen", parentId: modalState.parentId || null });
    const app = appFrame(page);
    await app.getByRole("button", { name: "Dialog öffnen" }).click();
    await expect(app.locator(`dialog.modal[open] button[data-transition-id="${modalTransition.id}"]`, { hasText: "Bestätigen" })).toBeVisible();
    await app.locator(`dialog.modal[open] button[data-transition-id="${modalTransition.id}"]`).click();
    await expect(app.locator("#statePill")).toHaveText(modalTarget.id);
  });

  test("autowires daisy navbar actions into real FSM states and transition buttons @smoke", async ({ page }) => {
    await openTool(page);

    await addComponentState(page, "Navbar mit Menü");
    const model = await savedModel(page);
    const navbarState = model.states.find(state => state.title === "Navbar mit Menü");
    const navbarTransitions = model.transitions
      .filter(transition => transition.from === navbarState.id)
      .sort((a, b) => a.label.localeCompare(b.label));
    expect(navbarTransitions.map(transition => transition.label)).toEqual(["Dashboard", "Einstellungen", "Projekte"]);
    const projectsTransition = navbarTransitions.find(transition => transition.label === "Projekte");
    const projectsTarget = model.states.find(state => state.id === projectsTransition.to);
    expect(projectsTransition.set).toEqual({
      [`states.${navbarState.id}.selected`]: "Projekte",
      [`states.${navbarState.id}.lastAction`]: "Projekte"
    });
    expect(projectsTarget).toMatchObject({ title: "Projekte", parentId: navbarState.parentId || null });
    const app = appFrame(page);
    await expect(app.locator(".navbar button[data-transition-id]")).toHaveCount(3);
    await app.locator(`.navbar button[data-transition-id="${projectsTransition.id}"]`).click();
    await expect(app.locator("#statePill")).toHaveText(projectsTarget.id);
  });

  test("autowires daisy navbar profile and cart menus into filtered FSM transition buttons @smoke", async ({ page }) => {
    await openTool(page);

    await addComponentState(page, "Navbar Suche/Profil", { expandEditor: false });
    await addComponentState(page, "Navbar Shop/Warenkorb", { expandEditor: false });
    const model = await savedModel(page);
    const searchState = model.states.find(state => state.title === "Navbar Suche/Profil");
    const cartState = model.states.find(state => state.title === "Navbar Shop/Warenkorb");
    const searchTransitions = model.transitions
      .filter(transition => transition.from === searchState.id)
      .sort((a, b) => a.label.localeCompare(b.label));
    const cartTransitions = model.transitions
      .filter(transition => transition.from === cartState.id)
      .sort((a, b) => a.label.localeCompare(b.label));

    expect(searchTransitions.map(transition => transition.label)).toEqual(["Abmelden", "Einstellungen", "Profil"]);
    expect(cartTransitions.map(transition => transition.label)).toEqual(["Abmelden", "Einstellungen", "Profil", "Warenkorb ansehen"]);
    for (const transition of [...searchTransitions, ...cartTransitions]) {
      const source = transition.from === searchState.id ? searchState : cartState;
      expect(model.states.find(state => state.id === transition.to)).toMatchObject({
        title: transition.label,
        parentId: source.parentId || null
      });
      expect(transition.set).toMatchObject({
        [`states.${source.id}.selected`]: transition.label,
        [`states.${source.id}.lastAction`]: transition.label
      });
    }

    await page.locator(`[data-id="${searchState.id}"] .node-edit`).click({ force: true });
    await expect(page.locator("#pTitle")).toHaveValue("Navbar Suche/Profil");
    const app = appFrame(page);
    const navbarLayoutMetrics = async () => app.locator("body").evaluate(body => {
      const html = document.documentElement;
      const screen = document.querySelector("#screen");
      const navbarEl = document.querySelector(".navbar");
      const viewportWidth = html.clientWidth;
      const viewportHeight = html.clientHeight;
      const scrollWidth = Math.max(body.scrollWidth, html.scrollWidth);
      const scrollHeight = Math.max(body.scrollHeight, html.scrollHeight);
      const dropdowns = [...document.querySelectorAll(".navbar .dropdown[data-open='true']")].map(dropdown => {
        const content = dropdown.querySelector(".dropdown-content");
        const dropdownBox = dropdown.getBoundingClientRect();
        const contentBox = content?.getBoundingClientRect();
        const contentStyle = content ? getComputedStyle(content) : null;
        return {
          className: content?.className || "",
          contentPosition: contentStyle?.position || "",
          contentDisplay: contentStyle?.display || "",
          dropdownHeight: Math.round(dropdownBox.height),
          contentHeight: Math.round(contentBox?.height || 0),
          contentLeft: Math.round(contentBox?.left || 0),
          contentRight: Math.round(contentBox?.right || 0)
        };
      });
      return {
        hasHorizontalScroll: scrollWidth > viewportWidth + 2,
        hasVerticalScroll: scrollHeight > viewportHeight + 2,
        bodyFillsViewport: body.clientHeight >= viewportHeight - 2,
        navbarHeight: Math.round(navbarEl?.getBoundingClientRect().height || 0),
        screenHeight: Math.round(screen?.getBoundingClientRect().height || 0),
        viewportWidth,
        dropdowns
      };
    });
    const expectOpenNavbarDropdownsToFlow = async (count) => {
      const metrics = await navbarLayoutMetrics();
      expect(metrics.hasHorizontalScroll).toBe(false);
      expect(metrics.hasVerticalScroll).toBe(false);
      expect(metrics.bodyFillsViewport).toBe(true);
      expect(metrics.dropdowns).toHaveLength(count);
      for (const dropdown of metrics.dropdowns) {
        if (dropdown.className.includes("menu")) {
          expect(dropdown.contentDisplay).toBe("flex");
        } else {
          expect(["grid", "block"]).toContain(dropdown.contentDisplay);
        }
        expect(dropdown.contentPosition).toBe("absolute");
        expect(dropdown.contentLeft).toBeGreaterThanOrEqual(0);
        expect(dropdown.contentRight).toBeLessThanOrEqual(metrics.viewportWidth + 1);
        expect(dropdown.dropdownHeight).toBeLessThan(dropdown.contentHeight);
      }
      expect(metrics.navbarHeight).toBeLessThan(90);
    };
    let navbar = app.locator(".navbar").first();
    await navbar.locator(".dropdown.dropdown-end [role='button']").click();
    await expect(navbar.locator(".dropdown-content button[data-transition-id]")).toHaveCount(3);
    await expect(navbar.locator(".dropdown-content button[data-transition-id]")).toHaveText(["Profil", "Einstellungen", "Abmelden"]);
    await expectOpenNavbarDropdownsToFlow(1);
    const settingsTransition = searchTransitions.find(transition => transition.label === "Einstellungen");
    await navbar.locator(`button[data-transition-id="${settingsTransition.id}"]`).click();
    await expect(app.locator("#statePill")).toHaveText(settingsTransition.to);

    await page.locator(`[data-id="${cartState.id}"] .node-edit`).click({ force: true });
    await expect(page.locator("#pTitle")).toHaveValue("Navbar Shop/Warenkorb");
    navbar = app.locator(".navbar").first();
    const viewCartTransition = cartTransitions.find(transition => transition.label === "Warenkorb ansehen");
    await navbar.locator(".dropdown.dropdown-end").first().locator("[role='button']").click();
    await expect(navbar.locator(".card.dropdown-content button[data-transition-id]")).toHaveCount(1);
    await expect(navbar.locator(".card.dropdown-content button[data-transition-id]")).toHaveText("Warenkorb ansehen");
    await expect(navbar.locator(`.card.dropdown-content button[data-transition-id="${viewCartTransition.id}"]`)).toBeVisible();
    await expectOpenNavbarDropdownsToFlow(1);
    await navbar.locator(".dropdown.dropdown-end").nth(1).locator("[role='button']").click();
    await expect(navbar.locator(".menu.dropdown-content button[data-transition-id]")).toHaveCount(3);
    await expect(navbar.locator(".menu.dropdown-content button[data-transition-id]")).toHaveText(["Profil", "Einstellungen", "Abmelden"]);
    await expect(navbar.locator(".menu.dropdown-content button", { hasText: "Warenkorb ansehen" })).toHaveCount(0);
    await expectOpenNavbarDropdownsToFlow(2);
  });

  test("renders daisy presets with official daisyUI class contracts and bus writes", async ({ page }) => {
    const model = {
      version: 2,
      name: "Daisy contracts",
      initial: "widgets",
      states: [
        {
          id: "widgets",
          title: "Widgets",
          body: "",
          x: 160,
          y: 160,
          data: {
            "states.widgets.navbar": { brand: "Workspace", selected: "Home", items: ["Home", "Settings"], submenuOpen: true },
            "states.widgets.modal": { open: false, confirmed: false, openLabel: "open modal", title: "Hello!", body: "Press ESC key or click the button below to close", actionLabel: "Confirm", closeLabel: "Close" },
            "states.widgets.toast": { visible: true, tone: "success", message: "Saved" },
            "states.widgets.card": { title: "Card Title", body: "A card component has a figure, a body part, and inside body there are title and actions parts", image: "https://img.daisyui.com/images/stock/photo-1606107557195-0e29a4b5b4aa.webp", imageAlt: "Shoes", actionLabel: "Buy Now" },
            "states.widgets.checkbox": { legend: "Login options", label: "Remember me", checked: false },
            "states.widgets.input": { label: "Name", value: "Ada" },
            "states.widgets.progress": { value: 45, max: 100, label: "Progress" },
            "states.widgets.rating": { value: 3, max: 5, label: "Rating" },
            "states.widgets.accordion": { open: "Shipping", items: [{ label: "Shipping", body: "Ships in two business days." }, { label: "Returns", body: "Return within 30 days." }] },
            "states.widgets.table": { columns: ["Name", "Status"], rows: [["Ada", "Active"]] },
            "states.widgets.avatar": { name: "Ada Lovelace", image: "https://img.daisyui.com/images/profile/demo/2@94.webp", status: "online", size: "w-16", shape: "rounded-full", ring: true },
            "states.widgets.avatarPlaceholder": { name: "Grace Hopper", initials: "GH", status: "offline", placeholder: true, size: "w-12", shape: "rounded-full" },
            "states.widgets.avatarGroup": {
              size: "w-12",
              shape: "rounded-full",
              avatars: [
                { name: "Ada", image: "https://img.daisyui.com/images/profile/demo/2@94.webp", status: "online" },
                { name: "Grace Hopper", initials: "GH", placeholder: true, status: "offline" }
              ],
              counter: 2
            }
          },
          components: [
            { id: "nav", type: "daisy", variant: "navbar", dataPath: "states.widgets.navbar", dataRole: "widget", dataLabel: "Navbar" },
            { id: "modal", type: "daisy", variant: "modal", dataPath: "states.widgets.modal", dataRole: "widget", dataLabel: "Modal" },
            { id: "toast", type: "daisy", variant: "toast", dataPath: "states.widgets.toast", dataRole: "widget", dataLabel: "Toast" },
            { id: "card", type: "daisy", variant: "card", dataPath: "states.widgets.card", dataRole: "widget", dataLabel: "Card" },
            { id: "checkbox", type: "daisy", variant: "checkbox", dataPath: "states.widgets.checkbox", dataRole: "widget", dataLabel: "Checkbox" },
            { id: "input", type: "daisy", variant: "input", dataPath: "states.widgets.input", dataRole: "widget", dataLabel: "Input" },
            { id: "progress", type: "daisy", variant: "progress", dataPath: "states.widgets.progress", dataRole: "widget", dataLabel: "Progress" },
            { id: "rating", type: "daisy", variant: "rating", dataPath: "states.widgets.rating", dataRole: "widget", dataLabel: "Rating" },
            { id: "accordion", type: "daisy", variant: "accordion", dataPath: "states.widgets.accordion", dataRole: "widget", dataLabel: "Accordion" },
            { id: "table", type: "daisy", variant: "table", dataPath: "states.widgets.table", dataRole: "widget", dataLabel: "Table" },
            { id: "avatar", type: "daisy", variant: "avatar", dataPath: "states.widgets.avatar", dataRole: "widget", dataLabel: "Avatar" },
            { id: "avatar_placeholder", type: "daisy", variant: "avatar", dataPath: "states.widgets.avatarPlaceholder", dataRole: "widget", dataLabel: "Avatar placeholder" },
            { id: "avatar_group", type: "daisy", variant: "avatar", dataPath: "states.widgets.avatarGroup", dataRole: "widget", dataLabel: "Avatar group" }
          ]
        }
      ],
      transitions: []
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");

    const app = appFrame(page);
    await expect(page.locator('[data-id="widgets"]')).toBeVisible();
    await expect(app.locator(".navbar.bg-base-100.shadow-sm .menu.menu-horizontal")).toBeVisible();
    await expect(app.locator(".toast.toast-top.toast-end .alert.alert-success")).toContainText("Saved");
    await expect(app.locator(".card.bg-base-100.w-96.shadow-sm figure img")).toHaveAttribute("alt", "Shoes");
    await expect(app.locator(".card.bg-base-100.w-96.shadow-sm .card-body .card-actions .btn.btn-primary")).toHaveText("Buy Now");
    await expect(app.locator("fieldset.fieldset.bg-base-100.border-base-300.rounded-box.w-64.border.p-4 input.checkbox.checkbox-primary")).toBeVisible();
    await expect(app.locator("input.input.input-bordered")).toHaveValue("Ada");
    await expect(app.locator("progress.progress.progress-primary.w-56")).toHaveAttribute("value", "45");
    await expect(app.locator('.daisy-rating .rating input[type="radio"].mask.mask-star')).toHaveCount(5);
    await expect(app.locator('.daisy-rating .rating input[type="radio"].mask.mask-star.filled')).toHaveCount(3);
    await expect(app.locator('.daisy-rating .rating input[type="radio"].mask.mask-star:checked')).toHaveCount(1);
    await expect.poll(async () => app.locator('.daisy-rating .rating input[type="radio"].mask.mask-star').evaluateAll(stars => stars.map(star => star.textContent || ""))).toEqual(["", "", "", "", ""]);
    await expect(app.locator('.daisy-accordion .collapse input[type="radio"]')).toHaveCount(2);
    await expect(app.locator(".daisy-accordion .collapse-title")).toHaveText(["Versand", "Rückgabe"]);
    await expect(app.locator(".daisy-accordion .collapse button")).toHaveCount(0);
    await expect(app.locator("table.table")).toBeVisible();
    const singleAvatar = app.locator('.daisy-widget:has(.avatar.avatar-online) .avatar.avatar-online').first();
    await expect(singleAvatar.locator("> div.w-16.rounded-full.ring.ring-primary.ring-offset-base-100.ring-offset-2 img")).toHaveAttribute("alt", "Ada Lovelace");
    await expect(app.locator('.daisy-widget > .avatar.avatar-placeholder.avatar-offline > div.w-12.rounded-full.bg-neutral.text-neutral-content span', { hasText: "GH" })).toHaveCount(1);
    const avatarGroup = app.locator(".avatar-group.-space-x-6");
    await expect(avatarGroup.locator("> .avatar")).toHaveCount(3);
    await expect(avatarGroup.locator("> .avatar.avatar-online img")).toHaveAttribute("alt", "Ada");
    await expect(avatarGroup.locator("> .avatar.avatar-placeholder span", { hasText: "+2" })).toHaveCount(1);

    await app.locator("fieldset input.checkbox.checkbox-primary").click();
    await expect.poll(async () => page.evaluate(() => {
      const read = (source, dottedPath) => dottedPath.split(".").reduce((value, key) => value?.[key], source);
      const context = typeof latestRuntimeContext !== "undefined" ? latestRuntimeContext : {};
      return read(context, "states.widgets.checkbox.checked");
    })).toBe(true);

    await app.locator('.daisy-rating .rating input.mask.mask-star[aria-label="5 stars"]').click();
    await expect.poll(async () => page.evaluate(() => {
      const read = (source, dottedPath) => dottedPath.split(".").reduce((value, key) => value?.[key], source);
      const context = typeof latestRuntimeContext !== "undefined" ? latestRuntimeContext : {};
      return read(context, "states.widgets.rating.value");
    })).toBe(5);

    await app.locator(".daisy-accordion .collapse").nth(1).click();
    await expect.poll(async () => page.evaluate(() => {
      const read = (source, dottedPath) => dottedPath.split(".").reduce((value, key) => value?.[key], source);
      const context = typeof latestRuntimeContext !== "undefined" ? latestRuntimeContext : {};
      return read(context, "states.widgets.accordion.open");
    })).toBe("Returns");

    await app.getByRole("button", { name: "open modal" }).click();
    await expect(app.locator("dialog.modal[open] .modal-box .modal-action .btn.btn-primary")).toHaveText("Confirm");
    await app.locator("dialog.modal[open] .modal-action .btn.btn-primary").click();
    await expect.poll(async () => page.evaluate(() => {
      const read = (source, dottedPath) => dottedPath.split(".").reduce((value, key) => value?.[key], source);
      const context = typeof latestRuntimeContext !== "undefined" ? latestRuntimeContext : {};
      return read(context, "states.widgets.modal");
    })).toMatchObject({
      confirmed: true,
      open: false
    });
  });

  test("offers and renders official daisy navbar variants as separate presets", async ({ page }) => {
    const navbarTitles = [
      "Navbar einfach",
      "Navbar mit Menü",
      "Navbar Suche/Profil",
      "Navbar Shop/Warenkorb"
    ];
    const data = {
      "states.navs.title": { layout: "title-only", brand: "Solo" },
      "states.navs.menu": { layout: "menu-submenu", brand: "Menu", selected: "Link", items: ["Link"], parent: "Parent", submenu: ["Link 1", "Link 2"], submenuOpen: true },
      "states.navs.search": { layout: "search-dropdown", brand: "Search", search: "", profileOpen: false, avatar: "https://img.daisyui.com/images/stock/photo-1534528741775-53994a69daeb.webp", menuItems: ["Profile", "Settings", "Logout"], badge: "New" },
      "states.navs.cart": { layout: "cart-profile", brand: "Cart", cartOpen: false, profileOpen: false, cartCount: 8, cartLabel: "Items", subtotal: "$999", actionLabel: "View cart", avatar: "https://img.daisyui.com/images/stock/photo-1534528741775-53994a69daeb.webp", menuItems: ["Profile", "Settings", "Logout"], badge: "New" }
    };
    const model = {
      version: 2,
      name: "Navbar variants",
      initial: "navs",
      states: [
        {
          id: "navs",
          title: "Navbar variants",
          body: "",
          x: 160,
          y: 160,
          data,
          components: Object.keys(data).map((path, index) => ({
            id: `nav_${index}`,
            type: "daisy",
            variant: "navbar",
            dataPath: path,
            dataRole: "widget",
            dataLabel: navbarTitles[index]
          }))
        }
      ],
      transitions: []
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");

    for (const title of navbarTitles) {
      await expect(componentPreset(page, title)).toHaveCount(1);
    }
    for (const title of ["Navbar - title and icon", "Navbar - icons start/end", "Navbar - dropdown center logo", "Navbar - colors"]) {
      await expect(componentPreset(page, title)).toHaveCount(0);
    }
    const longNavbarPreset = componentPreset(page, "Navbar Suche/Profil");
    await longNavbarPreset.scrollIntoViewIfNeeded();
    await expect(longNavbarPreset.getByRole("button", { name: "Navbar Suche/Profil hinzufügen" })).toHaveText("Hinzufügen");
    await expect.poll(async () => longNavbarPreset.evaluate(card => {
      const button = card.querySelector(".template-use");
      if (!button) return false;
      const cardRect = card.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      return buttonRect.left >= cardRect.left - 0.5 && buttonRect.right <= cardRect.right + 0.5;
    })).toBe(true);

    const app = appFrame(page);
    const navbars = app.locator(".navbar");
    await expect(navbars).toHaveCount(4);
    await expect(navbars.nth(0).locator(".btn.text-xl")).toHaveText("Solo");
    await expect(navbars.nth(1).locator("details summary")).toHaveText("Parent");
    await expect(navbars.nth(1).locator("details ul.bg-base-100.rounded-t-none button")).toHaveCount(2);
    await expect(navbars.nth(2).locator("input.input.input-bordered")).toHaveAttribute("placeholder", "Search");
    await expect(navbars.nth(2).locator(".dropdown.dropdown-end .avatar img")).toBeVisible();
    await expect(navbars.nth(2).locator(".dropdown-content")).toBeHidden();
    await navbars.nth(2).locator(".dropdown.dropdown-end [role='button']").click();
    await expect(navbars.nth(2).locator(".dropdown-content")).toBeVisible();
    await expect.poll(async () => {
      const context = await runtimeContext(page);
      return context.states?.navs?.search?.profileOpen;
    }).toBe(true);
    await expect.poll(async () => navbars.nth(2).evaluate(el => el.getBoundingClientRect().height)).toBeLessThan(90);
    await expect.poll(async () => navbars.nth(2).evaluate(el => {
      const bounds = el.getBoundingClientRect();
      return [...el.querySelectorAll("input.input, .dropdown")].every(child => {
        const rect = child.getBoundingClientRect();
        return rect.left >= bounds.left - 0.5 && rect.right <= bounds.right + 0.5;
      });
    })).toBe(true);
    await navbars.nth(2).locator(".dropdown.dropdown-end [role='button']").click();
    await expect(navbars.nth(2).locator(".dropdown-content")).toBeHidden();
    const cartNavbar = navbars.nth(3);
    await expect(cartNavbar.locator(".indicator .badge-sm")).toHaveText("8");
    await expect(cartNavbar.locator("> .flex-none > .dropdown")).toHaveCount(2);
    await expect.poll(async () => cartNavbar.locator("> .flex-none > .dropdown").evaluateAll(dropdowns => {
      if (dropdowns.length !== 2) return false;
      const rects = dropdowns.map(dropdown => dropdown.getBoundingClientRect());
      return Math.abs((rects[0].top + rects[0].height / 2) - (rects[1].top + rects[1].height / 2)) < 4
        && rects[1].left >= rects[0].right - 1;
    })).toBe(true);
    await expect.poll(async () => cartNavbar.evaluate(el => el.getBoundingClientRect().height)).toBeLessThan(90);
    await expect.poll(async () => app.locator("body").evaluate(body => {
      const html = document.documentElement;
      return Math.max(body.scrollWidth, html.scrollWidth) <= html.clientWidth + 2
        && Math.max(body.scrollHeight, html.scrollHeight) <= html.clientHeight + 2
        && body.clientHeight >= html.clientHeight - 2;
    })).toBe(true);
    const profileTrigger = cartNavbar.locator(".dropdown.dropdown-end").nth(1).locator("[role='button']");
    await profileTrigger.click();
    await expect(cartNavbar.locator(".menu.dropdown-content")).toBeVisible();
    await expect.poll(async () => cartNavbar.evaluate(el => el.getBoundingClientRect().height)).toBeLessThan(90);
    await expect.poll(async () => app.locator("body").evaluate(body => {
      const html = document.documentElement;
      return Math.max(body.scrollWidth, html.scrollWidth) <= html.clientWidth + 2
        && Math.max(body.scrollHeight, html.scrollHeight) <= html.clientHeight + 2
        && body.clientHeight >= html.clientHeight - 2;
    })).toBe(true);
    await expect.poll(async () => cartNavbar.locator(".menu.dropdown-content li > button").evaluateAll(buttons => {
      return buttons.length === 3 && buttons.every(button => {
        const buttonRect = button.getBoundingClientRect();
        const menuRect = button.closest(".dropdown-content").getBoundingClientRect();
        const style = getComputedStyle(button);
        return buttonRect.left >= menuRect.left - 0.5
          && buttonRect.right <= menuRect.right + 0.5
          && parseFloat(style.borderTopLeftRadius) <= 10;
      });
    })).toBe(true);
    await profileTrigger.click();
    await expect(cartNavbar.locator(".menu.dropdown-content")).toBeHidden();
    await cartNavbar.locator(".dropdown.dropdown-end").first().locator("[role='button']").click();
    await expect.poll(async () => {
      const context = await runtimeContext(page);
      return context.states?.navs?.cart?.cartOpen;
    }).toBe(true);
    await expect(cartNavbar.locator(".card.dropdown-content .card-actions .btn-primary")).toHaveText("View cart");
  });

  test("does not render removed daisy variants or navbar layouts", async ({ page }) => {
    const model = {
      version: 2,
      name: "Removed daisy variants",
      initial: "unsupported_widgets",
      states: [
        {
          id: "unsupported_widgets",
          title: "Unsupported widgets",
          body: "",
          x: 160,
          y: 160,
          data: {
            "states.unsupported_widgets.join": { selected: "Left", items: ["Left", "Right"] },
            "states.unsupported_widgets.kbd": { label: "Ctrl+K" },
            "states.unsupported_widgets.navbar": { layout: "colors", brand: "Old", selected: "Dashboard", items: ["Dashboard"] }
          },
          components: [
            { id: "join", type: "daisy", variant: "join", dataPath: "states.unsupported_widgets.join", dataRole: "widget", dataLabel: "Join" },
            { id: "kbd", type: "daisy", variant: "kbd", dataPath: "states.unsupported_widgets.kbd", dataRole: "widget", dataLabel: "Keyboard key" },
            { id: "navbar", type: "daisy", variant: "navbar", dataPath: "states.unsupported_widgets.navbar", dataRole: "widget", dataLabel: "Navbar colors" }
          ]
        }
      ],
      transitions: []
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");

    const app = appFrame(page);
    await expect(app.locator("#screen h1")).toHaveText("Unsupported widgets");
    await expect(app.locator(".daisy-widget")).toHaveCount(0);
    await expect(app.locator(".navbar")).toHaveCount(0);
    await expect(app.locator(".hero")).toHaveCount(0);
    await expect(app.locator(".join")).toHaveCount(0);
    await expect(app.locator(".kbd")).toHaveCount(0);
  });

  test("renders daisy image mask inside its shape bounds @smoke", async ({ page }) => {
    const imageUrl = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMjAiIGhlaWdodD0iMTYwIiB2aWV3Qm94PSIwIDAgMzIwIDE2MCI+PHJlY3Qgd2lkdGg9IjMyMCIgaGVpZ2h0PSIxNjAiIGZpbGw9IiMwZWE1ZTkiLz48Y2lyY2xlIGN4PSIyNjAiIGN5PSI4MCIgcj0iNzIiIGZpbGw9IiNmNTllMGIiLz48L3N2Zz4=";
    const model = {
      version: 2,
      name: "Mask bounds",
      initial: "mask",
      states: [
        {
          id: "mask",
          title: "Bildmaske",
          body: "",
          x: 160,
          y: 160,
          data: {
            "states.mask.mask": { image: imageUrl, alt: "Wide source image", shape: "hexagon" }
          },
          dataTypes: {
            "states.mask.mask": "object",
            "states.mask.mask.image": "image",
            "states.mask.mask.alt": "text",
            "states.mask.mask.shape": "text"
          },
          components: [
            { id: "mask_component", type: "daisy", variant: "mask", dataPath: "states.mask.mask", dataRole: "widget", dataLabel: "Bildmaske" }
          ]
        }
      ],
      transitions: []
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");

    const app = appFrame(page);
    const mask = app.locator(".mask").first();
    await expect(mask).toBeVisible();
    await expect(mask.locator("img")).toHaveAttribute("src", imageUrl);

    const metrics = await mask.evaluate(el => {
      const img = el.querySelector("img");
      const maskRect = el.getBoundingClientRect();
      const imgRect = img.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        maskWidth: maskRect.width,
        maskHeight: maskRect.height,
        overflow: style.overflow,
        clipPath: style.clipPath,
        imgInside:
          imgRect.left >= maskRect.left - 0.5 &&
          imgRect.top >= maskRect.top - 0.5 &&
          imgRect.right <= maskRect.right + 0.5 &&
          imgRect.bottom <= maskRect.bottom + 0.5,
        pageOverflow: document.body.scrollWidth > document.body.clientWidth + 2
      };
    });

    expect(metrics.maskWidth).toBeGreaterThan(40);
    expect(Math.abs(metrics.maskWidth - metrics.maskHeight)).toBeLessThanOrEqual(1);
    expect(metrics.overflow).toBe("hidden");
    expect(metrics.clipPath).toContain("polygon");
    expect(metrics.imgInside).toBe(true);
    expect(metrics.pageOverflow).toBe(false);
  });

  test("offers official daisy hero variants as separate flow-ready presets @smoke", async ({ page }) => {
    await openTool(page);

    const heroTitles = [
      "Hero-Bereich",
      "Hero mit Bild",
      "Hero mit Bild rechts",
      "Hero mit Login-Formular",
      "Hero mit Bild-Overlay"
    ];
    for (const title of heroTitles) {
      await expect(componentPreset(page, title)).toHaveCount(1);
    }
    await expect(componentPreset(page, "Hero - reverse figure")).toHaveCount(0);

    await addComponentState(page, "Hero mit Bild-Overlay");
    const model = await savedModel(page);
    const heroState = model.states.find(state => state.title === "Hero mit Bild-Overlay");
    expect(heroState).toBeTruthy();
    const scopePath = `states.${heroState.id}`;
    expect(heroState.components[0]).toMatchObject({
      type: "daisy",
      variant: "hero",
      dataPath: scopePath
    });
    expect(heroState.data[scopePath]).toMatchObject({
      layout: "overlay",
      actionLabel: "Planung starten"
    });

    const transition = model.transitions.find(item => item.from === heroState.id && item.label === "Planung starten");
    expect(transition).toBeTruthy();
    expect(transition.set).toEqual({ [`${scopePath}.clicked`]: true });
    const app = appFrame(page);
    await expect(app.locator(".hero.min-h-screen .hero-overlay")).toBeVisible();
    await expect(app.locator(".hero.min-h-screen .hero-content.text-neutral-content.text-center")).toBeVisible();
    await expect(app.locator(`.hero button[data-transition-id="${transition.id}"]`, { hasText: "Planung starten" })).toBeVisible();
    await expect(app.locator("#screen > h1")).toHaveCount(0);

    await addComponentState(page, "Hero mit Bild rechts");
    const reverseModel = await savedModel(page);
    const reverseState = reverseModel.states.find(state => state.title === "Hero mit Bild rechts");
    expect(reverseState.data[`states.${reverseState.id}`]).toMatchObject({ layout: "figure-reverse" });
    const reverseTransition = reverseModel.transitions.find(item => item.from === reverseState.id && item.label === "Plan prüfen");
    expect(reverseTransition).toBeTruthy();
    await expect(app.locator(".hero-content.flex-col.lg\\:flex-row-reverse img.max-w-sm.rounded-lg.shadow-2xl")).toBeVisible();
    await expect(app.locator(`.hero button[data-transition-id="${reverseTransition.id}"]`, { hasText: "Plan prüfen" })).toBeVisible();
  });

  test("runs while loops as conditional self-transitions with a normal exit", async ({ page }) => {
    const model = {
      version: 2,
      name: "Polling loop",
      initial: "poll",
      states: [
        {
          id: "poll",
          title: "Polling",
          body: "",
          x: 120,
          y: 140,
          data: { fetched: false },
          components: [{ id: "poll_note", type: "note", text: "Waiting for data", url: "" }]
        },
        {
          id: "ready",
          title: "Ready",
          body: "",
          x: 480,
          y: 140,
          data: {},
          components: [{ id: "ready_text", type: "text", text: "Data arrived", url: "" }]
        }
      ],
      transitions: [
        { id: "repeat", from: "poll", to: "poll", label: "while !fetched", condition: "!fetched", set: {} },
        { id: "done", from: "poll", to: "ready", label: "done", condition: "fetched", set: {} }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");

    const app = appFrame(page);
    await expect(page.locator('[data-id="poll"]')).toBeVisible();
    await expect(app.locator("#statePill")).toHaveText("poll");
    await expect(app.getByText("Waiting for data")).toBeVisible();
    await expect(app.locator(".field").filter({ hasText: "fetched" }).locator(".switch-value")).toHaveText("Off");

    await app.getByRole("button", { name: "while !fetched" }).click();
    await expect(app.locator("#statePill")).toHaveText("poll");

    await app.locator(".field").filter({ hasText: "fetched" }).locator(".switch").click();
    await expect(app.locator(".field").filter({ hasText: "fetched" }).locator(".switch-value")).toHaveText("On");

    await app.getByRole("button", { name: "while !fetched" }).click();
    await expect(app.locator(".action.invalid").filter({ hasText: "while !fetched" }).locator(".condition-feedback"))
      .toContainText("Condition not met");
    await expect(app.locator("#statePill")).toHaveText("poll");

    await app.getByRole("button", { name: "done" }).click();
    await expect(app.locator("#statePill")).toHaveText("ready");
    await expect(app.getByText("Data arrived")).toBeVisible();
  });

  test("Inhaltsliste preset renders useful sample data before connecting an endpoint @smoke", async ({ page }) => {
    await openTool(page);

    const contentListId = await addComponentState(page, "Inhaltsliste");
    const contentListFetchPath = `states.${contentListId}.fetch`;
    const contentListDataPath = `${contentListFetchPath}.data`;
    await openRepeatEditor(page);
    await expect(page.locator("#pRepeatPath")).toHaveValue(contentListDataPath);
    await expect(dataRenderRows(page).filter({ hasText: "Feld: Bild" })).toBeVisible();
    await expect(dataRenderRows(page).filter({ hasText: "Feld: Titel" })).toBeVisible();
    await expect(dataRenderRows(page).filter({ hasText: "Feld: Beschreibung" })).toBeVisible();
    await expect(dataRenderRows(page).filter({ hasText: "Feld: Preis" })).toBeVisible();

    const app = appFrame(page);
    await expect(app.getByRole("heading", { name: "Starter-Paket" })).toBeVisible();
    await expect(app.getByText("Eine klare Angebotskarte mit Bild, Titel, Kurztext und Preis.")).toBeVisible();
    await expect(app.getByText("Preis: EUR 29")).toBeVisible();
    await expect(app.getByRole("heading", { name: "Team-Workshop" })).toBeVisible();
    await expect(app.locator(".component-image")).toHaveCount(2);

    const model = await savedModel(page);
    const apiState = model.states.find(state => state.title === "Inhaltsliste");
    expect(apiState.components).toEqual([]);
    expect(apiState.dataSource).toMatchObject({
      url: "",
      target: contentListFetchPath,
      select: ""
    });
    expect(apiState.data[contentListFetchPath]).toMatchObject({
      status: "sample",
      done: true,
      ok: true,
      count: 2
    });
    expect(apiState.data[contentListFetchPath].data).toHaveLength(2);
    expect(apiState.repeat).toEqual({ path: contentListDataPath, as: "item", index: "i", manual: true });
    expect(apiState.dataWires.map(wire => wire.sourcePath)).toEqual([
      `${contentListDataPath}.image`,
      `${contentListDataPath}.title`,
      `${contentListDataPath}.description`,
      `${contentListDataPath}.price`
    ]);
  });

  test("Inhaltsliste drops keep API data scoped per canvas state @smoke", async ({ page }) => {
    await openTool(page);

    const firstId = await addComponentState(page, "Inhaltsliste");
    const secondId = await addComponentState(page, "Inhaltsliste");
    const model = await savedModel(page);
    const states = [firstId, secondId].map(id => model.states.find(state => state.id === id));

    expect(states.every(Boolean)).toBe(true);
    expect(states.map(state => state.dataSource.target)).toEqual([
      `states.${firstId}.fetch`,
      `states.${secondId}.fetch`
    ]);
    expect(new Set(states.map(state => state.dataSource.target)).size).toBe(2);
    for (const state of states) {
      const fetchPath = `states.${state.id}.fetch`;
      expect(state.data.fetch).toBeUndefined();
      expect(state.data[fetchPath].data).toHaveLength(2);
      expect(state.repeat.path).toBe(`${fetchPath}.data`);
      expect(state.dataWires.every(wire => wire.sourcePath.startsWith(`${fetchPath}.data.`))).toBe(true);
    }
  });

  test("inspects JSON endpoints and wires array fields into repeated state content", async ({ page }) => {
    const alphaImage = "https://example.com/alpha.png";
    const betaImage = "https://example.com/beta.png";
    await page.route("https://api.example.test/lessons", route => route.fulfill({
      status: 200,
      headers: {
        "access-control-allow-origin": "*",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        items: [
          { title: "Alpha", images: [alphaImage], url: "https://example.test/a" },
          { title: "Beta", images: [betaImage], url: "https://example.test/b" }
        ]
      })
    }));
    await openTool(page);

    const contentListId = await addComponentState(page, "Inhaltsliste");
    const contentListFetchPath = `states.${contentListId}.fetch`;
    const contentListDataPath = `${contentListFetchPath}.data`;
    await openFetchEditor(page);
    await page.locator("#pDataSourceUrl").fill("https://api.example.test/lessons");
    await expect(page.locator("#pDataSourceInspect")).toContainText("Data 200");
    const itemsActions = page.locator(".fetch-json-meta").filter({ hasText: "items - 2 items" });
    await expect(itemsActions.getByRole("button", { name: "Use this data" })).toBeVisible();

    await itemsActions.getByRole("button", { name: "Show list" }).click();
    await openRepeatEditor(page);
    await expect(page.locator("#pDataSourceSelect")).toHaveValue("items");
    await expect(page.locator("#pRepeatPath")).toHaveValue(contentListDataPath);
    await expect(page.locator("#pRepeatAs")).toHaveValue("item");
    await expect(dataRenderRows(page).filter({ hasText: "Field: Title" })).toBeVisible();
    await expect(appFrame(page).getByRole("heading", { name: "Alpha" })).toBeVisible();
    await expect(appFrame(page).getByRole("heading", { name: "Beta" })).toBeVisible();
    await expect(appFrame(page).locator(".component-image")).toHaveCount(2);
    await expect(appFrame(page).locator(".component-image").nth(0)).toHaveAttribute("src", alphaImage);
    await expect(appFrame(page).locator(".component-image").nth(1)).toHaveAttribute("src", betaImage);

    const model = await savedModel(page);
    const fetchState = model.states.find(state => state.title === "Inhaltsliste");
    expect(fetchState.dataSource).toMatchObject({
      url: "https://api.example.test/lessons",
      target: contentListFetchPath,
      select: "items"
    });
    expect(fetchState.repeat).toEqual({ path: contentListDataPath, as: "item", index: "i", manual: true });
    expect(fetchState.subscriptions || []).toEqual([]);
    expect(fetchState.components).toEqual([]);
    expect(fetchState.dataWires).toHaveLength(2);
    expect(fetchState.dataWires).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourcePath: `${contentListDataPath}.images.0`,
        scopePath: contentListDataPath,
        itemPath: "images.0",
        role: "image",
        componentType: "image"
      }),
      expect.objectContaining({
        sourcePath: `${contentListDataPath}.title`,
        scopePath: contentListDataPath,
        itemPath: "title",
        role: "title",
        componentType: "heading"
      })
    ]));
  });

  test("fetch preview field actions create readable render mappings without template tokens", async ({ page }) => {
    const alphaImage = "https://example.com/alpha.png";
    const betaImage = "https://example.com/beta.png";
    await page.route("https://api.example.test/products", route => route.fulfill({
      status: 200,
      headers: {
        "access-control-allow-origin": "*",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        items: [
          { title: "Alpha", images: [alphaImage], category: { creationAt: "2026-06-24T18:49:24.000Z" } },
          { title: "Beta", images: [betaImage], category: { creationAt: "2026-06-25T18:49:24.000Z" } }
        ]
      })
    }));
    await openTool(page);

    const contentListId = await addComponentState(page, "Inhaltsliste");
    const contentListFetchPath = `states.${contentListId}.fetch`;
    const contentListItemsPath = `${contentListFetchPath}.data.items`;
    await openFetchEditor(page);
    await page.locator("#pDataSourceUrl").fill("https://api.example.test/products");
    await expect(page.locator("#pDataSourceInspect")).toContainText("items.images.0");
    await expect(page.locator("#pDataSourceInspect")).toContainText("items.category.creationAt");

    await page.locator(".fetch-json-line").filter({ hasText: "items.images.0" }).getByRole("button", { name: "Show image" }).click();
    await page.locator(".fetch-json-line").filter({ hasText: "items.category.creationAt" }).getByRole("button", { name: "Show text" }).click();

    await openRepeatEditor(page);
    await expect(page.locator("#pRepeatPath")).toHaveValue(contentListItemsPath);
    await expect(dataRenderRows(page).filter({ hasText: "Field: Image" })).toBeVisible();
    await expect(dataRenderRows(page).filter({ hasText: "Field: Creation At" })).toBeVisible();
    await expect(appFrame(page).locator(".component-image")).toHaveCount(2);
    await expect(appFrame(page).locator(".component-image").nth(0)).toHaveAttribute("src", alphaImage);
    await expect(appFrame(page).getByText("Creation At: 2026-06-24T18:49:24.000Z")).toBeVisible();

    const model = await savedModel(page);
    const fetchState = model.states.find(state => state.title === "Inhaltsliste");
    expect(fetchState.repeat).toEqual({ path: contentListItemsPath, as: "item", index: "i", manual: true });
    expect(fetchState.dataWires.map(wire => wire.sourcePath)).toEqual([
      `${contentListItemsPath}.images.0`,
      `${contentListItemsPath}.category.creationAt`
    ]);
    expect(JSON.stringify(fetchState.components || [])).not.toContain("{{");
  });

  test("generated app treats JSON fetch results as FSM events and renders mapped content", async ({ page }) => {
    await page.route("https://api.example.test/runtime-lessons", route => route.fulfill({
      status: 200,
      headers: {
        "access-control-allow-origin": "*",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        items: [
          { title: "Alpha", slug: "alpha" },
          { title: "Beta", slug: "beta" }
        ]
      })
    }));
    const model = {
      version: 2,
      name: "Runtime fetch",
      initial: "load",
      states: [
        {
          id: "load",
          title: "Lessons",
          body: "",
          x: 120,
          y: 140,
          data: {},
          dataSource: {
            url: "https://api.example.test/runtime-lessons",
            target: "states.load.fetch",
            select: "items",
            timeoutMs: 2000,
            retries: 0
          },
          components: [{ id: "loading_note", type: "note", text: "Loading {{states.load.fetch.status}}", url: "" }]
        },
        {
          id: "ready",
          title: "Ready",
          body: "",
          x: 480,
          y: 140,
          data: {},
          repeat: { path: "states.load.fetch.data", as: "item", index: "i" },
          components: [
            { id: "lesson_heading", type: "heading", text: "#{{i}} {{item.title}}", url: "" },
            { id: "lesson_link", type: "link", text: "Open {{item.title}}", url: "https://example.com/{{item.slug}}" }
          ]
        }
      ],
      transitions: [
        { id: "ready_transition", from: "load", to: "ready", label: "Ready", condition: "states.load.fetch.ok && states.load.fetch.count >= 2", set: {} }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");

    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("ready");
    await expect(app.getByRole("heading", { name: "#0 Alpha" })).toBeVisible();
    await expect(app.getByRole("heading", { name: "#1 Beta" })).toBeVisible();
    await expect(app.getByRole("link", { name: "Open Alpha" })).toHaveAttribute("href", "https://example.com/alpha");
  });

  test("generated app only auto-follows transitions that reference the active fetch context", async ({ page }) => {
    await page.route("https://api.example.test/no-auto", route => route.fulfill({
      status: 200,
      headers: {
        "access-control-allow-origin": "*",
        "content-type": "application/json"
      },
      body: JSON.stringify({ ok: true })
    }));
    const model = {
      version: 2,
      name: "Manual after fetch",
      initial: "load",
      states: [
        {
          id: "load",
          title: "Load",
          body: "",
          x: 120,
          y: 140,
          data: {},
          dataSource: {
            url: "https://api.example.test/no-auto",
            target: "fetch",
            select: "",
            timeoutMs: 2000,
            retries: 0
          },
          components: [{ id: "status", type: "note", text: "Status {{fetch.status}}", url: "" }]
        },
        {
          id: "ready",
          title: "Ready",
          body: "",
          x: 480,
          y: 140,
          data: {},
          components: [{ id: "ready_text", type: "text", text: "Manual transition only", url: "" }]
        }
      ],
      transitions: [
        { id: "manual_ready", from: "load", to: "ready", label: "Manual ready", condition: "manual == false", set: {} }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");

    const app = appFrame(page);
    await expect(app.getByText("Status success")).toBeVisible();
    await expect(app.locator("#statePill")).toHaveText("load");

    await app.getByRole("button", { name: "Manual ready" }).click();
    await expect(app.locator("#statePill")).toHaveText("ready");
  });

  test("generated app routes failed JSON fetches through custom target conditions", async ({ page }) => {
    await page.route("https://api.example.test/fails", route => route.fulfill({
      status: 500,
      headers: {
        "access-control-allow-origin": "*",
        "content-type": "application/json"
      },
      body: JSON.stringify({ error: "nope" })
    }));
    const model = {
      version: 2,
      name: "Fetch failure",
      initial: "load",
      states: [
        {
          id: "load",
          title: "Load users",
          body: "",
          x: 120,
          y: 140,
          data: {},
          dataSource: {
            url: "https://api.example.test/fails",
            target: "users",
            select: "",
            timeoutMs: 2000,
            retries: 0
          },
          components: [{ id: "loading", type: "note", text: "Loading users", url: "" }]
        },
        {
          id: "failed",
          title: "Failed",
          body: "",
          x: 480,
          y: 140,
          data: {},
          components: [{ id: "failed_note", type: "note", text: "Fetch failed: {{users.error}}", url: "" }]
        }
      ],
      transitions: [
        { id: "fetch_failed", from: "load", to: "failed", label: "Fetch failed", condition: "users.status == \"error\"", set: {} }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");

    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("failed");
    await expect(app.getByText("Fetch failed: HTTP 500")).toBeVisible();
  });

  test("generated app discards stale fetch events after leaving the source state", async ({ page }) => {
    let releaseFetch;
    let markFetchStarted;
    let markFetchFinished;
    const fetchStarted = new Promise(resolve => { markFetchStarted = resolve; });
    const fetchFinished = new Promise(resolve => { markFetchFinished = resolve; });
    await page.route("https://api.example.test/stale", async route => {
      markFetchStarted();
      await new Promise(release => { releaseFetch = release; });
      await route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": "*",
          "content-type": "application/json"
        },
        body: JSON.stringify({ title: "Late result" })
      });
      markFetchFinished();
    });
    const model = {
      version: 2,
      name: "Stale fetch",
      initial: "load",
      states: [
        {
          id: "load",
          title: "Load",
          body: "",
          x: 120,
          y: 140,
          data: {},
          dataSource: {
            url: "https://api.example.test/stale",
            target: "fetch",
            select: "",
            timeoutMs: 2000,
            retries: 0
          },
          components: [{ id: "loading", type: "note", text: "Loading {{fetch.status}}", url: "" }]
        },
        {
          id: "skipped",
          title: "Skipped",
          body: "",
          x: 480,
          y: 80,
          data: {},
          components: [{ id: "skipped_note", type: "note", text: "Skipped before fetch finished", url: "" }]
        },
        {
          id: "ready",
          title: "Ready",
          body: "",
          x: 480,
          y: 220,
          data: {},
          components: [{ id: "ready_note", type: "note", text: "Should not be reached by stale data", url: "" }]
        }
      ],
      transitions: [
        { id: "fetch_ready", from: "load", to: "ready", label: "Ready", condition: "fetch.ok", set: {} },
        { id: "skip", from: "load", to: "skipped", label: "Skip", condition: "", set: {} },
        { id: "leak", from: "skipped", to: "ready", label: "Leak check", condition: "fetch.ok", set: {} }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");

    const app = appFrame(page);
    await fetchStarted;
    await expect(app.locator("#statePill")).toHaveText("load");
    await app.getByRole("button", { name: "Skip" }).click();
    await expect(app.locator("#statePill")).toHaveText("skipped");

    releaseFetch();
    await fetchFinished;
    await app.getByRole("button", { name: "Leak check" }).click();
    await expect(app.locator("#statePill")).toHaveText("skipped");
    await expect(app.locator(".action.invalid").filter({ hasText: "Leak check" }).locator(".condition-feedback"))
      .toContainText("Condition not met");
  });

  test("generated app retries within the active fetch state before emitting the fetch event", async ({ page }) => {
    let attempts = 0;
    await page.route("https://api.example.test/retry", route => {
      attempts += 1;
      if (attempts === 1) {
        return route.fulfill({
          status: 503,
          headers: {
            "access-control-allow-origin": "*",
            "content-type": "application/json"
          },
          body: JSON.stringify({ error: "try again" })
        });
      }
      return route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": "*",
          "content-type": "application/json"
        },
        body: JSON.stringify({ items: [{ title: "Recovered" }] })
      });
    });
    const model = {
      version: 2,
      name: "Retry fetch",
      initial: "load",
      states: [
        {
          id: "load",
          title: "Load",
          body: "",
          x: 120,
          y: 140,
          data: {},
          dataSource: {
            url: "https://api.example.test/retry",
            target: "states.load.fetch",
            select: "items",
            timeoutMs: 2000,
            retries: 1
          },
          components: [{ id: "loading", type: "note", text: "Loading {{states.load.fetch.status}}", url: "" }]
        },
        {
          id: "ready",
          title: "Ready",
          body: "",
          x: 480,
          y: 140,
          data: {},
          repeat: { path: "states.load.fetch.data", as: "item", index: "i" },
          components: [{ id: "ready_heading", type: "heading", text: "{{item.title}}", url: "" }]
        }
      ],
      transitions: [
        { id: "fetch_ready", from: "load", to: "ready", label: "Ready", condition: "states.load.fetch.ok && states.load.fetch.count == 1", set: {} }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");

    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("ready");
    await expect(app.getByRole("heading", { name: "Recovered" })).toBeVisible();
    expect(attempts).toBe(2);
  });

  test("selecting a state starts preview and keeps runtime tab order and Enter submit usable", async ({ page }) => {
    await openTool(page);
    const app = appFrame(page);

    await page.locator('[data-id="login"]').click();
    await expect(app.locator("#statePill")).toHaveText("login");
    await expect(page.locator("#pStartHere")).toHaveCount(0);
    await expect(app.locator("#readButton")).toHaveCount(0);
    await expect(app.locator("#speechRate")).toHaveCount(0);

    const email = app.locator(".field").filter({ hasText: "email" }).locator("input");
    const password = app.locator(".field").filter({ hasText: "password" }).locator("input");
    const primaryButton = app.getByRole("button", { name: "Einloggen" });

    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(false);
    await expect.poll(() => page.locator("#map").evaluate(el => document.activeElement === el)).toBe(true);
    await expect(email).toHaveAttribute("tabindex", "0");
    await expect(password).toHaveAttribute("tabindex", "0");
    await expect(primaryButton).toHaveAttribute("tabindex", "0");
    await expect(primaryButton).toHaveAttribute("data-default-action", "true");

    await email.fill("user@example.com");
    await password.fill("secret123");
    await password.press("Enter");

    await expect(app.locator("#statePill")).toHaveText("logged_in");
    await expect(page.locator('[data-id="logged_in"]')).toHaveClass(/selected/);
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Logged in");
    await expect(page.locator("#pTitle")).toHaveValue("Logged in");
  });

  test("generated app preview uses the dark theme with readable controls", async ({ page }) => {
    await openTool(page);
    const app = appFrame(page);

    await page.locator('[data-id="login"]').click();
    await expect(app.locator("#statePill")).toHaveText("login");

    const theme = await app.locator("body").evaluate(body => {
      const styleOf = selector => getComputedStyle(document.querySelector(selector));
      const colorToRgb = color => {
        const probe = document.createElement("span");
        probe.style.color = color;
        document.body.appendChild(probe);
        const rgb = getComputedStyle(probe).color;
        probe.remove();
        return rgb;
      };
      const root = getComputedStyle(document.documentElement);
      const buttonStyle = styleOf("button[data-transition-id]");
      const buttonColor = buttonStyle.getPropertyValue("--button-color").trim();
      const buttonStrongColor = buttonStyle.getPropertyValue("--button-color-strong").trim();
      return {
        colorScheme: root.colorScheme,
        rootBg: root.getPropertyValue("--bg").trim(),
        rootCard: root.getPropertyValue("--card").trim(),
        rootPrimary: root.getPropertyValue("--primary").trim(),
        fontFamily: root.fontFamily,
        bodyBg: getComputedStyle(body).backgroundColor,
        bodyColor: getComputedStyle(body).color,
        screenBg: styleOf("#screen").backgroundColor,
        screenBorder: styleOf("#screen").borderColor,
        titleColor: styleOf("h1").color,
        pillBg: styleOf("#statePill").backgroundColor,
        pillColor: styleOf("#statePill").color,
        buttonBg: buttonStyle.backgroundColor,
        buttonColor: buttonStyle.color,
        buttonTransitionColor: colorToRgb(buttonColor),
        buttonTransitionStrongColor: colorToRgb(buttonStrongColor),
        buttonBackgroundImage: buttonStyle.backgroundImage,
        inputBg: styleOf(".typed-input").backgroundColor,
        inputColor: styleOf(".typed-input").color,
      };
    });

    expect(theme).toMatchObject({
      colorScheme: "dark",
      rootBg: "#020617",
      rootCard: "#06111f",
      rootPrimary: "#38bdf8",
      bodyBg: "rgb(2, 6, 23)",
      bodyColor: "rgb(229, 240, 255)",
      screenBg: "rgb(6, 17, 31)",
      screenBorder: "rgb(29, 57, 86)",
      titleColor: "rgb(248, 251, 255)",
      pillBg: "rgb(7, 19, 33)",
      pillColor: "rgb(125, 211, 252)",
      buttonColor: "rgb(3, 16, 31)",
      buttonBackgroundImage: "none",
      inputBg: "rgb(2, 11, 22)",
      inputColor: "rgb(229, 240, 255)",
    });
    expect(theme.buttonBg).toBe(theme.buttonTransitionColor);
    expect(theme.buttonTransitionStrongColor).toBe(theme.buttonTransitionColor);
    expect(theme.fontFamily).toContain("Atkinson Hyperlegible");
    expect(theme.screenBg).not.toBe("rgb(255, 255, 255)");
    expect(theme.pillBg).not.toBe("rgb(255, 255, 255)");
  });

  test("creates a new state by dragging a transition to empty canvas", async ({ page }) => {
    await openTool(page);
    await expect(page.locator(".workspace")).toHaveClass(/inspector-collapsed/);
    const start = await centerOf(statePort(page, "auth_start", "out"));
    const target = await emptyCanvasPoint(page);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 12 });
    await page.mouse.up();

    await expect(canvasStateNodes(page)).toHaveCount(7);
    await expect(boundaryProxyNodes(page)).toHaveCount(2);
    await expect(page.locator(".workspace")).toHaveClass(/inspector-collapsed/);
    await expect(page.locator("#stateInspector")).toHaveClass(/inspector-pulse/);
    await expect(page.locator("#pTitle")).toBeHidden();
    await expect.poll(() => page.locator("#pTitle").evaluate(el => ({
      focused: document.activeElement === el,
      value: el.value,
    }))).toMatchObject({
      focused: false,
      value: expect.stringMatching(/^State \d+$/)
    });
    await expect.poll(() => page.locator("#map").evaluate(el => document.activeElement === el || document.activeElement === document.body)).toBe(true);

    await page.keyboard.type("Steuern");

    const model = await savedModel(page);
    expect(model.states).toHaveLength(7);
    const created = model.states.find(state => state.title === "Steuern");
    expect(created).toBeTruthy();
    expect(model.states.some(state => /^State \d+$/.test(state.title))).toBe(false);
    expect(model.transitions.some(t => t.from === "auth_start" && t.to === created.id)).toBeTruthy();
    await expect(page.locator(`[data-id="${created.id}"] .title`)).toHaveText("Steuern");
    await expect(page.locator("#pTitle")).toHaveValue("Steuern");
    await expect(page.locator(".quick-title-input")).toHaveValue("Steuern");
    await expect.poll(() => page.locator(".quick-title-input").evaluate(el => document.activeElement === el)).toBe(true);
  });

  test("single-clicking a transition handle selects it without creating a state @smoke", async ({ page }) => {
    await openTool(page);
    const before = await savedModel(page);
    const loginEdgeId = before.transitions.find(t => t.from === "auth_start" && t.to === "login")?.id;
    expect(loginEdgeId).toBeTruthy();

    const arrowTip = page.locator(`circle.edge-tip-hit[data-edge-id="${loginEdgeId}"]`);
    await expect(arrowTip).toBeVisible();
    const point = await centerOf(arrowTip);
    await page.mouse.click(point.x, point.y);

    await expect(page.locator(`.edge[data-edge-id="${loginEdgeId}"]`)).toHaveClass(/selected/);
    await expect(page.locator("#pLabel")).toBeVisible();
    await expect.poll(async () => {
      const model = await savedModel(page);
      return {
        states: model.states.length,
        transitions: model.transitions.length,
        selectedEdge: await page.evaluate(() => selected?.edges?.[0] || "")
      };
    }).toEqual({
      states: before.states.length,
      transitions: before.transitions.length,
      selectedEdge: loginEdgeId
    });
  });

  test("renames selected states and transitions through a real inline title input", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"]').click();
    await expect(page.locator("#pTitle")).toBeVisible();
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(false);
    await expect.poll(() => page.locator("#map").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.type("Sign in step");
    await expect(page.locator(".quick-title-input")).toBeVisible();
    await expect(page.locator(".quick-title-input")).toHaveValue("Sign in step");
    await expect.poll(() => page.locator(".quick-title-input").evaluate(el => document.activeElement === el)).toBe(true);
    await expect(page.locator('[data-id="login"] .title')).toHaveText("Sign in step");
    await expect(page.locator("#pTitle")).toHaveValue("Sign in step");

    await page.keyboard.press("Backspace");
    await expect(page.locator(".quick-title-input")).toHaveValue("Sign in ste");
    await expect(page.locator('[data-id="login"] .title')).toHaveText("Sign in ste");
    await page.keyboard.type("p");
    await expect(page.locator("#pTitle")).toHaveValue("Sign in step");

    await page.keyboard.press("Delete");
    await expect(page.locator('[data-id="login"]')).toHaveCount(0);
    await expect(page.locator(".quick-title-input")).toHaveCount(0);
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.some(state => state.id === "login");
    }).toBe(false);

    await openTool(page);

    const loginEdgeId = await savedModel(page).then(model =>
      model.transitions.find(t => t.from === "auth_start" && t.to === "login").id
    );
    await page.evaluate(id => {
      selectEdge(id, 0, 0, { edit: false });
    }, loginEdgeId);
    await expect(page.locator("#pLabel")).toBeVisible();
    await expect.poll(() => page.locator("#pLabel").evaluate(el => document.activeElement === el)).toBe(false);
    await expect.poll(() => page.locator("#map").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.type("Open login");
    await expect(page.locator(".quick-title-input.edge-title-input")).toHaveValue("Open login");
    await expect.poll(() => page.locator(".quick-title-input").evaluate(el => document.activeElement === el)).toBe(true);
    await expect(page.locator("#pLabel")).toHaveValue("Open login");
    await expect(page.locator(`svg text.edge-label[data-edge-id="${loginEdgeId}"]`)).toHaveText("Open login");
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.transitions.find(transition => transition.id === loginEdgeId)?.label;
    }).toBe("Open login");

    await page.keyboard.press("Backspace");
    await expect(page.locator(".quick-title-input.edge-title-input")).toHaveValue("Open logi");
    await expect(page.locator("#pLabel")).toHaveValue("Open logi");
    await page.keyboard.type("n");
    await expect(page.locator("#pLabel")).toHaveValue("Open login");
    await page.keyboard.press("Enter");
    await expect(page.locator(".quick-title-input")).toHaveCount(0);
    await expect.poll(() => page.locator("#map").evaluate(el => document.activeElement === el)).toBe(true);
    await expect(page.locator(`.edge[data-edge-id="${loginEdgeId}"]`)).toHaveCount(1);
  });

  test("quick title editing keeps a collapsed inspector collapsed", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"] .node-edit').click();
    await expect(page.locator("#pTitle")).toBeVisible();
    await page.locator("#btnToggleInspector").click();
    await expect(page.locator(".workspace")).toHaveClass(/inspector-collapsed/);

    await page.locator('[data-id="register"]').click();
    await expect(page.locator("#pTitle")).toBeHidden();
    await page.keyboard.type("Join");

    await expect(page.locator(".workspace")).toHaveClass(/inspector-collapsed/);
    await expect(page.locator("#pTitle")).toBeHidden();
    await expect(page.locator(".quick-title-input")).toHaveValue("Join");
    await expect.poll(() => page.locator(".quick-title-input").evaluate(el => document.activeElement === el)).toBe(true);
    await expect(page.locator('[data-id="register"] .title')).toHaveText("Join");
  });

  test("double-click state creation keeps a collapsed inspector collapsed", async ({ page }) => {
    await openTool(page);
    await expect(page.locator(".workspace")).toHaveClass(/inspector-collapsed/);

    const target = await emptyCanvasPoint(page);
    await page.mouse.dblclick(target.x, target.y);

    await expect(canvasStateNodes(page)).toHaveCount(7);
    await expect(boundaryProxyNodes(page)).toHaveCount(2);
    await expect(page.locator(".workspace")).toHaveClass(/inspector-collapsed/);
    await expect(page.locator("#stateInspector")).toHaveClass(/inspector-pulse/);
    await expect(page.locator("#pTitle")).toBeHidden();
    await expect.poll(() => page.locator("#pTitle").evaluate(el => ({
      focused: document.activeElement === el,
      value: el.value,
    }))).toMatchObject({
      focused: false,
      value: expect.stringMatching(/^State \d+$/)
    });

    await page.keyboard.type("Arbeitsflaeche step");
    const model = await savedModel(page);
    const created = model.states.find(state => state.title === "Arbeitsflaeche step");
    expect(created).toBeTruthy();
    await expect(page.locator(`[data-id="${created.id}"] .title`)).toHaveText("Arbeitsflaeche step");
    await expect(page.locator("#pTitle")).toHaveValue("Arbeitsflaeche step");
    await expect(page.locator(".quick-title-input")).toHaveValue("Arbeitsflaeche step");
    await expect.poll(() => page.locator(".quick-title-input").evaluate(el => document.activeElement === el)).toBe(true);
    await expect(page.locator(".workspace")).toHaveClass(/inspector-collapsed/);
  });

  test("creates a clean self-loop by dragging a state's output back to its own input", async ({ page }) => {
    await openTool(page);
    await page.locator("#btnNew").click();
    await page.getByRole("button", { name: "Neu starten" }).click();

    const output = await centerOf(statePort(page, "start", "out"));
    const input = await centerOf(statePort(page, "start", "in"));

    await page.mouse.move(output.x, output.y);
    await page.mouse.down();
    await page.mouse.move(output.x + 90, output.y - 120, { steps: 6 });
    await page.mouse.move(input.x, input.y, { steps: 10 });
    await page.mouse.up();

    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(1);
    await expect(page.locator(".node.boundary-proxy")).toHaveCount(2);
    const model = await savedModel(page);
    const transitions = userTransitions(model);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({ from: "start", to: "start" });

    const edge = page.locator(`.edge[data-edge-id="${transitions[0].id}"]`);
    await expect(edge).toBeVisible();
    const labelY = Number(await page.locator(`.edge-label[data-edge-id="${transitions[0].id}"]`).getAttribute("y"));
    const path = await edge.getAttribute("d");
    const numbers = path.match(/-?\d+(?:\.\d+)?/g).map(Number);
    const yValues = numbers.filter((_, index) => index % 2 === 1);
    expect(Math.min(...yValues)).toBeLessThan(model.states[0].y);
    expect(labelY).toBeLessThan(model.states[0].y);

    await page.keyboard.press("Escape");
    await page.locator('[data-id="start"]').click();
    await expect(transitions[0].label).toBe("To Start");
    await appFrame(page).getByRole("button", { name: "To Start" }).click();
    await expect(appFrame(page).locator("#statePill")).toHaveText("start");
  });

  test("prevents duplicate transition creation but preserves explicit rewire identity", async ({ page }) => {
    await openTool(page);
    const before = await savedModel(page);
    expect(before.transitions.filter(t => t.from === "auth_start" && t.to === "login")).toHaveLength(1);

    await dragTransition(
      page,
      statePort(page, "auth_start", "out"),
      statePort(page, "login", "in")
    );

    await expect(page.locator('.edge[data-edge-id]:not([data-edge-id^="boundary-flow:"])')).toHaveCount(userTransitions(before).length);
    await expect.poll(async () => {
      const model = await savedModel(page);
      const transitions = userTransitions(model);
      return {
        total: transitions.length,
        authToLogin: transitions.filter(t => t.from === "auth_start" && t.to === "login").length
      };
    }).toEqual({ total: userTransitions(before).length, authToLogin: 1 });

    await page.keyboard.press("Escape");
    const loginEdgeId = before.transitions.find(t => t.from === "auth_start" && t.to === "login").id;
    const registerEdgeId = before.transitions.find(t => t.from === "auth_start" && t.to === "register").id;
    const arrowTip = page.locator(`circle.edge-tip-hit[data-edge-id="${loginEdgeId}"]`);
    const start = await centerOf(arrowTip);
    const duplicateTarget = await centerOf(statePort(page, "register", "in"));
    await page.keyboard.down("Alt");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(duplicateTarget.x, duplicateTarget.y, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect.poll(async () => {
      const model = await savedModel(page);
      const transitions = userTransitions(model);
      return {
        total: transitions.length,
        loginTarget: transitions.find(t => t.id === loginEdgeId)?.to,
        authToRegister: transitions
          .filter(t => t.from === "auth_start" && t.to === "register")
          .map(t => t.id)
          .sort()
      };
    }).toEqual({
      total: userTransitions(before).length,
      loginTarget: "register",
      authToRegister: [loginEdgeId, registerEdgeId].sort()
    });

    await page.locator("#btnNew").click();
    await page.getByRole("button", { name: "Neu starten" }).click();
    const output = statePort(page, "start", "out");
    const input = statePort(page, "start", "in");
    const outputCenter = await centerOf(output);

    await dragTransition(page, output, input, { x: outputCenter.x + 90, y: outputCenter.y - 120 });
    await page.keyboard.press("Escape");
    await dragTransition(page, output, input, { x: outputCenter.x + 90, y: outputCenter.y - 120 });

    await expect(page.locator('.edge[data-edge-id]:not([data-edge-id^="boundary-flow:"])')).toHaveCount(1);
    await expect.poll(async () => {
      const model = await savedModel(page);
      const transitions = userTransitions(model);
      return {
        total: transitions.length,
        selfLoops: transitions.filter(t => t.from === "start" && t.to === "start").length
      };
    }).toEqual({ total: 1, selfLoops: 1 });
  });

  test("cancels self-loop drag when released on the source body instead of input", async ({ page }) => {
    await openTool(page);
    await page.locator("#btnNew").click();
    await page.getByRole("button", { name: "Neu starten" }).click();

    const output = await centerOf(statePort(page, "start", "out"));
    const nodeBox = await visibleBox(page.locator('[data-id="start"]'));
    const body = { x: nodeBox.x + nodeBox.width - 8, y: nodeBox.y + nodeBox.height / 2 };

    await page.mouse.move(output.x, output.y);
    await page.mouse.down();
    await page.mouse.move(body.x, body.y, { steps: 10 });
    await page.mouse.up();

    const model = await savedModel(page);
    expect(model.states).toHaveLength(1);
    expect(userTransitions(model)).toHaveLength(0);
    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(1);
    await expect(page.locator(".node.boundary-proxy")).toHaveCount(2);
    await expect(page.locator('.edge[data-edge-id]:not([data-edge-id^="boundary-flow:"])')).toHaveCount(0);
    await expect(page.locator('.edge[data-edge-id^="boundary-flow:"]')).toHaveCount(2);
  });

  test("reroutes an existing transition from the arrowhead with Alt-drag", async ({ page }) => {
    await openTool(page);
    const loginEdgeId = await page.evaluate(key => {
      const stored = JSON.parse(localStorage.getItem(`${key}.editor`) || localStorage.getItem(key) || "null");
      const model = stored?.model || stored;
      return model.transitions.find(t => t.from === "auth_start" && t.label === "Login").id;
    }, STORAGE_KEY);
    const arrowTip = page.locator(`circle.edge-tip-hit[data-edge-id="${loginEdgeId}"]`);
    await expect(arrowTip).toBeVisible();
    const start = await centerOf(arrowTip);
    const end = await centerOf(statePort(page, "error", "in"));

    await page.keyboard.down("Alt");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up("Alt");

    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.transitions.find(t => t.from === "auth_start" && t.label === "Login")?.to;
    }).toBe("error");
  });

  test("reroutes demo logout onto an existing home edge without losing its event @smoke", async ({ page }) => {
    await openTool(page);
    await page.locator("#topbarMore summary").click();
    await page.getByRole("button", { name: "Zustand Demo" }).click();
    await page.getByRole("button", { name: "Demo laden" }).click();

    const logoutEdgeId = "site_profile_logout";
    const arrowTip = page.locator(`circle.edge-tip-hit[data-edge-id="${logoutEdgeId}"]`);
    await expect(arrowTip).toBeVisible();
    const start = await centerOf(arrowTip);
    const homeInput = await centerOf(statePort(page, "site_home", "in"));

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(homeInput.x, homeInput.y, { steps: 14 });
    await page.mouse.up();

    await expect.poll(async () => {
      const model = await savedModel(page);
      const logout = model.transitions.find(transition => transition.id === logoutEdgeId);
      return {
        logoutTo: logout?.to || "",
        logoutSet: logout?.set || {},
        profileHomeEdges: model.transitions
          .filter(transition => transition.from === "site_profile" && transition.to === "site_home")
          .map(transition => transition.id)
          .sort()
      };
    }).toEqual({
      logoutTo: "site_home",
      logoutSet: {
        "states.site_profile.account.loggedIn": false,
        "states.site_profile.logout.clicked": true
      },
      profileHomeEdges: ["site_profile_logout", "site_profile_nav_home"]
    });

    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("site_home");
    await app.locator(".navbar").getByRole("button", { name: "Konto", exact: true }).click();
    await expect(app.locator("#statePill")).toHaveText("site_login");
    await app.locator('input[type="email"]').fill("mira@example.test");
    await app.locator('input[type="password"]').fill("demo-password");
    await app.getByRole("button", { name: "Anmelden", exact: true }).click();
    await expect(app.locator("#statePill")).toHaveText("site_profile");

    await expect(app.getByRole("button", { name: "Abmelden", exact: true })).toHaveCount(1);
    await app.getByRole("button", { name: "Abmelden", exact: true }).click();
    await expect(app.locator("#statePill")).toHaveText("site_home");
    await expect.poll(async () => (await runtimeContext(page)).states?.site_profile?.account?.loggedIn).toBe(false);
    await expect.poll(async () => (await runtimeContext(page)).states?.site_profile?.logout?.clicked).toBe(true);
  });

  test("reroutes an existing transition into a self-loop from the arrowhead", async ({ page }) => {
    await openTool(page);
    const loginEdgeId = await page.evaluate(key => {
      const stored = JSON.parse(localStorage.getItem(`${key}.editor`) || localStorage.getItem(key) || "null");
      const model = stored?.model || stored;
      return model.transitions.find(t => t.from === "auth_start" && t.label === "Login").id;
    }, STORAGE_KEY);
    const arrowTip = page.locator(`circle.edge-tip-hit[data-edge-id="${loginEdgeId}"]`);
    const start = await centerOf(arrowTip);
    const ownInput = await centerOf(statePort(page, "auth_start", "in"));

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 80, start.y - 120, { steps: 6 });
    await page.mouse.move(ownInput.x, ownInput.y, { steps: 10 });
    await page.mouse.up();

    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.transitions.find(t => t.id === loginEdgeId)?.to;
    }).toBe("auth_start");

    const edge = page.locator(`.edge[data-edge-id="${loginEdgeId}"]`);
    const path = await edge.getAttribute("d");
    const yValues = path.match(/-?\d+(?:\.\d+)?/g).map(Number).filter((_, index) => index % 2 === 1);
    const model = await savedModel(page);
    const authStart = model.states.find(state => state.id === "auth_start");
    expect(Math.min(...yValues)).toBeLessThan(authStart.y);
  });

  test("clears properties inspector on empty canvas clicks", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"]').click();
    await expect(page.locator("#pTitle")).toBeVisible();
    let point = await emptyCanvasPoint(page);
    await page.mouse.click(point.x, point.y);
    await expect(page.locator("#pTitle")).toHaveCount(0);
    await expect(page.locator("#stateInspectorBody")).toContainText("Kein Zustand ausgewaehlt");

    const label = page.locator("svg text.edge-label").filter({ hasText: "Login" });
    await expect(label).toHaveCount(1);
    await label.click();
    await expect(page.locator("#pLabel")).toBeVisible();
    point = await emptyCanvasPoint(page);
    await page.mouse.click(point.x, point.y);
    await expect(page.locator("#pLabel")).toHaveCount(0);
    await expect(page.locator("#stateInspectorBody")).toContainText("Kein Zustand ausgewaehlt");
  });

  test("keeps focused state inspector stable with Escape", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"] .node-edit').click();
    await expect(page.locator("#pTitle")).toBeVisible();
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Escape");
    await expect(page.locator("#pTitle")).toBeVisible();
  });

  test("toggles the state explorer with Ctrl+Space without breaking focused editing", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"] .node-edit').click();
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);

    await page.keyboard.press("Control+Space");
    await expect(page.locator("#stateExplorer")).toHaveClass(/collapsed/);
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);
    await expect(page.locator("#pTitle")).toHaveValue("Login");

    await page.keyboard.press("Control+Space");
    await expect(page.locator("#stateExplorer")).not.toHaveClass(/collapsed/);
    await expect.poll(() => page.locator("#pTitle").evaluate(el => document.activeElement === el)).toBe(true);
  });

  test("prevents browser text selection inside the canvas on double tap @smoke", async ({ page }) => {
    await openTool(page);

    const selectionResult = await page.evaluate(() => {
      const title = document.querySelector('[data-id="login"] .title');
      const range = document.createRange();
      range.selectNodeContents(title);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const event = new Event("selectstart", { bubbles: true, cancelable: true });
      title.dispatchEvent(event);
      return {
        prevented: event.defaultPrevented,
        text: selection.toString()
      };
    });
    expect(selectionResult).toEqual({ prevented: true, text: "" });

    const nodeBox = await visibleBox(page.locator('[data-id="register"]'));
    await page.mouse.dblclick(nodeBox.x + nodeBox.width / 2, nodeBox.y + 20);
    await expect.poll(async () => page.evaluate(() => window.getSelection()?.toString() || "")).toBe("");
    if (await page.locator("#layerBack").isVisible()) {
      await page.locator("#layerBack").click();
      await expect(page.locator('[data-id="login"]')).toBeVisible();
    }

    const touchSelectionResult = await page.evaluate(async () => {
      const title = document.querySelector('[data-id="login"] .title');
      const box = title.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const fireTouch = (type, pointerId) => {
        title.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerType: "touch",
          pointerId,
          isPrimary: true,
          clientX: x,
          clientY: y,
          buttons: type === "pointerup" ? 0 : 1
        }));
      };

      fireTouch("pointerdown", 641);
      fireTouch("pointerup", 641);
      fireTouch("pointerdown", 642);
      fireTouch("pointerup", 642);

      const range = document.createRange();
      range.selectNodeContents(title);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise(resolve => requestAnimationFrame(resolve));

      return {
        text: selection.toString()
      };
    });
    expect(touchSelectionResult).toEqual({
      text: ""
    });
  });

  test("prevents browser text selection inside the generated app preview @smoke", async ({ page }) => {
    await openTool(page);

    const runtimeSelection = await appFrame(page).locator("h1").evaluate(title => {
      const range = document.createRange();
      range.selectNodeContents(title);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const selectEvent = new Event("selectstart", { bubbles: true, cancelable: true });
      title.dispatchEvent(selectEvent);
      const menuEvent = new Event("contextmenu", { bubbles: true, cancelable: true });
      title.dispatchEvent(menuEvent);
      return {
        selectPrevented: selectEvent.defaultPrevented,
        menuPrevented: menuEvent.defaultPrevented,
        text: selection.toString(),
        userSelect: getComputedStyle(document.body).userSelect,
        hasTouchCalloutRegel: [...document.querySelectorAll("style")]
          .some(style => style.textContent.includes("-webkit-touch-callout: none"))
      };
    });

    expect(runtimeSelection).toEqual({
      selectPrevented: true,
      menuPrevented: true,
      text: "",
      userSelect: "none",
      hasTouchCalloutRegel: true
    });

    const passiveTouchFeedback = await appFrame(page).locator("body").evaluate(async body => {
      const passive = document.createElement("div");
      passive.className = "card daisy-widget alert";
      passive.textContent = "Passive surface";
      body.appendChild(passive);
      passive.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerType: "touch",
        pointerId: 250,
        clientX: 24,
        clientY: 24
      }));
      await new Promise(resolve => requestAnimationFrame(resolve));
      const result = {
        passivePressed: passive.classList.contains("runtime-touch-pressed"),
        pressedCount: document.querySelectorAll(".runtime-touch-pressed").length
      };
      passive.remove();
      return result;
    });
    expect(passiveTouchFeedback).toEqual({
      passivePressed: false,
      pressedCount: 0
    });

    const loginButton = appFrame(page).getByRole("button", { name: "Login" });
    await loginButton.dispatchEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerType: "touch",
      pointerId: 251,
      clientX: 32,
      clientY: 32
    });
    await expect(loginButton).toHaveClass(/runtime-touch-pressed/);
    await appFrame(page).locator("body").dispatchEvent("pointerup", {
      bubbles: true,
      cancelable: true,
      pointerType: "touch",
      pointerId: 251,
      clientX: 32,
      clientY: 32
    });
    await expect(loginButton).not.toHaveClass(/runtime-touch-pressed/);
  });

  test("clears state inspector on empty-canvas single tap", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://localhost:8124",
      viewport: { width: 390, height: 820 },
      hasTouch: true,
      isMobile: true
    });
    const page = await context.newPage();
    await openTool(page);

    await page.locator('[data-id="login"] .node-edit').tap();
    await expect(page.locator("#pTitle")).toBeVisible();
    await page.locator('[data-mobile-view="canvas"]').tap();
    const point = await emptyCanvasPoint(page);
    await page.touchscreen.tap(point.x, point.y);
    await expect(page.locator("#pTitle")).toHaveCount(0);
    await expect(page.locator("#stateInspectorBody")).toContainText("Kein Zustand ausgewaehlt");
    await context.close();
  });

  test("opens nested state canvases with a forgiving touch double tap @smoke", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://localhost:8124",
      viewport: { width: 900, height: 820 },
      hasTouch: true
    });
    const page = await context.newPage();
    await openTool(page);

    const login = page.locator('[data-id="login"]');
    const box = await visibleBox(login);
    const first = { x: box.x + box.width / 2 - 18, y: box.y + box.height / 2 - 8 };
    const second = { x: first.x + 34, y: first.y + 22 };
    const touchTapNode = async (point, pointerId) => {
      await login.dispatchEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerType: "touch",
        pointerId,
        clientX: point.x,
        clientY: point.y
      });
      await page.locator("#map").dispatchEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerType: "touch",
        pointerId,
        clientX: point.x,
        clientY: point.y
      });
    };
    await expect(page.locator("#layerFrameLabel")).toHaveText("Wurzel");
    await touchTapNode(first, 201);
    await touchTapNode(second, 202);

    await expect(page.locator("#layerFrameLabel")).toHaveText("In Login");
    await expect(page.locator("#layerBack")).toBeVisible();
    await context.close();
  });

  test("requires a short touch hold before dragging canvas states on tablet @smoke", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://localhost:8124",
      viewport: { width: 900, height: 820 },
      hasTouch: true
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__STATE_BLUEPRINT_VIBRATIONS = [];
      Object.defineProperty(navigator, "vibrate", {
        configurable: true,
        value(pattern) {
          window.__STATE_BLUEPRINT_VIBRATIONS.push(pattern);
          return true;
        }
      });
    });
    await openTool(page);

    const node = page.locator('[data-id="login"]');
    const box = await visibleBox(node);
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const move = async (point, pointerId) => page.evaluate(({ point, pointerId }) => {
      window.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        pointerType: "touch",
        pointerId,
        clientX: point.x,
        clientY: point.y
      }));
    }, { point, pointerId });
    const up = async (point, pointerId) => page.evaluate(({ point, pointerId }) => {
      window.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerType: "touch",
        pointerId,
        clientX: point.x,
        clientY: point.y
      }));
    }, { point, pointerId });

    const before = await savedModel(page);
    const beforeLogin = before.states.find(state => state.id === "login");

    await node.dispatchEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerType: "touch",
      pointerId: 301,
      clientX: start.x,
      clientY: start.y
    });
    await expect(node).toHaveClass(/touch-pressed/);
    await move({ x: start.x + 56, y: start.y + 12 }, 301);
    await up({ x: start.x + 56, y: start.y + 12 }, 301);

    await expect.poll(async () => {
      const model = await savedModel(page);
      const login = model.states.find(state => state.id === "login");
      return { x: login.x, y: login.y };
    }).toEqual({ x: beforeLogin.x, y: beforeLogin.y });

    const secondBox = await visibleBox(node);
    const secondStart = { x: secondBox.x + secondBox.width / 2, y: secondBox.y + secondBox.height / 2 };
    await node.dispatchEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerType: "touch",
      pointerId: 302,
      clientX: secondStart.x,
      clientY: secondStart.y
    });
    await expect(node).toHaveClass(/touch-pressed/);
    await expect(node).toHaveClass(/touch-drag-ready/, { timeout: 800 });
    await expect.poll(() => page.evaluate(() => window.__STATE_BLUEPRINT_VIBRATIONS || [])).toEqual([12]);
    await move({ x: secondStart.x + 96, y: secondStart.y + 24 }, 302);
    await up({ x: secondStart.x + 96, y: secondStart.y + 24 }, 302);

    await expect.poll(async () => {
      const model = await savedModel(page);
      const login = model.states.find(state => state.id === "login");
      return login.x !== beforeLogin.x || login.y !== beforeLogin.y;
    }).toBe(true);
    await expect(node).not.toHaveClass(/touch-pressed|touch-drag-ready/);
    await context.close();
  });

  test("starts transition drags from near output ports on tablet without panning @smoke", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://localhost:8124",
      viewport: { width: 900, height: 820 },
      hasTouch: true
    });
    const page = await context.newPage();
    await openTool(page);

    const output = await centerOf(statePort(page, "auth_start", "out"));
    const dropTarget = await centerOf(page.locator('[data-id="error"]'));
    const start = { x: output.x + 30, y: output.y + 25 };
    const beforeCamera = await worldTransform(page);
    const beforeModel = await savedModel(page);
    const beforeCount = beforeModel.transitions.length;

    await page.locator("#map").dispatchEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerType: "touch",
      pointerId: 421,
      clientX: start.x,
      clientY: start.y
    });
    await expect(page.locator("#map")).toHaveClass(/connecting/);

    await page.evaluate(({ point }) => {
      window.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        pointerType: "touch",
        pointerId: 421,
        clientX: point.x,
        clientY: point.y
      }));
    }, { point: { x: (start.x + dropTarget.x) / 2, y: (start.y + dropTarget.y) / 2 } });

    await page.evaluate(({ point }) => {
      window.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerType: "touch",
        pointerId: 421,
        clientX: point.x,
        clientY: point.y
      }));
    }, { point: dropTarget });

    await expect(page.locator("#map")).not.toHaveClass(/connecting/);
    await expect.poll(() => worldTransform(page)).toBe(beforeCamera);
    await expect.poll(async () => {
      const model = await savedModel(page);
      return {
        count: model.transitions.length,
        linked: model.transitions.some(transition => transition.from === "auth_start" && transition.to === "error")
      };
    }).toEqual({ count: beforeCount + 1, linked: true });

    await context.close();
  });

  test("creates a state on empty-canvas touch double tap without changing single tap behavior @smoke", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://localhost:8124",
      viewport: { width: 900, height: 820 },
      hasTouch: true
    });
    const page = await context.newPage();
    await openTool(page);

    const before = await page.locator(".node:not(.boundary-proxy)").count();
    const beforeModel = await savedModel(page);
    const point = await emptyCanvasPoint(page);
    const touchTapMap = async (tapPoint, pointerId) => {
      await page.locator("#map").dispatchEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerType: "touch",
        pointerId,
        clientX: tapPoint.x,
        clientY: tapPoint.y
      });
      await page.locator("#map").dispatchEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerType: "touch",
        pointerId,
        clientX: tapPoint.x,
        clientY: tapPoint.y
      });
    };
    await touchTapMap(point, 211);
    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(before);
    await page.waitForTimeout(80);
    await touchTapMap({ x: point.x + 30, y: point.y + 20 }, 212);

    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(before + 1);
    const model = await savedModel(page);
    expect(model.states).toHaveLength(beforeModel.states.length + 1);
    expect(userTransitions(model)).toHaveLength(userTransitions(beforeModel).length);
    await context.close();
  });

  test("switches mobile workspace between canvas, presets, edit, and app with bottom tabs", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://localhost:8124",
      viewport: { width: 390, height: 820 },
      hasTouch: true,
      isMobile: true
    });
    const page = await context.newPage();
    await openTool(page);
    const expectElementAboveMobileTabs = async selector => {
      await expect.poll(async () => page.evaluate(sel => {
        const element = document.querySelector(sel);
        const tabs = document.querySelector("#mobileTabs");
        if (!element || !tabs) return false;
        const rect = element.getBoundingClientRect();
        const tabsRect = tabs.getBoundingClientRect();
        const style = getComputedStyle(element);
        return style.display !== "none" &&
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom <= tabsRect.top + 1;
      }, selector)).toBe(true);
    };

    await expect(page.locator("#mobileTabs")).toBeVisible();
    await expect.poll(() => page.locator("#mobileTabs").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length)).toBe(4);
    await expect(page.locator("#map")).toBeVisible();
    await expectElementAboveMobileTabs("#map");
    await expect(page.locator("#stateExplorer")).toBeHidden();
    await expect(page.locator("#stateInspector")).toBeHidden();
    await expect(page.locator(".preview")).toBeVisible();
    await expectElementAboveMobileTabs(".preview");
    await expectElementAboveMobileTabs("#appFrame");
    await expect.poll(() => page.evaluate(() => {
      const map = document.querySelector("#map")?.getBoundingClientRect();
      const preview = document.querySelector(".preview")?.getBoundingClientRect();
      if (!map || !preview) return false;
      return map.bottom <= preview.top + 1 && map.height > preview.height;
    })).toBe(true);
    await expect(page.locator("#previewResizeHandle")).toBeVisible();
    const beforeResizeModel = await savedModel(page);
    const beforeSplit = await page.evaluate(() => {
      const map = document.querySelector("#map")?.getBoundingClientRect();
      const preview = document.querySelector(".preview")?.getBoundingClientRect();
      const handle = document.querySelector("#previewResizeHandle")?.getBoundingClientRect();
      return {
        mapHeight: Math.round(map?.height || 0),
        previewHeight: Math.round(preview?.height || 0),
        handleX: Math.round((handle?.left || 0) + (handle?.width || 0) / 2),
        handleY: Math.round((handle?.top || 0) + (handle?.height || 0) / 2)
      };
    });
    await page.mouse.move(beforeSplit.handleX, beforeSplit.handleY);
    await page.mouse.down();
    await page.mouse.move(beforeSplit.handleX, beforeSplit.handleY - 82, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => {
      const map = document.querySelector("#map")?.getBoundingClientRect();
      const preview = document.querySelector(".preview")?.getBoundingClientRect();
      const workspace = document.querySelector("#workspace");
      const tabs = document.querySelector("#mobileTabs")?.getBoundingClientRect();
      return {
        mapHeight: Math.round(map?.height || 0),
        previewHeight: Math.round(preview?.height || 0),
        previewInside: Boolean(preview && tabs && preview.bottom <= tabs.top + 1),
        savedPreview: JSON.parse(localStorage.getItem("stateBlueprintHotLinked.model.v2.ui") || "{}").previewWidth,
        cssPreviewHeight: workspace ? parseFloat(getComputedStyle(workspace).getPropertyValue("--mobile-preview-panel-height")) : 0
      };
    })).toMatchObject({
      mapHeight: expect.any(Number),
      previewHeight: expect.any(Number),
      previewInside: true,
      savedPreview: expect.any(Number),
      cssPreviewHeight: expect.any(Number)
    });
    const afterSplit = await page.evaluate(() => {
      const map = document.querySelector("#map")?.getBoundingClientRect();
      const previewEl = document.querySelector(".preview");
      const preview = previewEl?.getBoundingClientRect();
      const workspace = document.querySelector("#workspace");
      return {
        mapHeight: Math.round(map?.height || 0),
        previewHeight: Math.round(preview?.height || 0),
        cssPreviewHeight: workspace ? Math.round(parseFloat(getComputedStyle(workspace).getPropertyValue("--mobile-preview-panel-height"))) : 0
      };
    });
    expect(afterSplit.previewHeight).toBeGreaterThan(beforeSplit.previewHeight + 40);
    expect(afterSplit.mapHeight).toBeLessThan(beforeSplit.mapHeight - 40);
    expect(afterSplit.cssPreviewHeight).toBeGreaterThan(beforeSplit.previewHeight + 40);
    expect(await savedModel(page)).toEqual(beforeResizeModel);
    await expect(page.locator("#stateInspectorBody")).not.toContainText("Click a state");
    await expect(page.locator("#stateInspectorBody")).not.toContainText("Drag a state");
    await page.evaluate(() => {
      selected = selectionFromParts(["auth_start"], []);
      draw();
    });
    await expect(page.locator("#selectionActions")).toBeVisible();
    await page.evaluate(() => {
      document.getElementById("stateExplorer")?.classList.add("collapsed");
    });

    await page.locator('[data-mobile-view="presets"]').tap();
    await expect(page.locator("#map")).toBeVisible();
    await expectElementAboveMobileTabs("#map");
    await expect(page.locator("#mapScene")).toBeHidden();
    await expect(page.locator("#stateExplorer")).toBeVisible();
    await expect.poll(() => page.locator("#stateExplorer").evaluate(explorer => {
      const list = explorer.querySelector("#stateExplorerList");
      return {
        explorerWidth: Math.round(explorer.getBoundingClientRect().width),
        listDisplay: getComputedStyle(list).display,
        visibleCards: [...explorer.querySelectorAll(".component-preset-card, .state-template-card")]
          .filter(card => card.getBoundingClientRect().width > 40 && card.getBoundingClientRect().height > 40).length
      };
    })).toMatchObject({
      explorerWidth: expect.any(Number),
      listDisplay: "flex",
      visibleCards: expect.any(Number)
    });
    await expect.poll(() => page.locator("#stateExplorer").evaluate(explorer =>
      Math.round(explorer.getBoundingClientRect().width)
    )).toBeGreaterThan(300);
    await expect.poll(() => page.locator("#stateExplorer").evaluate(explorer =>
      [...explorer.querySelectorAll(".component-preset-card, .state-template-card")]
        .filter(card => card.getBoundingClientRect().width > 40 && card.getBoundingClientRect().height > 40).length
    )).toBeGreaterThan(3);
    await expectElementAboveMobileTabs("#stateExplorer");
    await expect(page.locator("#selectionActions")).toBeHidden();
    await expect(page.locator("#canvasHistoryActions")).toBeHidden();
    await expect(page.locator("#stateInspector")).toBeHidden();
    await expect(page.locator(".preview")).toBeHidden();
    await expect(page.locator('[data-mobile-view="presets"]')).toHaveClass(/active/);
    const presetList = page.locator("#stateExplorerList");
    await expect(presetList).toHaveCSS("overflow-y", "auto");
    const mobileSearch = page.locator("#stateExplorerSearch");
    await expect(mobileSearch).toBeVisible();
    await expect.poll(() => page.locator("#stateExplorer").evaluate(explorer => {
      const list = explorer.querySelector("#stateExplorerList");
      const search = explorer.querySelector("#stateExplorerSearch");
      const explorerRect = explorer.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      const searchRect = search.getBoundingClientRect();
      return {
        listOverflowX: getComputedStyle(list).overflowX,
        searchInside: searchRect.left >= explorerRect.left - 1 && searchRect.right <= explorerRect.right + 1,
        listInside: listRect.left >= explorerRect.left - 1 && listRect.right <= explorerRect.right + 1,
        hasHorizontalOverflow: explorer.scrollWidth > explorer.clientWidth + 2 || list.scrollWidth > list.clientWidth + 2
      };
    })).toEqual({
      listOverflowX: "hidden",
      searchInside: true,
      listInside: true,
      hasHorizontalOverflow: false
    });
    await mobileSearch.fill("avatar");
    await expect(componentPreset(page, "Benutzer-Avatar")).toBeVisible();
    await expect(componentPreset(page, "Textblock")).toHaveCount(0);
    await mobileSearch.press("Escape");
    await expect(componentPreset(page, "Textblock")).toHaveCSS("touch-action", "pan-y");
    await expect.poll(() => presetList.evaluate(el => ({
      canScroll: el.scrollHeight > el.clientHeight,
      scrolled: (el.scrollTop = 160, el.scrollTop > 0)
    }))).toEqual({ canScroll: true, scrolled: true });

    await componentPreset(page, "Textblock").locator(".template-title").tap();
    await expect(page.locator('[data-mobile-view="app"]')).toHaveClass(/active/);
    await expect(appFrame(page).locator("#screen")).toContainText("Textblock");

    await page.locator('[data-mobile-view="edit"]').tap();
    await expect(page.locator("#stateInspector")).toBeVisible();
    await expectElementAboveMobileTabs("#stateInspector");
    await expect(page.locator("#selectionActions")).toBeHidden();
    await expect(page.locator("#map")).toBeHidden();
    await expect(page.locator(".preview")).toBeHidden();
    await expect(page.locator('[data-mobile-view="edit"]')).toHaveClass(/active/);

    await page.locator('[data-mobile-view="app"]').tap();
    await expect(page.locator(".preview")).toBeVisible();
    await expectElementAboveMobileTabs(".preview");
    await expectElementAboveMobileTabs("#appFrame");
    await expect(page.locator("#selectionActions")).toBeHidden();
    await expect(page.locator("#stateInspector")).toBeHidden();
    await expect(page.locator("#map")).toBeHidden();
    await expect(page.locator('[data-mobile-view="app"]')).toHaveClass(/active/);

    await page.locator('[data-mobile-view="canvas"]').tap();
    await page.locator('[data-id="login"] .node-edit').tap();
    await expect(page.locator("#stateInspector")).toBeVisible();
    await expect(page.locator("#pTitle")).toBeVisible();
    await expect(page.locator('[data-mobile-view="edit"]')).toHaveClass(/active/);
    await page.evaluate(() => {
      const topbar = document.querySelector(".topbar");
      topbar.scrollLeft = topbar.scrollWidth;
      document.getElementById("topbarMore").open = true;
    });
    await assertVisibleInViewport(page, ".topbar-menu-panel");
    await expect.poll(() => page.evaluate(() => {
      const panel = document.querySelector(".topbar-menu-panel");
      const topbar = document.querySelector(".topbar");
      const workspace = document.querySelector(".workspace");
      if (!panel || !topbar || !workspace) return { hitMenu: false, topbarAboveWorkspace: false };
      const rect = panel.getBoundingClientRect();
      const x = Math.min(Math.max(rect.left + 20, 1), window.innerWidth - 2);
      const y = Math.min(Math.max(rect.top + 20, 1), window.innerHeight - 2);
      const hit = document.elementFromPoint(x, y);
      const topbarZ = Number.parseInt(getComputedStyle(topbar).zIndex, 10) || 0;
      const workspaceZ = Number.parseInt(getComputedStyle(workspace).zIndex, 10) || 0;
      return {
        hitMenu: Boolean(hit && panel.contains(hit)),
        topbarAboveWorkspace: topbarZ > workspaceZ
      };
    })).toEqual({ hitMenu: true, topbarAboveWorkspace: true });
    await page.locator('[data-topbar-proxy="btnRun"]').tap();
    await expect.poll(() => page.evaluate(() => document.getElementById("topbarMore").open)).toBe(false);
    await page.locator("#topbarMore summary").tap();
    await page.locator("#btnResetView").tap();
    await expect.poll(() => page.evaluate(() => document.getElementById("topbarMore").open)).toBe(false);

    await context.close();

    const landscapeContext = await browser.newContext({
      baseURL: "http://localhost:8124",
      viewport: { width: 844, height: 390 },
      hasTouch: true,
      isMobile: true
    });
    const landscapePage = await landscapeContext.newPage();
    await openTool(landscapePage);
    await expect(landscapePage.locator("#mobileTabs")).toBeVisible();
    await expect.poll(() => landscapePage.locator("#mobileTabs").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length)).toBe(4);
    await expect(landscapePage.locator("#map")).toBeVisible();
    await expect(landscapePage.locator(".preview")).toBeVisible();
    await expect.poll(() => landscapePage.evaluate(() => {
      const map = document.querySelector("#map")?.getBoundingClientRect();
      const preview = document.querySelector(".preview")?.getBoundingClientRect();
      const tabs = document.querySelector("#mobileTabs")?.getBoundingClientRect();
      if (!map || !preview || !tabs) return false;
      return map.right <= preview.left + 1 && preview.bottom <= tabs.top + 1;
    })).toBe(true);
    await landscapePage.locator('[data-mobile-view="app"]').tap();
    await expect(landscapePage.locator(".preview")).toBeVisible();
    await expect.poll(() => landscapePage.locator(".preview").evaluate(el => {
      const rect = el.getBoundingClientRect();
      const tabs = document.querySelector("#mobileTabs").getBoundingClientRect();
      return rect.bottom <= tabs.top + 1;
    })).toBe(true);
    await landscapeContext.close();
  });

  test("keeps mid-size touch canvas free of side drawers until a workspace tab is chosen @smoke", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://localhost:8124",
      viewport: { width: 820, height: 1180 },
      hasTouch: true,
      isMobile: true
    });
    const page = await context.newPage();
    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.setItem(`${key}.ui`, JSON.stringify({
        inspectorCollapsed: false,
        previewCollapsed: false,
        stateExplorerCollapsed: false,
        stateExplorerGroup: "website",
        mobileWorkspaceView: "canvas",
        inspectorWidth: 520,
        previewWidth: 520
      }));
    }, { key: STORAGE_KEY, model: defaultTestModel() });
    await page.goto("/state.html");
    await expect(page.locator('[data-id="auth_start"]')).toBeVisible();
    await expect(page.locator("#mobileTabs")).toBeVisible();
    await expect(page.locator('[data-mobile-view="canvas"]')).toHaveClass(/active/);
    await expect(page.locator("#map")).toBeVisible();
    await expect(page.locator("#stateInspector")).toBeHidden();
    await expect(page.locator("#stateExplorer")).toBeHidden();
    await expect(page.locator(".preview")).toBeVisible();

    await page.locator('[data-id="auth_start"] .title').tap();
    await expect(page.locator('[data-mobile-view="canvas"]')).toHaveClass(/active/);
    await expect(page.locator("#stateInspector")).toBeHidden();
    await expect(page.locator("#stateExplorer")).toBeHidden();
    await expect(page.locator(".preview")).toBeVisible();

    await page.locator('[data-mobile-view="edit"]').tap();
    await expect(page.locator("#stateInspector")).toBeVisible();
    await expect(page.locator("#map")).toBeVisible();
    await page.locator('[data-mobile-view="canvas"]').tap();
    await expect(page.locator("#map")).toBeVisible();
    await expect(page.locator("#stateInspector")).toBeHidden();
    await expect(page.locator(".preview")).toBeVisible();

    await page.locator('[data-mobile-view="app"]').tap();
    await expect(page.locator(".preview")).toBeVisible();
    await expect(page.locator("#map")).toBeVisible();
    await context.close();
  });

  test("drops presets onto the mobile canvas with an intentional fast touch drag @smoke", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://localhost:8124",
      viewport: { width: 390, height: 820 },
      hasTouch: true,
      isMobile: true
    });
    const page = await context.newPage();
    await openTool(page);

    await page.locator('[data-mobile-view="presets"]').tap();
    const preset = componentPreset(page, "Textblock");
    await expect(preset).toBeVisible();
    const start = await centerOf(preset);
    const before = await canvasStateNodes(page).count();

    await preset.dispatchEvent("pointerdown", {
      pointerId: 41,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: start.x,
      clientY: start.y,
      bubbles: true,
      cancelable: true
    });
    await page.waitForTimeout(40);
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new PointerEvent("pointermove", {
        pointerId: 41,
        pointerType: "touch",
        isPrimary: true,
        button: 0,
        buttons: 1,
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true
      }));
    }, { x: start.x + 18, y: start.y + 4 });
    await expect(page.locator('[data-mobile-view="canvas"]')).toHaveClass(/active/);
    await expect(page.locator(".template-drag-ghost")).toBeVisible();

    const drop = await emptyCanvasPoint(page);
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new PointerEvent("pointermove", {
        pointerId: 41,
        pointerType: "touch",
        isPrimary: true,
        button: 0,
        buttons: 1,
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true
      }));
      window.dispatchEvent(new PointerEvent("pointerup", {
        pointerId: 41,
        pointerType: "touch",
        isPrimary: true,
        button: 0,
        buttons: 0,
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true
      }));
    }, drop);

    await expect(canvasStateNodes(page)).toHaveCount(before + 1);
    await expect(nodeByTitle(page, "Textblock")).toBeVisible();
    await expect(page.locator(".template-drag-ghost")).toHaveCount(0);
    await context.close();
  });

  test("keeps vertical mobile preset scrolling from starting a template drag", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://localhost:8124",
      viewport: { width: 390, height: 820 },
      hasTouch: true,
      isMobile: true
    });
    const page = await context.newPage();
    await openTool(page);

    await page.locator('[data-mobile-view="presets"]').tap();
    const preset = componentPreset(page, "Textblock");
    await expect(preset).toBeVisible();
    const start = await centerOf(preset);

    await preset.dispatchEvent("pointerdown", {
      pointerId: 42,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: start.x,
      clientY: start.y,
      bubbles: true,
      cancelable: true
    });
    await page.waitForTimeout(40);
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new PointerEvent("pointermove", {
        pointerId: 42,
        pointerType: "touch",
        isPrimary: true,
        button: 0,
        buttons: 1,
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true
      }));
    }, { x: start.x + 2, y: start.y + 28 });

    await expect(page.locator('[data-mobile-view="presets"]')).toHaveClass(/active/);
    await expect(page.locator(".template-drag-ghost")).toHaveCount(0);
    await context.close();
  });

  test("persists the selected mobile workspace view across reopening", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://localhost:8124",
      viewport: { width: 390, height: 820 },
      hasTouch: true,
      isMobile: true
    });
    const page = await context.newPage();
    await page.goto("/state.html");
    await page.evaluate(key => {
      localStorage.setItem(`${key}.ui`, JSON.stringify({
        inspectorCollapsed: false,
        previewCollapsed: false,
        stateExplorerCollapsed: false,
        mobileWorkspaceView: "canvas",
        inspectorWidth: 540,
        previewWidth: 520
      }));
    }, STORAGE_KEY);
    await page.reload();
    await expect(page.locator("#mobileTabs")).toBeVisible();

    await page.locator('[data-mobile-view="app"]').tap();
    await expect(page.locator(".preview")).toBeVisible();
    expect(await savedUiState(page)).toMatchObject({
      mobileWorkspaceView: "app",
      previewCollapsed: false,
      inspectorWidth: 540,
      previewWidth: 520
    });

    const reopened = await context.newPage();
    await reopened.goto("/state.html");
    await expect(reopened.locator("#mobileTabs")).toBeVisible();
    await expect(reopened.locator('[data-mobile-view="app"]')).toHaveClass(/active/);
    await expect(reopened.locator(".preview")).toBeVisible();
    await expect(reopened.locator("#map")).toBeHidden();
    await expect(reopened.locator("#stateInspector")).toBeHidden();
    await reopened.close();
    await context.close();
  });

  test("adds list items reliably without nested component scrolling", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"]').click();
    await expect(page.locator("#pTitle")).toBeVisible();
    await openStateLayer(page, "login");
    await addComponentState(page, "List");

    const listEditor = page.locator(".component-editor").filter({ hasText: "List" });
    const itemInputs = listEditor.locator(".list-item-editor input");
    await expect(itemInputs).toHaveCount(4);

    await listEditor.locator(".component-add-item").click();
    await expect(itemInputs).toHaveCount(5);
    await expect.poll(() => itemInputs.last().evaluate(el => document.activeElement === el)).toBe(true);

    await itemInputs.last().fill("Remember me option");
    await expect.poll(async () => {
      const model = await savedModel(page);
      const list = model.states.find(state => state.parentId === "login" && state.title === "List");
      return list?.components.find(component => component.type === "list")?.text || "";
    }).toContain("Remember me option");

    await expect(page.locator("#pComponents")).toHaveCSS("overflow", "visible");
    await expect(page.locator("#pComponents")).toHaveCSS("scrollbar-width", "none");
    await expect(page.locator("#stateInspectorBody")).toHaveCSS("scrollbar-color", "rgb(49, 95, 140) rgb(7, 19, 33)");
    await expect.poll(async () => {
      const box = await page.locator("#stateInspector").boundingBox();
      return Math.round(box?.width || 0);
    }).toBeGreaterThanOrEqual(280);
  });

  test("does not reroute when Alt-drag starts from the line body", async ({ page }) => {
    await openTool(page);
    const label = page.locator("svg text.edge-label").filter({ hasText: "Login" });
    await expect(label).toHaveCount(1);
    const start = await centerOf(label);
    const end = await centerOf(statePort(page, "error", "in"));

    await page.keyboard.down("Alt");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up("Alt");

    const model = await savedModel(page);
    expect(model.transitions.find(t => t.from === "auth_start" && t.label === "Login")?.to).toBe("login");
  });

  test("reroutes from the arrowhead with mobile long-press", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    await openTool(page);
    await page.evaluate(() => {
      model.transitions = model.transitions.filter(t => !(t.from === "auth_start" && t.to === "register"));
      saveModel();
      draw();
    });
    const loginEdgeId = await page.evaluate(key => {
      const stored = JSON.parse(localStorage.getItem(`${key}.editor`) || localStorage.getItem(key) || "null");
      const model = stored?.model || stored;
      return model.transitions.find(t => t.from === "auth_start" && t.label === "Login").id;
    }, STORAGE_KEY);
    const arrowTip = page.locator(`circle.edge-tip-hit[data-edge-id="${loginEdgeId}"]`);
    await expect(arrowTip).toBeVisible();
    const start = await centerOf(arrowTip);
    const end = await centerOf(statePort(page, "register", "in"));

    await arrowTip.dispatchEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerType: "touch",
      pointerId: 77,
      clientX: start.x,
      clientY: start.y
    });
    await page.waitForTimeout(460);
    await page.mouse.move(end.x, end.y, { steps: 12 });
    await page.mouse.up();

    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.transitions.find(t => t.from === "auth_start" && t.label === "Login")?.to;
    }).toBe("register");
  });

  test("reroutes to a self-loop with mobile long-press", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    await openTool(page);
    const loginEdgeId = await page.evaluate(key => {
      const stored = JSON.parse(localStorage.getItem(`${key}.editor`) || localStorage.getItem(key) || "null");
      const model = stored?.model || stored;
      return model.transitions.find(t => t.from === "auth_start" && t.label === "Login").id;
    }, STORAGE_KEY);
    const arrowTip = page.locator(`circle.edge-tip-hit[data-edge-id="${loginEdgeId}"]`);
    const start = await centerOf(arrowTip);
    const ownInput = await centerOf(statePort(page, "auth_start", "in"));

    await arrowTip.dispatchEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerType: "touch",
      pointerId: 88,
      clientX: start.x,
      clientY: start.y
    });
    await page.waitForTimeout(460);
    await page.mouse.move(start.x + 80, start.y - 120, { steps: 6 });
    await page.mouse.move(ownInput.x, ownInput.y, { steps: 10 });
    await page.mouse.up();

    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.transitions.find(t => t.id === loginEdgeId)?.to;
    }).toBe("auth_start");
  });

  test("zooms vertical wheel on the canvas and keeps horizontal wheel navigation untouched", async ({ page }) => {
    await openTool(page);
    const mapBox = await page.locator("#map").boundingBox();
    await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
    const beforeWheel = await worldScale(page);

    await page.mouse.wheel(0, -180);
    await expect.poll(() => worldScale(page)).toBeGreaterThan(beforeWheel);

    const beforeHorizontalWheel = await worldTransform(page);
    await page.mouse.wheel(180, 0);
    await expect.poll(() => worldTransform(page)).toBe(beforeHorizontalWheel);

    const beforeCtrlWheel = await worldScale(page);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -180);
    await page.keyboard.up("Control");

    await expect.poll(() => worldScale(page)).toBeGreaterThan(beforeCtrlWheel);
  });

  test("accumulates tiny desktop pinch wheel deltas reliably", async ({ page }) => {
    await openTool(page);
    const mapBox = await page.locator("#map").boundingBox();
    const anchor = {
      x: mapBox.x + mapBox.width * 0.42,
      y: mapBox.y + mapBox.height * 0.48
    };
    const before = await worldTransform(page);
    const scaleBefore = await worldScale(page);

    await page.locator("#map").evaluate((map, point) => {
      for (let i = 0; i < 24; i++) {
        map.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
          deltaY: -1,
          clientX: point.x,
          clientY: point.y
        }));
      }
    }, anchor);

    await expect.poll(() => worldScale(page)).toBeGreaterThanOrEqual(scaleBefore * 1.06);
    expect(await worldTransform(page)).not.toBe(before);
  });

  test("zooms desktop touch pinches responsively on the canvas", async ({ page }) => {
    await openTool(page);
    const mapBox = await page.locator("#map").boundingBox();
    const center = {
      x: mapBox.x + mapBox.width / 2,
      y: mapBox.y + mapBox.height / 2
    };
    const scaleBefore = await worldScale(page);

    await page.locator("#map").evaluate((map, point) => {
      const fireOnMap = (type, pointerId, x, y) => {
        map.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerType: "touch",
          pointerId,
          clientX: x,
          clientY: y,
          buttons: type === "pointerup" ? 0 : 1
        }));
      };
      const fireOnWindow = (type, pointerId, x, y) => {
        window.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerType: "touch",
          pointerId,
          clientX: x,
          clientY: y,
          buttons: type === "pointerup" ? 0 : 1
        }));
      };

      fireOnMap("pointerdown", 31, point.x - 60, point.y);
      fireOnMap("pointerdown", 32, point.x + 60, point.y);
      fireOnWindow("pointermove", 31, point.x - 90, point.y);
      fireOnWindow("pointermove", 32, point.x + 90, point.y);
      fireOnWindow("pointerup", 31, point.x - 90, point.y);
      fireOnWindow("pointerup", 32, point.x + 90, point.y);
    }, center);

    await expect.poll(() => worldScale(page)).toBeGreaterThanOrEqual(scaleBefore * 1.55);
  });

  test("pans and zooms together during a two-finger tablet gesture @smoke", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://localhost:8124",
      viewport: { width: 900, height: 820 },
      hasTouch: true
    });
    const page = await context.newPage();
    await openTool(page);

    const mapBox = await page.locator("#map").boundingBox();
    const startCenter = {
      x: mapBox.x + mapBox.width * 0.42,
      y: mapBox.y + mapBox.height * 0.46
    };
    const endCenter = {
      x: startCenter.x + 82,
      y: startCenter.y + 44
    };
    const cameraAt = async (point) => page.locator("#map").evaluate((map, target) => {
      const world = document.getElementById("world");
      const transform = getComputedStyle(world).transform;
      const matrix = new DOMMatrixReadOnly(transform === "none" ? undefined : transform);
      const rect = map.getBoundingClientRect();
      return {
        scale: matrix.a,
        x: matrix.e,
        y: matrix.f,
        worldX: (target.x - rect.left - matrix.e) / matrix.a,
        worldY: (target.y - rect.top - matrix.f) / matrix.a
      };
    }, point);
    const before = await cameraAt(startCenter);

    await page.locator("#map").evaluate((map, gesture) => {
      const fireOnMap = (type, pointerId, x, y) => {
        map.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerType: "touch",
          pointerId,
          clientX: x,
          clientY: y,
          buttons: type === "pointerup" ? 0 : 1
        }));
      };
      const fireOnWindow = (type, pointerId, x, y) => {
        window.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerType: "touch",
          pointerId,
          clientX: x,
          clientY: y,
          buttons: type === "pointerup" ? 0 : 1
        }));
      };
      const { startCenter, endCenter } = gesture;
      fireOnMap("pointerdown", 171, startCenter.x - 56, startCenter.y);
      fireOnMap("pointerdown", 172, startCenter.x + 56, startCenter.y);
      fireOnWindow("pointermove", 171, endCenter.x - 56, endCenter.y);
      fireOnWindow("pointermove", 172, endCenter.x + 56, endCenter.y);
      fireOnWindow("pointermove", 171, endCenter.x - 98, endCenter.y - 14);
      fireOnWindow("pointermove", 172, endCenter.x + 98, endCenter.y + 14);
      fireOnWindow("pointerup", 171, endCenter.x - 98, endCenter.y - 14);
      fireOnWindow("pointerup", 172, endCenter.x + 98, endCenter.y + 14);
    }, { startCenter, endCenter });

    const after = await cameraAt(endCenter);
    expect(after.scale).toBeGreaterThan(before.scale * 1.55);
    expect(Math.abs(after.worldX - before.worldX)).toBeLessThan(3);
    expect(Math.abs(after.worldY - before.worldY)).toBeLessThan(3);
    expect(after.x).not.toBe(before.x);
    expect(after.y).not.toBe(before.y);
    await context.close();
  });

  test("keeps single-finger tablet gestures from zooming after stale touch state @smoke", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://localhost:8124",
      viewport: { width: 900, height: 820 },
      hasTouch: true
    });
    const page = await context.newPage();
    await openTool(page);

    const start = await emptyCanvasPoint(page);
    const beforeScale = await worldScale(page);
    const beforeTransform = await worldTransform(page);

    await page.locator("#map").evaluate((map, point) => {
      const fireOnMap = (type, pointerId, x, y, isPrimary = true) => {
        map.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerType: "touch",
          pointerId,
          isPrimary,
          clientX: x,
          clientY: y,
          buttons: type === "pointerup" ? 0 : 1
        }));
      };
      const fireOnWindow = (type, pointerId, x, y, isPrimary = true) => {
        window.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerType: "touch",
          pointerId,
          isPrimary,
          clientX: x,
          clientY: y,
          buttons: type === "pointerup" ? 0 : 1
        }));
      };

      fireOnMap("pointerdown", 711, point.x - 84, point.y - 24, true);
      fireOnMap("pointerdown", 712, point.x, point.y, true);
      fireOnWindow("pointermove", 712, point.x + 72, point.y + 24, true);
      fireOnWindow("pointerup", 712, point.x + 72, point.y + 24, true);
    }, start);

    await expect.poll(() => worldScale(page)).toBe(beforeScale);
    await expect.poll(() => worldTransform(page)).not.toBe(beforeTransform);

    const initial = page.locator('[data-id="auth_start"]');
    const initialBox = await visibleBox(initial);
    const tap = {
      x: initialBox.x + initialBox.width / 2,
      y: initialBox.y + initialBox.height / 2
    };
    const scaleBeforeTap = await worldScale(page);

    await initial.dispatchEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerType: "touch",
      pointerId: 713,
      isPrimary: true,
      clientX: tap.x,
      clientY: tap.y,
      buttons: 1
    });
    await page.evaluate(point => {
      window.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerType: "touch",
        pointerId: 713,
        isPrimary: true,
        clientX: point.x,
        clientY: point.y,
        buttons: 0
      }));
    }, tap);

    await expect(initial).toHaveClass(/selected/);
    await expect(page.locator("#pTitle")).toHaveValue("Auth start");
    await expect.poll(() => worldScale(page)).toBe(scaleBeforeTap);
    await context.close();
  });

  test("empty-canvas drag pans immediately; long-press enables rectangle select", async ({ page }) => {
    await openTool(page);
    const start = await emptyCanvasPoint(page);
    const beforeDrag = await worldTransform(page);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 80, start.y + 30, { steps: 6 });
    await page.mouse.up();

    await expect.poll(() => worldTransform(page)).not.toBe(beforeDrag);
    await expect(page.locator("#selectionActions")).toBeHidden();

    await page.getByRole("button", { name: "Fit" }).click();
    const nodeBoxAfterFit = await page.locator('[data-id="auth_start"]').boundingBox();
    const selectStart = await emptyCanvasPoint(page);
    const selectEnd = { x: nodeBoxAfterFit.x + nodeBoxAfterFit.width / 2, y: nodeBoxAfterFit.y + nodeBoxAfterFit.height / 2 };

    await page.mouse.move(selectStart.x, selectStart.y);
    await page.mouse.down();
    await page.waitForTimeout(410);
    await page.mouse.move(selectEnd.x, selectEnd.y, { steps: 8 });
    await page.mouse.up();

    await expect(page.locator("#selectionActions")).toBeVisible();
    await expect(page.locator("#selectionCount")).toContainText("state");
  });

  test("keeps selected state context while panning the canvas and clears only on empty click", async ({ page }) => {
    await openTool(page);
    const login = page.locator('[data-id="login"]');
    await login.click();
    await expect(login).toHaveClass(/selected/);
    await expect(page.locator("#pTitle")).toBeVisible();
    await expect(page.locator("#pTitle")).toHaveValue("Login");
    const beforeDrag = await worldTransform(page);

    const point = await emptyCanvasPoint(page);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 90, point.y + 35, { steps: 6 });
    await page.mouse.up();

    await expect.poll(() => worldTransform(page)).not.toBe(beforeDrag);
    await expect(login).toHaveClass(/selected/);
    await expect(page.locator("#pTitle")).toBeVisible();
    await expect(page.locator("#pTitle")).toHaveValue("Login");

    const clickPoint = await emptyCanvasPoint(page);
    await page.mouse.click(clickPoint.x, clickPoint.y);
    await expect(login).not.toHaveClass(/selected/);
    await expect(page.locator("#pTitle")).toHaveCount(0);
    await expect(page.locator("#stateInspectorBody")).toContainText("Kein Zustand ausgewaehlt");
  });

  test("keeps selected transition context while panning the canvas and clears only on empty click", async ({ page }) => {
    await openTool(page);
    const loginEdgeId = await savedModel(page).then(model =>
      model.transitions.find(t => t.from === "auth_start" && t.to === "login").id
    );
    const edge = page.locator(`.edge[data-edge-id="${loginEdgeId}"]`);
    const label = page.locator(`.edge-label[data-edge-id="${loginEdgeId}"]`);
    await label.click();
    await expect(edge).toHaveClass(/selected/);
    await expect(label).toHaveClass(/selected/);
    await expect(page.locator("#pLabel")).toBeVisible();
    const beforeDrag = await worldTransform(page);

    const point = await emptyCanvasPoint(page);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x - 80, point.y + 45, { steps: 6 });
    await page.mouse.up();

    await expect.poll(() => worldTransform(page)).not.toBe(beforeDrag);
    await expect(edge).toHaveClass(/selected/);
    await expect(page.locator("#pLabel")).toBeVisible();

    const clickPoint = await emptyCanvasPoint(page);
    await page.mouse.click(clickPoint.x, clickPoint.y);
    await expect(edge).not.toHaveClass(/selected/);
  });

  test("cancels rectangle select when the mouse leaves the browser or window focus is lost", async ({ page }) => {
    await openTool(page);
    await page.getByRole("button", { name: "Fit" }).click();

    const startSelection = async () => {
      const nodeBox = await page.locator('[data-id="auth_start"]').boundingBox();
      const selectStart = await emptyCanvasPoint(page);
      const selectEnd = { x: nodeBox.x + nodeBox.width / 2, y: nodeBox.y + nodeBox.height / 2 };
      await page.mouse.move(selectStart.x, selectStart.y);
      await page.mouse.down();
      await page.waitForTimeout(410);
      await page.mouse.move(selectEnd.x, selectEnd.y, { steps: 8 });
      await expect(page.locator("#selectRect")).toHaveCSS("display", "block");
      await expect(page.locator("#selectionActions")).toBeVisible();
    };

    await startSelection();
    await page.evaluate(() => {
      document.dispatchEvent(new MouseEvent("mouseout", {
        bubbles: true,
        buttons: 1,
        relatedTarget: null
      }));
    });
    await expect(page.locator("#selectRect")).toHaveCSS("display", "none");
    await expect(page.locator("#selectionActions")).toBeHidden();
    await page.mouse.move(20, 20);
    await expect(page.locator("#selectRect")).toHaveCSS("display", "none");
    await page.mouse.up();

    await startSelection();
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(page.locator("#selectRect")).toHaveCSS("display", "none");
    await expect(page.locator("#selectionActions")).toBeHidden();
    await page.mouse.up();
  });

  test("cancels node dragging when the mouse leaves the browser or window focus is lost", async ({ page }) => {
    await openTool(page);
    const dragNode = async (id, cancelInPage) => {
      const node = page.locator(`[data-id="${id}"]`);
      const box = await visibleBox(node);
      const before = await savedModel(page).then(model => {
        const state = model.states.find(item => item.id === id);
        return { x: state.x, y: state.y };
      });

      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 72, box.y + box.height / 2 + 48, { steps: 8 });
      await expect(page.locator("#map")).toHaveClass(/dragging-state/);
      await cancelInPage();
      await expect(page.locator("#map")).not.toHaveClass(/dragging-state/);
      await expect(page.locator("#stateExplorer")).not.toHaveClass(/drag-over/);
      const cancelled = await savedModel(page).then(model => {
        const state = model.states.find(item => item.id === id);
        return { x: state.x, y: state.y };
      });
      expect(cancelled.x !== before.x || cancelled.y !== before.y).toBe(true);

      await page.mouse.move(box.x + box.width / 2 + 180, box.y + box.height / 2 + 120, { steps: 8 });
      await expect.poll(async () => {
        const model = await savedModel(page);
        const state = model.states.find(item => item.id === id);
        return { x: state.x, y: state.y };
      }).toEqual(cancelled);
      await page.mouse.up();
    };

    await dragNode("login", () => page.evaluate(() => {
      document.dispatchEvent(new MouseEvent("mouseout", {
        bubbles: true,
        buttons: 1,
        relatedTarget: null
      }));
    }));

    await dragNode("register", () => page.evaluate(() => window.dispatchEvent(new Event("blur"))));
  });

  test("keeps many connected lanes cheap while dragging a busy state node", async ({ page }) => {
    const states = [{ id: "hub", title: "Hub", body: "Many cables", x: 480, y: 336 }];
    const transitions = [];
    for (let index = 0; index < 10; index++) {
      const y = 96 + index * 72;
      states.push(
        { id: `source_${index}`, title: `Source ${index}`, body: "", x: 96, y },
        { id: `target_${index}`, title: `Target ${index}`, body: "", x: 864, y }
      );
      transitions.push(
        { id: `in_${index}`, from: `source_${index}`, to: "hub", label: `In ${index}`, condition: "" },
        { id: `out_${index}`, from: "hub", to: `target_${index}`, label: `Out ${index}`, condition: "" }
      );
    }
    const model = { version: 2, name: "Busy lanes", initial: "hub", states, transitions };

    await page.addInitScript(({ key, model }) => {
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.removeItem(`${key}.editor`);
      localStorage.removeItem(`${key}.camera`);
      localStorage.removeItem(`${key}.previewCollapsed`);
      localStorage.removeItem(`${key}.stateExplorer`);
      localStorage.removeItem(`${key}.ui`);
      window.__stateBlueprintRouteMetrics = {};
      window.__stateBlueprintPerfMetrics = {};
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    for (const transition of transitions) {
      await expect(page.locator(`.edge[data-edge-id="${transition.id}"]`)).toHaveCount(1);
    }
    const initialReport = await gridGeometryReport(page);
    const hubPins = transitions.map(transition => {
      const side = transition.to === "hub" ? "in" : "out";
      return initialReport.pins.find(pin => pin.id === transition.id && pin.side === side);
    });
    expect(hubPins.every(Boolean)).toBe(true);
    expect(new Set(hubPins.map(pin => `${pin.x},${pin.y}`)).size).toBe(20);

    const hubBox = await visibleBox(page.locator('[data-id="hub"]'));
    const start = { x: hubBox.x + hubBox.width / 2, y: hubBox.y + hubBox.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.evaluate(() => {
      window.__stateBlueprintRouteMetrics = {};
      window.__stateBlueprintPerfMetrics = {};
    });
    await page.mouse.move(start.x + 168, start.y + 96, { steps: 6 });
    await page.waitForTimeout(80);

    const duringDrag = await page.evaluate(() => window.__stateBlueprintRouteMetrics);
    const perfDuringDrag = await page.evaluate(() => window.__stateBlueprintPerfMetrics);
    expect(duringDrag.liveDragRouteBuilds).toBeGreaterThan(0);
    expect(duringDrag.finalRouteBuilds || 0).toBe(0);
    expect(duringDrag.obstacleSearches || 0).toBe(0);
    expect(perfDuringDrag.liveWireUpdates).toBeGreaterThan(0);
    expect(perfDuringDrag.liveWireMutations).toBeGreaterThan(0);
    expect(perfDuringDrag.wireRebuilds || 0).toBe(0);
    expect(perfDuringDrag.drawCalls || 0).toBe(0);

    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.__stateBlueprintRouteMetrics.finalRouteBuilds || 0)).toBeGreaterThan(0);
    for (const transition of transitions) {
      await expect(page.locator(`.edge[data-edge-id="${transition.id}"]`)).toHaveCount(1);
    }
  });

  test("reuses SVG wire and port elements on full canvas redraw @smoke", async ({ page }) => {
    const states = [{ id: "hub", title: "Hub", body: "Many cables", x: 432, y: 288 }];
    const transitions = [];
    for (let index = 0; index < 8; index++) {
      states.push(
        { id: `source_${index}`, title: `Source ${index}`, body: "", x: 96, y: 96 + index * 64 },
        { id: `target_${index}`, title: `Target ${index}`, body: "", x: 768, y: 96 + index * 64 }
      );
      transitions.push(
        { id: `in_${index}`, from: `source_${index}`, to: "hub", label: `In ${index}`, condition: "" },
        { id: `out_${index}`, from: "hub", to: `target_${index}`, label: `Out ${index}`, condition: "" }
      );
    }
    const model = { version: 2, name: "Full redraw reuse", initial: "hub", states, transitions };

    await page.addInitScript(({ key, model }) => {
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.removeItem(`${key}.editor`);
      localStorage.removeItem(`${key}.camera`);
      localStorage.removeItem(`${key}.previewCollapsed`);
      localStorage.removeItem(`${key}.stateExplorer`);
      localStorage.removeItem(`${key}.ui`);
      window.__stateBlueprintPerfMetrics = {};
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    await expect(page.locator('.edge[data-edge-id="out_0"]')).toHaveCount(1);

    const before = await page.evaluate(() => ({
      wires: [...document.querySelectorAll("#wires [data-view-key]")].map(el => el.getAttribute("data-view-key")).sort(),
      ports: [...document.querySelectorAll("#ports [data-view-key]")].map(el => el.getAttribute("data-view-key")).sort()
    }));
    expect(before.wires.length).toBeGreaterThan(transitions.length * 2);
    expect(before.ports.length).toBeGreaterThan(states.length);

    const result = await page.evaluate(() => {
      window.__stateBlueprintPerfMetrics = {};
      draw();
      return {
        perf: { ...window.__stateBlueprintPerfMetrics },
        wires: [...document.querySelectorAll("#wires [data-view-key]")].map(el => el.getAttribute("data-view-key")).sort(),
        ports: [...document.querySelectorAll("#ports [data-view-key]")].map(el => el.getAttribute("data-view-key")).sort(),
        hasPersistentSvgPool: Boolean(document.querySelector("#wires").__recycledSvg || document.querySelector("#ports").__recycledSvg)
      };
    });

    expect(result.wires).toEqual(before.wires);
    expect(result.ports).toEqual(before.ports);
    expect(result.hasPersistentSvgPool).toBe(false);
    expect(result.perf.wireSyncs || 0).toBe(1);
    expect(result.perf.wireElementsCreated || 0).toBe(0);
    expect(result.perf.portElementsCreated || 0).toBe(0);
    expect(result.perf.wireElementsReused || 0).toBeGreaterThan(transitions.length * 2);
    expect(result.perf.portElementsReused || 0).toBeGreaterThan(states.length);
    expect(result.perf.wireRebuilds || 0).toBe(0);
  });

  test("skips full canvas redraw for runtime context-only bus updates", async ({ page }) => {
    const model = {
      version: 2,
      name: "Runtime context perf",
      initial: "idle",
      states: [
        { id: "idle", title: "Idle", body: "", x: 96, y: 144 },
        { id: "done", title: "Done", body: "", x: 432, y: 144 }
      ],
      transitions: [
        { id: "finish", from: "idle", to: "done", label: "Finish", condition: "" }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.removeItem(`${key}.editor`);
      localStorage.removeItem(`${key}.camera`);
      localStorage.removeItem(`${key}.previewCollapsed`);
      localStorage.removeItem(`${key}.stateExplorer`);
      localStorage.removeItem(`${key}.ui`);
      window.__stateBlueprintPerfMetrics = {};
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    await expect(page.locator('.edge[data-edge-id="finish"]')).toHaveCount(1);

    await page.evaluate(() => {
      window.__stateBlueprintPerfMetrics = {};
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "STATE_BLUEPRINT_RUNTIME_STATE",
          current: "done",
          context: { count: 1 }
        }
      }));
    });
    await expect.poll(() => page.evaluate(() => window.__stateBlueprintPerfMetrics.drawCalls || 0)).toBeGreaterThan(0);

    await page.evaluate(() => {
      window.__stateBlueprintPerfMetrics = {};
      window.dispatchEvent(new MessageEvent("message", {
        data: {
          type: "STATE_BLUEPRINT_RUNTIME_STATE",
          current: "done",
          context: { count: 2, email: "demo@example.com" }
        }
      }));
    });
    await page.waitForTimeout(80);

    const perf = await page.evaluate(() => window.__stateBlueprintPerfMetrics);
    expect(perf.drawCalls || 0).toBe(0);
    expect(perf.wireRebuilds || 0).toBe(0);
    await expect(page.locator("#runtimeState")).toContainText("done");
  });

  test("keeps clear live state-drag routes identical to the released frame @smoke", async ({ page }) => {
    const routeModel = {
      version: 2,
      name: "Stable drag routes",
      initial: "source",
      states: [
        { id: "source", title: "Source", body: "", x: 120, y: 240 },
        { id: "top", title: "Top", body: "", x: 696, y: 96 },
        { id: "bottom", title: "Bottom", body: "", x: 696, y: 408 }
      ],
      transitions: [
        { id: "source_to_top", from: "source", to: "top", label: "Top", condition: "" },
        { id: "source_to_bottom", from: "source", to: "bottom", label: "Bottom", condition: "" }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.removeItem(`${key}.editor`);
      localStorage.removeItem(`${key}.camera`);
      localStorage.removeItem(`${key}.previewCollapsed`);
      localStorage.removeItem(`${key}.stateExplorer`);
      localStorage.removeItem(`${key}.ui`);
      window.__stateBlueprintRouteMetrics = {};
    }, { key: STORAGE_KEY, model: routeModel });
    await page.goto("/state.html");
    for (const transition of routeModel.transitions) {
      await expect(page.locator(`.edge[data-edge-id="${transition.id}"]`)).toHaveCount(1);
    }

    const sourceBox = await visibleBox(page.locator('[data-id="source"]'));
    const start = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.evaluate(() => { window.__stateBlueprintRouteMetrics = {}; });
    await page.mouse.move(start.x + 168, start.y + 96, { steps: 12 });
    await expect(page.locator("#map")).toHaveClass(/dragging-state/);

    const transitionIds = routeModel.transitions.map(transition => transition.id);
    const duringDrag = await page.evaluate(ids => Object.fromEntries(ids.map(id => [
      id,
      document.querySelector(`.edge[data-edge-id="${CSS.escape(id)}"]`)?.getAttribute("d") || ""
    ])), transitionIds);

    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.__stateBlueprintRouteMetrics.finalRouteBuilds || 0)).toBeGreaterThan(0);
    const afterRelease = await page.evaluate(ids => Object.fromEntries(ids.map(id => [
      id,
      document.querySelector(`.edge[data-edge-id="${CSS.escape(id)}"]`)?.getAttribute("d") || ""
    ])), transitionIds);
    const metrics = await page.evaluate(() => window.__stateBlueprintRouteMetrics);

    expect(duringDrag).toEqual(afterRelease);
    expect(metrics.liveDragRouteBuilds).toBeGreaterThan(0);
    expect(metrics.obstacleSearches || 0).toBe(0);
  });

  test("keeps obstacle-rerouted live drags identical without dense grid search @smoke", async ({ page }) => {
    const routeModel = {
      version: 2,
      name: "Sparse drag routes",
      initial: "source",
      states: [
        { id: "source", title: "Source", body: "", x: 96, y: 96 },
        { id: "obstacle", title: "Obstacle", body: "", x: 384, y: 144 },
        { id: "target", title: "Target", body: "", x: 720, y: 96 }
      ],
      transitions: [
        { id: "source_to_target", from: "source", to: "target", label: "Target", condition: "" }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.removeItem(`${key}.editor`);
      localStorage.removeItem(`${key}.camera`);
      localStorage.removeItem(`${key}.previewCollapsed`);
      localStorage.removeItem(`${key}.stateExplorer`);
      localStorage.removeItem(`${key}.ui`);
      window.__stateBlueprintRouteMetrics = {};
    }, { key: STORAGE_KEY, model: routeModel });
    await page.goto("/state.html");
    await expect(page.locator('.edge[data-edge-id="source_to_target"]')).toHaveCount(1);

    const sourceBox = await visibleBox(page.locator('[data-id="source"]'));
    const start = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.evaluate(() => { window.__stateBlueprintRouteMetrics = {}; });
    await page.mouse.move(start.x + 48, start.y + 48, { steps: 14 });
    await expect(page.locator("#map")).toHaveClass(/dragging-state/);

    const duringDrag = await page.locator('.edge[data-edge-id="source_to_target"]').getAttribute("d");
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.__stateBlueprintRouteMetrics.finalRouteBuilds || 0)).toBeGreaterThan(0);
    const afterRelease = await page.locator('.edge[data-edge-id="source_to_target"]').getAttribute("d");
    const metrics = await page.evaluate(() => window.__stateBlueprintRouteMetrics);

    expect(duringDrag).toBe(afterRelease);
    expect(metrics.liveDragRouteBuilds).toBeGreaterThan(0);
    expect(metrics.obstacleSearches || 0).toBe(0);
  });

  test("keeps envelope live routes from running behind state boxes @smoke", async ({ page }) => {
    const states = [
      { id: "source", title: "Source", body: "", x: 96, y: 240 },
      { id: "target", title: "Target", body: "", x: 1128, y: 240 }
    ];
    let obstacleIndex = 0;
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        states.push({
          id: `obstacle_${obstacleIndex++}`,
          title: `Obstacle ${obstacleIndex}`,
          body: "",
          x: 336 + col * 144,
          y: 72 + row * 96
        });
      }
    }
    const routeModel = {
      version: 2,
      name: "Dense envelope route",
      initial: "source",
      states,
      transitions: [
        { id: "source_to_target", from: "source", to: "target", label: "Target", condition: "" }
      ]
    };

    await page.addInitScript(({ key, model }) => {
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.removeItem(`${key}.editor`);
      localStorage.removeItem(`${key}.camera`);
      localStorage.removeItem(`${key}.previewCollapsed`);
      localStorage.removeItem(`${key}.stateExplorer`);
      localStorage.removeItem(`${key}.ui`);
      window.__stateBlueprintRouteMetrics = {};
    }, { key: STORAGE_KEY, model: routeModel });
    await page.goto("/state.html");
    await expect(page.locator('.edge[data-edge-id="source_to_target"]')).toHaveCount(1);

    const sourceBox = await visibleBox(page.locator('[data-id="source"]'));
    const start = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.evaluate(() => { window.__stateBlueprintRouteMetrics = {}; });
    await page.mouse.move(start.x + 24, start.y, { steps: 8 });
    await expect(page.locator("#map")).toHaveClass(/dragging-state/);

    const report = await gridGeometryReport(page);
    const route = report.paths.find(path => path.id === "source_to_target");
    expect(route).toBeTruthy();
    expect(route.allSegmentsOrthogonal).toBe(true);
    const blockingNodes = report.nodes.filter(node =>
      !["source", "target"].includes(node.id) &&
      !String(node.id || "").startsWith("proxy:")
    );
    for (const node of blockingNodes) {
      for (const segment of route.segments) {
        expect(segmentIntersectsNode(segment, node, 0)).toBe(false);
      }
    }
    expect(route.points.some(point => point.y < Math.min(...blockingNodes.map(node => node.top)))).toBe(true);
    const metrics = await page.evaluate(() => window.__stateBlueprintRouteMetrics);
    expect(metrics.liveDragRouteBuilds).toBeGreaterThan(0);
    expect(metrics.obstacleSearches || 0).toBe(0);

    await page.mouse.up();
  });

  test("updates layer bounds and boundary proxy pins during live state drag @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "Live boundary drag",
      initial: "left",
      boundary: { exitId: "right" },
      states: [
        { id: "left", title: "Left", body: "", x: 96, y: 192 },
        { id: "right", title: "Right", body: "", x: 504, y: 192 }
      ],
      transitions: [
        { id: "left_to_right", from: "left", to: "right", label: "Next", condition: "", set: {} }
      ]
    };
    await page.addInitScript(({ key, model }) => {
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.removeItem(`${key}.editor`);
      localStorage.removeItem(`${key}.camera`);
      localStorage.removeItem(`${key}.previewCollapsed`);
      localStorage.removeItem(`${key}.stateExplorer`);
      localStorage.removeItem(`${key}.ui`);
      window.__stateBlueprintRouteMetrics = {};
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(2);
    await expect(page.locator(".node.boundary-proxy")).toHaveCount(2);
    await expect(page.locator('.edge[data-edge-id="boundary-flow:__root__:output"]')).toHaveCount(1);

    const liveBoundaryGeometry = () => page.evaluate(() => {
      const nums = value => (String(value || "").match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      const frame = document.querySelector("#layerFrame");
      const proxy = document.querySelector('.node.boundary-output[data-id="proxy:__root__:output:__boundary_output"]');
      const port = document.querySelector('svg#ports .svg-port[data-state-id="proxy:__root__:output:__boundary_output"][data-port-side="in"]');
      const pin = document.querySelector('.edge-pin[data-edge-id="boundary-flow:__root__:output"][data-edge-pin="in"]');
      const edge = document.querySelector('.edge[data-edge-id="boundary-flow:__root__:output"]');
      const points = nums(edge?.getAttribute("d") || "");
      const portPoint = nums(port?.getAttribute("transform") || "");
      return {
        frameTop: Number.parseFloat(frame?.style.top || "0"),
        frameHeight: Number.parseFloat(frame?.style.height || "0"),
        proxyTop: Number.parseFloat(proxy?.style.top || "0"),
        portX: portPoint[0],
        portY: portPoint[1],
        pinX: Number.parseFloat(pin?.getAttribute("cx") || "0"),
        pinY: Number.parseFloat(pin?.getAttribute("cy") || "0"),
        edgeEndX: points[points.length - 2],
        edgeEndY: points[points.length - 1]
      };
    });

    const before = await liveBoundaryGeometry();
    const rightBox = await visibleBox(page.locator('[data-id="right"]'));
    const start = { x: rightBox.x + rightBox.width / 2, y: rightBox.y + rightBox.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.evaluate(() => { window.__stateBlueprintRouteMetrics = {}; });
    await page.mouse.move(start.x + 96, start.y + 216, { steps: 16 });
    await expect(page.locator("#map")).toHaveClass(/dragging-state/);

    const duringDrag = await liveBoundaryGeometry();
    expect(duringDrag.frameHeight).toBeGreaterThan(before.frameHeight);
    expect(duringDrag.proxyTop).not.toBe(before.proxyTop);
    expect(duringDrag.portY).not.toBe(before.portY);
    expect(duringDrag.pinY).not.toBe(before.pinY);
    expect(duringDrag.pinX).toBe(duringDrag.portX);
    expect(duringDrag.pinY).toBe(duringDrag.portY);
    expect(duringDrag.edgeEndX).toBe(duringDrag.portX);
    expect(duringDrag.edgeEndY).toBe(duringDrag.portY);
    const metrics = await page.evaluate(() => window.__stateBlueprintRouteMetrics);
    expect(metrics.liveDragRouteBuilds).toBeGreaterThan(0);

    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.__stateBlueprintRouteMetrics.finalRouteBuilds || 0)).toBeGreaterThan(0);
    const afterRelease = await liveBoundaryGeometry();
    expect(afterRelease.frameHeight).toBe(duringDrag.frameHeight);
    expect(afterRelease.proxyTop).toBe(duringDrag.proxyTop);
    expect(afterRelease.portY).toBe(duringDrag.portY);
    expect(afterRelease.pinY).toBe(duringDrag.pinY);
  });

  test("keeps dragged node, svg ports, and edge pins on one world position through release @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "Stable drag coordinates",
      initial: "source",
      states: [
        { id: "source", title: "Source", body: "", x: 120, y: 192 },
        { id: "target", title: "Target", body: "", x: 576, y: 192 }
      ],
      transitions: [
        { id: "source_to_target", from: "source", to: "target", label: "Next", condition: "", set: {} }
      ]
    };
    await page.addInitScript(({ key, model }) => {
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.removeItem(`${key}.editor`);
      localStorage.removeItem(`${key}.camera`);
      localStorage.removeItem(`${key}.previewCollapsed`);
      localStorage.removeItem(`${key}.stateExplorer`);
      localStorage.removeItem(`${key}.ui`);
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    await expect(page.locator('.edge[data-edge-id="source_to_target"]')).toHaveCount(1);

    const dragGeometry = () => page.evaluate(() => {
      const nums = value => (String(value || "").match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      const node = document.querySelector('.node[data-id="source"]');
      const inputPort = document.querySelector('svg#ports .svg-port[data-state-id="source"][data-port-side="in"]');
      const outputPort = document.querySelector('svg#ports .svg-port[data-state-id="source"][data-port-side="out"]');
      const pin = document.querySelector('.edge-pin[data-edge-id="source_to_target"][data-edge-pin="out"]');
      const transform = String(node?.style.transform || "");
      const translate = transform.match(/translate3d?\(\s*(-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px/i);
      const tx = translate ? Number(translate[1]) : 0;
      const ty = translate ? Number(translate[2]) : 0;
      const left = Number.parseFloat(node?.style.left || "0");
      const top = Number.parseFloat(node?.style.top || "0");
      const width = Number.parseFloat(node?.style.width || "0");
      const height = Number.parseFloat(node?.style.height || "0");
      const inputPortPoint = nums(inputPort?.getAttribute("transform") || "");
      const outputPortPoint = nums(outputPort?.getAttribute("transform") || "");
      const hitBox = port => {
        const hit = port?.querySelector(".svg-port-hit");
        return hit ? {
          tag: hit.tagName.toLowerCase(),
          x: Number.parseFloat(hit.getAttribute("x") || "0"),
          y: Number.parseFloat(hit.getAttribute("y") || "0"),
          width: Number.parseFloat(hit.getAttribute("width") || "0"),
          height: Number.parseFloat(hit.getAttribute("height") || "0"),
          rx: Number.parseFloat(hit.getAttribute("rx") || "0")
        } : null;
      };
      return {
        stateX: node?.__state?.x,
        stateY: node?.__state?.y,
        visualLeft: left + tx,
        visualTop: top + ty,
        width,
        height,
        transform,
        inputPortX: inputPortPoint[0],
        inputPortY: inputPortPoint[1],
        outputPortX: outputPortPoint[0],
        outputPortY: outputPortPoint[1],
        inputHit: hitBox(inputPort),
        outputHit: hitBox(outputPort),
        pinX: Number.parseFloat(pin?.getAttribute("cx") || "0"),
        pinY: Number.parseFloat(pin?.getAttribute("cy") || "0")
      };
    });
    const expectAligned = geometry => {
      expect(geometry.visualLeft).toBe(geometry.stateX);
      expect(geometry.visualTop).toBe(geometry.stateY);
      expect(geometry.inputPortX).toBe(geometry.visualLeft);
      expect(geometry.outputPortX).toBe(geometry.visualLeft + geometry.width);
      expect(geometry.inputPortY).toBe(geometry.visualTop + geometry.height / 2);
      expect(geometry.outputPortY).toBe(geometry.visualTop + geometry.height / 2);
      expect(geometry.pinX).toBe(geometry.outputPortX);
      expect(geometry.pinY).toBe(geometry.outputPortY);
      expect(geometry.inputHit).toMatchObject({ tag: "rect", x: -18, y: -16, width: 26, height: 32, rx: 10 });
      expect(geometry.outputHit).toMatchObject({ tag: "rect", x: -8, y: -16, width: 26, height: 32, rx: 10 });
    };

    const sourceBox = await visibleBox(page.locator('[data-id="source"]'));
    const start = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 144, start.y + 96, { steps: 12 });
    await expect(page.locator("#map")).toHaveClass(/dragging-state/);
    const duringDrag = await dragGeometry();
    expect(duringDrag.transform).toContain("translate");
    expectAligned(duringDrag);

    await page.mouse.up();
    await expect(page.locator("#map")).not.toHaveClass(/dragging-state/);
    const afterRelease = await dragGeometry();
    expect(afterRelease.transform).toBe("");
    expectAligned(afterRelease);

    const draggedSourceBox = await visibleBox(page.locator('[data-id="source"]'));
    const nearOutputInside = {
      x: draggedSourceBox.x + draggedSourceBox.width - 14,
      y: draggedSourceBox.y + draggedSourceBox.height / 2
    };
    await page.mouse.move(nearOutputInside.x, nearOutputInside.y);
    await page.mouse.down();
    await page.mouse.move(nearOutputInside.x + 80, nearOutputInside.y + 48, { steps: 8 });
    await expect(page.locator("#map")).toHaveClass(/dragging-state/);
    await expect(page.locator("#map")).not.toHaveClass(/connecting/);
    await page.mouse.up();
    await expect(page.locator("#map")).not.toHaveClass(/dragging-state/);
  });

  test("recovers desktop drag, pan, and connection gestures when mouseup is missed", async ({ page }) => {
    await openTool(page);

    const login = page.locator('[data-id="login"]');
    const loginBox = await visibleBox(login);
    await page.mouse.move(loginBox.x + loginBox.width / 2, loginBox.y + loginBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(loginBox.x + loginBox.width / 2 + 72, loginBox.y + loginBox.height / 2 + 48, { steps: 8 });
    await expect(page.locator("#map")).toHaveClass(/dragging-state/);
    await dispatchLostDesktopMouseRelease(page);
    await expect(page.locator("#map")).not.toHaveClass(/dragging-state/);
    await expect(page.locator("#stateExplorer")).not.toHaveClass(/drag-over/);
    const dragStoppedAt = await savedModel(page).then(model => {
      const state = model.states.find(item => item.id === "login");
      return { x: state.x, y: state.y };
    });
    await page.mouse.move(loginBox.x + loginBox.width / 2 + 190, loginBox.y + loginBox.height / 2 + 130, { steps: 8 });
    await expect.poll(async () => {
      const model = await savedModel(page);
      const state = model.states.find(item => item.id === "login");
      return { x: state.x, y: state.y };
    }).toEqual(dragStoppedAt);
    await page.mouse.up();

    const panStart = await emptyCanvasPoint(page);
    await page.mouse.move(panStart.x, panStart.y);
    await page.mouse.down();
    await page.mouse.move(panStart.x - 82, panStart.y + 44, { steps: 6 });
    await expect(page.locator("#map")).toHaveClass(/panning/);
    const transformAtCancel = await worldTransform(page);
    await dispatchLostDesktopMouseRelease(page);
    await expect(page.locator("#map")).not.toHaveClass(/panning/);
    await page.mouse.move(panStart.x - 168, panStart.y + 88, { steps: 6 });
    await expect.poll(() => worldTransform(page)).toBe(transformAtCancel);
    await page.mouse.up();

    const transitionsBefore = await savedModel(page).then(model => model.transitions.length);
    const output = await centerOf(statePort(page, "auth_start", "out"));
    await page.mouse.move(output.x, output.y);
    await page.mouse.down();
    await page.mouse.move(output.x + 96, output.y + 42, { steps: 6 });
    await expect(page.locator("#map")).toHaveClass(/connecting/);
    await dispatchLostDesktopMouseRelease(page);
    await expect(page.locator("#map")).not.toHaveClass(/connecting/);
    await page.mouse.move(output.x + 220, output.y + 120, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => savedModel(page).then(model => model.transitions.length)).toBe(transitionsBefore);
  });

  test("shift-click toggles mixed selections and undo redo restores empty-canvas deselection", async ({ page }) => {
    await openTool(page);
    const loginEdgeId = await page.evaluate(key => {
      const stored = JSON.parse(localStorage.getItem(`${key}.editor`) || localStorage.getItem(key) || "null");
      const model = stored?.model || stored;
      return model.transitions.find(t => t.from === "auth_start" && t.label === "Login").id;
    }, STORAGE_KEY);
    const login = page.locator('[data-id="login"]');
    const register = page.locator('[data-id="register"]');
    const loginEdge = page.locator(`.edge[data-edge-id="${loginEdgeId}"]`);

    await login.click();
    await expect(login).toHaveClass(/selected/);
    await expect(register).not.toHaveClass(/selected/);

    await register.click({ modifiers: ["Shift"] });
    await expect(login).toHaveClass(/selected/);
    await expect(register).toHaveClass(/selected/);
    await expect(page.locator("#selectionActions")).toBeVisible();
    await expect(page.locator("#selectionCount")).toContainText("2 Zustaende");

    await login.click({ modifiers: ["Shift"] });
    await expect(login).not.toHaveClass(/selected/);
    await expect(register).toHaveClass(/selected/);

    await page.locator(`.edge-label[data-edge-id="${loginEdgeId}"]`).click({ modifiers: ["Shift"] });
    await expect(register).toHaveClass(/selected/);
    await expect(loginEdge).toHaveClass(/selected/);

    const empty = await emptyCanvasPoint(page);
    await page.mouse.click(empty.x, empty.y);
    await expect(register).not.toHaveClass(/selected/);
    await expect(loginEdge).not.toHaveClass(/selected/);
    await expect(page.locator("#selectionActions")).toBeHidden();

    await page.keyboard.press("Control+KeyZ");
    await expect(register).toHaveClass(/selected/);
    await expect(loginEdge).toHaveClass(/selected/);

    await page.keyboard.press("Control+KeyY");
    await expect(register).not.toHaveClass(/selected/);
    await expect(loginEdge).not.toHaveClass(/selected/);
  });

  test("deleting a selected transition never removes selected connected states @smoke", async ({ page }) => {
    await openTool(page);
    const loginEdgeId = await savedModel(page).then(model =>
      model.transitions.find(t => t.from === "auth_start" && t.to === "login").id
    );
    const authStart = page.locator('[data-id="auth_start"]');
    const login = page.locator('[data-id="login"]');
    const loginEdge = page.locator(`.edge[data-edge-id="${loginEdgeId}"]`);
    const loginLabel = page.locator(`.edge-label[data-edge-id="${loginEdgeId}"]`);

    await login.click();
    await expect(login).toHaveClass(/selected/);
    await loginLabel.click({ modifiers: ["Shift"] });
    await expect(login).toHaveClass(/selected/);
    await expect(loginEdge).toHaveClass(/selected/);
    await expect(page.locator("#selectionCount")).toContainText("1 Zustand + 1 Uebergang");

    await page.keyboard.press("Delete");
    await expect(loginEdge).toHaveCount(0);
    await expect(authStart).toBeVisible();
    await expect(login).toBeVisible();
    await expect(login).toHaveClass(/selected/);
    await expect(page.locator("#selectionCount")).toContainText("1 Zustand");
    await expect.poll(async () => {
      const model = await savedModel(page);
      return {
        hasAuthStart: model.states.some(state => state.id === "auth_start"),
        hasLogin: model.states.some(state => state.id === "login"),
        hasTransition: model.transitions.some(transition => transition.id === loginEdgeId)
      };
    }).toEqual({ hasAuthStart: true, hasLogin: true, hasTransition: false });
  });

  test("deletes Ctrl+A selected states and transitions with one Delete keypress @smoke", async ({ page }) => {
    await openTool(page);
    const initialModel = await savedModel(page);
    const rootStateIds = initialModel.states.filter(state => !state.parentId).map(state => state.id);
    const rootStateSet = new Set(rootStateIds);
    const rootTransitionIds = initialModel.transitions
      .filter(transition => rootStateSet.has(transition.from) && rootStateSet.has(transition.to))
      .map(transition => transition.id);
    expect(rootStateIds.length).toBeGreaterThan(0);
    expect(rootTransitionIds.length).toBeGreaterThan(0);

    await page.locator("#map").focus();
    await expect.poll(() => page.locator("#map").evaluate(el => document.activeElement === el)).toBe(true);
    await page.keyboard.press("Control+A");
    await expect(page.locator("#selectionCount")).toContainText(`${rootStateIds.length} Zustaende`);
    await expect(page.locator("#selectionCount")).toContainText(`${rootTransitionIds.length} Uebergaenge`);

    await page.keyboard.press("Delete");
    for (const stateId of rootStateIds) {
      await expect(page.locator(`[data-id="${stateId}"]`)).toHaveCount(0);
    }
    await expect(page.locator("#selectionActions")).toBeHidden();
    await expect.poll(async () => {
      const model = await savedModel(page);
      return {
        states: model.states.length,
        transitions: model.transitions.length,
        initial: model.initial
      };
    }).toEqual({ states: 0, transitions: 0, initial: "" });
  });

  test("keeps undo redo state clean when deleting and restoring selected states", async ({ page }) => {
    await openTool(page);
    const login = page.locator('[data-id="login"]');
    const register = page.locator('[data-id="register"]');

    await login.click();
    await register.click({ modifiers: ["Shift"] });
    await expect(login).toHaveClass(/selected/);
    await expect(register).toHaveClass(/selected/);
    await expect(page.locator("#selectionActions")).toBeVisible();
    await expect(page.locator("#selectionCount")).toContainText("2 Zustaende");

    await page.keyboard.press("Delete");
    await expect(login).toHaveCount(0);
    await expect(register).toHaveCount(0);
    await expect(page.locator("#selectionActions")).toBeHidden();
    await expect(savedModel(page).then(model => model.states.some(state => state.id === "login"))).resolves.toBe(false);

    await page.keyboard.press("Control+KeyZ");
    await expect(login).toBeVisible();
    await expect(register).toBeVisible();
    await expect(login).toHaveClass(/selected/);
    await expect(register).toHaveClass(/selected/);
    await expect(page.locator("#selectionActions")).toBeVisible();
    await expect(page.locator("#selectionCount")).toContainText("2 Zustaende");
    await expect(savedModel(page).then(model => model.states.some(state => state.id === "login"))).resolves.toBe(true);

    await page.keyboard.press("Control+KeyY");
    await expect(login).toHaveCount(0);
    await expect(register).toHaveCount(0);
    await expect(page.locator("#selectionActions")).toBeHidden();
    await expect(savedModel(page).then(model => model.states.some(state => state.id === "login"))).resolves.toBe(false);
  });

  test("stores reusable states in the bottom explorer without moving or duplicating the source node", async ({ page }) => {
    await openTool(page);
    const login = page.locator('[data-id="login"]');
    await expect(login).toBeVisible();

    await page.locator("#btnToggleStateExplorer").click();
    await expect(page.locator("#stateExplorer")).toHaveClass(/collapsed/);

    await login.click();
    await page.locator("#pTitle").fill("Reusable login");
    await expandComponentEditor(page, "Text");
    await componentEditor(page, "Text").locator("textarea").fill("A reusable sign-in screen");
    await openInitialValuesEditor(page);
    await page.locator("#pData").fill('{"role":"member"}');
    const originalPosition = await savedModel(page).then(model => {
      const state = model.states.find(item => item.id === "login");
      return { x: state?.x, y: state?.y, parentId: state?.parentId || null };
    });

    await dragNodeToStateExplorer(page, login);

    const template = page.locator(".state-template-card").filter({ hasText: "Reusable login" });
    await expect(template).toBeVisible();
    await expect(page.locator("#stateExplorer")).not.toHaveClass(/collapsed/);
    await expect(canvasStateNodes(page)).toHaveCount(6);
    await expect(boundaryProxyNodes(page)).toHaveCount(2);
    await expect(login).toBeVisible();
    await expect.poll(async () => {
      const model = await savedModel(page);
      const states = model.states.filter(state => state.id === "login");
      const state = states[0];
      return {
        count: states.length,
        x: state?.x,
        y: state?.y,
        parentId: state?.parentId || null
      };
    }).toEqual({ count: 1, ...originalPosition });

    await expect.poll(async () => {
      const templates = await savedStateTemplates(page);
      return templates.map(template => ({
        title: template.title,
        text: template.components.find(component => component.type === "text")?.text,
        role: template.data?.role
      }));
    }).toEqual([{ title: "Reusable login", text: "A reusable sign-in screen", role: "member" }]);

    await dragNodeToStateExplorer(page, login);
    await expect(page.locator(".state-template-card")).toHaveCount(1);
    await expect.poll(async () => (await savedStateTemplates(page)).length).toBe(1);

    await page.keyboard.press("Control+Space");
    await expect(page.locator("#stateExplorer")).toHaveClass(/collapsed/);
    await page.keyboard.press("Control+Space");
    await expect(page.locator("#stateExplorer")).not.toHaveClass(/collapsed/);
  });

  test("keeps canvas state drags above the explorer drop surface", async ({ page }) => {
    await openTool(page);
    const login = page.locator('[data-id="login"]');
    const nodeBox = await visibleBox(login);
    const explorerBox = await visibleBox(page.locator("#stateExplorer"));

    await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(explorerBox.x + explorerBox.width / 2, explorerBox.y + explorerBox.height / 2, { steps: 12 });

    await expect(page.locator("#map")).toHaveClass(/dragging-state/);
    await expect(page.locator("#stateExplorer")).toHaveClass(/drag-over/);
    await expect.poll(() => page.locator("#world").evaluate(el => Number(getComputedStyle(el).zIndex))).toBeGreaterThan(
      await page.locator("#stateExplorer").evaluate(el => Number(getComputedStyle(el).zIndex))
    );

    await page.mouse.up();
    await expect(page.locator("#map")).not.toHaveClass(/dragging-state/);
    await expect(page.locator(".state-template-card")).toHaveCount(1);
  });

  test("adds and uses state explorer presets", async ({ page }) => {
    await openTool(page);

    await addComponentState(page, "Text");
    await page.locator("#pTitle").fill("Quick lesson");
    await componentEditor(page, "Text").locator("textarea").fill("Hello {{role}}");
    await openInitialValuesEditor(page);
    await page.locator("#pData").fill('{"role":"mentor"}');
    const sourceId = await page.locator(".node.selected").getAttribute("data-id");
    await dragNodeToStateExplorer(page, page.locator(`[data-id="${sourceId}"]`));
    const preset = page.locator(".state-template-card").first();
    await expect(preset).toHaveClass(/editing/);
    await expect(page.locator(".state-explorer-label")).toHaveCount(0);
    await expect(componentPreset(page, "Textblock")).toHaveAttribute("data-template-kind", "core");
    await expect(componentPreset(page, "Textblock").getByRole("button", { name: "Löschen" })).toHaveCount(0);
    await expect(preset).toHaveAttribute("data-template-kind", "user");
    await expect(preset.getByRole("button", { name: "Löschen" })).toBeVisible();
    const cardColors = await page.evaluate(() => ({
      coreBorder: getComputedStyle(document.querySelector(".component-preset-card")).borderColor,
      userBorder: getComputedStyle(document.querySelector(".state-template-card")).borderColor
    }));
    expect(cardColors.coreBorder).not.toBe(cardColors.userBorder);
    await expect(preset.locator(".template-title-input")).toHaveCount(0);
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Vorlage: Quick lesson");
    await expect(page.locator("#stateInspector")).toHaveClass(/template-inspector/);
    await expect(page.locator("#stateInspectorBody")).toContainText("Wiederverwendbare Vorlage");
    await expect(page.locator("#stateInspectorBody")).toContainText("Bestehende Zustaende auf der Arbeitsflaeche bleiben unveraendert");
    await expect.poll(async () => {
      const templates = await savedStateTemplates(page);
      return {
        title: templates[0].title,
        text: templates[0].components.find(component => component.type === "text")?.text,
        data: templates[0].data
      };
    }).toEqual({
      title: "Quick lesson",
      text: "Hello {{role}}",
      data: { role: "mentor" }
    });

    await preset.getByRole("button", { name: "Verwenden" }).click();
    await expect(canvasStateNodes(page)).toHaveCount(8);
    await expect(boundaryProxyNodes(page)).toHaveCount(2);
    await expect(page.locator("#pTitle")).toHaveValue("Quick lesson");
    await expandComponentEditor(page, "Text");
    await expect(componentEditor(page, "Text").locator("textarea")).toHaveValue("Hello {{role}}");
    await expect(appFrame(page).getByText("Hello mentor")).toBeVisible();
  });

  test("state explorer presets expose typed variables without forcing raw JSON editing", async ({ page }) => {
    await openTool(page, {
      stateTemplates: [{
        id: "tpl_login_preset",
        rootStateId: "tpl_login_preset",
        title: "Login preset",
        body: "",
        components: [{ id: "tpl_login_text", type: "text", text: "Welcome {{email}}", url: "" }],
        data: { email: "user@example.com" },
        dataTypes: { email: "email" },
        states: [],
        transitions: []
      }]
    });

    const preset = page.locator(".state-template-card").filter({ hasText: "Login preset" }).first();
    await preset.click();
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Vorlage: Login preset");
    await expect(page.locator("#stateInspectorBody")).toContainText("Wiederverwendbare Vorlage");
    await expect(page.locator("#pTemplateStateVariableList")).toBeVisible();
    await expect(page.locator("#pTemplateAdvancedDataCard")).toBeVisible();
    await expect(page.locator("#pData")).toBeHidden();

    const emailRow = page.locator('.state-variable-row[data-variable-path="email"]');
    await expect(emailRow.locator('[data-state-variable-name="true"]')).toHaveValue("email");
    await expect(emailRow.locator('[data-state-variable-type="true"]')).toHaveValue("email");
    await expect(emailRow.locator('[data-state-variable-value="true"]')).toHaveValue("user@example.com");

    await page.locator("#pTemplateStateVariableName").fill("avatar");
    await page.locator("#pTemplateStateVariableType").selectOption("image");
    await page.locator("#pTemplateStateVariableAdd").click();

    const avatarRow = page.locator('.state-variable-row[data-variable-path="avatar"]');
    await expect(avatarRow.locator('[data-state-variable-type="true"]')).toHaveValue("image");
    await avatarRow.locator('[data-state-variable-value="true"]').fill("https://example.com/avatar.png");

    await expect.poll(async () => {
      const templates = await savedStateTemplates(page);
      return {
        data: templates[0]?.data,
        dataTypes: templates[0]?.dataTypes
      };
    }).toEqual({
      data: {
        email: "user@example.com",
        avatar: "https://example.com/avatar.png"
      },
      dataTypes: {
        email: "email",
        avatar: "image"
      }
    });

    await page.locator("#pTemplateUse").click();
    await expect.poll(async () => {
      const model = await savedModel(page);
      const state = model.states.find(item => item.title === "Login preset");
      return {
        data: state?.data,
        dataTypes: state?.dataTypes
      };
    }).toEqual({
      data: {
        email: "user@example.com",
        avatar: "https://example.com/avatar.png"
      },
      dataTypes: {
        email: "email",
        avatar: "image"
      }
    });
  });

  test("updates, deletes, and undo-redo restores state explorer presets", async ({ page }) => {
    await openTool(page, {
      stateTemplates: [{
        id: "tpl_quick_lesson",
        rootStateId: "tpl_quick_lesson",
        title: "Quick lesson",
        body: "",
        components: [{ id: "tpl_text", type: "text", text: "Hello {{role}}", url: "" }],
        data: { role: "mentor" },
        states: [],
        transitions: []
      }]
    });
    const preset = page.locator(".state-template-card").filter({ hasText: "Quick lesson" }).first();
    await expect(preset).toBeVisible();

    await openStateInspector(page, "login");
    await page.locator("#pTitle").fill("Updated reusable login");
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.id === "login")?.title;
    }).toBe("Updated reusable login");
    await expandComponentEditor(page, "Text");
    const loginTextArea = componentEditor(page, "Text").locator("textarea:visible");
    await expect(loginTextArea).toHaveValue("Email and password are entered.");
    await loginTextArea.fill("Updated body {{role}}");

    await preset.getByRole("button", { name: "Aktualisieren" }).click();
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Vorlage: Updated reusable login");
    await expect.poll(async () => {
      const templates = await savedStateTemplates(page);
      return {
        title: templates[0].title,
        text: templates[0].components.find(component => component.type === "text")?.text
      };
    }).toEqual({
      title: "Updated reusable login",
      text: "Updated body {{role}}"
    });

    const updatedPreset = page.locator(".state-template-card").filter({ hasText: "Updated reusable login" }).first();
    await expect(updatedPreset).toBeVisible();
    await expect(updatedPreset.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await updatedPreset.click();
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Vorlage: Updated reusable login");
    await expect(page.locator("#stateInspector")).toHaveClass(/template-inspector/);
    await expandComponentEditor(page, "Text");
    await expect(componentEditor(page, "Text").locator("textarea")).toHaveValue("Updated body {{role}}");

    await updatedPreset.getByRole("button", { name: "Verwenden" }).click();
    await expect(page.locator("#pTitle")).toHaveValue("Updated reusable login");
    await expandComponentEditor(page, "Text");
    await expect(componentEditor(page, "Text").locator("textarea")).toHaveValue("Updated body {{role}}");

    await updatedPreset.click();
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Vorlage: Updated reusable login");
    await updatedPreset.getByRole("button", { name: "Löschen" }).click();
    const deleteDialog = page.getByRole("dialog", { name: "Vorlage löschen" });
    await expect(deleteDialog).toBeVisible();
    await expect(page.locator("#modalMessage")).toContainText("Updated reusable login");
    await deleteDialog.getByRole("button", { name: "Abbrechen" }).click();
    await expect(deleteDialog).toBeHidden();
    await expect(page.locator(".state-template-card")).toHaveCount(1);

    await updatedPreset.getByRole("button", { name: "Löschen" }).click();
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByRole("button", { name: "Vorlage löschen" }).click();
    await expect(page.locator(".state-template-card")).toHaveCount(0);
    await expect.poll(async () => (await savedStateTemplates(page)).length).toBe(0);

    await page.keyboard.press("Control+Z");
    await expect(page.locator(".state-template-card")).toHaveCount(1);
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Vorlage: Updated reusable login");
    await expect.poll(async () => (await savedStateTemplates(page))[0]?.title).toBe("Updated reusable login");

    await page.keyboard.press("Control+Y");
    await expect(page.locator(".state-template-card")).toHaveCount(0);
    await expect.poll(async () => (await savedStateTemplates(page)).length).toBe(0);
  });

  test("reuses state explorer presets as stable snapshots across reload, drag, and double click", async ({ page }) => {
    await openTool(page);
    const login = page.locator('[data-id="login"]');

    await login.click();
    await page.locator("#pTitle").fill("Reusable login");
    await expandComponentEditor(page, "Text");
    await componentEditor(page, "Text").locator("textarea").fill("Welcome {{role}}");
    await openInitialValuesEditor(page);
    await page.locator("#pData").fill('{"role":"member"}');
    await dragNodeToStateExplorer(page, login);
    await expect(page.locator(".state-template-card").filter({ hasText: "Reusable login" })).toBeVisible();
    await expect.poll(async () => (await savedStateTemplates(page)).length).toBe(1);

    const workPage = await page.context().newPage();
    await workPage.goto("/state.html");
    await expect(workPage.locator('[data-id="login"]')).toBeVisible();
    const template = workPage.locator(".state-template-card").filter({ hasText: "Reusable login" });
    await expect(template).toBeVisible();

    const mapBox = await visibleBox(workPage.locator("#map"));
    await template.dragTo(workPage.locator("#map"), {
      targetPosition: { x: Math.round(mapBox.width * 0.56), y: 120 }
    });
    await expect(canvasStateNodes(workPage)).toHaveCount(7);
    await expect(boundaryProxyNodes(workPage)).toHaveCount(2);
    await expect(workPage.locator("#stateInspectorTitle")).toHaveText("Reusable login");
    await expect(workPage.locator("#pTitle")).toHaveValue("Reusable login");
    await expandComponentEditor(workPage, "Text");
    await expect(componentEditor(workPage, "Text").locator("textarea")).toHaveValue("Welcome {{role}}");
    await openInitialValuesEditor(workPage);
    await expect(workPage.locator("#pData")).toHaveValue(/"role": "member"/);
    await expect(appFrame(workPage).getByText("Welcome member")).toBeVisible();

    const createdId = await workPage.locator(".node.selected").getAttribute("data-id");
    await componentEditor(workPage, "Text").locator("textarea").fill("Edited instance only");
    await expect.poll(async () => {
      const templates = await savedStateTemplates(workPage);
      return templates[0].components.find(component => component.type === "text")?.text;
    }).toBe("Welcome {{role}}");

    await template.dblclick();
    await expect(canvasStateNodes(workPage)).toHaveCount(8);
    await expect(boundaryProxyNodes(workPage)).toHaveCount(2);
    await expandComponentEditor(workPage, "Text");
    await expect(componentEditor(workPage, "Text").locator("textarea")).toHaveValue("Welcome {{role}}");

    await expect.poll(async () => {
      const model = await savedModel(workPage);
      const reusableStates = model.states.filter(state => state.title === "Reusable login");
      return {
        count: reusableStates.length,
        editedText: model.states.find(state => state.id === createdId)?.components.find(component => component.type === "text")?.text,
        snapshotTexts: reusableStates
          .map(state => state.components.find(component => component.type === "text")?.text)
          .sort()
      };
    }).toEqual({
      count: 3,
      editedText: "Edited instance only",
      snapshotTexts: ["Edited instance only", "Welcome {{role}}", "Welcome {{role}}"]
    });
    await workPage.close();
  });

  test("drag-drops built-in explorer presets onto the canvas @smoke", async ({ page }) => {
    await openTool(page);

    const before = await page.locator(".node").count();
    const mapBox = await visibleBox(page.locator("#map"));
    await componentPreset(page, "Textblock").dragTo(page.locator("#map"), {
      targetPosition: { x: Math.round(mapBox.width * 0.58), y: 170 }
    });

    await expect(page.locator(".node")).toHaveCount(before + 1);
    await expect(page.locator(".workspace")).toHaveClass(/inspector-collapsed/);
    await expect(page.locator("#stateInspector")).toHaveClass(/inspector-pulse/);
    await expect(page.locator("#pTitle")).toBeHidden();
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.filter(state => state.title === "Textblock").length;
    }).toBeGreaterThan(0);
  });

  test("drops a new preset state onto an existing transition and inserts it into the FSM @smoke", async ({ page }) => {
    await openTool(page);

    const before = await savedModel(page);
    const beforeIds = new Set(before.states.map(state => state.id));
    const edgePoint = await page.evaluate(transitionId => {
      const path = document.querySelector(`.hit[data-edge-id="${CSS.escape(transitionId)}"]`);
      if (!path || typeof path.getTotalLength !== "function") return null;
      const matrix = path.getScreenCTM();
      if (!matrix) return null;
      const total = path.getTotalLength();
      const point = path.getPointAtLength(total * 0.5);
      const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      return { x: screen.x, y: screen.y };
    }, "t_auth_login");
    expect(edgePoint).toBeTruthy();

    const mapBox = await visibleBox(page.locator("#map"));
    await componentPreset(page, "Textblock").dragTo(page.locator("#map"), {
      targetPosition: {
        x: Math.round(edgePoint.x - mapBox.x),
        y: Math.round(edgePoint.y - mapBox.y)
      }
    });

    const model = await savedModel(page);
    const inserted = model.states.find(state => state.title === "Textblock" && !beforeIds.has(state.id));
    expect(inserted).toBeTruthy();
    const splitIncoming = model.transitions.find(transition => transition.id === "t_auth_login");
    expect(splitIncoming).toMatchObject({
      from: "auth_start",
      to: inserted.id,
      label: "Login"
    });
    const splitOutgoing = model.transitions.find(transition => transition.from === inserted.id && transition.to === "login");
    expect(splitOutgoing).toMatchObject({
      label: "To Login",
      triggerType: "button",
      condition: "",
      set: {}
    });
    expect(userTransitions(model).filter(transition => transition.from === "auth_start" && transition.to === "login")).toHaveLength(0);

    const app = appFrame(page);
    await page.locator('[data-id="auth_start"]').click();
    await expect(app.locator("#statePill")).toHaveText("auth_start");
    await app.locator('button[data-transition-id="t_auth_login"]').click();
    await expect(app.locator("#statePill")).toHaveText(inserted.id);
    await app.locator(`button[data-transition-id="${splitOutgoing.id}"]`).click();
    await expect(app.locator("#statePill")).toHaveText("login");
  });

  test("drag-drops breadcrumb preset with its default path visible in the generated app @smoke", async ({ page }) => {
    await openTool(page);

    const beforeIds = new Set((await savedModel(page)).states.map(state => state.id));
    const mapBox = await visibleBox(page.locator("#map"));
    await componentPreset(page, "Breadcrumb-Pfad").dragTo(page.locator("#map"), {
      targetPosition: { x: Math.round(mapBox.width * 0.58), y: 210 }
    });

    let createdId = "";
    await expect.poll(async () => {
      const model = await savedModel(page);
      const created = model.states.find(state => !beforeIds.has(state.id) && state.title === "Breadcrumb-Pfad");
      createdId = created?.id || "";
      return createdId;
    }).not.toBe("");

    await expect(appFrame(page).locator("#statePill")).toHaveText(createdId);
    await expectRenderedBreadcrumbs(appFrame(page), ["Start", "Projekte", "Aktuell"]);
  });

  test("previews a built-in preset on single click and restores the generated app on state selection @smoke", async ({ page }) => {
    await openTool(page);

    const before = await savedModel(page);
    const preset = componentPreset(page, "Externer Link");
    await preset.locator(".template-title").click();

    await expect(page.locator("#presetComposer")).toBeHidden();
    await expect(page.locator(".preview-title-text")).toHaveText("Vorlagenvorschau");
    await expect(preset).toHaveClass(/previewing/);
    await expect(appFrame(page).getByRole("link", { name: "Dokumentation öffnen" })).toBeVisible();
    await expect.poll(async () => {
      const stored = await savedModel(page);
      return {
        states: stored.states.length,
        transitions: stored.transitions.length,
        externalLinks: stored.states.filter(state => state.title === "Externer Link").length
      };
    }).toEqual({
      states: before.states.length,
      transitions: before.transitions.length,
      externalLinks: 0
    });

    await page.locator('[data-id="login"]').click();
    await expect(page.locator(".preview-title-text")).toHaveText("Generierte App");
    await expect(preset).not.toHaveClass(/previewing/);
    await expect(appFrame(page).locator("#statePill")).toHaveText("login");
    await expect(appFrame(page).getByRole("link", { name: "Dokumentation öffnen" })).toHaveCount(0);
  });

  test("adds a built-in preset from the left navigator without losing preset scroll @smoke", async ({ page }) => {
    await openTool(page);

    await expect(page.locator(".workspace")).toHaveClass(/inspector-collapsed/);
    await page.locator("#stateExplorerGroups").getByRole("button", { name: "Grundlagen" }).click();
    await expect(page.locator("#stateExplorerGroups").getByRole("button", { name: "Grundlagen" })).toHaveClass(/active/);
    const beforeScroll = await page.locator("#stateExplorerList").evaluate(el => el.scrollLeft);
    const before = await savedModel(page);
    await componentPreset(page, "Externer Link").getByRole("button", { name: "Externer Link hinzufügen" }).click();

    const composer = page.locator("#stateInspectorBody .preset-composer-shell");
    await expect(composer).toHaveCount(0);
    await expect(page.locator("#presetComposer")).toBeHidden();
    await expect(page.locator("#stateExplorer")).not.toHaveClass(/composer-active/);
    await expect(page.locator(".preview")).not.toHaveClass(/composer-active/);
    await expect(page.locator(".workspace")).not.toHaveClass(/inspector-collapsed/);
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Externer Link");
    await expect(page.locator("#pTitle")).toBeVisible();
    await expect.poll(() => page.locator("#stateExplorerList").evaluate(el => el.scrollLeft)).toBeGreaterThanOrEqual(Math.max(0, beforeScroll - 4));
    await expect.poll(async () => {
      const stored = await savedModel(page);
      const created = stored.states.find(state => !before.states.some(item => item.id === state.id));
      const selectedId = await page.evaluate(() => selected?.nodes?.[0] || "");
      return {
        title: created?.title || "",
        selected: Boolean(created && selectedId === created.id),
        components: created?.components || [],
        data: created?.data,
        dataTypes: created?.dataTypes,
        dataWires: (created?.dataWires || []).map(wire => wire.sourcePath)
      };
    }).toEqual({
      title: "Externer Link",
      selected: true,
      components: [],
      data: {
        link: {
          label: "Dokumentation öffnen",
          url: "https://example.com/docs"
        }
      },
      dataTypes: {
        link: "object",
        "link.label": "text",
        "link.url": "url"
      },
      dataWires: ["link"]
    });
    await expect(appFrame(page).getByRole("link", { name: "Dokumentation öffnen" })).toBeVisible();
  });

  test("filters state explorer presets by search text without breaking group layout @smoke", async ({ page }) => {
    await openTool(page);

    const search = page.locator("#stateExplorerSearch");
    await expect(search).toBeVisible();
    await search.fill("pricing");

    await expect(componentPreset(page, "Preiskarten")).toBeVisible();
    await expect(componentPreset(page, "Textblock")).toHaveCount(0);
    await expect(page.locator(".state-explorer-empty-results")).toHaveCount(0);

    await search.fill("does-not-exist");
    await expect(page.locator(".component-preset-card, .state-template-card")).toHaveCount(0);
    await expect(page.locator(".state-explorer-empty-results")).toContainText("Keine Vorlagen");

    await search.press("Escape");
    await expect(componentPreset(page, "Textblock")).toBeVisible();
    await expect(componentPreset(page, "Preiskarten")).toBeVisible();
  });

  test("groups explorer presets into usable website basecases without drawer overflow @smoke", async ({ page }) => {
    await openTool(page);

    const titles = await page.locator(".state-explorer-section-title").evaluateAll(nodes => nodes.map(node => node.textContent?.trim()));
    expect(titles.slice(0, 4)).toEqual(["Website", "Grundlagen", "Formulare", "Daten"]);
    await expect(page.locator("#stateExplorerGroups").getByRole("button", { name: "Website" })).toHaveClass(/active/);
    await expect(componentPreset(page, "Seitenüberschrift")).toBeVisible();
    await expect(componentPreset(page, "Inhaltsliste")).toBeVisible();
    await expect(componentPreset(page, "Hero-Bereich")).toBeVisible();
    await expect(componentPreset(page, "Textfeld")).toBeVisible();

    const groupedPresetOrder = await page.locator("#stateExplorerList").evaluate(root => {
      const titlesFor = key => [...root.querySelectorAll(`.state-explorer-section.core.${key} .template-title`)]
        .map(node => node.textContent?.trim() || "")
        .filter(Boolean);
      return {
        website: titlesFor("website"),
        basics: titlesFor("basics"),
        forms: titlesFor("forms"),
        data: titlesFor("data")
      };
    });
    expect(groupedPresetOrder.website.slice(0, 8)).toEqual([
      "Navbar einfach",
      "Navbar mit Menü",
      "Navbar Suche/Profil",
      "Navbar Shop/Warenkorb",
      "Hero-Bereich",
      "Hero mit Bild",
      "Hero mit Login-Formular",
      "Hero mit Bild-Overlay"
    ]);
    expect(groupedPresetOrder.basics.slice(0, 5)).toEqual([
      "Seitenüberschrift",
      "Textblock",
      "Bildblock",
      "Aufgaben-Checkliste",
      "Externer Link"
    ]);
    expect(groupedPresetOrder.forms.slice(0, 5)).toEqual([
      "Textfeld",
      "Aktionsbutton",
      "Auswahlfeld",
      "Checkbox-Feld",
      "Schalter"
    ]);
    expect(groupedPresetOrder.data.slice(0, 5)).toEqual([
      "Datentabelle",
      "Kennzahl",
      "Fortschrittsbalken",
      "Sternebewertung",
      "Prozessschritte"
    ]);

    await page.locator("#stateExplorerGroups").getByRole("button", { name: "Grundlagen" }).click();
    await expect(page.locator("#stateExplorerGroups").getByRole("button", { name: "Grundlagen" })).toHaveClass(/active/);

    const report = await page.locator("#stateExplorer").evaluate(explorer => {
      const explorerRect = explorer.getBoundingClientRect();
      const cards = [...explorer.querySelectorAll(".component-preset-card, .state-template-card")];
      const visibleCards = cards.filter(card => {
        const rect = card.getBoundingClientRect();
        return rect.right > explorerRect.left && rect.left < explorerRect.right;
      });
      return {
        cardCount: cards.length,
        visibleCardCount: visibleCards.length,
        verticalOverflow: visibleCards.some(card => {
          const rect = card.getBoundingClientRect();
          return rect.top < explorerRect.top - 1 || rect.bottom > explorerRect.bottom + 1;
        }),
        overlap: visibleCards.some((card, index) => visibleCards.slice(index + 1).some(other => {
          const a = card.getBoundingClientRect();
          const b = other.getBoundingClientRect();
          return a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
        })),
        textOverflow: visibleCards.some(card => {
          const title = card.querySelector(".template-title");
          return title && title.scrollWidth > title.clientWidth + 1 && getComputedStyle(title).overflowWrap !== "anywhere";
        })
      };
    });
    expect(report.cardCount).toBeGreaterThan(20);
    expect(report.visibleCardCount).toBeGreaterThan(0);
    expect(report.verticalOverflow).toBe(false);
    expect(report.overlap).toBe(false);
    expect(report.textOverflow).toBe(false);
  });

  test("keeps long preset add text inside cards and created states @smoke", async ({ page }) => {
    const longTitle = "PresetMitExtremLangemUntrennbaremTitelOhneSpacesDamitNichtsAusDemContainerLaeuft".repeat(2);
    const longText = "This preset intentionally carries far too much preview text so the explorer must stay compact.";
    const model = {
      version: 2,
      name: "Preset overflow",
      initial: "start",
      states: [
        { id: "start", title: "Start", body: "", x: 96, y: 144 }
      ],
      transitions: []
    };
    const templates = [{
      id: "tpl_long_overflow",
      rootStateId: "tpl_long_overflow",
      title: longTitle,
      description: longText,
      renderMode: "state",
      components: [{ id: "c_long_overflow", type: "text", text: longText, url: "" }],
      data: {},
      dataTypes: {}
    }];

    await page.addInitScript(({ key, model, templates }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
      localStorage.setItem(`${key}.stateExplorer`, JSON.stringify(templates));
    }, { key: STORAGE_KEY, model, templates });
    await page.goto("/state.html");

    const card = page.locator('.state-template-card[data-template-id="tpl_long_overflow"]');
    await expect(card).toBeVisible();
    const cardReport = await card.evaluate(el => {
      const title = el.querySelector(".template-title");
      const body = el.querySelector(".template-body");
      const titleStyle = getComputedStyle(title);
      const bodyStyle = getComputedStyle(body);
      return {
        titleOverflowX: titleStyle.overflowX,
        titleOverflowWrap: titleStyle.overflowWrap,
        titleLineClamp: titleStyle.webkitLineClamp,
        titleAttr: title.getAttribute("title"),
        bodyDisplay: bodyStyle.display,
        bodyTitleAttr: body.getAttribute("title")
      };
    });
    expect(cardReport.titleOverflowX).toBe("hidden");
    expect(cardReport.titleOverflowWrap).toBe("anywhere");
    expect(cardReport.titleLineClamp).toBe("2");
    expect(cardReport.titleAttr).toBe(longTitle);
    expect(cardReport.bodyDisplay).toBe("none");
    expect(cardReport.bodyTitleAttr).toBe(longText);

    await card.getByRole("button", { name: "Verwenden" }).click();
    await expect.poll(() => page.evaluate(title => {
      return [...document.querySelectorAll(".node .title")].some(el => el.textContent === title);
    }, longTitle)).toBe(true);

    const nodeReport = await page.evaluate(title => {
      const titleEl = [...document.querySelectorAll(".node .title")].find(el => el.textContent === title);
      const node = titleEl.closest(".node");
      const titleStyle = getComputedStyle(titleEl);
      const nodeRect = node.getBoundingClientRect();
      const titleRect = titleEl.getBoundingClientRect();
      return {
        overflowX: titleStyle.overflowX,
        overflowWrap: titleStyle.overflowWrap,
        lineClamp: titleStyle.webkitLineClamp,
        titleAttr: titleEl.getAttribute("title"),
        insideRight: titleRect.right <= nodeRect.right + 0.5,
        insideLeft: titleRect.left >= nodeRect.left - 0.5
      };
    }, longTitle);
    expect(nodeReport.overflowX).toBe("hidden");
    expect(nodeReport.overflowWrap).toBe("anywhere");
    expect(nodeReport.lineClamp).toBe("2");
    expect(nodeReport.titleAttr).toBe(longTitle);
    expect(nodeReport.insideRight).toBe(true);
    expect(nodeReport.insideLeft).toBe(true);
  });

  test("keeps data-wire render controls from overlapping in the state editor @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "Render layout",
      initial: "state_3",
      states: [{
        id: "state_3",
        title: "State 3",
        body: "",
        x: 220,
        y: 220,
        components: [],
        subscriptions: ["catalog.item"],
        dataWires: [
          { id: "wire_image", sourcePath: "catalog.item.image", role: "image", componentType: "image", label: "Image" },
          { id: "wire_title", sourcePath: "catalog.item.title", role: "title", componentType: "heading", label: "Title" },
          { id: "wire_price", sourcePath: "catalog.item.price", role: "price", componentType: "text", label: "Price" },
          { id: "wire_description", sourcePath: "catalog.item.description", role: "description", componentType: "text", label: "Description" },
          { id: "wire_category", sourcePath: "catalog.item.category", role: "field", componentType: "text", label: "Category" }
        ]
      }],
      transitions: []
    };
    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(`${key}.editor`, JSON.stringify({ model }));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    await openStateInspector(page, "state_3");
    await expect.poll(async () => {
      const stored = await savedModel(page);
      return stored.states.find(state => state.id === "state_3")?.dataWires?.length || 0;
    }).toBe(5);

    const rows = await expandDataRenderRows(page);
    await expect(rows).toHaveCount(5);
    await expect(rows.first().locator(".data-wire-controls")).toBeVisible();

    const report = await rows.evaluateAll(rowEls => {
      const rectOf = el => {
        const rect = el.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
      };
      const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
        * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      const pairReport = elements => {
        const rects = elements.map(el => ({ selector: el.className || el.tagName, rect: rectOf(el) }));
        const overlaps = [];
        for (let i = 0; i < rects.length; i += 1) {
          for (let j = i + 1; j < rects.length; j += 1) {
            const area = overlap(rects[i].rect, rects[j].rect);
            if (area > 1) overlaps.push({ a: rects[i].selector, b: rects[j].selector, area });
          }
        }
        return overlaps;
      };
      return rowEls.map(row => {
        const rowRect = rectOf(row);
        const directChildren = [...row.children];
        const controls = row.querySelector(".data-wire-controls");
        const controlChildren = controls ? [...controls.children] : [];
        const allChildren = [...row.querySelectorAll(".component-editor-head, .field, .data-wire-controls, select, button")];
        return {
          childOverlaps: pairReport(directChildren),
          controlOverlaps: pairReport(controlChildren),
          outside: allChildren
            .map(el => ({ selector: el.className || el.tagName, rect: rectOf(el) }))
            .filter(item => item.rect.left < rowRect.left - 1 || item.rect.right > rowRect.right + 1 || item.rect.top < rowRect.top - 1 || item.rect.bottom > rowRect.bottom + 1)
        };
      });
    });

    for (const row of report) {
      expect(row.childOverlaps).toEqual([]);
      expect(row.controlOverlaps).toEqual([]);
      expect(row.outside).toEqual([]);
    }
  });

  test("drag-wires data choices into render mappings without copying source data @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "Visual data wiring",
      initial: "state_3",
      states: [{
        id: "state_3",
        title: "State 3",
        body: "",
        x: 220,
        y: 220,
        data: {
          catalog: {
            item: {
              title: "Ada Chair",
              price: "$42",
              description: "Compact and sturdy"
            }
          }
        },
        components: [],
        dataWires: []
      }],
      transitions: []
    };
    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(`${key}.editor`, JSON.stringify({ model }));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    await openStateInspector(page, "state_3");

    const source = page.locator('.global-state-key-card[data-path="catalog.item.title"]');
    const target = page.locator(".data-wire-render-panel");
    await expect(source).toHaveClass(/draggable-data-path/);
    await expect(target).toBeVisible();
    const dataTransfer = await page.evaluateHandle(() => {
      const transfer = new DataTransfer();
      transfer.setData("application/x-state-blueprint-data-path", "catalog.item.title");
      transfer.setData("text/plain", "catalog.item.title");
      return transfer;
    });
    await source.dispatchEvent("dragstart", { dataTransfer });
    await target.dispatchEvent("dragover", { dataTransfer });
    await target.dispatchEvent("drop", { dataTransfer });
    await dataTransfer.dispose();

    await expect(dataRenderRows(page)).toHaveCount(1);
    await expect(appFrame(page).locator("#screen")).toContainText("Ada Chair");
    await expect.poll(async () => {
      const stored = await savedModel(page);
      const state = stored.states.find(item => item.id === "state_3");
      return {
        data: state.data,
        dataWires: state.dataWires.map(wire => wire.sourcePath),
        components: state.components.map(component => component.type === "dataWire" ? component.wireId : component.type)
      };
    }).toEqual({
      data: model.states[0].data,
      dataWires: ["catalog.item.title"],
      components: []
    });
  });

  test("keeps list rendering understandable with quick visible-field buttons @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "Friendly list rendering",
      initial: "state_3",
      states: [{
        id: "state_3",
        title: "Products",
        body: "",
        x: 220,
        y: 220,
        data: {
          products: [
            {
              title: "Ada Chair",
              image: "https://example.com/chair.png",
              badge: "New"
            },
            {
              title: "Linus Desk",
              image: "https://example.com/desk.png",
              badge: "Sale"
            }
          ]
        },
        repeat: { path: "products", as: "item", index: "i", manual: true },
        components: [],
        dataWires: []
      }],
      transitions: []
    };
    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(`${key}.editor`, JSON.stringify({ model }));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    await openStateInspector(page, "state_3");
    await openRepeatEditor(page);

    await expect(page.locator("#pFetchStatus")).toHaveText("Keine API");
    await expect(page.locator("#pRepeatStatus")).toHaveText("List: Products");
    await expect(page.locator("#pRepeatPath").locator("option", { hasText: "Keine Liste" })).toHaveCount(1);
    await expect(page.locator("#pRepeatPreview")).toContainText("Showing one item for each Products entry");
    await expect(page.locator("#pRepeatAdvancedCard")).toHaveJSProperty("open", false);
    await expect(page.locator(".data-wire-render-panel")).toContainText("Listeninhalt");
    await expect(page.locator(".data-wire-more")).toHaveJSProperty("open", false);

    await page.locator(".data-wire-quick").getByRole("button", { name: "Title" }).click();

    await expect(dataRenderRows(page).filter({ hasText: "Feld: Title" })).toBeVisible();
    await expect(appFrame(page).getByRole("heading", { name: "Ada Chair" })).toBeVisible();
    await expect(appFrame(page).getByRole("heading", { name: "Linus Desk" })).toBeVisible();
    await expect.poll(async () => {
      const stored = await savedModel(page);
      const state = stored.states.find(item => item.id === "state_3");
      return {
        repeat: state.repeat,
        dataWires: state.dataWires.map(wire => ({
          sourcePath: wire.sourcePath,
          scopePath: wire.scopePath,
          itemPath: wire.itemPath,
          role: wire.role
        })),
        components: state.components
      };
    }).toEqual({
      repeat: { path: "products", as: "item", index: "i", manual: true },
      dataWires: [{
        sourcePath: "products.title",
        scopePath: "products",
        itemPath: "title",
        role: "title"
      }],
      components: []
    });
  });

  test("does not rehydrate deleted fetch render mappings from repeat defaults @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "No automap",
      initial: "state_3",
      states: [{
        id: "state_3",
        title: "State 3",
        body: "",
        x: 220,
        y: 220,
        components: [],
        data: {
          "states.state_3.fetch": {
            data: [{
              image: "https://example.com/product.png",
              title: "Ada Chair",
              price: 42,
              description: "Compact and sturdy"
            }]
          }
        },
        dataSource: { url: "https://example.com/products.json", target: "states.state_3.fetch", select: "" },
        repeat: { path: "states.state_3.fetch.data", as: "item", index: "i" },
        subscriptions: ["states.state_3.fetch.data"],
        dataWires: []
      }],
      transitions: []
    };
    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(`${key}.editor`, JSON.stringify({ model }));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    await openStateInspector(page, "state_3");

    await expect(dataRenderRows(page)).toHaveCount(0);
    await expect(page.locator("#pDataWireList .data-wire-row")).toHaveCount(0);
    await expect.poll(async () => {
      const stored = await savedModel(page);
      return stored.states.find(state => state.id === "state_3")?.dataWires?.length || 0;
    }).toBe(0);

    await page.locator("#pTitle").fill("Still empty");
    await expect.poll(async () => {
      const stored = await savedModel(page);
      return stored.states.find(state => state.id === "state_3")?.dataWires?.length || 0;
    }).toBe(0);
  });

  test("keeps data-wire paths and render order editable from the render list @smoke", async ({ page }) => {
    const imageUrl = "https://example.com/original.png";
    const altImageUrl = "https://example.com/alt.png";
    const model = {
      version: 2,
      name: "Render mapping editor",
      initial: "state_3",
      states: [{
        id: "state_3",
        title: "State 3",
        body: "",
        x: 220,
        y: 220,
        data: {
          catalog: {
            item: {
              image: imageUrl,
              altImage: altImageUrl,
              images: [{ url: "https://example.com/from-array.png" }],
              title: "Ada Chair",
              price: "$42",
              description: "Compact and sturdy",
              category: "Furniture",
              badge: "New"
            }
          }
        },
        subscriptions: ["catalog.item"],
        dataWires: [
          { id: "wire_image", sourcePath: "catalog.item.image", role: "image", componentType: "image", label: "Image" },
          { id: "wire_title", sourcePath: "catalog.item.title", role: "title", componentType: "heading", label: "Title" },
          { id: "wire_price", sourcePath: "catalog.item.price", role: "price", componentType: "text", label: "Price" },
          { id: "wire_description", sourcePath: "catalog.item.description", role: "description", componentType: "text", label: "Description" },
          { id: "wire_category", sourcePath: "catalog.item.category", role: "field", componentType: "text", label: "Category" }
        ]
      }],
      transitions: []
    };
    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(`${key}.editor`, JSON.stringify({ model }));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    await openStateInspector(page, "state_3");

    await expect(appFrame(page).locator(".component-image")).toHaveAttribute("src", imageUrl);
    const addRenderSelect = page.locator('.data-wire-render-panel select[aria-label="Sichtbares Feld hinzufuegen"]');
    await expect(addRenderSelect.locator('option[value="catalog.item.badge"]')).toHaveCount(1);
    await addRenderSelect.selectOption("catalog.item.badge");
    await page.locator(".data-wire-render-panel").getByRole("button", { name: "Ausgewaehltes Feld anzeigen" }).click();
    await expect.poll(async () => {
      const stored = await savedModel(page);
      return stored.states.find(state => state.id === "state_3").dataWires.map(wire => wire.sourcePath);
    }).toContain("catalog.item.badge");

    const renderRows = await expandDataRenderRows(page);
    await expect(renderRows).toHaveCount(6);
    const renderPathSelect = renderRows.first().locator('select[aria-label="Quellpfad"]');
    await expect(renderPathSelect.locator('option[value="catalog.item.images.0.url"]')).toHaveCount(1);
    await renderPathSelect.selectOption("catalog.item.altImage");
    await expect(appFrame(page).locator(".component-image")).toHaveAttribute("src", altImageUrl);
    await expect.poll(async () => {
      const stored = await savedModel(page);
      const state = stored.states.find(item => item.id === "state_3");
      return state.dataWires.find(wire => wire.id === "wire_image")?.sourcePath;
    }).toBe("catalog.item.altImage");

    await expect(page.locator("#pDataWireList")).toHaveCount(0);
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    const refreshedRenderRows = dataRenderRows(page);
    const targetBox = await visibleBox(refreshedRenderRows.nth(5));
    await refreshedRenderRows.first().locator(".component-drag-handle").dispatchEvent("dragstart", { dataTransfer, bubbles: true, cancelable: true });
    await refreshedRenderRows.nth(5).dispatchEvent("dragover", {
      dataTransfer,
      bubbles: true,
      cancelable: true,
      clientY: targetBox.y + targetBox.height - 4
    });
    await refreshedRenderRows.nth(5).dispatchEvent("drop", {
      dataTransfer,
      bubbles: true,
      cancelable: true,
      clientY: targetBox.y + targetBox.height - 4
    });
    await expect.poll(async () => {
      const stored = await savedModel(page);
      return stored.states.find(state => state.id === "state_3").dataWires.map(wire => wire.sourcePath);
    }).toEqual(["catalog.item.title", "catalog.item.price", "catalog.item.description", "catalog.item.category", "catalog.item.badge", "catalog.item.altImage"]);
  });

  test("keeps visible ports in a single svg coordinate system @smoke", async ({ page }) => {
    await openTool(page);

    await expect(page.locator(".node > .input-port, .node > .port, .port-slot")).toHaveCount(0);
    await expect.poll(async () => page.locator("svg#ports .svg-port").count()).toBeGreaterThan(0);
    await expect(page.locator("svg#ports .edge-pin").first()).toBeVisible();

    const report = await page.evaluate(() => {
      const nums = value => (value.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      const pathPoints = value => {
        const values = nums(value);
        const points = [];
        for (let i = 0; i < values.length; i += 2) points.push({ x: values[i], y: values[i + 1] });
        return points;
      };
      return [...document.querySelectorAll(".edge[data-edge-id]")].map(edge => {
        const points = pathPoints(edge.getAttribute("d") || "");
        const pins = [...document.querySelectorAll('.edge-pin[data-edge-id="' + CSS.escape(edge.dataset.edgeId) + '"]')].map(pin => ({
          side: pin.dataset.edgePin,
          x: Number(pin.getAttribute("cx")),
          y: Number(pin.getAttribute("cy"))
        }));
        return { id: edge.dataset.edgeId, points, pins };
      });
    });

    expect(report.length).toBeGreaterThan(0);
    for (const edge of report) {
      const start = edge.points[0];
      const end = edge.points[edge.points.length - 1];
      const outPin = edge.pins.find(pin => pin.side === "out");
      const inPin = edge.pins.find(pin => pin.side === "in");
      expect(outPin).toMatchObject(start);
      expect(inPin).toMatchObject(end);
      for (let index = 1; index < edge.points.length; index += 1) {
        const previous = edge.points[index - 1];
        const point = edge.points[index];
        expect(previous.x === point.x || previous.y === point.y).toBe(true);
      }
    }
  });

  test("exports individual state components, presets, and full definitions with presets", async ({ page }) => {
    await openTool(page);

    await page.locator('[data-id="login"]').click();
    const stateDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export component" }).click();
    const stateExport = JSON.parse(fs.readFileSync(await (await stateDownload).path(), "utf8"));
    expect(stateExport.kind).toBe("state-blueprint-component");
    expect(stateExport.component.type).toBe("state");
    expect(stateExport.component.state.id).toBe("login");
    expect(stateExport.component.state.title).toBe("Login");

    await addComponentState(page, "Note");
    await page.locator("#pTitle").fill("Portable component");
    await componentEditor(page, "Note").locator("textarea").fill("Reusable note");
    const portableId = await page.locator(".node.selected").getAttribute("data-id");
    await dragNodeToStateExplorer(page, page.locator(`[data-id="${portableId}"]`));

    const presetDownload = page.waitForEvent("download");
    await page.locator("#pTemplateExport").click();
    const presetExport = JSON.parse(fs.readFileSync(await (await presetDownload).path(), "utf8"));
    expect(presetExport.kind).toBe("state-blueprint-component");
    expect(presetExport.component.type).toBe("preset");
    expect(presetExport.component.template.title).toBe("Portable component");
    expect(presetExport.component.template).not.toHaveProperty("body");
    expect(presetExport.component.template.components[0].text).toBe("Reusable note");

    const definitionDownload = page.waitForEvent("download");
    await page.keyboard.press("Control+S");
    const definition = JSON.parse(fs.readFileSync(await (await definitionDownload).path(), "utf8"));
    expect(definition.kind).toBe("state-blueprint-definition");
    expect(definition.stateTemplates).toHaveLength(1);
    expect(definition.stateTemplates[0].title).toBe("Portable component");
    expect(definition.stateTemplates[0]).not.toHaveProperty("body");
    expect(definition.stateTemplates[0].components[0].text).toBe("Reusable note");
  });

  test("imports state components and presets without losing render mappings @smoke", async ({ page }) => {
    await openTool(page);

    const stateComponent = {
      kind: "state-blueprint-component",
      schemaVersion: 1,
      app: "Zustand",
      exportedAt: "2026-06-23T00:00:00.000Z",
      component: {
        type: "state",
        state: {
          id: "portable_state",
          title: "Portable State",
          body: "",
          components: [{ id: "portable_text", type: "text", text: "Portable text", url: "" }],
          data: {},
          dataSource: { url: "", target: "fetch", select: "", timeoutMs: 8000, retries: 2 },
          repeat: { path: "", as: "item", index: "i" },
          dataWires: [],
          subscriptions: [],
          boundary: { entryId: "", exitId: "", entryDisabled: false, exitDisabled: false },
          x: 120,
          y: 160
        }
      }
    };

    await openStateInspector(page, "login");
    await page.locator("#pImportState").scrollIntoViewIfNeeded();
    let chooser = page.waitForEvent("filechooser");
    await page.locator("#pImportState").click();
    await (await chooser).setFiles({
      name: "portable-state.state-component.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(stateComponent))
    });
    await expect(nodeByTitle(page, "Portable State")).toBeVisible();
    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.some(state => state.title === "Portable State");
    }).toBe(true);

    const presetComponent = {
      kind: "state-blueprint-component",
      schemaVersion: 1,
      app: "Zustand",
      exportedAt: "2026-06-23T00:00:00.000Z",
      component: {
        type: "preset",
        template: {
          id: "portable_fetch",
          rootStateId: "portable_fetch",
          title: "Portable Fetch",
          body: "",
          components: [
            { id: "slot_title", type: "dataWire", wireId: "wire_title", text: "", url: "" },
            {
              id: "portable_list",
              type: "list",
              text: "First\nDocs",
              url: "",
              items: [
                { id: "li_first", type: "text", text: "First", url: "" },
                { id: "li_docs", type: "link", text: "Docs", url: "https://example.com/docs" }
              ]
            }
          ],
          data: {},
          dataSource: { url: "", target: "states.portable_fetch.fetch", select: "", timeoutMs: 8000, retries: 2 },
          repeat: { path: "states.portable_fetch.fetch.data", as: "item", index: "i" },
          dataWires: [
            { id: "wire_title", sourcePath: "states.portable_fetch.fetch.data.title", scopePath: "states.portable_fetch.fetch.data", itemPath: "title", role: "title", componentType: "heading", label: "Title" }
          ],
          subscriptions: ["states.portable_fetch.fetch.data.title"],
          boundary: { entryId: "", exitId: "", entryDisabled: false, exitDisabled: false },
          states: [],
          transitions: []
        }
      }
    };

    await page.locator("#pImportState").scrollIntoViewIfNeeded();
    chooser = page.waitForEvent("filechooser");
    await page.locator("#pImportState").click();
    await (await chooser).setFiles({
      name: "portable-fetch.state-component.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(presetComponent))
    });
    await expect(page.locator("#stateInspectorTitle")).toHaveText("Vorlage: Portable Fetch");
    await expect.poll(async () => {
      const templates = await savedStateTemplates(page);
      const imported = templates.find(template => template.title === "Portable Fetch");
      const portableList = imported?.components?.find(component => component.id === "portable_list");
      return {
        dataWire: imported?.dataWires?.[0]?.sourcePath || "",
        subscription: imported?.subscriptions?.[0] || "",
        boundary: imported?.boundary?.entryDisabled,
        renderWire: imported?.components?.find(component => component.type === "dataWire")?.wireId || "",
        listItemTypes: portableList?.items?.map(item => item.type) || []
      };
    }).toEqual({
        dataWire: "states.portable_fetch.fetch.data.title",
        subscription: "states.portable_fetch.fetch.data.title",
      boundary: false,
      renderWire: "wire_title",
      listItemTypes: ["text", "link"]
    });

    await page.locator("#pTemplateUse").click();
    await expect(nodeByTitle(page, "Portable Fetch")).toBeVisible();
    await expect.poll(async () => {
      const model = await savedModel(page);
      const imported = model.states.find(state => state.title === "Portable Fetch");
      const portableList = imported?.components?.find(component => component.type === "list");
      return {
        dataWire: imported?.dataWires?.[0]?.sourcePath || "",
        renderWire: imported?.components?.find(component => component.type === "dataWire")?.wireId || "",
        listItemTypes: portableList?.items?.map(item => item.type) || []
      };
    }).toEqual({
      dataWire: "states.portable_fetch.fetch.data.title",
      renderWire: "wire_title",
      listItemTypes: ["text", "link"]
    });
  });

  test("reorders component rows with the editor drag handle @smoke", async ({ page }) => {
    await openTool(page);
    await page.evaluate(() => {
      const state = model.states.find(item => item.id === "login");
      state.components = [
        { id: "component_heading", type: "heading", text: "Heading", url: "" },
        { id: "component_text", type: "text", text: "Text", url: "" },
        { id: "component_note", type: "note", text: "Note", url: "" }
      ];
      saveModel("test:component-order");
      draw();
    });
    await openStateInspector(page, "login");
    await expect.poll(() => page.locator(".component-editor").evaluateAll(rows =>
      rows.every(row => row.querySelector(".component-editor-actions")?.lastElementChild?.classList.contains("component-drag-handle"))
    )).toBe(true);

    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    const targetBox = await visibleBox(componentEditor(page, "Note"));
    await componentEditor(page, "Heading").locator(".component-drag-handle").dispatchEvent("dragstart", {
      dataTransfer,
      bubbles: true,
      cancelable: true
    });
    await componentEditor(page, "Note").dispatchEvent("dragover", {
      dataTransfer,
      bubbles: true,
      cancelable: true,
      clientY: targetBox.y + targetBox.height - 4
    });
    await componentEditor(page, "Note").dispatchEvent("drop", {
      dataTransfer,
      bubbles: true,
      cancelable: true,
      clientY: targetBox.y + targetBox.height - 4
    });

    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.id === "login").components
        .filter(component => component.type !== "transitionButton")
        .map(component => component.id);
    }).toEqual(["component_text", "component_note", "component_heading"]);
  });

  test("reorders component rows with a touch long press in the state editor @smoke", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://localhost:8124",
      viewport: { width: 900, height: 820 },
      hasTouch: true
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__STATE_BLUEPRINT_VIBRATIONS = [];
      Object.defineProperty(navigator, "vibrate", {
        configurable: true,
        value(pattern) {
          window.__STATE_BLUEPRINT_VIBRATIONS.push(pattern);
          return true;
        }
      });
    });
    await openTool(page);
    await page.evaluate(() => {
      const state = model.states.find(item => item.id === "login");
      state.components = [
        { id: "component_heading", type: "heading", text: "Heading", url: "" },
        { id: "component_text", type: "text", text: "Text", url: "" },
        { id: "component_note", type: "note", text: "Note", url: "" }
      ];
      saveModel("test:component-touch-order");
      draw();
    });
    await openStateInspector(page, "login");

    const source = componentEditor(page, "Text");
    const target = componentEditor(page, "Note");
    const sourceBox = await visibleBox(source.locator(".component-editor-summary"));
    const targetBox = await visibleBox(target);
    const start = { x: sourceBox.x + 18, y: sourceBox.y + sourceBox.height / 2 };
    const end = { x: targetBox.x + 18, y: targetBox.y + targetBox.height - 3 };
    await source.locator(".component-editor-summary").dispatchEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerType: "touch",
      pointerId: 803,
      clientX: start.x,
      clientY: start.y
    });
    await expect(source).toHaveClass(/touch-reorder-ready/, { timeout: 900 });
    await expect.poll(() => page.evaluate(() => window.__STATE_BLUEPRINT_VIBRATIONS || [])).toEqual([12]);
    await page.evaluate(({ point }) => {
      window.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        pointerType: "touch",
        pointerId: 803,
        clientX: point.x,
        clientY: point.y
      }));
    }, { point: end });
    await expect(target).toHaveClass(/drop-after/);
    await page.evaluate(({ point }) => {
      window.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerType: "touch",
        pointerId: 803,
        clientX: point.x,
        clientY: point.y
      }));
    }, { point: end });

    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.id === "login").components
        .filter(component => component.type !== "transitionButton")
        .map(component => component.id);
    }).toEqual(["component_heading", "component_note", "component_text"]);
    await context.close();
  });

  test("shows outgoing transition buttons in the render editor without mutating components @smoke", async ({ page }) => {
    await openTool(page);
    await openStateInspector(page, "auth_start");

    await expect(componentEditor(page, "Text")).toBeVisible();
    await expect(componentEditor(page, "Button: Login")).toBeVisible();
    await expect(componentEditor(page, "Button: Registrieren")).toBeVisible();

    const editorButtonColorFor = async transitionId => page
      .locator(`.component-editor[data-transition-id="${transitionId}"]`)
      .evaluate(el => getComputedStyle(el).getPropertyValue("--transition-button-color").trim());
    const edgeColorFor = async transitionId => {
      const edge = page.locator(`.edge[data-edge-id="${transitionId}"]`);
      await expect(edge).toHaveCount(1);
      return edge.evaluate(el => getComputedStyle(el).getPropertyValue("--edge-color").trim());
    };
    await expect.poll(() => editorButtonColorFor("t_auth_login")).toBe(await edgeColorFor("t_auth_login"));
    await expect.poll(() => editorButtonColorFor("t_auth_register")).toBe(await edgeColorFor("t_auth_register"));

    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.id === "auth_start").components.map(component => component.type);
    }).toEqual(["text"]);
  });

  test("persists dragged transition buttons as render items and renders them in order @smoke", async ({ page }) => {
    await openTool(page);
    await openStateInspector(page, "auth_start");

    await dragComponentEditorBefore(page, "Button: Login", "Text");

    await expect.poll(async () => {
      const model = await savedModel(page);
      return model.states.find(state => state.id === "auth_start").components.map(component =>
        component.type === "transitionButton" ? component.transitionId : component.type
      );
    }).toEqual(["t_auth_login", "text", "t_auth_register"]);

    await expect.poll(async () => appFrame(page).locator("#screen").evaluate(screen => {
      const stack = screen.querySelector(".component-stack");
      return [...(stack?.children || [])].map(child =>
        child.querySelector("button[data-transition-id]")?.dataset.transitionId || child.textContent.trim()
      );
    })).toEqual(["t_auth_login", "User chooses login or registration.", "t_auth_register"]);

    const previewButtonColors = await appFrame(page).locator("button[data-transition-id]").evaluateAll(buttons => Object.fromEntries(
      buttons.map(button => {
        const style = getComputedStyle(button);
        return [
          button.dataset.transitionId,
          {
            color: style.getPropertyValue("--button-color").trim(),
            strong: style.getPropertyValue("--button-color-strong").trim(),
            backgroundImage: style.backgroundImage
          }
        ];
      })
    ));
    const edgeColorFor = async transitionId => {
      const edge = page.locator(`.edge[data-edge-id="${transitionId}"]`);
      await expect(edge).toHaveCount(1);
      return edge.evaluate(el => getComputedStyle(el).getPropertyValue("--edge-color").trim());
    };
    const edgeColors = {
      t_auth_login: await edgeColorFor("t_auth_login"),
      t_auth_register: await edgeColorFor("t_auth_register")
    };
    for (const [transitionId, edgeColor] of Object.entries(edgeColors)) {
      expect(previewButtonColors[transitionId].color).toBe(edgeColor);
      expect(previewButtonColors[transitionId].strong).toBe(edgeColor);
      expect(previewButtonColors[transitionId].backgroundImage).toBe("none");
    }
  });

  test("projects parent outs at child exit without a hidden child-to-parent return @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "Parent out render order",
      initial: "parent",
      states: [
        {
          id: "parent",
          title: "Parent",
          body: "",
          components: [{ id: "parent_text", type: "text", text: "Parent copy", url: "" }],
          boundary: { entryId: "entry", exitId: "entry", entryDisabled: false, exitDisabled: false },
          x: 180,
          y: 180
        },
        { id: "entry", title: "Entry", body: "", components: [], parentId: "parent", x: 140, y: 140 },
        { id: "target_a", title: "Target A", body: "", components: [], x: 520, y: 100 },
        { id: "target_b", title: "Target B", body: "", components: [], x: 520, y: 260 }
      ],
      transitions: [
        { id: "t_parent_a", from: "parent", to: "target_a", label: "Out A", condition: "", triggerType: "button", set: {} },
        { id: "t_parent_b", from: "parent", to: "target_b", label: "Out B", condition: "", triggerType: "button", set: {} }
      ]
    };
    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    await expect(page.locator('[data-id="parent"]')).toBeVisible();
    await openStateInspector(page, "parent");

    await expect(componentEditor(page, "Text")).toBeVisible();
    await expect(componentEditor(page, "Button: Entry")).toBeVisible();
    await expect(componentEditor(page, "Button: Out A")).toHaveCount(0);
    await expect(componentEditor(page, "Button: Out B")).toHaveCount(0);

    const app = appFrame(page);
    await expect(app.locator("button[data-transition-id]")).toHaveCount(1);
    await expect(app.getByRole("button", { name: "Entry" })).toBeVisible();
    await expect(app.getByRole("button", { name: "Out A" })).toHaveCount(0);
    await expect(app.getByRole("button", { name: "Out B" })).toHaveCount(0);

    const edgeColorFor = async transitionId => {
      const edge = page.locator(`.edge[data-edge-id="${transitionId}"]`);
      await expect(edge).toHaveCount(1);
      return edge.evaluate(el => getComputedStyle(el).getPropertyValue("--edge-color").trim());
    };
    const expectedEdgeColors = {
      t_parent_a: await edgeColorFor("t_parent_a"),
      t_parent_b: await edgeColorFor("t_parent_b")
    };

    await app.getByRole("button", { name: "Entry" }).click();
    await expect(app.locator("#statePill")).toHaveText("entry");
    await expect(app.getByRole("button", { name: "Parent" })).toHaveCount(0);
    await expect(app.locator("button[data-transition-id]")).toHaveCount(2);
    await expect(app.getByRole("button", { name: "Entry" })).toHaveCount(0);
    await expect(app.getByRole("button", { name: "Out A" })).toBeVisible();
    await expect(app.getByRole("button", { name: "Out B" })).toBeVisible();

    const previewButtonColors = await app.locator("button[data-transition-id]").evaluateAll(buttons => Object.fromEntries(
      buttons.map(button => {
        const style = getComputedStyle(button);
        return [
          button.dataset.transitionId,
          {
            color: style.getPropertyValue("--button-color").trim(),
            strong: style.getPropertyValue("--button-color-strong").trim()
          }
        ];
      })
    ));
    for (const transitionId of ["t_parent_a", "t_parent_b"]) {
      const edgeColor = expectedEdgeColors[transitionId];
      expect(previewButtonColors[transitionId].color).toBe(edgeColor);
      expect(previewButtonColors[transitionId].strong).toBe(edgeColor);
    }

    await app.getByRole("button", { name: "Out A" }).click();
    await expect(app.locator("#statePill")).toHaveText("target_a");
  });

  test("stops child flow instead of inheriting parent outs without a child output @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "No implicit child exit",
      initial: "child",
      states: [
        {
          id: "parent",
          title: "Parent",
          body: "",
          components: [{ id: "parent_text", type: "text", text: "Parent copy", url: "" }],
          x: 180,
          y: 180
        },
        { id: "child", title: "Child", body: "", components: [], parentId: "parent", x: 140, y: 140 },
        { id: "target", title: "Target", body: "", components: [], x: 520, y: 180 }
      ],
      transitions: [
        { id: "t_parent_out", from: "parent", to: "target", label: "Parent Out", condition: "", triggerType: "button", set: {} }
      ]
    };
    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");

    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("child");
    await expect(app.getByRole("button", { name: "Parent" })).toHaveCount(0);
    await expect(app.getByRole("button", { name: "Parent Out" })).toHaveCount(0);
    await expect(app.locator("button[data-transition-id]")).toHaveCount(0);
  });

  test("persists data-wire render rows between components and transition buttons @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "Mixed render order",
      initial: "state_3",
      states: [
        {
          id: "state_3",
          title: "State 3",
          body: "",
          x: 220,
          y: 220,
          components: [{ id: "manual_note", type: "note", text: "Manual note", url: "" }],
          data: { catalog: { item: { title: "Ada Chair" } } },
          subscriptions: ["catalog.item"],
          dataWires: [
            { id: "wire_title", sourcePath: "catalog.item.title", role: "title", componentType: "heading", label: "Title" }
          ]
        },
        {
          id: "state_done",
          title: "Done",
          body: "",
          x: 520,
          y: 220,
          components: []
        }
      ],
      transitions: [
        { id: "t_next", from: "state_3", to: "state_done", label: "Continue", condition: "", set: {} }
      ]
    };
    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(`${key}.editor`, JSON.stringify({ model }));
    }, { key: STORAGE_KEY, model });
    await page.goto("/state.html");
    await openStateInspector(page, "state_3");

    await expect(componentEditor(page, "Field: Title")).toBeVisible();
    await expect(componentEditor(page, "Note")).toBeVisible();
    await expect(componentEditor(page, "Button: Continue")).toBeVisible();

    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    const noteBox = await visibleBox(componentEditor(page, "Note"));
    await componentEditor(page, "Field: Title").locator(".component-drag-handle").dispatchEvent("dragstart", {
      dataTransfer,
      bubbles: true,
      cancelable: true
    });
    await componentEditor(page, "Note").dispatchEvent("dragover", {
      dataTransfer,
      bubbles: true,
      cancelable: true,
      clientY: noteBox.y + noteBox.height - 4
    });
    await componentEditor(page, "Note").dispatchEvent("drop", {
      dataTransfer,
      bubbles: true,
      cancelable: true,
      clientY: noteBox.y + noteBox.height - 4
    });

    await expect.poll(async () => {
      const stored = await savedModel(page);
      return stored.states.find(state => state.id === "state_3").components.map(component =>
        component.type === "dataWire" ? component.wireId :
          component.type === "transitionButton" ? component.transitionId :
            component.id
      );
    }).toEqual(["manual_note", "wire_title", "t_next"]);

    await expect.poll(async () => appFrame(page).locator("#screen").evaluate(screen => {
      const stack = screen.querySelector(".component-stack");
      return [...(stack?.children || [])].map(child =>
        child.querySelector("button[data-transition-id]")?.dataset.transitionId || child.textContent.trim()
      );
    })).toEqual(["Manual note", "Ada Chair", "t_next"]);
  });

  test("keeps preview controls inside the viewport when opened, collapsed, and narrow", async ({ page }) => {
    await openTool(page);

    await assertVisibleInViewport(page, "#btnOpen");
    await assertVisibleInViewport(page, "#btnTogglePreview");

    await page.locator("#btnTogglePreview").click();
    await assertVisibleInViewport(page, "#btnOpen");
    await assertVisibleInViewport(page, "#btnTogglePreview");

    await page.setViewportSize({ width: 900, height: 760 });
    await page.locator("#btnTogglePreview").click();
    await assertVisibleInViewport(page, "#btnOpen");
    await assertVisibleInViewport(page, "#btnTogglePreview");

    await page.setViewportSize({ width: 390, height: 820 });
    await page.locator('[data-mobile-view="app"]').click();
    await expect(page.locator("#btnOpen")).toBeVisible();
    await expect(page.locator("#btnToggleInspector")).toBeHidden();
    await expect(page.locator("#btnTogglePreview")).toBeHidden();
  });

  test("hides the topbar scrollbar on narrow screens", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 820 });
    await openTool(page);

    const topbar = await page.locator(".topbar").evaluate(el => {
      const style = getComputedStyle(el);
      return {
        overflowX: style.overflowX,
        scrollbarWidth: style.scrollbarWidth
      };
    });
    expect(topbar.overflowX).toBe("auto");
    expect(topbar.scrollbarWidth).toBe("none");
  });

  test("keeps the canvas free of helper and zoom overlays around the state explorer", async ({ page }) => {
    await openTool(page);

    await expect(page.locator(".help")).toHaveCount(0);
    await expect(page.locator(".zoom-controls")).toHaveCount(0);
    await expect(page.locator(".state-explorer-label")).toHaveCount(0);
    await expect(page.locator('.state-explorer-section[data-template-category="website"]')).toBeVisible();
    await expect(page.locator('.state-explorer-section[data-template-group="core"]')).toHaveCount(5);
    await expect(page.locator('.state-explorer-section[data-template-group="user"]')).toBeVisible();
    await expect(componentPreset(page, "Textblock").getByRole("button", { name: "Löschen" })).toHaveCount(0);
    await assertVisibleInViewport(page, "#stateExplorer");
    await assertVisibleInViewport(page, "#btnToggleStateExplorer");
    await expect(page.locator("#stateExplorerList")).toHaveCSS("scrollbar-color", "rgb(49, 95, 140) rgb(7, 19, 33)");
    await expect(page.locator("#stateExplorerList")).toHaveCSS("scrollbar-width", "thin");

    await page.locator("#btnToggleStateExplorer").click();
    await expect(page.locator("#stateExplorer")).toHaveClass(/collapsed/);
    await assertVisibleInViewport(page, "#stateExplorer");
    await assertVisibleInViewport(page, "#btnToggleStateExplorer");
  });

  test("downloads formal definitions and self-contained HTML exports", async ({ page }) => {
    await openTool(page);

    const saveDownload = page.waitForEvent("download");
    await page.keyboard.press("Control+S");
    const definitionDownload = await saveDownload;
    const definitionPath = await definitionDownload.path();
    const definition = JSON.parse(fs.readFileSync(definitionPath, "utf8"));

    expect(definition.kind).toBe("state-blueprint-definition");
    expect(definition.schemaVersion).toBe(2);
    expect(definition.model.states).toHaveLength(6);
    expect(definition.model.transitions.length).toBeGreaterThan(0);

    const exportDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "HTML exportieren" }).click();
    const htmlDownload = await exportDownload;
    const htmlPath = await htmlDownload.path();
    const html = fs.readFileSync(htmlPath, "utf8");

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("const IS_STANDALONE_EXPORT = true");
    expect(html).toContain("let model = normalizeModel(JSON.parse(JSON.stringify(EXPORTED_STATE_BLUEPRINT)));");
    expect(html).not.toContain("let model = loadModel() || blankModel();");
    expect(html).toContain("Standard Auth Flow");
    expect(html).toContain("color-scheme: dark");
    expect(html).toContain("--bg: #020617");
    expect(html).toContain("--primary: #38bdf8");
    expect(html).toContain("Atkinson Hyperlegible");
    expect(html).not.toContain("--card: #ffffff");
    expect(html).not.toContain("background: white");
    expect(html).not.toContain("speechRate");
    expect(html).not.toContain("Vorlesen");
    expect(html).not.toContain("SpeechSynthesis");

    const standalone = await page.context().newPage();
    const pageErrors = [];
    standalone.on("pageerror", error => pageErrors.push(error.message));
    await standalone.setContent(html, { waitUntil: "domcontentloaded" });
    await expect(standalone.locator("#statePill")).toHaveText("auth_start");
    expect(pageErrors).toEqual([]);
    await standalone.close();
  });

  test("roundtrips saved definitions through load and restores the active model @smoke", async ({ page }, testInfo) => {
    const sourceModel = {
      version: 2,
      name: "Save Load Roundtrip",
      initial: "round_start",
      states: [
        {
          id: "round_start",
          title: "Roundtrip Start",
          body: "",
          x: 120,
          y: 180,
          data: {
            "states.round_start": {
              current: "draft",
              enabled: true
            }
          },
          dataTypes: {
            "states.round_start.current": "text",
            "states.round_start.enabled": "boolean"
          },
          components: [
            { id: "round_heading", type: "heading", text: "Loaded from disk", url: "" },
            { id: "transition-button:round_continue", type: "transitionButton", transitionId: "round_continue" },
            { id: "round_note", type: "note", text: "Scoped global-state data survives save/load.", url: "" }
          ]
        },
        {
          id: "round_done",
          title: "Roundtrip Done",
          body: "",
          x: 460,
          y: 180,
          data: {},
          dataTypes: {},
          components: [{ id: "round_done_text", type: "text", text: "The loaded transition still works.", url: "" }]
        }
      ],
      transitions: [
        {
          id: "round_continue",
          from: "round_start",
          to: "round_done",
          label: "Continue saved",
          condition: "",
          set: { "states.round_start.current": "done" }
        }
      ]
    };
    const replacementModel = {
      version: 2,
      name: "Wrong Model",
      initial: "wrong_state",
      states: [
        {
          id: "wrong_state",
          title: "Wrong model",
          body: "",
          x: 160,
          y: 180,
          data: {},
          dataTypes: {},
          components: [{ id: "wrong_text", type: "text", text: "This model must be replaced by Load.", url: "" }]
        }
      ],
      transitions: []
    };

    await page.addInitScript(({ key, model }) => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }      localStorage.setItem(key, JSON.stringify(model));
    }, { key: STORAGE_KEY, model: sourceModel });
    await page.goto("/state.html");
    await expect(page.locator('[data-id="round_start"]')).toBeVisible();
    await expect(appFrame(page).locator("#statePill")).toHaveText("round_start");
    const expectedModel = await page.evaluate(() => JSON.parse(JSON.stringify(definitionPayload().model)));

    const saveDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Speichern" }).click();
    const definitionDownload = await saveDownload;
    const roundtripPath = testInfo.outputPath("save-load-roundtrip.state.json");
    await definitionDownload.saveAs(roundtripPath);
    const definition = JSON.parse(fs.readFileSync(roundtripPath, "utf8"));
    expect(definition.kind).toBe("state-blueprint-definition");
    expect(definition.schemaVersion).toBe(2);
    expect(definition.model).toEqual(expectedModel);

    await page.evaluate(nextModel => loadEditorModel(nextModel, true), replacementModel);
    await expect(page.locator('[data-id="wrong_state"]')).toBeVisible();
    await expect(page.locator('[data-id="round_start"]')).toHaveCount(0);
    await expect(appFrame(page).locator("#statePill")).toHaveText("wrong_state");

    await page.locator("#fileLoad").setInputFiles(roundtripPath);
    await expect.poll(async () => page.evaluate(() => JSON.parse(JSON.stringify(definitionPayload().model)))).toEqual(expectedModel);
    await expect(page.locator('[data-id="round_start"]')).toBeVisible();
    await expect(page.locator('[data-id="round_done"]')).toBeVisible();
    await expect(page.locator('[data-id="wrong_state"]')).toHaveCount(0);
    await expect(appFrame(page).locator("#statePill")).toHaveText("round_start");
    await expect(appFrame(page).getByRole("heading", { name: "Roundtrip Start" })).toBeVisible();
    await expect(appFrame(page).getByRole("button", { name: "Continue saved" })).toBeVisible();

    await appFrame(page).getByRole("button", { name: "Continue saved" }).click();
    await expect(appFrame(page).locator("#statePill")).toHaveText("round_done");
    await expect.poll(async () => runtimeContext(page)).toMatchObject({
      states: {
        round_start: {
          current: "done",
          enabled: true
        }
      }
    });
  });

  test("downloads a valid formal definition from a blank canvas @smoke", async ({ page }) => {
    await page.addInitScript(key => {
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
    }, STORAGE_KEY);
    await page.goto("/state.html");
    await expect(page.locator(".node:not(.boundary-proxy)")).toHaveCount(0);

    const saveDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Speichern" }).click();
    const definition = JSON.parse(fs.readFileSync(await (await saveDownload).path(), "utf8"));
    expect(definition.kind).toBe("state-blueprint-definition");
    expect(definition.model.initial).toBe("");
    expect(definition.model.states).toEqual([]);
    expect(definition.model.transitions).toEqual([]);
  });
});
