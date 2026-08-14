/* ============================================================
   ログインと、パスワードの再設定（2026-08-14 追加）
   ------------------------------------------------------------
   ■ サーバーにつないでいるときだけ働きます
     js/config.js に場所が書かれていないあいだは、これまでどおり
     端末の中だけで動き、ログイン画面は出しません。

   ■ 入っていないときは、ほかの画面を触らせません
     ログインしていない状態で学習を始めると、記録の持ち主が
     決まらないまま溜まってしまいます。先に誰なのかを決めます。

   ■ パスワードを忘れたとき
     ログインIDを送ると、登録のメール宛に使い捨てのリンクが届きます。
     生徒さんは保護者の方のアドレス、先生と運営者は本人のアドレスです。
     判定はすべてサーバー側（server/api/reset.php）にあります。
   ============================================================ */

'use strict';

const Login = {
  /* いま「入っていない」状態か */
  needed: false,

  /**
   * ログインが要るかどうかを調べます。
   * 要るときは、ほかの画面に進ませずログイン画面を出します。
   */
  async check() {
    if (!Remote.enabled) { this.needed = false; return false; }
    let me = null;
    try {
      me = await Remote.whoami();
    } catch (e) {
      /*
       * 通信できないときは、ログイン画面を出しません。
       * オフラインでも学習を続けられることを大事にしているためです。
       * 送りそびれた記録は、次につながったときに持ち主を確かめます。
       */
      this.needed = false;
      return false;
    }
    this.needed = !me || !me.id;
    return this.needed;
  },

  show(message) {
    $('loginError').hidden = !message;
    $('loginError').textContent = message || '';
    $('loginId').value = '';
    $('loginPw').value = '';
    show('login', 'ログイン');
    // 戻るボタンは出しません。ここから先へ進んでほしいためです
    $('backBtn').hidden = true;
  },
};

/* ---------- ログイン ---------- */

$('loginShow').onchange = () => {
  $('loginPw').type = $('loginShow').checked ? 'text' : 'password';
};

async function doLogin() {
  const id = $('loginId').value.trim();
  const pw = $('loginPw').value;
  const err = $('loginError');

  if (!id || !pw) {
    err.hidden = false;
    err.textContent = 'ログインIDとパスワードを入れてください。';
    return;
  }

  const btn = $('loginGo');
  btn.disabled = true;
  btn.textContent = 'ログインしています…';
  try {
    await Remote.login(id, pw);
    Login.needed = false;

    /*
     * 記録・役割・お知らせを、その人のものに入れ直します。
     * 前に使っていた人のものが端末に残っていれば、
     * js/storage.js の持ち主の判定で捨てられます。
     */
    await Auth.load();
    await Store.load();
    if (typeof Posts === 'object') await Posts.clearCache();
    if (typeof Posts === 'object') await Posts.load();
    applyRole();
    goHome();
    toast('ログインしました');
  } catch (e) {
    err.hidden = false;
    err.textContent = e.message;
    $('loginPw').value = '';
  } finally {
    btn.disabled = false;
    btn.textContent = 'ログインする';
  }
}

$('loginGo').onclick = doLogin;
/* パスワードの欄で Enter を押しても入れるようにします */
$('loginPw').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
$('loginId').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('loginPw').focus(); });

/* ---------- ログアウト ---------- */

async function doLogout() {
  if (!Remote.enabled) return;
  if (!confirm('ログアウトします。よろしいですか。')) return;
  try { await Remote.logout(); } catch (e) { /* つながらなくても画面は戻します */ }

  /*
   * この端末に残っている記録と、お知らせの控えを消します。
   * 教場のタブレットを次の方が使うときに、前の方の内容が
   * 見えてしまわないようにするためです。
   */
  Backend.clearLocal();
  if (typeof Posts === 'object') Posts.clearCache();
  await Store.load();
  await Auth.load();
  applyRole();
  Login.show('ログアウトしました。');
}

$('logoutLink').onclick = doLogout;

/* ---------- パスワードを忘れたとき ---------- */

$('loginForgot').onclick = () => {
  $('forgotId').value = $('loginId').value.trim();
  $('forgotResult').hidden = true;
  show('forgot', 'パスワードを忘れたとき');
  $('backBtn').hidden = true;
};

$('forgotBack').onclick = () => Login.show('');

$('forgotGo').onclick = async () => {
  const id = $('forgotId').value.trim();
  const box = $('forgotResult');
  const btn = $('forgotGo');

  if (!id) {
    box.hidden = false;
    box.textContent = 'ログインIDを入れてください。';
    return;
  }
  btn.disabled = true;
  btn.textContent = '送っています…';
  try {
    const r = await Remote.resetRequest(id);
    box.hidden = false;
    box.textContent = r.message;
    /*
     * 送れたかどうかにかかわらず、同じ文言が返ります。
     * 「そのIDはあります」と分かると、順に試して
     * 在籍者を探られてしまうためです。
     */
  } catch (e) {
    box.hidden = false;
    box.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '再設定のご案内を送る';
  }
};

/* ---------- 新しいパスワードを決める ---------- */

let resetToken = '';

$('newPwShow').onchange = () => {
  const t = $('newPwShow').checked ? 'text' : 'password';
  $('newPw1').type = t;
  $('newPw2').type = t;
};

/**
 * メールのリンクから開かれたときに呼びます。
 * アドレスの ?reset=… に合言葉が入っています。
 */
async function openResetFromUrl() {
  const token = new URLSearchParams(location.search).get('reset');
  if (!token || !Remote.enabled) return false;

  /* アドレス欄から合言葉を消します。履歴や共有から漏れないようにします */
  history.replaceState(null, '', location.pathname);

  try {
    const r = await Remote.resetCheck(token);
    resetToken = token;
    $('newpwWho').textContent = `ログインID「${r.loginId}」の新しいパスワードを決めます。`;
    $('newpwError').hidden = true;
    $('newPw1').value = '';
    $('newPw2').value = '';
    show('newpw', '新しいパスワード');
    $('backBtn').hidden = true;
    return true;
  } catch (e) {
    Login.show(e.message);
    return true;
  }
}

$('newpwGo').onclick = async () => {
  const a = $('newPw1').value;
  const b = $('newPw2').value;
  const err = $('newpwError');
  const btn = $('newpwGo');

  if (a !== b) {
    err.hidden = false;
    err.textContent = '2つの欄が同じではありません。';
    return;
  }
  btn.disabled = true;
  btn.textContent = '変えています…';
  try {
    const r = await Remote.resetCommit(resetToken, a);
    resetToken = '';
    Login.show(r.message);
  } catch (e) {
    err.hidden = false;
    err.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'このパスワードにする';
  }
};
