"use strict";

const FRONTEND_ORIGIN = "https://digitalisierungsplanung.de";
const REALTIME_ORIGIN = "https://realtime.digitalisierungsplanung.de";
const REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_RELEASE_TIMEOUT_MS = 300000;
const POLL_INTERVAL_MS = 5000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
  return fetch(url, {
    cache: "no-store",
    redirect: "follow",
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
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
  const stamp = `${encodeURIComponent(expectedReleaseId)}-${Date.now()}`;
  const [html, app, bridge, manifest] = await Promise.all([
    fetchText(`${FRONTEND_ORIGIN}/state.html?release-smoke=${stamp}`),
    fetchText(`${FRONTEND_ORIGIN}/state-app.js?release-smoke=${stamp}`),
    fetchText(`${FRONTEND_ORIGIN}/recorder-extension/editor-bridge.js?release-smoke=${stamp}`),
    fetchJson(`${FRONTEND_ORIGIN}/recorder-extension/manifest.json?release-smoke=${stamp}`)
  ]);
  if (!html.includes("App Recorder") || !html.includes("App Render")) throw new Error("Production state.html is missing recorder/render tabs");
  if (!html.includes("Desktop Recorder") || !html.includes("recorder-extension/editor-bridge.js") || !html.includes("state-app.js")) throw new Error("Production state.html is missing browser-recorder product surface");
  if (`${html}\n${app}`.match(/npm run recorder:agent|127\.0\.0\.1:8799|Local Recorder Agent/i)) throw new Error("Production editor exposes developer recorder setup");
  if (!app.includes("Aufnahme auf Desktop verfügbar")) throw new Error("Production mobile recorder state is missing");
  if (!bridge.includes("ZUSTAND_EXTENSION_COMMAND")) throw new Error("Production recorder bridge is missing");
  if (manifest?.manifest_version !== 3 || !manifest?.host_permissions?.includes("<all_urls>")) throw new Error("Production recorder extension manifest is invalid");

  const packageResponse = await fetchResponse(`${FRONTEND_ORIGIN}/recorder-extension.zip?release-smoke=${stamp}`);
  if (!packageResponse.ok) throw new Error(`Production recorder package -> HTTP ${packageResponse.status}`);
  const packageBytes = (await packageResponse.arrayBuffer()).byteLength;
  if (packageBytes < 1000) throw new Error(`Production recorder package is unexpectedly small: ${packageBytes}`);
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

async function verifyAutomationBrowserSession() {
  let sessionId = "";
  try {
    const response = await fetchResponse(`${REALTIME_ORIGIN}/recorder/sessions`, {
      method: "POST",
      headers: { Origin: FRONTEND_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" })
    });
    if (response.status !== 201) throw new Error(`Automation browser create -> HTTP ${response.status}: ${await response.text()}`);
    const body = await response.json();
    sessionId = String(body.sessionId || "");
    if (!sessionId) throw new Error("Automation browser returned no sessionId");
    if (!String(body.current?.url || "").includes("example.com")) throw new Error(`Automation browser URL mismatch: ${body.current?.url || "missing"}`);
    if (!body.current?.image) throw new Error("Automation browser returned no image");
    return { sessionId, status: body.status || "" };
  } finally {
    if (sessionId) {
      await fetchResponse(`${REALTIME_ORIGIN}/recorder/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE", headers: { Origin: FRONTEND_ORIGIN } }).catch(() => null);
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
  console.log("[release-smoke] browser-recorder editor + package: ok");

  await verifyRecorderCors();
  console.log("[release-smoke] automation backend CORS: ok");

  const session = await verifyAutomationBrowserSession();
  console.log(`[release-smoke] automation browser: ok (${session.sessionId}, ${session.status})`);
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
  verifyAutomationBrowserSession,
  verifyRecorderSession: verifyAutomationBrowserSession
};
