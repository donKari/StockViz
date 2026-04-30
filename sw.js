/**
 * ═══════════════════════════════════════════════════════════════
 *  STOCKVIZ — Service Worker
 *  • Cache offline (app shell)
 *  • Push notifications (alertes stock)
 * ═══════════════════════════════════════════════════════════════
 */

const CACHE_NAME = 'stockviz-v1';
const CACHE_URLS = [
  '/StockViz/',
  '/StockViz/stock.html',
  '/StockViz/auth.html',
  '/StockViz/supabase-api.js',
  '/StockViz/manifest.json',
  '/StockViz/icons/icon-192.png',
  '/StockViz/icons/icon-512.png',
  // Fonts Google (si dispo, sinon fallback system)
  'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&family=DM+Serif+Display:ital@0;1&display=swap'
];

/* ─── INSTALL : mise en cache de l'app shell ─── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // On cache ce qu'on peut, sans bloquer sur les erreurs réseau
      return Promise.allSettled(
        CACHE_URLS.map(url => cache.add(url).catch(() => null))
      );
    }).then(() => self.skipWaiting())
  );
});

/* ─── ACTIVATE : nettoyage des anciens caches ─── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ─── FETCH : stratégie Network-first, fallback cache ─── */
self.addEventListener('fetch', event => {
  // Ne pas intercepter les requêtes Supabase (toujours réseau)
  if (event.request.url.includes('supabase.co')) return;

  // Pour les navigations (HTML) : Network-first
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match(event.request).then(r => r || caches.match('/StockViz/stock.html')))
    );
    return;
  }

  // Pour les assets statiques : Cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Mettre en cache les nouvelles ressources statiques
        if (response.ok && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

/* ─── PUSH NOTIFICATIONS ─── */
self.addEventListener('push', event => {
  let data = { title: 'StockViz', body: 'Alerte stock !', icon: '/StockViz/icons/icon-192.png' };

  try {
    data = { ...data, ...event.data.json() };
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/StockViz/icons/icon-192.png',
      badge: '/StockViz/icons/icon-192.png',
      tag: data.tag || 'stockviz-alert',
      renotify: true,
      data: { url: data.url || '/StockViz/stock.html' },
      actions: [
        { action: 'open', title: '📦 Voir le stock' },
        { action: 'dismiss', title: 'Ignorer' }
      ]
    })
  );
});

/* ─── NOTIFICATION CLICK ─── */
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/StockViz/stock.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Cherche un onglet StockViz déjà ouvert
      const existing = windowClients.find(c => c.url.includes('stockviz') || c.url.includes('StockViz'));
      if (existing) {
        existing.focus();
        existing.navigate(targetUrl);
      } else {
        clients.openWindow(targetUrl);
      }
    })
  );
});

/* ─── BACKGROUND SYNC (optionnel, pour les mutations offline) ─── */
self.addEventListener('sync', event => {
  if (event.tag === 'stockviz-sync') {
    // Ici on pourrait rejouer les mutations en attente
    // Pour l'instant on se contente d'un log
    console.log('[SW] Background sync triggered');
  }
});
