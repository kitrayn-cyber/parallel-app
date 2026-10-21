// Parallel PWA: always fetch fresh app code, cache only static assets.
const CACHE = 'parallel-v14';
const ASSETS = ['./manifest.webmanifest','./icon-180.png','./icon-192.png','./icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if(request.method !== 'GET' || url.origin !== self.location.origin) return;
  if(request.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/sw.js')) {
    event.respondWith(fetch(request, {cache:'no-store'}));
    return;
  }
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});
