"use strict";

const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { createNativeRecorderSession, replayNativePackage } = require("./native-browser-recorder");
const { replayRecording } = require("./replay-engine");
const { ReplayTaskStore } = require("./replay-task-service");

const DEFAULT_HOST = process.env.LOCAL_RECORDER_HOST || "127.0.0.1";
const DEFAULT_PORT = Math.max(1, Math.min(65535, Number(process.env.LOCAL_RECORDER_PORT) || 8799));
const EDITOR_ORIGIN = "https://digitalisierungsplanung.de";
const MAX_BODY = 3 * 1024 * 1024;

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error("Request body too large."), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch (_) { throw Object.assign(new Error("Invalid JSON body."), { statusCode: 400 }); }
}

function writeJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

function localRecorderHtml() {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recorder · Zustand</title><style>:root{color-scheme:dark;--bg:#07111d;--panel:#0b1b2a;--line:#20425f;--text:#e6f2ff;--muted:#9fb6cc;--ok:#34d399;--bad:#fb7185}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 system-ui,sans-serif}main{width:min(920px,calc(100% - 24px));margin:auto;padding:24px 0}h1{margin:0 0 4px;font-size:26px}p{margin:0 0 16px;color:var(--muted)}.panel{border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:14px;margin:12px 0}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}input,select,button{min-height:42px;border:1px solid var(--line);border-radius:9px;background:#06111f;color:var(--text);font:inherit;padding:0 11px}input[type=url],input[type=text]{flex:1;min-width:220px}button{cursor:pointer;font-weight:850}button.primary{background:#0b3a55;border-color:#23729b}button.good{background:#064e3b;border-color:#15966d}button.danger{background:#5f1721;border-color:#a4384a}button:disabled{opacity:.42;cursor:not-allowed}.status{font:13px ui-monospace,monospace;color:var(--muted);margin-top:10px}.ok{color:var(--ok)}.bad{color:var(--bad)}.hint{font-size:12px;color:var(--muted);margin-top:8px}.task{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:center;border-top:1px solid #173650;padding:9px 0}.task:first-child{border-top:0}.pill{display:inline-block;padding:3px 8px;border:1px solid var(--line);border-radius:999px;color:#bfdbfe;font-size:12px}@media(max-width:620px){.row>*{width:100%}.task{grid-template-columns:1fr}.task button{width:100%}}</style></head><body><main><h1>Echter Browser-Recorder</h1><p>Chromium öffnet sich lokal. Du bedienst die Website normal; Zustand zeichnet den Ablauf im Hintergrund auf.</p><section class="panel"><div class="row"><input id="url" type="url" autocomplete="url" placeholder="https://wob-app15.wobak.de/de/cockpit"><button class="primary" id="start">Browser öffnen + aufnehmen</button></div><div class="hint">Klicks, Inputs, Checkboxen, Dropdowns, Tasten, Scroll und Timings werden als echte Replay-Actions gespeichert. Passwortwerte bleiben draußen.</div></section><section class="panel"><div class="row"><span class="pill" id="state">Bereit</span><button class="good" id="finish" disabled>Fertig → State-Chart</button><button id="replay" disabled>Echten Replay starten</button><button id="editor" disabled>Im Editor öffnen</button><button class="danger" id="cancel" disabled>Abbrechen</button></div><div class="status" id="status">Bereit.</div></section><section class="panel" id="taskPanel" hidden><strong>Als Replay-Task speichern</strong><div class="row" style="margin-top:8px"><input id="taskName" type="text" placeholder="Task-Name"><select id="schedule"><option value="manual">Manuell</option><option value="cron">Cron</option></select><input id="cron" type="text" value="0 7 * * 1-5" placeholder="0 7 * * 1-5" hidden><button id="saveTask">Task speichern</button></div><div class="hint">Cron = Minute Stunde Tag Monat Wochentag. Event/Webhook-Trigger bleiben im State-Modell.</div></section><section class="panel"><div class="row"><strong>Lokale Replay-Tasks</strong><button id="refresh">Aktualisieren</button></div><div id="tasks" class="hint">Keine Tasks.</div></section></main><script>const qs=new URLSearchParams(location.search);const urlEl=document.getElementById("url"),start=document.getElementById("start"),finish=document.getElementById("finish"),replay=document.getElementById("replay"),editor=document.getElementById("editor"),cancel=document.getElementById("cancel"),status=document.getElementById("status"),state=document.getElementById("state"),taskPanel=document.getElementById("taskPanel"),schedule=document.getElementById("schedule"),cron=document.getElementById("cron"),tasks=document.getElementById("tasks");let pkg=null;urlEl.value=qs.get("url")||"";function stat(text,ok=true){status.textContent=text;status.className="status "+(ok?"ok":"bad")}function controls(recording,done){start.disabled=recording;finish.disabled=!recording;cancel.disabled=!recording;replay.disabled=!done;editor.disabled=!done;taskPanel.hidden=!done}async function api(route,body,method="POST"){const r=await fetch(route,{method,headers:body===undefined?undefined:{"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),cache:"no-store"});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||d.error||("HTTP "+r.status));return d}start.onclick=async()=>{try{stat("Öffne echtes Chromium …");await api("/recording/start",{url:urlEl.value});pkg=null;controls(true,false);state.textContent="Aufnahme läuft";stat("Chromium ist offen. Website jetzt ganz normal bedienen.")}catch(e){stat(e.message,false)}};finish.onclick=async()=>{try{stat("Erzeuge State-Chart + Replay …");const d=await api("/recording/finish",{});pkg=d.package;controls(false,true);state.textContent=d.actionCount+" Aktionen · "+d.stateCount+" States";document.getElementById("taskName").value="Replay · "+new URL(pkg.recording.startUrl).hostname;stat("Fertig. State-Chart und echter Replay sind bereit.")}catch(e){stat(e.message,false)}};cancel.onclick=async()=>{await api("/recording",undefined,"DELETE").catch(()=>{});pkg=null;controls(false,false);state.textContent="Bereit";stat("Aufnahme abgebrochen.")};replay.onclick=async()=>{try{replay.disabled=true;stat("Echter Replay läuft in Chromium …");const d=await api("/recording/replay",{});stat("Replay erfolgreich · "+d.actionCount+" Aktionen · "+d.durationMs+" ms")}catch(e){stat(e.message,false)}finally{replay.disabled=false}};editor.onclick=()=>{if(!pkg)return;const target=window.open("${EDITOR_ORIGIN}/state.html?recorded=1&replay=1","zustand-editor");if(!target){stat("Popup blockiert. Popups erlauben und erneut klicken.",false);return}let tries=0;const timer=setInterval(()=>{tries++;try{target.postMessage({type:"ZUSTAND_RECORDING_IMPORT",package:pkg},"${EDITOR_ORIGIN}")}catch(_){}if(tries>32)clearInterval(timer)},250);stat("Recording an visuellen Editor übergeben.")};schedule.onchange=()=>cron.hidden=schedule.value!=="cron";document.getElementById("saveTask").onclick=async()=>{if(!pkg)return;try{await api("/tasks",{name:document.getElementById("taskName").value,runner:"local",recording:pkg.recording,schedule:schedule.value==="cron"?{type:"cron",expression:cron.value}:{type:"manual"}});stat("Replay-Task gespeichert.");await loadTasks()}catch(e){stat(e.message,false)}};async function loadTasks(){try{const d=await api("/tasks",undefined,"GET");tasks.innerHTML="";if(!d.tasks.length){tasks.textContent="Keine Tasks.";return}for(const t of d.tasks){const row=document.createElement("div");row.className="task";const label=document.createElement("div");label.innerHTML="<strong>"+esc(t.name)+"</strong><br><span>"+esc(t.schedule.type==="cron"?t.schedule.expression:"manuell")+(t.lastRun?" · letzter Run: "+esc(t.lastRun.status):"")+"</span>";const run=document.createElement("button");run.textContent="Run";run.onclick=async()=>{try{stat("Task läuft …");const r=await api("/tasks/"+encodeURIComponent(t.id)+"/run",{});stat("Task erfolgreich · "+r.actionCount+" Actions");await loadTasks()}catch(e){stat(e.message,false)}};const del=document.createElement("button");del.className="danger";del.textContent="Löschen";del.onclick=async()=>{await api("/tasks/"+encodeURIComponent(t.id),undefined,"DELETE");await loadTasks()};row.append(label,run,del);tasks.append(row)}}catch(e){tasks.textContent=e.message}}function esc(value){return String(value??"").replace(/[&<>\"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;"}[ch]))}document.getElementById("refresh").onclick=loadTasks;controls(false,false);loadTasks();</script></body></html>`;
}

function createLocalRecorderServer(options = {}) {
  let activeSession = null;
  let lastPackage = null;
  const taskStore = options.taskStore || new ReplayTaskStore({
    filePath: options.taskFile || process.env.LOCAL_REPLAY_TASKS_FILE || path.join(os.homedir(), ".zustand", "replay-tasks.json"),
    runner: (recording, runOptions = {}) => replayRecording(recording, {
      headless: true,
      ignoreHTTPSErrors: true,
      respectTiming: true,
      secrets: runOptions.secrets || {}
    })
  });
  taskStore.start();

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", `http://${DEFAULT_HOST}:${DEFAULT_PORT}`);
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/local-recorder.html")) {
        const body = localRecorderHtml();
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(body) });
        return response.end(body);
      }
      if (request.method === "GET" && url.pathname === "/healthz") return writeJson(response, 200, { ok: true, service: "local-recorder-agent", recording: Boolean(activeSession) });
      if (request.method === "POST" && url.pathname === "/recording/start") {
        if (activeSession) await activeSession.cancel().catch(() => {});
        const body = await readJson(request);
        activeSession = await createNativeRecorderSession({ url: body.url, headless: false, ignoreHTTPSErrors: true });
        lastPackage = null;
        return writeJson(response, 201, { ok: true, startUrl: activeSession.startUrl });
      }
      if (request.method === "POST" && url.pathname === "/recording/finish") {
        if (!activeSession) return writeJson(response, 409, { error: "recording_not_active", message: "No active recording." });
        lastPackage = await activeSession.finish();
        activeSession = null;
        return writeJson(response, 200, { ok: true, package: lastPackage, actionCount: lastPackage.recording.actions.length, stateCount: lastPackage.recording.snapshotCount });
      }
      if (request.method === "DELETE" && url.pathname === "/recording") {
        if (activeSession) await activeSession.cancel().catch(() => {});
        activeSession = null;
        return writeJson(response, 200, { ok: true });
      }
      if (request.method === "POST" && url.pathname === "/recording/replay") {
        if (!lastPackage) return writeJson(response, 409, { error: "recording_missing", message: "Finish a recording first." });
        return writeJson(response, 200, await replayNativePackage(lastPackage, { headless: false }));
      }
      if (request.method === "GET" && url.pathname === "/tasks") return writeJson(response, 200, { tasks: await taskStore.list() });
      if (request.method === "POST" && url.pathname === "/tasks") return writeJson(response, 201, { task: await taskStore.create(await readJson(request)) });
      const taskMatch = url.pathname.match(/^\/tasks\/([^/]+)(?:\/(run))?$/);
      if (taskMatch) {
        const id = decodeURIComponent(taskMatch[1]);
        if (request.method === "POST" && taskMatch[2] === "run") return writeJson(response, 200, await taskStore.run(id, await readJson(request)));
        if (request.method === "DELETE" && !taskMatch[2]) return writeJson(response, 200, await taskStore.remove(id));
      }
      return writeJson(response, 404, { error: "not_found" });
    } catch (error) {
      return writeJson(response, Number(error?.statusCode) || 500, { error: error?.code || "local_recorder_failed", message: String(error?.message || error), run: error?.run || null });
    }
  });
  return { server, taskStore, host: options.host || DEFAULT_HOST, port: options.port || DEFAULT_PORT, get activeSession() { return activeSession; } };
}

function startLocalRecorderServer(options = {}) {
  const runtime = createLocalRecorderServer(options);
  runtime.server.listen(runtime.port, runtime.host, () => {
    console.log(`Zustand local recorder: http://${runtime.host}:${runtime.port}`);
    console.log("Start recording there; a real Chromium window opens for normal browser use.");
  });
  const shutdown = async () => {
    runtime.taskStore.stop();
    await runtime.activeSession?.cancel?.().catch(() => {});
    runtime.server.close();
  };
  process.on("SIGTERM", () => { void shutdown().finally(() => process.exit(0)); });
  process.on("SIGINT", () => { void shutdown().finally(() => process.exit(0)); });
  return runtime;
}

if (require.main === module) startLocalRecorderServer();

module.exports = { createLocalRecorderServer, localRecorderHtml, startLocalRecorderServer };
