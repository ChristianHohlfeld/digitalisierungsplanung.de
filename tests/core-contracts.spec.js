const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { test, expect } = require("@playwright/test");

const STORAGE_KEY = "stateBlueprintHotLinked.model.v2";

function defaultTestModel() {
  return {
    version: 2,
    name: "Standard Auth Flow",
    initial: "auth_start",
    states: [
      { id: "auth_start", title: "Auth start", body: "", components: [{ id: "c_auth_start", type: "text", text: "User chooses login or registration.", url: "" }], x: 90, y: 210 },
      { id: "login", title: "Login", body: "", components: [{ id: "c_login", type: "text", text: "Email and password are entered.", url: "" }], data: { email: "", password: "" }, dataTypes: { email: "email", password: "password" }, x: 360, y: 100 },
      { id: "register", title: "Register", body: "", components: [{ id: "c_register", type: "text", text: "Create a new account with email and accepted terms.", url: "" }], data: { email: "", accepted_terms: false }, dataTypes: { email: "email", accepted_terms: "boolean" }, x: 360, y: 320 },
      { id: "error", title: "Error", body: "", components: [{ id: "c_error", type: "text", text: "Invalid credentials or registration data.", url: "" }], x: 630, y: 320 },
      { id: "logged_in", title: "Logged in", body: "", components: [{ id: "c_logged_in", type: "text", text: "Authenticated app area.", url: "" }], data: { role: "" }, dataTypes: { role: "text" }, x: 900, y: 100 },
      { id: "logged_out", title: "Logged out", body: "", components: [{ id: "c_logged_out", type: "text", text: "Session ended. User can return to login.", url: "" }], x: 900, y: 320 }
    ],
    transitions: [
      { id: "t_auth_login", from: "auth_start", to: "login", label: "Login", condition: "", set: {} },
      { id: "t_auth_register", from: "auth_start", to: "register", label: "Registrieren", condition: "", set: {} },
      { id: "t_login_success", from: "login", to: "logged_in", label: "Einloggen", condition: "states.login.email == \"user@example.com\" && states.login.password == \"secret123\"", set: {} },
      { id: "t_login_error", from: "login", to: "error", label: "Fehler", condition: "", set: {} },
      { id: "t_register_success", from: "register", to: "logged_in", label: "Account erstellen", condition: "states.register.email == \"new@example.com\" && states.register.accepted_terms", set: {} },
      { id: "t_register_error", from: "register", to: "error", label: "Fehler", condition: "", set: {} },
      { id: "t_logout", from: "logged_in", to: "logged_out", label: "Logout", condition: "", set: {} },
      { id: "t_relogin", from: "logged_out", to: "login", label: "Wieder einloggen", condition: "", set: {} },
      { id: "t_error_back", from: "error", to: "auth_start", label: "Zurück", condition: "", set: {} }
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

function editorHostSource() {
  const source = stateHtml();
  const hostSource = source.replace(/const APP_HTML = "(?:\\.|[^"\\])*";/, 'const APP_HTML = "";');
  if (hostSource === source) throw new Error("Could not isolate editor host source from APP_HTML.");
  return hostSource;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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
  await node.locator(".node-edit").click();
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
    localStorage.setItem(`${key}.editor`, JSON.stringify({ model }));
  }, { key: STORAGE_KEY, model: defaultTestModel() });
  await page.goto("/state.html");
  await expect(page.locator('[data-id="auth_start"]')).toBeVisible();
}

async function openWithModel(page, model, url = "/state.html", expectedState = model.initial) {
  await page.addInitScript(({ key, model }) => {
    for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
      localStorage.removeItem(name);
    }
    localStorage.setItem(`${key}.editor`, JSON.stringify({ model }));
  }, { key: STORAGE_KEY, model });
  await page.goto(url);
  await expect(appFrame(page).locator("#statePill")).toHaveText(expectedState);
}

async function installFakeRealtimeTransport(page, options = {}) {
  const event = {
    name: "realtime.sip.call.incoming",
    label: "Incoming call",
    detail: { caller: "text", callee: "text", callId: "text" },
    bindings: []
  };
  await page.route("https://realtime.digitalisierungsplanung.de/token**", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ token: "test-token" })
  }));
  await page.route("https://realtime.digitalisierungsplanung.de/events", route => route.fulfill({
    status: options.catalogFailure ? 503 : 200,
    contentType: "application/json",
    body: JSON.stringify(options.catalogFailure ? { error: "unavailable" } : { events: [event] })
  }));
  await page.addInitScript(() => {
    window.__fakeRealtimeSent = [];
    window.__fakeRealtimeSockets = [];
    class FakeRealtimeSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      constructor(url) {
        super();
        this.url = String(url || "");
        this.readyState = FakeRealtimeSocket.CONNECTING;
        window.__fakeRealtimeSockets.push(this);
        queueMicrotask(() => {
          this.readyState = FakeRealtimeSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        });
      }

      send(raw) {
        const message = JSON.parse(String(raw || "{}"));
        window.__fakeRealtimeSent.push(message);
        if (message.type === "join") {
          queueMicrotask(() => this.receive({
            type: "joined",
            roomId: message.roomId,
            clientId: message.clientId,
            serverTime: Date.now()
          }));
        }
      }

      receive(message) {
        this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }));
      }

      close() {
        this.readyState = FakeRealtimeSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }
    }
    window.WebSocket = FakeRealtimeSocket;
  });
  return event;
}

async function waitForRuntimeRealtimeJoin(page) {
  await expect.poll(async () => (await runtimeContext(page)).realtime?.joined).toBe(true);
}

async function receiveRuntimeRealtimeEvent(page, event, detail = {}, roomId = "contract-room", emitterId = "", options = {}) {
  await appFrame(page).locator("html").evaluate((_, payload) => {
    window.__fakeRealtimeSockets[0].receive(payload);
  }, {
    type: "runtime.event",
    roomId,
    clientId: "console",
    serverTime: Date.now(),
    name: event.name,
    emitterId,
    detail,
    event,
    emitter: emitterId && options.includeEmitter !== false
      ? { id: emitterId, label: emitterId, events: [event.name] }
      : undefined
  });
}

async function savedModel(page) {
  return page.evaluate(key => {
    const stored = JSON.parse(localStorage.getItem(`${key}.editor`) || localStorage.getItem(key) || "null");
    return stored?.model || stored || null;
  }, STORAGE_KEY);
}

async function runtimeContext(page) {
  return appFrame(page).locator("html").evaluate(() => JSON.parse(JSON.stringify(eval("context"))));
}

async function sendRuntimePayload(page, payload) {
  await page.evaluate(message => postRuntimePayload(message), payload);
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
    enterStateLayer(id, { source: "inspector", explicit: true });
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

  test("generated runtime is one canonical source without string patching @smoke", () => {
    const html = stateHtml();

    expect(html).toContain("const GENERATED_APP_HTML = APP_HTML;");
    expect(html).not.toContain("enhanceGeneratedAppHtml");
    expect(html).not.toContain("removeGeneratedRange");
    expect(html).not.toContain("replaceGeneratedRange");
    expect(html).not.toContain("function loadModel(");
    expect(html).not.toContain("STATE_EXPLORER_KEY");
    expect(html).not.toContain("persistStateTemplates");
    expect(html).not.toContain("editingTemplateId");
  });

  test("generated runtime has one used top-level implementation per named function @smoke", () => {
    const source = generatedAppHtml();
    const declarations = [...source.matchAll(/^ {4}(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)]
      .map(match => match[1]);
    const declarationCounts = declarations.reduce((counts, name) => {
      counts.set(name, (counts.get(name) || 0) + 1);
      return counts;
    }, new Map());
    const duplicates = declarations
      .filter((name, index) => declarations.indexOf(name) !== index)
      .filter((name, index, names) => names.indexOf(name) === index)
      .sort();
    const declarationOnly = [...declarationCounts]
      .filter(([name, count]) => (source.match(new RegExp(`\\b${name}\\b`, "g")) || []).length === count)
      .map(([name]) => name)
      .sort();

    expect(duplicates, "top-level runtime function names must be unique").toEqual([]);
    expect(declarationOnly, "top-level runtime functions need a source reference beyond their declaration").toEqual([]);
  });

  test("editor host has no declaration-only named functions @smoke", () => {
    const source = editorHostSource();
    const declarations = [...source.matchAll(/^[ \t]*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)]
      .map(match => match[1]);
    const declarationCounts = declarations.reduce((counts, name) => {
      counts.set(name, (counts.get(name) || 0) + 1);
      return counts;
    }, new Map());
    const declarationOnly = [...declarationCounts]
      .filter(([name, count]) => (source.match(new RegExp(`\\b${name}\\b`, "g")) || []).length === count)
      .map(([name]) => name)
      .sort();

    expect(declarationOnly, "named host functions need a product-source reference beyond their declaration").toEqual([]);
  });

  test("preview blob matches the current canonical runtime fingerprint @smoke", async ({ page }) => {
    const canonicalRuntime = generatedAppHtml();
    await page.goto("/state.html");
    const previewRuntime = await generatedPreviewHtml(page);

    expect({
      bytes: Buffer.byteLength(previewRuntime, "utf8"),
      sha256: sha256(previewRuntime)
    }).toEqual({
      bytes: Buffer.byteLength(canonicalRuntime, "utf8"),
      sha256: sha256(canonicalRuntime)
    });
  });

  test("state tool text uses clean UTF-8 and native German spelling @smoke", () => {
    const html = stateHtml();
    const mojibakePattern = new RegExp("[\\u00c2\\u00c3\\ufffd]|\\u00e2(?:[\\u0080-\\u00bf]|[^\\x00-\\x7f])");
    const legacyGermanSpellings = [
      ["Arbeitsfl", "aeche"].join(""),
      ["Schaltfl", "aeche"].join(""),
      ["Ue", "ber", "gang"].join(""),
      ["Zust", "aende"].join(""),
      ["Rueck", "gaengig"].join(""),
      ["Fuss", "zeile"].join(""),
      ["Schlies", "sen"].join(""),
      ["Ue", "ber", "schrift"].join(""),
      ["aen", "dern"].join(""),
      ["schlies", "sen"].join("")
    ];

    expect(html).not.toMatch(mojibakePattern);
    for (const spelling of legacyGermanSpellings) expect(html).not.toContain(spelling);
    expect(html).toContain("Arbeitsfläche");
    expect(html).toContain("Schaltfläche");
    expect(html).toContain("Übergang");
    expect(html).toContain("Zustände");
    expect(html).toContain("Rückgängig");
    expect(html).toContain("Fußzeile");
    expect(html).toContain("Schließen");
    expect(html).toContain("Überschrift");
    expect(html).toContain("ändern");
    expect(html).toContain("schließen");
    expect(html).toContain("flushRuntimeEvents");
    expect(html).not.toContain("flushRuntimeEreignisse");
  });

  test("generated runtime uses only German product defaults @smoke", async ({ page }) => {
    await page.goto("/state.html");
    const appHtml = await generatedPreviewHtml(page);

    for (const forbidden of [
      't.label = t.label || "Next"',
      'entry.title || "Next"',
      'createDaisyButton("Next"',
      'createDaisyButton("Prev"',
      '"No matching transition is currently available."',
      '"No file selected"',
      '"Fetch failed"',
      '"Invalid endpoint URL"',
      '"Remember me"',
      '"Login options"'
    ]) {
      expect(appHtml, `runtime must not contain product fallback ${forbidden}`).not.toContain(forbidden);
    }
    for (const expected of [
      't.label = t.label || "Weiter"',
      'entry.title || "Weiter"',
      'createDaisyButton("Weiter"',
      'createDaisyButton("Zurück"',
      '"Kein passender Übergang ist verfügbar."',
      '"Keine Datei ausgewählt"',
      '"Abruf fehlgeschlagen"'
    ]) {
      expect(appHtml).toContain(expected);
    }
  });

  test("grouping is represented by real parent states, not editorGroups metadata @smoke", () => {
    const html = stateHtml();
    const appHtml = generatedAppHtml();

    expect(html).toContain("delete m.editorGroups;");
    expect(html).toContain("delete snap.editorGroups;");
    expect(html).not.toContain("editorGroups: normalizeEditorGroups(model.editorGroups, model)");
    expect(appHtml).not.toContain("editorGroups");
  });

  test("generated blank runtime ignores unowned host messages without editor-only helpers @smoke", async ({ page }) => {
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
    await expect(page.locator("#appName")).toHaveText("Zustand");
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
      "const IS_STANDALONE_EXPORT = false;",
      'const RUNTIME_SESSION_FRAGMENT_KEY = "state-blueprint-session";',
      "function runtimeAcceptsHostMessage(evt, data)",
      "evt.source === RUNTIME_HOST_WINDOW",
      "evt.origin === RUNTIME_HOST_ORIGIN",
      "data.sessionId === RUNTIME_SESSION_ID",
      "RUNTIME_HOST_WINDOW.postMessage({ ...payload, sessionId: RUNTIME_SESSION_ID }, RUNTIME_HOST_ORIGIN);",
      'function normalizeDataSource(value, fallbackTarget = "fetch")',
      's.dataSource = normalizeDataSource(s.dataSource, "states." + s.id + ".fetch");',
      ".navbar .flex-none { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex: 0 1 auto; max-width: 100%; min-width: 0; }",
      '.dropdown[data-open="true"] > .dropdown-content.menu {',
      "function runtimeStateUsesWidgetScreen(state)",
      'let lastRenderedStateId = "";',
      "const runtimeViewStateChanged = lastRenderedStateId !== s.id;",
      "scrollRoot.scrollTop = 0;",
      'screen.className = widgetScreen ? "screen widget-screen" : "screen";',
      "runtimeBoundaryEntry: true",
      "function daisyOwnerCanWrite(component)",
      "function appendDaisyLocalActionButton(parent, component, label, onClick, className = \"\")",
      "if (detail?.transitionId && transition?.id !== detail.transitionId) return false;",
      "function daisyExplicitTransitionIds(component)",
      '"navbar", "pricing", "progress"',
      '"columns", "links", "plans"',
      'source: "pricing"',
      'variant === "card" || variant === "hero" || variant === "feature-grid" || variant === "pricing"',
      'source: "feature-grid"',
      'return daisyExplicitTransitionIds(component).has(String(transition?.id || ""));',
      "function runtimeClaimedTransitionIdsForState(state, actionTransitions)",
      "const claimedActionTransitionIds = runtimeClaimedTransitionIdsForState(s, actionTransitions);",
      'if (["bottom-navigation", "drawer", "menu", "steps", "tabs"].includes(variant)) return itemsFrom("items");',
      'source: "steps"',
      "return ownerStateId === current;",
      'button.style.setProperty("--button-color-strong", color);',
      'variant === "footer"',
      ".breadcrumbs button.breadcrumb-action",
      "entry.transitionId",
      'source: "breadcrumbs"',
      ".daisy-loading-state { display: grid; place-items: center;",
      'spinner.className = "loading loading-spinner loading-lg";',
      "body { min-height: 100vh; }"
    ]) {
      expect(appHtml, `missing enhanced preview marker: ${marker}`).toContain(marker);
    }
    for (const debugMarker of ["flow-debug", "flowDebug", "runtimeFlowDebug"]) {
      expect(appHtml, `production runtime should not contain ${debugMarker}`).not.toContain(debugMarker);
    }
    await expect(appFrame(page).locator("#flowDebug")).toHaveCount(0);
    expect(appHtml).not.toContain('postMessage(payload, "*")');
    for (const forbidden of [
      "window.opener",
      "localStorage",
      'window.addEventListener("storage"',
      "function loadModel()",
      "function saveModel()"
    ]) {
      expect(appHtml, `preview runtime must not contain ${forbidden}`).not.toContain(forbidden);
    }

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
      "function daisyTransitionSetMatchesComponent(transition, component)",
      "daisyTransitionSetMatchesComponent(transition, component)",
      "const labelOrder = new Map();",
      "const byLabel = new Map(",
      "transitionByLabel",
      'loading loading-dots loading-md',
      'daisyWrite(component, "selected", label',
      "return scoped.length ? scoped : transitions;",
      "renderOptions.renderedTransitionIds?.add"
    ]) {
      expect(appHtml, `stale unenhanced preview marker shipped: ${marker}`).not.toContain(marker);
    }
  });

  test("daisy actions require explicit transition ids instead of set-path inference @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "Explicit action id contract",
      initial: "start",
      states: [
        {
          id: "start",
          title: "Start",
          x: 120,
          y: 160,
          components: [{
            id: "hero",
            type: "daisy",
            variant: "hero",
            dataPath: "states.start.hero",
            dataRole: "widget",
            dataLabel: "Hero"
          }],
          data: {
            hero: {
              layout: "centered",
              title: "Start",
              body: "This action must not infer a transition from transition.set.",
              actionLabel: "Go",
              clicked: false
            }
          }
        },
        {
          id: "done",
          title: "Done",
          x: 480,
          y: 160,
          components: [{ id: "done_text", type: "text", text: "Reached", url: "" }],
          data: {}
        }
      ],
      transitions: [{
        id: "to_done",
        from: "start",
        to: "done",
        label: "Go",
        triggerType: "button",
        triggerEvent: "button.to_done.clicked",
        set: { "states.start.hero.clicked": true }
      }]
    };

    await openWithModel(page, model);

    const app = appFrame(page);
    await expect(app.locator(".hero")).toBeVisible();
    await expect(app.locator('.hero button[data-transition-id="to_done"]')).toHaveCount(0);

    const localAction = app.locator(".hero button").filter({ hasText: "Go" });
    await expect(localAction).toHaveCount(1);
    await localAction.click();
    await expect(app.locator("#statePill")).toHaveText("start");
  });

  test("daisy item labels do not bind flow without explicit transition ids @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "No label-bound action contract",
      initial: "start",
      states: [
        {
          id: "start",
          title: "Start",
          x: 120,
          y: 160,
          components: [{
            id: "menu",
            type: "daisy",
            variant: "menu",
            dataPath: "states.start.menu",
            dataRole: "widget",
            dataLabel: "Menu"
          }],
          data: {
            menu: {
              selected: "",
              items: ["Next"]
            }
          }
        },
        {
          id: "next",
          title: "Next",
          x: 480,
          y: 160,
          components: [],
          data: {}
        }
      ],
      transitions: [{
        id: "to_next",
        from: "start",
        to: "next",
        label: "Next",
        triggerType: "button",
        triggerEvent: "button.to_next.clicked",
        set: { "states.start.menu.selected": "Next" }
      }]
    };

    await openWithModel(page, model);

    const app = appFrame(page);
    await expect(app.locator(".menu")).toBeVisible();
    await expect(app.locator('.menu [data-transition-id="to_next"]')).toHaveCount(0);
    await expect(app.locator('.actions [data-transition-id="to_next"]')).toHaveCount(1);
    await app.locator(".menu").getByRole("button", { name: "Next", exact: true }).click();
    await expect(app.locator("#statePill")).toHaveText("start");
  });

  const daisyBindingTransitionId = "to_next";
  const daisyBindingVisibleText = "Visible action";
  const daisyBindingTransitionLabel = "Internal transition label";
  const daisyBindingModelSlot = "__stateBlueprintIdBindingMatrixModel";
  const daisyBindingCases = [
    {
      name: "button",
      variant: "button",
      data: { label: daisyBindingVisibleText, clicked: false },
      bind: data => ({ ...data, transitionId: daisyBindingTransitionId })
    },
    {
      name: "card",
      variant: "card",
      data: { title: "Card", body: "Card body", actionLabel: daisyBindingVisibleText, clicked: false },
      bind: data => ({ ...data, transitionId: daisyBindingTransitionId })
    },
    {
      name: "hero",
      variant: "hero",
      data: { layout: "centered", title: "Hero", body: "Hero body", actionLabel: daisyBindingVisibleText, clicked: false },
      bind: data => ({ ...data, transitionId: daisyBindingTransitionId })
    },
    {
      name: "modal",
      variant: "modal",
      data: { open: true, confirmed: false, openLabel: "Open dialog", title: "Dialog", body: "Dialog body", actionLabel: daisyBindingVisibleText, closeLabel: "Close" },
      bind: data => ({ ...data, transitionId: daisyBindingTransitionId })
    },
    {
      name: "feature-grid",
      variant: "feature-grid",
      data: { eyebrow: "Features", heading: "Feature-Raster", body: "Body", selected: "", items: [{ title: "Feature", body: "Feature body", actionLabel: daisyBindingVisibleText, features: [] }] },
      bind: data => ({ ...data, items: data.items.map(item => ({ ...item, transitionId: daisyBindingTransitionId })) })
    },
    {
      name: "pricing",
      variant: "pricing",
      data: { selectedPlan: "", plans: [{ title: "Team", price: "$49", period: "/mo", body: "Plan body", features: [], actionLabel: daisyBindingVisibleText }] },
      bind: data => ({ ...data, plans: data.plans.map(plan => ({ ...plan, transitionId: daisyBindingTransitionId })) })
    },
    {
      name: "breadcrumbs",
      variant: "breadcrumbs",
      data: { items: [{ label: daisyBindingVisibleText }, { label: "Current" }] },
      bind: data => ({ ...data, items: data.items.map((item, index) => index === 0 ? { ...item, transitionId: daisyBindingTransitionId } : item) })
    },
    {
      name: "footer",
      variant: "footer",
      data: { brand: "Brand", note: "Fußleistennotiz", columns: [{ title: "Links", items: [{ label: daisyBindingVisibleText }] }] },
      bind: data => ({ ...data, columns: data.columns.map(column => ({ ...column, items: column.items.map(item => ({ ...item, transitionId: daisyBindingTransitionId })) })) })
    },
    {
      name: "menu",
      variant: "menu",
      data: { selected: "", items: [{ label: daisyBindingVisibleText }] },
      bind: data => ({ ...data, items: data.items.map(item => ({ ...item, transitionId: daisyBindingTransitionId })) })
    },
    {
      name: "dropdown",
      variant: "dropdown",
      data: { selected: "", open: true, options: [{ label: daisyBindingVisibleText }] },
      bind: data => ({ ...data, options: data.options.map(item => ({ ...item, transitionId: daisyBindingTransitionId })) })
    },
    {
      name: "bottom-navigation",
      variant: "bottom-navigation",
      data: { selected: "", items: [{ label: daisyBindingVisibleText }] },
      bind: data => ({ ...data, items: data.items.map(item => ({ ...item, transitionId: daisyBindingTransitionId })) })
    },
    {
      name: "drawer",
      variant: "drawer",
      data: { selected: "", open: true, items: [{ label: daisyBindingVisibleText }] },
      bind: data => ({ ...data, items: data.items.map(item => ({ ...item, transitionId: daisyBindingTransitionId })) })
    },
    {
      name: "steps",
      variant: "steps",
      data: { current: daisyBindingVisibleText, items: [{ label: daisyBindingVisibleText, description: "Step detail" }] },
      bind: data => ({ ...data, items: data.items.map(item => ({ ...item, transitionId: daisyBindingTransitionId })) })
    },
    {
      name: "tabs",
      variant: "tabs",
      data: { selected: daisyBindingVisibleText, items: [{ label: daisyBindingVisibleText }] },
      bind: data => ({ ...data, items: data.items.map(item => ({ ...item, transitionId: daisyBindingTransitionId })) })
    },
    {
      name: "navbar-menu",
      variant: "navbar",
      data: { layout: "menu-submenu", brand: "Brand", selected: "", items: [{ label: daisyBindingVisibleText }], submenu: [], parent: "", submenuOpen: false },
      bind: data => ({ ...data, items: data.items.map(item => ({ ...item, transitionId: daisyBindingTransitionId })) })
    },
    {
      name: "navbar-search",
      variant: "navbar",
      data: { layout: "search-dropdown", brand: "Brand", selected: "", search: "", menuItems: [{ label: daisyBindingVisibleText }] },
      bind: data => ({ ...data, menuItems: data.menuItems.map(item => ({ ...item, transitionId: daisyBindingTransitionId })) })
    },
    {
      name: "navbar-cart",
      variant: "navbar",
      data: { layout: "cart-profile", brand: "Brand", selected: "", actionLabel: daisyBindingVisibleText, cartOpen: true, profileOpen: true, menuItems: [{ label: "Profile" }] },
      bind: data => ({ ...data, transitionId: daisyBindingTransitionId })
    },
    {
      name: "checkbox",
      variant: "checkbox",
      data: { label: "Accept", checked: false, submitted: false, actionLabel: daisyBindingVisibleText },
      bind: data => ({ ...data, transitionId: daisyBindingTransitionId })
    },
    {
      name: "toggle",
      variant: "toggle",
      data: { label: "Enable", checked: false, submitted: false, actionLabel: daisyBindingVisibleText },
      bind: data => ({ ...data, transitionId: daisyBindingTransitionId })
    }
  ];
  const cloneDaisyBindingData = value => JSON.parse(JSON.stringify(value));
  const daisyBindingModelFor = (spec, data) => ({
      version: 2,
      name: `ID binding ${spec.name}`,
      initial: "start",
      states: [
        {
          id: "start",
          title: "Start",
          x: 120,
          y: 160,
          components: [{
            id: `widget_${spec.name.replace(/[^a-z0-9]+/g, "_")}`,
            type: "daisy",
            variant: spec.variant,
            dataPath: "states.start.widget",
            dataRole: "widget",
            dataLabel: spec.name
          }],
          data: { widget: data }
        },
        {
          id: "next",
          title: "Next",
          x: 480,
          y: 160,
          components: [],
          data: {}
        }
      ],
      transitions: [{
        id: daisyBindingTransitionId,
        from: "start",
        to: "next",
        label: daisyBindingTransitionLabel,
        triggerType: "button",
        triggerEvent: `button.${daisyBindingTransitionId}.clicked`,
        set: { "states.start.widget.touched": true }
      }]
    });
  const daisyBindingTransitionMarkers = async app => app.locator("body").evaluate((_, id) =>
      [...document.querySelectorAll("[data-transition-id]")]
        .filter(element => element.dataset.transitionId === id)
        .map(element => ({
          text: (element.textContent || "").trim(),
          inFallbackActions: Boolean(element.closest(".actions")),
          inWidget: !element.closest(".actions")
        })),
      daisyBindingTransitionId
    );
  const installDaisyBindingModelLoader = async page => {
    await page.addInitScript(({ key, slot }) => {
      const raw = sessionStorage.getItem(slot);
      if (!raw) return;
      for (const name of [key, `${key}.editor`, `${key}.camera`, `${key}.previewCollapsed`, `${key}.stateExplorer`, `${key}.ui`]) {
        localStorage.removeItem(name);
      }
      localStorage.setItem(`${key}.editor`, JSON.stringify({ model: JSON.parse(raw) }));
    }, { key: STORAGE_KEY, slot: daisyBindingModelSlot });
    await page.goto("/state.html");
  };
  const openDaisyBindingModel = async (page, model) => {
    await page.evaluate(({ slot, model }) => {
      sessionStorage.setItem(slot, JSON.stringify(model));
    }, { slot: daisyBindingModelSlot, model });
    await page.goto("/state.html");
    await expect(appFrame(page).locator("#statePill")).toHaveText(model.initial);
    await expect(appFrame(page).locator("#screen .daisy-widget").first()).toBeAttached();
    await expect(page.locator("#syncState")).toHaveText("aktiv");
  };

  for (const spec of daisyBindingCases) {
    test(`daisy ${spec.name} flow controls use ids as binding and text only as display @smoke`, async ({ page }) => {
      await installDaisyBindingModelLoader(page);

      await test.step(`${spec.name}: visible text alone is not a binding`, async () => {
        await openDaisyBindingModel(page, daisyBindingModelFor(spec, cloneDaisyBindingData(spec.data)));
        const markers = await daisyBindingTransitionMarkers(appFrame(page));
        expect(markers.filter(marker => marker.inWidget), spec.name).toEqual([]);
        const visibleButtons = appFrame(page).getByRole("button", { name: daisyBindingVisibleText, exact: true });
        const firstVisibleButton = visibleButtons.first();
        if (await visibleButtons.count() && await firstVisibleButton.isEnabled()) {
          await firstVisibleButton.click();
          await expect(appFrame(page).locator("#statePill")).toHaveText("start");
        }
      });

      await test.step(`${spec.name}: explicit id is the binding`, async () => {
        await openDaisyBindingModel(page, daisyBindingModelFor(spec, spec.bind(cloneDaisyBindingData(spec.data))));
        let markers = [];
        await expect.poll(async () => {
          markers = await daisyBindingTransitionMarkers(appFrame(page));
          return markers.filter(marker => marker.inWidget).length;
        }, { message: `${spec.name}: waits for explicit transition marker` }).toBeGreaterThan(0);
        const widgetMarkers = markers.filter(marker => marker.inWidget);
        expect(widgetMarkers, `${spec.name}: ${JSON.stringify(markers)}`).not.toEqual([]);
        expect(widgetMarkers.some(marker => marker.text.includes(daisyBindingVisibleText)), `${spec.name}: ${JSON.stringify(markers)}`).toBe(true);
        expect(widgetMarkers.some(marker => marker.text.includes(daisyBindingTransitionLabel)), `${spec.name}: ${JSON.stringify(markers)}`).toBe(false);
        expect(markers.filter(marker => marker.inFallbackActions), `${spec.name}: ${JSON.stringify(markers)}`).toEqual([]);
        const transitionControl = appFrame(page).locator(`[data-transition-id="${daisyBindingTransitionId}"]`).first();
        if (await transitionControl.isVisible()) {
          await transitionControl.click();
          await expect(appFrame(page).locator("#statePill")).toHaveText("next");
        }
      });
    });
  }

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

  test("formal definitions require an explicit composite entry boundary @smoke", async ({ page }) => {
    await page.goto("/state.html");

    const messages = await page.evaluate(() => {
      const emptyBoundary = { entryId: "", exitId: "", entryDisabled: false, exitDisabled: false, title: "", note: "" };
      const state = (id, parentId = null) => ({
        id,
        title: id,
        components: [],
        data: {},
        dataTypes: {},
        dataSource: { url: "", target: `states.${id}.fetch`, select: "", timeoutMs: 8000, retries: 2 },
        repeat: { path: "", as: "item", index: "i" },
        dataWires: [],
        subscriptions: [],
        boundary: { ...emptyBoundary },
        parentId,
        x: 96,
        y: 120
      });
      const definition = () => ({
        kind: "state-blueprint-definition",
        schemaVersion: 2,
        app: "Zustand",
        savedAt: new Date().toISOString(),
        model: {
          version: 2,
          name: "Composite boundary",
          initial: "parent",
          boundary: { ...emptyBoundary },
          states: [state("parent"), state("child", "parent")],
          transitions: []
        },
        stateTemplates: [],
        camera: { x: 32, y: 32, scale: 1 },
        previewCollapsed: false
      });
      const validate = value => {
        try {
          validateBlueprintDefinition(value);
          return "";
        } catch (error) {
          return String(error?.message || error);
        }
      };

      const missing = definition();
      const explicit = definition();
      explicit.model.states[0].boundary.entryId = "child";
      const disabled = definition();
      disabled.model.states[0].boundary.entryDisabled = true;
      return [validate(missing), validate(explicit), validate(disabled)];
    });

    expect(messages).toEqual([
      expect.stringContaining("boundary.entryId must reference a child unless automatic entry is explicitly disabled"),
      "",
      ""
    ]);
  });

  test("formal definitions reject dotted state data keys and qualified data type keys @smoke", async ({ page }) => {
    await page.goto("/state.html");

    const messages = await page.evaluate(() => {
      const boundary = { entryId: "", exitId: "", entryDisabled: false, exitDisabled: false, title: "", note: "" };
      const baseDefinition = () => ({
        kind: "state-blueprint-definition",
        schemaVersion: 2,
        app: "Zustand",
        savedAt: new Date().toISOString(),
        model: {
          version: 2,
          name: "Canonical data",
          initial: "start",
          boundary,
          states: [{
            id: "start",
            title: "Start",
            components: [],
            data: { email: "" },
            dataTypes: { email: "email" },
            dataSource: { url: "", target: "states.start.fetch", select: "", timeoutMs: 8000, retries: 2 },
            repeat: { path: "", as: "item", index: "i" },
            dataWires: [],
            subscriptions: [],
            boundary,
            parentId: null,
            x: 96,
            y: 120
          }],
          transitions: []
        },
        stateTemplates: [],
        camera: { x: 32, y: 32, scale: 1 },
        previewCollapsed: false
      });
      const validate = definition => {
        try {
          validateBlueprintDefinition(definition);
          return "";
        } catch (error) {
          return String(error?.message || error);
        }
      };
      const dottedData = baseDefinition();
      dottedData.model.states[0].data = { "states.start.email": "" };
      dottedData.model.states[0].dataTypes = {};
      const qualifiedType = baseDefinition();
      qualifiedType.model.states[0].dataTypes = { "states.start.email": "email" };
      const passiveRenderMode = baseDefinition();
      passiveRenderMode.model.states[0].renderMode = "component";
      return [validate(dottedData), validate(qualifiedType), validate(passiveRenderMode)];
    });

    expect(messages[0]).toContain("must use a local identifier without dots");
    expect(messages[1]).toContain("must reference a local path declared in state.data");
    expect(messages[2]).toContain("renderMode is not part of the contract");
  });

  test("formal definitions reserve runtime ids for derived FSM actions @smoke", async ({ page }) => {
    await page.goto("/state.html");

    const messages = await page.evaluate(() => {
      const boundary = { entryId: "", exitId: "", entryDisabled: false, exitDisabled: false, title: "", note: "" };
      const baseDefinition = () => ({
        kind: "state-blueprint-definition",
        schemaVersion: 2,
        app: "Zustand",
        savedAt: new Date().toISOString(),
        model: {
          version: 2,
          name: "Reserved IDs",
          initial: "start",
          boundary,
          states: [{
            id: "start",
            title: "Start",
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
            id: "loop",
            from: "start",
            to: "start",
            label: "Loop",
            condition: "",
            triggerType: "button",
            triggerEvent: "button.loop.clicked",
            timerMs: 3000,
            set: {},
            groupEntryId: "",
            groupExitId: ""
          }]
        },
        stateTemplates: [],
        camera: { x: 32, y: 32, scale: 1 },
        previewCollapsed: false
      });
      const validate = definition => {
        try {
          validateBlueprintDefinition(definition);
          return "";
        } catch (error) {
          return String(error?.message || error);
        }
      };

      const stateId = baseDefinition();
      stateId.model.states[0].id = "__runtime_enter_child:parent:child";
      stateId.model.initial = "__runtime_enter_child:parent:child";
      stateId.model.transitions = [];

      const transitionId = baseDefinition();
      transitionId.model.transitions[0].id = "__runtime_enter_child:parent:child";

      const localPresetDefinition = baseDefinition();
      localPresetDefinition.stateTemplates = [{
        id: "preset_root",
        title: "Reserved preset",
        components: [],
        data: {},
        dataTypes: {},
        rootStateId: "preset_root",
        states: [],
        transitions: []
      }];

      return [validate(stateId), validate(transitionId), validate(localPresetDefinition)];
    });

    expect(messages).toEqual([
      expect.stringContaining("reserved runtime id namespace"),
      expect.stringContaining("reserved runtime id namespace"),
      expect.stringContaining("definition.stateTemplates is contract-managed")
    ]);
  });

  test("formal definitions require owned and unambiguous transition action targets @smoke", async ({ page }) => {
    await page.goto("/state.html");

    const messages = await page.evaluate(() => {
      const boundary = { entryId: "", exitId: "", entryDisabled: false, exitDisabled: false, title: "", note: "" };
      const state = (id, components = [], data = {}) => ({
        id,
        title: id,
        components,
        data,
        dataTypes: {},
        dataSource: { url: "", target: `states.${id}.fetch`, select: "", timeoutMs: 8000, retries: 2 },
        repeat: { path: "", as: "item", index: "i" },
        dataWires: [],
        subscriptions: [],
        boundary,
        parentId: null,
        x: id === "start" ? 96 : 420,
        y: 120
      });
      const baseDefinition = () => ({
        kind: "state-blueprint-definition",
        schemaVersion: 2,
        app: "Zustand",
        savedAt: new Date().toISOString(),
        model: {
          version: 2,
          name: "Action bindings",
          initial: "start",
          boundary,
          states: [
            state("start", [{
              id: "action",
              type: "daisy",
              text: "",
              url: "",
              variant: "button",
              dataPath: "states.start.widget",
              dataRole: "widget",
              dataLabel: "Action"
            }], { widget: { label: "Weiter", transitionId: "to_done" } }),
            state("done")
          ],
          transitions: [{
            id: "to_done",
            from: "start",
            to: "done",
            label: "Weiter",
            condition: "",
            triggerType: "button",
            triggerEvent: "button.to_done.clicked",
            timerMs: 3000,
            set: {},
            groupEntryId: "",
            groupExitId: ""
          }]
        },
        stateTemplates: [],
        camera: { x: 32, y: 32, scale: 1 },
        previewCollapsed: false
      });
      const validate = definition => {
        try {
          validateBlueprintDefinition(definition);
          return "";
        } catch (error) {
          return String(error?.message || error);
        }
      };

      const valid = baseDefinition();
      const nonButton = baseDefinition();
      nonButton.model.transitions[0].triggerType = "timer";
      nonButton.model.transitions[0].triggerEvent = "timer.to_done.done";
      const missing = baseDefinition();
      missing.model.states[0].data.widget.transitionId = "missing";
      const foreign = baseDefinition();
      foreign.model.states.push(state("other"));
      foreign.model.transitions[0].from = "other";
      const repeatedControl = baseDefinition();
      repeatedControl.model.states[0].components.push({
        id: "repeated",
        type: "transitionButton",
        text: "",
        url: "",
        variant: "",
        transitionId: "to_done"
      });

      const conflict = baseDefinition();
      conflict.model.states[0].data.widget.url = "https://example.com";
      const linkOnly = baseDefinition();
      linkOnly.model.states[0].data.widget.transitionId = "";
      linkOnly.model.states[0].data.widget.url = "https://example.com";

      return [validate(valid), validate(nonButton), validate(missing), validate(foreign), validate(repeatedControl), validate(conflict), validate(linkOnly)];
    });

    expect(messages).toEqual([
      "",
      "",
      expect.stringContaining("must reference an existing transition"),
      expect.stringContaining("must reference an outgoing transition of start"),
      "",
      expect.stringContaining("must not define both a transition and a URL"),
      ""
    ]);
  });

  test("formal definitions enforce deterministic effective trigger ownership @smoke", async ({ page }) => {
    await page.goto("/state.html");
    await page.waitForFunction(() => eval("Boolean(productContract && productContract.triggerTypes && productContract.triggerTypes.length)"));

    const messages = await page.evaluate(() => {
      const boundary = { entryId: "", exitId: "", entryDisabled: false, exitDisabled: false, title: "", note: "" };
      const state = (id, parentId = null) => ({
        id,
        title: id,
        components: [],
        data: {},
        dataTypes: {},
        dataSource: { url: "", target: `states.${id}.fetch`, select: "", timeoutMs: 8000, retries: 2 },
        repeat: { path: "", as: "item", index: "i" },
        dataWires: [],
        subscriptions: [],
        boundary,
        parentId,
        x: 100,
        y: 100
      });
      const transition = (id, to, triggerType, triggerEvent = "") => ({
        id,
        from: "start",
        to,
        label: id,
        condition: "",
        triggerType,
        triggerEvent,
        timerMs: 100,
        set: {},
        groupEntryId: "",
        groupExitId: ""
      });
      const definition = () => ({
        kind: "state-blueprint-definition",
        schemaVersion: 2,
        app: "Zustand",
        savedAt: new Date().toISOString(),
        model: {
          version: 2,
          name: "Trigger ownership",
          initial: "start",
          boundary,
          states: [state("start"), state("a"), state("b"), state("c")],
          transitions: [
            transition("click_a", "a", "button", "button.click_a.clicked"),
            transition("event_b", "b", "realtime", "realtime.sip.call.incoming")
          ]
        },
        stateTemplates: [],
        camera: { x: 32, y: 32, scale: 1 },
        previewCollapsed: false
      });
      const validate = value => {
        try {
          validateBlueprintDefinition(value);
          return "";
        } catch (error) {
          return String(error?.message || error);
        }
      };

      const valid = definition();
      const distinctButtons = definition();
      distinctButtons.model.transitions = [
        transition("click_a", "a", "button", "button.click_a.clicked"),
        transition("click_b", "b", "button", "button.click_b.clicked")
      ];
      const parallelRoute = definition();
      parallelRoute.model.transitions = [
        transition("click_a", "a", "button", "button.click_a.clicked"),
        transition("event_a", "a", "realtime", "realtime.sip.call.incoming")
      ];
      const guardedCondition = definition();
      guardedCondition.model.states[0].data.route = "b";
      guardedCondition.model.states[0].dataTypes.route = "text";
      guardedCondition.model.transitions[1].condition = 'states.start.route == "b"';
      guardedCondition.model.transitions.push({
        ...transition("event_c", "c", "realtime", "realtime.sip.call.incoming"),
        condition: 'states.start.route == "c"'
      });
      const matchedDistinct = definition();
      matchedDistinct.model.transitions = [
        {
          ...transition("event_b", "b", "realtime", "realtime.sip.call.incoming"),
          triggerMatch: { field: "caller", operator: "equals", value: "Heinz" }
        },
        {
          ...transition("event_c", "c", "realtime", "realtime.sip.call.incoming"),
          triggerMatch: { field: "caller", operator: "equals", value: "Mueller" }
        }
      ];
      const matchedDuplicate = definition();
      matchedDuplicate.model.transitions = [
        {
          ...transition("event_b", "b", "realtime", "realtime.sip.call.incoming"),
          triggerMatch: { field: "caller", operator: "equals", value: "Heinz" }
        },
        {
          ...transition("event_c", "c", "realtime", "realtime.sip.call.incoming"),
          triggerMatch: { field: "caller", operator: "equals", value: "Heinz" }
        }
      ];
      const matchedRanges = definition();
      matchedRanges.model.transitions = [
        {
          ...transition("short_call", "b", "realtime", "realtime.sip.call.ended"),
          triggerMatch: { field: "duration", operator: "lte", value: 30 }
        },
        {
          ...transition("long_call", "c", "realtime", "realtime.sip.call.ended"),
          triggerMatch: { field: "duration", operator: "gt", value: 30 }
        }
      ];
      const overlappingRanges = definition();
      overlappingRanges.model.transitions = [
        {
          ...transition("medium_call", "b", "realtime", "realtime.sip.call.ended"),
          triggerMatch: { field: "duration", operator: "gt", value: 30 }
        },
        {
          ...transition("review_call", "c", "realtime", "realtime.sip.call.ended"),
          triggerMatch: { field: "duration", operator: "lte", value: 50 }
        }
      ];
      const duplicateChange = definition();
      duplicateChange.model.transitions = [
        transition("change_a", "a", "change", "change.states.start.value"),
        transition("change_b", "b", "change", "change.states.start.value")
      ];
      const duplicateWildcardChange = definition();
      duplicateWildcardChange.model.transitions = [
        transition("change_a", "a", "change"),
        transition("change_b", "b", "change")
      ];
      const duplicateEvent = definition();
      duplicateEvent.model.transitions = [
        transition("event_a", "a", "event", "event.route"),
        transition("event_b", "b", "event", "event.route")
      ];
      const duplicateRealtime = definition();
      duplicateRealtime.model.transitions.push(transition("event_c", "c", "realtime", "realtime.sip.call.incoming"));
      const timers = definition();
      timers.model.transitions = [transition("timer_a", "a", "timer"), transition("timer_b", "b", "timer")];
      const automatic = definition();
      automatic.model.transitions[0].triggerType = "auto";
      automatic.model.transitions[0].triggerEvent = "auto.click_a";
      const unknown = definition();
      unknown.model.transitions[0].triggerType = "click";
      const missing = definition();
      missing.model.transitions[1].triggerEvent = "";
      const childBoundary = definition();
      childBoundary.model.states = [state("parent"), state("child", "parent"), state("sibling", "parent"), state("outside")];
      childBoundary.model.states[0].boundary = { ...boundary, entryId: "child" };
      childBoundary.model.initial = "parent";
      childBoundary.model.transitions = [
        { ...transition("parent_exit", "outside", "realtime", "realtime.sip.call.incoming"), from: "parent", groupExitId: "child" },
        { ...transition("child_route", "sibling", "realtime", "realtime.sip.call.incoming"), from: "child" }
      ];
      const structuralFlow = definition();
      structuralFlow.model.transitions = [
        transition("auto_a", "a", "auto", "auto.auto_a"),
        transition("flow_b", "b", "flow", "flow.child.entry")
      ];

      return [
        valid,
        distinctButtons,
        parallelRoute,
        guardedCondition,
        matchedDistinct,
        matchedDuplicate,
        matchedRanges,
        overlappingRanges,
        duplicateChange,
        duplicateWildcardChange,
        duplicateEvent,
        duplicateRealtime,
        timers,
        automatic,
        unknown,
        missing,
        childBoundary,
        structuralFlow
      ].map(validate);
    });

    expect(messages).toEqual([
      "",
      "",
      "",
      expect.stringContaining("duplicates trigger realtime:realtime.sip.call.incoming|match:*"),
      "",
      expect.stringContaining("duplicates trigger realtime:realtime.sip.call.incoming|match:caller:equals:\"Heinz\""),
      "",
      expect.stringContaining("overlaps trigger match realtime:realtime.sip.call.ended"),
      expect.stringContaining("duplicates trigger change:change.states.start.value"),
      expect.stringContaining("must reference one concrete change bus path"),
      expect.stringContaining("duplicates trigger event:event.route"),
      expect.stringContaining("duplicates trigger realtime:realtime.sip.call.incoming|match:*"),
      expect.stringContaining("duplicates trigger timer"),
      expect.stringContaining("must contain only one auto transition"),
      expect.stringContaining("triggerType must be one of button, change, event, realtime, api, timer, auto"),
      expect.stringContaining("must reference a realtime event declared by the Product Contract"),
      expect.stringContaining("duplicates trigger realtime:realtime.sip.call.incoming|match:*"),
      expect.stringContaining("triggerType must be one of button, change, event, realtime, api, timer, auto")
    ]);
  });

  test("formal definitions require server-declared contract event fields in conditions @smoke", async ({ page }) => {
    await page.goto("/state.html");
    await page.waitForFunction(() => eval("Boolean(productContract && productContract.stateContributions && productContract.stateContributions.length)"));

    const messages = await page.evaluate(() => {
      const boundary = { entryId: "", exitId: "", entryDisabled: false, exitDisabled: false, title: "", note: "" };
      const definition = condition => ({
        kind: "state-blueprint-definition",
        schemaVersion: 2,
        app: "Zustand",
        savedAt: new Date().toISOString(),
        model: {
          version: 2,
          name: "Server field contract",
          initial: "start",
          boundary,
          states: [
            {
              id: "start",
              title: "Start",
              components: [],
              data: {},
              dataTypes: {},
              dataSource: { url: "", target: "states.start.fetch", select: "", timeoutMs: 8000, retries: 2 },
              repeat: { path: "", as: "item", index: "i" },
              dataWires: [],
              subscriptions: [],
              boundary,
              x: 100,
              y: 100
            },
            {
              id: "done",
              title: "Done",
              components: [],
              data: {},
              dataTypes: {},
              dataSource: { url: "", target: "states.done.fetch", select: "", timeoutMs: 8000, retries: 2 },
              repeat: { path: "", as: "item", index: "i" },
              dataWires: [],
              subscriptions: [],
              boundary,
              x: 320,
              y: 100
            }
          ],
          transitions: [{
            id: "to_done",
            from: "start",
            to: "done",
            label: "Done",
            condition,
            triggerType: "event",
            triggerEvent: "event.route",
            set: {},
            groupEntryId: "",
            groupExitId: ""
          }]
        },
        stateTemplates: [],
        camera: { x: 0, y: 0, scale: 1 },
        previewCollapsed: false
      });
      const validate = value => {
        try {
          validateBlueprintDefinition(value);
          return "";
        } catch (error) {
          return String(error?.message || error);
        }
      };
      return [
        validate(definition('events.realtime.sip.call.incoming.detail.caller == "+491234"')),
        validate(definition('events.realtime.sip.call.incoming.detail.kunde == "Heinz"')),
        validate(definition("states.start.value == null")),
        validate(definition("states.start.value != undefined"))
      ];
    });

    expect(messages).toEqual([
      "",
      expect.stringContaining("must reference a field declared by the Product Contract"),
      expect.stringContaining("contains an invalid literal"),
      expect.stringContaining("contains an invalid literal")
    ]);
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

  test("generated runtime keeps normal named transitions visible as buttons @smoke", async ({ page }) => {
    const html = stateHtml();
    await page.goto("/state.html");
    const appHtml = await generatedPreviewHtml(page);

    expect(appHtml).toContain("function transitionIsButtonAction");
    expect(appHtml).toContain("function normalizeTransitionTriggerEvent");
    expect(html).toContain("function normalizeTransitionTriggerEvent");
    expect(appHtml).toContain('if (triggerType === "button") return "button." + eventSegment');
    expect(html).toContain('if (triggerType === "button") return "button." + eventSegment');
    expect(appHtml).not.toContain('if (triggerType === "event") return "event." + eventSegment');
    expect(html).not.toContain('if (triggerType === "event") return "event." + eventSegment');
    expect(appHtml).not.toContain('value === "event" && eventName.startsWith("realtime.")');
    expect(html).not.toContain('value === "event" && eventName.startsWith("realtime.")');
    expect(appHtml).not.toContain('triggerType === "event" && normalizeTransitionEvent(transition?.triggerEvent || "").startsWith("realtime.")');
    expect(html).not.toContain('triggerType === "event" && normalizeTransitionEvent(transition?.triggerEvent || "").startsWith("realtime.")');
    expect(appHtml).toContain("function runtimeOrderActionTransitionsForState");
    expect(appHtml).toContain("const actionTransitions = runtimeOrderActionTransitionsForState(s, executableTransitions.filter(transitionIsButtonAction));");
    expect(appHtml).toContain("const executableTransitions = triggerContract.ok ? transitions : [];");
    expect(appHtml).toContain('return type === "button";');
    expect(html).toContain('return type === "button";');
    expect(appHtml).not.toContain('return type === "event" && /^button');
    expect(html).not.toContain('return type === "event" && /^button');
    expect(html).not.toContain("runtimeNextSiblingTransition");
    expect(html).not.toContain("runtimeOutgoingJs");
    expect(appHtml).not.toContain("runtimeNextSiblingTransition");
    expect(appHtml).not.toContain("__runtime_next_child");
    expect(html).toContain("function defaultTransitionLabel");
    expect(html).toContain("label: defaultTransitionLabel()");
    expect(html).toContain("function transitionColorInLayer");
    expect(html).toContain("function actionTransitionColor");
    expect(html).toContain('item.classList.add("transition-button-render")');
    expect(html).toContain('item.style.setProperty("--transition-button-color", actionTransitionColor(actionTransition, s))');
    expect(appHtml).toContain("function runtimeTransitionLabel");
    expect(appHtml).toContain("button.textContent = runtimeTransitionLabel(t)");
    expect(appHtml).toContain('return String(t?.label || "").trim() || "Weiter";');
    expect(appHtml).toContain('return transitions.length === 1 ? transitions[0].id : "";');
    expect(appHtml).not.toContain('return transitions[0]?.id || "";');
    expect(appHtml).not.toContain("firstInternalEntryState");
    expect(appHtml).not.toContain("function isNegativeTransition");
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
    const { productContractResponse } = require("../server/product-contract");
    const { DEFAULT_EVENT_CATALOG } = require("../server/event-catalog");
    const productContract = productContractResponse(DEFAULT_EVENT_CATALOG);

    expect(html).toContain(".global-state-key-card");
    expect(html).toContain("pTransitionKeyGrid");
    expect(productContract.triggerTypes.some(type => type.id === "change" && type.label === "Daten ändern sich")).toBe(true);
    expect(productContract.triggerTypes.some(type =>
      type.id === "flow" &&
      type.internal === true &&
      type.events?.some(event => event.id === "flow.child.entry" && event.internal === true)
    )).toBe(true);
    expect(html).not.toContain(['label: "Daten aen', 'dern sich"'].join(""));
    expect(html).toContain(".data-wire-row");
    expect(html).toContain("Sichtbare Felder");
    expect(html).not.toContain('id="pSubscriptionPaths"');
    expect(html).not.toContain('id="pStateTreeCard"');
    expect(html).not.toContain("Alle Pfade");
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
    const presetCatalog = fs.readFileSync(path.join(process.cwd(), "server", "preset-catalog.js"), "utf8");

    expect(html).not.toContain("function derivedRepeatComponents");
    expect(html).toContain("function pickDerivedRepeatFields");
    expect(html).toContain("function imagePathSpecificityScore");
    expect(html).toContain("category|categories|brand|manufacturer");
    expect(appHtml).not.toContain("function runtimeDerivedRepeatComponents");
    expect(appHtml).not.toContain("function runtimeBestField");
    expect(appHtml).not.toContain("function runtimeImagePathSpecificityScore");
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
    expect(html).toContain("Sichtbare Felder");
    expect(html).toContain("applyDerivedDataWires");
    expect(html).toContain("upsertDataWire");
    expect(html).toContain("runtimeDataWireComponentsForState");
    expect(html).toContain("Liste nur wählen, wenn dieser Zustand wiederholte Einträge anzeigen soll.");
    expect(html).not.toContain("autoCreateRepeatComponents");
    expect(html).not.toContain("autoDeriveRepeatForOwner(s, null, false)");
    expect(html).not.toContain("autoDeriveRepeatForOwner");
    expect(html).not.toContain("applyDerivedDataWires(s, repeat.path, root, false)");
    expect(html).not.toContain("Fetch automap");
    expect(html).not.toContain("Open fetch automap");
    expect(html).not.toContain("api.escuelajs");
    expect(html).not.toContain('title: "Inhaltsliste"');
    expect(presetCatalog).toContain('title: "Inhaltsliste"');
    expect(presetCatalog).not.toContain('title: "API list"');
    expect(presetCatalog).not.toContain("builtin_api_list");
    expect(presetCatalog).not.toContain('title: "Theme Controller"');
    expect(presetCatalog).not.toContain('title: "Kopfleiste - Farben"');
    expect(presetCatalog).toContain('title: "Titelbereich mit Bild rechts"');
    expect(presetCatalog).toContain('title: "Aktionsbutton"');
    expect(appHtml).toContain("const SUPPORTED_DAISY_VARIANTS = new Set");
    expect(appHtml).toContain("function runtimeSupportedDaisyComponent");
    expect(html).not.toContain("pruneUnsupportedDaisyRuntime");
    expect(appHtml).not.toContain("pruneUnsupportedDaisyRuntime");
    expect(appHtml).not.toContain("pruneLegacyDaisyRuntime");
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
    expect(appHtml).not.toContain("function runtimeDerivedRepeatComponents");
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
    const hostDataSync = html.slice(
      html.indexOf("function syncRuntimeAfterStateDataChange"),
      html.indexOf("function startAppAtState")
    );
    expect(hostDataSync).toContain("syncToApp(false)");
    expect(hostDataSync).not.toContain("resetContext");
    expect(appHtml).toContain("function mergeStateDefaultValue");
    expect(appHtml).toContain('runtimeSet(path, merged.value, { source: "state-default"');
    expect(appHtml).toContain("runCurrentStateEntryEffects({ fetch: entered || currentDataSourceTargetChanged(changedTargets), defaults: true })");
    expect(appHtml).not.toContain("runtimeDefaultValuesEqual");
    expect(appHtml).toContain("function runtimeContextAfterModelUpdate");
    expect(appHtml).toContain("runtimeContextAfterModelUpdate(previousModel, model, context)");
    expect(appHtml).not.toContain("pruneRemovedStateDataDefaults");
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
    expect(html).not.toContain("function resetEditorDataSourceContext");
    expect(html).not.toContain("applyEditorDataSourceResult");
    expect(html).toContain("sourceChanged = dataSourceSignature(previous) !== dataSourceSignature(next)");
    expect(html).toContain("function renderJsonInspect");
    expect(appHtml).toContain("data: {}");
    expect(appHtml).toContain("count: 0");
    expect(appHtml).toContain('error: ""');
    expect(appHtml).toContain("function changedDataSourceTargets");
    expect(appHtml).toContain("function resetDataSourceContextTargets");
    expect(appHtml).toContain("if (changedTargets.length) resetDataSourceContextTargets(changedTargets)");
    expect(appHtml).toContain('screen.innerHTML = ""');
    expect(html).not.toContain("dataSourceRuns = new Map");
    expect(html).not.toContain("dataSourceRuns.");
    expect(appHtml).not.toContain("let dataSourceRunSerial = 0");
    expect(appHtml).not.toContain("let activeDataSourceRun = null");
  });

  test("generated runtime never infers triggers or controls from condition text @smoke", async ({ page }) => {
    await page.goto("/state.html");
    const appHtml = await generatedPreviewHtml(page);

    expect(appHtml).not.toContain("conditionMentionsDataSource");
    expect(appHtml).not.toContain("function inferVariables");
    expect(appHtml).not.toContain("const vars = inferVariables");
    expect(appHtml).not.toContain('controls.innerHTML = `<h2>Eingaben</h2>`');
    expect(appHtml).toContain("function declaredBusVariables");
    expect(appHtml).toContain("visit(state, normalizeStateDataObject(state.data))");
    expect(appHtml).toContain("function transitionMatchesRuntimeEvent");
    expect(appHtml).toContain("function runtimeTransitionMatchOk");
    expect(appHtml).toContain('if (type === "button" || type === "event" || type === "realtime" || type === "api" || type === "timer" || type === "auto" || type === "flow") return configured === eventName && runtimeTransitionMatchOk(transition, detail);');
  });

  test("data wires drive rendered content through global state @smoke", () => {
    const html = stateHtml();
    const appHtml = generatedAppHtml();

    expect(html).toContain("function normalizeDataWire(value)");
    expect(html).toContain("function dataWireFromPath");
    expect(html).not.toContain("function dataWireComponentsForState");
    expect(html).toContain("function applyDerivedDataWires");
    expect(html).toContain("dataWires: normalizeDataWires");
    expect(html).toContain("Sichtbare Felder");
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
    expect(appHtml).toContain("function daisyOwnerIsCurrent");
    expect(appHtml).toContain("function daisyOwnerCanWrite");
    expect(appHtml).toContain("function appendDaisyLocalActionButton");
    expect(appHtml).toContain("ownerId === current");
    expect(appHtml).toContain("function runtimeChildEntryTransition(state)");
    expect(appHtml).toContain("__runtime_enter_child");
    expect(appHtml).toContain("function parentExitTransitions(state, activeState = state)");
    expect(appHtml).not.toContain("combinedRender");
    expect(appHtml).not.toContain("childOutlet");
    expect(appHtml).not.toContain("passiveRender");
    expect(appHtml).toContain("scheduleDaisyCountdown(component, ownerState);");
    expect(appHtml).toContain("if (ownerStateId !== current) return;");
    expect(appHtml).not.toContain("resetDaisyCountdown");
    expect(appHtml).not.toContain("daisy-countdown-entry");
    expect(appHtml).not.toContain("resetOnEnter");
    expect(appHtml).toContain("__ownerStateId");
    expect(appHtml).toContain('if (runtimeEventKind && runtimeEventKind !== "change" && runtimeEventKind !== "fetch") return [state];');
    expect(appHtml).toContain("if (detail?.transitionId && transition?.id !== detail.transitionId) return false;");
    expect(appHtml).toContain("wireId: wire.id");
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
    expect(appHtml).toContain("function mergeStateDefaultValue");
    expect(appHtml).toContain('runtimeSet(path, merged.value, { source: "state-default"');
    expect(appHtml).toContain("runCurrentStateEntryEffects({ fetch: entered || currentDataSourceTargetChanged(changedTargets), defaults: true })");
    expect(appHtml).not.toContain("runtimeDefaultValuesEqual");
    expect(appHtml).toContain('runtimeSet(targetPath, dataSourceResult({ status: "source-changed"');
    expect(appHtml).not.toContain("function sanitizeContext");
    expect(appHtml).not.toContain("function ensureContext");
    expect(appHtml).not.toContain("function sanitizeValue");
    expect(appHtml).not.toContain("function sanitizeNumericInput");
    expect(appHtml).toContain('state: { current: m?.initial || "", previous: "", lastTransition: "" }');
    expect(appHtml).toContain("runtime: { paused: false }");
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

  test("generated runtime captures replay snapshots after committed state", () => {
    const appHtml = generatedAppHtml();
    const followStart = appHtml.indexOf("function followTransition");
    const followEnd = appHtml.indexOf("function log", followStart);
    expect(followStart).toBeGreaterThanOrEqual(0);
    expect(followEnd).toBeGreaterThan(followStart);
    const followBody = appHtml.slice(followStart, followEnd);

    expect(followBody.indexOf("applyTransitionSet(transition)")).toBeLessThan(followBody.indexOf("enterState(runtimeTarget, transition)"));
    expect(followBody.indexOf("enterState(runtimeTarget, transition)")).toBeLessThan(followBody.indexOf('runtimeSet("state.current", runtimeTarget || ""'));
    expect(followBody.indexOf('runtimeSet("state.current", runtimeTarget || ""')).toBeLessThan(followBody.indexOf('runtimeRecorderCaptureFrame("transition"'));
    expect(followBody).toContain("if (!findState(runtimeTarget)) return false;");
    expect(followBody).toContain("if (!enterState(runtimeTarget, transition)) return false;");
    expect(appHtml).toContain("function runtimeRecorderCaptureFrame");
    expect(appHtml).toContain("function runtimeRecorderRestoreFrame");
    expect(appHtml).not.toContain("runtime.path");
    expect(appHtml).not.toContain("runtime.pathName");
    expect(appHtml).not.toContain("runtimeProtocolBuildPdfBytes");
  });

  test("editor desktop panels use real resize handles and a docked preset explorer", () => {
    const html = editorHostSource();
    expect(html).toContain("--panel-resizer-hit: 36px;");
    expect(html).toContain(".panel-resizer::before");
    expect(html).toContain("left: calc(var(--inspector-panel-width) - (var(--panel-resizer-hit) / 2));");
    expect(html).toContain("right: calc(var(--preview-panel-width) - (var(--panel-resizer-hit) / 2));");
    expect(html).toContain("--state-explorer-dock-height: var(--state-explorer-dock-height-value, 154px);");
    expect(html).toContain("id=\"stateExplorerResizeHandle\"");
    expect(html).toContain("bottom: calc(var(--state-explorer-dock-height) - (var(--panel-resizer-hit) / 2));");
    expect(html).toContain("stateExplorerDockHeight = panelResize.stateExplorerHeight - deltaY;");
    expect(html).toContain("inset: 0 0 var(--state-explorer-dock-height) 0;");
    expect(html).toContain("bottom: calc(var(--state-explorer-dock-height) + 16px);");
    expect(html).toContain("function canvasViewportRect");
    expect(html).toContain("const r = canvasViewportRect();");
    expect(html).not.toContain("const mobilePreviewResize = false;");
  });

  test("generated runtime records isolated replay frames without process report state @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "Rechnungseingang",
      initial: "start",
      states: [
        {
          id: "start",
          title: "Eingang",
          body: "",
          data: { form: { label: "Betrag", value: "" }, notiz: "" },
          dataTypes: { form: "object", notiz: "text" },
          components: [{ id: "c_start", type: "daisy", variant: "input", dataPath: "states.start.form", dataRole: "widget", dataLabel: "Betrag" }],
          x: 120,
          y: 160
        },
        { id: "check", title: "Pruefung", body: "", components: [{ id: "c_check", type: "text", text: "Sachliche Pruefung laeuft.", url: "" }], x: 420, y: 160 }
      ],
      transitions: [
        {
          id: "to_check",
          from: "start",
          to: "check",
          label: "Zur Pruefung",
          condition: "",
          triggerType: "button",
          set: { "states.start.notiz": "geprueft" }
        }
      ]
    });

    const app = appFrame(page);
    await expect(app.locator("#runtimeRecordButton")).toBeVisible();
    await app.locator("#runtimeRecordButton").click();
    await expect(app.locator("#runtimeRecordButton")).toHaveText("Stop");
    await app.locator("input.input").click();
    await app.locator("input.input").pressSequentially("42.5");
    await expect.poll(async () => (await runtimeContext(page)).states?.start?.form?.value).toBe("42.5");
    await app.getByRole("button", { name: "Zur Pruefung" }).click();
    await expect(app.locator("#statePill")).toHaveText("check");
    await app.locator("#runtimeRecordButton").click();

    const recording = await app.locator("body").evaluate(() => runtimeRecorderSnapshot());
    expect(recording.active).toBe(false);
    expect(recording.frameCount).toBeGreaterThanOrEqual(3);
    expect(recording.currentFrame.current).toBe("check");
    expect(recording.currentFrame.context.states.start.form.value).toBe("42.5");
    expect(recording.currentFrame.context.states.start.notiz).toBe("geprueft");
    expect(recording.currentFrame.context.runtime.path).toBeUndefined();

    await app.locator("#runtimeReplayPrevButton").click();
    await expect(app.locator("#statePill")).toHaveText("start");
    await expect(app.locator("input.input")).toHaveValue("42.5");
    await app.locator("#runtimeReplayNextButton").click();
    await expect(app.locator("#statePill")).toHaveText("check");
    await app.locator("#runtimeReplayReverseButton").click();
    await expect.poll(async () => app.locator("#statePill").textContent()).toBe("start");
    await app.locator("#runtimeReplayPlayButton").click();
    await expect.poll(async () => app.locator("#statePill").textContent()).toBe("check");
    expect(await app.locator("#processProtocolButton, #processProtocolOverlay").count()).toBe(0);
  });

  test("generated runtime guards bus writes against unauthorized sources @smoke", async ({ page }) => {
    await page.goto("/state.html");
    const appHtml = await generatedPreviewHtml(page);

    expect(appHtml).toContain('const RUNTIME_WRITE_TOKEN = Symbol("runtime-write")');
    expect(appHtml).toContain("function runtimeWriteSourceIsAuthorized");
    expect(appHtml).toContain("function runtimeExternalWritePathIsAuthorized");
    expect(appHtml).toContain("return runtimeStateDataPathIsDeclared(path);");
    expect(appHtml).not.toContain("function runtimeBookkeepingPathIsAuthorized");
    expect(appHtml).toContain('throw new Error("Unauthorized runtime bus write: " + targetPath)');
    expect(appHtml).toContain('throw new Error("Unauthorized runtime bus write source: " + runtimeWriteSource(opts))');
    expect(appHtml).toContain("const write = writeRuntimeState(path, value, { ...opts, token: RUNTIME_WRITE_TOKEN });");
    expect(appHtml).toContain("const writeOpts = { source: \"event\", metadata: false, token: RUNTIME_WRITE_TOKEN };");
    expect(appHtml).toContain("if (!runtimeExternalWritePathIsAuthorized(binding.to)) continue;");
    expect(appHtml).toContain("runtimeSet(binding.to, value, { source: \"realtime\", eventName: \"change.\" + binding.to });");
    expect(appHtml).toContain("if (!path || !runtimeStateDataPathIsDeclared(path)) return false;");
    expect(appHtml).toContain("function runtimeUiEventIsTrusted");
    expect(appHtml).toContain("function runtimeEventDetailRequiresTrustedUiEvent");
    expect(appHtml).toContain("document.addEventListener(type, runtimeActivateTrustedUiEvent");
    expect(appHtml).toContain("if (runtimeWriteSourceRequiresTrustedUiEvent(source) && !runtimeUiCommitIsTrusted()) {");
    expect(appHtml).toContain('if (typeof render === "function") render();');
    expect(appHtml).toContain("if (runtimeEventDetailRequiresTrustedUiEvent(detail) && !runtimeUiCommitIsTrusted()) return false;");
    expect(appHtml).not.toContain('writeRuntimeState(binding.to, value');

    const currentAssignments = appHtml
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.startsWith("let current =") || /^current\s*=/.test(line));
    expect(currentAssignments).toEqual([
      "let current = model.initial;",
      "current = next;"
    ]);
  });

  test("generated runtime ignores synthetic UI events and commits real UI events through the bus @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "Trusted UI Commit",
      initial: "start",
      states: [
        {
          id: "start",
          title: "Start",
          body: "",
          x: 120,
          y: 160,
          data: { form: { value: "" } },
          dataTypes: { form: "object" },
          components: [{
            id: "form_input",
            type: "daisy",
            variant: "input",
            dataPath: "states.start.form",
            dataRole: "widget",
            dataLabel: "Form input"
          }]
        },
        { id: "done", title: "Done", body: "", x: 420, y: 160, components: [], data: { visited: false }, dataTypes: { visited: "boolean" } }
      ],
      transitions: [
        { id: "to_done", from: "start", to: "done", label: "Next", condition: "", triggerType: "button", set: {} }
      ]
    });

    const app = appFrame(page);
    await app.getByRole("button", { name: "Next" }).evaluate(button => button.click());
    await expect(app.locator("#statePill")).toHaveText("start");

    await app.locator("input").evaluate(input => {
      input.value = "synthetic";
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "synthetic", inputType: "insertText" }));
    });
    await expect.poll(async () => (await runtimeContext(page)).states?.start?.form?.value || "").toBe("");

    const input = app.locator("input");
    await input.click();
    await input.pressSequentially("real");
    await expect.poll(async () => (await runtimeContext(page)).states?.start?.form?.value || "").toBe("real");

    await app.getByRole("button", { name: "Next" }).click();
    await expect(app.locator("#statePill")).toHaveText("done");
  });

  test("external realtime bindings only write declared state data @smoke", async ({ page }) => {
    const event = await installFakeRealtimeTransport(page);
    event.bindings = [
      { from: "detail.caller", to: "states.start.remote.caller", type: "text" },
      { from: "detail.callId", to: "realtime.sip.call.incoming.callId", type: "text" }
    ];
    await openWithModel(page, {
      version: 2,
      name: "Realtime write guard",
      initial: "start",
      states: [{
        id: "start",
        title: "Start",
        x: 120,
        y: 140,
        components: [{ id: "c_start", type: "text", text: "Start", url: "" }],
        data: { remote: { caller: "" } },
        dataTypes: { remote: "object" }
      }],
      transitions: []
    }, "/state.html?room=binding-contract");

    await waitForRuntimeRealtimeJoin(page);
    await receiveRuntimeRealtimeEvent(page, event, { caller: "+491234", callId: "call-123" }, "binding-contract");

    await expect.poll(async () => runtimeContext(page).then(context => context.states?.start?.remote?.caller))
      .toBe("+491234");
    await expect.poll(async () => runtimeContext(page).then(context => context.realtime?.sip?.call?.incoming?.callId))
      .toBeUndefined();
    await expect.poll(async () => runtimeContext(page).then(context => context.lastEvent))
      .toBe("change.states.start.remote.caller");
  });

  test("runtime never infers a composite entry from child order @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "No inferred child entry",
      initial: "parent",
      states: [
        {
          id: "parent",
          title: "Parent",
          components: [{ id: "parent_text", type: "text", text: "Parent only", url: "" }],
          data: {},
          boundary: { entryId: "", exitId: "", entryDisabled: true, exitDisabled: true },
          x: 120,
          y: 140
        },
        { id: "first", title: "First", parentId: "parent", components: [], data: {}, x: 120, y: 120 },
        { id: "last", title: "Last", parentId: "parent", components: [], data: {}, x: 420, y: 120 }
      ],
      transitions: [
        { id: "last_to_first", from: "last", to: "first", label: "Back", condition: "", triggerType: "button", set: {} }
      ]
    });

    const app = appFrame(page);
    const current = await app.locator("html").evaluate(() => {
      findState("parent").boundary = { entryId: "", exitId: "", entryDisabled: false, exitDisabled: true };
      setRuntimeCurrent("parent", "hostile-model", true);
      render();
      return eval("current");
    });
    expect(current).toBe("parent");
    await expect(app.locator("#statePill")).toHaveText("parent");
    await expect(app.getByText("Parent only", { exact: true })).toBeVisible();
    await expect(app.locator("#statePill")).not.toHaveText("first");
    await expect(app.locator("#statePill")).not.toHaveText("last");
  });

  test("realtime events cannot bypass a composite parent's child-entry contract @smoke", async ({ page }) => {
    const event = await installFakeRealtimeTransport(page);
    await openWithModel(page, {
      version: 2,
      name: "Parent realtime transition",
      initial: "start",
      boundary: { entryId: "start", exitId: "done", entryDisabled: false, exitDisabled: false },
      states: [
        {
          id: "start",
          title: "Start",
          parentId: null,
          components: [],
          data: {},
          dataTypes: {},
          boundary: { entryId: "child", exitId: "exit_child", entryDisabled: false, exitDisabled: false },
          x: 120,
          y: 140
        },
        { id: "child", title: "Child", parentId: "start", components: [], data: {}, dataTypes: {}, x: 120, y: 140 },
        { id: "exit_child", title: "Exit Child", parentId: "start", components: [], data: {}, dataTypes: {}, x: 260, y: 140 },
        { id: "done", title: "Done", parentId: null, components: [], data: {}, dataTypes: {}, x: 420, y: 140 }
      ],
      transitions: [{
        id: "incoming_call",
        from: "start",
        to: "done",
        label: "Incoming call",
        condition: "",
        triggerType: "realtime",
        triggerEvent: "realtime.sip.call.incoming",
        set: {}
      }]
    }, "/state.html?room=parent-contract", "child");

    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("child");
    await expect(app.getByRole("button", { name: "Child", exact: true })).toHaveCount(0);
    await waitForRuntimeRealtimeJoin(page);
    await receiveRuntimeRealtimeEvent(page, event, { caller: "+491234" }, "parent-contract");

    await expect(app.locator("#statePill")).toHaveText("child");
    await expect.poll(async () => (await runtimeContext(page)).state?.lastTransition || "").toBe("");
  });

  for (const triggerType of ["button", "timer", "change", "event", "realtime", "auto"]) {
    test(`explicit daisy actions render only for button triggers: ${triggerType} @smoke`, async ({ page }) => {
      const triggerEvent = {
        button: "button.bound_action.clicked",
        timer: "timer.bound_action.done",
        change: "change.states.start.signal",
        event: "event.bound.action",
        realtime: "realtime.sip.call.incoming",
        auto: "auto.bound_action"
      }[triggerType];
      await openWithModel(page, {
        version: 2,
        name: `Bound ${triggerType} action`,
        initial: "start",
        states: [
          {
            id: "start",
            title: "Start",
            components: [{
              id: "bound_widget",
              type: "daisy",
              variant: "button",
              dataPath: "states.start.widget",
              dataRole: "widget",
              dataLabel: "Bound action"
            }],
            data: { allow: false, signal: false, widget: { label: "Bound action", transitionId: "bound_action" } },
            dataTypes: { allow: "boolean", signal: "boolean", widget: "object" },
            x: 120,
            y: 140
          },
          { id: "done", title: "Done", components: [], data: {}, dataTypes: {}, x: 420, y: 140 }
        ],
        transitions: [{
          id: "bound_action",
          from: "start",
          to: "done",
          label: "Bound action",
          condition: triggerType === "button" ? "" : "states.start.allow == true",
          triggerType,
          triggerEvent,
          timerMs: 100,
          set: {}
        }]
      });

      const app = appFrame(page);
      const boundAction = app.getByRole("button", { name: "Bound action", exact: true });
      if (triggerType === "button") {
        await expect(boundAction).toBeVisible();
        await boundAction.click();
        await expect(app.locator("#statePill")).toHaveText("done");
        return;
      }

      await expect(boundAction).toHaveCount(0);
      await expect(app.locator('[data-transition-id="bound_action"]')).toHaveCount(0);
      expect(await page.evaluate(() => model.states.find(state => state.id === "start")?.data?.widget?.transitionId)).toBe("bound_action");
      await expect(app.locator("#statePill")).toHaveText("start");
    });
  }

  test("daisy action slots render exactly one target or fail closed @smoke", async ({ page }) => {
    const actionState = widget => ({
      id: "start",
      title: "Start",
      components: [{
        id: "action",
        type: "daisy",
        variant: "button",
        dataPath: "states.start.widget",
        dataRole: "widget",
        dataLabel: "Action"
      }],
      data: { widget },
      dataTypes: { widget: "object" },
      x: 120,
      y: 140
    });
    await openWithModel(page, {
      version: 2,
      name: "Conflicting action target",
      initial: "start",
      states: [
        actionState({ label: "Weiter", transitionId: "to_done", url: "javascript:alert(1)" }),
        { id: "done", title: "Done", components: [], data: {}, dataTypes: {}, x: 420, y: 140 }
      ],
      transitions: [{ id: "to_done", from: "start", to: "done", label: "Weiter", triggerType: "button", set: {} }]
    });

    const app = appFrame(page);
    await expect(app.getByRole("button", { name: "Weiter", exact: true })).toHaveCount(0);
    await expect(app.getByRole("link", { name: "Weiter", exact: true })).toHaveCount(0);
    await expect(app.locator("#statePill")).toHaveText("start");

    await page.evaluate(nextState => {
      loadEditorModel({
        version: 2,
        name: "Link action target",
        initial: "start",
        states: [nextState],
        transitions: []
      }, false);
    }, actionState({ label: "Öffnen", transitionId: "", url: "https://example.com" }));
    await expect(app.getByRole("link", { name: "Öffnen", exact: true })).toHaveAttribute("href", "https://example.com");
    await expect(app.getByRole("button", { name: "Öffnen", exact: true })).toHaveCount(0);
  });

  for (const triggerType of ["button", "timer", "change", "event", "realtime", "auto"]) {
    test(`parent ${triggerType} exits become eligible only at the configured child exit @smoke`, async ({ page }) => {
      const triggerEvent = {
        button: "button.parent_out.clicked",
        timer: "timer.parent_out.done",
        change: "change.states.parent.signal",
        event: "event.parent.exit",
        realtime: "realtime.sip.call.incoming",
        auto: "auto.parent_out"
      }[triggerType];
      const realtimeEvent = triggerType === "realtime" ? await installFakeRealtimeTransport(page) : null;
      const room = `boundary-${triggerType}`;
      await openWithModel(page, {
        version: 2,
        name: `Boundary ${triggerType}`,
        initial: "parent",
        states: [
          {
            id: "parent",
            title: "Parent",
            components: [],
            data: { signal: false },
            dataTypes: { signal: "boolean" },
            boundary: { entryId: "entry_child", exitId: "exit_child", entryDisabled: false, exitDisabled: false },
            x: 120,
            y: 140
          },
          { id: "entry_child", title: "Entry child", parentId: "parent", components: [], data: {}, dataTypes: {}, x: 120, y: 140 },
          { id: "middle_child", title: "Middle child", parentId: "parent", components: [], data: {}, dataTypes: {}, x: 360, y: 140 },
          { id: "exit_child", title: "Exit child", parentId: "parent", components: [], data: {}, dataTypes: {}, x: 420, y: 140 },
          { id: "outside", title: "Outside", components: [], data: {}, dataTypes: {}, x: 720, y: 140 }
        ],
        transitions: [
          { id: "child_step", from: "entry_child", to: "middle_child", label: "Next child", condition: "", triggerType: "button", set: {} },
          { id: "child_finish", from: "middle_child", to: "exit_child", label: "Finish child", condition: "", triggerType: "button", set: {} },
          {
            id: "parent_out",
            from: "parent",
            to: "outside",
            label: "Leave parent",
            condition: "",
            triggerType,
            triggerEvent,
            timerMs: 100,
            groupExitId: "exit_child",
            set: {}
          }
        ]
      }, triggerType === "realtime" ? `/state.html?room=${room}` : "/state.html", "entry_child");

      const app = appFrame(page);
      const emit = async () => {
        if (triggerType === "realtime") {
          await receiveRuntimeRealtimeEvent(page, realtimeEvent, { callId: "boundary-test" }, room);
          return null;
        }
        if (triggerType === "change") {
          return app.locator("html").evaluate((_root, name) => {
            const path = name.replace(/^change\./, "");
            const value = !Boolean(readValueAtPath(context, path));
            return runtimeSet(path, value, { source: "event", eventName: name });
          }, triggerEvent);
        }
        return app.locator("html").evaluate((_root, { name, type }) => (
          emitRuntimeEvent(name, { type, source: type })
        ), { name: triggerEvent, type: triggerType });
      };

      if (triggerType === "realtime") await waitForRuntimeRealtimeJoin(page);
      if (["change", "event", "realtime"].includes(triggerType)) await emit();
      if (triggerType === "timer") await page.waitForTimeout(160);
      await expect(app.locator("#statePill")).toHaveText("entry_child");
      await expect(app.getByRole("button", { name: "Leave parent" })).toHaveCount(0);

      await app.getByRole("button", { name: "Next child" }).click();
      await expect(app.locator("#statePill")).toHaveText("middle_child");
      if (["change", "event", "realtime"].includes(triggerType)) await emit();
      if (triggerType === "timer") await page.waitForTimeout(160);
      await expect(app.locator("#statePill")).toHaveText("middle_child");
      await expect(app.getByRole("button", { name: "Leave parent" })).toHaveCount(0);

      await app.getByRole("button", { name: "Finish child" }).click();
      if (triggerType === "button") {
        await expect(app.locator("#statePill")).toHaveText("exit_child");
        await app.getByRole("button", { name: "Leave parent" }).click();
      } else if (["change", "event", "realtime"].includes(triggerType)) {
        await expect(app.locator("#statePill")).toHaveText("exit_child");
        const handled = await emit();
        if (triggerType !== "realtime") expect(handled).toBe(true);
      }

      await expect(app.locator("#statePill")).toHaveText("outside");
      await expect.poll(async () => (await runtimeContext(page)).state).toMatchObject({
        current: "outside",
        previous: "exit_child",
        lastTransition: "parent_out"
      });
    });
  }

  test("browser runtime has no local realtime emitter or outbound event path @smoke", async ({ page }) => {
    await installFakeRealtimeTransport(page);
    await openWithModel(page, {
      version: 2,
      name: "Realtime outbound relay",
      initial: "start",
      states: [
        { id: "start", title: "Start", components: [], data: {}, dataTypes: {}, x: 120, y: 140 },
        { id: "done", title: "Done", components: [], data: {}, dataTypes: {}, x: 420, y: 140 }
      ],
      transitions: [{
        id: "incoming_call",
        from: "start",
        to: "done",
        label: "Incoming call",
        condition: "",
        triggerType: "realtime",
        triggerEvent: "realtime.sip.call.incoming",
        set: {}
      }]
    }, "/state.html?room=outbound-contract");

    await waitForRuntimeRealtimeJoin(page);
    expect(await page.evaluate(() => window.__stateBlueprintRealtime)).toBeUndefined();
    await page.waitForTimeout(100);
    expect(await appFrame(page).locator("html").evaluate(() => window.__fakeRealtimeSent.filter(message => message.type === "runtime.event"))).toEqual([]);
    await expect(appFrame(page).locator("#statePill")).toHaveText("start");
  });

  test("runtime consumes the server-supplied realtime definition without a catalog refetch @smoke", async ({ page }) => {
    const event = await installFakeRealtimeTransport(page, { catalogFailure: true });
    await openWithModel(page, {
      version: 2,
      name: "Queued parent realtime",
      initial: "start",
      states: [
        {
          id: "start",
          title: "Start",
          components: [],
          data: {},
          dataTypes: {},
          x: 120,
          y: 140
        },
        { id: "done", title: "Done", components: [], data: {}, dataTypes: {}, x: 420, y: 140 }
      ],
      transitions: [{
        id: "incoming_call",
        from: "start",
        to: "done",
        label: "Incoming call",
        condition: "",
        triggerType: "realtime",
        triggerEvent: "realtime.sip.call.incoming",
        set: {}
      }]
    }, "/state.html?room=inbound-contract");

    await waitForRuntimeRealtimeJoin(page);
    await receiveRuntimeRealtimeEvent(page, event, {
      caller: "+491234",
      callee: "100",
      callId: "remote-123"
    }, "inbound-contract", "sip.threecx");
    await expect(appFrame(page).locator("#statePill")).toHaveText("done");
    await expect.poll(async () => (await runtimeContext(page)).emitters?.sip?.threecx).toMatchObject({
      count: 1,
      lastEvent: "realtime.sip.call.incoming",
      status: "received",
      error: ""
    });
  });

  test("runtime ignores emitter ids without a server-supplied emitter definition @smoke", async ({ page }) => {
    const event = await installFakeRealtimeTransport(page, { catalogFailure: true });
    await openWithModel(page, {
      version: 2,
      name: "Realtime emitter guard",
      initial: "start",
      states: [{ id: "start", title: "Start", components: [], data: {}, dataTypes: {}, x: 120, y: 140 }],
      transitions: []
    }, "/state.html?room=emitter-guard");

    await waitForRuntimeRealtimeJoin(page);
    await receiveRuntimeRealtimeEvent(page, event, { caller: "+491234" }, "emitter-guard", "sip.threecx", { includeEmitter: false });
    await expect.poll(async () => {
      const context = await runtimeContext(page);
      return {
        eventCount: context.events?.realtime?.sip?.call?.incoming?.count,
        emitter: context.emitters?.sip?.threecx
      };
    }).toEqual({ eventCount: 1, emitter: undefined });
  });

  test("daisy widgets cannot create undeclared bus data @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "Daisy write guard",
      initial: "start",
      states: [{
        id: "start",
        title: "Start",
        x: 120,
        y: 140,
        components: [{
          id: "unbound_button",
          type: "daisy",
          variant: "button",
          dataPath: "states.start.unbound",
          dataRole: "widget",
          dataLabel: "Click me"
        }],
        data: {}
      }],
      transitions: []
    });

    const app = appFrame(page);
    await expect(app.getByRole("button", { name: "Click me" })).toBeVisible();
    await app.getByRole("button", { name: "Click me" }).click();

    await expect.poll(async () => runtimeContext(page).then(context => context.states?.start?.unbound))
      .toBeUndefined();
  });

  test("host consumes runtime state only as an event and keeps no bus mirror @smoke", () => {
    const html = stateHtml();
    const hostHtml = html.replace(/const APP_HTML = "((?:\\.|[^"\\])*)";/, 'const APP_HTML = "";');
    expect(hostHtml).not.toContain("latestRuntimeContext");
    expect(hostHtml).not.toContain("let currentAppState");
    expect(hostHtml).not.toContain("let runtimePaused");
    expect(hostHtml).not.toContain("setEditorContextPath");
    expect(hostHtml).toContain('const runtimeEventContext = isPlainObject(data.context) ? data.context : {};');
    expect(hostHtml).toContain('refreshInspectorGlobalStateTree(runtimeEventContext);');
    expect(hostHtml).not.toContain("STATE_BLUEPRINT_RUNTIME_REPORT");
    expect(hostHtml).not.toMatch(/JSON\.parse\(JSON\.stringify\(data\.context\)\)/);
  });

  test("host runtime events do not persist bus writes into state defaults @smoke", async ({ page }) => {
    const scopePath = "states.action_state";
    await openWithModel(page, {
      version: 2,
      name: "Runtime Event Guard",
      initial: "action_state",
      states: [
        {
          id: "action_state",
          title: "Action State",
          body: "",
          x: 120,
          y: 120,
          data: {
            label: "Continue",
            clicked: false,
            clickedAt: 0
          },
          dataTypes: { label: "text", clicked: "boolean", clickedAt: "number" },
          components: [
            {
              id: "action_button",
              type: "daisy",
              variant: "button",
              dataPath: scopePath,
              dataRole: "widget",
              dataLabel: "Aktionsbutton"
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
    await expect.poll(async () => savedModel(page).then(model => model.states.find(state => state.id === "action_state")?.data))
      .toEqual({
        label: "Continue",
        clicked: false,
        clickedAt: 0
      });
  });

  test("generated runtime exposes a contract-level pause gate @smoke", () => {
    const html = stateHtml();
    const appHtml = generatedAppHtml();

    expect(html).toContain('id="btnPause"');
    expect(html).toContain('type: "STATE_BLUEPRINT_RUNTIME_CONTROL"');
    expect(appHtml).toContain('runtime: { paused: false }');
    expect(appHtml).toContain("function runtimeIsPaused()");
    expect(appHtml).toContain('readValueAtPath(context, "runtime.paused") === true');
    expect(appHtml).toContain('writeRuntimeState("runtime.paused", next');
    expect(appHtml).toContain("runtimeEventQueue = [];");
    expect(appHtml).toContain("if (runtimeIsPaused()) {");
    expect(appHtml).toContain("const eligibleTransitions = transitions.filter(t => conditionOk(t.condition));");
    expect(appHtml).not.toContain('writeRuntimeState("runtime.paused", runtimePaused');
    expect(appHtml).not.toContain("if (runtimePaused) {");
  });

  test("realtime events enter the generated runtime through the global bus @smoke", async ({ page }) => {
    await page.goto("/state.html");
    const appHtml = await generatedPreviewHtml(page);

    expect(appHtml).toContain('const RUNTIME_REALTIME_WSS_URL = "wss://realtime.digitalisierungsplanung.de/ws";');
    expect(appHtml).toContain('const RUNTIME_REALTIME_TOKEN_URL = "https://realtime.digitalisierungsplanung.de/token";');
    expect(appHtml).toContain('message.type !== "runtime.event"');
    expect(appHtml).not.toContain("STATE_BLUEPRINT_REALTIME_EVENT");
    expect(appHtml).not.toContain("STATE_BLUEPRINT_REALTIME_STATUS");
    expect(appHtml).not.toContain('type: "STATE_BLUEPRINT_RUNTIME_EVENT"');
    expect(appHtml).toContain('const count = Number(readValueAtPath(context, countPath) || 0) + 1;');
    expect(appHtml).toContain("emitRuntimeEvent(name, {");
    expect(appHtml).toContain('writeRuntimeState("events." + name + ".detail", detail');
    expect(appHtml).toContain("function applyRealtimeEventBindings");
    expect(appHtml).toContain('runtimeSet("realtime", next');
    expect(appHtml).toContain("delete m.realtime;");
    expect(appHtml).not.toContain("m.realtime = normalizeRealtimeConfig");
    expect(appHtml).toContain('writeRuntimeState("lastEvent", name');
    expect(appHtml).not.toContain("STATE_BLUEPRINT_REALTIME_EVENT\") {\n        context");
  });

  test("generated runtime owns realtime while the editor host stores no bus data @smoke", async ({ page }) => {
    const html = stateHtml();
    const hostHtml = html.replace(/const APP_HTML = "((?:\\.|[^"\\])*)";/, 'const APP_HTML = "";');
    await page.goto("/state.html");
    const appHtml = await generatedPreviewHtml(page);

    expect(appHtml).toContain('const RUNTIME_REALTIME_WSS_URL = "wss://realtime.digitalisierungsplanung.de/ws";');
    expect(appHtml).toContain("function startRuntimeRealtimeTransport()");
    expect(hostHtml).toContain("const PRODUCT_CONTRACT_URL = window.ZUSTAND_PRODUCT_CONTRACT_URL ||");
    expect(hostHtml).toContain('"https://realtime.digitalisierungsplanung.de/contract"');
    expect(hostHtml).not.toContain("const REALTIME_EVENTS_URL");
    expect(hostHtml).not.toContain("const realtimeTransport =");
    expect(hostHtml).not.toContain("async function fetchRealtimeEventConfig(name)");
    expect(hostHtml).not.toContain("function relayRuntimeBusEventToRealtime()");
    expect(hostHtml).not.toContain("function relayRuntimeEventMessageToRealtime(message)");
    expect(hostHtml).toContain("function flushPendingRuntimePayloads()");
    expect(hostHtml).toContain("let pendingFramePayloads = [];");
    expect(hostHtml).not.toContain("let pendingFramePayload = null;");
    expect(hostHtml).not.toContain("function postRealtimeStatus");
    expect(hostHtml).not.toContain('type: "STATE_BLUEPRINT_REALTIME_EVENT"');
    expect(hostHtml).not.toContain('type: "STATE_BLUEPRINT_REALTIME_STATUS"');
    expect(hostHtml).not.toContain("latestRuntimeContext");
    expect(hostHtml).not.toContain("setEditorContextPath");
    expect(hostHtml).not.toContain('localStorage.setItem("stateBlueprint.realtime');
    expect(hostHtml).not.toContain("window.__stateBlueprintRealtime");
  });

  test("host consumes product contract without local contract caches or fallback catalogs @smoke", () => {
    const html = stateHtml();
    const hostHtml = html.replace(/const APP_HTML = "((?:\\.|[^"\\])*)";/, 'const APP_HTML = "";');

    expect(hostHtml).toContain('fetch(PRODUCT_CONTRACT_URL, { method: "GET", cache: "no-store", credentials: "omit" })');
    expect(hostHtml).toContain("let contract = await ensureProductContractLoaded({ notify: false });");
    expect(hostHtml).toContain("while (!contract) {");
    expect(hostHtml).toContain("const retry = await showProductContractUnavailable();");
    expect(hostHtml).toContain("if (!retry) return;");
    expect(hostHtml).not.toContain("Product Contract nicht erreichbar");
    expect(hostHtml).not.toContain("productContractPromise");
    expect(hostHtml).not.toContain("DEFAULT_STATE_VARIABLE_TYPES");
    expect(hostHtml).not.toContain("types.length ? types : [");
    expect(hostHtml).not.toContain('{ id: "button", label: "Klick" }');
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
      /\bt\s*\.\s*event\b/,
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
    expect(hostHtml).toContain('target: normalizeContextPath(source.target, fallbackTarget)');
    expect(hostHtml).toContain('s.dataSource = normalizeDataSource(s.dataSource, stateDataScopeForId(s.id) + ".fetch");');
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
    expect(html).toContain("stateEnterPulse .64s cubic-bezier(.16, 1, .3, 1)");
    expect(html).toContain("var RUNTIME_STATE_ENTER_PULSE_MS = 720");
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
  test("only the current app frame owns host and runtime messaging @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "Owned runtime",
      initial: "start",
      states: [
        {
          id: "start",
          title: "Start",
          components: [],
          data: { remote: { caller: "" } },
          dataTypes: { remote: "object" },
          x: 120,
          y: 140
        },
        { id: "done", title: "Done", components: [], data: {}, dataTypes: {}, x: 420, y: 140 }
      ],
      transitions: [{
        id: "incoming_call",
        from: "start",
        to: "done",
        label: "Incoming call",
        condition: "",
        triggerType: "realtime",
        triggerEvent: "realtime.sip.call.incoming",
        set: {}
      }]
    };
    await openWithModel(page, model);
    await expect.poll(() => page.evaluate(() => appFrameReady)).toBe(true);
    const originalSession = await page.evaluate(() => appFrameSessionId);

    await page.evaluate(() => new Promise((resolve, reject) => {
      window.__hostileOpenCalls = 0;
      window.open = () => {
        window.__hostileOpenCalls += 1;
        return null;
      };
      const foreign = document.createElement("iframe");
      foreign.id = "foreignRuntimeFrame";
      foreign.onload = () => resolve();
      foreign.onerror = () => reject(new Error("Foreign frame failed to load."));
      foreign.src = document.querySelector("#appFrame").src;
      document.body.appendChild(foreign);
    }));
    await expect.poll(() => page.evaluate(() => typeof document.querySelector("#foreignRuntimeFrame")?.contentWindow?.postHostMessage))
      .toBe("function");

    await page.evaluate(() => {
      const foreign = document.querySelector("#foreignRuntimeFrame").contentWindow;
      foreign.postHostMessage({
        type: "STATE_BLUEPRINT_RUNTIME_STATE",
        current: "done",
        context: { state: { current: "done" }, attacked: true }
      });
      foreign.postHostMessage({ type: "STATE_BLUEPRINT_SHORTCUT", action: "new" });
      foreign.postHostMessage({ type: "STATE_BLUEPRINT_OPEN_URL", url: "https://example.test/attack" });
      foreign.eval(`
        const target = parent.document.querySelector("#appFrame").contentWindow;
        const send = payload => target.postMessage({ ...payload, sessionId: RUNTIME_SESSION_ID }, location.origin);
        send({ type: "STATE_BLUEPRINT_RUNTIME_CONTROL", paused: true });
        send({
          type: "STATE_BLUEPRINT_MODEL",
          reset: true,
          model: {
            version: 2,
            name: "Foreign model",
            initial: "done",
            states: [{ id: "done", title: "Compromised", components: [], data: {}, dataTypes: {} }],
            transitions: []
          }
        });
        send({
          type: "STATE_BLUEPRINT_REALTIME_EVENT",
          name: "realtime.sip.call.incoming",
          detail: { caller: "foreign" },
          event: { name: "realtime.sip.call.incoming", bindings: [] }
        });
      `);
    });

    await page.waitForTimeout(100);
    expect((await savedModel(page)).name).toBe("Owned runtime");
    expect(await page.evaluate(() => ({ activeState: hostRuntimeStateView(), opens: window.__hostileOpenCalls })))
      .toMatchObject({ activeState: "start", opens: 0 });
    expect((await runtimeContext(page)).attacked).toBeUndefined();
    expect((await runtimeContext(page)).runtime?.paused).toBe(false);
    await expect(appFrame(page).locator("#appName")).toHaveText("Owned runtime");
    await expect(appFrame(page).locator("#statePill")).toHaveText("start");
    await expect(appFrame(page).locator("h1")).toHaveText("Start");
    await expect(page.locator("#modalBackdrop")).toBeHidden();

    await page.evaluate(() => reloadAppFrame(null, { preserveCurrent: true }));
    await expect.poll(() => page.evaluate(() => appFrameReady)).toBe(true);
    const reloadedSession = await page.evaluate(() => appFrameSessionId);
    expect(reloadedSession).not.toBe(originalSession);
    await appFrame(page).locator("html").evaluate((_, staleSession) => {
      window.parent.postMessage({
        type: "STATE_BLUEPRINT_RUNTIME_STATE",
        sessionId: staleSession,
        current: "done",
        context: { state: { current: "done" }, stale: true }
      }, location.origin);
    }, originalSession);
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => hostRuntimeStateView())).toBe("start");
    expect((await runtimeContext(page)).stale).toBeUndefined();

    await sendRuntimePayload(page, {
      type: "STATE_BLUEPRINT_MODEL",
      model,
      reset: true,
      startStateId: "done",
      paused: false
    });
    await expect(appFrame(page).locator("#statePill")).toHaveText("done");
    await expect.poll(() => page.evaluate(() => hostRuntimeStateView())).toBe("done");
  });

  test("standalone export receives realtime without an editor host @smoke", async ({ page, context: browserContext }) => {
    const event = await installFakeRealtimeTransport(page);
    await openWithModel(page, {
      version: 2,
      name: "Standalone realtime",
      initial: "start",
      states: [
        { id: "start", title: "Start", components: [], data: {}, dataTypes: {}, x: 120, y: 140 },
        { id: "done", title: "Done", components: [], data: {}, dataTypes: {}, x: 420, y: 140 }
      ],
      transitions: [{
        id: "incoming_call",
        from: "start",
        to: "done",
        label: "Incoming call",
        condition: "",
        triggerType: "realtime",
        triggerEvent: event.name,
        set: {}
      }]
    });
    const exportedHtml = await page.evaluate(() => buildStandaloneAppHtml(GENERATED_APP_HTML, definitionPayload()));
    const standalone = await browserContext.newPage();
    try {
      await installFakeRealtimeTransport(standalone);
      await standalone.goto("/__standalone__#room=standalone-contract");
      await standalone.setContent(exportedHtml, { waitUntil: "domcontentloaded" });
      await expect(standalone.locator("#statePill")).toHaveText("start");
      await expect.poll(() => standalone.evaluate(() => context.realtime?.joined)).toBe(true);
      expect(await standalone.evaluate(() => hasHostWindow())).toBe(false);
      await standalone.locator("html").evaluate((_, payload) => {
        window.__fakeRealtimeSockets[0].receive(payload);
      }, {
        type: "runtime.event",
        roomId: "standalone-contract",
        clientId: "console",
        serverTime: Date.now(),
        name: event.name,
        detail: { caller: "+491234" },
        event
      });
      await expect(standalone.locator("#statePill")).toHaveText("done");
    } finally {
      await standalone.close();
    }
  });

  test("editor rejects conflicting trigger graphs before persistence or runtime sync @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "Editor trigger invariant",
      initial: "waiting",
      states: [
        { id: "waiting", title: "Waiting", components: [], data: {}, dataTypes: {}, x: 120, y: 180 },
        { id: "route_a", title: "Route A", components: [], data: {}, dataTypes: {}, x: 420, y: 100 },
        { id: "route_b", title: "Route B", components: [], data: {}, dataTypes: {}, x: 420, y: 280 }
      ],
      transitions: []
    });

    const result = await page.evaluate(() => {
      const before = modelSnapshot();
      const candidate = (id, to, triggerType, triggerEvent = "") => ({
        id,
        from: "waiting",
        to,
        label: id,
        condition: "",
        triggerType,
        triggerEvent,
        timerMs: 3000,
        set: {}
      });
      const cases = [
        { name: "change", transitions: [candidate("change_a", "route_a", "change", "change.states.waiting.value"), candidate("change_b", "route_b", "change", "change.states.waiting.value")] },
        { name: "change-wildcard", transitions: [candidate("change_a", "route_a", "change")] },
        { name: "event", transitions: [candidate("event_a", "route_a", "event", "event.route"), candidate("event_b", "route_b", "event", "event.route")] },
        { name: "realtime", transitions: [candidate("realtime_a", "route_a", "realtime", "realtime.sip.call.incoming"), candidate("realtime_b", "route_b", "realtime", "realtime.sip.call.incoming")] },
        { name: "api", transitions: [candidate("api_a", "route_a", "api", "fetch.states.waiting.fetch.success"), candidate("api_b", "route_b", "api", "fetch.states.waiting.fetch.success")] },
        { name: "api-as-event", transitions: [candidate("event_fetch", "route_a", "event", "fetch.states.waiting.fetch.success")] },
        { name: "timer", transitions: [candidate("timer_a", "route_a", "timer", "timer.a.done"), candidate("timer_b", "route_b", "timer", "timer.b.done")] },
        { name: "auto", transitions: [candidate("auto_a", "route_a", "auto", "auto.a"), candidate("button_b", "route_b", "button")] },
        { name: "missing-event", transitions: [candidate("event_missing", "route_a", "event")] },
        { name: "invalid-type", transitions: [candidate("invalid", "route_a", "click", "click.invalid")] }
      ];
      return cases.map(testCase => {
        const conflicting = JSON.parse(before);
        conflicting.transitions.push(...testCase.transitions);
        let loadError = "";
        try {
          loadEditorModel(conflicting, false);
        } catch (error) {
          loadError = String(error?.message || error);
        }
        const unchangedAfterLoad = modelSnapshot() === before;
        model.transitions.push(...JSON.parse(JSON.stringify(testCase.transitions)));
        const saved = saveModel(`test:conflicting-trigger:${testCase.name}`);
        const unchangedAfterMutation = modelSnapshot() === before;
        const stored = JSON.parse(localStorage.getItem("stateBlueprintHotLinked.model.v2.editor") || "{}");
        return {
          name: testCase.name,
          loadRejected: Boolean(loadError),
          unchangedAfterLoad,
          saved,
          unchangedAfterMutation,
          storedTransitionIds: (stored.model?.transitions || []).map(transition => transition.id)
        };
      });
    });

    expect(result.map(item => item.name)).toEqual([
      "change",
      "change-wildcard",
      "event",
      "realtime",
      "api",
      "api-as-event",
      "timer",
      "auto",
      "missing-event",
      "invalid-type"
    ]);
    expect(result.every(item =>
      item.loadRejected === true &&
      item.unchangedAfterLoad === true &&
      item.saved === false &&
      item.unchangedAfterMutation === true &&
      JSON.stringify(item.storedTransitionIds) === JSON.stringify([])
    )).toBe(true);
    expect(await appFrame(page).locator("html").evaluate(() => eval("model.transitions.map(transition => transition.id)"))).toEqual([]);
  });

  test("runtime fails closed for every externally injected trigger contract violation @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "Runtime trigger invariant",
      initial: "waiting",
      states: [
        { id: "waiting", title: "Waiting", components: [], data: {}, dataTypes: {}, x: 120, y: 180 },
        { id: "route_a", title: "Route A", components: [], data: {}, dataTypes: {}, x: 420, y: 100 },
        { id: "route_b", title: "Route B", components: [], data: {}, dataTypes: {}, x: 420, y: 280 }
      ],
      transitions: [
        { id: "to_a", from: "waiting", to: "route_a", label: "A", condition: "", triggerType: "event", triggerEvent: "event.route", set: {} }
      ]
    });

    const runtimeResult = await appFrame(page).locator("html").evaluate(() => {
      const runtimeModel = eval("model");
      const candidate = (id, triggerType, triggerEvent = "") => ({
        id,
        from: "waiting",
        to: id.endsWith("a") ? "route_a" : "route_b",
        label: id,
        condition: "",
        triggerType,
        triggerEvent,
        timerMs: 3000,
        set: {}
      });
      const scenarios = [
        { name: "change", eventName: "change.states.waiting.value", transitions: [candidate("change_a", "change", "change.states.waiting.value"), candidate("change_b", "change", "change.states.waiting.value")] },
        { name: "change-wildcard", eventName: "change.any", transitions: [candidate("change_a", "change"), candidate("change_b", "change")] },
        { name: "event", eventName: "event.route", transitions: [candidate("event_a", "event", "event.route"), candidate("event_b", "event", "event.route")] },
        { name: "realtime", eventName: "realtime.route", transitions: [candidate("realtime_a", "realtime", "realtime.route"), candidate("realtime_b", "realtime", "realtime.route")] },
        { name: "timer", eventName: "timer.timer_a.done", transitions: [candidate("timer_a", "timer", "timer.timer_a.done"), candidate("timer_b", "timer", "timer.timer_b.done")] },
        { name: "auto", eventName: "auto.auto_a", transitions: [candidate("auto_a", "auto", "auto.auto_a"), candidate("event_b", "event", "event.route")] },
        { name: "missing-event", eventName: "event.route", transitions: [candidate("event_a", "event")] },
        { name: "invalid-type", eventName: "click.invalid", transitions: [candidate("invalid_a", "click", "click.invalid")] },
        { name: "valid-buttons", transitions: [candidate("button_a", "button", "button.button_a.clicked"), candidate("button_b", "button", "button.button_b.clicked")] },
        { name: "valid-events", transitions: [candidate("event_a", "event", "event.a"), candidate("event_b", "event", "event.b")] }
      ];
      return scenarios.map(scenario => {
        runtimeModel.transitions = JSON.parse(JSON.stringify(scenario.transitions));
        eval("normalizeModel(model); render()");
        const validation = eval("runtimeValidation");
        const handled = scenario.eventName
          ? eval("emitRuntimeEvent")(scenario.eventName, { type: "event", source: "event" })
          : null;
        return {
          name: scenario.name,
          handled,
          current: eval("current"),
          reason: validation?.reason || "",
          transitionIds: validation?.transitionIds || []
        };
      });
    });

    expect(runtimeResult).toEqual([
      { name: "change", handled: false, current: "waiting", reason: "duplicate-trigger", transitionIds: ["change_a", "change_b"] },
      { name: "change-wildcard", handled: false, current: "waiting", reason: "missing-trigger", transitionIds: ["change_a"] },
      { name: "event", handled: false, current: "waiting", reason: "duplicate-trigger", transitionIds: ["event_a", "event_b"] },
      { name: "realtime", handled: false, current: "waiting", reason: "duplicate-trigger", transitionIds: ["realtime_a", "realtime_b"] },
      { name: "timer", handled: false, current: "waiting", reason: "duplicate-trigger", transitionIds: ["timer_a", "timer_b"] },
      { name: "auto", handled: false, current: "waiting", reason: "exclusive-auto", transitionIds: ["auto_a", "event_b"] },
      { name: "missing-event", handled: false, current: "waiting", reason: "missing-trigger", transitionIds: ["event_a"] },
      { name: "invalid-type", handled: false, current: "waiting", reason: "invalid-trigger-type", transitionIds: ["invalid_a"] },
      { name: "valid-buttons", handled: null, current: "waiting", reason: "", transitionIds: [] },
      { name: "valid-events", handled: null, current: "waiting", reason: "", transitionIds: [] }
    ]);
    await expect(appFrame(page).locator("#statePill")).toHaveText("waiting");
  });

  test("runtime routes fetch results only through the first-class api trigger @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "Runtime API trigger",
      initial: "waiting",
      states: [
        { id: "waiting", title: "Waiting", components: [], data: {}, dataTypes: {}, x: 120, y: 180 },
        { id: "done", title: "Done", components: [], data: {}, dataTypes: {}, x: 420, y: 100 },
        { id: "failed", title: "Failed", components: [], data: {}, dataTypes: {}, x: 420, y: 280 }
      ],
      transitions: [
        {
          id: "to_done",
          from: "waiting",
          to: "done",
          label: "Done",
          condition: "",
          triggerType: "api",
          triggerEvent: "fetch.states.waiting.fetch.success",
          set: {}
        },
        {
          id: "to_failed",
          from: "waiting",
          to: "failed",
          label: "Failed",
          condition: "",
          triggerType: "api",
          triggerEvent: "fetch.states.waiting.fetch.error",
          set: {}
        }
      ]
    });

    const runtimeResult = await appFrame(page).locator("html").evaluate(() => {
      const handled = eval("emitRuntimeEvent")("fetch.states.waiting.fetch.success", { type: "api", source: "fetch" });
      return { handled, current: eval("current"), validation: eval("runtimeValidation") };
    });

    expect(runtimeResult).toEqual({ handled: true, current: "done", validation: null });
  });

  test("canvas deletion removes the complete enriched state branch from the same runtime bus @smoke", async ({ page }) => {
    const realtimeEvent = await installFakeRealtimeTransport(page);
    realtimeEvent.bindings = [
      { from: "detail.caller", to: "states.owner.profile.caller", type: "text" }
    ];
    await openWithModel(page, {
      version: 2,
      name: "State branch cleanup",
      initial: "owner",
      states: [
        {
          id: "owner",
          title: "Owner",
          body: "",
          components: [],
          data: { profile: { caller: "", live: "" } },
          dataTypes: { "profile.caller": "text", "profile.live": "text" },
          x: 120,
          y: 180
        },
        {
          id: "survivor",
          title: "Survivor",
          body: "",
          components: [],
          data: { keep: false },
          dataTypes: { keep: "boolean" },
          x: 420,
          y: 180
        }
      ],
      transitions: [
        {
          id: "owner_realtime",
          from: "owner",
          to: "owner",
          label: "Realtime owner",
          condition: "",
          triggerType: "realtime",
          triggerEvent: realtimeEvent.name,
          set: { "states.owner.profile.live": "realtime" }
        },
        {
          id: "owner_done",
          from: "owner",
          to: "survivor",
          label: "Weiter",
          condition: "",
          triggerType: "button",
          set: { "states.survivor.keep": true }
        }
      ]
    }, "/state.html?room=contract-room");

    await waitForRuntimeRealtimeJoin(page);
    await receiveRuntimeRealtimeEvent(page, realtimeEvent, { caller: "+491234" });
    await expect.poll(async () => (await runtimeContext(page)).states?.owner).toMatchObject({
      profile: { caller: "+491234", live: "realtime" }
    });

    await appFrame(page).getByRole("button", { name: "Weiter" }).click();
    await expect.poll(async () => (await runtimeContext(page)).states?.survivor?.keep).toBe(true);
    await appFrame(page).locator("html").evaluate(() => {
      window.__contractRuntimeBus = eval("context");
    });

    await openStateInspector(page, "survivor");
    await page.locator("#pInitial").click();
    await expect.poll(async () => page.evaluate(() => model.initial)).toBe("survivor");

    await page.locator('[data-id="owner"]').click();
    await page.keyboard.press("Delete");
    await expect(page.locator('[data-id="owner"]')).toHaveCount(0);
    await expect.poll(async () => runtimeContext(page)).toMatchObject({
      states: { survivor: { keep: true } }
    });
    await expect.poll(async () => Object.prototype.hasOwnProperty.call((await runtimeContext(page)).states || {}, "owner")).toBe(false);
    expect((await runtimeContext(page)).states).not.toHaveProperty("owner");
    expect(await appFrame(page).locator("html").evaluate(() => eval("context") === window.__contractRuntimeBus)).toBe(true);

    await page.evaluate(() => eval("syncToApp(true)"));
    await expect.poll(async () => (await runtimeContext(page)).states?.survivor?.keep).toBe(false);
    expect(await appFrame(page).locator("html").evaluate(() => eval("context") === window.__contractRuntimeBus)).toBe(true);
  });

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
            { id: "wire_badge", sourcePath: "states.start.catalog.item.badge", role: "field", componentType: "text", label: "Badge" },
            { id: "wire_title", sourcePath: "states.start.catalog.item.title", role: "title", componentType: "heading", label: "Title" }
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
        { id: "to_done", from: "start", to: "done", label: "Continue", condition: "", triggerType: "button", set: { "states.done.visited": true } }
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
          repeat: { path: "states.products.catalog.items", as: "item", index: "i" },
          dataWires: [
            { id: "wire_image", sourcePath: "states.products.catalog.items.images.0", scopePath: "states.products.catalog.items", itemPath: "images.0", role: "image", componentType: "image", label: "Image" },
            { id: "wire_title", sourcePath: "states.products.catalog.items.title", scopePath: "states.products.catalog.items", itemPath: "title", role: "title", componentType: "heading", label: "Title" }
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
        { id: "t_intro", from: "entry_child", to: "exit_child", label: "Weiter", condition: "", triggerType: "button", set: {} },
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
        { id: "shell", title: "Shell", body: "", components: [], data: {}, boundary: { entryId: "inner_a", exitId: "", entryDisabled: false, exitDisabled: true }, x: 120, y: 160 },
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

  test("child exits expose real parent outs while the child canvas stays canonical @smoke", async ({ page }) => {
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

    await page.evaluate(() => {
      stopRuntimeLayerFollow(10_000);
      exitCurrentLayer({ force: true });
    });
    const parentEdge = page.locator('.edge[data-edge-id="parent_out"]');
    await expect(parentEdge).toHaveCount(1);
    const edgeColor = await parentEdge.evaluate(el => getComputedStyle(el).getPropertyValue("--edge-color").trim());
    expect(buttonStyles.parent_out.color).toBe(edgeColor);
    expect(buttonStyles.parent_out.strong).toBe(edgeColor);

    await openLayer(page, "parent", "exit_child");
    await expect(parentEdge).toHaveCount(0);
    await expect(page.locator('.edge[data-edge-id="boundary-flow:parent:input"]')).toHaveCount(1);
    await expect(page.locator('.edge[data-edge-id="boundary-flow:parent:output"]')).toHaveCount(1);
    await expect(page.locator(".edge[data-edge-id]")).toHaveCount(2);

    await app.getByRole("button", { name: "Leave" }).click();
    await expect(app.locator("#statePill")).toHaveText("outside");
  });

  test("output-proxy child exits include real parent outs beside child actions @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "Output Proxy Child Exit",
      initial: "exit_child",
      states: [
        { id: "parent", title: "Parent", body: "", components: [], data: {}, boundary: { entryId: "exit_child", exitId: "exit_child", entryDisabled: false, exitDisabled: false }, x: 120, y: 160 },
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
        { id: "parent", title: "Parent", body: "", components: [], data: {}, boundary: { entryId: "child", exitId: "", entryDisabled: false, exitDisabled: true }, x: 120, y: 160 },
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
        { id: "start", title: "Start", body: "", components: [], data: {}, boundary: { entryId: "navbar_shop_cart", exitId: "", entryDisabled: false, exitDisabled: true }, x: 120, y: 180 },
        {
          id: "navbar_shop_cart",
          title: "Kopfleiste Shop/Warenkorb",
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
    await expect(page.locator("#pComponents .component-editor").filter({ hasText: "Schaltfläche: Logout" })).toHaveCount(0);
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
          title: "Kopfleiste Shop/Warenkorb",
          body: "",
          parentId: "start",
          x: 120,
          y: 120,
          components: [{ id: "navbar", type: "daisy", variant: "navbar", dataPath: "states.navbar_shop_cart", dataRole: "widget", dataLabel: "Kopfleiste Shop/Warenkorb" }],
          data: {
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
    }, "/state.html", "navbar_shop_cart");

    const app = appFrame(page);
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
        { id: "navbar_shop_cart", title: "Kopfleiste Shop/Warenkorb", body: "", components: [], data: {}, parentId: "start", x: 120, y: 120 },
        { id: "settings", title: "Settings", body: "", components: [], data: {}, parentId: "start", x: 360, y: 120 },
        { id: "state_7", title: "State 7", body: "", components: [], data: {}, x: 520, y: 180 }
      ],
      transitions: [
        { id: "t_settings", from: "navbar_shop_cart", to: "settings", label: "Settings", condition: "", triggerType: "button", set: {} },
        { id: "t_back", from: "settings", to: "navbar_shop_cart", label: "Back to navbar", condition: "", triggerType: "button", set: {} }
      ]
    }, "/state.html", "navbar_shop_cart");

    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("navbar_shop_cart");

    await page.evaluate(() => {
      selected = selectionFromParts(["navbar_shop_cart"], []);
      showNodeInspector(byId("navbar_shop_cart"), { forceOpen: true, manualOpen: true });
    });
    await expect(page.locator("#pTitle")).toHaveValue("Kopfleiste Shop/Warenkorb");
    await expect(page.locator("#pComponents .component-editor").filter({ hasText: "Schaltfläche: Weiter" })).toHaveCount(0);

    await page.evaluate(() => startAppAtState("navbar_shop_cart", { preserveFocus: true }));
    await expect(app.locator("#statePill")).toHaveText("navbar_shop_cart");
    await app.getByRole("button", { name: "Settings" }).click();
    await expect(app.locator("#statePill")).toHaveText("settings");
    await expect(app.getByRole("button", { name: "Weiter" })).toHaveCount(0);

    await app.getByRole("button", { name: "Back to navbar" }).click();
    await expect(app.locator("#statePill")).toHaveText("navbar_shop_cart");
    await expect(app.getByRole("button", { name: "Weiter" })).toHaveCount(0);
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
        { id: "navbar_shop_cart", title: "Kopfleiste Shop/Warenkorb", body: "", components: [], data: {}, parentId: "start", x: 120, y: 120 },
        { id: "settings", title: "Settings", body: "", components: [], data: {}, parentId: "start", x: 360, y: 120 },
        { id: "state_7", title: "State 7", body: "", components: [], data: {}, x: 520, y: 180 }
      ],
      transitions: [
        { id: "t_parent_out", from: "start", to: "state_7", label: "Weiter", condition: "", triggerType: "button", groupExitId: "navbar_shop_cart", set: {} },
        { id: "t_settings", from: "navbar_shop_cart", to: "settings", label: "Settings", condition: "", triggerType: "button", set: {} },
        { id: "t_back", from: "settings", to: "navbar_shop_cart", label: "Back to navbar", condition: "", triggerType: "button", set: {} }
      ]
    }, "/state.html", "navbar_shop_cart");

    const app = appFrame(page);
    await expect(app.locator("#statePill")).toHaveText("navbar_shop_cart");
    await expect(app.getByRole("button", { name: "Weiter" })).toBeVisible();

    await app.getByRole("button", { name: "Settings" }).click();
    await expect(app.locator("#statePill")).toHaveText("settings");
    await expect(app.getByRole("button", { name: "Weiter" })).toHaveCount(0);

    await app.getByRole("button", { name: "Back to navbar" }).click();
    await expect(app.locator("#statePill")).toHaveText("navbar_shop_cart");
    await expect(app.getByRole("button", { name: "Weiter" })).toBeVisible();

    await app.getByRole("button", { name: "Weiter" }).click();
    await expect(app.locator("#statePill")).toHaveText("state_7");
  });

  test("undefined, null, array holes and non-finite bus values are rejected without mutation @smoke", async ({ page }) => {
    await openWithModel(page, {
      version: 2,
      name: "Defined JSON value contract",
      initial: "start",
      states: [
        { id: "start", title: "Start", components: [], data: { keep: "ok" }, dataTypes: { keep: "text" }, x: 96, y: 120 },
        { id: "done", title: "Done", components: [], data: {}, dataTypes: {}, x: 360, y: 120 }
      ],
      transitions: [
        { id: "to_done", from: "start", to: "done", label: "Done", condition: "", triggerType: "button", triggerEvent: "", set: {} }
      ]
    });

    const result = await page.evaluate(() => {
      const before = modelSnapshot();
      const cases = [
        ["undefined-state", candidate => { candidate.states[0].data.invalid = undefined; }],
        ["null-state", candidate => { candidate.states[0].data.invalid = null; }],
        ["non-finite-state", candidate => { candidate.states[0].data.invalid = Number.NaN; }],
        ["array-hole-state", candidate => { const sparse = []; sparse.length = 1; candidate.states[0].data.invalid = sparse; }],
        ["undefined-set", candidate => { candidate.transitions[0].set["states.start.invalid"] = undefined; }],
        ["null-set", candidate => { candidate.transitions[0].set["states.start.invalid"] = null; }]
      ];
      const rejected = cases.map(([name, mutate]) => {
        const candidate = JSON.parse(before);
        mutate(candidate);
        let error = "";
        try { loadEditorModel(candidate, false); } catch (caught) { error = String(caught?.message || caught); }
        return { name, error, unchanged: modelSnapshot() === before };
      });
      model.states[0].data.invalid = null;
      const saved = saveModel("test:invalid-json-value");
      return { rejected, saved, restored: modelSnapshot() === before };
    });

    expect(result.rejected.map(item => item.name)).toEqual([
      "undefined-state",
      "null-state",
      "non-finite-state",
      "array-hole-state",
      "undefined-set",
      "null-set"
    ]);
    expect(result.rejected.every(item => item.error && item.unchanged)).toBe(true);
    expect(result.saved).toBe(false);
    expect(result.restored).toBe(true);
    await expect(appFrame(page).locator("#statePill")).toHaveText("start");
    expect(collectUndefinedPaths(await runtimeContext(page), "runtime")).toEqual([]);
  });

  test("rejects invalid ids instead of repairing the global model namespace @smoke", async ({ page }) => {
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
        { id: "go", from: "start", to: "next", label: "Go", condition: "", triggerType: "button", triggerEvent: "", set: {} },
        { id: "finish", from: "next", to: "done", label: "Finish", condition: "", triggerType: "button", triggerEvent: "", set: {} }
      ]
    });

    const result = await page.evaluate(() => {
      const before = modelSnapshot();
      const cases = [
        ["duplicate-transition", candidate => { candidate.transitions[1].id = "go"; }],
        ["state-transition-collision", candidate => { candidate.transitions[0].id = "start"; }],
        ["reserved-transition", candidate => { candidate.transitions[0].id = "__runtime_enter_child:done:start"; }],
        ["duplicate-state", candidate => { candidate.states[2].id = "next"; }]
      ];
      return cases.map(([name, mutate]) => {
        const candidate = JSON.parse(before);
        mutate(candidate);
        let error = "";
        try { loadEditorModel(candidate, false); } catch (caught) { error = String(caught?.message || caught); }
        return { name, error, unchanged: modelSnapshot() === before };
      });
    });

    expect(result.map(item => item.name)).toEqual(["duplicate-transition", "state-transition-collision", "reserved-transition", "duplicate-state"]);
    expect(result.every(item => item.error && item.unchanged)).toBe(true);

    const app = appFrame(page);
    await expect(app.getByRole("button", { name: "Go", exact: true })).toHaveCount(1);
    await app.getByRole("button", { name: "Go", exact: true }).click();
    await expect(app.locator("#statePill")).toHaveText("next");
    await expect(app.getByRole("button", { name: "Finish", exact: true })).toHaveCount(1);
  });

  test("state editor keeps the generic bus explorer out of the data workflow @smoke", async ({ page }) => {
    await openTool(page);

    await openStateInspector(page, "login");
    await openInspectorDetails(page, "#pDataCard");

    await expect(page.locator("#pDataCard")).toBeVisible();
    await expect(page.locator("#pSubscriptionPaths")).toHaveCount(0);
    await expect(page.locator("#pStateTreeCard")).toHaveCount(0);
    await expect(page.locator("#pSubscriptionTree")).toHaveCount(0);
    await expect(page.locator("#pSubscriptionAdd")).toHaveCount(0);
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
    expect(html).not.toContain('<details class="inspector-collapse inspector-subcollapse" id="pStateTreeCard">');
    expect(html).toContain('<summary class="inspector-collapse-summary">');
    expect(html).toContain('<div class="inspector-collapse-body">');
    expect(html).toContain('id="pStateVariableList"');
    expect(html).not.toContain('id="pTemplateStateVariableList"');
    expect(html).not.toContain('id="pTemplateAdvancedDataCard"');
    expect(html).toContain(".state-action-grid");
    expect(html).toContain("function normalizeDataTypes");
    expect(html).toContain("dataTypes: normalizeDataTypes");
    expect(html).toContain(".inspector-collapse[open] .inspector-collapse-summary::after");
    expect(html).toContain('el.closest("details:not([open])")');
  });

  test("render field picker creates data-wire render mappings @smoke", async ({ page }) => {
    const model = {
      version: 2,
      name: "Render picker",
      initial: "state_3",
      states: [{
        id: "state_3",
        title: "State 3",
        body: "",
        x: 220,
        y: 220,
        data: { customer: { name: "Ada" } },
        dataTypes: { customer: "object", "customer.name": "text" },
        components: [],
        dataWires: []
      }],
      transitions: []
    };
    await openWithModel(page, model, "/state.html", "state_3");

    await openStateInspector(page, "state_3");
    await expect(page.locator("#pStateTreeCard")).toHaveCount(0);

    const sourcePath = "states.state_3.customer.name";
    const panel = page.locator(".data-wire-render-panel");
    const picker = panel.locator('select[aria-label="Datenfeld auswählen"]');
    await expect(picker.locator(`option[value="${sourcePath}"]`)).toHaveCount(1);
    await picker.selectOption(sourcePath);
    await panel.getByRole("button", { name: "In Vorschau anzeigen" }).click();
    const sourceSelect = page.locator('#pComponents .component-editor select[aria-label="Quellpfad"]').first();
    await expect(page.locator("#pComponents .component-editor").filter({ hasText: "Feld: Name" })).toBeVisible();
    await expect(sourceSelect).toHaveValue(sourcePath);
    await expect(page.locator("#pComponents .template-binding-picker")).toHaveCount(0);
    await expect.poll(async () => page.evaluate(key => {
      const stored = JSON.parse(localStorage.getItem(`${key}.editor`) || localStorage.getItem(key) || "null");
      const model = stored?.model || stored;
      return model.states.find(state => state.id === "state_3")?.subscriptions || [];
    }, STORAGE_KEY)).toEqual([]);
  });

  test("state data workflow no longer exposes a raw global-state tree @smoke", async ({ page }) => {
    await openTool(page);

    await openStateInspector(page, "auth_start");
    await openInspectorDetails(page, "#pDataCard");

    await expect(page.locator("#pStateTreeCard")).toHaveCount(0);
    await expect(page.locator("#pSubscriptionTree")).toHaveCount(0);
    await expect(page.locator(".global-state-json-line")).toHaveCount(0);
  });

  test("repeat over is selected from derived candidates, not typed as free text @smoke", async ({ page }) => {
    await openTool(page);

    await openStateInspector(page, "auth_start");
    await openInspectorDetails(page, "#pDataCard");
    await openInspectorDetails(page, "#pRepeatCard");

    const repeat = page.locator("#pRepeatPath");
    await expect(repeat).toHaveJSProperty("tagName", "SELECT");
    await expect(repeat.locator("option", { hasText: "Keine Liste" })).toHaveCount(1);
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
          repeat: { path: "states.start.items", as: "item", index: "i" },
          components: [{ id: "c_item", type: "text", text: "Eintrag" }]
        }
      ],
      transitions: []
    });

    await page.locator('[data-id="start"]').click();

    await expect(page.locator("#pRepeatPath")).toHaveValue("states.start.items");
    await expect(page.locator("#pRepeatPreview")).toContainText("Items");
  });
});
