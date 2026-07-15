import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const sourcePath = resolve(root, "shared/workspace-core.js");
const statePath = resolve(root, "state.html");
const startMarker = "<!-- @generated-workspace-core:start -->";
const endMarker = "<!-- @generated-workspace-core:end -->";
const checkOnly = process.argv.includes("--check");

const [coreSource, stateSource] = await Promise.all([
  readFile(sourcePath, "utf8"),
  readFile(statePath, "utf8")
]);
const start = stateSource.indexOf(startMarker);
const end = stateSource.indexOf(endMarker);
if (start < 0 || end < start) throw new Error("state.html is missing workspace-core generation markers.");
if (coreSource.includes("</script>")) throw new Error("workspace-core source may not contain a script end tag.");

const block = `${startMarker}\n  <script>\n${coreSource.trimEnd()}\n  </script>\n  ${endMarker}`;
const next = stateSource.slice(0, start) + block + stateSource.slice(end + endMarker.length);

if (checkOnly) {
  if (next !== stateSource) throw new Error("Embedded workspace core is stale. Run npm run build:workspace-core.");
} else if (next !== stateSource) {
  await writeFile(statePath, next, "utf8");
}
