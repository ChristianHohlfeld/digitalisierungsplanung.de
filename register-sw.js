(async () => {
  if (!("serviceWorker" in navigator)) return;
  if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;

  const versionFromScript = text => {
    const match = String(text || "").match(/ZUSTAND_SW_VERSION\s*=\s*["']([^"']+)["']/);
    return match ? match[1] : "dev-local";
  };

  let version = "dev-local";
  try {
    const response = await fetch("/sw-version.js", { cache: "no-store" });
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
    const registration = await navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(version)}`, { scope: "/" });
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          worker.postMessage({ type: "SKIP_WAITING" });
        }
      });
    });
    await registration.update();
  } catch (_) {}
})();
