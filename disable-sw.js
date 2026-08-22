(() => {
  async function clearLegacyServiceWorkerCaches() {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
      await Promise.all(registrations.map(registration => registration.unregister()));
    }
    if ("caches" in window) {
      const names = await caches.keys().catch(() => []);
      await Promise.all(names.map(name => caches.delete(name)));
    }
  }

  void clearLegacyServiceWorkerCaches();

  const FOCUSED_PRESET_IDS = Object.freeze([
    "builtin_daisy_dropdown",
    "builtin_daisy_button",
    "builtin_daisy_toast",
    "builtin_daisy_checkbox",
    "builtin_daisy_input",
    "builtin_daisy_input_number",
    "builtin_daisy_search",
    "builtin_daisy_input_email",
    "builtin_daisy_input_password",
    "builtin_page_heading",
    "builtin_media_image",
    "builtin_daisy_date",
    "builtin_daisy_radio"
  ]);
  const FOCUSED_COMPONENT_TYPES = Object.freeze(["heading", "image"]);
  const FOCUSED_PRESET_ID_SET = new Set(FOCUSED_PRESET_IDS);
  const FOCUSED_OPTION_LABELS = new Map([
    ["heading", "Header"],
    ["image", "Image"]
  ]);
  const RULE_OPERATORS = Object.freeze(["==", "!=", ">", ">=", "<", "<=", "truthy", "falsy"]);
  const SIMPLE_RULE_FIELD_FALLBACKS = Object.freeze([
    { path: "states.checkbox_a.checked", label: "Checkbox A (checkbox_a) · checked", type: "boolean" },
    { path: "states.checkbox_b.checked", label: "Checkbox B (checkbox_b) · checked", type: "boolean" },
    { path: "states.email.value", label: "E-Mail (email) · value", type: "email" },
    { path: "states.search.value", label: "Suche (search) · value", type: "text" },
    { path: "realtime.sip.call.incoming.detail.caller", label: "Event · Anrufer", type: "text" }
  ]);
  const INSPECTOR_SEMANTICS = Object.freeze({
    state: {
      title: "State-Trigger",
      help: "Der State bestimmt den Trigger-Kontext: Klick, Timer, Webhook/Event oder Auto.",
      owns: ["triggerType", "timerMs", "eventName", "componentId"]
    },
    transition: {
      title: "Transition lauscht auf Signal",
      help: "Die Transition filtert einfach: Feld, Operator, Wert. Checkboxen und Inputs bleiben über ihre State-ID unterscheidbar.",
      owns: ["listener", "rules", "targetStateId"]
    }
  });

  function focusedOption(value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }

  function replaceOptions(select, allowedValues, labels = new Map()) {
    const previous = String(select.value || "");
    const nextValues = allowedValues.filter(value => typeof value === "string" && value);
    select.replaceChildren(...nextValues.map(value => focusedOption(value, labels.get(value) || value)));
    select.value = nextValues.includes(previous) ? previous : nextValues[0] || "";
  }

  function prunePresetSelect(select) {
    const previous = String(select.value || "");
    for (const option of [...select.options]) {
      if (!FOCUSED_PRESET_ID_SET.has(String(option.value || ""))) option.remove();
    }
    if (!FOCUSED_PRESET_ID_SET.has(previous) && select.options.length) select.value = select.options[0].value;
  }

  function pruneInspectorSelect(select) {
    const label = String(select.getAttribute("aria-label") || "").toLowerCase();
    if (select.classList.contains("component-type-select") || label.includes("komponenten-vorlage")) {
      replaceOptions(select, [...FOCUSED_COMPONENT_TYPES], FOCUSED_OPTION_LABELS);
      return;
    }
    if (label.includes("bausteinvorlage")) prunePresetSelect(select);
  }

  function ruleValueLiteral(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "\"\"";
    if (/^-?\d+(?:\.\d+)?$/.test(raw) || raw === "true" || raw === "false") return raw;
    return JSON.stringify(raw);
  }

  function parseRuleAtom(raw) {
    const atom = String(raw || "").trim();
    if (!atom || atom === "true") return null;
    if (atom.startsWith("!")) return { field: atom.slice(1).trim(), operator: "falsy", value: "" };
    const match = atom.match(/^([a-zA-Z_][a-zA-Z0-9_]*(?:\.(?:[a-zA-Z_][a-zA-Z0-9_]*|\d+))*)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
    if (match) return { field: match[1], operator: match[2], value: String(match[3] || "").replace(/^[\"']|[\"']$/g, "") };
    return { field: atom, operator: "truthy", value: "" };
  }

  function parseConditionRules(condition) {
    const text = String(condition || "").trim();
    if (!text) return { join: "and", rules: [] };
    const join = text.includes("||") ? "or" : "and";
    const splitter = join === "or" ? "||" : "&&";
    return { join, rules: text.split(splitter).map(parseRuleAtom).filter(Boolean) };
  }

  function compileConditionRules(rules, join) {
    const glue = join === "or" ? " || " : " && ";
    return (rules || []).map(rule => {
      const field = String(rule.field || "").trim();
      if (!field) return "";
      const operator = RULE_OPERATORS.includes(rule.operator) ? rule.operator : "==";
      if (operator === "truthy") return field;
      if (operator === "falsy") return "!" + field;
      return `${field} ${operator} ${ruleValueLiteral(rule.value)}`;
    }).filter(Boolean).join(glue);
  }

  function conditionInputCandidate(input) {
    if (!input || input.dataset.stateBlueprintRuleBuilder === "1") return false;
    const tag = String(input.tagName || "").toLowerCase();
    if (tag !== "input" && tag !== "textarea") return false;
    const type = String(input.getAttribute("type") || "text").toLowerCase();
    if (!["", "text", "search"].includes(type) && tag !== "textarea") return false;
    const text = [
      input.getAttribute("aria-label"),
      input.getAttribute("name"),
      input.getAttribute("placeholder"),
      input.id,
      input.closest("label")?.textContent,
      input.parentElement?.textContent
    ].map(value => String(value || "").toLowerCase()).join(" ");
    return /\b(condition|bedingung|regel|filter|lauscht|signal)\b/.test(text);
  }

  function collectRuleFields(root = document) {
    const fields = [];
    const push = (path, label, type = "text") => {
      const cleanPath = String(path || "").trim();
      if (!cleanPath || fields.some(item => item.path === cleanPath)) return;
      fields.push({ path: cleanPath, label: String(label || cleanPath), type });
    };
    const supplied = Array.isArray(window.STATE_BLUEPRINT_RULE_BUILDER_FIELDS) ? window.STATE_BLUEPRINT_RULE_BUILDER_FIELDS : [];
    for (const item of supplied) {
      if (typeof item === "string") push(item, item);
      else if (item?.path) push(item.path, item.label || item.path, item.type || "text");
    }
    root.querySelectorAll?.("#pRuleField option, #pCondDataList option").forEach(option => {
      push(option.value, option.textContent || option.label || option.value, /checked$/i.test(option.value) ? "boolean" : "text");
    });
    SIMPLE_RULE_FIELD_FALLBACKS.forEach(item => push(item.path, item.label, item.type));
    return fields.slice(0, 160);
  }

  function optionListForFields(id, root = document) {
    const datalist = document.createElement("datalist");
    datalist.id = id;
    for (const field of collectRuleFields(root)) {
      const option = document.createElement("option");
      option.value = field.path;
      option.label = field.label;
      datalist.appendChild(option);
    }
    return datalist;
  }

  function installRuleBuilderForConditionInput(input) {
    if (!conditionInputCandidate(input)) return;
    input.dataset.stateBlueprintRuleBuilder = "1";
    const parsed = parseConditionRules(input.value);
    let rules = parsed.rules.length ? parsed.rules : [{ field: "", operator: "==", value: "" }];
    let join = parsed.join;
    const root = document.createElement("div");
    root.className = "state-blueprint-rule-builder";
    root.style.cssText = "display:grid;gap:8px;margin-top:8px;padding:8px;border:1px solid rgba(56,189,248,.28);border-radius:10px;background:rgba(2,6,23,.28)";
    const head = document.createElement("div");
    head.style.cssText = "display:flex;gap:8px;align-items:center;justify-content:space-between;color:#bae6fd;font-size:12px;font-weight:800";
    head.textContent = "Transition lauscht auf Signal / Regel";
    const joinSelect = document.createElement("select");
    joinSelect.setAttribute("aria-label", "Regeln verbinden");
    joinSelect.style.cssText = "max-width:110px;min-height:30px";
    joinSelect.append(focusedOption("and", "UND"), focusedOption("or", "ODER"));
    joinSelect.value = join;
    head.appendChild(joinSelect);
    const rows = document.createElement("div");
    rows.style.cssText = "display:grid;gap:6px";
    const add = document.createElement("button");
    add.type = "button";
    add.textContent = "+ Regel";
    add.style.cssText = "justify-self:start;min-height:30px;padding:4px 10px;border:1px solid rgba(56,189,248,.42);border-radius:999px;background:#071321;color:#bfdbfe;font-weight:800";
    const datalistId = "rule-fields-" + Math.random().toString(36).slice(2);
    root.append(head, optionListForFields(datalistId, input.ownerDocument), rows, add);

    function syncInput() {
      input.value = compileConditionRules(rules, join);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function renderRows() {
      rows.replaceChildren(...rules.map((rule, index) => simpleRuleRow(rule, index, datalistId, next => {
        rules[index] = next;
        syncInput();
        renderRows();
      }, () => {
        rules.splice(index, 1);
        if (!rules.length) rules.push({ field: "", operator: "==", value: "" });
        syncInput();
        renderRows();
      })));
    }

    joinSelect.addEventListener("change", () => { join = joinSelect.value; syncInput(); });
    add.addEventListener("click", () => { rules.push({ field: "", operator: "==", value: "" }); renderRows(); });
    input.addEventListener("change", () => {
      const next = parseConditionRules(input.value);
      join = next.join;
      rules = next.rules.length ? next.rules : [{ field: "", operator: "==", value: "" }];
      joinSelect.value = join;
      renderRows();
    });
    renderRows();
    input.insertAdjacentElement("afterend", root);
  }

  function simpleRuleRow(rule, index, datalistId, onUpdate, onRemove) {
    const row = document.createElement("div");
    row.className = "simple-inspector-rule-row";
    row.style.cssText = "display:grid;grid-template-columns:minmax(130px,1fr) 84px minmax(84px,1fr) auto;gap:6px;align-items:center";
    const field = document.createElement("input");
    field.placeholder = "Feld";
    field.setAttribute("list", datalistId);
    field.value = rule.field || "";
    const op = document.createElement("select");
    for (const value of RULE_OPERATORS) op.appendChild(focusedOption(value, value === "truthy" ? "ist wahr" : value === "falsy" ? "ist falsch" : value));
    op.value = rule.operator || "==";
    const val = document.createElement("input");
    val.placeholder = "Wert";
    val.value = rule.value ?? "";
    val.disabled = op.value === "truthy" || op.value === "falsy";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "Regel löschen";
    remove.setAttribute("aria-label", `Regel ${index + 1} löschen`);
    remove.style.cssText = "min-width:34px;min-height:30px;border:1px solid rgba(251,113,133,.42);border-radius:8px;color:#fecdd3";
    const update = () => onUpdate({ field: field.value, operator: op.value, value: val.value });
    field.addEventListener("input", update);
    op.addEventListener("change", () => { val.disabled = op.value === "truthy" || op.value === "falsy"; update(); });
    val.addEventListener("input", update);
    remove.addEventListener("click", onRemove);
    row.append(field, op, val, remove);
    return row;
  }

  function installVisibleTransitionRuleBuilder(root = document) {
    const cond = root.querySelector?.("#pCond") || document.querySelector("#pCond");
    const panel = root.querySelector?.(".transition-rule-panel") || document.querySelector(".transition-rule-panel");
    if (!cond || !panel || panel.dataset.simpleInspectorRules === "1") return;
    panel.dataset.simpleInspectorRules = "1";

    panel.querySelector(".small")?.replaceChildren(
      Object.assign(document.createElement("b"), { textContent: "Transition lauscht auf Signal" }),
      document.createElement("br"),
      Object.assign(document.createElement("span"), { textContent: "Einfache Regeln: Feld, Operator, Wert. Checkboxen und Inputs sind über ihre State-ID eindeutig." })
    );
    panel.querySelector("#pRuleQuickChips")?.setAttribute("hidden", "");
    panel.querySelector(".transition-rule-grid")?.setAttribute("hidden", "");
    panel.querySelector("#pRuleValueSlot")?.setAttribute("hidden", "");
    panel.querySelector(".transition-rule-actions")?.setAttribute("hidden", "");
    panel.querySelector("#pRulePreview")?.setAttribute("hidden", "");

    const parsed = parseConditionRules(cond.value);
    let rules = parsed.rules.length ? parsed.rules : [{ field: "", operator: "==", value: "" }];
    let join = parsed.join;
    const builder = document.createElement("div");
    builder.className = "simple-transition-rule-builder";
    builder.style.cssText = "display:grid;gap:8px;margin-top:10px";
    const head = document.createElement("div");
    head.style.cssText = "display:flex;gap:8px;align-items:center;justify-content:space-between";
    const title = document.createElement("div");
    title.className = "small";
    title.textContent = "Aktive Regeln";
    const joinSelect = document.createElement("select");
    joinSelect.setAttribute("aria-label", "Regeln verbinden");
    joinSelect.append(focusedOption("and", "UND"), focusedOption("or", "ODER"));
    joinSelect.value = join;
    head.append(title, joinSelect);
    const rows = document.createElement("div");
    rows.style.cssText = "display:grid;gap:6px";
    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:8px;flex-wrap:wrap";
    const add = document.createElement("button");
    add.type = "button";
    add.textContent = "+ Regel";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "Alle löschen";
    const summary = document.createElement("div");
    summary.className = "condition-preview empty";
    const datalistId = "visible-rule-fields-" + Math.random().toString(36).slice(2);
    actions.append(add, clear);
    builder.append(head, optionListForFields(datalistId, panel), rows, actions, summary);
    panel.appendChild(builder);

    function sync() {
      const compiled = compileConditionRules(rules, join);
      cond.value = compiled;
      cond.dispatchEvent(new Event("input", { bubbles: true }));
      cond.dispatchEvent(new Event("change", { bubbles: true }));
      summary.textContent = compiled || "Keine Regel: Transition lauscht immer im State-Kontext.";
      summary.classList.toggle("empty", !compiled);
    }
    function render() {
      rows.replaceChildren(...rules.map((rule, index) => simpleRuleRow(rule, index, datalistId, next => {
        rules[index] = next;
        sync();
      }, () => {
        rules.splice(index, 1);
        if (!rules.length) rules.push({ field: "", operator: "==", value: "" });
        sync();
        render();
      })));
      sync();
    }
    joinSelect.addEventListener("change", () => { join = joinSelect.value; sync(); });
    add.addEventListener("click", () => { rules.push({ field: "", operator: "==", value: "" }); render(); });
    clear.addEventListener("click", () => { rules = [{ field: "", operator: "==", value: "" }]; join = "and"; joinSelect.value = join; render(); });
    render();
  }

  function hideLegacyInspectorRuleComplexity(root = document) {
    const styleId = "state-blueprint-simple-inspector-style";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        #pTransitionAdvancedTriggerCard,
        .inspector-collapse:has(#pTriggerMatchField),
        .inspector-collapse:has(#pTriggerMatchFieldSelect),
        .inspector-collapse:has(#pTriggerMatchOperator),
        .inspector-collapse:has(#pCond) { display: none !important; }
        .simple-transition-rule-builder input,
        .simple-transition-rule-builder select { min-height: 34px; }
      `;
      document.head.appendChild(style);
    }
    root.querySelectorAll?.("#pTransitionAdvancedTriggerCard, details, .inspector-collapse").forEach(node => {
      const text = String(node.textContent || "").toLowerCase();
      if (node.id === "pTransitionAdvancedTriggerCard" || text.includes("trigger-regel") || text.includes("match-feld") || text.includes("match-operator") || text.includes("technische bedingung")) {
        node.open = false;
        node.hidden = true;
        node.style.display = "none";
      }
    });
    installVisibleTransitionRuleBuilder(root);
  }

  function installRuleBuilders(root = document) {
    root.querySelectorAll?.("input, textarea").forEach(installRuleBuilderForConditionInput);
    hideLegacyInspectorRuleComplexity(root);
  }

  function installFocusedInspectorContract() {
    window.STATE_BLUEPRINT_FOCUSED_INSPECTOR_CONTRACT = Object.freeze({
      presetIds: [...FOCUSED_PRESET_IDS],
      componentTypes: [...FOCUSED_COMPONENT_TYPES]
    });
    window.STATE_BLUEPRINT_INSPECTOR_SEMANTICS = INSPECTOR_SEMANTICS;
    window.STATE_BLUEPRINT_RULE_BUILDER = Object.freeze({
      parseConditionRules,
      compileConditionRules,
      installRuleBuilderForConditionInput,
      installVisibleTransitionRuleBuilder
    });
    try {
      window.componentPresetTypes = () => [...FOCUSED_COMPONENT_TYPES];
    } catch (_) {}
  }

  function pruneInspectorDropdowns(root = document) {
    root.querySelectorAll?.("select").forEach(pruneInspectorSelect);
  }

  function bootFocusedInspectorContract() {
    installFocusedInspectorContract();
    pruneInspectorDropdowns();
    installRuleBuilders();
    const observer = new MutationObserver(records => {
      installFocusedInspectorContract();
      hideLegacyInspectorRuleComplexity();
      for (const record of records) {
        for (const node of record.addedNodes || []) {
          if (node?.nodeType !== 1) continue;
          if (node.matches?.("select")) pruneInspectorSelect(node);
          if (node.matches?.("input, textarea")) installRuleBuilderForConditionInput(node);
          pruneInspectorDropdowns(node);
          installRuleBuilders(node);
          hideLegacyInspectorRuleComplexity(node);
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootFocusedInspectorContract, { once: true });
  } else {
    bootFocusedInspectorContract();
  }
})();
