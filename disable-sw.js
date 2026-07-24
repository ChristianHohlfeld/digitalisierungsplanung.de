(() => {
  const DAISYUI_THEME_CSS = "https://cdn.jsdelivr.net/npm/daisyui@5/themes.css";
  const DAISYUI_CSS = "https://cdn.jsdelivr.net/npm/daisyui@5";
  const TAILWIND_BROWSER = "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4";
  const RENDER_MARKER = "data-zustand-daisyui-render";

  function daisyUiCdnMarkup() {
    return [
      '<link data-zustand-daisyui-cdn="themes" href="' + DAISYUI_THEME_CSS + '" rel="stylesheet" type="text/css">',
      '<link data-zustand-daisyui-cdn="components" href="' + DAISYUI_CSS + '" rel="stylesheet" type="text/css">',
      '<script data-zustand-daisyui-cdn="tailwind" src="' + TAILWIND_BROWSER + '"></script>'
    ].join("\n");
  }

  function shouldInjectDaisyUiCdn(html) {
    return typeof html === "string" && html.includes(RENDER_MARKER);
  }

  function injectDaisyUiCdn(html) {
    if (!shouldInjectDaisyUiCdn(html) || !/<html[\s>]/i.test(html) || !/<\/head>/i.test(html)) return html;
    if (html.includes(DAISYUI_CSS) && html.includes(DAISYUI_THEME_CSS) && html.includes(TAILWIND_BROWSER)) return html;
    const themed = html.replace(/<html\b(?![^>]*\bdata-theme=)([^>]*)>/i, '<html$1 data-theme="light">');
    return themed.replace(/<\/head>/i, daisyUiCdnMarkup() + "\n</head>");
  }

  function installRenderedAppBlobHook() {
    if (typeof window.Blob !== "function" || window.Blob.__zustandDaisyUiHooked) return;
    const NativeBlob = window.Blob;
    function ZustandDaisyUiBlob(parts, options) {
      const opts = options || {};
      const type = String(opts.type || "").split(";")[0].trim().toLowerCase();
      if (type === "text/html" && Array.isArray(parts)) {
        return new NativeBlob(parts.map(part => shouldInjectDaisyUiCdn(part) ? injectDaisyUiCdn(part) : part), opts);
      }
      return new NativeBlob(parts, opts);
    }
    Object.setPrototypeOf(ZustandDaisyUiBlob, NativeBlob);
    ZustandDaisyUiBlob.prototype = NativeBlob.prototype;
    Object.defineProperty(ZustandDaisyUiBlob, "__zustandDaisyUiHooked", { value: true });
    window.Blob = ZustandDaisyUiBlob;
  }

  installRenderedAppBlobHook();
  window.__zustandDaisyUiCdn = Object.freeze({ DAISYUI_THEME_CSS, DAISYUI_CSS, TAILWIND_BROWSER, injectDaisyUiCdn });

  (async () => {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
      await Promise.all(registrations.map(registration => registration.unregister()));
    }
    if ("caches" in window) {
      const names = await caches.keys().catch(() => []);
      await Promise.all(names.map(name => caches.delete(name)));
    }
  })();
})();
