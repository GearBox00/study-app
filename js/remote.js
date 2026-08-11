/* ============================================================
   サーバーとやりとりする係
   ------------------------------------------------------------
   2026-08-11 追加。第2段階でサーバーを使うときに差しこみます。

   ■ 使い方
     js/config.js を作って、次の1行を書くだけです。
        const SERVER_BASE = 'server/api/';
     この1行があるときだけサーバーにつなぎます。
     無ければ、これまでどおり端末の中だけで動きます。

   ■ アプリ本体は書き換えません
     Backend.remote と Roster.remote に、この係を入れるだけです。
   ============================================================ */

'use strict';

const Remote = {
  base: '',

  /** サーバーを使う設定になっているか */
  get enabled() { return !!this.base; },

  async _call(path, opts) {
    const o = opts || {};
    const res = await fetch(this.base + path, {
      method: o.method || 'GET',
      // 席（ログインの状態）を持ち回るために必要です
      credentials: 'include',
      headers: o.body ? { 'Content-Type': 'application/json' } : {},
      body: o.body ? JSON.stringify(o.body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch (e) { /* 返事が壊れていた */ }

    if (!res.ok || !json || json.ok !== true) {
      const err = new Error((json && json.error) || `通信に失敗しました（${res.status}）`);
      err.status = res.status;
      throw err;
    }
    return json.data;
  },

  /* ---------- ログイン ---------- */

  login(loginId, password) {
    return this._call('login.php', { method: 'POST', body: { loginId, password } });
  },

  logout() {
    return this._call('logout.php', { method: 'POST' });
  },

  /* ---------- js/storage.js から呼ばれます ---------- */

  recordStore() {
    return {
      pull: () => this._call('record.php'),
      push: (data) => this._call('record.php', { method: 'POST', body: { data } }),
      whoami: () => this._call('whoami.php'),
    };
  },

  /* ---------- 入退室（js/stamp.js から呼ばれます） ---------- */

  /**
   * 入室・退室をサーバーへ知らせます。
   * 保護者へのお知らせメールは、サーバー側が送ります。
   */
  attendance(kind, minutes) {
    return this._call('attendance.php', {
      method: 'POST',
      body: { kind, minutes: minutes == null ? null : minutes },
    });
  },

  /* ---------- アカウントの発行（運営者だけ） ---------- */

  accounts() { return this._call('accounts.php'); },
  createAccount(v) { return this._call('accounts.php', { method: 'POST', body: { do: 'create', ...v } }); },
  resetPassword(id) { return this._call('accounts.php', { method: 'POST', body: { do: 'reset', id } }); },
  setAccountEnabled(id, on) {
    return this._call('accounts.php', { method: 'POST', body: { do: on ? 'enable' : 'disable', id } });
  },
  addVenue(venueId, venueName) {
    return this._call('accounts.php', { method: 'POST', body: { do: 'addVenue', venueId, venueName } });
  },

  /* ---------- 保護者メールの設定（運営者だけ） ---------- */

  mailSettings() { return this._call('mailsettings.php'); },
  saveMailSettings(values) {
    return this._call('mailsettings.php', { method: 'POST', body: values });
  },

  /* ---------- js/roster.js から呼ばれます ---------- */

  rosterStore() {
    return {
      /*
       * しぼりこみはサーバー側でも行いますが、
       * ここでは全件をもらって画面側でしぼります。
       * 数百名までなら十分に速く、通信の回数も減らせるためです。
       * 千名を超えるようになったら、条件をURLに付けて渡します。
       */
      list: () => this._call('students.php?enroll=all'),

      /*
       * 名簿はサーバーが持ち主なので、まるごと上書きはしません。
       * 変えるのは在籍の状態だけで、それは setEnroll から呼ばれます。
       */
      save: async () => { /* 何もしません */ },

      setEnroll: (id, enroll) =>
        this._call('students.php', { method: 'POST', body: { id, enroll } }),
    };
  },

  /* ---------- 差しこみ ---------- */

  /**
   * サーバーを使う設定なら、保存と名簿の係を差しこみます。
   * 起動時（js/boot.js）に一度だけ呼びます。
   */
  install() {
    if (typeof SERVER_BASE === 'undefined' || !SERVER_BASE) return false;
    this.base = SERVER_BASE;
    Backend.remote = this.recordStore();
    Roster.remote = this.rosterStore();
    return true;
  },
};
