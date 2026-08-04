/* ============================================================
   サービスワーカー
   ------------------------------------------------------------
   ホーム画面に追加でき、一度開いたあとは通信がなくても
   起動・学習できるようにするための仕組みです。
   （※これは「オフラインで学習できる」ところまで。
     オフライン中の解答記録をサーバーへ同期する仕組みは
     第2段階として別に設計が必要です）
   ============================================================ */

const CACHE = "manabi-card-v21";
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/data.js',
  './js/app.js',
  './js/stamp.js',
  './js/dictation.js',
  './js/stroke.js',
  './js/tools.js',
  './js/boot.js',
  './vendor/jsqr.js',
  './vendor/qrcode.js',
  './questions/index.json',
  './questions/science-1.csv',
  './questions/english-dictation.csv',
  './questions/japanese-dictation.csv',
  './manifest.json',
  './kanji/list.json',
  './icon-192.png',
  './icon-512.png',
  './icon.svg',
];

/*
 * 保存するときは、必ずサーバーから取り直します。
 * ふつうの取得だと、配信側に残っている古いファイルが
 * 新しい版として保存されてしまい、利用者の画面が古いままになるためです。
 */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => Promise.all(
      ASSETS.map((url) =>
        fetch(new Request(url, { cache: 'reload' }))
          .then((res) => (res.ok ? c.put(url, res) : null))
          .catch(() => null)
      )
    ))
  );
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

/*
 * 問題データ（questions/ の中のファイル）は、あとから差し替えることがあります。
 * キャッシュ優先にすると古い問題が出続けてしまうため、
 * これらは「まず取りに行き、通信できないときだけキャッシュを使う」ようにします。
 */
function isQuestionFile(url) {
  return /\/questions\//.test(url.pathname);
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  if (isQuestionFile(new URL(e.request.url))) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // それ以外はキャッシュ優先。無ければ取りに行き、取れたら次回のために保存する
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
