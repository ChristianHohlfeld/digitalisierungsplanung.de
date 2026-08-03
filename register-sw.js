(async () => {
  if (!("serviceWorker" in navigator)) return;
  if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;

  const versionFromScript = text => {
    const match = String(text || "").match(/ZUSTAND_SW_VERSION\s*=\s*["']([^"']+)["']/);
    return match ? match[1] : "dev-local";
  };

  let version = "dev-local";
  try {
    const versionUrl = "/sw-version.js?__zustand_nocache=" + Date.now();
    const response = await fetch(versionUrl, { cache: "no-store" });
    version = versionFromScript(await response.text());
  } catch (_) {}

  let refreshing = false;
  let controlledAtLoad = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!controlledAtLoad) {
      controlledAtLoad = true;
      return;
    }
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  try {
    const registration = await navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(version)}`, {
      scope: "/",
      updateViaCache: "none"
    });
    const worker = registration.installing || registration.waiting || registration.active;
    worker?.postMessage({ type: "CLEAR_CACHES" });
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          installing.postMessage({ type: "SKIP_WAITING" });
        }
      });
    });
    await registration.update();
  } catch (_) {}
})();
