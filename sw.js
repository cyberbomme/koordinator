/*
 * Koordinator – Service Worker
 * App-Dateien: stale-while-revalidate (sofort aus dem Cache, im Hintergrund aktualisieren).
 * Kartenkacheln: network-first mit begrenztem Offline-Cache.
 * Bei Änderungen an der Dateiliste VERSION erhöhen.
 */
const VERSION = 'v1';
const APP_CACHE = `koordinator-app-${VERSION}`;
const TILE_CACHE = 'koordinator-tiles';
const TILE_LIMIT = 400;

const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'favicon.svg',
  'css/style.css',
  'js/convert.js',
  'js/i18n.js',
  'js/app.js',
  'vendor/proj4.js',
  'vendor/mgrs.js',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/marker-icon.png',
  'vendor/leaflet/images/marker-icon-2x.png',
  'vendor/leaflet/images/marker-shadow.png',
  'vendor/leaflet/images/layers.png',
  'vendor/leaflet/images/layers-2x.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('koordinator-app-') && k !== APP_CACHE).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function trimTiles() {
  const cache = await caches.open(TILE_CACHE);
  const keys = await cache.keys();
  const excess = keys.length - TILE_LIMIT;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

async function tile(request) {
  const cache = await caches.open(TILE_CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) {
      await cache.delete(request);
      await cache.put(request, res.clone());
      trimTiles();
    }
    return res;
  } catch (e) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw e;
  }
}

async function app(event) {
  const request = event.request;
  const isNav = request.mode === 'navigate';
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(isNav ? 'index.html' : request, { ignoreSearch: isNav });
  const network = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(isNav ? 'index.html' : request, res.clone());
      return res;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const res = await network;
  return res || Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.hostname === 'tile.openstreetmap.org') {
    event.respondWith(tile(request));
  } else if (url.origin === self.location.origin) {
    event.respondWith(app(event));
  }
});
