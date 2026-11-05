const scope = self.registration.scope;
const prefix = `iimg-shell:${scope}:`;
const cacheName = `${prefix}6`;
const shell = new Set(["index.html", "viewer.mjs", "iimg_web.wasm"]
  .map((file) => new URL(file, scope).href));

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll([...shell].map((url) => new Request(url, { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(prefix) && name !== cacheName)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const url = event.request.url === scope ? new URL("index.html", scope).href : event.request.url;
  if (event.request.method !== "GET" || !shell.has(url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    return await cache.match(url) ?? fetch(event.request);
  })());
});
