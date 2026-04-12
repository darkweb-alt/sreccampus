// ================================================================
// CampusConnect Service Worker
// Handles caching, offline support, and background sync
// ================================================================

const CACHE_NAME = 'campusconnect-v1';
const STATIC_CACHE = 'campusconnect-static-v1';
const API_CACHE = 'campusconnect-api-v1';

// Files to cache immediately on install
const PRECACHE_URLS = [
  '/',
  '/dashboard',
  '/static/icons/icon-192x192.png',
  '/static/icons/icon-512x512.png',
  // External fonts & icons (cached on first load)
];

// API routes — network first, cache fallback
const API_ROUTES = [
  '/get_notes',
  '/study_room',
  '/get_reactions',
  '/campus_pulse',
];

// ── INSTALL ──────────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing CampusConnect Service Worker...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Pre-caching static assets');
        // Only cache what we know exists — don't fail on missing files
        return Promise.allSettled(
          PRECACHE_URLS.map(url => cache.add(url).catch(e => {
            console.warn(`[SW] Failed to cache ${url}:`, e);
          }))
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating CampusConnect Service Worker...');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE && key !== API_CACHE)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests (POST, etc.) — let them go to network
  if (request.method !== 'GET') return;

  // Skip chrome-extension and non-http requests
  if (!url.protocol.startsWith('http')) return;

  // Skip Firebase, Supabase, Cloudinary, Groq API calls
  const externalAPIs = [
    'firebaseio.com',
    'googleapis.com',
    'supabase.co',
    'cloudinary.com',
    'groq.com',
    'identitytoolkit',
    'google-analytics',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdnjs.cloudflare.com',
  ];
  if (externalAPIs.some(api => url.href.includes(api))) {
    // For external fonts/icons — cache them
    if (url.href.includes('fonts.googleapis.com') ||
        url.href.includes('fonts.gstatic.com') ||
        url.href.includes('cdnjs.cloudflare.com')) {
      event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    }
    // Other external APIs — network only
    return;
  }

  // CampusConnect API routes — Network first, cache fallback
  const isAPIRoute = API_ROUTES.some(route => url.pathname.startsWith(route));
  if (isAPIRoute) {
    event.respondWith(networkFirstWithCache(request, API_CACHE));
    return;
  }

  // POST routes — always network, never cache
  const NON_CACHEABLE = [
    '/add_post', '/like_post', '/comment_post', '/reply_comment',
    '/delete_post', '/edit_post', '/pin_post', '/save_bio',
    '/save_bookmarks', '/add_event', '/edit_event', '/delete_event',
    '/enhance_post', '/mood_checkin', '/react_post',
    '/generate_quiz', '/save_quiz_result', '/upload_note',
    '/rate_note', '/track_download', '/delete_note',
    '/room_quiz', '/study_room',
    '/chat', '/logout', '/signup',
  ];
  if (NON_CACHEABLE.some(route => url.pathname.startsWith(route))) {
    return; // Let browser handle normally
  }

  // HTML pages — network first (always fresh), with offline fallback
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirstWithOfflineFallback(request));
    return;
  }

  // Static assets (CSS, JS, images) — stale while revalidate
  event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
});

// ── STRATEGIES ────────────────────────────────────────────────────

// Network first — try network, fall back to cache
async function networkFirstWithCache(request, cacheName) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('[SW] Serving from cache (offline):', request.url);
      return cachedResponse;
    }
    return offlineFallbackResponse(request);
  }
}

// Network first for HTML — show offline page if completely offline
async function networkFirstWithOfflineFallback(request) {
  try {
    const networkResponse = await fetch(request);
    return networkResponse;
  } catch (error) {
    // Try cache first
    const cachedResponse = await caches.match(request);
    if (cachedResponse) return cachedResponse;

    // Return offline HTML
    return new Response(getOfflineHTML(), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}

// Stale while revalidate — serve from cache, update in background
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  const fetchPromise = fetch(request).then(networkResponse => {
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  }).catch(() => null);

  return cachedResponse || await fetchPromise || offlineFallbackResponse(request);
}

function offlineFallbackResponse(request) {
  return new Response(
    JSON.stringify({ error: 'You are offline', offline: true }),
    { status: 503, headers: { 'Content-Type': 'application/json' } }
  );
}

// ── OFFLINE PAGE HTML ─────────────────────────────────────────────
function getOfflineHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CampusConnect — Offline</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', sans-serif;
      background: #0F172A;
      color: #E2E8F0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 24px;
    }
    .card {
      background: #1E293B;
      border: 1px solid #6366F1;
      border-radius: 20px;
      padding: 48px 36px;
      max-width: 400px;
    }
    .icon { font-size: 4em; margin-bottom: 20px; }
    h1 { font-size: 1.6em; color: #6366F1; margin-bottom: 12px; }
    p { color: #94A3B8; line-height: 1.6; margin-bottom: 24px; font-size: 0.95em; }
    button {
      background: #6366F1;
      color: white;
      border: none;
      border-radius: 99px;
      padding: 12px 28px;
      font-size: 1em;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
    }
    button:hover { background: #4F46E5; transform: translateY(-1px); }
    .url { font-size: 0.75em; color: #38BDF8; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">📡</div>
    <h1>You're Offline</h1>
    <p>
      CampusConnect needs an internet connection to load.<br>
      Please check your Wi-Fi or mobile data and try again.
    </p>
    <button onclick="window.location.reload()">
      🔄 Try Again
    </button>
    <div class="url">connectsrec.in</div>
  </div>
</body>
</html>`;
}

// ── PUSH NOTIFICATIONS (Future) ───────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  const options = {
    body: data.body || 'New update on CampusConnect!',
    icon: '/static/icons/icon-192x192.png',
    badge: '/static/icons/icon-72x72.png',
    vibrate: [100, 50, 100],
    data: { url: data.url || '/dashboard' },
    actions: [
      { action: 'open', title: 'Open App' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };
  event.waitUntil(
    self.registration.showNotification(data.title || 'CampusConnect', options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = event.notification.data?.url || '/dashboard';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        for (const client of clientList) {
          if (client.url.includes(url) && 'focus' in client) {
            return client.focus();
          }
        }
        return clients.openWindow(url);
      })
  );
});

console.log('[SW] CampusConnect Service Worker loaded ✅');