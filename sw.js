/* Service worker de RegistrObraApp: guarda la app en el teléfono para usarla sin internet.
   Con señal descarga siempre la versión más reciente; sin señal usa la copia guardada. */
const CACHE_VERSION = 'registrobra-v3';
const FILES = [
  './', './index.html', './styles.css', './app.js', './config.js', './pdt-data.js', './logo-cenit.js', './manifest.webmanifest',
  './exceljs.min.js', './jspdf.umd.min.js', './jspdf.plugin.autotable.min.js', './jszip.min.js',
  './logo-bqs-header.png', './icon-32.png', './icon-180.png', './icon-192.png', './icon-512.png', './icon-maskable-512.png'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_VERSION).then(c => Promise.all(FILES.map(f => c.add(new Request(f, { cache: 'reload' })).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;           // Google (sincronización y fotos) no pasa por aquí
  const isNav = e.request.mode === 'navigate';
  const key = isNav ? './index.html' : e.request;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    try {
      const resp = await Promise.race([fetch(e.request, { cache: 'no-cache' }), timeout(isNav ? 4000 : 6000)]);
      if (resp && resp.ok) { cache.put(key, resp.clone()); return resp; }
      throw new Error('bad');
    } catch (err) {
      const hit = await cache.match(key, { ignoreSearch: true });
      if (hit) return hit;
      return fetch(e.request);
    }
  })());
});
