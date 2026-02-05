// Service Worker básico - cache estático
const CACHE_NAME = 'cromwell-store-v1';
const urlsToCache = [
  '/',
  '/dashboard',
  '/css/styles.css',
  '/css/dashboard.css',
  '/js/dashboard.js',
  '/js/wallet.js',
  '/js/deposit.js',
  '/js/history.js',
  '/js/claims.js',
  '/js/notifications.js',
  '/assets/favicon.ico'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});
