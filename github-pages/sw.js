// Service Worker pour EduKraft
const CACHE_NAME = 'edukraft-v1';
const urlsToCache = [
  '/edukraft-quick.html',
  '/manifest-quick.json'
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
      .then(response => {
        return response || fetch(event.request);
      })
  );
});