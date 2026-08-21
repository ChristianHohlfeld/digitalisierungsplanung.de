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
  const FOCUSED_COMPONENT_TYPE_SET = new Set(FOCUSED_COMPONENT_TYPES);
  const FOCUSED_OPTION_LABELS = new Map([
    ["heading", "Header"],
    ["image", "Image"]
  ]);

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

  function installFocusedInspectorContract() {
    window.STATE_BLUEPRINT_FOCUSED_INSPECTOR_CONTRACT = Object.freeze({
      presetIds: [...FOCUSED_PRESET_IDS],
      componentTypes: [...FOCUSED_COMPONENT_TYPES]
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
    const observer = new MutationObserver(records => {
      installFocusedInspectorContract();
      for (const record of records) {
        for (const node of record.addedNodes || []) {
          if (node?.nodeType !== 1) continue;
          if (node.matches?.("select")) pruneInspectorSelect(node);
          pruneInspectorDropdowns(node);
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
