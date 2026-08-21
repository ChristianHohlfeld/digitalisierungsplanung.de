(async () => {
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
    await Promise.all(registrations.map(registration => registration.unregister()));
  }
  if ("caches" in window) {
    const names = await caches.keys().catch(() => []);
    await Promise.all(names.map(name => caches.delete(name)));
  }

  function installExternalRecorderButton() {
    if (location.pathname !== "/state.html" && !location.pathname.endsWith("/state.html")) return;
    if (document.getElementById("btnRecordUrl")) return;
    const loadButton = document.getElementById("btnLoad");
    const exportButton = document.getElementById("btnExport");
    const anchor = exportButton || loadButton;
    if (!anchor?.parentElement) return;
    const button = document.createElement("button");
    button.id = "btnRecordUrl";
    button.type = "button";
    button.textContent = "URL aufnehmen";
    button.title = "Beliebige Website durchklicken und als State-Ablauf aufnehmen";
    button.setAttribute("aria-label", button.title);
    button.addEventListener("click", () => {
      location.href = "/recorder.html";
    });
    anchor.parentElement.insertBefore(button, exportButton || anchor.nextSibling);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installExternalRecorderButton, { once: true });
  } else {
    installExternalRecorderButton();
  }
})();
