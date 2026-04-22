// Minimal service worker for background notifications on mobile.
// ServiceWorkerRegistration.showNotification() works even when the
// tab is in the background — unlike new Notification() which mobile
// browsers block.

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
