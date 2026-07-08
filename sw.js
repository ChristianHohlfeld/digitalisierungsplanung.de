importScripts("/sw-version.js");

const VERSION = self.ZUSTAND_SW_VERSION || "dev-local";
const CACHE_PREFIX = "zustand-static";
const CACHE_NAME = `${CACHE_PREFIX}-${VERSION}`;
const APP_SHELL = [
  "/",
  "/index.html",
  "/state.html",
  "/manifest.webmanifest",
  "/register-sw.js",
  "/sw-version.js",
  "/assets/zustand-icon.svg",
  "/assets/zustand-maskable.svg",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/assets/maskable-512.png",
  "/assets/apple-touch-icon.png",
  "/assets/share-card.png",
  "/assets/hero-process.png"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith(`${CACHE_PREFIX}-`) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
      return response;
    }
  } catch (_) {}
  return await cache.match(request) || await cache.match(fallbackUrl);
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fetched = fetch(request)
    .then(response => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || await fetched || Response.error();
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "/index.html"));
    return;
  }

  if (url.pathname === "/sw.js" || url.pathname === "/sw-version.js") {
    event.respondWith(fetch(new Request(request, { cache: "no-store" })));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
