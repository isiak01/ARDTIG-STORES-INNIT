const CACHE_NAME = 'ardtig-shell-v14';
const SHELL_FILES = [
  '/', '/index.html', '/css/site.css', '/css/pages.css', '/css/commerce.css', '/css/account.css',
  '/js/main.js', '/js/page-shell.js', '/js/theme.js', '/js/navbar.js', '/js/store.js', '/js/category.js', '/js/sharing.js', '/js/firebase.js', '/js/pwa.js',
  '/js/badges.js', '/js/member-session.js', '/js/members.js', '/js/leaderboard.js', '/js/help-a-friend.js', '/js/tournaments.js', '/js/host-tournament.js', '/js/auth-alias.js', '/js/banned-screen.js', '/js/topup.js', '/js/wallet-checkout.js',
  '/pages/auth.html', '/pages/onboarding.html', '/pages/terms.html', '/pages/freefire.html', '/pages/cod.html',
  '/pages/efootball.html', '/pages/diamonds.html', '/pages/view.html', '/pages/payment.html', '/pages/myaccounts.html', '/pages/sold.html',
  '/pages/members.html', '/pages/leaderboard.html', '/pages/help-a-friend.html', '/pages/tournaments.html', '/pages/admin/host-tournament.html', '/pages/wallet-checkout.html', '/login.html', '/signup.html', '/topup.html',
  '/logo.png', '/logo-192.png', '/logo-512.png', '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match('/index.html'))));
});
