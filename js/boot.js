/* ============================================================
   起動処理
   ------------------------------------------------------------
   他のファイルを読み込み終えてから動かすため、最後に置いています。
   ============================================================ */

'use strict';

(async () => {
  // js/config.js に場所が書かれていれば、サーバーの係を差しこみます。
  // 書かれていなければ、これまでどおり端末の中だけで動きます
  if (typeof Remote === 'object') Remote.install();

  /*
   * メールのリンク（?reset=…）から開かれたときは、
   * 何よりも先に「新しいパスワード」の画面を出します。
   */
  if (typeof openResetFromUrl === 'function' && await openResetFromUrl()) return;

  /*
   * サーバーを使う設定で、まだ入っていなければログイン画面を出します。
   * 誰の記録かが決まらないまま学習が溜まるのを防ぐためです。
   * 通信できないときは出しません（オフラインでも使えることを優先）。
   */
  if (typeof Login === 'object' && await Login.check()) {
    Login.show('');
    return;
  }

  // 記録の読み込み。サーバーを使うようになると通信が入るので待ちます
  await Store.load();

  // だれとして使っているか（第2段階の役割）。サーバーが無いあいだは生徒です
  if (typeof Auth === 'object') {
    await Auth.load();
    if (typeof applyRole === 'function') applyRole();
  }

  // 外部のCSVファイルに問題があれば読み込む（無ければ内蔵データだけで動きます）
  if (typeof loadExternalQuestions === 'function') {
    try { await loadExternalQuestions(); } catch (e) { /* 失敗しても起動は続ける */ }
    if (typeof invalidateSearchIndex === 'function') invalidateSearchIndex();
  }

  // 退室のスキャンを忘れたままの記録を締めておく
  if (typeof closeStaleSessions === 'function') closeStaleSessions();

  /*
   * お知らせ・コラム。
   * 通信できなければ端末の控えのままにします。
   * 待たずに進めたいところですが、ホームの「未読◯件」を
   * 出すために読み終わってから描き直します。
   */
  if (typeof Posts === 'object') {
    await Posts.load();
    if (typeof renderPostsCta === 'function') renderPostsCta();
  }

  goHome();
})();

// PWA（ホーム画面に追加・オフラインでの起動）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* デモでは失敗しても無視 */ });
  });
}
