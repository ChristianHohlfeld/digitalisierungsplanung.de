import fs from "node:fs";
import { execFileSync } from "node:child_process";

const statePath = "state.html";
let html = fs.readFileSync(statePath, "utf8");

const hero = String.raw`<h2>App aufnehmen</h2>
            <div class="muted">Die Zielseite öffnet sich in deinem echten Desktop-Browser. Du benutzt sie ganz normal; Zustand zeichnet Klicks, Inputs, Checkboxen, Tasten, Scrolls, Navigationen und Timings im Hintergrund auf.</div>
            <div class="statusline"><span class="status-dot busy" id="recorderDot"></span><strong id="recorderStatus">Recorder wird geprüft …</strong><span class="pill" id="recorderKind">Desktop Recorder</span></div>
            <div class="url-row"><input class="input" id="recordUrl" type="url" autocomplete="url" placeholder="https://wob-app15.wobak.de/de/cockpit"><button class="btn good" id="recordStart">Aufnahme starten</button></div>
            <div class="row" style="margin-top:8px"><button class="btn primary" id="recordFinish" disabled>Fertig → Projekt</button><button class="btn danger" id="recordCancel" disabled>Abbrechen</button><a class="btn ghost" id="installRecorder" href="/recorder-extension.zip" download style="text-decoration:none">Desktop Recorder installieren</a></div>
            <div class="record-metrics"><div class="metric"><strong id="recordActions">0</strong><span>Actions</span></div><div class="metric"><strong id="recordStates">0</strong><span>visuelle States</span></div><div class="metric"><strong id="recordMode">bereit</strong><span>Status</span></div></div>
            <div class="record-help" id="recorderHelp">Der Recorder läuft als Browser-Erweiterung direkt auf der echten Zielseite. Öffentliche Seiten und Intranet funktionieren damit gleich; kein Screenshot-Fernsteuern und kein lokaler Serverprozess.</div>`;

const heroPattern = /<h2>Echte App aufnehmen<\/h2>[\s\S]*?<div class="record-help">[\s\S]*?<\/div>/;
if (!heroPattern.test(html)) throw new Error("Recorder hero not found");
html = html.replace(heroPattern, hero);

if (!html.includes('<script src="/disable-sw.js"></script>')) throw new Error("Script anchor missing");
html = html.replace('<script src="/disable-sw.js"></script>', '<script src="/disable-sw.js"></script>\n<script src="/recorder-extension/editor-bridge.js"></script>');

html = html.replace('  const AGENT = "http://127.0.0.1:8799";\n', "");
html = html.replace('  let replayPoll = null;\n', '  let replayCancelled = false;\n');

const oldListenerTypes = '  function listenerTypes(context){if(context==="timer")return[{value:"timer",label:"Timer-Ende"}];if(context==="event")return[{value:"event",label:"Event"}];if(context==="auto")return[{value:"auto",label:"Auto"}];return[{value:"click",label:"Klick"},{value:"input",label:"Input"},{value:"change",label:"Änderung"},{value:"key",label:"Taste"},{value:"scroll",label:"Scroll"}]}';
const newListenerTypes = '  function listenerTypes(context){if(context==="timer")return[{value:"timer",label:"Timer-Ende"}];if(context==="event")return[{value:"event",label:"Event"}];if(context==="auto")return[{value:"auto",label:"Auto"}];return[{value:"click",label:"Klick"},{value:"input",label:"Input"},{value:"change",label:"Änderung"},{value:"key",label:"Taste"},{value:"scroll",label:"Scroll"},{value:"navigate",label:"Navigation"}]}';
if (!html.includes(oldListenerTypes)) throw new Error("listenerTypes anchor missing");
html = html.replace(oldListenerTypes, newListenerTypes);

const recorderBlock = String.raw`  function recorderApi(){return window.ZustandRecorderBridge}
  function mobileRecorderUnavailable(){return recorderApi()?.isMobile?.()===true}
  async function checkRecorderBridge(){
    const api=recorderApi(),dot=$("recorderDot"),status=$("recorderStatus"),kind=$("recorderKind"),install=$("installRecorder");
    dot.className="status-dot busy";status.textContent="Recorder wird geprüft …";
    try{
      if(!api)throw new Error("missing");
      await api.ping(900);
      dot.className="status-dot ok";status.textContent="Recorder bereit";kind.textContent="Browser Extension";install.hidden=true;$("recordStart").disabled=false;$("recorderHelp").textContent="Zielseite öffnen, normal bedienen, fertig. Zustand zeichnet den echten Browserpfad im Hintergrund auf.";return true;
    }catch(_){
      dot.className="status-dot";kind.textContent="Desktop Recorder";
      if(mobileRecorderUnavailable()){status.textContent="Aufnahme auf Desktop verfügbar";install.hidden=true;$("recordStart").disabled=true;$("recorderHelp").textContent="Auf dem Smartphone bleibt der Editor vollständig nutzbar. Neue Browserpfade werden auf Desktop aufgenommen und erscheinen danach als normales Projekt.";}
      else{status.textContent="Desktop Recorder nicht installiert";install.hidden=false;$("recordStart").disabled=false;$("recorderHelp").textContent="Für echte Browser-Aufnahmen einmal den Desktop Recorder installieren. Danach öffnet Zustand jede öffentliche oder interne URL direkt im normalen Browser-Tab.";}
      return false;
    }
  }

  async function startRecording(){
    const url=$("recordUrl").value.trim();if(!url)return toast("URL eingeben.",true);
    if(!(await checkRecorderBridge()))return toast(mobileRecorderUnavailable()?"Aufnahme ist auf Desktop verfügbar.":"Desktop Recorder installieren und diese Seite neu laden.",true);
    try{$("recordStart").disabled=true;const data=await recorderApi().startRecording(url);recordingId=data.id;$("recordFinish").disabled=false;$("recordCancel").disabled=false;$("recordMode").textContent="läuft";pollRecording();toast("Zielseite geöffnet. Jetzt ganz normal bedienen.")}catch(error){$("recordStart").disabled=false;toast(error.message,true)}
  }
  function pollRecording(){
    clearInterval(recordingPoll);const tick=async()=>{if(!recordingId)return;try{const data=await recorderApi().recordingStatus();$("recordActions").textContent=data.actionCount||0;$("recordStates").textContent=(data.actionCount||0)+1;$("recordMode").textContent=data.status||"läuft";if(data.status==="idle"){clearInterval(recordingPoll);recordingPoll=null;recordingId="";$("recordStart").disabled=false;$("recordFinish").disabled=true;$("recordCancel").disabled=true;toast("Recorder-Tab wurde geschlossen.",true)}}catch(_){}};tick();recordingPoll=setInterval(tick,650)
  }
  async function finishRecording(){
    if(!recordingId)return;try{$("recordFinish").disabled=true;$("recordMode").textContent="erstelle Projekt";const data=await recorderApi().finishRecording();clearInterval(recordingPoll);recordingPoll=null;recordingId="";$("recordStart").disabled=false;$("recordCancel").disabled=true;setProject(recorderApi().projectFromRecording(data.recording));switchTab("render");toast("Browserpfad wurde als State-Projekt übernommen.")}catch(error){$("recordFinish").disabled=false;toast(error.message,true)}
  }
  async function cancelRecording(){
    if(recordingId)await recorderApi()?.cancelRecording?.().catch(()=>{});clearInterval(recordingPoll);recordingPoll=null;recordingId="";$("recordStart").disabled=false;$("recordFinish").disabled=true;$("recordCancel").disabled=true;$("recordMode").textContent="bereit"
  }

  async function startReplay(){
    if(!project?.recording?.actions?.length)return toast("Dieses Projekt enthält noch keinen echten Recorder-Ablauf.",true);
    if(!(await checkRecorderBridge()))return toast("Echter Browser-Replay ist auf Desktop mit Recorder verfügbar.",true);
    $("replayStart").disabled=true;$("replayStop").disabled=false;$("replayStatus").textContent="Starte …";replayCancelled=false;
    try{
      const api=recorderApi(),start=await api.startReplay(project.recording.startUrl);replayId=start.id;const actions=project.recording.actions,speed=Math.max(.1,Math.min(8,Number($("replaySpeed").value)||1));
      for(let index=0;index<actions.length;index+=1){if(replayCancelled)break;const action=actions[index],delay=Math.min(30000,Math.max(0,Number(action.delayMs)||0)/speed);if(delay)await new Promise(resolve=>setTimeout(resolve,delay));if(replayCancelled)break;await api.applyReplayAction(replayId,action);$("replayStatus").textContent=`läuft · \${index+1}/\${actions.length}`;if(project.states[index+1]){selection={type:"state",id:project.states[index+1].id};renderGraph();renderInspector();renderApp()}}
      if(!replayCancelled){$("replayStatus").textContent="Fertig";toast("Echter Browser-Replay abgeschlossen.")}
    }catch(error){$("replayStatus").textContent="Fehler";toast(error.message,true)}finally{if(replayId)await recorderApi()?.stopReplay?.(replayId).catch(()=>{});replayId="";$("replayStart").disabled=false;$("replayStop").disabled=true}
  }
  async function stopReplay(){replayCancelled=true;if(replayId)await recorderApi()?.stopReplay?.(replayId).catch(()=>{});replayId="";$("replayStart").disabled=false;$("replayStop").disabled=true;$("replayStatus").textContent="Gestoppt"}

`;

const recorderPattern = /  async function agent\([\s\S]*?\n  function download\(/;
if (!recorderPattern.test(html)) throw new Error("Old recorder function block not found");
html = html.replace(recorderPattern, recorderBlock + "  function download(");

html = html.replace('    $("checkAgent").onclick=checkAgent;$("recordStart").onclick=startRecording;$("recordFinish").onclick=finishRecording;$("recordCancel").onclick=cancelRecording;', '    $("recordStart").onclick=startRecording;$("recordFinish").onclick=finishRecording;$("recordCancel").onclick=cancelRecording;window.addEventListener("zustand-recorder-ready",()=>checkRecorderBridge());');
html = html.replace('switchTab(activeTab);checkAgent();}', 'switchTab(activeTab);checkRecorderBridge();}');

for (const forbidden of ["npm run recorder:agent", "127.0.0.1:8799", "Local Recorder Agent", "async function agent(", 'id="checkAgent"']) {
  if (html.includes(forbidden)) throw new Error(`Legacy recorder UI remains: ${forbidden}`);
}
for (const required of ["ZustandRecorderBridge", "Desktop Recorder", "Aufnahme auf Desktop verfügbar", "recorder-extension/editor-bridge.js"]) {
  if (!html.includes(required)) throw new Error(`Recorder cut missing: ${required}`);
}
fs.writeFileSync(statePath, html);

const smokePath = "server/production-release-smoke.js";
let smoke = fs.readFileSync(smokePath, "utf8");
const smokeAnchor = '  if (!html.includes("App Render")) throw new Error("Production state.html is missing App Render");';
if (!smoke.includes(smokeAnchor)) throw new Error("Production smoke editor anchor missing");
smoke = smoke.replace(smokeAnchor, smokeAnchor + '\n  if (!html.includes("ZUSTAND_EXTENSION_COMMAND")) throw new Error("Production state.html is missing browser recorder bridge");\n  if (!html.includes("Desktop Recorder")) throw new Error("Production state.html is missing Desktop Recorder UX");\n  if (html.includes("npm run recorder:agent") || html.includes("127.0.0.1:8799")) throw new Error("Production state.html exposes developer recorder setup");');
fs.writeFileSync(smokePath, smoke);

try { fs.rmSync("recorder-extension.zip", { force: true }); } catch (_) {}
execFileSync("zip", ["-qr", "recorder-extension.zip", "recorder-extension"]);

console.log("browser-extension recorder cut applied");
