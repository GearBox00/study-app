/* ============================================================
   サービスワーカー
   ------------------------------------------------------------
   ホーム画面に追加でき、一度開いたあとは通信がなくても
   起動・学習できるようにするための仕組みです。
   （※これは「オフラインで学習できる」ところまで。
     オフライン中の解答記録をサーバーへ同期する仕組みは
     第2段階として別に設計が必要です）
   ============================================================ */

const CACHE = "manabi-card-v10";
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/data.js',
  './js/app.js',
  './js/stamp.js',
  './js/tools.js',
  './js/boot.js',
  './vendor/jsqr.js',
  './vendor/qrcode.js',
  './questions/index.json',
  './questions/science-1.csv',
  './manifest.json',
  './icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// キャッシュ優先。無ければ取りに行き、取れたら次回のために保存する
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
