self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data = {};
  try {
    data = event.data.json();
  } catch (err) {
    console.error('Push payload parse error:', err);
  }

  const title = data.title || 'CampusCart';
  const body = data.body || '';
  const icon = data.icon || '/static/icon.png';
  const badge = data.badge || '/static/icon.png';
  const url = data.url || '/notifications/'; // safer fallback

  const options = {
    body,
    icon,
    badge,
    data: { url },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/notifications/';

  event.waitUntil(
    (async () => {
      try {
        const response = await fetch(targetUrl, { method: 'HEAD' });
        // if target invalid → go to notifications
        const finalUrl = response.ok ? targetUrl : '/notifications/';
        const clientList = await clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });
        for (const client of clientList) {
          if (client.url.includes(finalUrl) && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(finalUrl);
        }
      } catch (err) {
        console.warn('Navigation failed, redirecting to /notifications/', err);
        return clients.openWindow('/notifications/');
      }
    })()
  );
});

self.addEventListener('install', () =>
  console.log('✅ Service Worker installed')
);
self.addEventListener('activate', () =>
  console.log('✅ Service Worker activated')
);
