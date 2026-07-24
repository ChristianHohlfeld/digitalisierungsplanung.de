from pathlib import Path
import json

root = Path('.')

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, got {count}')
    return text.replace(old, new, 1)

# server CSP
p = root / 'server/server.js'
s = p.read_text()
old = '"content-security-policy": "default-src \'none\'; connect-src \'self\' https://cdn.jsdelivr.net; script-src \'unsafe-inline\'; style-src \'unsafe-inline\' https://cdn.jsdelivr.net; base-uri \'none\'; form-action \'none\'; frame-ancestors \'none\'",'
new = '"content-security-policy": "default-src \'none\'; connect-src \'self\' https://cdn.jsdelivr.net; script-src \'unsafe-inline\'; style-src \'unsafe-inline\' https://cdn.jsdelivr.net; img-src \'self\' https: data: blob:; frame-src \'self\' blob: data:; base-uri \'none\'; form-action \'none\'; frame-ancestors \'none\'",'
s = replace_once(s, old, new, 'server CSP')
p.write_text(s)

# persist _snippet and accept embedded image values
p = root / 'server/preset-library.js'
s = p.read_text()
old = '''function serializePresetLibrary(value) {
  const clean = validatePresetLibrary(value);
  clean.presets = clean.presets.map(preset => {
    if (preset.data && Object.hasOwn(preset.data, "_snippet")) {
      const { _snippet, ...rest } = preset.data;
      return { ...preset, data: rest };
    }
    return preset;
  });
  return JSON.stringify(clean, null, 2) + "\\n";
}'''
new = '''function serializePresetLibrary(value) {
  return JSON.stringify(validatePresetLibrary(value), null, 2) + "\\n";
}'''
s = replace_once(s, old, new, 'persist snippet')
old = '''function safeImageUrl(value) {
  const url = cleanText(value, "", 1000);
  return /^https:\\/\\/[^\\s<>"']+$/i.test(url) ? url : "";
}'''
new = '''function safeImageUrl(value) {
  const url = cleanText(value, "", 16 * 1024 * 1024);
  return /^(?:https:\\/\\/[^\\s<>"']+|data:image\\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+)$/i.test(url) ? url : "";
}'''
s = replace_once(s, old, new, 'allow data image')
p.write_text(s)

# state.html outer editor/export code and embedded shared runtime
p = root / 'state.html'
s = p.read_text()
start = s.index('    const APP_HTML = ') + len('    const APP_HTML = ')
end = s.index(';\n    const GENERATED_APP_HTML', start)
app_html = json.loads(s[start:end])

css_old = '''    .daisy-widget {
      display: grid;
      gap: 12px;
      min-width: 0;
      max-width: 100%;
    }

    .daisy-widget.navbar { display: flex; }'''
css_new = '''    .daisy-widget {
      display: grid;
      gap: 12px;
      min-width: 0;
      max-width: 100%;
    }

    .daisy-snippet {
      display: flex;
      align-items: flex-start;
      justify-content: center;
      flex-wrap: wrap;
      gap: 18px;
      width: 100%;
    }
    .daisy-snippet .w-60 { width: 15rem; }
    .daisy-snippet .w-64 { width: 16rem; }
    .daisy-snippet .w-96 { width: 24rem; }
    .daisy-snippet .w-full { width: 100%; }
    .daisy-snippet .rounded-2xl { border-radius: 1rem; overflow: hidden; }
    .daisy-snippet .hover-3d {
      position: relative;
      display: inline-grid;
      max-width: 100%;
      perspective: 900px;
      transform-style: preserve-3d;
    }
    .daisy-snippet .hover-3d > figure,
    .daisy-snippet .hover-3d > div { grid-area: 1 / 1; }
    .daisy-snippet .hover-3d > figure {
      margin: 0;
      transform: rotateX(0) rotateY(0) translateZ(0);
      transform-style: preserve-3d;
      transition: transform .2s ease, filter .2s ease;
      will-change: transform;
    }
    .daisy-snippet .hover-3d > div { min-height: 1px; pointer-events: none; }
    .daisy-snippet .hover-3d:hover > figure {
      transform: rotateX(7deg) rotateY(-9deg) translateY(-3px) translateZ(10px);
      filter: drop-shadow(0 22px 28px rgba(2,6,23,.34));
    }
    .daisy-snippet img { display: block; max-width: 100%; height: auto; }

    .daisy-widget.navbar { display: flex; }'''
app_html = replace_once(app_html, css_old, css_new, 'runtime snippet css')

fn_old = '''    function createDaisyComponentElement(component, ownerState = null, renderOptions = {}) {
      if (ownerState?.id) component = { ...component, __ownerStateId: ownerState.id };
      const variant = runtimeDaisyVariantName(component);
      if (!runtimeSupportedDaisyComponent(component)) return null;
      const lines = daisyLines(component);'''
fn_new = '''    function daisySnippetSlug(value) {
      return String(value || "text").toLowerCase().normalize("NFKD")
        .replace(/[\\u0300-\\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 36) || "text";
    }

    function daisySnippetDirectText(node) {
      return [...node.childNodes]
        .filter(child => child.nodeType === Node.TEXT_NODE)
        .map(child => child.textContent)
        .join(" ")
        .replace(/\\s+/g, " ")
        .trim();
    }

    function createDaisySnippetElement(component) {
      const data = daisyScopeData(component);
      const snippet = String(data._snippet || "").trim();
      if (!snippet) return null;
      const template = document.createElement("template");
      template.innerHTML = snippet;
      template.content.querySelectorAll("script,iframe,object,embed,link,meta,base,form").forEach(node => node.remove());
      template.content.querySelectorAll("*").forEach(node => {
        for (const attribute of [...node.attributes]) {
          const name = attribute.name.toLowerCase();
          const value = String(attribute.value || "").trim();
          if (name.startsWith("on") || name === "srcdoc") node.removeAttribute(attribute.name);
          else if (["href", "src", "poster", "xlink:href"].includes(name) && /^javascript:/i.test(value)) node.removeAttribute(attribute.name);
        }
      });
      const bindings = Array.isArray(data._textBindings) ? data._textBindings : [];
      const values = new Map(bindings
        .filter(binding => binding && binding.key && binding.field)
        .map(binding => [String(binding.key), String(data[binding.field] ?? binding.text ?? "")]));
      const counters = Object.create(null);
      template.content.querySelectorAll("p,h1,h2,h3,h4,h5,h6,span,button,a,label,li,figcaption,legend,th,td").forEach(node => {
        const text = (daisySnippetDirectText(node) || node.innerText || node.textContent || "").replace(/\\s+/g, " ").trim();
        if (!text || text.length > 160) return;
        const base = node.tagName.toLowerCase() + "_" + daisySnippetSlug(text);
        const index = counters[base] = (counters[base] || 0) + 1;
        const key = base + "_" + index;
        if (values.has(key)) node.textContent = values.get(key);
      });
      template.content.querySelectorAll("a[href]").forEach(link => {
        const raw = String(link.getAttribute("href") || "").trim();
        if (!raw || raw === "#") {
          link.addEventListener("click", event => event.preventDefault());
          return;
        }
        const href = safeComponentLinkUrl(raw);
        if (!href) {
          link.removeAttribute("href");
          return;
        }
        link.href = href;
        if (safeExternalComponentUrl(href)) {
          link.target = "_blank";
          link.rel = "noopener noreferrer";
        }
      });
      const wrapper = document.createElement("div");
      wrapper.className = "daisy-widget daisy-snippet";
      wrapper.dataset.zustandDaisyuiRender = "";
      wrapper.appendChild(template.content.cloneNode(true));
      return wrapper;
    }

    function createDaisyComponentElement(component, ownerState = null, renderOptions = {}) {
      if (ownerState?.id) component = { ...component, __ownerStateId: ownerState.id };
      const variant = runtimeDaisyVariantName(component);
      if (!runtimeSupportedDaisyComponent(component)) return null;
      const snippetElement = createDaisySnippetElement(component);
      if (snippetElement) return snippetElement;
      const lines = daisyLines(component);'''
app_html = replace_once(app_html, fn_old, fn_new, 'runtime snippet renderer')

# Re-encode only the APP_HTML string.
s = s[:start] + json.dumps(app_html, ensure_ascii=False) + s[end:]

export_old = '''    async function inlineExportImageValue(value, path = "") {
      if (typeof value === "string") return inlineExportImageUrl(value, path);
      if (Array.isArray(value)) {'''
export_new = '''    async function inlineExportSnippetImages(value, path = "") {
      const template = document.createElement("template");
      template.innerHTML = String(value || "");
      const imageNodes = [...template.content.querySelectorAll("img[src],img[srcset],source[srcset]")];
      for (const node of imageNodes) {
        if (node.hasAttribute("src")) {
          const src = node.getAttribute("src");
          node.setAttribute("src", await inlineExportImageUrl(src, path + ".src", true));
        }
        if (node.hasAttribute("srcset")) {
          const candidates = String(node.getAttribute("srcset") || "").split(",").map(item => item.trim()).filter(Boolean);
          const inlined = [];
          for (const candidate of candidates) {
            const match = candidate.match(/^(\\S+)(?:\\s+(.+))?$/);
            if (!match) continue;
            const url = await inlineExportImageUrl(match[1], path + ".srcset", true);
            inlined.push(match[2] ? url + " " + match[2] : url);
          }
          node.setAttribute("srcset", inlined.join(", "));
        }
      }
      return template.innerHTML;
    }

    async function inlineExportImageValue(value, path = "") {
      if (typeof value === "string" && /(?:^|\\.)_snippet$/.test(path)) return inlineExportSnippetImages(value, path);
      if (typeof value === "string") return inlineExportImageUrl(value, path);
      if (Array.isArray(value)) {'''
s = replace_once(s, export_old, export_new, 'export snippet image inlining')
p.write_text(s)

# Regression tests
p = root / 'server/server.test.js'
s = p.read_text()
append = r'''

test("preset admin CSP allows blob previews and canonical snippets persist", () => {
  const source = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  assert.match(source, /frame-src 'self' blob: data:/);
  assert.match(source, /img-src 'self' https: data: blob:/);

  const snippet = '<div class="hover-3d"><figure class="w-60 rounded-2xl"><img src="https://img.daisyui.com/images/stock/card-1.webp?x" alt="Tailwind CSS 3D card"></figure><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div></div>';
  const parsed = presetLibrary.parseDaisySnippet({
    snippet,
    id: "custom_hover_3d",
    title: "Hover 3D",
    categoryId: "websuite-builder",
    packageIds: ["website.builder"]
  });
  const base = presetLibrary.loadPresetLibraryFile();
  const serialized = presetLibrary.serializePresetLibrary({ ...base, presets: [...base.presets, parsed] });
  const saved = JSON.parse(serialized).presets.find(item => item.id === "custom_hover_3d");
  assert.equal(saved.data._snippet, snippet);
});

test("shared runtime renders canonical snippets and self-contained export inlines their images", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "state.html"), "utf8");
  assert.match(html, /function createDaisySnippetElement\(component\)/);
  assert.match(html, /const snippetElement = createDaisySnippetElement\(component\)/);
  assert.match(html, /function inlineExportSnippetImages\(value, path = ""\)/);
  assert.match(html, /_snippet\$\/\.test\(path\)/);
  assert.match(html, /\.daisy-snippet \.hover-3d:hover > figure/);
});
'''
if 'preset admin CSP allows blob previews' not in s:
    s += append
p.write_text(s)

print('patched')
