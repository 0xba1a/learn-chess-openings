// sw.js — Service Worker for Chess Opening Trainer
// Strategy: Cache-first for all static assets.

const CACHE_VERSION = 'chess-trainer-v1.0.1';

const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './css/chessground.base.css',
  './css/chessground.brown.css',
  './css/chessground.cburnett.css',
  './js/app.js',
  './js/db.js',
  './js/dag.js',
  './js/fen.js',
  './js/sm2.js',
  './js/utils.js',
  './js/board.js',
  './js/pages/study.js',
  './js/pages/browse.js',
  './js/pages/practice.js',
  './js/pages/manage.js',
  './lib/chess.min.js',
  './lib/chessground.min.js',
];

// Install — cache all static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate — clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch — cache-first strategy
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Cache the new response for future use
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      });
    })
  );
});
