(async()=>{if("serviceWorker"in navigator){const r=await navigator.serviceWorker.getRegistrations().catch(()=>[]);await Promise.all(r.map(x=>x.unregister()))}if("caches"in window){const n=await caches.keys().catch(()=>[]);await Promise.all(n.map(x=>caches.delete(x)))}})();

(()=>{
  if(window.__protocolInputCaptureInstalled)return;
  window.__protocolInputCaptureInstalled=true;
  const plain=v=>!!v&&typeof v==="object"&&!Array.isArray(v);
  const safe=(v,d=0)=>d>4?"[gekürzt]":v==null||["string","number","boolean"].includes(typeof v)?(typeof v==="string"?v.slice(0,2000):v):Array.isArray(v)?v.slice(0,50).map(x=>safe(x,d+1)):plain(v)?Object.fromEntries(Object.entries(v).slice(0,50).filter(([,x])=>x!==undefined).map(([k,x])=>[k,safe(x,d+1)])):String(v??"").slice(0,2000);
  const secret=(p,l="")=>/(?:password|passwort|secret|token|api[-_. ]?key|pin)(?:$|[._ -])/i.test(`${p} ${l} `);
  const display=v=>v==null||v===""?"leer":typeof v==="boolean"?(v?"Ja":"Nein"):Array.isArray(v)?(v.length?v.map(x=>plain(x)?String(x.label||x.title||x.value||JSON.stringify(safe(x))):String(x)).join(", "):"leer"):plain(v)?JSON.stringify(safe(v)):String(v);
  const pathOf=id=>typeof findState==="function"&&typeof activeStateChain==="function"?(activeStateChain(findState(id)).filter(Boolean).map(s=>({id:String(s.id||""),title:typeof runtimeStateTitle==="function"?runtimeStateTitle(s.id):String(s.title||s.id||"")}))):[];
  const labelFor=el=>{
    const explicit=el.labels?.[0]?.textContent?.trim();
    if(explicit)return explicit;
    const aria=el.getAttribute("aria-label")||el.getAttribute("placeholder")||el.name||el.id;
    return String(aria||"Eingabe").trim();
  };
  const valueFor=el=>{
    if(el.type==="checkbox"||el.type==="radio")return !!el.checked;
    if(el.type==="file")return el.files?.[0]?.name||"";
    if(el.tagName==="SELECT"&&el.multiple)return [...el.selectedOptions].map(o=>o.value);
    return el.value;
  };
  const inputs=()=>[...document.querySelectorAll("#screen input,#screen textarea,#screen select")].filter(el=>!el.disabled&&el.type!=="hidden").map((el,i)=>{
    const label=labelFor(el),path=el.getAttribute("data-path")||el.name||el.id||`screen.input.${i+1}`,redacted=secret(path,label),value=valueFor(el),out={path,label,kind:el.type||el.tagName.toLowerCase(),redacted,displayValue:redacted?"Aus Sicherheitsgründen nicht protokolliert":display(value)};if(!redacted)out.value=safe(value);return out;
  });
  const changes=t=>Object.keys(plain(t?.set)?t.set:{}).map(path=>{const value=typeof readValueAtPath==="function"?readValueAtPath(context,path):undefined,redacted=secret(path),out={path,label:path.split(".").pop()||path,redacted,displayValue:redacted?"Aus Sicherheitsgründen nicht protokolliert":display(value)};if(!redacted)out.value=safe(value);return out});
  const clone=a=>Array.isArray(a)?a.filter(plain).map(x=>safe(x)):[];

  if(typeof runtimeProtocolStepFromValue==="function"){
    const base=runtimeProtocolStepFromValue;
    runtimeProtocolStepFromValue=(step,index)=>({...base(step,index),fromPath:clone(step?.fromPath),activePath:clone(step?.activePath),inputs:clone(step?.inputs),changes:clone(step?.changes)});
  }

  if(typeof followTransition==="function"){
    const base=followTransition;
    followTransition=function(transition,fromStateId,reason="next"){
      const capturedInputs=inputs(),fromPath=pathOf(fromStateId),result=base(transition,fromStateId,reason);
      try{
        const currentPath=readValueAtPath(context,"runtime.path");
        if(!Array.isArray(currentPath)||!currentPath.length)return result;
        const i=currentPath.length-1,step=plain(currentPath[i])?currentPath[i]:{},next=currentPath.slice();
        next[i]={...step,fromPath,activePath:pathOf(step.to||current),inputs:capturedInputs,changes:changes(transition)};
        writeRuntimeState("runtime.path",next,{source:"transition",metadata:false,token:RUNTIME_WRITE_TOKEN});
        syncRuntimeProtocolButton?.();refreshRuntimeProtocolIfOpen?.();
      }catch(error){console.error("Protocol capture failed",error)}
      return result;
    };
  }

  const addValues=(parent,title,values)=>{if(!values?.length)return;const section=document.createElement("section");section.className="protocol-detail protocol-values";section.style.cssText="margin-top:8px;display:grid;gap:7px";const h=document.createElement("div");h.className="protocol-detail-label";h.textContent=title;section.appendChild(h);values.forEach(v=>{const row=document.createElement("div");row.className="protocol-detail";const l=document.createElement("div"),d=document.createElement("div"),p=document.createElement("div");l.className="protocol-detail-label";d.className="protocol-detail-value";p.className="protocol-step-meta";l.textContent=v.label||v.path||"Wert";d.textContent=v.displayValue||"leer";p.textContent=v.path||"";row.append(l,d);if(v.path)row.appendChild(p);section.appendChild(row)});parent.appendChild(section)};
  const addPath=(parent,path)=>{if(!path?.length)return;const section=document.createElement("section");section.className="protocol-detail protocol-active-path";section.style.marginTop="8px";const h=document.createElement("div"),route=document.createElement("div");h.className="protocol-detail-label";h.textContent="Aktiver Zustandspfad";route.className="protocol-route";path.forEach((x,i)=>{if(i){const s=document.createElement("span");s.className="protocol-route-separator";s.textContent="→";route.appendChild(s)}const pill=document.createElement("span");pill.className="protocol-route-pill";pill.textContent=x.title||x.id||"Zustand";route.appendChild(pill)});section.append(h,route);parent.appendChild(section)};

  if(typeof renderRuntimeProtocolReport==="function"){
    const base=renderRuntimeProtocolReport;
    renderRuntimeProtocolReport=function(){const result=base();try{const snapshot=runtimeProtocolSnapshot();document.querySelectorAll("#processProtocolBody .protocol-step-main").forEach((main,i)=>{if(main.querySelector(":scope > .protocol-values,:scope > .protocol-active-path"))return;const step=snapshot.steps[i];addPath(main,step?.activePath);addValues(main,"Erfasste Eingaben vor dem Wechsel",step?.inputs);addValues(main,"Durch den Wechsel gesetzte Daten",step?.changes)})}catch(error){console.error("Protocol rendering failed",error)}return result};
  }
})();
