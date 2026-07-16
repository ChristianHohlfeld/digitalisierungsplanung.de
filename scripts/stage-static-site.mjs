import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { parse, resolve, sep } from "node:path";

const root = resolve(process.cwd());
const outputFlagIndex = process.argv.indexOf("--output");
const outputDirectory = outputFlagIndex >= 0 && process.argv[outputFlagIndex + 1]
  ? resolve(process.cwd(), process.argv[outputFlagIndex + 1])
  : resolve(root, "dist");
if (outputDirectory === root || outputDirectory === parse(outputDirectory).root || root.startsWith(`${outputDirectory}${sep}`)) {
  throw new Error(`Refusing unsafe static-site output directory: ${outputDirectory}`);
}

const files = [
  "CNAME",
  "disable-sw.js",
  "index.html",
  "manifest.webmanifest",
  "release-version.js",
  "state.html",
  "sw.js"
];

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
for (const relativePath of files) {
  await cp(resolve(root, relativePath), resolve(outputDirectory, relativePath));
}
await cp(resolve(root, "assets"), resolve(outputDirectory, "assets"), { recursive: true });
await writeFile(resolve(outputDirectory, ".nojekyll"), "", "utf8");

process.stdout.write(`Staged ${files.length} root files and assets in ${outputDirectory}.\n`);
