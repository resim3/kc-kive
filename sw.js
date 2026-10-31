// Service worker : permet l'installation (PWA) et l'affichage des notifications
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {}); // requis pour être installable

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((list) =>
      list.length ? list[0].focus() : self.clients.openWindow('/')
    )
  );
});
