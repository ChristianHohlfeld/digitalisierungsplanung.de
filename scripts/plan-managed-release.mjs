import { appendFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const repo = resolve(process.env.RELEASE_REPO || process.cwd());

function git(args) {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function fail(message) {
  throw new Error(String(message || "managed release planning failed"));
}

function positiveInteger(value, label) {
  const text = String(value || "").trim();
  if (!/^[1-9][0-9]*$/.test(text)) fail(`${label} must be a positive integer`);
  const number = Number(text);
  if (!Number.isSafeInteger(number)) fail(`${label} exceeds the safe integer range`);
  return number;
}

function releaseStamp(source) {
  const text = String(source || "");
  const sequence = Number(text.match(/^globalThis\.ZUSTAND_RELEASE_SEQUENCE = ([0-9]+);$/m)?.[1] || NaN);
  const id = text.match(/^globalThis\.ZUSTAND_RELEASE_ID = "([a-zA-Z0-9._-]+)";$/m)?.[1] || "";
  const builtAt = text.match(/^globalThis\.ZUSTAND_RELEASE_BUILT_AT = "([^"]+)";$/m)?.[1] || "";
  const sourceCommit = text.match(/^globalThis\.ZUSTAND_RELEASE_SOURCE = "([a-fA-F0-9]+)";$/m)?.[1] || "";
  return { sequence, id, builtAt, sourceCommit };
}

function readWorkingStamp() {
  return releaseStamp(git(["show", "HEAD:release-version.js"]));
}

function refExists(ref) {
  try {
    git(["rev-parse", "--verify", "--quiet", ref]);
    return true;
  } catch (_) {
    return false;
  }
}

function annotatedTagCommit(releaseId) {
  const ref = `refs/tags/${releaseId}`;
  if (!refExists(ref)) return "";
  if (git(["cat-file", "-t", ref]) !== "tag") fail(`${releaseId} exists but is not an annotated tag`);
  return git(["rev-parse", `${ref}^{commit}`]);
}

function validateReleaseCommit(commit, sourceCommit, expectedSequence, expectedId) {
  if (!/^[a-f0-9]{40}$/i.test(commit) || !/^[a-f0-9]{40}$/i.test(sourceCommit)) fail("release validation requires full commit IDs");
  const parents = git(["show", "-s", "--format=%P", commit]).split(/\s+/).filter(Boolean);
  if (parents.length !== 1 || parents[0] !== sourceCommit) fail(`${expectedId} must be a single stamp-only child of ${sourceCommit}`);
  const stamp = releaseStamp(git(["show", `${commit}:release-version.js`]));
  if (stamp.sequence !== expectedSequence || stamp.id !== expectedId || stamp.sourceCommit !== sourceCommit) {
    fail(`${expectedId} has an incompatible release stamp`);
  }
  if (!Number.isFinite(Date.parse(stamp.builtAt))) fail(`${expectedId} has an invalid build timestamp`);
  const changed = git(["diff", "--name-only", sourceCommit, commit]).split("\n").filter(Boolean);
  if (changed.length !== 1 || changed[0] !== "release-version.js") fail(`${expectedId} changes files other than release-version.js`);
  return stamp;
}

function planRelease() {
  const requestedSequence = positiveInteger(process.env.REQUESTED_SEQUENCE, "release_sequence");
  const verifiedSourceCommit = String(process.env.VERIFIED_SOURCE_COMMIT || "").trim();
  if (!/^[a-f0-9]{40}$/i.test(verifiedSourceCommit)) fail("VERIFIED_SOURCE_COMMIT must be a full commit ID");
  const remoteHead = git(["rev-parse", "origin/main"]);
  const checkedOutHead = git(["rev-parse", "HEAD"]);
  if (remoteHead !== checkedOutHead || remoteHead !== verifiedSourceCommit) {
    fail(`main moved after verification: verified=${verifiedSourceCommit} checked-out=${checkedOutHead} remote=${remoteHead}`);
  }

  const releaseId = `release-${requestedSequence}`;
  const current = readWorkingStamp();
  if (!Number.isSafeInteger(current.sequence) || current.sequence < 0) fail("release-version.js has no valid current sequence");
  if (current.sequence > 0 && current.id !== `release-${current.sequence}`) fail("release-version.js has mismatched release identity");
  const taggedCommit = annotatedTagCommit(releaseId);
  const base = {
    releaseSequence: requestedSequence,
    releaseId,
    expectedRemoteMain: remoteHead
  };

  if (current.sequence === requestedSequence - 1) {
    if (!taggedCommit) {
      return { ...base, mode: "create", releaseSourceCommit: remoteHead, releaseCommit: "" };
    }
    validateReleaseCommit(taggedCommit, remoteHead, requestedSequence, releaseId);
    return { ...base, mode: "resume-tagged", releaseSourceCommit: remoteHead, releaseCommit: taggedCommit };
  }

  if (current.sequence === requestedSequence && current.id === releaseId) {
    const releaseSourceCommit = current.sourceCommit;
    validateReleaseCommit(remoteHead, releaseSourceCommit, requestedSequence, releaseId);
    if (taggedCommit && taggedCommit !== remoteHead) fail(`${releaseId} tag points at a different commit`);
    return {
      ...base,
      mode: taggedCommit ? "resume-complete" : "resume-main",
      releaseSourceCommit,
      releaseCommit: remoteHead
    };
  }

  fail(`release_sequence must be exactly ${current.sequence + 1}, or ${current.sequence} when resuming that stamped release; got ${requestedSequence}`);
}

async function appendEnvironment(plan) {
  const values = {
    RELEASE_SEQUENCE: plan.releaseSequence,
    RELEASE_ID: plan.releaseId,
    RELEASE_SOURCE_COMMIT: plan.releaseSourceCommit,
    RELEASE_COMMIT: plan.releaseCommit,
    RELEASE_MODE: plan.mode,
    EXPECTED_REMOTE_MAIN: plan.expectedRemoteMain
  };
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join("");
  if (process.env.GITHUB_ENV) await appendFile(process.env.GITHUB_ENV, lines, "utf8");
}

try {
  const plan = planRelease();
  await appendEnvironment(plan);
  process.stdout.write(`${JSON.stringify(plan)}\n`);
} catch (error) {
  process.stderr.write(`${error?.message || error}\n`);
  process.exitCode = 1;
}
