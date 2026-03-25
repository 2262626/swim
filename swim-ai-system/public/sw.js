// Service Worker for PWA support
const CACHE_NAME = 'swim-ai-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/src/main.js',
  '/src/App.vue',
  '/src/assets/styles.css',
  'https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // 网络优先策略，用于 MediaPipe CDN 资源
  if (event.request.url.includes('cdn.jsdelivr.net')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(event.request);
      })
    );
    return;
  }

  // 缓存优先策略，用于本地资源
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request).then((fetchResponse) => {
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, fetchResponse.clone());
          return fetchResponse;
        });
      });
    }).catch(() => {
      // 离线时返回缓存的 index.html
      if (event.request.mode === 'navigate') {
        return caches.match('/index.html');
      }
    })
  );
});
