/* Service worker de RegistrObraApp: guarda la app en el teléfono para usarla sin internet.
   Al publicar una versión nueva, cambie CACHE_VERSION para que los teléfonos la actualicen. */
const CACHE_VERSION = 'registrobra-v2.0.2';
const FILES = [
  './', './index.html', './styles.css', './app.js', './pdt-data.js', './logo-cenit.js', './manifest.webmanifest',
  './libs/xlsx.full.min.js', './libs/jspdf.umd.min.js', './libs/jspdf.plugin.autotable.min.js', './libs/jszip.min.js',
  './icons/icon-32.png', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  // Navegación: devolver siempre la app guardada (funciona sin señal)
  if (e.request.mode === 'navigate') {
    e.respondWith(caches.match('./index.html').then(r => r || fetch(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(resp => {
    if (resp && resp.ok) { const copy = resp.clone(); caches.open(CACHE_VERSION).then(c => c.put(e.request, copy)); }
    return resp;
  })));
});
