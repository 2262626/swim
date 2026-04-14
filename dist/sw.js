const CACHE_NAME = 'swim-ai-v3'
const APP_SHELL = ['/', '/index.html', '/manifest.json']
const CDN_HOST = 'cdn.jsdelivr.net'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys()
    await Promise.all(
      cacheNames
        .filter((name) => name !== CACHE_NAME)
        .map((name) => caches.delete(name))
    )
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const requestURL = new URL(request.url)

  if (request.method !== 'GET') return

  if (requestURL.pathname.startsWith('/prod-api/') || requestURL.pathname.startsWith('/dev-api/')) {
    event.respondWith(fetch(request))
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request)
        const cache = await caches.open(CACHE_NAME)
        cache.put('/index.html', fresh.clone())
        return fresh
      } catch {
        return caches.match('/index.html')
      }
    })())
    return
  }

  if (requestURL.hostname.includes(CDN_HOST)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME)
      const cached = await cache.match(request)
      if (cached) return cached
      const fresh = await fetch(request)
      cache.put(request, fresh.clone())
      return fresh
    })())
    return
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME)
    const cached = await cache.match(request)
    if (cached) return cached

    try {
      const fresh = await fetch(request)
      cache.put(request, fresh.clone())
      return fresh
    } catch {
      return cached
    }
  })())
})
