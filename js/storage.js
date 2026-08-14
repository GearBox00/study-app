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
   * 「前にサーバーと一致していた時点」の控えと、その版番号。
   * 2台で使ったときに記録を突き合わせるために持ちます（js/merge.js）。
   * 控えは数だけなので、記録そのものより ずっと小さくなります。
   */
  baseKey: 'manabi-card-v2:base',
  rev: 0,

  /*
   * いま端末に入っている記録が「誰のものか」。
   * 教場のタブレットを何人かで使い回すと、前の人の記録が
   * 端末に残ったまま次の人がログインします。そのまま続けると
   * 前の人の学習が、次の人の記録に混ざってしまいます。
   * ログインした人と食い違ったら、端末の記録は捨てます。
   */
  ownerKey: 'manabi-card-v2:owner',

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
  /*
   * ほかの端末の記録と突き合わせた結果、いま持っている記録が
   * 変わったときに呼ばれます。画面側で読み直してもらうためです。
   */
  onmerged: null,
  /*
   * 前に使っていた人と違う人がログインしたときに呼ばれます。
   * 学習の記録のほかにも端末に控えているもの（お知らせなど）を
   * 捨ててもらうためです。
   */
  onuserchange: null,

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
    this.clearBase();
  },

  /* ---------- 突き合わせ用の控え ---------- */

  readBase() {
    try {
      return JSON.parse(localStorage.getItem(this.baseKey));
    } catch (e) {
      return null;   // 壊れていたら「無い」ものとして扱う（足さずに大きいほうを採ります）
    }
  },

  /** サーバーと一致した直後に呼びます。ここが次の突き合わせの基準になります */
  writeBase(data) {
    try {
      localStorage.setItem(this.baseKey, JSON.stringify(Merge.base(data)));
    } catch (e) {
      // 控えが残せなくても学習は続けられます。次は「大きいほう」を採ります
      this.clearBase();
    }
  },

  clearBase() {
    try { localStorage.removeItem(this.baseKey); } catch (e) { /* 消せなくても続行 */ }
  },

  /* ---------- 誰の記録か ---------- */

  readOwner() {
    try {
      const v = localStorage.getItem(this.ownerKey);
      return v ? Number(v) : null;
    } catch (e) {
      return null;
    }
  },

  writeOwner(id) {
    try {
      if (id) localStorage.setItem(this.ownerKey, String(id));
    } catch (e) { /* 残せなくても続行 */ }
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
        const res = await this.remote.pull() || {};
        this.rev = res.rev || 0;
        // 読めたので、前に出ていた通信の失敗は消します
        this.lastError = null;
        this._notify();
        const fromServer = res.data;

        /*
         * 前に使った人と違う人がログインしたら、
         * 端末に残っている記録は捨てます。
         * 教場のタブレットを持ち回っても、記録が混ざりません。
         *
         * 通信できないときはここを通らないので、
         * 誰のものか確かめられないまま端末の記録で始まります。
         * その状態で学習した分は、次にログインした人の記録に
         * 混ざらないよう、送る前にここで捨てられます。
         */
        const owner = this.readOwner();
        if (res.userId && owner && owner !== res.userId) {
          this.clearLocal();
          if (typeof this.onuserchange === 'function') {
            try { this.onuserchange(); } catch (e) { /* 画面側の都合で落とさない */ }
          }
        }
        this.writeOwner(res.userId);

        /*
         * この端末に、まだ送れていない学習が残っていることがあります
         * （通信が切れたまま使ったあと、別の端末で学習した場合など）。
         * そのまま上書きすると消えてしまうので、ここでも突き合わせます。
         */
        const mine = this.readLocal();
        if (!fromServer) return mine;              // サーバーにはまだ何も無い

        const merged = mine ? Merge.merge(mine, fromServer, this.readBase()) : fromServer;
        this.writeLocal(merged);                   // 通信できないときのために控えを残す

        /*
         * 控えは「いま受け取ったサーバーの記録」にします。
         * 突き合わせたあとの手元の記録は
         *   （サーバーの記録）＋（この端末だけの分）
         * になっているので、次に突き合わせるときの基準は
         * サーバーの記録のほうです。
         * ここを合わせた結果にしてしまうと、次の突き合わせで
         * 相手の分をもう一度足してしまいます。
         */
        this.writeBase(fromServer);

        if (JSON.stringify(merged) !== JSON.stringify(fromServer)) {
          // 端末にだけ残っていたぶんがあります。あらためて送ります
          this.unsent = true;
          this._notify();
          this._schedule();
        }
        return merged;
      } catch (e) {
        /*
         * まだログインしていないだけのとき（401）は、何も出しません。
         * 「つながらない」と出すと、通信の不具合と取り違えられるためです。
         */
        if (e && e.status !== 401) {
          this.lastError = 'サーバーにつながらないため、この端末の記録で始めます。';
          this._notify();
        }
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
    this._schedule();
    return ok;
  },

  /*
   * 短い間に何度も保存されたときは、まとめて1回だけ送ります。
   *
   * 送る中身をここで取っておかず、送る直前に端末から読み直します。
   * 待っているあいだに、ほかの端末の記録と突き合わせて中身が
   * 入れ替わることがあり、古いほうを送るとせっかく合わせた結果を
   * 上書きしてしまうためです。
   */
  _schedule() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 1200);
  },

  /**
   * ためている変更をサーバーへ送ります。
   * 失敗しても端末には残っているので、記録が消えることはありません。
   */
  async flush() {
    if (!this.remote || this._sending) return;
    this._sending = true;
    try {
      let payload = this.readLocal();
      let base = this.readBase();

      /*
       * ほかの端末が先に保存していると 409 が返ります。
       * そのときはサーバーの記録と突き合わせてから送り直します。
       * 送り直しのあいだにさらに別の端末が保存することもあるので、
       * 数回まで繰り返します。
       */
      for (let i = 0; ; i++) {
        try {
          const res = await this.remote.push(payload, this.rev);
          if (res && typeof res.rev === 'number') this.rev = res.rev;
          break;
        } catch (e) {
          if (e.status !== 409 || i >= 3 || !e.data) throw e;
          this.rev = e.data.rev || 0;
          payload = Merge.merge(payload, e.data.data, base);
          /*
           * 次にもう一度断られたときのために、基準を
           * 「いま突き合わせた相手」に進めます。
           * ここを進めないと、相手の分を二度足してしまいます。
           */
          base = Merge.base(e.data.data);
          this.writeLocal(payload);
          this._merged(payload);
        }
      }

      this.writeBase(payload);
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

  /* 突き合わせで記録が変わったことを画面側へ知らせます */
  _merged(data) {
    if (typeof this.onmerged === 'function') {
      try { this.onmerged(data); } catch (e) { /* 画面側の都合で落とさない */ }
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
