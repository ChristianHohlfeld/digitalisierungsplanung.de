"use strict";

(() => {
  const DB_NAME = "zustand-product";
  const DB_STORE = "projects";
  const LAST_KEY = "zustand.last-project";
  const OPS = ["==", "!=", ">", ">=", "<", "<=", "truthy", "falsy"];

  let project = null;
  let selection = null;
  let activeTab = "recorder";
  let recordingId = "";
  let recordingPoll = null;
  let replayId = "";
  let replayCancelled = false;
  let saveTimer = null;

  const $ = id => document.getElementById(id);
  const clone = value => JSON.parse(JSON.stringify(value));
  const uid = prefix => `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
  const esc = value => String(value ?? "").replace(/[&<>\"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

  function toast(message, bad = false) {
    const node = $("toast");
    node.textContent = message;
    node.className = "toast show" + (bad ? " bad" : "");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.className = "toast", 3200);
  }

  function defaultProject() {
    return {
      kind: "zustand-project",
      version: 1,
      id: uid("project"),
      name: "Neues Projekt",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startStateId: "state_001",
      states: [
        { id: "state_001", title: "Start", x: 80, y: 90, trigger: { type: "interaction", eventName: "", timerMs: 0 }, fields: [], snapshot: { url: "", title: "Start", image: "" } },
        { id: "state_002", title: "Ziel", x: 360, y: 90, trigger: { type: "auto", eventName: "", timerMs: 0 }, fields: [], snapshot: { url: "", title: "Ziel", image: "" } }
      ],
      transitions: [
        { id: "transition_001", from: "state_001", to: "state_002", label: "Weiter", listener: { type: "click", selector: "" }, rules: { join: "and", items: [] }, replay: { delayMs: 300 } }
      ],
      recording: null
    };
  }

  function normalizeProject(value) {
    if (!value || value.kind !== "zustand-project" || !Array.isArray(value.states) || !Array.isArray(value.transitions)) throw new Error("Kein Zustand-Projekt");
    const next = clone(value);
    next.version = 1;
    next.id ||= uid("project");
    next.name ||= "Projekt";
    next.startStateId ||= next.states[0]?.id || "";
    next.states.forEach((state, index) => {
      state.id ||= `state_${String(index + 1).padStart(3, "0")}`;
      state.title ||= state.id;
      state.x = Number.isFinite(Number(state.x)) ? Number(state.x) : 80 + (index % 4) * 240;
      state.y = Number.isFinite(Number(state.y)) ? Number(state.y) : 80 + Math.floor(index / 4) * 150;
      state.trigger ||= { type: "auto", eventName: "", timerMs: 0 };
      state.fields = Array.isArray(state.fields) ? state.fields : [];
      state.snapshot ||= { url: "", title: "", image: "" };
    });
    next.transitions.forEach((transition, index) => {
      transition.id ||= `transition_${String(index + 1).padStart(3, "0")}`;
      transition.label ||= "Weiter";
      transition.listener ||= { type: "auto" };
      transition.rules ||= { join: "and", items: [] };
      transition.rules.join = transition.rules.join === "or" ? "or" : "and";
      transition.rules.items = Array.isArray(transition.rules.items) ? transition.rules.items : [];
      transition.replay ||= { delayMs: 300 };
    });
    return next;
  }

  function dbOpen() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function dbPut(value) {
    const db = await dbOpen();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(value);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  async function dbGet(id) {
    const db = await dbOpen();
    const value = await new Promise((resolve, reject) => {
      const request = db.transaction(DB_STORE).objectStore(DB_STORE).get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return value;
  }

  function scheduleSave() {
    if (!project) return;
    project.updatedAt = new Date().toISOString();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await dbPut(project);
        localStorage.setItem(LAST_KEY, project.id);
      } catch (_) {}
    }, 180);
  }

  function setProject(next) {
    project = normalizeProject(next);
    $("projectName").value = project.name;
    selection = project.states[0] ? { type: "state", id: project.startStateId || project.states[0].id } : null;
    scheduleSave();
    renderAll();
  }

  const stateById = id => project?.states.find(state => state.id === id) || null;
  const transitionById = id => project?.transitions.find(item => item.id === id) || null;
  const selectedState = () => selection?.type === "state" ? stateById(selection.id) : selection?.type === "transition" ? stateById(transitionById(selection.id)?.from) : null;

  function switchTab(name) {
    activeTab = name === "render" ? "render" : "recorder";
    $("tabRecorder").classList.toggle("active", activeTab === "recorder");
    $("tabRender").classList.toggle("active", activeTab === "render");
    $("paneRecorder").classList.toggle("active", activeTab === "recorder");
    $("paneRender").classList.toggle("active", activeTab === "render");
    const url = new URL(location.href);
    url.searchParams.set("tab", activeTab);
    history.replaceState(null, "", url);
    if (activeTab === "render") renderApp();
  }

  function renderAll() {
    renderGraph();
    renderInspector();
    renderApp();
    $("chartSummary").textContent = `${project.states.length} States · ${project.transitions.length} Transitions`;
  }

  function renderGraph() {
    const nodes = $("nodes");
    const edges = $("edges");
    nodes.innerHTML = "";
    edges.innerHTML = "";

    for (const transition of project.transitions) {
      const from = stateById(transition.from);
      const to = stateById(transition.to);
      if (!from || !to) continue;
      drawEdge(edges, transition, from.x, from.y, to.x, to.y);
    }

    for (const state of project.states) {
      const node = document.createElement("div");
      node.className = "node" + (selection?.type === "state" && selection.id === state.id ? " selected" : "");
      node.style.left = `${state.x}px`;
      node.style.top = `${state.y}px`;
      node.dataset.id = state.id;
      node.innerHTML = `<div class="node-head">${esc(state.title)}</div><div class="node-meta"><span class="dot"></span>${esc(state.trigger?.type || "auto")} · ${esc(state.id)}</div>${state.snapshot?.image ? `<img class="thumb" src="${state.snapshot.image}" alt="">` : ""}`;
      node.addEventListener("click", event => {
        if (event.defaultPrevented) return;
        selection = { type: "state", id: state.id };
        renderAll();
      });
      node.querySelector(".node-head").addEventListener("pointerdown", event => startDrag(event, state, node));
      nodes.appendChild(node);
    }
  }

  function drawEdge(root, transition, fromX, fromY, toX, toY) {
    const x1 = fromX + 192;
    const y1 = fromY + 43;
    const x2 = toX;
    const y2 = toY + 43;
    const ns = "http://www.w3.org/2000/svg";
    const group = document.createElementNS(ns, "g");
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", x1);
    line.setAttribute("y1", y1);
    line.setAttribute("x2", x2);
    line.setAttribute("y2", y2);
    line.setAttribute("stroke", selection?.type === "transition" && selection.id === transition.id ? "#38bdf8" : "#44657f");
    line.setAttribute("stroke-width", "2");
    group.appendChild(line);
    const hit = document.createElementNS(ns, "line");
    for (const [key, value] of Object.entries({ x1, y1, x2, y2 })) hit.setAttribute(key, value);
    hit.setAttribute("stroke", "transparent");
    hit.setAttribute("stroke-width", "18");
    hit.setAttribute("class", "edge-hit");
    hit.addEventListener("click", () => {
      selection = { type: "transition", id: transition.id };
      renderAll();
    });
    group.appendChild(hit);
    const text = document.createElementNS(ns, "text");
    text.setAttribute("x", (x1 + x2) / 2);
    text.setAttribute("y", (y1 + y2) / 2 - 7);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "#9fc5df");
    text.setAttribute("font-size", "11");
    text.setAttribute("pointer-events", "none");
    text.textContent = transition.label || transition.listener?.type || "→";
    group.appendChild(text);
    root.appendChild(group);
  }

  function startDrag(event, state, node) {
    event.preventDefault();
    event.stopPropagation();
    selection = { type: "state", id: state.id };
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = state.x;
    const originY = state.y;
    node.setPointerCapture(event.pointerId);
    node.classList.add("selected");
    const move = e => {
      state.x = Math.max(0, Math.round((originX + e.clientX - startX) / 12) * 12);
      state.y = Math.max(0, Math.round((originY + e.clientY - startY) / 12) * 12);
      node.style.left = `${state.x}px`;
      node.style.top = `${state.y}px`;
      renderEdgesOnly();
    };
    const up = e => {
      node.releasePointerCapture(e.pointerId);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      scheduleSave();
      renderAll();
    };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
  }

  function renderEdgesOnly() {
    const positions = new Map([...$("nodes").children].map(node => [node.dataset.id, { x: parseFloat(node.style.left), y: parseFloat(node.style.top) }]));
    const edges = $("edges");
    edges.innerHTML = "";
    for (const transition of project.transitions) {
      const from = positions.get(transition.from);
      const to = positions.get(transition.to);
      if (from && to) drawEdge(edges, transition, from.x, from.y, to.x, to.y);
    }
  }

  function selectHtml(id, items, value) {
    return `<select class="select" id="${id}">${items.map(item => `<option value="${esc(item.value)}"${item.value === value ? " selected" : ""}>${esc(item.label)}</option>`).join("")}</select>`;
  }

  function inputHtml(id, value, type = "text") {
    return `<input class="input" id="${id}" type="${type}" value="${esc(value ?? "")}">`;
  }

  function renderInspector() {
    const root = $("inspector");
    root.innerHTML = "";
    if (!selection) {
      root.innerHTML = '<div class="empty">State oder Transition auswählen.</div>';
      $("selectionLabel").textContent = "Nichts ausgewählt";
      return;
    }
    if (selection.type === "state") renderStateInspector(root, stateById(selection.id));
    else renderTransitionInspector(root, transitionById(selection.id));
  }

  function renderStateInspector(root, state) {
    if (!state) return;
    $("selectionLabel").textContent = `State · ${state.id}`;
    const base = document.createElement("div");
    base.className = "group";
    base.innerHTML = `<h3>State</h3><label class="field"><span>Titel</span>${inputHtml("stateTitle", state.title)}</label><label class="field"><span>Trigger</span>${selectHtml("stateTrigger", [
      { value: "interaction", label: "Interaktion" },
      { value: "timer", label: "Timer" },
      { value: "event", label: "Event / Webhook" },
      { value: "auto", label: "Auto" }
    ], state.trigger?.type || "auto")}</label><div id="stateTriggerDetail"></div>`;
    root.appendChild(base);

    $("stateTitle").addEventListener("input", event => {
      state.title = event.target.value;
      renderGraph();
      renderApp();
      scheduleSave();
    });
    $("stateTrigger").addEventListener("change", event => {
      state.trigger = { ...(state.trigger || {}), type: event.target.value };
      renderInspector();
      renderGraph();
      scheduleSave();
    });

    const detail = $("stateTriggerDetail");
    if (state.trigger?.type === "timer") {
      detail.innerHTML = `<label class="field"><span>Delay ms</span>${inputHtml("stateTimer", state.trigger.timerMs || 0, "number")}</label>`;
      $("stateTimer").addEventListener("input", event => {
        state.trigger.timerMs = Math.max(0, Number(event.target.value) || 0);
        scheduleSave();
      });
    } else if (state.trigger?.type === "event") {
      detail.innerHTML = `<label class="field"><span>Event / Webhook</span>${inputHtml("stateEvent", state.trigger.eventName || "")}</label>`;
      $("stateEvent").addEventListener("input", event => {
        state.trigger.eventName = event.target.value;
        scheduleSave();
      });
    }

    const fields = document.createElement("div");
    fields.className = "group";
    fields.innerHTML = `<h3>Daten dieses States</h3><div class="row">${state.fields.length ? state.fields.map(field => `<span class="pill mono">${esc(field.label)} · ${esc(field.property)}</span>`).join("") : '<span class="muted small">Inputs und Checkboxen aus Aufnahmen erscheinen automatisch hier.</span>'}</div>`;
    root.appendChild(fields);

    const targets = project.states.filter(item => item.id !== state.id);
    const outgoing = document.createElement("div");
    outgoing.className = "group";
    outgoing.innerHTML = `<h3>Ausgehende Transition</h3><div class="row">${targets.length ? selectHtml("newTarget", targets.map(item => ({ value: item.id, label: item.title })), targets[0].id) : '<span class="muted">Erst weiteren State anlegen.</span>'}${targets.length ? '<button class="btn" id="addTransition">+ Transition</button>' : ""}</div>`;
    root.appendChild(outgoing);
    if (targets.length) {
      $("addTransition").onclick = () => {
        const id = uid("transition");
        project.transitions.push({ id, from: state.id, to: $("newTarget").value, label: "Weiter", listener: defaultListenerForContext(state.trigger?.type), rules: { join: "and", items: [] }, replay: { delayMs: 300 } });
        selection = { type: "transition", id };
        scheduleSave();
        renderAll();
      };
    }

    const danger = document.createElement("div");
    danger.className = "group";
    danger.innerHTML = '<button class="btn danger" id="deleteState">State löschen</button>';
    root.appendChild(danger);
    $("deleteState").onclick = () => deleteState(state.id);
  }

  function defaultListenerForContext(context) {
    if (context === "timer") return { type: "timer" };
    if (context === "event") return { type: "event", event: "" };
    if (context === "auto") return { type: "auto" };
    return { type: "click", selector: "" };
  }

  function listenerTypes(context) {
    if (context === "timer") return [{ value: "timer", label: "Timer-Ende" }];
    if (context === "event") return [{ value: "event", label: "Event" }];
    if (context === "auto") return [{ value: "auto", label: "Auto" }];
    return [
      { value: "click", label: "Klick" },
      { value: "input", label: "Input" },
      { value: "change", label: "Änderung" },
      { value: "key", label: "Taste" },
      { value: "scroll", label: "Scroll" },
      { value: "navigate", label: "Navigation" }
    ];
  }

  function renderTransitionInspector(root, transition) {
    if (!transition) return;
    const from = stateById(transition.from);
    const to = stateById(transition.to);
    $("selectionLabel").textContent = `Transition · ${transition.id}`;
    const context = from?.trigger?.type || "auto";
    const allowed = listenerTypes(context);
    if (!allowed.some(item => item.value === transition.listener?.type)) transition.listener = defaultListenerForContext(context);

    const base = document.createElement("div");
    base.className = "group";
    base.innerHTML = `<h3>Transition</h3><div class="small muted">${esc(from?.title || transition.from)} → ${esc(to?.title || transition.to)}</div><label class="field"><span>Label</span>${inputHtml("transitionLabel", transition.label)}</label><label class="field"><span>Lauscht auf</span>${selectHtml("listenerType", allowed, transition.listener.type)}</label><div id="listenerDetail"></div>`;
    root.appendChild(base);
    $("transitionLabel").addEventListener("input", event => {
      transition.label = event.target.value;
      renderGraph();
      scheduleSave();
    });
    $("listenerType").addEventListener("change", event => {
      transition.listener = { type: event.target.value };
      renderInspector();
      scheduleSave();
    });

    const detail = $("listenerDetail");
    const type = transition.listener.type;
    if (["click", "input", "change"].includes(type)) {
      detail.innerHTML = `<label class="field"><span>Element</span>${inputHtml("listenerSelector", transition.listener.selector || "")}</label>`;
      $("listenerSelector").addEventListener("input", event => { transition.listener.selector = event.target.value; scheduleSave(); });
    } else if (type === "key") {
      detail.innerHTML = `<label class="field"><span>Taste</span>${inputHtml("listenerKey", transition.listener.key || "Enter")}</label>`;
      $("listenerKey").addEventListener("input", event => { transition.listener.key = event.target.value; scheduleSave(); });
    } else if (type === "event") {
      detail.innerHTML = `<label class="field"><span>Event</span>${inputHtml("listenerEvent", transition.listener.event || from?.trigger?.eventName || "")}</label>`;
      $("listenerEvent").addEventListener("input", event => { transition.listener.event = event.target.value; scheduleSave(); });
    } else if (type === "navigate") {
      detail.innerHTML = `<label class="field"><span>URL</span>${inputHtml("listenerUrl", transition.listener.url || "", "url")}</label>`;
      $("listenerUrl").addEventListener("input", event => { transition.listener.url = event.target.value; scheduleSave(); });
    }

    const rules = document.createElement("div");
    rules.className = "group";
    rules.innerHTML = '<div class="row"><h3>Filter / Regeln</h3><span class="spacer"></span><select class="select" id="ruleJoin"><option value="and">UND</option><option value="or">ODER</option></select></div><div class="small muted">Welche Daten oder Eventwerte soll diese Kante beachten?</div><div class="rule-head"><span>Feld</span><span>Operator</span><span>Wert</span><span></span></div><div id="ruleRows"></div><button class="btn" id="addRule">+ Regel</button>';
    root.appendChild(rules);
    $("ruleJoin").value = transition.rules?.join || "and";
    $("ruleJoin").onchange = event => { transition.rules.join = event.target.value; scheduleSave(); };
    renderRuleRows(transition);
    $("addRule").onclick = () => {
      transition.rules.items.push({ field: firstRuleField(transition.from), operator: "==", value: "" });
      renderInspector();
      scheduleSave();
    };

    const actions = document.createElement("div");
    actions.className = "group";
    actions.innerHTML = '<button class="btn danger" id="deleteTransition">Transition löschen</button>';
    root.appendChild(actions);
    $("deleteTransition").onclick = () => {
      project.transitions = project.transitions.filter(item => item.id !== transition.id);
      selection = from ? { type: "state", id: from.id } : null;
      scheduleSave();
      renderAll();
    };
  }

  function ruleFields(sourceStateId) {
    const states = [...project.states].sort((a, b) => (a.id === sourceStateId ? -1 : b.id === sourceStateId ? 1 : 0));
    const out = [];
    for (const state of states) {
      for (const field of state.fields || []) out.push({ value: field.path, label: `${state.title} · ${field.label} · ${field.property}`, type: field.type || "text" });
    }
    out.push(
      { value: "event.payload.type", label: "Event · payload.type", type: "text" },
      { value: "event.payload.value", label: "Event · payload.value", type: "text" },
      { value: "event.payload.id", label: "Event · payload.id", type: "text" }
    );
    return out;
  }

  function firstRuleField(sourceStateId) {
    return ruleFields(sourceStateId)[0]?.value || "event.payload.value";
  }

  function fieldMeta(sourceStateId, path) {
    return ruleFields(sourceStateId).find(item => item.value === path) || null;
  }

  function renderRuleRows(transition) {
    const root = $("ruleRows");
    root.innerHTML = "";
    const fields = ruleFields(transition.from);
    for (const [index, rule] of transition.rules.items.entries()) {
      const row = document.createElement("div");
      row.className = "rule-row";
      const meta = fieldMeta(transition.from, rule.field);
      const noValue = ["truthy", "falsy"].includes(rule.operator);
      const valueControl = noValue
        ? '<input class="input value" value="–" disabled>'
        : meta?.type === "boolean"
          ? selectHtml(`ruleValue_${index}`, [{ value: "true", label: "an / true" }, { value: "false", label: "aus / false" }], String(rule.value || "true"))
          : `<input class="input value" id="ruleValue_${index}" value="${esc(rule.value ?? "")}">`;
      row.innerHTML = `${selectHtml(`ruleField_${index}`, fields.length ? fields : [{ value: rule.field || "event.payload.value", label: rule.field || "event.payload.value" }], rule.field)}${selectHtml(`ruleOp_${index}`, OPS.map(op => ({ value: op, label: op === "truthy" ? "ist wahr" : op === "falsy" ? "ist falsch" : op })), rule.operator || "==")}${valueControl}<button class="btn danger" id="ruleDelete_${index}" title="Regel löschen">×</button>`;
      root.appendChild(row);
      $(`ruleField_${index}`).onchange = event => { rule.field = event.target.value; renderInspector(); scheduleSave(); };
      $(`ruleOp_${index}`).onchange = event => { rule.operator = event.target.value; renderInspector(); scheduleSave(); };
      const value = $(`ruleValue_${index}`);
      if (value && !noValue) value.oninput = event => { rule.value = event.target.value; scheduleSave(); };
      $(`ruleDelete_${index}`).onclick = () => { transition.rules.items.splice(index, 1); renderInspector(); scheduleSave(); };
    }
  }

  function deleteState(id) {
    if (project.states.length <= 1) return toast("Mindestens ein State bleibt bestehen.", true);
    project.states = project.states.filter(state => state.id !== id);
    project.transitions = project.transitions.filter(transition => transition.from !== id && transition.to !== id);
    if (project.startStateId === id) project.startStateId = project.states[0].id;
    selection = { type: "state", id: project.states[0].id };
    scheduleSave();
    renderAll();
  }

  function addState() {
    const id = uid("state");
    const index = project.states.length;
    project.states.push({ id, title: "Neuer State", x: 80 + (index % 4) * 240, y: 80 + Math.floor(index / 4) * 150, trigger: { type: "auto", eventName: "", timerMs: 0 }, fields: [], snapshot: { url: "", title: "", image: "" } });
    selection = { type: "state", id };
    scheduleSave();
    renderAll();
  }

  function renderApp() {
    const frame = $("appFrame");
    const state = selectedState() || stateById(project?.startStateId);
    if (!state) {
      frame.innerHTML = '<div class="app-empty">Kein State.</div>';
      return;
    }
    if (state.snapshot?.image) {
      frame.innerHTML = `<img src="${state.snapshot.image}" alt="${esc(state.title)}"><div class="frame-caption"><b>${esc(state.title)}</b>${state.snapshot.url ? ` · ${esc(state.snapshot.url)}` : ""}</div>`;
    } else {
      frame.innerHTML = `<div class="app-empty"><b>${esc(state.title)}</b><br><span class="muted">Dieser manuelle State hat noch keinen aufgenommenen Snapshot.</span></div>`;
    }
  }

  function moveState(delta) {
    const state = selectedState() || stateById(project.startStateId);
    if (!state) return;
    const index = project.states.findIndex(item => item.id === state.id);
    const next = project.states[Math.max(0, Math.min(project.states.length - 1, index + delta))];
    if (next) {
      selection = { type: "state", id: next.id };
      renderAll();
    }
  }

  const recorderApi = () => window.ZustandRecorderBridge;
  const mobileRecorderUnavailable = () => recorderApi()?.isMobile?.() === true;

  async function checkRecorderBridge() {
    const api = recorderApi();
    const dot = $("recorderDot");
    const status = $("recorderStatus");
    const kind = $("recorderKind");
    const install = $("installRecorder");
    dot.className = "status-dot busy";
    status.textContent = "Recorder wird geprüft …";
    try {
      if (!api) throw new Error("missing");
      await api.ping(900);
      dot.className = "status-dot ok";
      status.textContent = "Recorder bereit";
      kind.textContent = "Browser Extension";
      install.hidden = true;
      $("recordStart").disabled = false;
      $("recorderHelp").textContent = "Zielseite öffnen, normal bedienen, fertig. Zustand zeichnet den echten Browserpfad im Hintergrund auf.";
      return true;
    } catch (_) {
      dot.className = "status-dot";
      kind.textContent = "Desktop Recorder";
      if (mobileRecorderUnavailable()) {
        status.textContent = "Aufnahme auf Desktop verfügbar";
        install.hidden = true;
        $("recordStart").disabled = true;
        $("recorderHelp").textContent = "Auf dem Smartphone bleibt der Editor vollständig nutzbar. Neue Browserpfade werden auf Desktop aufgenommen und erscheinen danach als normales Projekt.";
      } else {
        status.textContent = "Desktop Recorder nicht installiert";
        install.hidden = false;
        $("recordStart").disabled = false;
        $("recorderHelp").textContent = "Für echte Browser-Aufnahmen einmal den Desktop Recorder installieren. Danach öffnet Zustand jede öffentliche oder interne URL direkt im normalen Browser-Tab.";
      }
      return false;
    }
  }

  async function startRecording() {
    const url = $("recordUrl").value.trim();
    if (!url) return toast("URL eingeben.", true);
    if (!(await checkRecorderBridge())) return toast(mobileRecorderUnavailable() ? "Aufnahme ist auf Desktop verfügbar." : "Desktop Recorder installieren und diese Seite neu laden.", true);
    try {
      $("recordStart").disabled = true;
      const data = await recorderApi().startRecording(url);
      recordingId = data.id;
      $("recordFinish").disabled = false;
      $("recordCancel").disabled = false;
      $("recordMode").textContent = "läuft";
      pollRecording();
      toast("Zielseite geöffnet. Jetzt ganz normal bedienen.");
    } catch (error) {
      $("recordStart").disabled = false;
      toast(error.message, true);
    }
  }

  function pollRecording() {
    clearInterval(recordingPoll);
    const tick = async () => {
      if (!recordingId) return;
      try {
        const data = await recorderApi().recordingStatus();
        $("recordActions").textContent = data.actionCount || 0;
        $("recordStates").textContent = (data.actionCount || 0) + 1;
        $("recordMode").textContent = data.status || "läuft";
        if (data.status === "idle") {
          clearInterval(recordingPoll);
          recordingPoll = null;
          recordingId = "";
          $("recordStart").disabled = false;
          $("recordFinish").disabled = true;
          $("recordCancel").disabled = true;
          toast("Recorder-Tab wurde geschlossen.", true);
        }
      } catch (_) {}
    };
    tick();
    recordingPoll = setInterval(tick, 650);
  }

  async function finishRecording() {
    if (!recordingId) return;
    try {
      $("recordFinish").disabled = true;
      $("recordMode").textContent = "erstelle Projekt";
      const data = await recorderApi().finishRecording();
      clearInterval(recordingPoll);
      recordingPoll = null;
      recordingId = "";
      $("recordStart").disabled = false;
      $("recordCancel").disabled = true;
      setProject(recorderApi().projectFromRecording(data.recording));
      switchTab("render");
      toast("Browserpfad wurde als State-Projekt übernommen.");
    } catch (error) {
      $("recordFinish").disabled = false;
      toast(error.message, true);
    }
  }

  async function cancelRecording() {
    if (recordingId) await recorderApi()?.cancelRecording?.().catch(() => {});
    clearInterval(recordingPoll);
    recordingPoll = null;
    recordingId = "";
    $("recordStart").disabled = false;
    $("recordFinish").disabled = true;
    $("recordCancel").disabled = true;
    $("recordMode").textContent = "bereit";
  }

  async function startReplay() {
    if (!project?.recording?.actions?.length) return toast("Dieses Projekt enthält noch keinen echten Recorder-Ablauf.", true);
    if (!(await checkRecorderBridge())) return toast("Echter Browser-Replay ist auf Desktop mit Recorder verfügbar.", true);
    $("replayStart").disabled = true;
    $("replayStop").disabled = false;
    $("replayStatus").textContent = "Starte …";
    replayCancelled = false;
    try {
      const api = recorderApi();
      const start = await api.startReplay(project.recording.startUrl);
      replayId = start.id;
      const actions = project.recording.actions;
      const speed = Math.max(.1, Math.min(8, Number($("replaySpeed").value) || 1));
      for (let index = 0; index < actions.length; index += 1) {
        if (replayCancelled) break;
        const action = actions[index];
        const delay = Math.min(30000, Math.max(0, Number(action.delayMs) || 0) / speed);
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        if (replayCancelled) break;
        await api.applyReplayAction(replayId, action);
        $("replayStatus").textContent = `läuft · ${index + 1}/${actions.length}`;
        if (project.states[index + 1]) {
          selection = { type: "state", id: project.states[index + 1].id };
          renderGraph();
          renderInspector();
          renderApp();
        }
      }
      if (!replayCancelled) {
        $("replayStatus").textContent = "Fertig";
        toast("Echter Browser-Replay abgeschlossen.");
      }
    } catch (error) {
      $("replayStatus").textContent = "Fehler";
      toast(error.message, true);
    } finally {
      if (replayId) await recorderApi()?.stopReplay?.(replayId).catch(() => {});
      replayId = "";
      $("replayStart").disabled = false;
      $("replayStop").disabled = true;
    }
  }

  async function stopReplay() {
    replayCancelled = true;
    if (replayId) await recorderApi()?.stopReplay?.(replayId).catch(() => {});
    replayId = "";
    $("replayStart").disabled = false;
    $("replayStop").disabled = true;
    $("replayStatus").textContent = "Gestoppt";
  }

  function download(name, text, type = "application/json") {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  const safeFile = value => String(value || "zustand").toLowerCase().replace(/[^a-z0-9äöüß_-]+/gi, "-").replace(/^-+|-+$/g, "") || "zustand";
  const exportProject = () => download(`${safeFile(project.name)}.zustand.json`, JSON.stringify(project, null, 2));

  function appExportHtml() {
    const data = JSON.stringify(project).replace(/</g, "\\u003c");
    return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(project.name)}</title><style>html,body{margin:0;min-height:100%;background:#06101b;color:#e8f3ff;font:14px system-ui}main{min-height:100vh;display:grid;grid-template-rows:auto 1fr}.bar{display:flex;gap:8px;align-items:center;padding:10px;border-bottom:1px solid #21405b}.bar b{margin-right:auto}.btn{border:1px solid #315f82;border-radius:8px;background:#0a1827;color:#e8f3ff;padding:7px 10px}.frame{display:grid;place-items:center;padding:12px}.frame img{max-width:100%;max-height:calc(100vh - 70px);object-fit:contain}.empty{color:#94abc0}</style></head><body><main><div class="bar"><b id="title"></b><button class="btn" id="prev">←</button><span id="count"></span><button class="btn" id="next">→</button></div><div class="frame" id="frame"></div></main><script>const project=${data};let i=0;const q=id=>document.getElementById(id);function render(){const s=project.states[i];q('title').textContent=s.title||project.name;q('count').textContent=(i+1)+' / '+project.states.length;q('frame').innerHTML=s.snapshot&&s.snapshot.image?'<img src="'+s.snapshot.image+'" alt="">':'<div class="empty">'+(s.title||'State')+'</div>'}q('prev').onclick=()=>{i=Math.max(0,i-1);render()};q('next').onclick=()=>{i=Math.min(project.states.length-1,i+1);render()};render();<\/script></body></html>`;
  }

  const exportApp = () => download(`${safeFile(project.name)}.html`, appExportHtml(), "text/html");

  async function importProject(file) {
    try {
      const data = JSON.parse(await file.text());
      setProject(data.project?.kind === "zustand-project" ? data.project : data);
      switchTab("render");
      toast("Projekt geladen.");
    } catch (error) {
      toast(error.message, true);
    }
  }

  function bind() {
    document.querySelectorAll(".tab").forEach(tab => tab.onclick = () => switchTab(tab.dataset.tab));
    $("projectName").oninput = event => { project.name = event.target.value; scheduleSave(); };
    $("btnNew").onclick = () => { if (confirm("Neues Projekt starten?")) setProject(defaultProject()); };
    $("btnAddState").onclick = addState;
    $("btnProjectExport").onclick = exportProject;
    $("btnExport").onclick = exportApp;
    $("projectImport").onchange = event => {
      const file = event.target.files?.[0];
      if (file) importProject(file);
      event.target.value = "";
    };
    $("recordStart").onclick = startRecording;
    $("recordFinish").onclick = finishRecording;
    $("recordCancel").onclick = cancelRecording;
    $("prevState").onclick = () => moveState(-1);
    $("nextState").onclick = () => moveState(1);
    $("replayStart").onclick = startReplay;
    $("replayStop").onclick = stopReplay;
    window.addEventListener("zustand-recorder-ready", () => checkRecorderBridge());
  }

  async function boot() {
    bind();
    const query = new URL(location.href).searchParams;
    activeTab = query.get("tab") === "render" ? "render" : "recorder";
    let loaded = null;
    try {
      const id = localStorage.getItem(LAST_KEY);
      if (id) loaded = await dbGet(id);
    } catch (_) {}
    setProject(loaded || defaultProject());
    switchTab(activeTab);
    checkRecorderBridge();
  }

  boot().catch(error => toast(error.message, true));
})();
