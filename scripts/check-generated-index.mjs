import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(process.cwd());
const temporaryDirectory = await mkdtemp(join(tmpdir(), "digitalisierungsplanung-index-"));
const generatedPath = join(temporaryDirectory, "index.html");

try {
  const result = spawnSync(
    process.execPath,
    [resolve(root, "scripts/build-index.mjs"), "--output", generatedPath],
    { cwd: root, encoding: "utf8", stdio: "pipe" }
  );
  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error("Could not regenerate index.html for verification.");
  }

  const [committed, generated] = await Promise.all([
    readFile(resolve(root, "index.html"), "utf8"),
    readFile(generatedPath, "utf8")
  ]);
  if (committed !== generated) {
    let firstDifference = 0;
    const limit = Math.min(committed.length, generated.length);
    while (firstDifference < limit && committed[firstDifference] === generated[firstDifference]) firstDifference += 1;
    throw new Error(
      `index.html is stale or was edited by hand (first difference at byte ${firstDifference}). ` +
      "Run `npm run build:index` and commit the generated result."
    );
  }
  process.stdout.write("index.html matches the deterministic state.html export.\n");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
