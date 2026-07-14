import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize, resolve } from "node:path";

const port = Number(process.env.PORT || 8124);
const root = resolve(process.cwd());
const require = createRequire(import.meta.url);
const eventCatalog = require("../server/event-catalog.js");
const presetLibrary = require("../server/preset-library.js");
const productContract = require("../server/product-contract.js");
let adminPresetLibrary = presetLibrary.loadPresetLibraryFile();

const types = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8"
};

function writeJson(res, status, value) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  if (url.pathname.startsWith("/presets-admin/") && req.headers.authorization !== "Bearer admin-secret") {
    writeJson(res, 401, { error: "unauthorized" });
    return;
  }
  if (url.pathname === "/presets-admin/catalog") {
    if (req.method === "GET") {
      writeJson(res, 200, { library: adminPresetLibrary });
      return;
    }
    if (req.method === "POST") {
      try {
        const payload = await readJson(req);
        const library = presetLibrary.validatePresetLibrary(payload.library);
        if (payload.validateOnly === true || url.searchParams.get("validate") === "1") {
          writeJson(res, 200, { ok: true, library });
          return;
        }
        adminPresetLibrary = library;
        writeJson(res, 200, { ok: true, changed: true, commit: "browser-test" });
      } catch (error) {
        writeJson(res, error.status || 400, { error: error.code || "invalid_json" });
      }
      return;
    }
  }
  if (url.pathname === "/presets-admin/parse" && req.method === "POST") {
    try {
      const payload = await readJson(req);
      writeJson(res, 200, { ok: true, preset: presetLibrary.parseDaisySnippet(payload), daisyVersion: presetLibrary.DAISY_VERSION });
    } catch (error) {
      writeJson(res, error.status || 400, { error: error.code || "snippet_parse_failed" });
    }
    return;
  }
  if (url.pathname === "/presets-admin/import" && req.method === "POST") {
    try {
      const payload = await readJson(req);
      if (payload.url !== "https://preset.example.test/card") throw Object.assign(new Error("preset_api_upstream_failed"), { code: "preset_api_upstream_failed", status: 502 });
      const preset = presetLibrary.validatePresetDefinition({
        id: "custom_api_card",
        variant: "card",
        title: "API Card",
        description: "Aus einer API importiert.",
        categoryId: "websuite-builder",
        packageIds: ["website.builder"],
        data: { title: "API Card", body: "Kanonische Antwort", image: "", imageAlt: "", actionLabel: "Weiter" }
      }, payload.library);
      writeJson(res, 200, { ok: true, preset });
    } catch (error) {
      writeJson(res, error.status || 400, { error: error.code || "preset_api_import_failed" });
    }
    return;
  }
  if (url.pathname === "/contract") {
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
    res.end(JSON.stringify(productContract.productContractResponse(eventCatalog.DEFAULT_EVENT_CATALOG)));
    return;
  }
  const pathname = url.pathname === "/"
    ? "/index.html"
    : url.pathname === "/presets-admin.html"
      ? "/server/presets-admin.html"
      : decodeURIComponent(url.pathname);
  const file = normalize(join(root, pathname));

  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  res.writeHead(200, {
    "content-type": types[extname(file)] || "application/octet-stream",
    "cache-control": "no-store"
  });
  createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => {
  console.log(`state test server http://127.0.0.1:${port}`);
});
