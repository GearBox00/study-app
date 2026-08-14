/* ============================================================
   サービスワーカー
   ------------------------------------------------------------
   ホーム画面に追加でき、一度開いたあとは通信がなくても
   起動・学習できるようにするための仕組みです。
   （※これは「オフラインで学習できる」ところまで。
     オフライン中の解答記録をサーバーへ同期する仕組みは
     第2段階として別に設計が必要です）
   ============================================================ */

const CACHE = "manabi-card-v47";
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/merge.js',
  './js/storage.js',
  './js/auth.js',
  './js/roster.js',
  './js/config.js',
  './js/remote.js',
  './js/data.js',
  './js/app.js',
  './js/stamp.js',
  './js/dictation.js',
  './js/stroke.js',
  './js/tools.js',
  './js/posts.js',
  './js/boot.js',
  './vendor/jsqr.js',
  './vendor/qrcode.js',
  './vendor/jsqr-LICENSE.txt',
  './THIRD-PARTY-NOTICES.md',
  './questions/index.json',
  './questions/kanji-g1.csv',
  './questions/kanji-g2.csv',
  './questions/kanji-g3.csv',
  './questions/kanji-g4.csv',
  './questions/kanji-g5.csv',
  './questions/kanji-g6.csv',
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

/*
 * サーバーとのやりとり（ログイン・記録・名簿）は、絶対に保存しません。
 * 保存してしまうと、ログイン前の「あなたは生徒です」という返事が残り、
 * ログインしても生徒のままになります（2026-08-11に実際に起きました）。
 * 通信できないときも、古い返事を返すのではなく素直に失敗させます。
 * アプリ側（js/storage.js）が端末の記録に切り替えてくれるためです。
 */
function isServerCall(url) {
  return /\/server\//.test(url.pathname) || /\.php$/.test(url.pathname);
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  if (isServerCall(new URL(e.request.url))) return;   // 素通しにします

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
