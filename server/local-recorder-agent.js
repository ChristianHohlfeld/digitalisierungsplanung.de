"use strict";

const http = require("node:http");
const externalRecorder = require("./external-recorder");

const DEFAULT_HOST = process.env.LOCAL_RECORDER_HOST || "127.0.0.1";
const DEFAULT_PORT = Math.max(1, Math.min(65535, Number(process.env.LOCAL_RECORDER_PORT) || 8799));
const DEFAULT_ORIGIN = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;

function localRecorderHtml() {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lokaler Recorder · Zustand</title><style>:root{color-scheme:dark;--bg:#07111d;--panel:#0b1b2a;--line:#20425f;--text:#e6f2ff;--muted:#9fb6cc;--accent:#38bdf8;--ok:#34d399;--bad:#fb7185}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.4 system-ui,sans-serif}main{width:min(1180px,calc(100% - 24px));margin:auto;padding:18px 0 28px}header{display:flex;gap:14px;align-items:end;justify-content:space-between;margin-bottom:14px}h1{margin:0;font-size:24px}p{margin:4px 0;color:var(--muted)}.panel{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:12px;margin-bottom:12px}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}input,button,select{min-height:40px;border:1px solid var(--line);border-radius:8px;background:#06111f;color:var(--text);font:inherit;padding:0 10px}input[type=url]{flex:1;min-width:260px}button{cursor:pointer;font-weight:800}button.primary{background:#0b3a55;border-color:#23729b}button.good{background:#064e3b;border-color:#15966d}button.danger{background:#5f1721;border-color:#a4384a}button:disabled{opacity:.45;cursor:not-allowed}.viewport{position:relative;display:grid;place-items:center;overflow:auto;min-height:420px;max-height:calc(100vh - 270px);background:#020617;border:1px solid var(--line);border-radius:12px;outline:none}.viewport:focus{box-shadow:0 0 0 3px rgba(56,189,248,.2);border-color:#38bdf8}.viewport img{display:block;max-width:100%;height:auto;cursor:crosshair;user-select:none;-webkit-user-drag:none}.status{font-family:ui-monospace,monospace;color:var(--muted)}.ok{color:var(--ok)}.bad{color:var(--bad)}#after{display:none}.hint{font-size:12px;color:var(--muted)}.kbd{color:#bfdbfe}.pill{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(56,189,248,.34);border-radius:999px;padding:4px 8px;color:#bfdbfe;background:#071321;font-size:12px;font-weight:800}.hidden-capture{position:fixed;left:-1000px;top:-1000px;width:1px;height:1px;opacity:0}@media(max-width:680px){header{display:block}.row>*{flex:1}button{min-width:90px}}</style></head><body><main><header><div><h1>Lokaler Recorder</h1><p>Browser läuft auf diesem Rechner im Kundennetz. Klick, Tippen, Paste und Mausrad werden direkt aufgenommen.</p></div><div class="status" id="status">Bereit</div></header><section class="panel"><div class="row"><input id="url" type="url" autocomplete="url" placeholder="https://wob-app15.wobak.de/de/cockpit"><button class="primary" id="start">Aufnahme starten</button></div><div class="hint">Nach dem Start: in die Website klicken, dann normal tippen. <span class="kbd">Mausrad</span> scrollt die Zielseite, <span class="kbd">Paste</span> schreibt Text. Passwortwerte werden nicht exportiert.</div></section><section class="panel" id="controls" hidden><div class="row"><span class="pill" id="captureState">Browserfenster nicht fokussiert</span><select id="key"><option>Enter</option><option>Tab</option><option>Escape</option><option>Backspace</option><option>Delete</option><option>ArrowDown</option><option>ArrowUp</option><option>ArrowLeft</option><option>ArrowRight</option></select><button id="sendKey">Taste senden</button><button class="good" id="finish">Fertig → States</button><button class="danger" id="cancel">Abbrechen</button></div></section><section class="viewport" id="viewport" tabindex="0" aria-label="Aufgenommene Website. Hier klicken, tippen und scrollen."><div class="status">URL eingeben und Aufnahme starten.</div></section><textarea class="hidden-capture" id="capture" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea><section class="panel" id="after"><div class="row"><button class="good" id="import">In Zustand übernehmen</button><button id="replay">Original-Website automatisch replayen</button><button id="download">JSON laden</button></div><div class="hint" id="summary"></div></section></main><script>const q=new URLSearchParams(location.search);const allowed=new Set(["https://digitalisierungsplanung.de","https://www.digitalisierungsplanung.de"]);const targetOrigin=allowed.has(q.get("targetOrigin"))?q.get("targetOrigin"):"https://digitalisierungsplanung.de";const status=document.getElementById("status"),viewport=document.getElementById("viewport"),controls=document.getElementById("controls"),after=document.getElementById("after"),capture=document.getElementById("capture"),captureState=document.getElementById("captureState");let session=null,definition=null,lastViewport=null,typeBuffer="",typeTimer=0,busy=false;function setStatus(text,ok=true){status.textContent=text;status.className="status "+(ok?"ok":"bad")}function setCapture(active){captureState.textContent=active?"Browserfenster fokussiert · Tippen aktiv":"Browserfenster nicht fokussiert";captureState.style.borderColor=active?"rgba(52,211,153,.72)":"rgba(56,189,248,.34)"}async function api(path,body,method="POST"){const r=await fetch(path,{method,headers:{"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),cache:"no-store"});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.message||data.error||("HTTP "+r.status));return data}function focusCapture(){viewport.focus();capture.focus({preventScroll:true});setCapture(true)}function render(data){session=data.sessionId||session;lastViewport=data.viewport||lastViewport;const shot=data.current;if(!shot?.image)return;viewport.innerHTML="";const img=new Image();img.src=shot.image;img.alt=shot.title||shot.url||"Website";img.dataset.w=String(data.viewport?.width||1024);img.dataset.h=String(data.viewport?.height||640);img.addEventListener("click",async e=>{if(!session||busy)return;focusCapture();const r=img.getBoundingClientRect();const x=Math.round((e.clientX-r.left)/r.width*Number(img.dataset.w));const y=Math.round((e.clientY-r.top)/r.height*Number(img.dataset.h));try{busy=true;setStatus("Klick …");render(await api("/recorder/sessions/"+encodeURIComponent(session)+"/actions",{type:"click",x,y}));setStatus("Aufnahme · Klick aufgenommen")}catch(err){setStatus(err.message,false)}finally{busy=false;focusCapture()}});img.addEventListener("wheel",onWheel,{passive:false});viewport.appendChild(img);focusCapture()}async function flushText(){const text=typeBuffer;typeBuffer="";clearTimeout(typeTimer);typeTimer=0;if(!text||!session)return;try{busy=true;render(await api("/recorder/sessions/"+encodeURIComponent(session)+"/actions",{type:"input",text}));setStatus("Eingabe aufgenommen")}catch(err){setStatus(err.message,false)}finally{busy=false;focusCapture()}}function queueText(text){typeBuffer+=String(text||"");clearTimeout(typeTimer);typeTimer=setTimeout(flushText,140)}async function sendKey(key){await flushText();if(!session||!key)return;try{busy=true;render(await api("/recorder/sessions/"+encodeURIComponent(session)+"/actions",{type:"key",key}));setStatus("Taste aufgenommen") }catch(err){setStatus(err.message,false)}finally{busy=false;focusCapture()}}let wheelTimer=0,wheelX=0,wheelY=0;function onWheel(e){if(!session)return;e.preventDefault();focusCapture();wheelX+=Math.max(-1200,Math.min(1200,Math.round(e.deltaX||0)));wheelY+=Math.max(-1200,Math.min(1200,Math.round(e.deltaY||0)));clearTimeout(wheelTimer);wheelTimer=setTimeout(async()=>{const dx=wheelX,dy=wheelY;wheelX=0;wheelY=0;try{busy=true;render(await api("/recorder/sessions/"+encodeURIComponent(session)+"/actions",{type:"scroll",deltaX:dx,deltaY:dy}));setStatus("Scroll aufgenommen")}catch(err){setStatus(err.message,false)}finally{busy=false;focusCapture()}},90)}capture.addEventListener("beforeinput",e=>{if(!session)return;if(e.inputType==="insertText"&&e.data){e.preventDefault();queueText(e.data)}else if(e.inputType==="insertFromPaste"){e.preventDefault();const text=e.data||"";if(text)queueText(text)}});capture.addEventListener("paste",e=>{if(!session)return;e.preventDefault();queueText(e.clipboardData?.getData("text")||"")});capture.addEventListener("keydown",e=>{if(!session)return;if(e.ctrlKey||e.metaKey||e.altKey)return;if(e.key.length===1){e.preventDefault();queueText(e.key);return}const allowed=new Set(["Enter","Tab","Escape","Backspace","Delete","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Home","End","PageUp","PageDown"]);if(allowed.has(e.key)){e.preventDefault();void sendKey(e.key)}});viewport.addEventListener("focus",()=>setCapture(true));viewport.addEventListener("blur",()=>setCapture(document.activeElement===capture));document.getElementById("start").onclick=async()=>{try{setStatus("Öffne lokalen Browser …");const data=await api("/recorder/sessions",{url:document.getElementById("url").value});render(data);controls.hidden=false;setStatus("Aufnahme läuft · Klick, Tippen, Scroll aktiv")}catch(err){setStatus(err.message,false)}};document.getElementById("sendKey").onclick=()=>sendKey(document.getElementById("key").value);document.getElementById("finish").onclick=async()=>{try{await flushText();setStatus("Kompiliere States …");const data=await api("/recorder/sessions/"+encodeURIComponent(session)+"/finish",{});definition=data.definition;controls.hidden=true;after.style.display="block";document.getElementById("summary").textContent=data.recording.actions.length+" Aktionen · "+data.recording.snapshotCount+" States · echte Replay-Actions exportiert";setStatus("FSM erzeugt")}catch(err){setStatus(err.message,false)}};document.getElementById("import").onclick=()=>{if(!definition)return;window.opener?.postMessage({type:"STATE_BLUEPRINT_EXTERNAL_RECORDING_RESULT",definition,sessionId:session},targetOrigin);setStatus("An Zustand übergeben")};document.getElementById("replay").onclick=async()=>{try{setStatus("Replay läuft …");const data=await api("/recorder/sessions/"+encodeURIComponent(session)+"/replay",{});viewport.innerHTML='<img alt="Replay result" style="max-width:100%" src="'+data.image+'">';setStatus("Replay: "+data.actionCount+" Aktionen")}catch(err){setStatus(err.message,false)}};document.getElementById("download").onclick=()=>{if(!definition)return;const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(definition,null,2)],{type:"application/json"}));a.download="website-recording.json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};document.getElementById("cancel").onclick=async()=>{if(session)await api("/recorder/sessions/"+encodeURIComponent(session),undefined,"DELETE").catch(()=>{});session=null;controls.hidden=true;viewport.innerHTML='<div class="status">Abgebrochen.</div>';setStatus("Bereit")};</script></body></html>`;
}

function writeHtml(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'self'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

function writeJson(response, statusCode, body) {
  const text = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-length": Buffer.byteLength(text)
  });
  response.end(text);
}

function createLocalRecorderServer(options = {}) {
  const manager = options.manager || externalRecorder.createRecorderManager({
    ttlMs: Number(process.env.LOCAL_RECORDER_TTL_MS) || 5 * 60 * 1000,
    maxSessions: Number(process.env.LOCAL_RECORDER_MAX_SESSIONS) || 2,
    maxSessionsPerClient: 1
  });
  const publicBaseUrl = options.publicBaseUrl || DEFAULT_ORIGIN;
  const allowedOrigins = options.allowedOrigins || [publicBaseUrl, "http://127.0.0.1:8799", "http://localhost:8799"];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", publicBaseUrl);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/local-recorder.html")) {
      writeHtml(response, 200, localRecorderHtml());
      return;
    }
    if (request.method === "GET" && url.pathname === "/healthz") {
      writeJson(response, 200, { ok: true, service: "local-recorder-agent" });
      return;
    }
    if (externalRecorder.matchesRecorderPath(url.pathname)) {
      void externalRecorder.handleRecorderRequest(request, response, url, { manager, allowedOrigins, publicBaseUrl })
        .catch(error => {
          if (response.headersSent) return response.end();
          writeJson(response, 500, { error: "local_recorder_failed", message: String(error?.message || error) });
        });
      return;
    }
    writeJson(response, 404, { error: "not_found" });
  });
  return { server, manager, host: options.host || DEFAULT_HOST, port: options.port || DEFAULT_PORT, publicBaseUrl };
}

function startLocalRecorderServer(options = {}) {
  const runtime = createLocalRecorderServer(options);
  runtime.server.listen(runtime.port, runtime.host, () => {
    console.log(`Local recorder agent listening on http://${runtime.host}:${runtime.port}`);
    console.log("Open this URL on the intranet client and record normally: click, type, paste, scroll.");
  });
  async function shutdown() {
    runtime.server.close();
    await runtime.manager.close?.().catch(() => {});
  }
  process.on("SIGTERM", () => { void shutdown().finally(() => process.exit(0)); });
  process.on("SIGINT", () => { void shutdown().finally(() => process.exit(0)); });
  return runtime;
}

if (require.main === module) startLocalRecorderServer();

module.exports = {
  createLocalRecorderServer,
  localRecorderHtml,
  startLocalRecorderServer
};
