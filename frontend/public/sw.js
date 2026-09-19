/* Push-only worker: no offline cache and no interception of API/payment requests. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  event.waitUntil(self.registration.showNotification(data.title || 'Magic Game Store', {
    body: data.body || 'Une nouvelle commande est arrivée.',
    tag: data.orderId || 'mgs-order',
    icon: '/icon-192.png',
    data: { url: data.url || '/admin/commandes' },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/admin/commandes', self.location.origin);
  if (target.origin !== self.location.origin || target.pathname !== '/admin/commandes') return;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = clients.find((item) => new URL(item.url).origin === self.location.origin);
    if (client) {
      await client.navigate(target.href);
      return client.focus();
    }
    return self.clients.openWindow(target.href);
  })());
});
