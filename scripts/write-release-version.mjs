import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputPath = resolve(process.cwd(), "release-version.js");
const existing = await readFile(outputPath, "utf8").catch(() => "");

function existingSequence(source) {
  const explicit = String(source).match(/ZUSTAND_RELEASE_SEQUENCE\s*=\s*(\d+)/);
  if (explicit) return Number.parseInt(explicit[1], 10);
  const release = String(source).match(/ZUSTAND_RELEASE_ID\s*=\s*["']release-(\d+)["']/);
  return release ? Number.parseInt(release[1], 10) : 0;
}

const previousSequence = existingSequence(existing);
const requestedSequence = Number.parseInt(String(process.env.RELEASE_SEQUENCE || ""), 10);
const shouldIncrement = process.argv.includes("--increment") ||
  /^(1|true|yes)$/i.test(String(process.env.RELEASE_INCREMENT || ""));
const sequence = Number.isSafeInteger(requestedSequence) && requestedSequence > 0
  ? requestedSequence
  : shouldIncrement
    ? previousSequence + 1
    : previousSequence;
const rawVersion = process.env.RELEASE_ID || (sequence > 0 ? `release-${sequence}` : "dev-local");
const version = String(rawVersion).trim().replace(/[^a-zA-Z0-9._-]/g, "-") || "dev-local";
const builtAt = process.env.RELEASE_BUILT_AT || new Date().toISOString();
const sourceCommit = String(process.env.RELEASE_SOURCE_COMMIT || "").trim().replace(/[^a-fA-F0-9]/g, "");

const content = `globalThis.ZUSTAND_RELEASE_SEQUENCE = ${Math.max(0, sequence)};
globalThis.ZUSTAND_RELEASE_ID = ${JSON.stringify(version)};
globalThis.ZUSTAND_RELEASE_BUILT_AT = ${JSON.stringify(builtAt)};
globalThis.ZUSTAND_RELEASE_SOURCE = ${JSON.stringify(sourceCommit)};
`;

await writeFile(outputPath, content, "utf8");
