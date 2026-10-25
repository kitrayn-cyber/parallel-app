// Parallel PWA: always fetch fresh app code, cache only static assets.
const CACHE = 'parallel-v17';
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

self.addEventListener('push', event => {
  let data={};try{data=event.data?.json()||{};}catch{}
  event.waitUntil((async()=>{
    // Always show a notification; iOS requires visible push handling.
    await self.registration.showNotification('Parallel · Gura',{
      body:'Gura sent you a message.',tag:data.tag||'parallel-reply',
      icon:new URL('./icon-192.png',self.registration.scope).href,
      badge:new URL('./icon-192.png',self.registration.scope).href,
      data:{conversationId:data.conversationId}
    });
    for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true}))client.postMessage({type:'parallel-reply'});
  })());
});
let notificationNavigation=Promise.resolve();
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=new URL('./',self.registration.scope);
  const cid=event.notification.data?.conversationId;
  if(typeof cid==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(cid))url.searchParams.set('conversation',cid);
  notificationNavigation=notificationNavigation.catch(()=>{}).then(async()=>{
    for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})){
      if(new URL(client.url).origin===url.origin&&new URL(client.url).pathname.startsWith(new URL(self.registration.scope).pathname)){
        client.postMessage({type:'parallel-open-conversation',conversationId:cid});
        await client.focus();return;
      }
    }
    await self.clients.openWindow(url.href);
  });
  event.waitUntil(notificationNavigation);
});
