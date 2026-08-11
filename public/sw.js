// MKG Khảo Sát — minimal offline-first service worker.
// Navigation: network-first, cache fallback (works offline after first load).
// Hashed assets: cache-first (content-addressed, safe forever).
const CACHE = 'ks-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    if (e.request.method !== 'GET' || url.origin !== location.origin) return;

    if (e.request.mode === 'navigate') {
        e.respondWith(
            fetch(e.request)
                .then(res => {
                    const copy = res.clone();
                    caches.open(CACHE).then(c => c.put('/index.html', copy));
                    return res;
                })
                .catch(() => caches.match('/index.html'))
        );
        return;
    }

    if (url.pathname.startsWith('/assets/') || /\.(svg|png|webmanifest)$/.test(url.pathname)) {
        e.respondWith(
            caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
                const copy = res.clone();
                caches.open(CACHE).then(c => c.put(e.request, copy));
                return res;
            }))
        );
    }
});
