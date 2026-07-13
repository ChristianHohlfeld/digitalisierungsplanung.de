async function clearAllCaches() {
  const names = await caches.keys();
  await Promise.all(names.map(name => caches.delete(name)));
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    await clearAllCaches();
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    await clearAllCaches();
    await self.registration.unregister();
  })());
});
