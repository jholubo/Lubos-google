// Service worker: caché básico + Web Push
const CACHE_NAME = 'lubos-v2';

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(clients.claim()); });
self.addEventListener('fetch', (e) => {
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

// Push notifications
self.addEventListener('push', (event) => {
  let data = { title: "Lubo's", body: 'Nueva notificacion' };
  try { if (event.data) data = event.data.json(); } catch { /* ignore */ }
  const options = {
    body: data.body,
    icon: '/isotipo.webp',
    badge: '/isotipo.webp',
    tag: data.tag || 'lubos-general',
    data: { url: data.url || '/' },
    vibrate: [200, 100, 200],
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clientList) {
      if ('focus' in c) { c.navigate(url); return c.focus(); }
    }
    if (clients.openWindow) return clients.openWindow(url);
  })());
});
