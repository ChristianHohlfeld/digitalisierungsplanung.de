(async () => {
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
    await Promise.all(registrations.map(registration => registration.unregister()));
  }
  if ("caches" in window) {
    const names = await caches.keys().catch(() => []);
    await Promise.all(names.map(name => caches.delete(name)));
  }

  if (/\/state\.html$/.test(location.pathname)) {
    const script = document.createElement("script");
    script.src = "/state-recorder-inspector.js";
    script.async = true;
    document.head.appendChild(script);
  }
})();
