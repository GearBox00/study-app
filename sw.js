/* ============================================================
   サービスワーカー
   ------------------------------------------------------------
   ホーム画面に追加でき、一度開いたあとは通信がなくても
   起動・学習できるようにするための仕組みです。
   問題ファイルもすべて先読みしますので、一度開いたあとは
   まだ触っていない教材でも通信なしで学習できます。
   （オフライン中の記録は端末に残り、つながったときに
     js/merge.js がサーバーの分と足し合わせます：2026-08-14）
   ============================================================ */

const CACHE = "manabi-card-v74";
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
  './js/login.js',
  './js/boot.js',
  './vendor/jsqr.js',
  './vendor/qrcode.js',
  './vendor/jsqr-LICENSE.txt',
  './THIRD-PARTY-NOTICES.md',
  /* ★問題ファイル ここから（検証/sync_sw_assets.py が作ります） */
  './questions/index.json',
  './questions/eng-g7-1.csv',
  './questions/eng-g7-2.csv',
  './questions/eng-g7-3.csv',
  './questions/eng-g7-4.csv',
  './questions/eng-g7-5.csv',
  './questions/eng-g7-6.csv',
  './questions/kanji-g1.csv',
  './questions/kanji-g2.csv',
  './questions/kanji-g3.csv',
  './questions/kanji-g4.csv',
  './questions/kanji-g5.csv',
  './questions/kanji-g6.csv',
  './questions/science-1.csv',
  './questions/english-dictation.csv',
  './questions/japanese-dictation.csv',
  './questions/eiken5-1.csv',
  './questions/eiken5-2.csv',
  './questions/eiken5-3.csv',
  './questions/eiken5-4.csv',
  './questions/eiken5-5.csv',
  './questions/eiken5-6.csv',
  './questions/eiken5-7.csv',
  './questions/eiken5-8.csv',
  './questions/eiken5-9.csv',
  './questions/eiken5-10.csv',
  './questions/eiken5-11.csv',
  './questions/eiken5-12.csv',
  './questions/eiken5-13.csv',
  './questions/eiken5-14.csv',
  './questions/eiken5-15.csv',
  './questions/eiken5-16.csv',
  './questions/eiken5-17.csv',
  './questions/eiken5-18.csv',
  './questions/eiken5-19.csv',
  './questions/eiken5-20.csv',
  './questions/eiken5-21.csv',
  './questions/eiken4-1.csv',
  './questions/eiken4-2.csv',
  './questions/eiken4-3.csv',
  './questions/eiken4-4.csv',
  './questions/eiken4-5.csv',
  './questions/eiken4-6.csv',
  './questions/eiken4-7.csv',
  './questions/eiken4-8.csv',
  './questions/eiken4-9.csv',
  './questions/eiken4-10.csv',
  './questions/eiken4-11.csv',
  './questions/eiken4-12.csv',
  './questions/eiken4-13.csv',
  './questions/eiken4-14.csv',
  './questions/eiken4-15.csv',
  './questions/eiken4-16.csv',
  './questions/eiken4-17.csv',
  './questions/eiken4-18.csv',
  './questions/eiken4-19.csv',
  './questions/eiken4-20.csv',
  './questions/eiken4-21.csv',
  './questions/eiken4-22.csv',
  './questions/eiken4-23.csv',
  './questions/eiken4-24.csv',
  './questions/eiken4-25.csv',
  './questions/eiken4-26.csv',
  './questions/eiken3-1.csv',
  './questions/eiken3-2.csv',
  './questions/eiken3-3.csv',
  './questions/eiken3-4.csv',
  './questions/eiken3-5.csv',
  './questions/eiken3-6.csv',
  './questions/eiken3-7.csv',
  './questions/eiken3-8.csv',
  './questions/eiken3-9.csv',
  './questions/eiken3-10.csv',
  './questions/eiken3-11.csv',
  './questions/eiken3-12.csv',
  './questions/eiken3-13.csv',
  './questions/eiken3-14.csv',
  './questions/eiken3-15.csv',
  './questions/eiken3-16.csv',
  './questions/eiken3-17.csv',
  './questions/eiken3-18.csv',
  './questions/eiken3-19.csv',
  './questions/eiken3-20.csv',
  './questions/eiken3-21.csv',
  './questions/eiken3-22.csv',
  './questions/eiken3-23.csv',
  './questions/eiken3-24.csv',
  './questions/eiken3-25.csv',
  './questions/eiken2j-1.csv',
  './questions/eiken2j-2.csv',
  './questions/eiken2j-3.csv',
  './questions/eiken2j-4.csv',
  './questions/eiken2j-5.csv',
  './questions/eiken2j-6.csv',
  './questions/eiken2j-7.csv',
  './questions/eiken2j-8.csv',
  './questions/eiken2j-9.csv',
  './questions/eiken2j-10.csv',
  './questions/eiken2j-11.csv',
  './questions/eiken2j-12.csv',
  './questions/eiken2j-13.csv',
  './questions/eiken2j-14.csv',
  './questions/eiken2j-15.csv',
  './questions/eiken2j-16.csv',
  './questions/eiken2j-17.csv',
  './questions/eiken2j-18.csv',
  './questions/eiken2j-19.csv',
  './questions/eiken2j-20.csv',
  './questions/eiken2j-21.csv',
  './questions/eiken2j-22.csv',
  './questions/eiken2j-23.csv',
  './questions/eiken2j-24.csv',
  './questions/eiken2j-25.csv',
  './questions/eiken2j-26.csv',
  './questions/eiken2j-27.csv',
  './questions/eiken2j-28.csv',
  './questions/eiken2j-29.csv',
  './questions/eiken2j-30.csv',
  './questions/eiken2j-31.csv',
  './questions/eiken2j-32.csv',
  './questions/eiken2j-33.csv',
  './questions/eiken2j-34.csv',
  './questions/eiken2j-35.csv',
  './questions/eiken2j-36.csv',
  './questions/eiken2-1.csv',
  './questions/eiken2-2.csv',
  './questions/eiken2-3.csv',
  './questions/eiken2-4.csv',
  './questions/eiken2-5.csv',
  './questions/eiken2-6.csv',
  './questions/eiken2-7.csv',
  './questions/eiken2-8.csv',
  './questions/eiken2-9.csv',
  './questions/eiken2-10.csv',
  './questions/eiken2-11.csv',
  './questions/eiken2-12.csv',
  './questions/eiken2-13.csv',
  './questions/eiken2-14.csv',
  './questions/eiken2-15.csv',
  './questions/eiken2-16.csv',
  './questions/eiken2-17.csv',
  './questions/eiken2-18.csv',
  './questions/eiken2-19.csv',
  './questions/eiken2-20.csv',
  './questions/eiken2-21.csv',
  './questions/eiken2-22.csv',
  './questions/eiken2-23.csv',
  './questions/eiken2-24.csv',
  './questions/eiken2-25.csv',
  './questions/eiken2-26.csv',
  './questions/eiken2-27.csv',
  './questions/eiken2-28.csv',
  './questions/eiken2-29.csv',
  './questions/esch-1.csv',
  './questions/esch-2.csv',
  './questions/esch-3.csv',
  './questions/esch-4.csv',
  './questions/esch-5.csv',
  './questions/esch-6.csv',
  './questions/esch-7.csv',
  './questions/esch-8.csv',
  './questions/esch-9.csv',
  './questions/esch-10.csv',
  './questions/esch-11.csv',
  './questions/esch-12.csv',
  './questions/esch-13.csv',
  './questions/esch-14.csv',
  './questions/esch-15.csv',
  './questions/esch-16.csv',
  './questions/esch-17.csv',
  './questions/esch-18.csv',
  './questions/esch-19.csv',
  './questions/esch-20.csv',
  './questions/esch-21.csv',
  './questions/esch-22.csv',
  './questions/esch-23.csv',
  './questions/esch-24.csv',
  './questions/esch-25.csv',
  './questions/esch-26.csv',
  './questions/esch-27.csv',
  './questions/esch-28.csv',
  './questions/esch-29.csv',
  './questions/esch-30.csv',
  './questions/esch-31.csv',
  './questions/esch-32.csv',
  './questions/esch-33.csv',
  './questions/jsch-1.csv',
  './questions/jsch-2.csv',
  './questions/jsch-3.csv',
  './questions/jsch-4.csv',
  './questions/jsch-5.csv',
  './questions/jsch-6.csv',
  './questions/jsch-7.csv',
  './questions/jsch-8.csv',
  './questions/jsch-9.csv',
  './questions/jsch-10.csv',
  './questions/jsch-11.csv',
  './questions/jsch-12.csv',
  './questions/jsch-13.csv',
  './questions/jsch-14.csv',
  './questions/jsch-15.csv',
  './questions/jsch-16.csv',
  './questions/jsch-17.csv',
  './questions/jsch-18.csv',
  './questions/jsch-19.csv',
  './questions/jsch-20.csv',
  './questions/jsch-21.csv',
  './questions/jsch-22.csv',
  './questions/jsch-23.csv',
  './questions/jsch-24.csv',
  './questions/jsch-25.csv',
  './questions/jsch-26.csv',
  './questions/jsch-27.csv',
  './questions/jsch-28.csv',
  './questions/jsch-29.csv',
  './questions/jsch-30.csv',
  './questions/jsch-31.csv',
  './questions/jsch-32.csv',
  './questions/jsch-33.csv',
  './questions/jsch-34.csv',
  './questions/jsch-35.csv',
  './questions/jsch-36.csv',
  './questions/jsch-37.csv',
  './questions/jsch-38.csv',
  './questions/jsch-39.csv',
  './questions/jsch-40.csv',
  './questions/jsch-41.csv',
  './questions/jsch-42.csv',
  './questions/jsch-43.csv',
  './questions/jsch-44.csv',
  './questions/jsch-45.csv',
  './questions/jsch-46.csv',
  './questions/jsch-47.csv',
  './questions/jsch-48.csv',
  './questions/jsch-49.csv',
  './questions/jsch-50.csv',
  './questions/jsch-51.csv',
  './questions/jsch-52.csv',
  './questions/jsch-53.csv',
  './questions/jsch-54.csv',
  './questions/jsch-55.csv',
  './questions/jsch-56.csv',
  './questions/jsch-57.csv',
  './questions/jsch-58.csv',
  './questions/jsch-59.csv',
  './questions/jsch-60.csv',
  './questions/jsch-61.csv',
  './questions/hsch-1.csv',
  './questions/hsch-2.csv',
  './questions/hsch-3.csv',
  './questions/hsch-4.csv',
  './questions/hsch-5.csv',
  './questions/hsch-6.csv',
  './questions/hsch-7.csv',
  './questions/hsch-8.csv',
  './questions/hsch-9.csv',
  './questions/hsch-10.csv',
  './questions/hsch-11.csv',
  './questions/hsch-12.csv',
  './questions/hsch-13.csv',
  './questions/hsch-14.csv',
  './questions/hsch-15.csv',
  './questions/hsch-16.csv',
  './questions/hsch-17.csv',
  './questions/hsch-18.csv',
  './questions/hsch-19.csv',
  './questions/hsch-20.csv',
  './questions/hsch-21.csv',
  './questions/hsch-22.csv',
  './questions/hsch-23.csv',
  './questions/hsch-24.csv',
  './questions/hsch-25.csv',
  './questions/hsch-26.csv',
  './questions/hsch-27.csv',
  './questions/hsch-28.csv',
  './questions/hsch-29.csv',
  './questions/hsch-30.csv',
  './questions/hsch-31.csv',
  './questions/hsch-32.csv',
  './questions/hsch-33.csv',
  './questions/hsch-34.csv',
  './questions/hsch-35.csv',
  './questions/hsch-36.csv',
  './questions/hsch-37.csv',
  './questions/hsch-38.csv',
  './questions/hsch-39.csv',
  './questions/hsch-40.csv',
  './questions/hsch-41.csv',
  './questions/hsch-42.csv',
  './questions/hsch-43.csv',
  './questions/hsch-44.csv',
  './questions/hsch-45.csv',
  './questions/hsch-46.csv',
  './questions/hsch-47.csv',
  './questions/hsch-48.csv',
  './questions/hsch-49.csv',
  './questions/hsch-50.csv',
  './questions/hsch-51.csv',
  './questions/hsch-52.csv',
  './questions/hsch-53.csv',
  './questions/hsch-54.csv',
  './questions/hsch-55.csv',
  './questions/hsch-56.csv',
  './questions/hsch-57.csv',
  './questions/hsch-58.csv',
  './questions/hsch-59.csv',
  './questions/hsch-60.csv',
  './questions/hsch-61.csv',
  './questions/hsch-62.csv',
  './questions/hsch-63.csv',
  './questions/hsch-64.csv',
  './questions/hsch-65.csv',
  './questions/hsch-66.csv',
  './questions/hsch-67.csv',
  './questions/hsch-68.csv',
  './questions/hsch-69.csv',
  './questions/hsch-70.csv',
  './questions/hsch-71.csv',
  './questions/hsch-72.csv',
  './questions/hsch-73.csv',
  './questions/hsch-74.csv',
  './questions/hsch-75.csv',
  './questions/hsch-76.csv',
  './questions/hsch-77.csv',
  './questions/hsch-78.csv',
  './questions/hsch-79.csv',
  './questions/hsch-80.csv',
  './questions/hsch-81.csv',
  './questions/hsch-82.csv',
  './questions/hsch-83.csv',
  './questions/hsch-84.csv',
  './questions/hsch-85.csv',
  './questions/hsch-86.csv',
  './questions/hsch-87.csv',
  './questions/hsch-88.csv',
  './questions/hsch-89.csv',
  './questions/hsch-90.csv',
  './questions/hsch-91.csv',
  './questions/hsch-92.csv',
  './questions/hsch-93.csv',
  './questions/hsch-94.csv',
  './questions/hsch-95.csv',
  './questions/hsch-96.csv',
  './questions/hsch-97.csv',
  './questions/shakai-1.csv',
  './questions/shakai-2.csv',
  './questions/shakai-3.csv',
  './questions/shakai-4.csv',
  './questions/shakai-5.csv',
  './questions/shakai-6.csv',
  './questions/shakai-7.csv',
  './questions/images/map-hokkaido-tohoku.png',
  './questions/images/map-kanto.png',
  './questions/images/map-chubu.png',
  './questions/images/map-kinki.png',
  './questions/images/map-chugoku-shikoku.png',
  './questions/images/map-kyushu-okinawa.png',
  /* ★問題ファイル ここまで */
  './manifest.json',
  './kanji/list.json',
  './logo.png',
  './icon-192.png',
  './icon-512.png',
  './icon.svg',
];

/*
 * 保存するときは、必ずサーバーから取り直します。
 * ふつうの取得だと、配信側に残っている古いファイルが
 * 新しい版として保存されてしまい、利用者の画面が古いままになるためです。
 */
/*
 * 一度に全部取りに行くと、携帯の回線では詰まってしまいます。
 * （問題ファイルが増え、300件近くになったためです：2026-08-19）
 * そこで12件ずつ、順番に取るようにしています。
 */
const CHUNK = 12;

async function cacheAll(cache, urls) {
  for (let i = 0; i < urls.length; i += CHUNK) {
    await Promise.all(urls.slice(i, i + CHUNK).map((url) =>
      fetch(new Request(url, { cache: 'reload' }))
        .then((res) => (res.ok ? cache.put(url, res) : null))
        .catch(() => null)
    ));
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => cacheAll(c, ASSETS)));
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
