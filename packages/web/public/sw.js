// Service worker for background/push notifications.
// ServiceWorkerRegistration.showNotification() works even when the tab is in the
// background or fully closed — unlike new Notification(), which mobile browsers
// block. The `push` handler delivers Web Push from the CRC server.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// --- Web Push ---
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Claude Remote', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Claude Remote';
  const body = data.body || '';
  const tag = data.tag || 'crc-push';
  const url = data.url || '/';

  event.waitUntil(
    (async () => {
      // If a window is already focused, the in-app path handles the alert —
      // don't also pop an OS notification.
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (wins.some((c) => c.focused)) return;
      await self.registration.showNotification(title, {
        body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag,
        renotify: true,
        data: { url },
      });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          if ('navigate' in client && url !== '/') client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
