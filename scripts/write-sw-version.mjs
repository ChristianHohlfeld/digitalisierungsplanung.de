import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputPath = resolve(process.cwd(), "sw-version.js");
const existing = await readFile(outputPath, "utf8").catch(() => "");

function existingSequence(source) {
  const explicit = String(source).match(/ZUSTAND_RELEASE_SEQUENCE\s*=\s*(\d+)/);
  if (explicit) return Number.parseInt(explicit[1], 10);
  const legacy = String(source).match(/ZUSTAND_SW_VERSION\s*=\s*["']deploy-(\d+)(?:-|["'])/);
  return legacy ? Number.parseInt(legacy[1], 10) : 0;
}

const previousSequence = existingSequence(existing);
const requestedSequence = Number.parseInt(String(process.env.SW_SEQUENCE || ""), 10);
const shouldIncrement = process.argv.includes("--increment") ||
  /^(1|true|yes)$/i.test(String(process.env.SW_INCREMENT || ""));
const sequence = Number.isSafeInteger(requestedSequence) && requestedSequence > 0
  ? requestedSequence
  : shouldIncrement
    ? previousSequence + 1
    : previousSequence;
const rawVersion = process.env.SW_VERSION || (sequence > 0 ? `release-${sequence}` : "dev-local");
const version = String(rawVersion).trim().replace(/[^a-zA-Z0-9._-]/g, "-") || "dev-local";
const builtAt = process.env.SW_BUILT_AT || new Date().toISOString();
const sourceCommit = String(process.env.SW_SOURCE_COMMIT || "").trim().replace(/[^a-fA-F0-9]/g, "");

const content = `self.ZUSTAND_RELEASE_SEQUENCE = ${Math.max(0, sequence)};
self.ZUSTAND_SW_VERSION = ${JSON.stringify(version)};
self.ZUSTAND_SW_BUILT_AT = ${JSON.stringify(builtAt)};
self.ZUSTAND_RELEASE_SOURCE = ${JSON.stringify(sourceCommit)};
`;

await writeFile(outputPath, content, "utf8");
