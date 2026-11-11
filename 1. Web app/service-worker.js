/* Optional offline cache. Network-first ensures updated GitHub Pages files are preferred. */
const CACHE_NAME='epsilon-material-master-cloud-erp-attributes-20261110';
const ASSETS=[
 './','./index.html','./manifest.webmanifest','./favicon.svg','./icon-192.png','./icon-152.png',
 './assets/css/styles.css','./assets/js/barcode.js','./assets/js/cloud-bridge.js','./assets/js/material-rules.js','./assets/js/app.js','./assets/data/config.json',
 './assets/images/material-master-banner.webp','./assets/images/material-master-footer.webp',
 './assets/images/material-master-catalog.webp'
];
self.addEventListener('install',e=>{
 e.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
 e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>(k.startsWith('epsilon-material-master-demo-')||k.startsWith('epsilon-material-master-cloud-'))&&k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
 const req=e.request;
 if(req.method!=='GET'||new URL(req.url).origin!==self.location.origin)return;
 e.respondWith(fetch(req).then(resp=>{
   if(resp.ok){const clone=resp.clone();e.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.put(req,clone)).catch(()=>{}));}
   return resp;
 }).catch(()=>caches.match(req).then(cached=>cached||Response.error())));
});
