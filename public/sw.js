// O build (scripts/build-netlify.js) troca a versão e a lista de precache a cada deploy.
const VERSION = '__BT8_VERSION__';
const CACHE = `bt8-${VERSION}`;
const PRECACHE = [/*__BT8_PRECACHE__*/];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => k !== CACHE && caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  // Outras origens (Supabase, Stripe, fontes), POST e Functions vão direto para a rede.
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/.netlify/')) return;

  if (req.mode === 'navigate') {
    // HTML: rede primeiro; sem internet, o shell do precache (mesma versão dos js/css guardados).
    e.respondWith(fetch(req).catch(() => caches.match('./', { cacheName: CACHE })));
    return;
  }
  e.respondWith(caches.match(req, { cacheName: CACHE }).then(cached => cached || fetch(req)));
});
