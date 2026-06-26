/* Realyx service worker — installable PWA shell + push notifications.
 *
 * Strategy:
 *  - Precache the app shell so a cold/offline launch still renders.
 *  - Network-first for navigations (always try fresh, fall back to cached shell).
 *  - Stale-while-revalidate for static assets (JS/CSS/img) for fast repeat loads.
 *  - NEVER cache API/RPC/WS traffic — trading data must always be live.
 *  - Push + notificationclick handlers deliver off-app liquidation/TP-SL alerts.
 */

const CACHE_VERSION = 'realyx-v1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;

const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/favicon.png', '/tr.png'];

// Hosts whose responses must never be served from cache (live trading data).
const NO_CACHE_HINTS = ['/api/', '/health', '/ws', 'confluxrpc', 'hermes', 'pyth', 'binance', 'coingecko'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS).catch(() => undefined)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isNoCache(url) {
  return NO_CACHE_HINTS.some((h) => url.includes(h));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = request.url;
  if (isNoCache(url)) return; // let live data hit the network untouched

  // Navigations: network-first, fall back to cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('/', copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match('/').then((c) => c || caches.match('/index.html'))),
    );
    return;
  }

  // Same-origin static assets: stale-while-revalidate.
  if (new URL(url).origin === self.location.origin) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res && res.status === 200) cache.put(request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
  }
});

// ── Push notifications: liquidation warnings & TP/SL fills ──
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Realyx', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Realyx alert';
  const options = {
    body: payload.body || '',
    icon: '/favicon.png',
    badge: '/favicon.png',
    tag: payload.tag || 'realyx-alert',
    data: { url: payload.url || '/portfolio' },
    requireInteraction: payload.urgent === true, // keep liquidation alerts on screen
    vibrate: payload.urgent ? [120, 60, 120] : [60],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/portfolio';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => 'focus' in c);
      if (existing) {
        existing.navigate(target).catch(() => undefined);
        return existing.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
