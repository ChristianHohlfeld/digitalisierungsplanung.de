import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const rawVersion = process.env.SW_VERSION || "dev-local";
const version = String(rawVersion).trim().replace(/[^a-zA-Z0-9._-]/g, "-") || "dev-local";
const builtAt = process.env.SW_BUILT_AT || new Date().toISOString();

const content = `self.ZUSTAND_SW_VERSION = ${JSON.stringify(version)};
self.ZUSTAND_SW_BUILT_AT = ${JSON.stringify(builtAt)};
`;

await writeFile(resolve(process.cwd(), "sw-version.js"), content, "utf8");
