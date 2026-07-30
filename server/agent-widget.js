"use strict";

const { randomUUID } = require("node:crypto");
const { URL } = require("node:url");
const stateBlueprintMcp = require("../mcp/state-blueprint-server");
const { applyActions, modelSummary, validateModel } = require("../mcp/state-blueprint-core");
const { planPrompt } = require("../mcp/state-blueprint-intents");

const AGENT_SCHEMA_VERSION = 1;
const DEFAULT_AGENT_PATH = "/agent.html";
const DEFAULT_AGENT_CONFIG_PATH = "/agent/config";
const DEFAULT_AGENT_CHAT_PATH = "/agent/chat";
const DEFAULT_AGENT_MCP_TOOL_PATH = "/agent/mcp/tool";
const DEFAULT_AGENT_EDITOR_PROMPT_PATH = "/agent/editor/prompt";
const DEFAULT_AGENT_WIDGET_SCRIPT_PATH = "/assets/agent-widget.js";
const DEFAULT_AGENT_MODEL = "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC";
const DEFAULT_AGENT_WEBLLM_PACKAGE_URL = "https://esm.run/@mlc-ai/web-llm";
const MAX_AGENT_MESSAGES = 16;
const MAX_AGENT_MESSAGE_CHARS = 12000;
const MAX_TOOL_RESULT_CHARS = 20000;
const MAX_TOOL_CALLS = 4;
const MCP_SERVER_ID = "state-blueprint";

const READ_ONLY_TOOLS = new Set([
  "state_blueprint_get_model",
  "state_blueprint_plan_prompt",
  "state_blueprint_validate",
  "state_blueprint_export_definition",
  "state_blueprint_action_catalog",
  "state_blueprint_command_catalog"
]);

const WRITING_TOOLS = new Set([
  "state_blueprint_replace_model",
  "state_blueprint_apply_actions",
  "state_blueprint_apply_commands",
  "state_blueprint_apply_prompt",
  "state_blueprint_import_definition",
  "state_blueprint_export_html"
]);

const ALLOWED_TOOLS = new Set([...READ_ONLY_TOOLS, ...WRITING_TOOLS]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function agentError(code, status = 400, detail = "") {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  if (detail) error.detail = detail;
  return error;
}

function parseBoolean(value, fallback = false) {
  if (value === true || value === false) return value;
  const text = String(value || "").trim().toLowerCase();
  if (!text) return fallback;
  return ["1", "true", "yes", "on"].includes(text);
}

function uniqueSecrets(values) {
  return [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))];
}

function agentAuthSecrets(config = {}) {
  return uniqueSecrets([
    config.agentSecret,
    config.adminSecret,
    config.mcpSecret
  ]);
}

function normalizeProviderBaseUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash) {
      return "";
    }
    return url.href;
  } catch (_) {
    return "";
  }
}

function chatCompletionsUrl(config = {}) {
  if (config.agentChatCompletionsUrl) return normalizeProviderBaseUrl(config.agentChatCompletionsUrl);
  const base = normalizeProviderBaseUrl(config.agentModelBaseUrl);
  if (!base) return "";
  const url = new URL(base);
  const cleanPath = url.pathname.replace(/\/+$/, "");
  if (cleanPath.endsWith("/v1/chat/completions")) return url.href;
  url.pathname = `${cleanPath.endsWith("/v1") ? cleanPath : `${cleanPath}/v1`}/chat/completions`.replace(/\/{2,}/g, "/");
  url.search = "";
  return url.href;
}

function publicTools() {
  const byName = new Map(stateBlueprintMcp.tools.map(tool => [tool.name, tool]));
  return [...ALLOWED_TOOLS]
    .filter(name => byName.has(name))
    .map(name => {
      const tool = byName.get(name);
      return {
        name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        readOnly: READ_ONLY_TOOLS.has(name),
        mutatesWorkspace: WRITING_TOOLS.has(name),
        writesFile: name === "state_blueprint_export_definition" || name === "state_blueprint_export_html",
        requiresConfirmation: WRITING_TOOLS.has(name) || name === "state_blueprint_export_definition"
      };
    });
}

function openAiTools() {
  return publicTools().map(tool => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema || { type: "object", additionalProperties: true }
    }
  }));
}

function publicAgentConfig(config = {}) {
  const providerUrl = chatCompletionsUrl(config);
  return {
    schemaVersion: AGENT_SCHEMA_VERSION,
    name: "App Intelligence",
    widget: {
      pagePath: config.agentPath || DEFAULT_AGENT_PATH,
      scriptPath: config.agentWidgetScriptPath || DEFAULT_AGENT_WIDGET_SCRIPT_PATH,
      configPath: config.agentConfigPath || DEFAULT_AGENT_CONFIG_PATH,
      chatPath: config.agentChatPath || DEFAULT_AGENT_CHAT_PATH,
      mcpToolPath: config.agentMcpToolPath || DEFAULT_AGENT_MCP_TOOL_PATH,
      editorPromptPath: config.agentEditorPromptPath || DEFAULT_AGENT_EDITOR_PROMPT_PATH,
      defaultMode: providerUrl ? "server" : "local-webllm",
      defaultModel: config.agentModel || DEFAULT_AGENT_MODEL,
      webLlmPackageUrl: config.agentWebLlmPackageUrl || DEFAULT_AGENT_WEBLLM_PACKAGE_URL,
      authRequired: agentAuthSecrets(config).length > 0
    },
    providers: {
      localWebLlm: {
        enabled: true,
        model: config.agentModel || DEFAULT_AGENT_MODEL,
        packageUrl: config.agentWebLlmPackageUrl || DEFAULT_AGENT_WEBLLM_PACKAGE_URL
      },
      openAiCompatible: {
        enabled: Boolean(providerUrl),
        model: config.agentModel || "",
        baseUrlConfigured: Boolean(providerUrl)
      }
    },
    mcpServers: [{
      id: MCP_SERVER_ID,
      label: "State Blueprint MCP",
      transport: "server-broker",
      sourceOfTruth: "STATE_BLUEPRINT_MODEL_PATH",
      toolPath: config.agentMcpToolPath || DEFAULT_AGENT_MCP_TOOL_PATH,
      tools: publicTools()
    }],
    policy: {
      noBrowserSecrets: true,
      noModelShadowState: true,
      writesRequireConfirmation: true,
      modelSourceOfTruth: "state-blueprint.workspace via STATE_BLUEPRINT_MODEL_PATH",
      editorBridgeSourceOfTruth: "browser-supplied editor model snapshot"
    }
  };
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) throw agentError("agent_messages_required", 400);
  return messages
    .filter(message => isPlainObject(message))
    .map(message => {
      const role = ["user", "assistant", "system", "tool"].includes(message.role) ? message.role : "user";
      const content = String(message.content || "").slice(0, MAX_AGENT_MESSAGE_CHARS);
      return { role, content };
    })
    .filter(message => message.content)
    .slice(-MAX_AGENT_MESSAGES);
}

function parseToolArguments(value) {
  if (value === undefined || value === null || value === "") return {};
  if (isPlainObject(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (isPlainObject(parsed)) return parsed;
    } catch (_) {
      throw agentError("agent_tool_arguments_invalid", 400);
    }
  }
  throw agentError("agent_tool_arguments_invalid", 400);
}

function normalizeToolRequest(payload = {}) {
  if (!isPlainObject(payload)) throw agentError("agent_tool_request_invalid", 400);
  const serverId = String(payload.serverId || MCP_SERVER_ID).trim();
  const name = String(payload.name || payload.tool || "").trim();
  if (serverId !== MCP_SERVER_ID) throw agentError("agent_mcp_server_unknown", 404);
  if (!ALLOWED_TOOLS.has(name)) throw agentError("agent_tool_not_allowed", 403);
  return {
    serverId,
    name,
    arguments: parseToolArguments(payload.arguments),
    confirmed: payload.confirmed === true,
    idempotencyKey: String(payload.idempotencyKey || randomUUID()).slice(0, 128)
  };
}

function toolRequiresConfirmation(name, args = {}) {
  if (WRITING_TOOLS.has(name)) return true;
  return name === "state_blueprint_export_definition" && Object.prototype.hasOwnProperty.call(args, "outputPath");
}

function executeMcpTool(config, payload) {
  const request = normalizeToolRequest(payload);
  const mutatesWorkspace = WRITING_TOOLS.has(request.name);
  if (toolRequiresConfirmation(request.name, request.arguments) && !request.confirmed) {
    return {
      ok: false,
      needsConfirmation: true,
      serverId: request.serverId,
      name: request.name,
      arguments: request.arguments,
      reason: "write_requires_confirmation"
    };
  }
  const result = stateBlueprintMcp.handleMessage({
    jsonrpc: "2.0",
    id: request.idempotencyKey,
    method: "tools/call",
    params: {
      name: request.name,
      arguments: request.arguments
    }
  }, { modelPath: config.mcpModelPath });
  if (!result?.result) throw agentError("agent_mcp_tool_failed", 502);
  return {
    ok: !result.result.isError,
    serverId: request.serverId,
    name: request.name,
    readOnly: READ_ONLY_TOOLS.has(request.name),
    mutatesWorkspace,
    result: result.result
  };
}

function systemPrompt(config = {}) {
  const toolLines = publicTools().map(tool => {
    const mode = tool.mutatesWorkspace
      ? "workspace write, needs explicit confirmation"
      : tool.writesFile
        ? "read; outputPath writes a file and needs explicit confirmation"
        : "read";
    return `- ${tool.name}: ${mode}. ${tool.description}`;
  });
  return [
    "You are App Intelligence for digitalisierungsplanung.de.",
    "Help users create, inspect, validate, export, and load State Blueprint FSM workflows.",
    "The canonical state is the MCP workspace file behind STATE_BLUEPRINT_MODEL_PATH.",
    "Never invent or maintain separate workflow state in chat. Use MCP tools for workflow facts.",
    "Do not suggest DOM clicking or hidden local stores. Use explicit MCP actions, commands, import, export, or validate.",
    "For writes, explain the change and let the broker require confirmation.",
    "",
    "Available MCP tools:",
    ...toolLines
  ].join("\n");
}

function normalizeChatRequest(payload = {}) {
  if (!isPlainObject(payload)) throw agentError("agent_chat_request_invalid", 400);
  const messages = sanitizeMessages(payload.messages || [{ role: "user", content: payload.message }]);
  if (!messages.some(message => message.role === "user")) throw agentError("agent_user_message_required", 400);
  return {
    messages,
    confirmWrites: payload.confirmWrites === true
  };
}

function normalizeEditorPromptRequest(payload = {}) {
  if (!isPlainObject(payload)) throw agentError("agent_editor_request_invalid", 400);
  const prompt = String(payload.prompt || "").trim().slice(0, MAX_AGENT_MESSAGE_CHARS);
  if (!prompt) throw agentError("agent_editor_prompt_required", 400);
  const validation = validateModel(payload.model);
  if (!validation.ok) {
    const error = agentError("agent_editor_model_invalid", 400);
    error.validation = validation;
    throw error;
  }
  const selectedStateId = String(payload.selectedStateId || "").trim();
  return {
    prompt,
    model: validation.model,
    selectedStateId: validation.model.states.some(state => state.id === selectedStateId) ? selectedStateId : ""
  };
}

function planEditorPrompt(_config, payload = {}) {
  const request = normalizeEditorPromptRequest(payload);
  const plan = planPrompt(request.model, {
    prompt: request.prompt,
    selectedStateId: request.selectedStateId,
    allowUnknown: true
  });
  const actions = Array.isArray(plan.actions) ? plan.actions : [];
  const base = {
    ok: false,
    mode: "editor-bridge",
    sourceOfTruth: "browser-model-snapshot",
    tool: {
      serverId: MCP_SERVER_ID,
      name: "state_blueprint_apply_prompt",
      dryRun: true
    },
    plan,
    actions,
    validation: validateModel(request.model),
    previewModel: request.model,
    summary: modelSummary(request.model)
  };
  if (!actions.length) return base;
  try {
    const result = applyActions(request.model, actions, { allowInvalid: false });
    return {
      ...base,
      ok: Boolean(plan.understood && result.validation.ok),
      results: result.results,
      validation: result.validation,
      previewModel: result.model,
      summary: modelSummary(result.model)
    };
  } catch (error) {
    return {
      ...base,
      error: error.message,
      validation: error.validation || base.validation
    };
  }
}

async function callOpenAiChat(config, messages, tools = openAiTools()) {
  const endpoint = chatCompletionsUrl(config);
  if (!endpoint) throw agentError("agent_model_not_configured", 503);
  const fetcher = config.agentModelFetcher || globalThis.fetch;
  if (typeof fetcher !== "function") throw agentError("agent_model_fetch_unavailable", 500);
  const headers = { "content-type": "application/json" };
  if (config.agentModelApiKey) headers.authorization = `Bearer ${config.agentModelApiKey}`;
  const response = await fetcher(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.agentModel,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.2
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw agentError("agent_model_request_failed", 502, String(payload?.error?.message || payload?.error || response.status || "").slice(0, 300));
  }
  return payload;
}

async function runAgentChat(config, payload = {}) {
  const request = normalizeChatRequest(payload);
  const conversation = [
    { role: "system", content: systemPrompt(config) },
    ...request.messages
  ];
  const toolRuns = [];

  for (let index = 0; index < MAX_TOOL_CALLS; index += 1) {
    const completion = await callOpenAiChat(config, conversation);
    const choice = completion?.choices?.[0] || {};
    const message = choice.message || {};
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (!toolCalls.length) {
      return {
        ok: true,
        mode: "server",
        model: config.agentModel,
        message: {
          role: "assistant",
          content: String(message.content || "")
        },
        toolRuns
      };
    }

    conversation.push({
      role: "assistant",
      content: String(message.content || ""),
      tool_calls: toolCalls
    });

    for (const call of toolCalls) {
      const name = String(call?.function?.name || "");
      const args = parseToolArguments(call?.function?.arguments || "{}");
      const toolRun = executeMcpTool(config, {
        serverId: MCP_SERVER_ID,
        name,
        arguments: args,
        confirmed: request.confirmWrites
      });
      toolRuns.push({
        name,
        ok: toolRun.ok,
        needsConfirmation: toolRun.needsConfirmation === true,
        mutatesWorkspace: WRITING_TOOLS.has(name)
      });
      if (toolRun.needsConfirmation) {
        return {
          ok: false,
          mode: "server",
          needsConfirmation: true,
          message: {
            role: "assistant",
            content: "Diese Änderung schreibt in den kanonischen State-Blueprint-Workspace und braucht eine Bestätigung."
          },
          toolCall: {
            serverId: MCP_SERVER_ID,
            name,
            arguments: args
          },
          toolRuns
        };
      }
      conversation.push({
        role: "tool",
        tool_call_id: String(call.id || name),
        name,
        content: JSON.stringify(toolRun.result?.structuredContent || toolRun.result || {}).slice(0, MAX_TOOL_RESULT_CHARS)
      });
    }
  }

  return {
    ok: true,
    mode: "server",
    model: config.agentModel,
    message: {
      role: "assistant",
      content: "Ich habe die verfügbaren MCP-Werkzeuge geprüft, brauche aber eine engere Anweisung für den nächsten sauberen Schritt."
    },
    toolRuns
  };
}

module.exports = {
  AGENT_SCHEMA_VERSION,
  DEFAULT_AGENT_PATH,
  DEFAULT_AGENT_CONFIG_PATH,
  DEFAULT_AGENT_CHAT_PATH,
  DEFAULT_AGENT_MCP_TOOL_PATH,
  DEFAULT_AGENT_EDITOR_PROMPT_PATH,
  DEFAULT_AGENT_WIDGET_SCRIPT_PATH,
  DEFAULT_AGENT_MODEL,
  DEFAULT_AGENT_WEBLLM_PACKAGE_URL,
  READ_ONLY_TOOLS,
  WRITING_TOOLS,
  ALLOWED_TOOLS,
  agentAuthSecrets,
  agentError,
  publicAgentConfig,
  executeMcpTool,
  planEditorPrompt,
  runAgentChat,
  systemPrompt,
  chatCompletionsUrl
};
