/* Service worker AéroSim 3D Studio — généré au build (voir vite.config.ts).
 * 1. Pré-cache de toute l'application (jeu jouable hors ligne après la 1re visite).
 * 2. Injection des en-têtes COOP/COEP/CORP sur les réponses de même origine : la page devient
 *    « cross-origin isolated » (SharedArrayBuffer) même sur un hébergeur sans en-têtes
 *    personnalisés (GitHub Pages). Sinon, le pont physique bascule en postMessage.
 */
const VERSION = '__VERSION__';
const CACHE = `aerosim-${VERSION}`;
const ASSETS = __ASSETS__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('aerosim-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isolate(resp) {
  if (!resp || resp.status === 0 || resp.type === 'opaqueredirect') return resp;
  const h = new Headers(resp.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // polices Google : CORS, laissées au navigateur
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      // réseau d'abord (mises à jour), cache en secours (hors ligne)
      try {
        const net = await fetch(req);
        return isolate(net);
      } catch {
        const shell = await cache.match(new URL('index.html', self.registration.scope).href);
        return isolate(shell ?? Response.error());
      }
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return isolate(hit);
    const net = await fetch(req);
    if (net.ok && net.type === 'basic') cache.put(req, net.clone());
    return isolate(net);
  })());
});
