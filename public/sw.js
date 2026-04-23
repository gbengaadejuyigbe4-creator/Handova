/**
 * Handova Service Worker
 *
 * Cache name is injected by Vite at build time via vite.config.js replace.
 * Every new build produces a new CACHE_NAME, which causes this SW to
 * activate, clear the old cache, and serve fresh assets immediately.
 *
 * Without this, nurses on Vercel/Netlify who installed the PWA would
 * continue running the old JS bundle indefinitely — including across
 * version bumps — because the SW served the cached app before the
 * network could deliver the new one.
 */

const CACHE_NAME = '__HANDOVA_CACHE_VERSION__';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/favicon.png',
  '/icon-192.png',
  '/icon-512.png',
];

// Install — cache static shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  // Skip waiting so the new SW activates immediately on next navigation
  self.skipWaiting();
});

// Activate — purge ALL old caches that don't match the current version
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => {
            console.log('[Handova SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      )
    )
  );
  // Take control of all open tabs immediately — don't wait for reload
  self.clients.claim();
});

// Fetch — network first, fall back to cache for offline support.
self.addEventListener('fetch', (event) => {
  // Never cache API calls
  if (event.request.url.includes('/api/')) return;

  // Navigation requests always try network first so nurses always get
  // the latest app after a deploy — never a stale cached shell.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Static assets — network first, update cache, fall back to cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
