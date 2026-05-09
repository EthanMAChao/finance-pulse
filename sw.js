const CACHE_NAME='finance-pulse-model-v2-5';
const STATIC_ASSETS=['./','./index.html','./styles.css','./model.js','./app.js','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(STATIC_ASSETS)))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('message',e=>{if(e.data&&e.data.type==='SKIP_WAITING')self.skipWaiting()});
self.addEventListener('fetch',e=>{const url=new URL(e.request.url);if(url.pathname.includes('/data/')){e.respondWith(fetch(e.request,{cache:'no-store'}).then(r=>{const clone=r.clone();caches.open(CACHE_NAME).then(c=>c.put(e.request,clone));return r}).catch(()=>caches.match(e.request)));return}e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request)))});
