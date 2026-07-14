"use strict";

const {
  normalizeId,
  normalizeModel,
  validateModel,
  normalizeBoundaryConfig
} = require("../mcp/state-blueprint-core");

const MAX_EVENTS = 4000;
const MAX_FRAMES = 36;
const MAX_STEPS = 40;
const MAX_TEXT = 180;
const MAX_IMAGE_BYTES = 140 * 1024;
const DEFAULT_MODEL = "gpt-5.6-luna";

const TRACE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "steps"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 120 },
    steps: {
      type: "array",
      minItems: 1,
      maxItems: MAX_STEPS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description", "actionToNext"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 100 },
          description: { type: "string", maxLength: 240 },
          actionToNext: { type: "string", maxLength: 100 }
        }
      }
    }
  }
};

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value, max = MAX_TEXT) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanNumber(value, min, max, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function cleanEvent(value, index) {
  if (!plainObject(value)) throw Object.assign(new Error("invalid_capture_event"), { status: 400, code: "invalid_capture_event" });
  const kind = cleanText(value.kind, 24);
  if (kind !== "visual") throw Object.assign(new Error("invalid_capture_event_kind"), { status: 400, code: "invalid_capture_event_kind" });
  return {
    seq: Math.round(cleanNumber(value.seq, 0, Number.MAX_SAFE_INTEGER, index + 1)),
    at: Math.round(cleanNumber(value.at, 0, Number.MAX_SAFE_INTEGER, 0)),
    kind,
    app: cleanText(value.app, 100),
    window: cleanText(value.window, 180)
  };
}

function cleanFrame(value) {
  if (!plainObject(value)) throw Object.assign(new Error("invalid_capture_frame"), { status: 400, code: "invalid_capture_frame" });
  const image = String(value.image || "");
  const match = image.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw Object.assign(new Error("invalid_capture_image"), { status: 400, code: "invalid_capture_image" });
  const bytes = Buffer.byteLength(match[1], "base64");
  if (!bytes || bytes > MAX_IMAGE_BYTES) throw Object.assign(new Error("capture_image_too_large"), { status: 413, code: "capture_image_too_large" });
  return {
    at: Math.round(cleanNumber(value.at, 0, Number.MAX_SAFE_INTEGER, 0)),
    eventSeq: Math.round(cleanNumber(value.eventSeq, 0, Number.MAX_SAFE_INTEGER, 0)),
    image
  };
}

function validateCapture(payload) {
  if (!plainObject(payload)) throw Object.assign(new Error("invalid_capture"), { status: 400, code: "invalid_capture" });
  const sourceEvents = Array.isArray(payload.events) ? payload.events : [];
  const sourceFrames = Array.isArray(payload.frames) ? payload.frames : [];
  if (!sourceEvents.length || sourceEvents.length > MAX_EVENTS) {
    throw Object.assign(new Error("invalid_capture_event_count"), { status: 400, code: "invalid_capture_event_count" });
  }
  if (sourceFrames.length > MAX_FRAMES) {
    throw Object.assign(new Error("invalid_capture_frame_count"), { status: 400, code: "invalid_capture_frame_count" });
  }
  const events = sourceEvents.map(cleanEvent);
  const frames = sourceFrames.map(cleanFrame);
  return {
    sessionId: cleanText(payload.sessionId, 80),
    startedAt: Math.round(cleanNumber(payload.startedAt, 0, Number.MAX_SAFE_INTEGER, 0)),
    endedAt: Math.round(cleanNumber(payload.endedAt, 0, Number.MAX_SAFE_INTEGER, Date.now())),
    events,
    frames
  };
}

function validateTrace(value) {
  if (!plainObject(value)) throw Object.assign(new Error("invalid_analyzer_result"), { status: 502, code: "invalid_analyzer_result" });
  const title = cleanText(value.title, 120);
  if (!title || !Array.isArray(value.steps) || !value.steps.length || value.steps.length > MAX_STEPS) {
    throw Object.assign(new Error("invalid_analyzer_result"), { status: 502, code: "invalid_analyzer_result" });
  }
  const steps = value.steps.map(step => {
    if (!plainObject(step)) throw Object.assign(new Error("invalid_analyzer_step"), { status: 502, code: "invalid_analyzer_step" });
    const item = {
      title: cleanText(step.title, 100),
      description: cleanText(step.description, 240),
      actionToNext: cleanText(step.actionToNext, 100)
    };
    if (!item.title) throw Object.assign(new Error("invalid_analyzer_step"), { status: 502, code: "invalid_analyzer_step" });
    return item;
  });
  return { title, steps };
}

function uniqueId(used, requested, fallback) {
  const base = normalizeId(requested, fallback);
  let id = base;
  let index = 2;
  while (used.has(id)) id = `${base}_${index++}`;
  used.add(id);
  return id;
}

function stateForStep(step, id, index) {
  const column = index % 5;
  const row = Math.floor(index / 5);
  const forward = row % 2 === 0;
  const displayColumn = forward ? column : 4 - column;
  return {
    id,
    title: step.title,
    components: step.description ? [{ id: `text_${id}`, type: "text", text: step.description, url: "" }] : [],
    data: {},
    dataTypes: {},
    dataSource: { url: "", target: `states.${id}.fetch`, select: "", timeoutMs: 8000, retries: 2 },
    repeat: { path: "", as: "item", index: "i" },
    dataWires: [],
    subscriptions: [],
    boundary: normalizeBoundaryConfig(null),
    parentId: null,
    x: 96 + displayColumn * 264,
    y: 120 + row * 192
  };
}

function modelFromTrace(source) {
  const trace = validateTrace(source);
  const used = new Set();
  const states = trace.steps.map((step, index) => {
    const id = uniqueId(used, step.title, `schritt_${index + 1}`);
    return stateForStep(step, id, index);
  });
  const transitions = states.slice(0, -1).map((state, index) => {
    const to = states[index + 1];
    const id = uniqueId(used, `t_${state.id}_${to.id}`, `t_${index + 1}`);
    const label = trace.steps[index].actionToNext || "Weiter";
    return {
      id,
      from: state.id,
      to: to.id,
      label,
      condition: "",
      triggerType: "button",
      triggerEvent: `button.${id}`,
      timerMs: 3000,
      set: {},
      groupEntryId: "",
      groupExitId: ""
    };
  });
  const model = { version: 2, name: trace.title, initial: states[0].id, states, transitions, boundary: normalizeBoundaryConfig(null) };
  const validation = validateModel(model);
  if (!validation.ok) {
    const error = new Error("generated_model_invalid");
    error.status = 502;
    error.code = "generated_model_invalid";
    error.validation = validation;
    throw error;
  }
  return { trace, model, validation };
}

function eventPrompt(capture) {
  return capture.events.map(event => JSON.stringify(event)).join("\n");
}

function responseText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const output of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(output?.content) ? output.content : []) {
      if (typeof content?.text === "string") return content.text;
    }
  }
  return "";
}

async function fetchJson(url, init, timeoutMs, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal, cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error("process_analyzer_failed");
      error.status = 502;
      error.code = "process_analyzer_failed";
      error.providerStatus = response.status;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function createProcessAnalyzer(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = cleanNumber(options.timeoutMs, 5000, 120000, 90000);
  const customAnalyzer = typeof options.analyzer === "function" ? options.analyzer : null;
  const customUrl = cleanText(options.analyzerUrl, 500);
  const customToken = String(options.analyzerToken || "");
  const apiKey = String(options.openAiApiKey || "");
  const model = cleanText(options.model || DEFAULT_MODEL, 100) || DEFAULT_MODEL;
  const provider = customAnalyzer ? "injected" : customUrl ? "custom" : apiKey ? "openai" : "none";

  async function analyze(payload) {
    const capture = validateCapture(payload);
    let raw;
    if (customAnalyzer) {
      raw = await customAnalyzer(capture);
    } else if (customUrl) {
      if (typeof fetchImpl !== "function") throw Object.assign(new Error("fetch_unavailable"), { status: 503, code: "fetch_unavailable" });
      raw = await fetchJson(customUrl, {
        method: "POST",
        headers: { "content-type": "application/json", ...(customToken ? { authorization: `Bearer ${customToken}` } : {}) },
        body: JSON.stringify({ contract: "zustand-process-trace-v1", capture })
      }, timeoutMs, fetchImpl);
    } else if (apiKey) {
      if (typeof fetchImpl !== "function") throw Object.assign(new Error("fetch_unavailable"), { status: 503, code: "fetch_unavailable" });
      const content = [{
        type: "input_text",
        text: "Die folgende browserseitig aufgenommene Folge stabiler Bildschirmzustände beschreibt genau einen beobachteten Arbeitsablauf. Erzeuge eine knappe lineare Prozessspur. Jeder State beschreibt ausschließlich einen fachlich sichtbaren Arbeitsschritt oder Bildschirmzustand. Benenne actionToNext nur, wenn die nächste Aktion aus den aufeinanderfolgenden Bildern nachvollziehbar ist; verwende sonst Weiter. Erfinde keine Verzweigungen, Datenwerte, Systeme, Klicks oder Schritte. Ignoriere die Bedienung oder Beobachtung des Zustand-Editors und seiner Aufnahme-Steuerung. Konkrete personenbezogene Werte dürfen nicht ausgegeben werden.\n\n" + eventPrompt(capture)
      }];
      const visualFrames = capture.frames.length <= 16
        ? capture.frames
        : Array.from({ length: 16 }, (_, index) => capture.frames[Math.round(index * (capture.frames.length - 1) / 15)]);
      for (const frame of visualFrames) {
        content.push({ type: "input_text", text: `Kontextbild nach Ereignis ${frame.eventSeq || "unbekannt"}:` });
        content.push({ type: "input_image", image_url: frame.image, detail: "low" });
      }
      const providerResponse = await fetchJson("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          store: false,
          input: [{ role: "user", content }],
          text: { format: { type: "json_schema", name: "process_trace", strict: true, schema: TRACE_SCHEMA } }
        })
      }, timeoutMs, fetchImpl);
      const text = responseText(providerResponse);
      try {
        raw = JSON.parse(text);
      } catch (_) {
        throw Object.assign(new Error("invalid_analyzer_result"), { status: 502, code: "invalid_analyzer_result" });
      }
    } else {
      throw Object.assign(new Error("process_analyzer_not_configured"), { status: 503, code: "process_analyzer_not_configured" });
    }
    const built = modelFromTrace(raw);
    return {
      ok: true,
      contract: "zustand-process-model-v1",
      model: built.model,
      summary: built.validation.summary,
      source: { events: capture.events.length, frames: capture.frames.length }
    };
  }

  return {
    provider,
    enabled: provider !== "none",
    model: provider === "openai" ? model : "",
    analyze
  };
}

module.exports = {
  MAX_EVENTS,
  MAX_FRAMES,
  MAX_IMAGE_BYTES,
  validateCapture,
  validateTrace,
  modelFromTrace,
  createProcessAnalyzer
};
