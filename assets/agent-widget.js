(function () {
  "use strict";

  const DEFAULT_CONFIG_PATH = "/agent/config";
  const DEFAULT_CHAT_PATH = "/agent/chat";
  const DEFAULT_MCP_TOOL_PATH = "/agent/mcp/tool";
  const DEFAULT_EDITOR_PROMPT_PATH = "/agent/editor/prompt";
  const DEFAULT_MODEL = "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC";
  const DEFAULT_WEBLLM_PACKAGE = "https://esm.run/@mlc-ai/web-llm";
  const STORAGE_KEY = "digitalisierungsplanung.agentWidget.settings.v1";

  const css = `
    :host { all: initial; color-scheme: light; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    button, textarea, input, select { font: inherit; }
    .launcher { position: fixed; right: 18px; bottom: 18px; z-index: 2147483000; width: 54px; height: 54px; border: 0; border-radius: 999px; background: #0f172a; color: #f8fafc; font-weight: 900; box-shadow: 0 14px 34px rgba(15, 23, 42, .28); cursor: pointer; }
    .panel { position: fixed; right: 18px; bottom: 84px; z-index: 2147483000; width: min(420px, calc(100vw - 24px)); height: min(650px, calc(100vh - 104px)); min-height: 380px; display: grid; grid-template-rows: auto auto 1fr auto; overflow: hidden; border: 1px solid #d7dee8; border-radius: 8px; background: #f8fafc; color: #111827; box-shadow: 0 24px 70px rgba(15, 23, 42, .24); }
    .hidden { display: none; }
    .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px; background: #ffffff; border-bottom: 1px solid #e2e8f0; }
    .title { min-width: 0; }
    .title strong { display: block; font-size: 14px; line-height: 1.2; }
    .title span { display: block; margin-top: 2px; color: #64748b; font-size: 12px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .icon-btn { width: 34px; height: 34px; display: inline-grid; place-items: center; border: 1px solid #dbe3ee; border-radius: 6px; background: #fff; color: #0f172a; cursor: pointer; }
    .status { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #475569; font-size: 12px; background: #f8fafc; }
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
    .send:disabled, textarea:disabled { opacity: .55; cursor: not-allowed; }
    @media (max-width: 520px) { .panel { right: 8px; bottom: 76px; width: calc(100vw - 16px); height: calc(100vh - 92px); } .launcher { right: 12px; bottom: 12px; } }
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
      this.shadowRoot.innerHTML = `
        <style>${css}</style>
        <button class="launcher ${this.open || this.launcherDisabled() ? "hidden" : ""}" type="button" aria-label="App Intelligence oeffnen">AI</button>
        <section class="panel ${this.open ? "" : "hidden"}" aria-label="App Intelligence">
          <div class="head">
            <div class="title">
              <strong>App Intelligence</strong>
              <span class="subtitle">Lokale KI, MCP-Broker bei Bedarf</span>
            </div>
            <button class="icon-btn settings-toggle" type="button" aria-label="Einstellungen">⚙</button>
            <button class="icon-btn close" type="button" aria-label="Schließen">×</button>
          </div>
          <div class="settings hidden">
            <label>Modus
              <select class="mode">
                <option value="local-webllm">Local WebLLM</option>
                <option value="server">Server Agent</option>
              </select>
            </label>
            <label>Modell
              <input class="model" autocomplete="off">
            </label>
            <label>Agent/MCP Secret
              <input class="token" type="password" autocomplete="off">
            </label>
          </div>
          <div class="status"><span class="dot"></span><span class="status-text">Initialisiere...</span></div>
          <main class="messages"></main>
          <form class="form">
            <textarea class="input" rows="1" placeholder="${this.editorBridge() ? "Sag, was im Editor entstehen soll..." : "Sag, was am Prozess entstehen soll..."}"></textarea>
            <button class="send" type="submit" aria-label="Senden">›</button>
          </form>
        </section>
      `;
      this.shadowRoot.querySelector(".launcher").addEventListener("click", () => this.setOpen(!this.open));
      this.shadowRoot.querySelector(".close").addEventListener("click", () => this.setOpen(false));
      this.shadowRoot.querySelector(".settings-toggle").addEventListener("click", () => {
        this.shadowRoot.querySelector(".settings").classList.toggle("hidden");
      });
      this.shadowRoot.querySelector(".form").addEventListener("submit", event => {
        event.preventDefault();
        this.send();
      });
      this.shadowRoot.querySelector(".input").addEventListener("input", event => {
        event.currentTarget.style.height = "auto";
        event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 130)}px`;
      });
      this.shadowRoot.querySelector(".mode").addEventListener("change", event => {
        this.settings.mode = event.currentTarget.value;
        writeSettings(this.settings);
        this.setStatus("Bereit", "ready");
      });
      this.shadowRoot.querySelector(".model").addEventListener("change", event => {
        this.settings.model = event.currentTarget.value.trim();
        this.engine = null;
        this.loadingEngine = null;
        writeSettings(this.settings);
      });
      this.shadowRoot.querySelector(".token").addEventListener("change", event => {
        this.sessionAuthToken = event.currentTarget.value;
      });
      this.shadowRoot.querySelector(".mode").value = this.mode();
      this.shadowRoot.querySelector(".model").value = this.model();
      this.shadowRoot.querySelector(".token").value = this.authToken();
      this.addMessage("assistant", this.editorBridge()
        ? "Sag mir kurz, welche States, Uebergaenge oder Widgets im aktuellen Editor-Modell entstehen sollen."
        : "Sag mir in einem Satz, welchen State-Blueprint du bauen, pruefen, exportieren oder laden willst.");
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

    addMessage(role, content, options = {}) {
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
      if (options.editorPlan) {
        const button = document.createElement("button");
        button.className = "confirm";
        button.type = "button";
        button.textContent = "Im Editor uebernehmen";
        button.addEventListener("click", () => this.confirmEditorPlan(options.editorPlan, button));
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
        if (tools.length) {
          this.addToolChips(tools);
        }
        this.shadowRoot.querySelector(".mode").value = this.mode();
        this.shadowRoot.querySelector(".model").value = this.model();
        this.setStatus(this.mode() === "local-webllm" ? "Bereit für lokale KI" : "Bereit für Server Agent", "ready");
      } catch (error) {
        if (this.editorBridge()) {
          this.config = { widget: { editorPromptPath: this.editorPromptPath() }, mcpServers: [{ tools: [] }] };
          this.setStatus("Editor-Bridge bereit", "ready");
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
      if (this.engine) return this.engine;
      if (this.loadingEngine) return this.loadingEngine;
      if (!navigator.gpu) throw new Error("WebGPU ist in diesem Browser nicht verfügbar.");
      const packageUrl = this.config?.widget?.webLlmPackageUrl || this.getAttribute("data-webllm-src") || DEFAULT_WEBLLM_PACKAGE;
      this.loadingEngine = (async () => {
        const webllm = await import(packageUrl);
        return webllm.CreateMLCEngine(this.model(), {
          initProgressCallback: report => {
            const percent = Math.round(Number(report.progress || 0) * 100);
            this.setStatus(`Modell laden: ${percent}%`, "loading");
          }
        });
      })();
      this.engine = await this.loadingEngine;
      this.setStatus("Lokale KI bereit", "ready");
      return this.engine;
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

    extractMcpCall(text) {
      const raw = safeText(text).trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
      if (!raw.startsWith("{")) return null;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.mcp?.name) return parsed.mcp;
      } catch (_) {}
      return null;
    }

    editorPlanMessage(payload) {
      const plan = payload?.plan || {};
      const actionCount = Array.isArray(payload?.actions) ? payload.actions.length : 0;
      if (!payload?.ok) {
        return plan.explanation || payload?.error || "Ich konnte daraus keine sichere Contract-Aenderung planen.";
      }
      const summary = payload?.summary || {};
      const details = [
        plan.explanation || "Contract-Aenderung geplant.",
        actionCount ? String(actionCount) + " Aktion(en)" : "keine Aktion",
        Number.isFinite(summary.states) ? String(summary.states) + " States" : ""
      ].filter(Boolean).join(" | ");
      const assumptions = Array.isArray(plan.assumptions) && plan.assumptions.length
        ? "\n\nAnnahmen: " + plan.assumptions.slice(0, 3).join("; ")
        : "";
      return details + assumptions;
    }

    async sendEditorPrompt(prompt) {
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
      if (!response.ok) throw new Error(payload.error || "editor agent " + response.status);
      const message = this.editorPlanMessage(payload);
      this.addMessage("assistant", message, {
        meta: payload?.validation?.ok ? "Contract geprueft" : "Contract blockiert",
        editorPlan: payload.ok ? payload : null
      });
      this.messages.push({ role: "assistant", content: message });
    }

    async send() {
      const input = this.shadowRoot.querySelector(".input");
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      input.style.height = "";
      this.addMessage("user", text);
      this.messages.push({ role: "user", content: text });
      try {
        this.setStatus("Arbeite...", "loading");
        if (this.editorBridge()) {
          await this.sendEditorPrompt(text);
        } else if (this.mode() === "server") {
          await this.sendServer();
        } else {
          await this.sendLocal();
        }
      } catch (error) {
        this.setStatus("Fehler", "error");
        this.addMessage("assistant", error.message || String(error));
      } finally {
        this.setStatus("Bereit", "ready");
        input.focus();
      }
    }

    async sendServer() {
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
        toolCall: payload.needsConfirmation ? payload.toolCall : null
      });
      this.messages.push({ role: "assistant", content: text });
    }

    async sendLocal() {
      const engine = await this.ensureLocalEngine();
      const stream = await engine.chat.completions.create({
        messages: [
          { role: "system", content: this.systemPrompt() },
          ...this.messages.slice(-10)
        ],
        temperature: 0.2,
        stream: true
      });
      const bubble = this.addMessage("assistant", "");
      let complete = "";
      for await (const chunk of stream) {
        complete += chunk.choices?.[0]?.delta?.content || "";
        bubble.textContent = complete;
      }
      const toolCall = this.extractMcpCall(complete);
      if (toolCall) {
        bubble.textContent = "Ich frage den MCP-Broker.";
        await this.runTool(toolCall);
        this.messages.push({ role: "assistant", content: "MCP-Broker genutzt." });
        return;
      }
      this.messages.push({ role: "assistant", content: complete });
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

    async confirmEditorPlan(plan, button) {
      button.disabled = true;
      try {
        this.setStatus("Uebernehme...", "loading");
        await this.applyEditorPlan(plan);
        this.setStatus("Editor aktualisiert", "ready");
        this.addMessage("assistant", "Uebernommen. Der Editor ist die einzige Modellquelle; Undo bleibt ueber den Canvas-Verlauf moeglich.");
      } catch (error) {
        button.disabled = false;
        this.setStatus("Fehler", "error");
        this.addMessage("assistant", error.message || String(error));
      }
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
