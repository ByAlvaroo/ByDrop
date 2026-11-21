// ByDrop · service worker: abre al instante y funciona aunque la red vaya lenta
// Sube el número de versión cuando cambies archivos para forzar la actualización.
// HECHO POR @BYALVARO__

const VERSION = 'bydrop-v3';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'config.js', 'js/util.js', 'js/direct.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
];
const CDN = ['cdn.jsdelivr.net'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  const isCdn = CDN.includes(url.hostname);
  if (!sameOrigin && !isCdn) return;            // Supabase y demás: siempre por red

  // Librerías externas: de la caché (no cambian). Archivos de ByDrop: siempre la versión nueva
  // si hay internet, y la guardada si no la hay (así las actualizaciones llegan al momento).
  e.respondWith(
    caches.open(VERSION).then(async cache => {
      if (isCdn) {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        return (await cache.match(req, { ignoreSearch: req.mode === 'navigate' })) || Response.error();
      }
    })
  );
});
