(function () {
  "use strict";

  const DEFAULT_CONFIG_PATH = "/agent/config";
  const DEFAULT_CHAT_PATH = "/agent/chat";
  const DEFAULT_MCP_TOOL_PATH = "/agent/mcp/tool";
  const DEFAULT_EDITOR_PROMPT_PATH = "/agent/editor/prompt";
  const DEFAULT_MODEL = "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC";
  const DEFAULT_WEBLLM_PACKAGE = "https://esm.run/@mlc-ai/web-llm";
  const STORAGE_KEY = "digitalisierungsplanung.agentWidget.settings.v1";
  const LOCAL_ENGINE_REGISTRY = new Map();

  const css = `
    :host { all: initial; color-scheme: light; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    button, textarea, input, select { font: inherit; }
    .launcher { position: fixed; right: 18px; bottom: 18px; z-index: 2147483000; width: 54px; height: 54px; border: 0; border-radius: 999px; background: #0f172a; color: #f8fafc; font-weight: 900; box-shadow: 0 14px 34px rgba(15, 23, 42, .28); cursor: pointer; }
    .panel { position: fixed; right: 18px; bottom: 84px; z-index: 2147483000; width: min(420px, calc(100vw - 24px)); height: min(650px, calc(100dvh - 104px)); max-height: calc(100dvh - 104px); min-height: 380px; display: grid; grid-template-rows: auto auto 1fr auto; overflow: hidden; border: 1px solid #d7dee8; border-radius: 8px; background: #f8fafc; color: #111827; box-shadow: 0 24px 70px rgba(15, 23, 42, .24); }
    .hidden { display: none; }
    .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px; background: #ffffff; border-bottom: 1px solid #e2e8f0; }
    .title { min-width: 0; }
    .title strong { display: block; font-size: 14px; line-height: 1.2; }
    .title span { display: block; margin-top: 2px; color: #64748b; font-size: 12px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .head-actions { display: inline-flex; align-items: center; gap: 7px; flex: 0 0 auto; }
    .icon-btn { width: 34px; height: 34px; display: inline-grid; place-items: center; border: 1px solid #dbe3ee; border-radius: 6px; background: #fff; color: #0f172a; cursor: pointer; }
    .icon-btn.clear-chat { width: auto; min-width: 54px; padding-inline: 9px; font-size: 12px; font-weight: 850; }
    .status { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #475569; font-size: 12px; background: #f8fafc; }
    .status-text { min-width: 0; overflow-wrap: anywhere; }
    .dot { width: 8px; height: 8px; border-radius: 999px; background: #22c55e; flex: 0 0 auto; }
    .dot.loading { background: #0ea5e9; }
    .dot.error { background: #f43f5e; }
    .messages { overflow: auto; padding: 14px 12px 18px; display: grid; align-content: start; gap: 10px; }
    .msg { display: grid; gap: 5px; max-width: 90%; }
    .msg.user { justify-self: end; }
    .bubble { padding: 10px 12px; border: 1px solid #dbe3ee; border-radius: 8px; background: #fff; color: #172033; font-size: 13px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
    .user .bubble { border-color: #0f172a; background: #0f172a; color: #fff; }
    .meta { color: #64748b; font-size: 11px; }
    .tools { display: flex; flex-wrap: wrap; gap: 5px; }
    .chip { border: 1px solid #cbd5e1; border-radius: 999px; padding: 3px 7px; color: #475569; background: #fff; font-size: 11px; }
    .confirm { display: inline-flex; width: fit-content; min-height: 34px; align-items: center; justify-content: center; border: 0; border-radius: 6px; padding: 0 10px; background: #0f766e; color: white; font-weight: 850; cursor: pointer; }
    .download { display: inline-flex; width: fit-content; min-height: 34px; align-items: center; justify-content: center; border: 1px solid #0ea5e9; border-radius: 6px; padding: 0 10px; background: #e0f2fe; color: #075985; font-weight: 850; cursor: pointer; text-decoration: none; }
    .settings { display: grid; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #e2e8f0; background: #f1f5f9; }
    .settings.hidden { display: none; }
    .settings label { display: grid; gap: 4px; color: #475569; font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .settings input, .settings select { width: 100%; height: 34px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #111827; padding: 0 8px; }
    .form { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 10px 12px; border-top: 1px solid #e2e8f0; background: #ffffff; }
    textarea { width: 100%; min-height: 42px; max-height: 130px; resize: none; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 11px; color: #111827; background: #fff; line-height: 1.35; }
    .send { width: 42px; height: 42px; border: 0; border-radius: 8px; background: #0ea5e9; color: #001018; font-weight: 900; cursor: pointer; }
    .send:disabled { opacity: .55; cursor: not-allowed; }
    @media (max-width: 760px) { .panel { left: 8px; right: 8px; bottom: 72px; bottom: max(72px, calc(env(safe-area-inset-bottom) + 72px)); width: auto; height: min(560px, calc(100dvh - 136px)); max-height: calc(100dvh - 136px); min-height: 320px; } .launcher { right: 12px; bottom: 12px; } }
    @media (max-height: 520px) { .panel { top: max(10px, env(safe-area-inset-top)); bottom: 10px; height: auto; min-height: 0; max-height: none; } }
  `;

  function safeText(value) {
    return String(value || "");
  }

  function readSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (parsed && typeof parsed === "object") {
        delete parsed.authToken;
        return parsed;
      }
      return {};
    } catch (_) {
      return {};
    }
  }

  function writeSettings(settings) {
    try {
      const persisted = { ...settings };
      delete persisted.authToken;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    } catch (_) {}
  }

  class DigitalisierungsplanungAgentWidget extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.config = null;
      this.engine = null;
      this.loadingEngine = null;
      this.messages = [];
      this.settings = readSettings();
      this.sessionAuthToken = "";
      this.pendingToolCall = null;
      this.sending = false;
      this.sendQueue = [];
      this.chatGeneration = 0;
      this.localEngineState = "idle";
      this.localEngineProgress = 0;
      this.localEngineError = "";
      this.open = this.getAttribute("data-open") === "true";
    }

    connectedCallback() {
      this.renderShell();
      this.loadConfig();
    }

    endpoint(name, fallback) {
      return this.getAttribute(`data-${name}`) || this.config?.widget?.[name] || fallback;
    }

    mode() {
      if (this.editorBridge()) return "local-webllm";
      return this.settings.mode || this.getAttribute("data-mode") || this.config?.widget?.defaultMode || "local-webllm";
    }

    model() {
      return this.settings.model || this.getAttribute("data-model") || this.config?.widget?.defaultModel || DEFAULT_MODEL;
    }

    authToken() {
      return this.sessionAuthToken || "";
    }

    editorBridge() {
      return this.getAttribute("data-editor-bridge") === "state-blueprint";
    }

    launcherDisabled() {
      return this.hasAttribute("data-disable-launcher") || this.getAttribute("data-launcher") === "false";
    }

    editorPromptPath() {
      return this.getAttribute("data-editor-prompt-path") || this.config?.widget?.editorPromptPath || DEFAULT_EDITOR_PROMPT_PATH;
    }

    readyStatusText() {
      if (this.editorBridge()) {
        this.syncLocalEngineState(this.localEngineEntry());
        if (this.engine) return `Lokale KI aktiv: ${this.model()}`;
        if (this.loadingEngine || this.localEngineState === "loading") return `Lokale KI laedt: ${this.model()} (${this.localEngineProgress || 0}%)`;
        if (this.localEngineState === "unavailable") return "Lokale KI nicht verfuegbar. Editor-Aenderungen laufen direkt.";
        return "Lokale KI noch nicht geladen. Editor-Aenderungen laufen direkt.";
      }
      return this.mode() === "server" ? "Externes Backend bereit" : "In-Browser KI bereit";
    }

    localPackageUrl() {
      return this.getAttribute("data-webllm-src") || this.config?.widget?.webLlmPackageUrl || DEFAULT_WEBLLM_PACKAGE;
    }

    localEngineKey() {
      return `${this.localPackageUrl()}::${this.model()}`;
    }

    localEngineEntry() {
      const key = this.localEngineKey();
      if (!LOCAL_ENGINE_REGISTRY.has(key)) {
        LOCAL_ENGINE_REGISTRY.set(key, {
          key,
          engine: null,
          loading: null,
          state: "idle",
          progress: 0,
          error: ""
        });
      }
      return LOCAL_ENGINE_REGISTRY.get(key);
    }

    syncLocalEngineState(entry) {
      this.engine = entry?.engine || null;
      this.loadingEngine = entry?.loading || null;
      this.localEngineState = entry?.state || "idle";
      this.localEngineProgress = entry?.progress || 0;
      this.localEngineError = entry?.error || "";
    }

    resetLocalEngineEntry(error = null) {
      const entry = this.localEngineEntry();
      entry.engine = null;
      entry.loading = null;
      entry.state = "idle";
      entry.progress = 0;
      entry.error = error?.message || String(error || "");
      this.syncLocalEngineState(entry);
      return entry;
    }

    localEngineDisposedError(error) {
      return /(?:already\s+)?disposed|engine.*closed|worker.*terminated/i.test(error?.message || String(error || ""));
    }

    openPanel() {
      this.setOpen(true);
    }

    requestEditorSnapshot() {
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = value => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        const fail = error => {
          if (settled) return;
          settled = true;
          reject(error instanceof Error ? error : new Error(String(error || "Editor-Snapshot fehlgeschlagen")));
        };
        this.dispatchEvent(new CustomEvent("dp-agent-editor-snapshot", {
          bubbles: true,
          composed: true,
          detail: { resolve: finish, reject: fail }
        }));
        setTimeout(() => fail(new Error("Der Editor hat keinen Modell-Snapshot geliefert.")), 5000);
      });
    }

    applyEditorPlan(plan) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = value => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        const fail = error => {
          if (settled) return;
          settled = true;
          reject(error instanceof Error ? error : new Error(String(error || "Editor-Apply fehlgeschlagen")));
        };
        this.dispatchEvent(new CustomEvent("dp-agent-editor-apply", {
          bubbles: true,
          composed: true,
          detail: { ...plan, resolve: finish, reject: fail }
        }));
        setTimeout(() => fail(new Error("Der Editor hat die Aenderung nicht uebernommen.")), 5000);
      });
    }

    renderShell() {
      const editorBridge = this.editorBridge();
      const settingsToggle = editorBridge
        ? ""
        : `<button class="icon-btn settings-toggle" type="button" aria-label="Einstellungen">⚙</button>`;
      const settingsPanel = editorBridge
        ? ""
        : `<div class="settings hidden">
            <label>Modus
              <select class="mode">
                <option value="local-webllm">In-Browser KI (WebLLM)</option>
                <option value="server">Externes Chat-Backend</option>
              </select>
            </label>
            <label>Modell
              <input class="model" autocomplete="off">
            </label>
            <label>Broker-Token
              <input class="token" type="password" autocomplete="off">
            </label>
          </div>`;
      this.shadowRoot.innerHTML = `
        <style>${css}</style>
        <button class="launcher ${this.open || this.launcherDisabled() ? "hidden" : ""}" type="button" aria-label="App Intelligence oeffnen">AI</button>
        <section class="panel ${this.open ? "" : "hidden"}" aria-label="App Intelligence">
          <div class="head">
            <div class="title">
              <strong>App Intelligence</strong>
              <span class="subtitle">${editorBridge ? "In-Browser Oberflaeche, MCP-Bridge bei Bedarf" : "In-Browser KI, MCP-Broker bei Bedarf"}</span>
            </div>
            <div class="head-actions">
              ${settingsToggle}
              <button class="icon-btn clear-chat" type="button" aria-label="Chat loeschen">Clear</button>
              <button class="icon-btn close" type="button" aria-label="Minimieren">-</button>
            </div>
          </div>
          ${settingsPanel}
          <div class="status"><span class="dot"></span><span class="status-text">Initialisiere...</span></div>
          <main class="messages"></main>
          <form class="form">
            <textarea class="input" rows="1" placeholder="${editorBridge ? "Sag, was im Editor entstehen soll..." : "Sag, was am Prozess entstehen soll..."}"></textarea>
            <button class="send" type="submit" aria-label="Senden">></button>
          </form>
        </section>
      `;
      this.shadowRoot.querySelector(".launcher").addEventListener("click", () => this.setOpen(!this.open));
      this.shadowRoot.querySelector(".close").addEventListener("click", () => this.setOpen(false));
      this.shadowRoot.querySelector(".clear-chat").addEventListener("click", () => this.clearChat());
      const settingsToggleButton = this.shadowRoot.querySelector(".settings-toggle");
      if (settingsToggleButton) {
        settingsToggleButton.addEventListener("click", () => {
          this.shadowRoot.querySelector(".settings").classList.toggle("hidden");
        });
      }
      this.shadowRoot.querySelector(".form").addEventListener("submit", event => {
        event.preventDefault();
        this.send();
      });
      const input = this.shadowRoot.querySelector(".input");
      input.addEventListener("input", event => {
        event.currentTarget.style.height = "auto";
        event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 130)}px`;
        this.updateSendButton();
      });
      input.addEventListener("keydown", event => {
        event.stopPropagation();
        if (event.key !== "Enter" || event.isComposing || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        this.send();
      });
      ["keyup", "keypress", "beforeinput", "copy", "cut", "paste"].forEach(type => {
        input.addEventListener(type, event => event.stopPropagation());
      });
      const modeSelect = this.shadowRoot.querySelector(".mode");
      if (modeSelect) {
        modeSelect.addEventListener("change", event => {
          this.settings.mode = event.currentTarget.value;
          writeSettings(this.settings);
          this.setStatus(this.readyStatusText(), "ready");
        });
        modeSelect.value = this.mode();
      }
      const modelInput = this.shadowRoot.querySelector(".model");
      if (modelInput) {
        modelInput.addEventListener("change", event => {
          this.settings.model = event.currentTarget.value.trim();
          this.engine = null;
          this.loadingEngine = null;
          writeSettings(this.settings);
        });
        modelInput.value = this.model();
      }
      const tokenInput = this.shadowRoot.querySelector(".token");
      if (tokenInput) {
        tokenInput.addEventListener("change", event => {
          this.sessionAuthToken = event.currentTarget.value;
        });
        tokenInput.value = this.authToken();
      }
      this.addMessage("assistant", editorBridge
        ? "Ich bin bereit. Editor-Aenderungen uebernehme ich direkt; normale Fragen laufen ueber die lokale KI, sobald sie geladen ist."
        : "Sag mir in einem Satz, welchen State-Blueprint du bauen, pruefen, exportieren oder laden willst.");
      this.updateSendButton();
    }

    clearChat() {
      this.chatGeneration += 1;
      this.messages = [];
      this.sendQueue = [];
      const container = this.shadowRoot.querySelector(".messages");
      if (container) container.innerHTML = "";
      this.addMessage("assistant", this.editorBridge()
        ? "Chat geloescht. Editor-Modell bleibt unveraendert; neue Aenderungen uebernehme ich direkt."
        : "Chat geloescht. Frag mich neu nach Blueprint, MCP, Export oder Laden.");
      this.setStatus(this.readyStatusText(), "ready");
      this.updateSendButton();
      this.shadowRoot.querySelector(".input")?.focus();
    }

    setOpen(next) {
      this.open = Boolean(next);
      this.shadowRoot.querySelector(".panel").classList.toggle("hidden", !this.open);
      this.shadowRoot.querySelector(".launcher").classList.toggle("hidden", this.open || this.launcherDisabled());
      if (this.open) this.shadowRoot.querySelector(".input").focus();
    }

    setStatus(text, type = "ready") {
      const dot = this.shadowRoot.querySelector(".dot");
      dot.className = `dot ${type === "loading" ? "loading" : type === "error" ? "error" : ""}`;
      this.shadowRoot.querySelector(".status-text").textContent = text;
    }

    updateSendButton() {
      const input = this.shadowRoot.querySelector(".input");
      const button = this.shadowRoot.querySelector(".send");
      if (!button || !input) return;
      button.disabled = !input.value.trim();
      button.textContent = this.sending ? "..." : ">";
    }

    addMessage(role, content, options = {}) {
      if (Number.isInteger(options.generation) && options.generation !== this.chatGeneration) return null;
      const wrap = document.createElement("div");
      wrap.className = `msg ${role === "user" ? "user" : "assistant"}`;
      const bubble = document.createElement("div");
      bubble.className = "bubble";
      bubble.textContent = safeText(content);
      wrap.appendChild(bubble);
      if (options.meta) {
        const meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = options.meta;
        wrap.appendChild(meta);
      }
      if (options.toolCall) {
        const button = document.createElement("button");
        button.className = "confirm";
        button.type = "button";
        button.textContent = "Aenderung anwenden";
        button.addEventListener("click", () => this.confirmTool(options.toolCall, button));
        wrap.appendChild(button);
      }
      if (options.download) {
        const link = document.createElement("a");
        link.className = "download";
        link.href = URL.createObjectURL(new Blob([options.download.text], { type: options.download.mimeType }));
        link.download = options.download.name;
        link.textContent = options.download.label || "Datei laden";
        link.addEventListener("click", () => setTimeout(() => URL.revokeObjectURL(link.href), 30000), { once: true });
        wrap.appendChild(link);
      }
      const container = this.shadowRoot.querySelector(".messages");
      container.appendChild(wrap);
      container.scrollTop = container.scrollHeight;
      return bubble;
    }

    async loadConfig() {
      try {
        const response = await fetch(this.getAttribute("data-config-path") || DEFAULT_CONFIG_PATH, { cache: "no-store" });
        if (!response.ok) throw new Error(`config ${response.status}`);
        this.config = await response.json();
        const tools = this.config?.mcpServers?.[0]?.tools || [];
        if (!this.editorBridge() && tools.length) {
          this.addToolChips(tools);
        }
        const modeSelect = this.shadowRoot.querySelector(".mode");
        if (modeSelect) modeSelect.value = this.mode();
        const modelInput = this.shadowRoot.querySelector(".model");
        if (modelInput) modelInput.value = this.model();
        this.setStatus(this.readyStatusText(), "ready");
      } catch (error) {
        if (this.editorBridge()) {
          this.config = { widget: { editorPromptPath: this.editorPromptPath() }, mcpServers: [{ tools: [] }] };
          this.setStatus(this.readyStatusText(), "ready");
          return;
        }
        this.setStatus("Config nicht geladen", "error");
        this.addMessage("assistant", `Konfiguration konnte nicht geladen werden: ${error.message}`);
      }
    }

    addToolChips(tools) {
      const wrap = document.createElement("div");
      wrap.className = "tools";
      for (const tool of tools.slice(0, 6)) {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = tool.name.replace(/^state_blueprint_/, "");
        wrap.appendChild(chip);
      }
      this.shadowRoot.querySelector(".messages").appendChild(wrap);
    }

    async ensureLocalEngine() {
      const entry = this.localEngineEntry();
      this.syncLocalEngineState(entry);
      if (entry.engine) return entry.engine;
      if (entry.loading) return entry.loading;
      if (!navigator.gpu) {
        entry.state = "unavailable";
        entry.error = "WebGPU nicht verfuegbar";
        this.syncLocalEngineState(entry);
        this.setStatus(this.readyStatusText(), "ready");
        throw new Error("WebGPU ist in diesem Browser nicht verfuegbar.");
      }
      const packageUrl = this.localPackageUrl();
      entry.state = "loading";
      entry.progress = 0;
      entry.error = "";
      this.syncLocalEngineState(entry);
      entry.loading = (async () => {
        this.setStatus(`WebLLM Paket laden: ${this.model()}`, "loading");
        const webllm = await import(packageUrl);
        return webllm.CreateMLCEngine(this.model(), {
          initProgressCallback: report => {
            const percent = Math.round(Number(report.progress || 0) * 100);
            entry.progress = percent;
            this.syncLocalEngineState(entry);
            this.setStatus(`Lokales Modell laden: ${this.model()} (${percent}%)`, "loading");
          }
        });
      })();
      this.syncLocalEngineState(entry);
      try {
        entry.engine = await entry.loading;
        entry.state = "ready";
        entry.error = "";
      } catch (error) {
        entry.engine = null;
        entry.state = "idle";
        entry.error = error?.message || String(error || "");
        this.setStatus("Lokale KI noch nicht bereit. Editor-Aenderungen laufen direkt.", "ready");
        throw error;
      } finally {
        entry.loading = null;
        this.syncLocalEngineState(entry);
      }
      this.setStatus(`Lokale KI aktiv: ${this.model()}`, "ready");
      return entry.engine;
    }

    systemPrompt() {
      const tools = this.config?.mcpServers?.[0]?.tools || [];
      const toolList = tools.map(tool => {
        const mode = tool.mutatesWorkspace
          ? "workspace write, confirmation required"
          : tool.writesFile
            ? "read; outputPath file write needs confirmation"
            : "read";
        return `- ${tool.name}: ${mode}. ${tool.description}`;
      }).join("\n");
      return [
        "Du bist App Intelligence für digitalisierungsplanung.de.",
        "Hilf dabei, State-Blueprint-FSMs zu erstellen, zu prüfen, zu exportieren und zu laden.",
        "Erfinde keinen zweiten Prozess-State im Chat. Für Fakten zum Workflow nutzt du MCP.",
        "Wenn ein MCP-Aufruf sinnvoll ist, antworte ausschließlich mit JSON in dieser Form:",
        "{\"mcp\":{\"serverId\":\"state-blueprint\",\"name\":\"state_blueprint_validate\",\"arguments\":{}}}",
        "Schreibende Tools werden vom Broker bestätigt, bevor sie ausgeführt werden.",
        "",
        "MCP Tools:",
        toolList
      ].join("\n");
    }

    editorSystemPrompt() {
      return [
        "Du bist die In-Browser AI im State-Blueprint-Editor.",
        "Antworte normal, kurz und hilfreich auf Deutsch.",
        "Du hast ein Editor-Tool. Wenn der Nutzer States, Uebergaenge, Widgets, Variablen, Timer, APIs, Workflows oder eine neue Szene erstellen oder aendern will, antworte ausschliesslich mit internem JSON:",
        "{\"editor\":{\"prompt\":\"<kurze konkrete Aenderung>\"}}",
        "Fuer Smalltalk, Erklaerungen oder Rueckfragen antworte als normaler Chat ohne JSON.",
        "Nutze keine versteckten Zustaende und keinen zweiten Schatten-State im Chat.",
        "Der Editor liefert den Snapshot und wendet Aenderungen nur ueber den Contract-Endpunkt an."
      ].join("\n");
    }

    extractMcpCall(text) {
      const raw = safeText(text).trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
      if (!raw.startsWith("{")) return null;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.mcp?.name) return parsed.mcp;
      } catch (_) {}
      return null;
    }

    extractEditorCall(text) {
      const raw = safeText(text).trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
      if (!raw.startsWith("{")) return null;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.editor?.prompt) return parsed.editor;
      } catch (_) {}
      return null;
    }

    editorActionLikely(text) {
      const normalized = safeText(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss").toLowerCase();
      return /(?:erstelle|erzeuge|mach|baue|bau|lege|fuege|fuge|add|create|build|connect|verbinde|konfiguriere|aendere|andere|setze|upsert|delete|loesch|loesche|loeschen|losch|losche|loschen|entferne|clear|reset|leere|neu|neue)\b/.test(normalized) ||
        /\b(?:state|zustand|screen|seite|szene|scene|canvas|workflow|flow|ablauf)\s+[a-z0-9]/i.test(normalized);
    }

    editorPlanMessage(payload) {
      const plan = payload?.plan || {};
      const actionCount = Array.isArray(payload?.actions) ? payload.actions.length : 0;
      if (!payload?.ok) {
        return plan.explanation || payload?.error || "Ich konnte daraus keine sichere Editor-Aenderung ableiten.";
      }
      const summary = payload?.summary || {};
      const details = actionCount
        ? [
            "Erledigt.",
            plan.explanation || "Die Aenderung wurde direkt im Editor uebernommen.",
            Number.isFinite(summary.states) ? String(summary.states) + " States im Modell." : ""
          ].filter(Boolean).join(" ")
        : plan.explanation || "Ich habe nichts im Editor geaendert.";
      const assumptions = Array.isArray(plan.assumptions) && plan.assumptions.length
        ? "\n\nAnnahmen: " + plan.assumptions.slice(0, 3).join("; ")
        : "";
      return details + assumptions;
    }

    editorErrorMessage(payload, status) {
      const issues = Array.isArray(payload?.validation?.issues) ? payload.validation.issues : [];
      const issueText = issues.slice(0, 3).map(issue => {
        const path = issue.path || issue.stateId || issue.transitionId || "";
        return [issue.code || "", path, issue.message || ""].filter(Boolean).join(": ");
      }).filter(Boolean).join("\n");
      const base = payload?.error || `editor agent ${status}`;
      return issueText ? `${base}\n${issueText}` : base;
    }

    async sendEditorPrompt(prompt, generation = this.chatGeneration) {
      const snapshot = await this.requestEditorSnapshot();
      const response = await fetch(this.editorPromptPath(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          model: snapshot.model,
          selectedStateId: snapshot.selectedStateId || ""
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(this.editorErrorMessage(payload, response.status));
      const hasEditorActions = payload?.plan?.intent !== "unknown" && Array.isArray(payload?.actions) && payload.actions.length > 0;
      if (hasEditorActions && payload.ok) {
        this.setStatus("Uebernehme direkt im Editor...", "loading");
        await this.applyEditorPlan(payload);
      }
      const message = this.editorPlanMessage(payload);
      this.addMessage("assistant", message, {
        meta: hasEditorActions
          ? (payload.ok ? "Geprueft und direkt uebernommen" : "Nicht uebernommen")
          : "Keine Aenderung",
        generation
      });
      if (generation === this.chatGeneration) this.messages.push({ role: "assistant", content: message });
      return payload;
    }

    async send() {
      const input = this.shadowRoot.querySelector(".input");
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      input.style.height = "";
      this.addMessage("user", text);
      this.sendQueue.push(text);
      this.updateSendButton();
      this.processSendQueue();
      input.focus();
    }

    async processSendQueue() {
      if (this.sending) {
        this.setStatus(`${this.sendQueue.length} Nachricht(en) warten`, "loading");
        return;
      }
      const input = this.shadowRoot.querySelector(".input");
      this.sending = true;
      this.updateSendButton();
      let lastFailed = false;
      const generation = this.chatGeneration;
      try {
        while (this.sendQueue.length && generation === this.chatGeneration) {
          const text = this.sendQueue.shift();
          this.messages.push({ role: "user", content: text });
          try {
            await this.handlePrompt(text, generation);
            lastFailed = false;
          } catch (error) {
            lastFailed = true;
            this.setStatus("Fehler", "error");
            this.addMessage("assistant", error.message || String(error), { generation });
          }
        }
      } finally {
        this.sending = false;
        this.updateSendButton();
        if (!lastFailed && generation === this.chatGeneration) this.setStatus(this.readyStatusText(), "ready");
        if (this.open && (document.activeElement === this || this.shadowRoot.activeElement === input)) {
          input?.focus();
        }
      }
    }

    async handlePrompt(text, generation = this.chatGeneration) {
      this.setStatus(this.sendQueue.length ? `Arbeite... ${this.sendQueue.length} wartet` : "Arbeite...", "loading");
      if (this.editorBridge()) {
        if (this.editorActionLikely(text)) {
          await this.sendEditorPrompt(text, generation);
          return;
        }
        try {
          await this.sendLocal(text, generation);
        } catch (error) {
          const message = "Lokale KI ist noch nicht bereit. Editor-Aenderungen kann ich trotzdem direkt ausfuehren.";
          this.addMessage("assistant", message, { meta: this.readyStatusText(), generation });
          if (generation === this.chatGeneration) this.messages.push({ role: "assistant", content: message });
        }
        return;
      }
      if (this.mode() === "server") {
        await this.sendServer(generation);
      } else {
        await this.sendLocal(text, generation);
      }
    }

    async sendServer(generation = this.chatGeneration) {
      const response = await fetch(this.endpoint("chatPath", DEFAULT_CHAT_PATH), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ messages: this.messages.slice(-12) })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `agent ${response.status}`);
      const text = payload?.message?.content || "";
      this.addMessage("assistant", text, {
        meta: this.toolRunMeta(payload.toolRuns),
        toolCall: payload.needsConfirmation ? payload.toolCall : null,
        generation
      });
      if (generation === this.chatGeneration) this.messages.push({ role: "assistant", content: text });
    }

    async sendLocal(promptText = "", generation = this.chatGeneration, options = {}) {
      const retryDisposed = options.retryDisposed !== false;
      const engine = await this.ensureLocalEngine();
      const streamToBubble = !this.editorBridge();
      const bubble = streamToBubble ? this.addMessage("assistant", "", { generation }) : null;
      let complete = "";
      try {
        const stream = await engine.chat.completions.create({
          messages: [
            { role: "system", content: this.editorBridge() ? this.editorSystemPrompt() : this.systemPrompt() },
            ...this.messages.slice(-10)
          ],
          temperature: 0.2,
          stream: true
        });
        for await (const chunk of stream) {
          complete += chunk.choices?.[0]?.delta?.content || "";
          if (bubble && generation === this.chatGeneration) bubble.textContent = complete;
        }
      } catch (error) {
        if (this.localEngineDisposedError(error) && retryDisposed) {
          if (bubble) bubble.remove();
          this.resetLocalEngineEntry(error);
          this.setStatus("Lokale KI-Session erneuert. Browser-Cache bleibt erhalten.", "loading");
          return this.sendLocal(promptText, generation, { retryDisposed: false });
        }
        throw error;
      }
      const editorCall = this.editorBridge() ? this.extractEditorCall(complete) : null;
      if (editorCall) {
        await this.sendEditorPrompt(editorCall.prompt, generation);
        return;
      }
      if (this.editorBridge() && this.editorActionLikely(promptText)) {
        await this.sendEditorPrompt(promptText, generation);
        return;
      }
      const toolCall = this.extractMcpCall(complete);
      if (toolCall) {
        if (bubble) bubble.textContent = "Ich frage den MCP-Broker.";
        await this.runTool(toolCall);
        if (generation === this.chatGeneration) this.messages.push({ role: "assistant", content: "MCP-Broker genutzt." });
        return;
      }
      if (this.editorBridge() && safeText(complete).trim().startsWith("{")) {
        const message = "Ich habe eine interne Tool-Antwort nicht sicher lesen koennen. Schreib den Editor-Auftrag bitte nochmal kurz.";
        this.addMessage("assistant", message, { generation });
        if (generation === this.chatGeneration) this.messages.push({ role: "assistant", content: message });
        return;
      }
      if (!bubble) this.addMessage("assistant", complete, { generation });
      if (generation === this.chatGeneration) this.messages.push({ role: "assistant", content: complete });
    }

    headers() {
      const headers = { "content-type": "application/json" };
      if (this.authToken()) headers.authorization = `Bearer ${this.authToken()}`;
      return headers;
    }

    toolRunMeta(runs) {
      if (!Array.isArray(runs) || !runs.length) return "";
      return runs.map(run => `${run.name}: ${run.needsConfirmation ? "Bestätigung nötig" : run.ok ? "ok" : "Fehler"}`).join(" · ");
    }

    filename(value, fallback) {
      return safeText(value || fallback)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_.-]+/g, "-")
        .replace(/^-+|-+$/g, "") || fallback;
    }

    downloadForStructuredResult(structured) {
      if (structured?.kind !== "state-blueprint-definition") return null;
      const base = this.filename(structured?.model?.name, "state-blueprint");
      return {
        name: `${base}.state.json`,
        mimeType: "application/json",
        text: `${JSON.stringify(structured, null, 2)}\n`,
        label: ".state.json laden"
      };
    }

    async runTool(toolCall, confirmed = false) {
      const response = await fetch(this.endpoint("mcpToolPath", DEFAULT_MCP_TOOL_PATH), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          serverId: toolCall.serverId || "state-blueprint",
          name: toolCall.name,
          arguments: toolCall.arguments || {},
          confirmed
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `mcp ${response.status}`);
      if (payload.needsConfirmation) {
        this.addMessage("assistant", "Diese MCP-Aktion schreibt in den Workspace und braucht deine Bestätigung.", { toolCall });
        return payload;
      }
      const structured = payload.result?.structuredContent || payload.result || payload;
      this.addMessage("assistant", JSON.stringify(structured, null, 2), {
        meta: `${toolCall.name}: ok`,
        download: this.downloadForStructuredResult(structured)
      });
      return payload;
    }

    async confirmTool(toolCall, button) {
      button.disabled = true;
      try {
        await this.runTool(toolCall, true);
      } catch (error) {
        this.addMessage("assistant", error.message || String(error));
      }
    }
  }

  if (!customElements.get("dp-agent-widget")) {
    customElements.define("dp-agent-widget", DigitalisierungsplanungAgentWidget);
  }
})();
