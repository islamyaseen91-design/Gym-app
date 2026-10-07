// Offline support. App code (pages, scripts, manifest) is network-first so updates show on the next open;
// images and fonts are cache-first. Bump CACHE when the shell list changes.
const CACHE = "gym-log-v13";
const SHELL = ["./", "index.html", "guides.js", "manifest.json", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", e => {
  // cache: "reload" skips the browser's HTTP cache so a fresh copy is stored.
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(SHELL.map(p => new Request(p, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const u = new URL(e.request.url);
  const sameOrigin = u.origin === self.location.origin;
  // Leave cross-origin API calls (e.g. the WHOOP worker) to the network; only the app and fonts are cached.
  if (!sameOrigin && !u.hostname.startsWith("fonts.g")) return;
  const isCode = sameOrigin && (e.request.mode === "navigate" || /\.(html|js|json)$/.test(u.pathname) || u.pathname.endsWith("/"));
  const put = res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return res; };
  if (isCode) {
    e.respondWith(fetch(e.request, { cache: "no-cache" }).then(put)
      .catch(() => caches.match(e.request).then(hit => hit || caches.match("index.html"))));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(put)));
});
