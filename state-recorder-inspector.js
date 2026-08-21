(() => {
  "use strict";

  if (!/\/state\.html$/.test(location.pathname)) return;

  const STORAGE_KEY = "stateBlueprintHotLinked.model.v2";
  const PACKAGE_KEY = STORAGE_KEY + ".externalRecording";
  const PACKAGE_KIND = "state-blueprint-recording-package";
  const API_BASE = "https://realtime.digitalisierungsplanung.de";
  let replayAbort = null;
  let renderQueued = false;

  function readPackage() {
    try {
      const value = JSON.parse(localStorage.getItem(PACKAGE_KEY) || "null");
      if (!value || value.kind !== PACKAGE_KIND || !value.definition?.model || !value.recording) return null;
      return value;
    } catch (_) {
      return null;
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char]));
  }

  function actionTitle(action = {}) {
    const target = String(action.target?.label || action.selector || "").trim();
    if (action.type === "click") return target ? "Klick auf " + target : "Klick";
    if (action.type === "input") return action.redacted ? "Geschützte Eingabe" : target ? "Text in " + target : "Texteingabe";
    if (action.type === "key") return "Taste " + String(action.key || "");
    if (action.type === "scroll") return Number(action.deltaY) < 0 ? "Scroll nach oben" : "Scroll nach unten";
    if (action.type === "navigate") return "Navigation zu " + String(action.url || "");
    return "Aktion";
  }

  function actionMeta(action = {}) {
    const chunks = [];
    if (action.selector) chunks.push("Selector " + action.selector);
    if (Number.isFinite(Number(action.x)) && Number.isFinite(Number(action.y))) chunks.push("Position " + Math.round(Number(action.x)) + ", " + Math.round(Number(action.y)));
    if (action.key) chunks.push("Taste " + action.key);
    if (Number.isFinite(Number(action.deltaY)) && action.type === "scroll") chunks.push("ΔY " + Math.round(Number(action.deltaY)));
    if (action.redacted) chunks.push("Wert absichtlich nicht gespeichert");
    return chunks.join(" · ");
  }

  function packageSessionId(pkg) {
    return String(pkg?.sessionId || pkg?.recording?.sessionId || "").trim();
  }

  function packageModel(pkg) {
    return pkg?.definition?.model && typeof pkg.definition.model === "object" ? pkg.definition.model : { states: [], transitions: [] };
  }

  function stateStep(pkg, stateId) {
    const model = packageModel(pkg);
    const states = Array.isArray(model.states) ? model.states : [];
    const transitions = Array.isArray(model.transitions) ? model.transitions : [];
    const actions = Array.isArray(pkg?.recording?.actions) ? pkg.recording.actions : [];
    const stateIndex = states.findIndex(state => state?.id === stateId);
    const transitionIndex = transitions.findIndex(transition => transition?.from === stateId);
    const transition = transitionIndex >= 0 ? transitions[transitionIndex] : null;
    const action = transitionIndex >= 0 ? actions[transitionIndex] || null : null;
    const toState = transition ? states.find(state => state?.id === transition.to) || null : null;
    return { model, states, transitions, actions, stateIndex, transitionIndex, transition, action, toState };
  }

  function downloadJson(name, payload) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function setReplayStatus(card, text, state = "") {
    const status = card?.querySelector("[data-recording-status]");
    if (!status) return;
    status.textContent = text;
    status.dataset.state = state;
  }

  async function playReplay(pkg, card) {
    const sessionId = packageSessionId(pkg);
    if (!sessionId) {
      setReplayStatus(card, "Kein Recorder-Session-Link im Paket. Timeline und Export bleiben vollständig verfügbar.", "error");
      return;
    }
    replayAbort?.abort();
    const controller = new AbortController();
    replayAbort = controller;
    const play = card.querySelector("[data-recording-play]");
    const stop = card.querySelector("[data-recording-stop]");
    if (play) play.disabled = true;
    if (stop) stop.disabled = false;
    setReplayStatus(card, "Echter Website-Replay läuft …", "running");
    try {
      const response = await fetch(API_BASE + "/recorder/sessions/" + encodeURIComponent(sessionId) + "/replay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || ("HTTP " + response.status));
      const suffix = data.url ? " · " + data.url : "";
      setReplayStatus(card, "Replay fertig: " + Number(data.actionCount || 0) + " echte Actions" + suffix, "ok");
    } catch (error) {
      if (error?.name === "AbortError") setReplayStatus(card, "Replay-Anfrage gestoppt.", "idle");
      else setReplayStatus(card, "Replay nicht verfügbar: " + String(error?.message || error), "error");
    } finally {
      if (replayAbort === controller) replayAbort = null;
      if (play) play.disabled = false;
      if (stop) stop.disabled = true;
    }
  }

  function timelineHtml(step) {
    if (!step.actions.length) return '<div class="recording-empty">Keine aufgezeichneten Actions.</div>';
    return step.actions.map((action, index) => {
      const transition = step.transitions[index] || null;
      const active = index === step.transitionIndex;
      const delay = Math.round(Number(transition?.timerMs ?? action?.delayMs) || 0);
      const route = transition ? transition.from + " → " + transition.to : "Schritt " + (index + 1);
      return '<div class="recording-timeline-item' + (active ? " active" : "") + '">' +
        '<span class="recording-timeline-index">' + (index + 1) + '</span>' +
        '<span class="recording-timeline-copy"><strong>' + escapeHtml(actionTitle(action)) + '</strong><small>' + escapeHtml(route) + '</small></span>' +
        '<span class="recording-timeline-delay">+' + delay + ' ms</span>' +
      '</div>';
    }).join("");
  }

  function buildCard(pkg, stateId) {
    const step = stateStep(pkg, stateId);
    if (step.stateIndex < 0) return null;

    const card = document.createElement("details");
    card.className = "inspector-collapse recorded-replay-card";
    card.id = "pRecordedReplayCard";
    card.open = true;
    card.dataset.recordingStateId = stateId;

    const currentTitle = step.states[step.stateIndex]?.title || stateId;
    const nextTitle = step.toState?.title || step.transition?.to || "Ende";
    const delay = Math.round(Number(step.transition?.timerMs ?? step.action?.delayMs) || 0);
    const currentAction = step.action ? actionTitle(step.action) : "Endzustand";
    const meta = step.action ? actionMeta(step.action) : "Kein weiterer aufgezeichneter Schritt.";
    const sessionId = packageSessionId(pkg);

    card.innerHTML = `
      <summary class="inspector-collapse-summary">
        <span class="inspector-collapse-title">
          <span>Aufgezeichneter Ablauf</span>
          <span>echte Action + Timing, getrennt vom State-Contract</span>
        </span>
      </summary>
      <div class="inspector-collapse-body">
        <div class="recording-route">
          <span>Schritt ${step.stateIndex + 1}/${step.states.length}</span>
          <strong>${escapeHtml(currentTitle)}${step.transition ? " → " + escapeHtml(nextTitle) : " · Ende"}</strong>
        </div>
        <div class="recording-action-card${step.action ? "" : " terminal"}">
          <div>
            <strong>${escapeHtml(currentAction)}</strong>
            <small>${escapeHtml(meta)}</small>
          </div>
          <span>${step.action ? "+" + delay + " ms" : "Ende"}</span>
        </div>
        <div class="recording-controls">
          <button type="button" data-recording-play${sessionId ? "" : " disabled"}>Replay ab Start</button>
          <button type="button" data-recording-stop disabled>Stop</button>
          <button type="button" data-recording-export>Replay exportieren</button>
        </div>
        <div class="condition-preview${sessionId ? " ok" : " empty"}" data-recording-status>${sessionId ? "Recorder-Session verknüpft · echter Website-Replay verfügbar." : "Timeline/Export verfügbar · Recorder-Session-Link fehlt."}</div>
        <details class="inspector-collapse inspector-subcollapse recording-timeline" open>
          <summary class="inspector-collapse-summary">
            <span class="inspector-collapse-title"><span>Timeline</span><span>${step.actions.length} echte Actions</span></span>
          </summary>
          <div class="inspector-collapse-body">${timelineHtml(step)}</div>
        </details>
      </div>
    `;

    card.querySelector("[data-recording-play]")?.addEventListener("click", () => playReplay(pkg, card));
    card.querySelector("[data-recording-stop]")?.addEventListener("click", () => {
      replayAbort?.abort();
    });
    card.querySelector("[data-recording-export]")?.addEventListener("click", () => {
      downloadJson("website-replay-actions.json", pkg.recording);
      setReplayStatus(card, "Replay-Actions exportiert.", "ok");
    });
    return card;
  }

  function installStyles() {
    if (document.getElementById("stateRecorderInspectorStyles")) return;
    const style = document.createElement("style");
    style.id = "stateRecorderInspectorStyles";
    style.textContent = `
      .recorded-replay-card .recording-route{display:grid;gap:3px;padding:9px 10px;border:1px solid rgba(56,189,248,.24);border-radius:10px;background:rgba(56,189,248,.06)}
      .recorded-replay-card .recording-route span{font-size:11px;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:.04em}
      .recorded-replay-card .recording-route strong{font-size:12px;overflow-wrap:anywhere}
      .recorded-replay-card .recording-action-card{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-top:8px;padding:10px;border:1px solid rgba(52,211,153,.34);border-radius:10px;background:rgba(52,211,153,.07)}
      .recorded-replay-card .recording-action-card.terminal{border-color:rgba(142,178,220,.25);background:rgba(142,178,220,.05)}
      .recorded-replay-card .recording-action-card>div{display:grid;gap:3px;min-width:0}
      .recorded-replay-card .recording-action-card strong{font-size:13px;overflow-wrap:anywhere}
      .recorded-replay-card .recording-action-card small{color:var(--muted);font-size:11px;overflow-wrap:anywhere}
      .recorded-replay-card .recording-action-card>span{flex:0 0 auto;color:#bbf7d0;font:800 11px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
      .recorded-replay-card .recording-controls{display:grid;grid-template-columns:1fr auto;gap:7px;margin-top:8px}
      .recorded-replay-card .recording-controls [data-recording-export]{grid-column:1/-1}
      .recorded-replay-card [data-recording-status][data-state="error"]{border-color:rgba(251,113,133,.42);color:#fecdd3}
      .recorded-replay-card [data-recording-status][data-state="running"]{border-color:rgba(245,158,11,.48);color:#fde68a}
      .recorded-replay-card .recording-timeline{margin-top:8px}
      .recorded-replay-card .recording-timeline .inspector-collapse-body{display:grid;gap:5px}
      .recorded-replay-card .recording-timeline-item{display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:7px;align-items:center;padding:7px;border:1px solid rgba(49,95,140,.35);border-radius:8px;background:#071321}
      .recorded-replay-card .recording-timeline-item.active{border-color:rgba(245,158,11,.72);box-shadow:inset 3px 0 0 #f59e0b}
      .recorded-replay-card .recording-timeline-index{display:grid;place-items:center;width:22px;height:22px;border:1px solid rgba(142,178,220,.3);border-radius:999px;color:var(--muted);font-size:10px;font-weight:850}
      .recorded-replay-card .recording-timeline-copy{display:grid;gap:1px;min-width:0}
      .recorded-replay-card .recording-timeline-copy strong{font-size:11px;overflow-wrap:anywhere}
      .recorded-replay-card .recording-timeline-copy small{font-size:10px;color:var(--muted);overflow-wrap:anywhere}
      .recorded-replay-card .recording-timeline-delay{font:800 10px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#bfdbfe;white-space:nowrap}
      .recorded-replay-card .recording-empty{padding:8px;color:var(--muted);font-size:11px}
    `;
    document.head.appendChild(style);
  }

  function renderIntoInspector() {
    const pkg = readPackage();
    const root = document.getElementById("stateInspectorBody");
    if (!root) return;
    const oldCard = root.querySelector("#pRecordedReplayCard");
    if (!pkg) {
      oldCard?.remove();
      return;
    }
    const stateId = String(root.querySelector(".state-id-line b")?.textContent || "").trim();
    if (!stateId) {
      oldCard?.remove();
      return;
    }
    if (oldCard?.dataset.recordingStateId === stateId) return;
    oldCard?.remove();
    const card = buildCard(pkg, stateId);
    if (!card) return;
    const flowCard = root.querySelector("#pFlowCard");
    const renderCard = root.querySelector("#pRenderCard");
    if (flowCard) flowCard.insertAdjacentElement("afterend", card);
    else if (renderCard) renderCard.insertAdjacentElement("beforebegin", card);
    else root.appendChild(card);
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    queueMicrotask(() => {
      renderQueued = false;
      renderIntoInspector();
    });
  }

  function start() {
    installStyles();
    const root = document.getElementById("stateInspectorBody");
    if (!root) {
      requestAnimationFrame(start);
      return;
    }
    const observer = new MutationObserver(queueRender);
    observer.observe(root, { childList: true, subtree: true });
    window.addEventListener("storage", event => {
      if (event.key === PACKAGE_KEY) queueRender();
    });
    queueRender();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
