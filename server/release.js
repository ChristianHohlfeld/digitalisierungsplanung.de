"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_RELEASE = Object.freeze({
  id: "dev-local",
  sequence: 0,
  builtAt: "",
  sourceCommit: "",
  deployedCommit: ""
});

function assignmentString(source, name) {
  const match = String(source || "").match(new RegExp(`${name}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")`));
  if (!match) return "";
  try {
    return String(JSON.parse(match[1]) || "").trim();
  } catch (_) {
    return "";
  }
}

function assignmentInteger(source, name) {
  const match = String(source || "").match(new RegExp(`${name}\\s*=\\s*(\\d+)`));
  return match ? Number.parseInt(match[1], 10) : 0;
}

function cleanReleaseId(value) {
  const id = String(value || "").trim();
  return /^[a-zA-Z0-9._-]+$/.test(id) ? id : "";
}

function cleanCommit(value) {
  const commit = String(value || "").trim();
  return /^[a-f0-9]{7,64}$/i.test(commit) ? commit : "";
}

function parseReleaseSource(source) {
  const id = cleanReleaseId(assignmentString(source, "ZUSTAND_SW_VERSION"));
  const explicitSequence = assignmentInteger(source, "ZUSTAND_RELEASE_SEQUENCE");
  const legacySequence = Number.parseInt(id.match(/^(?:release|deploy)-(\d+)/)?.[1] || "0", 10);
  const sequence = explicitSequence || legacySequence;
  return {
    id: id || DEFAULT_RELEASE.id,
    sequence: Number.isSafeInteger(sequence) ? sequence : 0,
    builtAt: assignmentString(source, "ZUSTAND_SW_BUILT_AT"),
    sourceCommit: cleanCommit(assignmentString(source, "ZUSTAND_RELEASE_SOURCE")),
    deployedCommit: ""
  };
}

function loadReleaseInfo(options = {}) {
  const env = options.env || process.env;
  const releasePath = options.path || env.ZUSTAND_RELEASE_FILE || path.resolve(process.cwd(), "sw-version.js");
  let fileRelease = DEFAULT_RELEASE;
  try {
    fileRelease = parseReleaseSource(fs.readFileSync(releasePath, "utf8"));
  } catch (_) {}

  const envSequence = Number.parseInt(String(env.ZUSTAND_RELEASE_SEQUENCE || ""), 10);
  return Object.freeze({
    id: cleanReleaseId(env.ZUSTAND_RELEASE_ID) || fileRelease.id,
    sequence: Number.isSafeInteger(envSequence) && envSequence >= 0 ? envSequence : fileRelease.sequence,
    builtAt: String(env.ZUSTAND_RELEASE_BUILT_AT || fileRelease.builtAt || "").trim(),
    sourceCommit: cleanCommit(env.ZUSTAND_RELEASE_SOURCE) || fileRelease.sourceCommit,
    deployedCommit: cleanCommit(env.ZUSTAND_DEPLOY_COMMIT)
  });
}

module.exports = {
  DEFAULT_RELEASE,
  loadReleaseInfo,
  parseReleaseSource
};
