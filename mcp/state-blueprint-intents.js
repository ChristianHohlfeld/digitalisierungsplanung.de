"use strict";

const {
  normalizeId,
  normalizeBindingPath,
  normalizeStateVariableType,
  inferStateVariableType,
  defaultStateVariableValue
} = require("./state-blueprint-core");

const IMAGE_PLACEHOLDER = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NDAiIGhlaWdodD0iMzYwIiB2aWV3Qm94PSIwIDAgNjQwIDM2MCI+PHJlY3Qgd2lkdGg9IjY0MCIgaGVpZ2h0PSIzNjAiIHJ4PSIzMiIgZmlsbD0iIzBlYTVlOSIvPjx0ZXh0IHg9IjQ4IiB5PSI3MCIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjM0IiBmb250LXdlaWdodD0iNzAwIiBmaWxsPSIjZmZmZmZmIj5JbWFnZSBibG9jazwvdGV4dD48L3N2Zz4=";

function compactText(text) {
  return String(text || "").trim().replace(/\s+/g, " ");
}

function lower(text) {
  return compactText(text).toLowerCase();
}

function titleCase(text, fallback = "Next") {
  const raw = compactText(text).replace(/^["']|["']$/g, "");
  if (!raw) return fallback;
  return raw.replace(/\b\w/g, ch => ch.toUpperCase());
}

function findState(model, idOrTitle) {
  const key = compactText(idOrTitle);
  if (!key) return null;
  const normalized = normalizeId(key);
  return model.states.find(state =>
    state.id === key ||
    state.id === normalized ||
    String(state.title || "").toLowerCase() === key.toLowerCase()
  ) || null;
}

function targetState(model, args = {}) {
  return findState(model, args.selectedStateId || args.stateId || "") ||
    findState(model, model.initial || "") ||
    model.states[0] ||
    null;
}

function stateScope(stateId) {
  return `states.${normalizeId(stateId || "state")}`;
}

function componentId(stateId, suffix) {
  return `${normalizeId(stateId || "state")}_${normalizeId(suffix || "component")}`;
}

function parseDurationSeconds(prompt) {
  const text = lower(prompt);
  const matches = [...text.matchAll(/(\d+(?:[,.]\d+)?)\s*(millisekunden|milliseconds|msec|ms|sekunden|sekunde|seconds|second|secs|sec|s|minuten|minute|minutes|mins|min|m)\b/g)];
  if (!matches.length) return 20;
  const total = matches.reduce((sum, match) => {
    const value = Number(match[1].replace(",", "."));
    if (!Number.isFinite(value)) return sum;
    const unit = match[2];
    if (/^ms|msec|milli/.test(unit)) return sum + value / 1000;
    if (/^m(?!s)|min/.test(unit)) return sum + value * 60;
    return sum + value;
  }, 0);
  return total > 0 ? Math.max(1, Math.round(total)) : 20;
}

function quotedText(prompt) {
  const match = compactText(prompt).match(/["“”']([^"“”']{1,80})["“”']/);
  return match ? match[1].trim() : "";
}

function targetTitleFromPrompt(prompt, fallback = "Next") {
  const text = compactText(prompt);
  const quoted = quotedText(text);
  if (quoted) return quoted;
  const match = text.match(/\b(?:nach|zu|in|to|into)\s+([A-Za-z0-9äöüÄÖÜß _-]{2,60})/i);
  if (!match) return fallback;
  return match[1]
    .replace(/\b(?:hinzu|erstellen|anlegen|wechseln|go|gehen|state|zustand)$/i, "")
    .trim() || fallback;
}

function childTitleFromPrompt(prompt, fallback = "Step") {
  const quoted = quotedText(prompt);
  if (quoted) return quoted;
  const match = compactText(prompt).match(/\b(?:inner state|child state|unterstate|unter state|kindstate|kind state|nested state)\s+([A-Za-z0-9äöüÄÖÜß _-]{1,80})/i);
  if (!match) return targetTitleFromPrompt(prompt, fallback);
  return match[1]
    .replace(/\b(?:hinzu|erstellen|anlegen|inside|innen)$/i, "")
    .trim() || fallback;
}

function shouldCreateTimedExit(prompt) {
  const text = lower(prompt);
  return /timer|countdown|zeit|warte|delay|sekunde|second/.test(text);
}

function planTimer(model, prompt, args) {
  const state = targetState(model, args);
  const assumptions = [];
  const actions = [];
  const duration = parseDurationSeconds(prompt);
  let target = null;
  if (!state) {
    actions.push({ type: "upsert_state", id: "start", title: "Start", x: 96, y: 120 });
    actions.push({ type: "set_initial", stateId: "start" });
    assumptions.push("No state existed, so a Start state is created.");
  }
  const stateId = state?.id || "start";
  const scope = `${stateScope(stateId)}.timer`;
  actions.push({
    type: "upsert_state_variable",
    stateId,
    path: scope,
    valueType: "object",
    value: {
      duration,
      value: duration,
      label: "Seconds left",
      running: true,
      finished: false,
      startedAt: 0,
      endsAt: 0,
      doneLabel: "Done"
    }
  });
  actions.push({
    type: "add_component",
    stateId,
    component: {
      id: componentId(stateId, "countdown"),
      type: "daisy",
      variant: "countdown",
      dataPath: scope,
      dataRole: "widget",
      dataLabel: "Countdown"
    }
  });

  const targetTitle = targetTitleFromPrompt(prompt, "Next");
  target = findState(model, targetTitle);
  const targetId = target?.id || normalizeId(targetTitle);
  if (!target) {
    const x = Number(state?.x || 96) + 288;
    const y = Number(state?.y || 120);
    actions.push({ type: "upsert_state", id: targetId, title: titleCase(targetTitle, "Next"), parentId: state?.parentId || null, x, y });
    assumptions.push(`Timer completion creates target state "${titleCase(targetTitle, "Next")}".`);
  }
  actions.push({
    type: "upsert_transition",
    id: `${normalizeId(stateId)}_timer_done`,
    from: stateId,
    to: targetId,
    label: "Done",
    triggerType: "change",
    triggerEvent: `change.${scope}.finished`,
    condition: `${scope}.finished == true`,
    set: {}
  });
  assumptions.push(`Timer duration is ${duration} seconds.`);
  return {
    understood: true,
    confidence: 0.92,
    intent: "add_timer",
    targetStateId: stateId,
    actions,
    assumptions,
    explanation: "Adds a daisyUI countdown bound to state.data/global bus and a change-triggered transition when it finishes."
  };
}

function planInnerState(model, prompt, args) {
  const parent = targetState(model, args);
  const assumptions = [];
  const actions = [];
  if (!parent) {
    actions.push({ type: "upsert_state", id: "parent", title: "Parent", x: 96, y: 120 });
    actions.push({ type: "set_initial", stateId: "parent" });
    assumptions.push("No state existed, so a Parent state is created.");
  }
  const parentId = parent?.id || "parent";
  const title = childTitleFromPrompt(prompt, "Step");
  const childId = normalizeId(title);
  actions.push({
    type: "upsert_state",
    id: childId,
    title: titleCase(title, "Step"),
    parentId,
    x: 120,
    y: 120
  });
  actions.push({ type: "set_boundary", parentId, entryId: childId, exitId: childId });
  assumptions.push("The new inner state is wired as layer entry and exit so parent input/output proxies stay reusable.");
  return {
    understood: true,
    confidence: 0.9,
    intent: "add_inner_state",
    targetStateId: parentId,
    actions,
    assumptions,
    explanation: "Creates a child state inside the selected parent and wires the layer boundary through proxy transitions."
  };
}

function planTransition(model, prompt, args) {
  const source = targetState(model, args);
  const actions = [];
  const assumptions = [];
  if (!source) {
    actions.push({ type: "upsert_state", id: "start", title: "Start", x: 96, y: 120 });
    actions.push({ type: "set_initial", stateId: "start" });
    assumptions.push("No source state existed, so a Start state is created.");
  }
  const sourceId = source?.id || "start";
  const title = targetTitleFromPrompt(prompt, "Next");
  const target = findState(model, title);
  const targetId = target?.id || normalizeId(title);
  if (!target) {
    actions.push({
      type: "upsert_state",
      id: targetId,
      title: titleCase(title, "Next"),
      parentId: source?.parentId || null,
      x: Number(source?.x || 96) + 288,
      y: Number(source?.y || 120)
    });
    assumptions.push(`Target state "${titleCase(title, "Next")}" is created because it did not exist.`);
  }
  const timer = /timer|zeit|delay|auto|automatisch|after|nach \d+/i.test(prompt);
  actions.push({
    type: "upsert_transition",
    id: `${normalizeId(sourceId)}_to_${normalizeId(targetId)}`,
    from: sourceId,
    to: targetId,
    label: "Weiter",
    triggerType: timer ? "timer" : "button",
    timerMs: timer ? parseDurationSeconds(prompt) * 1000 : 3000,
    condition: "",
    set: {}
  });
  return {
    understood: true,
    confidence: 0.84,
    intent: "add_transition",
    targetStateId: sourceId,
    actions,
    assumptions,
    explanation: "Creates an explicit FSM transition; trigger data stays on the transition."
  };
}

const daisyDefaults = {
  card: { title: "Product card", body: "A concise product or content summary with one clear action.", image: IMAGE_PLACEHOLDER, imageAlt: "Image", actionLabel: "Open" },
  hero: { layout: "centered", title: "Launch your offer", body: "A focused introduction for a real page, product, or workflow with one clear next step.", actionLabel: "Get Started" },
  modal: { open: false, confirmed: false, openLabel: "Open dialog", title: "Confirm action", body: "Review the details before continuing.", actionLabel: "Confirm", closeLabel: "Close" },
  button: { label: "Continue", clicked: false, clickedAt: 0 },
  input: { label: "Name", value: "" },
  checkbox: { legend: "Preferences", label: "Accept terms", checked: false, actionLabel: "Continue" },
  toggle: { legend: "Preferences", label: "Enabled", checked: true },
  navbar: { layout: "menu-submenu", brand: "Acme Studio", selected: "Dashboard", items: ["Dashboard", "Projects", "Settings"], parent: "More", submenu: [], submenuOpen: false },
  table: { columns: ["Order", "Status"], rows: [["Order #1024", "Paid"], ["Order #1025", "Pending"]] },
  list: { items: ["First item", "Second item"] },
  image: { image: IMAGE_PLACEHOLDER, alt: "Image description" }
};

function componentIntent(prompt) {
  const text = lower(prompt);
  if (/hero/.test(text)) return "hero";
  if (/modal|dialog/.test(text)) return "modal";
  if (/navbar|navigation|nav\b/.test(text)) return "navbar";
  if (/card|karte/.test(text)) return "card";
  if (/checkbox|checkliste|terms|agb/.test(text)) return "checkbox";
  if (/toggle|switch/.test(text)) return "toggle";
  if (/table|tabelle/.test(text)) return "table";
  if (/image|bild|foto|photo/.test(text)) return "image";
  if (/input|eingabe|feld|email|password|passwort/.test(text)) return "input";
  if (/button|knopf/.test(text)) return "button";
  if (/list|liste/.test(text)) return "list";
  return "card";
}

function planComponent(model, prompt, args) {
  const state = targetState(model, args);
  const assumptions = [];
  const actions = [];
  if (!state) {
    actions.push({ type: "upsert_state", id: "start", title: "Start", x: 96, y: 120 });
    actions.push({ type: "set_initial", stateId: "start" });
    assumptions.push("No state existed, so a Start state is created.");
  }
  const stateId = state?.id || "start";
  const variant = componentIntent(prompt);
  const scope = `${stateScope(stateId)}.${variant}`;
  const value = daisyDefaults[variant] || daisyDefaults.card;
  actions.push({ type: "upsert_state_variable", stateId, path: scope, valueType: "object", value });
  actions.push({
    type: "add_component",
    stateId,
    component: {
      id: componentId(stateId, variant),
      type: "daisy",
      variant: variant === "image" ? "avatar" : variant,
      dataPath: scope,
      dataRole: "widget",
      dataLabel: titleCase(variant, "Widget")
    }
  });
  return {
    understood: true,
    confidence: 0.78,
    intent: "add_component",
    targetStateId: stateId,
    actions,
    assumptions,
    explanation: `Adds a structured daisyUI ${variant} component bound to explicit state.data/global bus paths.`
  };
}

function cleanWorkflowStepTitle(value) {
  let text = compactText(value)
    .replace(/^(?:bitte\s+)?(?:baue|bau|erstelle|erzeuge|mach|create|build|add)\s+/i, "")
    .replace(/^(?:einen|eine|nen|neuen|neuer|new|fresh)\s+/i, "")
    .replace(/^(?:flow|workflow|ablauf|prozess|process|app)\s*/i, "")
    .replace(/\b(?:flow|workflow|ablauf|prozess|process|states?|zust[aä]nde|screens?)\b/gi, "")
    .replace(/\b(?:mit|with|aus|from|namens|called|named)\b/gi, "")
    .trim();
  text = text.replace(/^[-:]+|[-:]+$/g, "").trim();
  if (!text || /^(?:und|then|dann|danach)$/i.test(text)) return "";
  return titleCase(text, "");
}

function workflowTitlesFromPrompt(prompt) {
  const text = compactText(prompt);
  const arrowParts = text
    .split(/\s*(?:->|=>|→|⇢|\bthen\b|\bdann\b|\bdanach\b)\s*/i)
    .map(cleanWorkflowStepTitle)
    .filter(Boolean);
  if (arrowParts.length >= 2) return [...new Set(arrowParts)].slice(0, 8);

  const listMatch = text.match(/\b(?:states?|screens?|schritte|steps?)\s*[:=]\s*([A-Za-z0-9 ÄÖÜäöüß_,;|.-]{3,180})/i);
  if (listMatch) {
    const titles = listMatch[1]
      .split(/\s*(?:,|;|\|)\s*/)
      .map(cleanWorkflowStepTitle)
      .filter(Boolean);
    if (titles.length >= 2) return [...new Set(titles)].slice(0, 8);
  }
  return [];
}

function workflowSpec(prompt) {
  const text = lower(prompt);
  const explicitTitles = workflowTitlesFromPrompt(prompt);
  if (explicitTitles.length >= 2) {
    return {
      name: `${explicitTitles[0]} Flow`,
      titles: explicitTitles
    };
  }
  if (/checkout|kasse|warenkorb|cart|zahlung|payment|bestell/.test(text)) {
    const german = /kasse|warenkorb|zahlung|bestell/.test(text);
    return {
      name: german ? "Checkout Ablauf" : "Checkout Flow",
      titles: german ? ["Warenkorb", "Adresse", "Zahlung", "Prüfen", "Fertig"] : ["Cart", "Shipping", "Payment", "Review", "Done"]
    };
  }
  if (/login|auth|anmeld|sign ?in/.test(text)) {
    return {
      name: /anmeld/.test(text) ? "Login Ablauf" : "Login Flow",
      titles: ["Start", "Login", "Logged In", "Error"],
      transitions: [
        { fromIndex: 0, toIndex: 1, label: "Login" },
        { fromIndex: 1, toIndex: 2, label: "Success" },
        { fromIndex: 1, toIndex: 3, label: "Error" }
      ]
    };
  }
  if (/onboarding|einrichtung|setup/.test(text)) {
    return {
      name: "Onboarding Flow",
      titles: ["Welcome", "Profile", "Preferences", "Done"]
    };
  }
  return null;
}

function shouldResetForWorkflow(model, prompt) {
  if (!model.states.length) return true;
  return /\b(?:new|fresh|blank|empty|from scratch|neu|frisch|leer|komplett neu)\b.{0,40}\b(?:flow|workflow|ablauf|prozess|app)\b/i.test(prompt);
}

function looksLikeWorkflowPrompt(prompt) {
  const text = lower(prompt);
  if (workflowTitlesFromPrompt(prompt).length >= 2) return true;
  return /\b(?:baue|bau|erstelle|erzeuge|mach|create|build|add)\b/.test(text) &&
    /\b(?:flow|workflow|ablauf|prozess|process|app)\b/.test(text);
}

function planWorkflow(model, prompt, args) {
  const spec = workflowSpec(prompt);
  if (!spec) return fallbackPlan("No concrete workflow steps were found.");
  const reset = shouldResetForWorkflow(model, prompt);
  const parent = args.parentId ? findState(model, args.parentId) : null;
  const parentId = reset ? null : parent?.id || null;
  const actions = [];
  const assumptions = [];
  if (reset) {
    actions.push({ type: "create_flow", name: spec.name });
    assumptions.push("The workflow starts from a clean model because no states exist or the prompt asked for a new flow.");
  }
  const states = spec.titles.map((title, index) => {
    const id = normalizeId(title);
    const state = {
      id,
      title,
      parentId,
      x: 96 + index * 288,
      y: 120,
      components: [{ id: componentId(id, "summary"), type: "text", text: `${title} step`, url: "" }]
    };
    actions.push({ type: "upsert_state", ...state });
    return state;
  });
  if (states[0]) actions.push({ type: "set_initial", stateId: states[0].id });
  const transitions = spec.transitions || states.slice(0, -1).map((state, index) => ({
    fromIndex: index,
    toIndex: index + 1,
    label: "Weiter"
  }));
  transitions.forEach(transition => {
    const from = states[transition.fromIndex];
    const to = states[transition.toIndex];
    if (!from || !to) return;
    actions.push({
      type: "upsert_transition",
      id: `${normalizeId(from.id)}_to_${normalizeId(to.id)}`,
      from: from.id,
      to: to.id,
      label: transition.label || "Weiter",
      triggerType: "button",
      condition: transition.condition || "",
      set: transition.set || {}
    });
  });
  assumptions.push(`Created ${states.length} states and ${transitions.length} button transition(s).`);
  return {
    understood: true,
    confidence: 0.86,
    intent: "create_workflow",
    targetStateId: states[0]?.id || "",
    targetTitle: spec.name,
    workflowTitles: states.map(state => state.title),
    actions,
    assumptions,
    explanation: "Creates a real FSM workflow: states plus explicit button transitions. The runtime still moves only through the global event/transition bus."
  };
}

function planVariable(model, prompt, args) {
  const state = targetState(model, args);
  const actions = [];
  const assumptions = [];
  if (!state) {
    actions.push({ type: "upsert_state", id: "start", title: "Start", x: 96, y: 120 });
    actions.push({ type: "set_initial", stateId: "start" });
  }
  const stateId = state?.id || "start";
  const quoted = quotedText(prompt);
  const text = lower(prompt);
  const path = normalizeBindingPath(quoted, "") ||
    (text.includes("email") || text.includes("mail") ? "email" :
      text.includes("password") || text.includes("passwort") ? "password" :
        text.includes("image") || text.includes("bild") ? "imageUrl" :
          text.includes("url") || text.includes("link") ? "url" :
            text.includes("count") || text.includes("zahl") ? "count" : "value");
  const explicitType = ["email", "password", "number", "boolean", "url", "image", "object", "list", "text"].find(type => text.includes(type)) || "";
  const valueType = normalizeStateVariableType(explicitType || inferStateVariableType(path, ""));
  actions.push({ type: "upsert_state_variable", stateId, path, valueType, value: defaultStateVariableValue(valueType) });
  assumptions.push(`Variable "${path}" is declared on the selected state's scoped view of the global bus.`);
  return {
    understood: true,
    confidence: 0.75,
    intent: "add_state_variable",
    targetStateId: stateId,
    actions,
    assumptions,
    explanation: "Adds a typed state variable declaration as state.data + state.dataTypes."
  };
}

function planFetch(model, prompt, args) {
  const state = targetState(model, args);
  const actions = [];
  const assumptions = [];
  if (!state) {
    actions.push({ type: "upsert_state", id: "start", title: "Start", x: 96, y: 120 });
    actions.push({ type: "set_initial", stateId: "start" });
  }
  const stateId = state?.id || "start";
  const url = compactText(prompt).match(/https?:\/\/[^\s"']+/)?.[0] || "";
  const target = `${stateScope(stateId)}.fetch`;
  const repeatPath = `${target}.data`;
  actions.push({ type: "configure_fetch", stateId, url, target, select: "" });
  if (/list|liste|repeat|wiederhol/.test(lower(prompt))) {
    actions.push({ type: "configure_repeat", stateId, path: repeatPath, as: "item", index: "i", manual: true });
    actions.push({ type: "upsert_data_wire", stateId, id: `${normalizeId(stateId)}_fetch_title`, sourcePath: `${repeatPath}.title`, scopePath: repeatPath, itemPath: "title", role: "title", componentType: "heading", label: "Title" });
    actions.push({ type: "add_component", stateId, component: { id: `${normalizeId(stateId)}_fetch_title_render`, type: "dataWire", wireId: `${normalizeId(stateId)}_fetch_title` } });
    assumptions.push(`The state is configured to repeat over ${repeatPath}.`);
  }
  if (!url) assumptions.push("No URL was found in the prompt; the fetch target is prepared but the URL stays empty.");
  return {
    understood: true,
    confidence: url ? 0.84 : 0.68,
    intent: "configure_fetch",
    targetStateId: stateId,
    actions,
    assumptions,
    explanation: "Configures state-entry fetch into the selected state's scoped global bus target."
  };
}

function planPrompt(model, args = {}) {
  const prompt = compactText(args.prompt || args.message || "");
  const text = lower(prompt);
  if (!prompt) return fallbackPlan("Empty prompt.");
  if (looksLikeWorkflowPrompt(prompt)) return planWorkflow(model, prompt, args);
  if (/timer|countdown|warte|delay|sekunde|second/.test(text)) return planTimer(model, prompt, args);
  if (/inner state|child state|unterstate|unter state|kindstate|kind state|nested state|verschachtel|inside state|state.*inside/.test(text)) return planInnerState(model, prompt, args);
  if (/api|fetch|endpoint|daten laden|lade daten|json/.test(text)) return planFetch(model, prompt, args);
  if (/transition|übergang|uebergang|verbinde|connect|wire|route|gehe zu|go to|nach .*state|zu .*state/.test(text)) return planTransition(model, prompt, args);
  if (/variable|statevar|state var|feld|email|password|passwort|typ/.test(text) && !/input|formular|form|component|komponente|preset/.test(text)) return planVariable(model, prompt, args);
  if (/preset|component|komponente|daisy|card|karte|hero|modal|navbar|button|knopf|input|formular|form|image|bild|liste|list|table|tabelle|checkbox|toggle/.test(text)) return planComponent(model, prompt, args);
  return fallbackPlan("No supported intent matched the prompt.");
}

function fallbackPlan(reason) {
  return {
    understood: false,
    confidence: 0,
    intent: "unknown",
    targetStateId: "",
    actions: [],
    assumptions: [reason],
    explanation: "Use direct actions or one of the prompt intents: create workflow, add timer, add inner state, add transition, add preset/component, add variable, configure API/list.",
    examples: [
      "füge timer 10s hinzu und weiter zu Done",
      "erstelle inner state Schritt 1",
      "verbinde diesen State mit Checkout",
      "füge Card Preset hinzu",
      "füge Variable email vom Typ email hinzu",
      "lade API https://example.test/items als Liste",
      "baue checkout workflow"
    ]
  };
}

function promptIntentMarkdown() {
  return [
    "# State Blueprint Prompt Intents",
    "",
    "Use `state_blueprint_plan_prompt` when a natural-language edit request should become model actions.",
    "Use `state_blueprint_apply_prompt` only when the plan is acceptable to apply immediately.",
    "",
    "Supported intents:",
    "",
    "- `add_timer`: phrases like `füge timer hinzu`, `add countdown 10s`, `warte 5 Sekunden und weiter zu Done`.",
    "- `add_inner_state`: phrases like `erstelle inner state Step 1`, `add child state Details`.",
    "- `add_transition`: phrases like `verbinde mit Checkout`, `add transition to Done`, `gehe zu Error`.",
    "- `add_component`: phrases like `füge Card Preset hinzu`, `add modal`, `add email input`.",
    "- `add_state_variable`: phrases like `füge variable email vom typ email hinzu`.",
    "- `configure_fetch`: phrases like `lade API https://... als Liste`.",
    "- `create_workflow`: phrases like `baue checkout workflow`, `build login flow`, `Cart -> Shipping -> Payment -> Done`.",
    "",
    "Machine contract reminders:",
    "",
    "- Generated actions are ordinary State Blueprint actions.",
    "- State variables become `state.data` and `state.dataTypes` declarations.",
    "- Components bind through explicit `dataPath` values.",
    "- Timer completion is a transition with `triggerType: change` and a bus condition.",
    "- Inner states use boundary input/output proxy transitions, not cross-layer wires.",
    "- If the prompt is ambiguous, inspect `assumptions` and use `state_blueprint_apply_actions` manually."
  ].join("\n");
}

module.exports = {
  planPrompt,
  promptIntentMarkdown
};
