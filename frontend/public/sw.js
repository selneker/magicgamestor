/* Push-only worker: no offline cache and no interception of API/payment requests. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Réabonnement automatique après rotation/perte de l'abonnement push
// (pushsubscriptionchange) : réabonne avec la même clé VAPID puis réenvoie
// l'abonnement au serveur avec les cookies. Échec silencieux : la
// synchronisation au prochain chargement de l'admin rattrape.
async function resubscribe(oldSubscription) {
  try {
    const reg = self.registration;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const key = oldSubscription && oldSubscription.options && oldSubscription.options.applicationServerKey;
      if (!key) return; // pas de clé connue : le prochain chargement de l'admin resynchronise
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    }
    await fetch('/api/admin/push/subscriptions', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub.toJSON()),
    });
  } catch (_) { /* silencieux */ }
}
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(resubscribe(event.oldSubscription));
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  event.waitUntil(self.registration.showNotification(data.title || 'Magic Game Store', {
    body: data.body || 'Une nouvelle commande est arrivée.',
    tag: data.tag || data.orderId || 'mgs-order',
    icon: '/push-icon-192.png',
    badge: '/badge-72.png',
    data: { url: data.url || '/admin/commandes' },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/admin/commandes', self.location.origin);
  if (target.origin !== self.location.origin || !['/admin/commandes', '/admin/messages'].includes(target.pathname)) return;
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
