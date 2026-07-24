(() => {
  const DAISYUI_THEME_CSS = "https://cdn.jsdelivr.net/npm/daisyui@5/themes.css";
  const DAISYUI_CSS = "https://cdn.jsdelivr.net/npm/daisyui@5";
  const TAILWIND_BROWSER = "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4";

  function daisyUiCdnMarkup() {
    return [
      '<link data-zustand-daisyui-cdn="themes" href="' + DAISYUI_THEME_CSS + '" rel="stylesheet" type="text/css">',
      '<link data-zustand-daisyui-cdn="components" href="' + DAISYUI_CSS + '" rel="stylesheet" type="text/css">',
      '<script data-zustand-daisyui-cdn="tailwind" src="' + TAILWIND_BROWSER + '"></script>'
    ].join("\n");
  }

  function injectDaisyUiCdn(html) {
    if (typeof html !== "string" || !/<html[\s>]/i.test(html) || !/<\/head>/i.test(html)) return html;
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
        return new NativeBlob(parts.map(part => typeof part === "string" ? injectDaisyUiCdn(part) : part), opts);
      }
      return new NativeBlob(parts, opts);
    }
    Object.setPrototypeOf(ZustandDaisyUiBlob, NativeBlob);
    ZustandDaisyUiBlob.prototype = NativeBlob.prototype;
    Object.defineProperty(ZustandDaisyUiBlob, "__zustandDaisyUiHooked", { value: true });
    window.Blob = ZustandDaisyUiBlob;
  }

  function appendStylesheet(doc, key, href) {
    if (doc.querySelector('[data-zustand-daisyui-cdn="' + key + '"]')) return;
    const link = doc.createElement("link");
    link.dataset.zustandDaisyuiCdn = key;
    link.setAttribute("data-zustand-daisyui-cdn", key);
    link.href = href;
    link.rel = "stylesheet";
    link.type = "text/css";
    doc.head.appendChild(link);
  }

  function appendScript(doc, key, src) {
    if (doc.querySelector('[data-zustand-daisyui-cdn="' + key + '"]')) return;
    const script = doc.createElement("script");
    script.dataset.zustandDaisyuiCdn = key;
    script.setAttribute("data-zustand-daisyui-cdn", key);
    script.src = src;
    doc.head.appendChild(script);
  }

  function ensureDaisyUiInDocument(doc) {
    if (!doc || !doc.head) return;
    if (!doc.documentElement.getAttribute("data-theme")) doc.documentElement.setAttribute("data-theme", "light");
    appendStylesheet(doc, "themes", DAISYUI_THEME_CSS);
    appendStylesheet(doc, "components", DAISYUI_CSS);
    appendScript(doc, "tailwind", TAILWIND_BROWSER);
  }

  function installRenderedAppFrameHook() {
    const wire = frame => {
      if (!frame || frame.__zustandDaisyUiFrameHooked) return;
      frame.__zustandDaisyUiFrameHooked = true;
      frame.addEventListener("load", () => {
        try { ensureDaisyUiInDocument(frame.contentDocument); } catch (_) {}
      });
      try { ensureDaisyUiInDocument(frame.contentDocument); } catch (_) {}
    };
    const scan = () => document.querySelectorAll("iframe#appFrame").forEach(wire);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan, { once: true });
    else scan();
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  }

  installRenderedAppBlobHook();
  installRenderedAppFrameHook();
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
