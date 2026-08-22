const expected = String(process.env.EXPECTED_RELEASE || "").trim();
if (!/^release-\d+$/.test(expected)) throw new Error("EXPECTED_RELEASE must be release-N");

const timeoutMs = Math.max(60_000, Number(process.env.PRODUCTION_SMOKE_TIMEOUT_MS) || 12 * 60_000);
const deadline = Date.now() + timeoutMs;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function json(url) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function releaseFromFrontend() {
  const response = await fetch(`https://digitalisierungsplanung.de/release-version.js?smoke=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`frontend release marker returned ${response.status}`);
  return (await response.text()).match(/ZUSTAND_RELEASE_ID\s*=\s*"([^"]+)"/)?.[1] || "";
}

let lastError = null;
while (Date.now() < deadline) {
  try {
    const [frontend, version, health, contract, recorder] = await Promise.all([
      releaseFromFrontend(),
      json(`https://realtime.digitalisierungsplanung.de/version?smoke=${Date.now()}`),
      json(`https://realtime.digitalisierungsplanung.de/healthz?smoke=${Date.now()}`),
      json(`https://realtime.digitalisierungsplanung.de/contract?smoke=${Date.now()}`),
      fetch(`https://realtime.digitalisierungsplanung.de/recorder.html?smoke=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) })
    ]);
    if (frontend !== expected) throw new Error(`frontend=${frontend || "missing"}`);
    if (version.id !== expected || version.recorderReady !== true) throw new Error(`version=${version.id}, recorderReady=${version.recorderReady}`);
    if (!health.ok || health.releaseId !== expected || health.recorderReady !== true) throw new Error(`health=${health.releaseId}, recorderReady=${health.recorderReady}`);
    if (contract.schema !== "flow/1" || contract.flow?.recording?.schema !== "website-recording/1" || contract.presets?.length !== 13) throw new Error("production contract is not the focused flow/1 contract");
    if (!recorder.ok || !/Website aufnehmen/.test(await recorder.text())) throw new Error(`recorder page returned ${recorder.status}`);
    console.log(`Production ${expected} converged: frontend, flow runtime, contract and recorder are healthy.`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    console.log(`Waiting for ${expected}: ${error.message}`);
    await wait(15_000);
  }
}

throw new Error(`Production did not converge to ${expected}: ${lastError?.message || "timeout"}`);
