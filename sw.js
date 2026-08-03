importScripts("/sw-version.js");

const VERSION = self.ZUSTAND_SW_VERSION || "dev-local";
const CACHE_BUSTER = "__zustand_nocache";

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
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "CLEAR_CACHES") event.waitUntil(clearAllCaches());
});

function uncachedUrl(request) {
  const url = new URL(request.url);
  url.searchParams.set(CACHE_BUSTER, VERSION + "-" + Date.now());
  return url.href;
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(fetch(uncachedUrl(request), {
    method: "GET",
    headers: request.headers,
    credentials: request.credentials,
    redirect: "follow",
    cache: "no-store"
  }));
});
