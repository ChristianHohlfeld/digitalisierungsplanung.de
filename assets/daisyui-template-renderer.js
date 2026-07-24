(function (global) {
  "use strict";

  const DAISY_VERSION = "5.7.0";
  const DAISY_CSS_URL = "https://cdn.jsdelivr.net/npm/daisyui@5.7.0/daisyui.css";
  const DAISY_THEMES_CSS_URL = "https://cdn.jsdelivr.net/npm/daisyui@5.7.0/themes.css";

  function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function pathValue(source, path) {
    const parts = String(path || "").split(".").map(part => part.trim()).filter(Boolean);
    let cursor = source;
    for (const part of parts) {
      if (cursor === null || cursor === undefined || typeof cursor !== "object" || !(part in cursor)) return undefined;
      cursor = cursor[part];
    }
    return cursor;
  }

  function bindingValue(data, expression) {
    const [rawPath, ...fallbackParts] = String(expression || "").split("|");
    const key = rawPath.trim();
    const fallback = fallbackParts.join("|").trim();
    const value = key ? pathValue(data, key) : undefined;
    if (value === undefined || value === null || value === "") return fallback;
    if (Array.isArray(value)) return value.map(item => isObject(item) ? JSON.stringify(item) : String(item)).join(", ");
    if (isObject(value)) return JSON.stringify(value);
    return String(value);
  }

  function renderTemplateHtml(templateOrHtml, data = {}) {
    const html = typeof templateOrHtml === "string" ? templateOrHtml : String(templateOrHtml?.html || "");
    return html.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expression) => escapeHtml(bindingValue(data, expression)));
  }

  function presetTemplate(preset) {
    if (isObject(preset?.template) && typeof preset.template.html === "string") return preset.template;
    if (isObject(preset?.components?.[0]?.template) && typeof preset.components[0].template.html === "string") return preset.components[0].template;
    return { html: "" };
  }

  function presetData(preset, explicitData) {
    if (isObject(explicitData)) return explicitData;
    if (isObject(preset?.data)) return preset.data;
    return {};
  }

  function renderPresetHtml(preset, explicitData) {
    return renderTemplateHtml(presetTemplate(preset), presetData(preset, explicitData));
  }

  function shellHtml(bodyHtml, opts = {}) {
    const title = escapeHtml(opts.title || "DaisyUI Preview");
    const theme = escapeHtml(opts.theme || "light");
    return `<!doctype html>
<html lang="de" data-theme="${theme}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="${DAISY_THEMES_CSS_URL}">
  <link rel="stylesheet" href="${DAISY_CSS_URL}">
  <style>
    html, body { min-height: 100%; margin: 0; background: var(--color-base-200, #f5f5f5); color: var(--color-base-content, #1f2937); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { padding: 24px; }
    .daisy-preview-root { display: grid; justify-items: center; align-items: start; gap: 20px; width: min(100%, 1100px); margin: 0 auto; }
    .daisy-preview-root > * { max-width: 100%; }
  </style>
</head>
<body>
  <main class="daisy-preview-root">${bodyHtml}</main>
</body>
</html>`;
  }

  function renderInto(target, preset, opts = {}) {
    const html = renderPresetHtml(preset, opts.data);
    if (!target) return html;
    if (target.tagName === "IFRAME") {
      target.srcdoc = shellHtml(html, { title: preset?.title || opts.title || "DaisyUI Preview", theme: opts.theme || "light" });
      return html;
    }
    target.innerHTML = html;
    return html;
  }

  function exportHtml(presets, opts = {}) {
    const list = Array.isArray(presets) ? presets : [presets].filter(Boolean);
    const body = list.map(preset => renderPresetHtml(preset, preset?.data)).join("\n");
    return shellHtml(body, { title: opts.title || "DaisyUI Export", theme: opts.theme || "light" });
  }

  global.DaisyPresetRenderer = {
    version: DAISY_VERSION,
    cssUrl: DAISY_CSS_URL,
    themesCssUrl: DAISY_THEMES_CSS_URL,
    escapeHtml,
    renderTemplateHtml,
    renderPresetHtml,
    renderInto,
    exportHtml,
    shellHtml
  };
})(typeof window !== "undefined" ? window : globalThis);
