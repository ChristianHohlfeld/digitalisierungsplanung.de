"use strict";

const FRONTEND_ORIGIN = "https://digitalisierungsplanung.de";
const REALTIME_ORIGIN = "https://realtime.digitalisierungsplanung.de";
const REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_RELEASE_TIMEOUT_MS = 300000;
const POLL_INTERVAL_MS = 5000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseReleaseScript(text) {
  const input = String(text || "");
  const id = input.match(/ZUSTAND_RELEASE_ID\s*=\s*"([^"]+)"/)?.[1] || "";
  const sequence = Number(input.match(/ZUSTAND_RELEASE_SEQUENCE\s*=\s*(\d+)/)?.[1] || 0);
  const builtAt = input.match(/ZUSTAND_RELEASE_BUILT_AT\s*=\s*"([^"]+)"/)?.[1] || "";
  const sourceCommit = input.match(/ZUSTAND_RELEASE_SOURCE\s*=\s*"([^"]+)"/)?.[1] || "";
  if (!id || !sequence || !builtAt || !sourceCommit) throw new Error("Invalid release-version.js payload");
  return { id, sequence, builtAt, sourceCommit };
}

function validateReleaseState({ expectedReleaseId, expectedSourceCommit, frontend, version, health }) {
  if (!expectedReleaseId) throw new Error("EXPECTED_RELEASE_ID is required");
  if (!expectedSourceCommit) throw new Error("EXPECTED_RELEASE_SOURCE is required");
  const mismatches = [];
  if (frontend.id !== expectedReleaseId) mismatches.push(`frontend=${frontend.id || "missing"}`);
  if (frontend.sourceCommit !== expectedSourceCommit) mismatches.push(`frontendSource=${frontend.sourceCommit || "missing"}`);
  if (version?.releaseId !== expectedReleaseId) mismatches.push(`realtimeVersion=${version?.releaseId || "missing"}`);
  if (version?.sourceCommit !== expectedSourceCommit) mismatches.push(`realtimeSource=${version?.sourceCommit || "missing"}`);
  if (health?.releaseId !== expectedReleaseId) mismatches.push(`health=${health?.releaseId || "missing"}`);
  if (health?.ok !== true) mismatches.push("health.ok=false");
  if (mismatches.length) throw new Error(`Release not converged: ${mismatches.join(", ")}`);
  return true;
}

async function fetchResponse(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  return response;
}

async function fetchText(url, options = {}) {
  const response = await fetchResponse(url, options);
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.text();
}

async function fetchJson(url, options = {}) {
  const response = await fetchResponse(url, options);
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
}

async function readProductionRelease() {
  const stampText = await fetchText(`${FRONTEND_ORIGIN}/release-version.js?smoke=${Date.now()}`);
  const [version, health] = await Promise.all([
    fetchJson(`${REALTIME_ORIGIN}/version?smoke=${Date.now()}`, { headers: { Origin: FRONTEND_ORIGIN } }),
    fetchJson(`${REALTIME_ORIGIN}/healthz?smoke=${Date.now()}`)
  ]);
  return { frontend: parseReleaseScript(stampText), version, health };
}

async function waitForProductionRelease(expectedReleaseId, expectedSourceCommit, timeoutMs = DEFAULT_RELEASE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const state = await readProductionRelease();
      validateReleaseState({ expectedReleaseId, expectedSourceCommit, ...state });
      return state;
    } catch (error) {
      lastError = error;
      console.log(`[release-smoke] waiting: ${error.message}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Production did not converge within ${timeoutMs}ms: ${lastError?.message || "unknown error"}`);
}

async function verifyEditorSurface(expectedReleaseId) {
  const html = await fetchText(`${FRONTEND_ORIGIN}/state.html?release-smoke=${encodeURIComponent(expectedReleaseId)}-${Date.now()}`);
  if (!html.includes("App Recorder")) throw new Error("Production state.html is missing App Recorder");
  if (!html.includes("App Render")) throw new Error("Production state.html is missing App Render");
  return true;
}

async function verifyRecorderCors() {
  const response = await fetchResponse(`${REALTIME_ORIGIN}/recorder/sessions`, {
    method: "OPTIONS",
    headers: {
      Origin: FRONTEND_ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type"
    }
  });
  if (response.status !== 204) throw new Error(`Recorder preflight -> HTTP ${response.status}`);
  const allowOrigin = response.headers.get("access-control-allow-origin") || "";
  const allowMethods = response.headers.get("access-control-allow-methods") || "";
  const allowHeaders = response.headers.get("access-control-allow-headers") || "";
  if (allowOrigin !== FRONTEND_ORIGIN) throw new Error(`Recorder ACAO mismatch: ${allowOrigin || "missing"}`);
  if (!allowMethods.toUpperCase().includes("POST")) throw new Error(`Recorder POST not allowed: ${allowMethods || "missing"}`);
  if (!allowHeaders.toLowerCase().includes("content-type")) throw new Error(`Recorder content-type not allowed: ${allowHeaders || "missing"}`);
  return true;
}

async function verifyRecorderSession() {
  let sessionId = "";
  try {
    const response = await fetchResponse(`${REALTIME_ORIGIN}/recorder/sessions`, {
      method: "POST",
      headers: {
        Origin: FRONTEND_ORIGIN,
        "content-type": "application/json"
      },
      body: JSON.stringify({ url: "https://example.com" })
    });
    if (response.status !== 201) throw new Error(`Recorder create -> HTTP ${response.status}: ${await response.text()}`);
    const body = await response.json();
    sessionId = String(body.sessionId || "");
    if (!sessionId) throw new Error("Recorder create returned no sessionId");
    if (!String(body.current?.url || "").includes("example.com")) throw new Error(`Recorder current URL mismatch: ${body.current?.url || "missing"}`);
    if (!body.current?.image) throw new Error("Recorder create returned no browser image");
    return { sessionId, status: body.status || "", actionCount: Number(body.actionCount) || 0 };
  } finally {
    if (sessionId) {
      await fetchResponse(`${REALTIME_ORIGIN}/recorder/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
        headers: { Origin: FRONTEND_ORIGIN }
      }).catch(() => null);
    }
  }
}

async function main() {
  const expectedReleaseId = String(process.env.EXPECTED_RELEASE_ID || "").trim();
  const expectedSourceCommit = String(process.env.EXPECTED_RELEASE_SOURCE || "").trim();
  const timeoutMs = Math.max(30000, Number(process.env.RELEASE_SMOKE_TIMEOUT_MS) || DEFAULT_RELEASE_TIMEOUT_MS);

  console.log(`[release-smoke] expected ${expectedReleaseId} from ${expectedSourceCommit}`);
  const release = await waitForProductionRelease(expectedReleaseId, expectedSourceCommit, timeoutMs);
  console.log(`[release-smoke] converged: ${release.frontend.id} / ${release.version.releaseId} / ${release.health.releaseId}`);

  await verifyEditorSurface(expectedReleaseId);
  console.log("[release-smoke] state.html: ok");

  await verifyRecorderCors();
  console.log("[release-smoke] recorder CORS: ok");

  const recorder = await verifyRecorderSession();
  console.log(`[release-smoke] recorder session: ok (${recorder.sessionId}, ${recorder.status})`);
  console.log(`[release-smoke] VERIFIED ${expectedReleaseId}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[release-smoke] FAILED: ${error.stack || error.message || error}`);
    process.exit(1);
  });
}

module.exports = {
  parseReleaseScript,
  validateReleaseState,
  waitForProductionRelease,
  verifyEditorSurface,
  verifyRecorderCors,
  verifyRecorderSession
};
