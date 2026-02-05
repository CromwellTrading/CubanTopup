// public/sw.js
self.addEventListener('install', event => {
  console.log('Service Worker instalado');
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  console.log('Service Worker activado');
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', event => {
  // Puedes añadir lógica de cache aquí si necesitas
  event.respondWith(fetch(event.request));
});
