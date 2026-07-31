/* ============================================================
   起動処理
   ------------------------------------------------------------
   他のファイルを読み込み終えてから動かすため、最後に置いています。
   ============================================================ */

'use strict';

(async () => {
  Store.load();

  // 外部のCSVファイルに問題があれば読み込む（無ければ内蔵データだけで動きます）
  if (typeof loadExternalQuestions === 'function') {
    try { await loadExternalQuestions(); } catch (e) { /* 失敗しても起動は続ける */ }
    if (typeof invalidateSearchIndex === 'function') invalidateSearchIndex();
  }

  goHome();
})();

// PWA（ホーム画面に追加・オフラインでの起動）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* デモでは失敗しても無視 */ });
  });
}
