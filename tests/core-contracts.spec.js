const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const STORAGE_KEY = "stateBlueprintHotLinked.model.v2";

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
function stateHtml() {
  return fs.readFileSync(path.join(process.cwd(), "state.html"), "utf8");
}

function extractJsString(source, declaration) {
  const marker = `${declaration} = "`;
  const start = source.indexOf(marker);
  expect(start, `${declaration} string exists`).toBeGreaterThanOrEqual(0);

  let raw = "";
  let escaped = false;
  for (let index = start + marker.length; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      raw += "\\" + char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") return JSON.parse(`"${raw}"`);
    raw += char;
  }
  throw new Error(`Could not find closing quote for ${declaration}`);
}

function generatedAppHtml() {
  return extractJsString(stateHtml(), "const APP_HTML");
}

function appFrame(page) {
  return page.frameLocator("#appFrame");
}

async function generatedPreviewHtml(page) {
  await page.waitForSelector('#appFrame[src^="blob:"]');
  return page.evaluate(async () => {
    const src = document.querySelector("#appFrame")?.src || "";
    return src ? fetch(src, { cache: "no-store" }).then(response => response.text()) : "";
  });
}

async function transitionButtonStyles(frameLocator) {
  return frameLocator.locator("button[data-transition-id]").evaluateAll(buttons => Object.fromEntries(
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

async function openTool(page) {
  await page.addInitScript(({ key, model }) => {
    for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
      localStorage.removeItem(name);
    }
    localStorage.setItem(key, JSON.stringify(model));
  }, { key: STORAGE_KEY, model: defaultTestModel() });
  await page.goto("/state.html");
  await expect(page.locator('[data-id="auth_start"]')).toBeVisible();
}

async function openWithModel(page, model) {
  await page.addInitScript(({ key, model }) => {
    for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
      localStorage.removeItem(name);
    }
    localStorage.setItem(key, JSON.stringify(model));
  }, { key: STORAGE_KEY, model });
  await page.goto("/state.html");
  await expect(appFrame(page).locator("#statePill")).toHaveText(model.initial);
}

async function savedModel(page) {
  return page.evaluate(key => {
    const stored = JSON.parse(localStorage.getItem(`${key}.editor`) || localStorage.getItem(key) || "null");
    return stored?.model || stored || null;
  }, STORAGE_KEY);
}

async function runtimeContext(page) {
  return page.evaluate(() => JSON.parse(JSON.stringify(
    typeof latestRuntimeContext !== "undefined" && latestRuntimeContext ? latestRuntimeContext : {}
  )));
}

function collectUndefinedPaths(value, root = "$") {
  if (typeof value === "undefined") return [root];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectUndefinedPaths(item, `${root}[${index}]`));
  }
  return Object.entries(value).flatMap(([key, item]) => collectUndefinedPaths(item, `${root}.${key}`));
}

async function openLayer(page, parentId, visibleChildId) {
  await page.evaluate(id => {
    enterStateLayer(id, { source: "inspector", explicit: true, force: true });
  }, parentId);
  await expect(page.locator(`[data-id="${visibleChildId}"]`)).toBeVisible();
}

test.describe("Core source contracts", () => {
  test("APP_HTML string keeps nested script end tags escaped @smoke", () => {
    const html = stateHtml();
    const marker = 'const APP_HTML = "';
    const start = html.indexOf(marker);
    expect(start, "APP_HTML declaration exists").toBeGreaterThanOrEqual(0);
    const appUrlIndex = html.indexOf('const APP_URL', start);
    expect(appUrlIndex, "APP_URL follows APP_HTML").toBeGreaterThan(start);
    const rawLiteral = html.slice(start, appUrlIndex);

    expect(rawLiteral).toContain('<\\/script>');
    expect(rawLiteral).not.toContain('</script>');
  });

  test("generated self-contained app script stays syntactically valid @smoke", () => {
    const appHtml = generatedAppHtml();
    const scripts = [...appHtml.matchAll(/<script>\s*([\s\S]*?)<\/script>/gi)].map(match => match[1]);

    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      expect(() => new Function(script)).not.toThrow();
    }
  });

  test("state tool text stays UTF-8 clean @smoke", () => {
    const html = stateHtml();
    const mojibakePattern = new RegExp("[\\u00c2\\u00c3\\ufffd]|\\u00e2(?:[\\u0080-\\u00bf]|[^\\x00-\\x7f])");

    expect(html).not.toMatch(mojibakePattern);
  });

  test("generated blank runtime starts without editor-only helpers @smoke", async ({ page }) => {
    await page.goto("/state.html");
    await page.evaluate(key => localStorage.removeItem(key), STORAGE_KEY);

    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));

    const appUrl = await page.evaluate(html => URL.createObjectURL(new Blob([html], { type: "text/html" })), generatedAppHtml());
    await page.goto(appUrl);
    await expect(page.locator("#appName")).toHaveText("Zustand");
    await page.evaluate(() => window.postMessage({
      type: "STATE_BLUEPRINT_MODEL",
      model: {
        name: "Demo Checkout",
        initial: "start",
        states: [{ id: "start", title: "Start", components: [], data: {}, dataTypes: {} }],
        transitions: []
      }
    }, "*"));
    await expect(page.locator("#appName")).toHaveText("Demo Checkout");
    await expect(page.locator("#flowDebug")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test("preview runtime does not ship removed daisy fallback branches @smoke", async ({ page }) => {
    await page.goto("/state.html");
    const appHtml = await generatedPreviewHtml(page);

    expect(appHtml).toContain("function runtimeSupportedDaisyComponent");
    expect(appHtml).toContain('variant === "button"');
    expect(appHtml).toContain('layout === "search-dropdown"');
    expect(appHtml).toContain('layout === "figure-reverse"');
    for (const removed of [
      'variant === "artboard"',
      'variant === "chat-bubble"',
      'variant === "collapse"',
      'variant === "diff"',
      'variant === "join"',
      'variant === "kbd"',
      'variant === "stack"',
      'variant === "swap"',
      'variant === "theme-controller"',
      'variant === "tooltip"',
      'layout === "title-icon"',
      'layout === "icons"',
      'layout === "center-logo"',
      'layout === "colors"',
      ".join,",
      ".join-item",
      ".divider",
      ".chat-bubble",
      ".diff",
      ".stack",
      ".tooltip",
      ".kbd"
    ]) {
      expect(appHtml, `runtime should not contain ${removed}`).not.toContain(removed);
    }
  });

  test("preview runtime keeps host HTML enhancements applied @smoke", async ({ page }) => {
    await page.goto("/state.html");
    const appHtml = await generatedPreviewHtml(page);

    for (const marker of [
      "function runtimeTouchFeedbackTarget(target)",
      'function normalizeDataSource(value, fallbackTarget = "fetch")',
      's.dataSource = normalizeDataSource(s.dataSource, "states." + s.id + ".fetch");',
      ".navbar .flex-none { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex: 0 1 auto; max-width: 100%; min-width: 0; }",
      '.dropdown[data-open="true"] > .dropdown-content.menu {',
      "function runtimeStateUsesWidgetScreen(state)",
      'let lastRenderedStateId = "";',
      "const runtimeViewStateChanged = lastRenderedStateId !== s.id;",
      "scrollRoot.scrollTop = 0;",
      'screen.className = widgetScreen ? "screen widget-screen" : "screen";',
      "function daisyOwnerCanWrite(component)",
      "function appendDaisyLocalActionButton(parent, component, label, onClick, className = \"\")",
      "if (detail?.transitionId && transition?.id !== detail.transitionId) return false;",
      "function daisyExplicitTransitionIds(component)",
      '"navbar", "pricing", "progress"',
      '"columns", "links", "plans"',
      'source: "pricing"',
      'variant === "card" || variant === "hero" || variant === "feature-grid" || variant === "pricing"',
      'source: "feature-grid"',
      "function daisyTransitionSetMatchesComponent(transition, component)",
      "function runtimeClaimedTransitionIdsForState(state, actionTransitions)",
      "const claimedActionTransitionIds = runtimeClaimedTransitionIdsForState(s, actionTransitions);",
      'if (["bottom-navigation", "drawer", "menu", "steps", "tabs"].includes(variant)) return labelsFrom("items");',
      'source: "steps"',
      "return ownerStateId === current;",
      'button.style.setProperty("--button-color-strong", color);',
      'variant === "footer"',
      ".breadcrumbs button.breadcrumb-action",
      "entry.transitionId",
      'source: "breadcrumbs"',
      ".daisy-loading-state { display: grid; place-items: center;",
      'spinner.className = "loading loading-spinner loading-lg";',
      "body { min-height: 100vh; }",
      ".flow-debug-panel",
      "function runtimeFlowDebugEnabled()",
      "function updateRuntimeFlowDebug(payload = {})",
      "updateRuntimeFlowDebug(payload);",
      'typeof IS_STANDALONE_EXPORT !== "undefined" && IS_STANDALONE_EXPORT'
    ]) {
      expect(appHtml, `missing enhanced preview marker: ${marker}`).toContain(marker);
    }
    await expect(appFrame(page).locator("#flowDebug")).toHaveCount(0);

    for (const marker of [
      "function normalizeDataSource(value) {",
      "s.dataSource = normalizeDataSource(s.dataSource);",
      "return activeStateChain(stateById(current)).some(state => state.id === ownerStateId);",
      `.dropdown:hover > .dropdown-content,
    .dropdown:focus-within > .dropdown-content,
    .dropdown[data-open="true"] > .dropdown-content { display: grid; }`,
      'layout === "colors"',
      'variant === "theme-controller"',
      'variant === "join"',
      'loading loading-dots loading-md',
      'daisyWrite(component, "selected", label',
      "return scoped.length ? scoped : transitions;",
      "renderOptions.renderedTransitionIds?.add"
    ]) {
      expect(appHtml, `stale unenhanced preview marker shipped: ${marker}`).not.toContain(marker);
    }
  });

  test("formal definitions reject state and transition id collisions @smoke", async ({ page }) => {
    await page.goto("/state.html");

    const message = await page.evaluate(() => {
      const boundary = { entryId: "", exitId: "", entryDisabled: false, exitDisabled: false, title: "", note: "" };
      const definition = {
        kind: "state-blueprint-definition",
        schemaVersion: 2,
        app: "Zustand",
        savedAt: new Date().toISOString(),
        model: {
          version: 2,
          name: "Collision",
          initial: "start",
          boundary,
          states: [{
            id: "start",
            title: "Start",
            renderMode: "state",
            components: [],
            data: {},
            dataTypes: {},
            dataWires: [],
            subscriptions: [],
            boundary,
            parentId: null,
            x: 96,
            y: 120
          }],
          transitions: [{
            id: "start",
            from: "start",
            to: "start",
            label: "Loop",
            condition: "",
            triggerType: "button",
            triggerEvent: "button.start.clicked",
            timerMs: 3000,
            set: {},
            groupEntryId: "",
            groupExitId: ""
          }]
        },
        stateTemplates: [],
        camera: { x: 32, y: 32, scale: 1 },
        previewCollapsed: false
      };
      try {
        validateBlueprintDefinition(definition);
        return "";
      } catch (error) {
        return String(error?.message || error);
      }
    });

    expect(message).toContain("must not collide with a state id");
  });

  test("preview runtime reads pause state from the global bus without local shadow state @smoke", async ({ page }) => {
    await page.goto("/state.html");
    const appHtml = await generatedPreviewHtml(page);

    expect(appHtml).toContain('runtime: { paused: false }');
    expect(appHtml).toContain("function runtimeIsPaused()");
    expect(appHtml).toContain('readValueAtPath(context, "runtime.paused") === true');
    expect(appHtml).toContain('writeRuntimeState("runtime.paused", next');
    expect(appHtml).toContain("if (runtimeIsPaused()) {");
    expect(appHtml).toContain("paused: runtimeIsPaused(),");
    expect(appHtml).not.toContain("runtimePaused");
    expect(appHtml).not.toContain("if (runtimePaused)");
    expect(appHtml).not.toContain('writeRuntimeState("runtime.paused", runtimePaused');
  });

  test("generated runtime keeps user content clean and event-driven @smoke", () => {
    const appHtml = generatedAppHtml();
    const actionHandler = appHtml.match(/button\.onclick = \(\) => \{[\s\S]*?\n\s*\};/);
    const html = stateHtml();

    expect(appHtml).not.toContain("No outgoing transitions");
    expect(appHtml).not.toContain("Play default chime");
    expect(appHtml).not.toContain("{{");
    expect(html).not.toContain("{{");
    expect(appHtml).toContain("function runtimeDisplayName");
    expect(appHtml).toContain("syncRuntimeAppName();");
    expect(appHtml).toContain("overflow: visible;");
    expect(html).not.toContain("legacyDefaultTransitionEvent");
    expect(html).not.toContain('text: "{{fetch.data}}"');
    expect(html).not.toContain('text: "{{item}}"');
    expect(html).not.toContain('text: "Item: {{item}}"');
    expect(actionHandler?.[0] || "").toContain("emitRuntimeEvent");
    expect(actionHandler?.[0] || "").not.toContain("followTransition");
  });

  test("generated runtime keeps normal Next transitions visible as buttons @smoke", () => {
    const html = stateHtml();
    const appHtml = generatedAppHtml();

    expect(appHtml).toContain("function transitionIsButtonAction");
    expect(appHtml).toContain("function normalizeTransitionTriggerEvent");
    expect(html).toContain("function normalizeTransitionTriggerEvent");
    expect(appHtml).toContain('if (triggerType === "event") return "event." + eventSegment');
    expect(html).toContain('if (triggerType === "event") return "event." + eventSegment');
    expect(appHtml).toContain("function runtimeOrderActionTransitionsForState");
    expect(appHtml).toContain("const actionTransitions = runtimeOrderActionTransitionsForState(s, transitions.filter(transitionIsButtonAction));");
    expect(appHtml).toContain('return type === "button";');
    expect(html).toContain('return type === "button";');
    expect(appHtml).not.toContain('return type === "event" && /^button');
    expect(html).not.toContain('return type === "event" && /^button');
    expect(html).not.toContain("runtimeNextSiblingTransition");
    expect(html).not.toContain("runtimeOutgoingJs");
    expect(appHtml).not.toContain("runtimeNextSiblingTransition");
    expect(appHtml).not.toContain("__runtime_next_child");
    expect(html).toContain("function defaultTransitionLabel");
    expect(html).toContain("label: defaultTransitionLabel({ from: connecting.from, to: targetId })");
    expect(html).toContain("function transitionColorInLayer");
    expect(html).toContain("function actionTransitionColor");
    expect(html).toContain('item.classList.add("transition-button-render")');
    expect(html).toContain('item.style.setProperty("--transition-button-color", actionTransitionColor(actionTransition, s))');
    expect(appHtml).toContain("function runtimeTransitionLabel");
    expect(appHtml).toContain("button.textContent = runtimeTransitionLabel(t)");
    expect(appHtml).toContain("function runtimeTransitionHue");
    expect(appHtml).toContain("function runtimeTransitionColor");
    expect(appHtml).not.toContain("const globalIndex = model.transitions.findIndex");
    expect(appHtml).not.toContain('button.style.setProperty("--button-color-strong", `hsl(${hue} 84% 46%)`)');
    expect(appHtml).toContain("applyRuntimeTransitionButtonStyle(button, t)");
    expect(appHtml).toContain('button.style.setProperty("--button-color-strong", color)');
    expect(appHtml).toContain(".action:not(.invalid) button[data-transition-id]");
    expect(appHtml).toContain("background-image: none;");
    expect(appHtml).not.toContain('button.style.backgroundImage = "none"');
  });

  test("list item editors use non-overlapping layout classes @smoke", () => {
    const html = stateHtml();

    expect(html).toContain('itemHead.className = "list-item-head"');
    expect(html).toContain('textField.className = "field list-item-field"');
    expect(html).toContain('urlField.className = "field list-item-field"');
    expect(html).toContain(".list-item-head");
    expect(html).toContain("grid-template-columns: minmax(0, 1fr) auto");
  });

  test("component data rendering stays wired through global-state paths @smoke", () => {
    const html = stateHtml();

    expect(html).toContain(".global-state-json");
    expect(html).toContain(".global-state-json-toggle");
    expect(html).toContain(".global-state-key-card");
    expect(html).toContain("toggleSubscriptionPath");
    expect(html).toContain("toggleRenderPath");
    expect(html).toContain("pTransitionKeyGrid");
    expect(html).toContain("Data value changes");
    expect(html).toContain(".data-wire-row");
    expect(html).toContain("Visible fields");
    expect(html).toContain("All paths");
    expect(html).toContain(".component-editor input");
    expect(html).toContain("function normalizeBindingPath");
    expect(html).toContain("function dataWireDisplayValue");
    expect(html).toContain("function dataWireUrlValue");
    expect(html).not.toContain(".template-binding-picker");
    expect(html).not.toContain("const connectTemplateBinding");
    expect(html).not.toContain("Connect data...");
    expect(html).toContain('const key = normalizeBindingPath(path, "");');
  });

  test("repeat sources offer readable candidates without auto-mapping render rows @smoke", () => {
    const html = stateHtml();
    const appHtml = generatedAppHtml();

    expect(html).toContain("function derivedRepeatComponents");
    expect(html).toContain("function pickDerivedRepeatFields");
    expect(html).toContain("function imagePathSpecificityScore");
    expect(html).toContain("category|categories|brand|manufacturer");
    expect(appHtml).toContain("function runtimeImagePathSpecificityScore");
    expect(appHtml).toContain("runtimeImagePathSpecificityScore(path)");
    expect(html).toContain("function repeatSampleForPath");
    expect(html).toContain("function repeatComponentMeta");
    expect(html).toContain("function columnarRepeatEntries");
    expect(html).toContain("function columnarRepeatItems");
    expect(html).toContain("function repeatValueItems");
    expect(html).toContain("isColumnarRepeatObject(value)");
    expect(html).toContain("function repeatCandidateDataScore");
    expect(html).toContain("function collectRepeatArrayCandidates");
    expect(html).toContain("function repeatCandidatesForOwner");
    expect(html).not.toContain("function autoRepeatPathForOwner");
    expect(html).not.toContain("function autoRepeatCandidateForOwner");
    expect(html).not.toContain("function ownerHasAutoRepeatSource");
    expect(html).not.toContain("repeat:auto");
    expect(html).not.toContain("Auto detected");
    expect(html).toContain("manual: Boolean(source.manual)");
    expect(html).toContain("fetch response assumption");
    expect(html).toContain("function applyDerivedDataWires");
    expect(html).toContain("function dataWiresFromRepeatSample");
    expect(html).toContain("generatedFromDataWire");
    expect(html).not.toContain("Auto data part");
    expect(html).toContain("Visible fields");
    expect(html).toContain("applyDerivedDataWires");
    expect(html).toContain("upsertDataWire");
    expect(html).toContain("runtimeDataWireComponentsForState");
    expect(html).toContain("Pick a list only when this state should show repeated items.");
    expect(html).not.toContain("autoCreateRepeatComponents");
    expect(html).not.toContain("autoDeriveRepeatForOwner(s, null, false)");
    expect(html).not.toContain("autoDeriveRepeatForOwner");
    expect(html).not.toContain("applyDerivedDataWires(s, repeat.path, root, false)");
    expect(html).not.toContain("Fetch automap");
    expect(html).not.toContain("Open fetch automap");
    expect(html).not.toContain("api.escuelajs");
    expect(html).toContain('title: "Content list"');
    expect(html).not.toContain('title: "API list"');
    expect(html).not.toContain("builtin_api_list");
    expect(html).not.toContain('title: "Theme Controller"');
    expect(html).not.toContain('title: "Navbar - colors"');
    expect(html).toContain('title: "Hero with image reverse"');
    expect(html).toContain('title: "Action button"');
    expect(html).toContain("const SUPPORTED_DAISY_VARIANTS = new Set");
    expect(html).toContain("function runtimeSupportedDaisyComponent");
    expect(html).toContain("pruneUnsupportedDaisyRuntime");
    expect(html).not.toContain("pruneLegacyDaisyRuntime");
    expect(html).not.toContain('dataPath: "$state"');
    expect(html).not.toContain("function applyStateScopedTemplateBindings");
    expect(html).not.toContain("function expandStateScopedDataObject");
    expect(html).not.toContain("function demoModel");
    expect(html).not.toContain('id="btnDemo"');
    expect(html).not.toContain("component.html");
    expect(html).not.toContain('title: "Contact form"');
    expect(html).not.toContain('title: "Login form"');
    expect(html).not.toContain('title: "While loop"');
    expect(html).toContain("dataWires: [],");
    expect(html).toContain('url: ""');
    expect(html).toContain("dataWiresFromRepeatSample(sample, scopePath)");
    expect(html).toContain("push(fields.image, \"image\", \"image\", \"Image\")");
    expect(html).toContain('filter(part => !/^\\d+$/.test(part))');
    expect(html).toContain('const childPrefix = prefix ? prefix + ".0" : "";');
    expect(appHtml).toContain("function runtimeDerivedRepeatComponents");
    expect(appHtml).toContain("function runtimeColumnarRepeatEntries");
    expect(appHtml).toContain("function runtimeRepeatValueItems");
    expect(appHtml).toContain("const repeated = runtimeRepeatValueItems(repeatedValue)");
    expect(appHtml).toContain("function runtimeDataWireComponentsForState");
    expect(appHtml).toContain("function runtimeDataWireDisplayValue");
    expect(appHtml).toContain("function runtimeDataWireUrlValue");
    expect(appHtml).toContain("runtimeDataWireComponentsForState(state, repeat)");
    expect(appHtml).toContain("function daisyScopePath");
    expect(appHtml).toContain("function daisyScopeData");
    expect(appHtml).toContain("readContextPathRaw(daisyScopePath(component))");
    expect(appHtml).toContain("function daisyWrite");
    expect(appHtml).toContain('runtimeSet(targetPath, value, { source: "state-default", notify: false');
    expect(appHtml).toContain("pruneRemovedStateDataDefaults(previousModel, nextModel, oldContext)");
    expect(appHtml).toContain("function pruneRemovedStateDataDefaults");
    expect(appHtml).toContain("createDaisyComponentElement(component, ownerState, renderOptions)");
    expect(appHtml).not.toContain("component.data?.");
    expect(appHtml).not.toContain("component.data ||");
    expect(appHtml).not.toContain("component.data[");
    expect(appHtml).not.toContain("component.html");
    expect(appHtml).not.toContain(".showModal(");
    expect(appHtml).not.toContain('method="dialog"');
    expect(appHtml).not.toContain("runtimeComponentIsRawDataDump");
    expect(appHtml).not.toContain("runtimeTemplateTouchesPath");
    expect(appHtml).not.toContain("{{");
    expect(appHtml).toContain('prefix + ".0"');
    expect(appHtml).not.toContain("readableRepeatComponentsForRuntime(state.components, item, repeat.as, repeat.path)");
  });

  test("fetch runtime is an entry effect on the global bus, not a render/cache side effect @smoke", () => {
    const html = stateHtml();
    const appHtml = generatedAppHtml();

    expect(appHtml).toContain("function runCurrentStateEntryEffects");
    expect(appHtml).toContain("runCurrentStateEntryEffects({ fetch: true })");
    expect(appHtml).toContain("currentDataSourceTargetChanged(changedTargets)");
    expect(appHtml).toContain("function dataSourceEventBelongsToCurrentState");
    expect(appHtml).toContain("dataSourceResultBelongsToEntry(currentResult, meta)");
    expect(appHtml).toContain("activationId === stateActivationId");
    expect(appHtml).not.toContain("await ensureStateDataSource(s)");
    expect(html).toContain("function resetEditorDataSourceContext");
    expect(html).toContain("sourceChanged = dataSourceSignature(previous) !== dataSourceSignature(next)");
    expect(html).toContain("resetEditorDataSourceContext(previous.target)");
    expect(html).toContain("data: null");
    expect(html).toContain("count: 0");
    expect(html).toContain("error: \"\"");
    expect(appHtml).toContain("function changedDataSourceTargets");
    expect(appHtml).toContain("function resetDataSourceContextTargets");
    expect(appHtml).toContain("if (changedTargets.length) resetDataSourceContextTargets(changedTargets)");
    expect(appHtml).toContain('screen.innerHTML = ""');
    expect(html).not.toContain("dataSourceRuns = new Map");
    expect(html).not.toContain("dataSourceRuns.");
    expect(appHtml).not.toContain("let dataSourceRunSerial = 0");
    expect(appHtml).not.toContain("let activeDataSourceRun = null");
  });

  test("data wires drive rendered content through global state @smoke", () => {
    const html = stateHtml();
    const appHtml = generatedAppHtml();

    expect(html).toContain("function normalizeDataWire(value)");
    expect(html).toContain("function dataWireFromPath");
    expect(html).toContain("function dataWireComponentsForState");
    expect(html).toContain("function applyDerivedDataWires");
    expect(html).toContain("dataWires: normalizeDataWires");
    expect(html).toContain("Visible fields");
    expect(html).toContain("Screen fields");
    expect(html).toContain("components: [],");
    expect(html).toContain("function dataWireDisplayValue");
    expect(html).toContain("function dataWireUrlValue");
    expect(appHtml).toContain("function normalizeDataWire(value)");
    expect(appHtml).toContain("function runtimeDataWireComponentsForState");
    expect(appHtml).toContain("function runtimeDataWireDisplayValue");
    expect(appHtml).toContain("function runtimeDataWireUrlValue");
    expect(appHtml).toContain("runtimeDataWireComponentsForState(state, repeat)");
    expect(appHtml).toContain('const targetPath = runtimeNormalizeBindingPath(path, "")');
    expect(appHtml).not.toContain("readableRepeatComponentsForRuntime(state.components, item, repeat.as, repeat.path)");
  });

  test("data-wire render placeholders stay referential and ordered @smoke", () => {
    const html = stateHtml();
    const appHtml = generatedAppHtml();

    expect(html).toContain('"transitionButton", "dataWire"');
    expect(html).not.toContain("childOutlet");
    expect(html).not.toContain("combinedRender");
    expect(html).not.toContain("passiveRender");
    expect(html).toContain('if (component.type === "dataWire") norm.wireId');
    expect(html).toContain('component.type !== "dataWire" || wireIds.has(component.wireId)');
    expect(html).toContain("const dataWireComponentId = wireId => `data-wire:${wireId}`");
    expect(html).toContain('if (component.type === "dataWire") clean.wireId');
    expect(html).toContain('type: "dataWire"');
    expect(html).toContain("function daisyOwnerIsCurrent");
    expect(html).toContain("function daisyOwnerCanWrite");
    expect(html).toContain("function appendDaisyLocalActionButton");
    expect(html).toContain("ownerId === current");
    expect(appHtml).toContain("function runtimeChildEntryTransition(state)");
    expect(appHtml).toContain("if (!state) return null;");
    expect(appHtml).not.toContain("combinedRender");
    expect(appHtml).not.toContain("childOutlet");
    expect(appHtml).not.toContain("passiveRender");
    expect(html).toContain("scheduleDaisyCountdown(component, ownerState);");
    expect(html).toContain("if (ownerStateId !== current) return;");
    expect(html).not.toContain("resetDaisyCountdown");
    expect(html).not.toContain("daisy-countdown-entry");
    expect(html).not.toContain("resetOnEnter");
    expect(html).toContain("__ownerStateId");
    expect(html).toContain('if (runtimeEventKind && runtimeEventKind !== "change" && runtimeEventKind !== "fetch") return [state];');
    expect(html).toContain("if (detail?.transitionId && transition?.id !== detail.transitionId) return false;");
    expect(html).toContain("wireId: wire.id");
    expect(html).toContain("function snapshotStateTemplates");
    expect(html).toContain("components: normalizeComponents(item.components || [])");
    expect(html).toContain('if (component.type === "list") {');
    expect(html).toContain("clone.items = normalizeListItems(component.items, component.text).map");

    expect(appHtml).toContain('"transitionButton", "dataWire"');
    expect(appHtml).toContain('if (component.type === "dataWire") norm.wireId');
    expect(appHtml).toContain("function runtimeOrderedRenderComponentsForState");
    expect(appHtml).toContain("const wireById = new Map(wireComponents.map(component => [component.wireId, component]))");
    expect(appHtml).toContain('if (component.type === "dataWire")');
    expect(appHtml).toContain("ordered.push(wireComponent)");
    expect(appHtml).toContain("return [...unplacedWires, ...ordered]");
    expect(appHtml).toContain("wireId: wire.id");
  });

  test("generated runtime writes global state through the bus @smoke", () => {
    const appHtml = generatedAppHtml();

    const directContextWrites = appHtml
      .split("\n")
      .map(line => line.trim())
      .filter(line =>
        /setValueAtPath\(context,/.test(line) ||
        /\bcontext(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])\s*=/.test(line)
      );

    expect(directContextWrites).toEqual([
      "setValueAtPath(context, targetPath, value);",
      "setValueAtPath(context, \"lastChangedPath\", targetPath);",
      "setValueAtPath(context, \"lastChangedAt\", Date.now());"
    ]);
    expect(appHtml).toContain('function runtimeSet(path, value, opts = {})');
    expect(appHtml).toContain("function writeRuntimeState(path, value, opts = {})");
    expect(appHtml).toContain("function syncRuntimeCurrent");
    expect(appHtml).toContain('writeRuntimeState("events." + name + ".detail", detail');
    expect(appHtml).toContain('writeRuntimeState("lastEvent", name');
    expect(appHtml).toContain("const handledChange = runtimeSet(target, result, { source: \"fetch\", eventName: \"change.\" + target })");
    expect(appHtml).toContain('detail?.source === "fetch" && detail?.type === "change"');
    expect(appHtml).toContain('runtimeSet("state.current", runtimeTarget || ""');
    expect(appHtml).toContain('runtimeSet(targetPath, value, { source: "state-default"');
    expect(appHtml).toContain('runtimeSet(targetPath, dataSourceResult({ status: "source-changed"');
    expect(appHtml).toContain('runtimeSet(v.name, sanitizeValue(readContextPathRaw(v.name), v)');
    expect(appHtml).toContain("return { state: { current: m?.initial || \"\", previous: \"\", lastTransition: \"\" } };");
    expect(appHtml).not.toContain("Object.assign(context");
    expect(appHtml).not.toContain("context[key] = value");
    expect(appHtml).not.toContain('runtimeSet("fetched"');
    expect(appHtml).not.toContain("context.fetched");
    expect(appHtml).not.toContain("context.lastEvent =");
    expect(appHtml).not.toContain("context.lastChangedPath =");
    expect(appHtml).not.toContain("context[v.name] = defaultValueFor");
    expect(appHtml).not.toContain('silent: true, source: "fetch"');
    expect(appHtml).not.toContain("context[repeat.as] =");
    expect(appHtml).not.toContain("delete context[repeat.as]");
    expect(appHtml).not.toContain("context[v.name] = sanitizeValue");
    expect(appHtml).not.toContain('setValueAtPath(context, "state.current"');
  });

  test("host runtime context snapshot remains a read-side view @smoke", () => {
    const html = stateHtml();
    const hostHtml = html.replace(/const APP_HTML = "((?:\\.|[^"\\])*)";/, 'const APP_HTML = "";');
    const allowedWrites = [
      "let latestRuntimeContext = {};",
      "latestRuntimeContext = {};",
      "if (!isPlainObject(latestRuntimeContext)) latestRuntimeContext = {};",
      "setEditorContextPath(latestRuntimeContext, target, emptyDataSourceResult(patch));",
      "setEditorContextPath(latestRuntimeContext, target, {",
      "latestRuntimeContext = isPlainObject(data.context) ? JSON.parse(JSON.stringify(data.context)) : {};"
    ];
    const snapshotWrites = hostHtml
      .split(/\r?\n/)
      .map((line, index) => ({ index: index + 1, line: line.trim() }))
      .filter(({ line }) =>
        /latestRuntimeContext\s*=/.test(line) ||
        /setEditorContextPath\(latestRuntimeContext,/.test(line)
      );
    const unexpectedWrites = snapshotWrites.filter(({ line }) => !allowedWrites.includes(line));
    const forbiddenModelUses = hostHtml
      .split(/\r?\n/)
      .map((line, index) => ({ index: index + 1, line: line.trim() }))
      .filter(({ line }) => line.includes("latestRuntimeContext"))
      .filter(({ line }) =>
        /localStorage\.setItem|pushHistory|saveModel|syncToApp\(|commitModel|recordHistory/.test(line) ||
        /\b(model|currentAppState|selectedId|activeLayerId)\s*=.*latestRuntimeContext/.test(line)
      );

    expect(unexpectedWrites).toEqual([]);
    expect(forbiddenModelUses).toEqual([]);
    expect(hostHtml).toContain("const preview = isPlainObject(latestRuntimeContext) ? JSON.parse(JSON.stringify(latestRuntimeContext)) : {};");
    expect(hostHtml).toContain("latestRuntimeContext = isPlainObject(data.context) ? JSON.parse(JSON.stringify(data.context)) : {};");
    expect(hostHtml).toContain("applyRuntimePaused(Boolean(data.paused ?? latestRuntimeContext?.runtime?.paused), { send: false });");
    expect(hostHtml).not.toMatch(/localStorage\.setItem\([^)]*latestRuntimeContext/);
    expect(hostHtml).not.toMatch(/syncToApp\([^)]*latestRuntimeContext/);
  });

  test("host runtime snapshot does not persist bus writes into state defaults @smoke", async ({ page }) => {
    const scopePath = "states.action_state";
    await openWithModel(page, {
      version: 2,
      name: "Runtime Snapshot Guard",
      initial: "action_state",
      states: [
        {
          id: "action_state",
          title: "Action State",
          body: "",
          x: 120,
          y: 120,
          data: {
            [scopePath]: {
              label: "Continue",
              clicked: false,
              clickedAt: 0
            }
          },
          dataTypes: {
            [scopePath]: "object"
          },
          components: [
            {
              id: "action_button",
              type: "daisy",
              variant: "button",
              dataPath: scopePath,
              dataRole: "widget",
              dataLabel: "Action button"
            }
          ]
        }
      ],
      transitions: []
    });

    const app = appFrame(page);
    await app.getByRole("button", { name: "Continue" }).click();

    await expect.poll(async () => runtimeContext(page).then(context => context.states?.action_state))
      .toMatchObject({
        label: "Continue",
        clicked: true
      });
    await expect.poll(async () => runtimeContext(page).then(context => Number(context.states?.action_state?.clickedAt) > 0))
      .toBe(true);
    await expect.poll(async () => savedModel(page).then(model => model.states.find(state => state.id === "action_state")?.data?.[scopePath]))
      .toEqual({
        label: "Continue",
        clicked: false,
        clickedAt: 0
      });
  });

  test("generated runtime exposes a contract-level pause gate @smoke", () => {
    const html = stateHtml();

    expect(html).toContain('id="btnPause"');
    expect(html).toContain('type: "STATE_BLUEPRINT_RUNTIME_CONTROL"');
    expect(html).toContain('runtime: { paused: false }');
    expect(html).toContain("function runtimeIsPaused()");
    expect(html).toContain('readValueAtPath(context, "runtime.paused") === true');
    expect(html).toContain('writeRuntimeState("runtime.paused", next');
    expect(html).toContain("runtimeEventQueue = [];");
    expect(html).toContain("scheduleAutomaticContinuationJsEnhanced");
    expect(html).toContain("if (runtimeIsPaused()) {");
    expect(html).not.toContain('writeRuntimeState("runtime.paused", runtimePaused');
    expect(html).not.toContain("if (runtimePaused) {");
  });

  test("canonical JSON and runtime contracts do not keep removed aliases @smoke", () => {
    const html = stateHtml();
    const appHtml = generatedAppHtml();
    const hostHtml = html.replace(/const APP_HTML = "((?:\\.|[^"\\])*)";/, 'const APP_HTML = "";');
    const removedContracts = [
      "migrateBodyToComponents",
      "dataWireId",
      "sourceStateId",
      "latestRuntimeContext.fetched",
      'runtimeSet("fetched"',
      "s.fetch",
      /\bstate\.fetch\b/,
      "template.fetch",
      "component.dataWireId",
      "transition?.trigger ||",
      "t?.trigger ||",
      "eventType",
      "transition?.kind",
      "t.event",
      "isStateScopedPathToken",
      "applyStateScopedTemplateBindings",
      "expandStateScopedDataObject",
      "demoModel",
      "btnDemo"
    ];

    for (const removed of removedContracts) {
      if (removed instanceof RegExp) {
        expect(hostHtml, `host should not match ${removed}`).not.toMatch(removed);
        expect(appHtml, `runtime should not match ${removed}`).not.toMatch(removed);
      } else {
        expect(hostHtml, `host should not contain ${removed}`).not.toContain(removed);
        expect(appHtml, `runtime should not contain ${removed}`).not.toContain(removed);
      }
    }
  });

  test("data source defaults are scoped to the owning state, never root fetch @smoke", () => {
    const html = stateHtml();
    const hostHtml = html.replace(/const APP_HTML = "((?:\\.|[^"\\])*)";/, 'const APP_HTML = "";');

    expect(hostHtml).toContain('stateDataScopeForId(id) + ".fetch"');
    expect(hostHtml).toContain('fallbackTarget: stateDataScopeForId(id) + ".fetch"');
    expect(hostHtml).toContain('fallbackTarget: stateDataScopeForId(stateId) + ".fetch"');
    expect(hostHtml).toContain('target: normalizeContextPath(source.target, fallbackTarget)');
    expect(hostHtml).toContain('s.dataSource = normalizeDataSource(s.dataSource, "states." + s.id + ".fetch");');
    expect(hostHtml).not.toContain("dataSource: normalizeDataSource(null)");
  });

  test("only canvas-focused Delete removes selected graph items, Backspace does not @smoke", () => {
    const html = stateHtml();

    expect(html).toContain("function eventTargetsCanvasForDelete");
    expect(html).toContain('evt.key === "Delete" && eventTargetsCanvasForDelete(evt) && deleteActiveSelection()');
    expect(html).toContain("if (isEditableTarget(evt.target)) return;");
    expect(html).not.toContain('evt.key === "Backspace" && deleteActiveSelection()');
    expect(html).not.toContain('if (evt.key === "Delete" && deleteActiveSelection())');
  });

  test("runtime active state highlight stays visually distinct @smoke", () => {
    const html = stateHtml();

    expect(html).toContain("@keyframes activeStateBreath");
    expect(html).toContain("@keyframes activeSelectedStateBreath");
    expect(html).not.toContain("@keyframes activeStateDot");
    expect(html).not.toContain(".node.active::after");
    expect(html).toContain("animation: activeStateBreath 2.35s ease-in-out infinite");
    expect(html).toContain("animation: activeSelectedStateBreath 2.35s ease-in-out infinite");
    expect(html).toContain("stateEnterPulse 1.34s cubic-bezier(.16, 1, .3, 1)");
    expect(html).toContain("var RUNTIME_STATE_ENTER_PULSE_MS = 1420");
    expect(html).toContain("function applyRuntimeStatePulses(now = performance.now())");
    expect(html).toContain("applyRuntimeStatePulses(started);");
    expect(html).not.toContain("requestAnimationFrame(() => {\n        applyRuntimeStatePulses();\n        setTimeout(() => {");
    expect(html).not.toContain(".svg-port.runtime .svg-port-hit");
    expect(html).not.toContain("@keyframes activePortBreath");
    expect(html).not.toContain("portEnterPulse 1.34s cubic-bezier(.16, 1, .3, 1)");
    expect(html).not.toContain("portExitPulse .88s ease-out");
    expect(html).not.toContain('if (state.id === currentAppState) classes.push("runtime")');
  });

  test("runtime transition flow pulse avoids frame-time DOM churn @smoke", () => {
    const html = stateHtml();
    const pulseBody = html.slice(
      html.indexOf("function pulseRuntimeTransition(edgeId)"),
      html.indexOf("function runtimeStatePulseDuration")
    );

    expect(html).toContain("var runtimeEdgePulseCleanupTimer = 0");
    expect(html).toContain("function tickRuntimeEdgePulses(now = performance.now())");
    expect(html).toContain("function applyRuntimeEdgePulseClass(el, pulse)");
    expect(html).toContain("setTimeout(tickRuntimeEdgePulses, delay)");
    expect(html).toContain("@keyframes runtimeEdgePulseA");
    expect(html).toContain("@keyframes runtimeEdgePulseB");
    expect(html).not.toContain("requestAnimationFrame(tickRuntimeEdgePulses)");
    expect(pulseBody).not.toContain("strokeDashoffset");
    expect(pulseBody).not.toContain("style.filter");
    expect(pulseBody).not.toContain("getBoundingClientRect");
    expect(pulseBody).not.toContain("animationDelay");
  });
});

test.describe("Core browser contracts", () => {
  test("runtime orders placed and unplaced data wires with transition buttons through events @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "Runtime Render Order",
      initial: "start",
      states: [
        {
          id: "start",
          title: "Start",
          body: "",
          x: 120,
          y: 160,
          data: { catalog: { item: { badge: "Featured", title: "Ada Chair" } } },
          dataWires: [
            { id: "wire_badge", sourcePath: "catalog.item.badge", role: "field", componentType: "text", label: "Badge" },
            { id: "wire_title", sourcePath: "catalog.item.title", role: "title", componentType: "heading", label: "Title" }
          ],
          components: [
            { id: "manual_note", type: "note", text: "Manual note", url: "" },
            { id: "slot_title", type: "dataWire", wireId: "wire_title", text: "", url: "" },
            { id: "slot_next", type: "transitionButton", transitionId: "to_done", text: "", url: "" }
          ]
        },
        { id: "done", title: "Done", body: "", x: 420, y: 160, components: [] }
      ],
      transitions: [
        { id: "to_done", from: "start", to: "done", label: "Continue", condition: "", triggerType: "button", set: { visited: true } }
      ]
    });

    const app = appFrame(page);
    await expect.poll(async () => app.locator("#screen").evaluate(screen => {
      const stack = screen.querySelector(".component-stack");
      return [...(stack?.children || [])].map(child =>
        child.querySelector("button[data-transition-id]")?.dataset.transitionId || child.textContent.trim()
      );
    })).toEqual(["Badge: Featured", "Manual note", "Ada Chair", "to_done"]);
    await expect(app.locator("button[data-transition-id='to_done']")).toHaveCount(1);

    await app.getByRole("button", { name: "Continue" }).click();
    await expect(app.locator("#statePill")).toHaveText("done");
  });

  test("runtime repeat data wires resolve array-indexed item paths @smoke", async ({ page }) => {
    const firstImage = "https://example.com/alpha.png";
    const secondImage = "https://example.com/beta.png";
    await openWithModel(page, {
      version: 2,
      name: "Repeat Images",
      initial: "products",
      states: [
        {
          id: "products",
          title: "Products",
          body: "",
          x: 120,
          y: 160,
          data: {
            catalog: {
              items: [
                { title: "Alpha", images: [firstImage] },
                { title: "Beta", images: [secondImage] }
              ]
            }
          },
          repeat: { path: "catalog.items", as: "item", index: "i" },
          dataWires: [
            { id: "wire_image", sourcePath: "catalog.items.images.0", scopePath: "catalog.items", itemPath: "images.0", role: "image", componentType: "image", label: "Image" },
            { id: "wire_title", sourcePath: "catalog.items.title", scopePath: "catalog.items", itemPath: "title", role: "title", componentType: "heading", label: "Title" }
          ],
          components: []
        }
      ],
      transitions: []
    });

    const app = appFrame(page);
    await expect(app.locator(".component-image")).toHaveCount(2);
    await expect(app.locator(".component-image").nth(0)).toHaveAttribute("src", firstImage);
    await expect(app.locator(".component-image").nth(1)).toHaveAttribute("src", secondImage);
    await expect(app.getByRole("heading", { name: "Alpha" })).toBeVisible();
    await expect(app.getByRole("heading", { name: "Beta" })).toBeVisible();
  });

  test("multiple outgoing button transitions keep distinct event targets @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "Branch Smoke",
      initial: "start",
      states: [
        { id: "start", title: "Start", body: "", components: [], data: {}, x: 120, y: 160 },
        { id: "info", title: "Show info", body: "", components: [{ id: "c_info", type: "note", text: "Info branch reached" }], data: {}, x: 420, y: 80 },
        { id: "note", title: "Show note", body: "", components: [{ id: "c_note", type: "note", text: "Reached second branch" }], data: {}, x: 420, y: 260 }
      ],
      transitions: [
        { id: "t_next", from: "start", to: "info", label: "Next", condition: "", set: {} },
        { id: "t_next2", from: "start", to: "note", label: "Next2", condition: "", set: {} }
      ]
    });

    const app = appFrame(page);
    const next = app.getByRole("button", { name: /^Next$/ });
    const next2 = app.getByRole("button", { name: /^Next2$/ });
    await expect(next).toBeVisible();
    await expect(next2).toBeVisible();
    const buttonColors = await Promise.all([
      next.evaluate(el => getComputedStyle(el).backgroundColor),
      next2.evaluate(el => getComputedStyle(el).backgroundColor)
    ]);
    expect(buttonColors[0]).not.toBe(buttonColors[1]);

    await next2.click();

    await expect(app.locator("#statePill")).toHaveText("note");
    await expect(app.locator("h1")).toHaveText("Show note");
  });

  test("boundary exit states keep child buttons ordered before parent outs @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "Boundary Exit Buttons",
      initial: "exit_child",
      states: [
        { id: "parent", title: "Parent", body: "", components: [], data: {}, boundary: { entryId: "entry_child", exitId: "exit_child", entryDisabled: false, exitDisabled: false }, x: 120, y: 160 },
        { id: "outside", title: "Outside", body: "", components: [], data: {}, x: 420, y: 160 },
        { id: "entry_child", title: "Entry Child", body: "", components: [], data: {}, parentId: "parent", x: 120, y: 120 },
        { id: "exit_child", title: "Exit Child", body: "", components: [], data: {}, parentId: "parent", x: 420, y: 120 },
        { id: "direct_a", title: "Direct A", body: "", components: [], data: {}, parentId: "parent", x: 720, y: 48 },
        { id: "direct_b", title: "Direct B", body: "", components: [], data: {}, parentId: "parent", x: 720, y: 216 }
      ],
      transitions: [
        { id: "t_intro", from: "entry_child", to: "exit_child", label: "To Exit", condition: "", triggerType: "button", set: {} },
        { id: "t_direct_a", from: "exit_child", to: "direct_a", label: "Direct A", condition: "", triggerType: "button", set: {} },
        { id: "t_direct_b", from: "exit_child", to: "direct_b", label: "Direct B", condition: "", triggerType: "button", set: {} },
        { id: "t_parent_exit", from: "parent", to: "outside", label: "Parent Out", condition: "", triggerType: "button", groupExitId: "exit_child", set: {} }
      ]
    });

    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("exit_child");
    await expect(app.getByRole("button", { name: "Direct A" })).toBeVisible();
    await expect(app.getByRole("button", { name: "Direct B" })).toBeVisible();
    await expect(app.getByRole("button", { name: "Parent Out" })).toBeVisible();
    await expect(app.locator("button[data-transition-id]")).toHaveText(["Direct A", "Direct B", "Parent Out"]);

    const buttonStyles = await transitionButtonStyles(app);

    const edgeColorFor = async id => {
      const edge = page.locator(`.edge[data-edge-id="${id}"]`);
      await expect(edge).toHaveCount(1);
      return edge.evaluate(el => getComputedStyle(el).getPropertyValue("--edge-color").trim());
    };
    await openLayer(page, "parent", "exit_child");

    const edgeColors = {
      t_direct_a: await edgeColorFor("t_direct_a"),
      t_direct_b: await edgeColorFor("t_direct_b")
    };

    for (const [transitionId, edgeColor] of Object.entries(edgeColors)) {
      expect(buttonStyles[transitionId].color).toBe(edgeColor);
      expect(buttonStyles[transitionId].strong).toBe(edgeColor);
      expect(buttonStyles[transitionId].backgroundImage).toBe("none");
    }
  });

  test("inner-state render buttons keep the exact fired transition color @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "Inner Button Colors",
      initial: "inner_a",
      states: [
        { id: "shell", title: "Shell", body: "", components: [], data: {}, x: 120, y: 160 },
        {
          id: "inner_a",
          title: "Inner A",
          body: "",
          components: [
            { id: "button_to_b", type: "transitionButton", transitionId: "inner_to_b" },
            { id: "text_inner", type: "text", text: "Choose an inner route.", url: "" },
            { id: "button_to_c", type: "transitionButton", transitionId: "inner_to_c" }
          ],
          data: {},
          parentId: "shell",
          x: 120,
          y: 120
        },
        { id: "inner_b", title: "Inner B", body: "", components: [], data: {}, parentId: "shell", x: 420, y: 72 },
        { id: "inner_c", title: "Inner C", body: "", components: [], data: {}, parentId: "shell", x: 420, y: 216 }
      ],
      transitions: [
        { id: "inner_to_b", from: "inner_a", to: "inner_b", label: "Inner B", condition: "", triggerType: "button", set: {} },
        { id: "inner_to_c", from: "inner_a", to: "inner_c", label: "Inner C", condition: "", triggerType: "button", set: {} }
      ]
    });

    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("inner_a");
    await expect(app.locator("button[data-transition-id]")).toHaveCount(2);
    await expect(app.locator(".component-stack > *").first().locator("button[data-transition-id='inner_to_b']")).toBeVisible();
    await expect(app.getByRole("button", { name: "Inner C" })).toBeVisible();
    const buttonStyles = await transitionButtonStyles(app);

    await openLayer(page, "shell", "inner_a");
    const edgeColorFor = async id => {
      const edge = page.locator(`.edge[data-edge-id="${id}"]`);
      await expect(edge).toHaveCount(1);
      return edge.evaluate(el => getComputedStyle(el).getPropertyValue("--edge-color").trim());
    };
    const edgeColors = {
      inner_to_b: await edgeColorFor("inner_to_b"),
      inner_to_c: await edgeColorFor("inner_to_c")
    };

    for (const [transitionId, edgeColor] of Object.entries(edgeColors)) {
      expect(buttonStyles[transitionId].color).toBe(edgeColor);
      expect(buttonStyles[transitionId].strong).toBe(edgeColor);
      expect(buttonStyles[transitionId].backgroundImage).toBe("none");
    }
  });

  test("child exit states project real parent outs without a child-to-parent return @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "Child Exit Parent Out",
      initial: "exit_child",
      states: [
        { id: "parent", title: "Parent", body: "", components: [], data: {}, boundary: { entryId: "exit_child", exitId: "exit_child", entryDisabled: false, exitDisabled: false }, x: 120, y: 160 },
        { id: "outside", title: "Outside", body: "", components: [], data: {}, x: 420, y: 160 },
        { id: "exit_child", title: "Exit Child", body: "", components: [], data: {}, parentId: "parent", x: 120, y: 120 }
      ],
      transitions: [
        { id: "parent_out", from: "parent", to: "outside", label: "Leave", condition: "", triggerType: "button", groupExitId: "exit_child", set: {} }
      ]
    });

    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("exit_child");
    await expect(app.locator("button[data-transition-id]")).toHaveCount(1);
    await expect(app.getByRole("button", { name: "Parent" })).toHaveCount(0);
    await expect(app.locator('button[data-transition-id="__runtime_exit_child:exit_child:parent"]')).toHaveCount(0);
    await expect(app.locator('button[data-transition-id="parent_out"]')).toHaveText("Leave");

    const buttonStyles = await transitionButtonStyles(app);

    await openLayer(page, "parent", "exit_child");
    const edge = page.locator('.edge[data-edge-id="parent_out"]');
    await expect(edge).toHaveCount(1);
    const edgeColor = await edge.evaluate(el => getComputedStyle(el).getPropertyValue("--edge-color").trim());
    expect(buttonStyles.parent_out.color).toBe(edgeColor);
    expect(buttonStyles.parent_out.strong).toBe(edgeColor);

    await app.getByRole("button", { name: "Leave" }).click();
    await expect(app.locator("#statePill")).toHaveText("outside");
  });

  test("output-proxy child exits include real parent outs beside child actions @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "Output Proxy Child Exit",
      initial: "exit_child",
      states: [
        { id: "parent", title: "Parent", body: "", components: [], data: {}, boundary: { entryId: "exit_child", exitId: "", entryDisabled: false, exitDisabled: false }, x: 120, y: 160 },
        { id: "outside", title: "Outside", body: "", components: [], data: {}, x: 460, y: 160 },
        { id: "inner", title: "Inner Detail", body: "", components: [], data: {}, parentId: "parent", x: 360, y: 80 },
        { id: "exit_child", title: "Exit Child", body: "", components: [], data: {}, parentId: "parent", x: 120, y: 120 }
      ],
      transitions: [
        { id: "child_detail", from: "exit_child", to: "inner", label: "Inspect", condition: "", triggerType: "button", set: {} },
        { id: "parent_out", from: "parent", to: "outside", label: "Leave", condition: "", triggerType: "button", set: {} },
        {
          id: "boundary-flow:parent:output",
          from: "exit_child",
          to: "proxy:parent:output:__boundary_output",
          label: "",
          condition: "",
          triggerType: "button",
          set: {},
          boundaryFlow: { parentId: "parent", side: "output", stateId: "exit_child" }
        }
      ]
    });

    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("exit_child");
    await expect(app.getByRole("button", { name: "Inspect" })).toBeVisible();
    await expect(app.getByRole("button", { name: "Leave" })).toBeVisible();
    await expect(app.locator('button[data-transition-id="boundary-flow:parent:output"]')).toHaveCount(0);
    await expect(app.locator('button[data-transition-id^="__runtime_next_child:"]')).toHaveCount(0);

    await app.getByRole("button", { name: "Leave" }).click();
    await expect(app.locator("#statePill")).toHaveText("outside");
  });

  test("child boundary exits never loop back to the boundary entry without a real parent out @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "No Boundary Entry Loop",
      initial: "exit_child",
      states: [
        { id: "parent", title: "Parent", body: "", components: [], data: {}, boundary: { entryId: "entry_child", exitId: "exit_child", entryDisabled: false, exitDisabled: false }, x: 120, y: 160 },
        { id: "exit_child", title: "Exit Child", body: "", components: [], data: {}, parentId: "parent", x: 120, y: 80 },
        { id: "entry_child", title: "Entry Child", body: "", components: [], data: {}, parentId: "parent", x: 120, y: 180 }
      ],
      transitions: []
    });

    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("exit_child");
    await expect(app.getByRole("button", { name: "Entry Child" })).toHaveCount(0);
    await expect(app.locator('button[data-transition-id^="__runtime_next_child:"]')).toHaveCount(0);
    await expect(app.locator('button[data-transition-id^="__runtime_enter_child:"]')).toHaveCount(0);
    await expect(app.locator("button[data-transition-id]")).toHaveCount(0);
  });

  test("child states without an output do not inherit parent outs @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "No Implicit Child Exit",
      initial: "child",
      states: [
        { id: "parent", title: "Parent", body: "", components: [], data: {}, x: 120, y: 160 },
        { id: "outside", title: "Outside", body: "", components: [], data: {}, x: 420, y: 160 },
        { id: "child", title: "Child", body: "", components: [], data: {}, parentId: "parent", x: 120, y: 120 }
      ],
      transitions: [
        { id: "parent_out", from: "parent", to: "outside", label: "Leave", condition: "", triggerType: "button", set: {} }
      ]
    });

    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("child");
    await expect(app.locator("button[data-transition-id]")).toHaveCount(0);
    await expect(app.getByRole("button", { name: "Leave" })).toHaveCount(0);
    await expect(app.getByRole("button", { name: "Parent" })).toHaveCount(0);
  });

  test("child states stop instead of suggesting unconnected sibling actions @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "No Sibling Action Leak",
      initial: "navbar_shop_cart",
      states: [
        { id: "start", title: "Start", body: "", components: [], data: {}, x: 120, y: 180 },
        {
          id: "navbar_shop_cart",
          title: "Navbar shop/cart",
          body: "",
          components: [],
          data: {},
          parentId: "start",
          x: 120,
          y: 120
        },
        { id: "settings", title: "Settings", body: "", components: [], data: {}, parentId: "start", x: 380, y: 120 },
        { id: "logout", title: "Logout", body: "", components: [], data: {}, parentId: "start", x: 620, y: 120 }
      ],
      transitions: [
        { id: "t_settings", from: "navbar_shop_cart", to: "settings", label: "Settings", condition: "", triggerType: "button", set: {} },
        { id: "t_logout", from: "navbar_shop_cart", to: "logout", label: "Logout", condition: "", triggerType: "button", set: {} }
      ]
    });

    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("navbar_shop_cart");
    await expect(app.getByRole("button", { name: "Settings" })).toBeVisible();
    await expect(app.getByRole("button", { name: "Logout" })).toBeVisible();

    await app.getByRole("button", { name: "Settings" }).click();
    await expect(app.locator("#statePill")).toHaveText("settings");
    await expect(app.getByRole("button", { name: "Logout" })).toHaveCount(0);
    await expect(app.locator('button[data-transition-id^="__runtime_next_child:"]')).toHaveCount(0);
    await expect(app.locator("button[data-transition-id]")).toHaveCount(0);

    await openStateInspector(page, "settings");
    await expect(page.locator("#pComponents .component-editor").filter({ hasText: "Button: Logout" })).toHaveCount(0);
  });

  test("nested navbar child actions stop on an unconnected child state @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "Navbar Child Action Stop",
      initial: "start",
      states: [
        {
          id: "start",
          title: "Start",
          body: "",
          components: [],
          data: {},
          boundary: { entryId: "navbar_shop_cart", exitId: "navbar_shop_cart", entryDisabled: false, exitDisabled: false },
          x: 120,
          y: 180
        },
        {
          id: "navbar_shop_cart",
          title: "Navbar shop/cart",
          body: "",
          parentId: "start",
          x: 120,
          y: 120,
          components: [{ id: "navbar", type: "daisy", variant: "navbar", dataPath: "states.navbar_shop_cart", dataRole: "widget", dataLabel: "Navbar shop/cart" }],
          data: {
            "states.navbar_shop_cart": {
              layout: "cart-profile",
              brand: "Acme Store",
              cartOpen: false,
              profileOpen: false,
              cartCount: 8,
              cartLabel: "Items",
              subtotal: "$248",
              transitionId: "t_view_cart",
              actionLabel: "View cart",
              avatar: "https://img.daisyui.com/images/stock/photo-1534528741775-53994a69daeb.webp",
              menuItems: [
                { label: "Profile", transitionId: "t_profile" },
                { label: "Settings", transitionId: "t_settings" },
                { label: "Logout", transitionId: "t_logout" }
              ],
              badge: "New"
            }
          }
        },
        { id: "view_cart", title: "View cart", body: "", components: [], data: {}, parentId: "start", x: 360, y: 120 },
        { id: "profile", title: "Profile", body: "", components: [], data: {}, parentId: "start", x: 360, y: 220 },
        { id: "settings", title: "Settings", body: "", components: [], data: {}, parentId: "start", x: 360, y: 320 },
        { id: "logout", title: "Logout", body: "", components: [], data: {}, parentId: "start", x: 360, y: 420 }
      ],
      transitions: [
        { id: "t_view_cart", from: "navbar_shop_cart", to: "view_cart", label: "View cart", condition: "", triggerType: "button", set: {} },
        { id: "t_profile", from: "navbar_shop_cart", to: "profile", label: "Profile", condition: "", triggerType: "button", set: {} },
        { id: "t_settings", from: "navbar_shop_cart", to: "settings", label: "Settings", condition: "", triggerType: "button", set: {} },
        { id: "t_logout", from: "navbar_shop_cart", to: "logout", label: "Logout", condition: "", triggerType: "button", set: {} }
      ]
    });

    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("start");
    await app.getByRole("button", { name: "Navbar shop/cart" }).click();
    await expect(app.locator("#statePill")).toHaveText("navbar_shop_cart");

    const navbar = app.locator(".navbar").first();
    await navbar.locator(".dropdown.dropdown-end").nth(1).locator("[role='button']").click();
    await expect(navbar.locator(".menu.dropdown-content button[data-transition-id]")).toHaveText(["Profile", "Settings", "Logout"]);
    await navbar.locator(".menu.dropdown-content button[data-transition-id]", { hasText: "Settings" }).click();

    await expect(app.locator("#statePill")).toHaveText("settings");
    await expect(app.getByRole("button", { name: "Logout" })).toHaveCount(0);
    await expect(app.locator("button[data-transition-id]")).toHaveCount(0);
    await expect(app.locator("#screen")).toHaveText("Settings");
  });

  test("child output proxy stops without a real parent out transition @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "Nested Proxy Stop",
      initial: "start",
      boundary: { entryId: "start", exitId: "state_7", entryDisabled: false, exitDisabled: false },
      states: [
        {
          id: "start",
          title: "Start",
          body: "",
          components: [],
          data: {},
          boundary: { entryId: "navbar_shop_cart", exitId: "navbar_shop_cart", entryDisabled: false, exitDisabled: false },
          x: 120,
          y: 180
        },
        { id: "navbar_shop_cart", title: "Navbar shop/cart", body: "", components: [], data: {}, parentId: "start", x: 120, y: 120 },
        { id: "settings", title: "Settings", body: "", components: [], data: {}, parentId: "start", x: 360, y: 120 },
        { id: "state_7", title: "State 7", body: "", components: [], data: {}, x: 520, y: 180 }
      ],
      transitions: [
        { id: "t_settings", from: "navbar_shop_cart", to: "settings", label: "Settings", condition: "", triggerType: "button", set: {} },
        { id: "t_back", from: "settings", to: "navbar_shop_cart", label: "Back to navbar", condition: "", triggerType: "button", set: {} }
      ]
    });

    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("start");
    await app.getByRole("button", { name: "Navbar shop/cart" }).click();
    await expect(app.locator("#statePill")).toHaveText("navbar_shop_cart");

    await openStateInspector(page, "navbar_shop_cart");
    await expect(page.locator("#pComponents .component-editor").filter({ hasText: "Button: To State 7" })).toHaveCount(0);

    await app.getByRole("button", { name: "Settings" }).click();
    await expect(app.locator("#statePill")).toHaveText("settings");
    await expect(app.getByRole("button", { name: "To State 7" })).toHaveCount(0);

    await app.getByRole("button", { name: "Back to navbar" }).click();
    await expect(app.locator("#statePill")).toHaveText("navbar_shop_cart");
    await expect(app.getByRole("button", { name: "To State 7" })).toHaveCount(0);
  });

  test("child output proxy follows the real parent out transition after reroutes @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "Nested Parent Out",
      initial: "start",
      states: [
        {
          id: "start",
          title: "Start",
          body: "",
          components: [],
          data: {},
          boundary: { entryId: "navbar_shop_cart", exitId: "navbar_shop_cart", entryDisabled: false, exitDisabled: false },
          x: 120,
          y: 180
        },
        { id: "navbar_shop_cart", title: "Navbar shop/cart", body: "", components: [], data: {}, parentId: "start", x: 120, y: 120 },
        { id: "settings", title: "Settings", body: "", components: [], data: {}, parentId: "start", x: 360, y: 120 },
        { id: "state_7", title: "State 7", body: "", components: [], data: {}, x: 520, y: 180 }
      ],
      transitions: [
        { id: "t_parent_out", from: "start", to: "state_7", label: "To State 7", condition: "", triggerType: "button", groupExitId: "navbar_shop_cart", set: {} },
        { id: "t_settings", from: "navbar_shop_cart", to: "settings", label: "Settings", condition: "", triggerType: "button", set: {} },
        { id: "t_back", from: "settings", to: "navbar_shop_cart", label: "Back to navbar", condition: "", triggerType: "button", set: {} }
      ]
    });

    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("start");
    await app.getByRole("button", { name: "Navbar shop/cart" }).click();
    await expect(app.locator("#statePill")).toHaveText("navbar_shop_cart");
    await expect(app.getByRole("button", { name: "To State 7" })).toBeVisible();

    await app.getByRole("button", { name: "Settings" }).click();
    await expect(app.locator("#statePill")).toHaveText("settings");
    await expect(app.getByRole("button", { name: "To State 7" })).toHaveCount(0);

    await app.getByRole("button", { name: "Back to navbar" }).click();
    await expect(app.locator("#statePill")).toHaveText("navbar_shop_cart");
    await expect(app.getByRole("button", { name: "To State 7" })).toBeVisible();

    await app.getByRole("button", { name: "To State 7" }).click();
    await expect(app.locator("#statePill")).toHaveText("state_7");
  });

  test("global json bus never persists undefined contract values @smoke", async ({ page }) => {
    await openTool(page);

    await page.evaluate(() => {
      loadEditorModel({
        version: 2,
        name: "Undefined Guard",
        initial: "start",
        states: [
          {
            id: "start",
            title: "Start",
            body: "",
            components: [{ id: "c_start", type: "text", text: "Start", url: "" }],
            data: {
              "states.start": {
                keep: "ok",
                drop: undefined,
                nested: { keep: 1, drop: undefined }
              },
              "states.start.direct_drop": undefined
            },
            dataTypes: {
              "states.start": "object",
              "states.start.drop": "text"
            },
            x: 100,
            y: 100
          },
          { id: "done", title: "Done", body: "", components: [], data: {}, x: 360, y: 100 }
        ],
        transitions: [
          {
            id: "t_done",
            from: "start",
            to: "done",
            label: "Done",
            condition: "",
            triggerType: "button",
            set: {
              "states.start.finished": true,
              "states.start.bad_set": undefined
            }
          }
        ]
      }, false);
    });

    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("start");
    await app.getByRole("button", { name: "Done" }).click();
    await expect(app.locator("#statePill")).toHaveText("done");

    const snapshot = await page.evaluate(key => {
      const paths = [];
      const walk = (value, root) => {
        if (typeof value === "undefined") {
          paths.push(root);
          return;
        }
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value)) {
          value.forEach((item, index) => walk(item, `${root}[${index}]`));
          return;
        }
        Object.entries(value).forEach(([entryKey, item]) => walk(item, `${root}.${entryKey}`));
      };
      const stored = JSON.parse(localStorage.getItem(`${key}.editor`) || localStorage.getItem(key) || "null");
      const exportedModel = definitionPayload().model;
      walk(model, "model");
      walk(latestRuntimeContext, "runtime");
      walk(exportedModel, "definition.model");
      walk(stored, "storage");
      return { paths, exportedModel, stored };
    }, STORAGE_KEY);

    expect(snapshot.paths).toEqual([]);
    expect(collectUndefinedPaths(snapshot.exportedModel)).toEqual([]);
    expect(collectUndefinedPaths(snapshot.stored)).toEqual([]);
    const startData = snapshot.exportedModel.states.find(state => state.id === "start").data["states.start"];
    expect(startData).toEqual({ keep: "ok", nested: { keep: 1 } });
    expect(snapshot.exportedModel.transitions.find(transition => transition.id === "t_done").set).toEqual({ "states.start.finished": true });
  });

  test("normalizes transition ids into the global model id space @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "Global ID Contract",
      initial: "start",
      states: [
        { id: "start", title: "Start", components: [], data: {}, x: 96, y: 120 },
        { id: "next", title: "Next", components: [], data: {}, x: 360, y: 120 },
        { id: "done", title: "Done", components: [], data: {}, x: 624, y: 120 }
      ],
      transitions: [
        { id: "start", from: "start", to: "next", label: "Go", condition: "", triggerType: "button", triggerEvent: "", set: {} },
        { id: "start", from: "next", to: "done", label: "Finish", condition: "", triggerType: "button", triggerEvent: "", set: {} }
      ]
    });

    const saved = await page.evaluate(() => definitionPayload().model);
    const stateIds = saved.states.map(state => state.id);
    const transitionIds = saved.transitions.filter(transition => !transition.boundaryFlow).map(transition => transition.id);
    expect(new Set([...stateIds, ...transitionIds]).size).toBe(stateIds.length + transitionIds.length);
    expect(transitionIds).toHaveLength(2);
    expect(transitionIds).not.toContain("start");

    const app = appFrame(page);
    await expect(app.getByRole("button", { name: "Go", exact: true })).toHaveCount(1);
    await app.getByRole("button", { name: "Go", exact: true }).click();
    await expect(app.locator("#statePill")).toHaveText("next");
    await expect(app.getByRole("button", { name: "Finish", exact: true })).toHaveCount(1);
  });

  test("state editor exposes global-state path subscriptions without output editing @smoke", async ({ page }) => {
    await openTool(page);

    await openStateInspector(page, "login");
    await openInspectorDetails(page, "#pDataCard");

    await expect(page.locator(".global-state-subscribe-head").filter({ hasText: "Screen fields" }).first()).toBeVisible();
    await expect(page.getByText("All paths")).toBeVisible();
    await expect.poll(() => page.locator("#pSubscriptionPaths .global-state-key-card").count()).toBeGreaterThan(0);
    await openInspectorDetails(page, "#pStateTreeCard");
    await expect(page.locator("#pSubscriptionTree")).toBeVisible();
    await expect(page.locator("#pSubscriptionAdd")).toBeHidden();
    await expect(page.locator("#pOutputs")).toHaveCount(0);
  });

  test("state data card stays collapsible instead of always noisy @smoke", () => {
    const html = stateHtml();

    expect(html).toContain('<details class="inspector-collapse" id="pStateBasicsCard" open>');
    expect(html).toContain('<details class="inspector-collapse" id="pRenderCard" open>');
    expect(html).toContain('<details class="inspector-collapse data-card" id="pDataCard">');
    expect(html).toContain('<details class="inspector-collapse state-actions-card" id="pActionsCard" open>');
    expect(html).toContain('<details class="inspector-collapse inspector-subcollapse" id="pDefaultsCard">');
    expect(html).toContain('<details class="inspector-collapse inspector-subcollapse" id="pAdvancedDataCard">');
    expect(html).toContain('<details class="inspector-collapse inspector-subcollapse" id="pFetchCard">');
    expect(html).toContain('<details class="inspector-collapse inspector-subcollapse" id="pRepeatCard">');
    expect(html).toContain('<details class="inspector-collapse inspector-subcollapse" id="pStateTreeCard">');
    expect(html).toContain('<summary class="inspector-collapse-summary">');
    expect(html).toContain('<div class="inspector-collapse-body">');
    expect(html).toContain('id="pStateVariableList"');
    expect(html).toContain('id="pTemplateStateVariableList"');
    expect(html).toContain('id="pTemplateAdvancedDataCard"');
    expect(html).toContain(".state-action-grid");
    expect(html).toContain("function normalizeDataTypes");
    expect(html).toContain("dataTypes: normalizeDataTypes");
    expect(html).toContain(".inspector-collapse[open] .inspector-collapse-summary::after");
    expect(html).toContain('el.closest("details:not([open])")');
  });

  test("global-state json paths create data-wire render mappings @smoke", async ({ page }) => {
    await openTool(page);

    await openStateInspector(page, "auth_start");
    await openInspectorDetails(page, "#pDataCard");
    await openInspectorDetails(page, "#pStateTreeCard");

    const stateCurrent = page.locator('#pSubscriptionTree [data-path="state.current"]');
    await expect(stateCurrent).toBeVisible();
    await stateCurrent.locator(".global-state-json-toggle").click();

    const sourceSelect = page.locator('#pComponents .component-editor select[aria-label="Source path"]').first();
    await expect(page.locator("#pComponents .component-editor").filter({ hasText: "Field: Current screen" })).toBeVisible();
    await expect(sourceSelect).toHaveValue("state.current");
    await expect(page.locator("#pComponents .template-binding-picker")).toHaveCount(0);
    await expect.poll(async () => page.evaluate(key => {
      const stored = JSON.parse(localStorage.getItem(`${key}.editor`) || localStorage.getItem(key) || "null");
      const model = stored?.model || stored;
      return model.states.find(state => state.id === "auth_start")?.subscriptions || [];
    }, STORAGE_KEY)).toEqual([]);
  });

  test("global state json tree branches can collapse and expand @smoke", async ({ page }) => {
    await openTool(page);

    await openStateInspector(page, "auth_start");
    await openInspectorDetails(page, "#pDataCard");
    await openInspectorDetails(page, "#pStateTreeCard");

    const tree = page.locator("#pSubscriptionTree");
    const before = await tree.locator(".global-state-json-line").count();
    const toggle = tree.locator(".global-state-json-collapse").first();
    await expect(toggle).toBeVisible();

    await toggle.click();
    await expect.poll(async () => tree.locator(".global-state-json-line").count()).toBeLessThan(before);
    const collapsed = await tree.locator(".global-state-json-line").count();

    await tree.locator(".global-state-json-collapse").first().click();
    await expect.poll(async () => tree.locator(".global-state-json-line").count()).toBeGreaterThan(collapsed);
  });

  test("repeat over is selected from derived candidates, not typed as free text @smoke", async ({ page }) => {
    await openTool(page);

    await openStateInspector(page, "auth_start");
    await openInspectorDetails(page, "#pDataCard");
    await openInspectorDetails(page, "#pRepeatCard");

    const repeat = page.locator("#pRepeatPath");
    await expect(repeat).toHaveJSProperty("tagName", "SELECT");
    await expect(repeat.locator("option", { hasText: "No list" })).toHaveCount(1);
    await expect(page.locator("#pRepeatPathList")).toHaveCount(0);
  });

  test("repeat over keeps a saved selection when the inspector opens @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "Repeat Selection Smoke",
      initial: "start",
      states: [
        {
          id: "start",
          title: "Start",
          body: "",
          x: 120,
          y: 160,
          data: { items: [{ title: "One" }] },
          repeat: { path: "items", as: "item", index: "i" },
          components: [{ id: "c_item", type: "text", text: "{{item.title}}" }]
        }
      ],
      transitions: []
    });

    await page.locator('[data-id="start"]').click();

    await expect(page.locator("#pRepeatPath")).toHaveValue("items");
    await expect(page.locator("#pRepeatPreview")).toContainText("Items");
  });
});
