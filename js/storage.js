/* ============================================================
   保存の出入り口（2026-08-10 追加）
   ------------------------------------------------------------
   学習の記録をどこへ保存するかを、このファイル1か所にまとめています。

   いまは端末の中（localStorage）だけに保存しています。
   第2段階でサーバーを使うようになったら、このファイルの
   Backend.remote に「サーバーとやりとりする係」を差しこむだけで
   切り替わります。アプリの他の場所は書き換えません。

   ■ なぜ「送ってから保存」ではなく「保存してから送る」なのか
     このアプリは通信がなくても学習できることを大事にしています。
     通信の返事を待ってから記録すると、電波の悪い教場で
     学習が止まってしまいます。
     そのため、まず端末に保存して即座に学習を続けられるようにし、
     サーバーへの送信はそのあと裏で行います。
     送れなかったぶんは端末に残り、次につながったときに送ります。
   ============================================================ */

'use strict';

const Backend = {
  /* 保存に使う名前。これを変えると既存の記録が読めなくなるので触らないこと */
  key: 'manabi-card-v2',

  /*
   * サーバーとやりとりする係。第2段階でここに入れます。
   * 次の3つを持つオブジェクトを想定しています（すべて Promise を返す）。
   *   pull()      … サーバーにある記録を取ってくる。無ければ null
   *   push(data)  … サーバーへ記録を送る
   *   whoami()    … いま誰としてログインしているか（役割の判定に使う）
   */
  remote: null,

  /* まだサーバーへ送れていない変更があるか。画面に出す用 */
  unsent: false,
  /* 最後に起きた送信の失敗。画面に出す用 */
  lastError: null,
  /* 保存の状況が変わったときに呼ばれる。画面側で差しかえます */
  onstatus: null,

  _timer: null,
  _sending: false,

  /* ---------- 端末の中への読み書き ---------- */

  readLocal() {
    try {
      return JSON.parse(localStorage.getItem(this.key));
    } catch (e) {
      return null;   // 壊れていたら「無い」ものとして扱う
    }
  },

  writeLocal(data) {
    try {
      localStorage.setItem(this.key, JSON.stringify(data));
      return true;
    } catch (e) {
      // 端末の保存領域がいっぱいのときにここへ来ます
      this.lastError = '端末に保存できませんでした。空き容量をご確認ください。';
      this._notify();
      return false;
    }
  },

  clearLocal() {
    try { localStorage.removeItem(this.key); } catch (e) { /* 消せなくても続行 */ }
  },

  /* ---------- 読み込み ---------- */

  /**
   * 記録を読み込みます。
   * サーバーを使う設定なら、サーバーにあるものを優先します。
   * 通信できないときは端末の中のものを使うので、オフラインでも起動できます。
   */
  async read() {
    if (this.remote) {
      try {
        const fromServer = await this.remote.pull();
        if (fromServer) {
          this.writeLocal(fromServer);   // 次に通信できないときのために控えを残す
          return fromServer;
        }
      } catch (e) {
        this.lastError = 'サーバーにつながらないため、この端末の記録で始めます。';
        this._notify();
      }
    }
    return this.readLocal();
  },

  /* ---------- 保存 ---------- */

  /**
   * 記録を保存します。
   * まず端末に保存し（ここは一瞬で終わります）、
   * サーバーを使う設定のときだけ、そのあと裏で送ります。
   * 呼び出す側は送信の完了を待ちません。
   */
  save(data) {
    const ok = this.writeLocal(data);
    if (!this.remote) return ok;

    this.unsent = true;
    this._notify();
    this._schedule(data);
    return ok;
  },

  /* 短い間に何度も保存されたときは、まとめて1回だけ送ります */
  _schedule(data) {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(data), 1200);
  },

  /**
   * ためている変更をサーバーへ送ります。
   * 失敗しても端末には残っているので、記録が消えることはありません。
   */
  async flush(data) {
    if (!this.remote || this._sending) return;
    this._sending = true;
    try {
      await this.remote.push(data || this.readLocal());
      this.unsent = false;
      this.lastError = null;
    } catch (e) {
      // 送れなかった。端末には残っているので、次の保存のときにまた試します
      this.lastError = 'サーバーへ送れませんでした。通信が戻ったときに送ります。';
    } finally {
      this._sending = false;
      this._notify();
    }
  },

  _notify() {
    if (typeof this.onstatus === 'function') {
      try { this.onstatus(this.unsent, this.lastError); } catch (e) { /* 画面側の都合で落とさない */ }
    }
  },

  /* ---------- 役割（第2段階で使います） ---------- */

  /**
   * いま誰としてログインしているかを返します。
   * サーバーを使わないあいだは、ログインの仕組みがないので
   * 「生徒」として扱います。第1段階の動きは変わりません。
   */
  async whoami() {
    if (this.remote && typeof this.remote.whoami === 'function') {
      try { return await this.remote.whoami(); } catch (e) { /* 下の既定値へ */ }
    }
    return { role: 'student', id: null, name: '', venue: null };
  },
};

/* 画面を閉じるときに、送りそびれがあれば最後に一度だけ試みます */
window.addEventListener('pagehide', () => {
  if (Backend.remote && Backend.unsent) Backend.flush();
});
