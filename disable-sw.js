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
  const INSPECTOR_SEMANTICS = Object.freeze({
    state: {
      title: "State-Trigger",
      help: "Der State bestimmt den Trigger-Kontext: Klick, Timer, Webhook/Event oder Auto.",
      owns: ["triggerType", "timerMs", "eventName", "componentId"]
    },
    transition: {
      title: "Transition lauscht auf Signal",
      help: "Die Transition wählt, worauf sie im State-Kontext lauscht: konkretes Event, Eventfeld, Button/Action oder Timer-Signal.",
      owns: ["listener", "eventField", "match", "actionId", "targetStateId"]
    }
  });

  function focusedOption(value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }

  function replaceOptions(select, allowedValues, labels) {
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
    if (/^[a-zA-Z0-9_@.:-]+$/.test(raw)) return raw;
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

  function fieldSuggestions() {
    const supplied = Array.isArray(window.STATE_BLUEPRINT_RULE_BUILDER_FIELDS) ? window.STATE_BLUEPRINT_RULE_BUILDER_FIELDS : [];
    return supplied.map(item => typeof item === "string" ? { path: item, label: item } : item)
      .filter(item => item && item.path)
      .slice(0, 120);
  }

  function optionListForFields(id) {
    const datalist = document.createElement("datalist");
    datalist.id = id;
    for (const field of fieldSuggestions()) {
      const option = document.createElement("option");
      option.value = String(field.path || "");
      option.label = String(field.label || field.path || "");
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
    root.append(head, optionListForFields(datalistId), rows, add);

    function syncInput() {
      input.value = compileConditionRules(rules, join);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function renderRows() {
      rows.replaceChildren(...rules.map((rule, index) => {
        const row = document.createElement("div");
        row.style.cssText = "display:grid;grid-template-columns:minmax(120px,1fr) 88px minmax(90px,1fr) auto;gap:6px;align-items:center";
        const field = document.createElement("input");
        field.placeholder = "Feld, z.B. states.checkbox_a.checked";
        field.setAttribute("list", datalistId);
        field.value = rule.field || "";
        const op = document.createElement("select");
        for (const value of RULE_OPERATORS) op.appendChild(focusedOption(value, value === "truthy" ? "ist wahr" : value === "falsy" ? "ist falsch" : value));
        op.value = rule.operator || "==";
        const value = document.createElement("input");
        value.placeholder = "Wert";
        value.value = rule.value ?? "";
        value.disabled = op.value === "truthy" || op.value === "falsy";
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "×";
        remove.title = "Regel löschen";
        remove.style.cssText = "min-width:34px;min-height:30px;border:1px solid rgba(251,113,133,.42);border-radius:8px;color:#fecdd3";
        field.addEventListener("input", () => { rules[index].field = field.value; syncInput(); });
        op.addEventListener("change", () => { rules[index].operator = op.value; value.disabled = op.value === "truthy" || op.value === "falsy"; syncInput(); renderRows(); });
        value.addEventListener("input", () => { rules[index].value = value.value; syncInput(); });
        remove.addEventListener("click", () => { rules.splice(index, 1); if (!rules.length) rules.push({ field: "", operator: "==", value: "" }); syncInput(); renderRows(); });
        row.append(field, op, value, remove);
        return row;
      }));
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

  function installRuleBuilders(root = document) {
    root.querySelectorAll?.("input, textarea").forEach(installRuleBuilderForConditionInput);
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
      installRuleBuilderForConditionInput
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
      for (const record of records) {
        for (const node of record.addedNodes || []) {
          if (node?.nodeType !== 1) continue;
          if (node.matches?.("select")) pruneInspectorSelect(node);
          if (node.matches?.("input, textarea")) installRuleBuilderForConditionInput(node);
          pruneInspectorDropdowns(node);
          installRuleBuilders(node);
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
