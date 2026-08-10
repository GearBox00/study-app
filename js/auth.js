/* ============================================================
   だれとして使っているか（役割）
   ------------------------------------------------------------
   2026-08-10 追加。第2段階の「生徒／先生／運営者」の作り分けです。

   ■ いまは「仮のログイン」です
     サーバーがまだ無いので、この端末の中だけで役割を切り替えます。
     サーバーができたら Backend.remote を差しこむだけで、
     本物のログインに切り替わります。画面側は書き換えません。

   ■ ここが鍵ではないことに注意してください
     画面の出し分けは「うっかり触らせない」ための目隠しです。
     端末の中を調べれば役割は書き換えられます。
     本当に守るのはサーバー側です。サーバーを入れるときは、
     「先生は自分の教場の生徒しか読めない」といった判定を
     必ずサーバーにも同じように書いてください。
     ここに書いてあるのは、そのときの仕様書も兼ねています。
   ============================================================ */

'use strict';

/* 役割の名前。サーバー側でも同じ文字を使います */
const ROLE = {
  STUDENT: 'student',   // 生徒
  TEACHER: 'teacher',   // 先生
  ADMIN: 'admin',       // 運営者（佐藤様おひとり）
};

const ROLE_LABEL = {
  student: '生徒',
  teacher: '先生',
  admin: '運営者',
};

/* 在籍の状態（G のご指定） */
const ENROLL = {
  ACTIVE: 'active',    // 在籍
  PAUSED: 'paused',    // 休塾（一定期間のお休み）
  LEFT: 'left',        // 退塾（データは残す）
};

const ENROLL_LABEL = {
  active: '在籍',
  paused: '休塾',
  left: '退塾',
};

/*
 * できること／できないことの一覧。
 * 画面の出し分けはすべてここを見て決めます。
 * 条件を変えたいときは、この表だけを直してください。
 *
 * ※ A〜G のご指定にそのまま対応しています
 *    B 先生は自分の教場の生徒だけ
 *    C 先生は個人情報を見られず、成績のみ
 *    D 先生アカウントの発行は運営者のみ
 *    F 運営者は佐藤様のみ
 */
const PERMISSIONS = {
  /* 学習する */
  study:            [ROLE.STUDENT, ROLE.TEACHER, ROLE.ADMIN],
  /* 自分の記録を見る */
  ownRecord:        [ROLE.STUDENT, ROLE.TEACHER, ROLE.ADMIN],
  /* 問題を作る・直す・配る */
  manageQuestions:  [ROLE.TEACHER, ROLE.ADMIN],
  /* 紙のテストを作る */
  printTest:        [ROLE.TEACHER, ROLE.ADMIN],
  /* 生徒の成績を見る（B：先生は自分の教場だけ。範囲は canSeeStudent で判定） */
  viewGrades:       [ROLE.TEACHER, ROLE.ADMIN],
  /* 生徒の個人情報（氏名・保護者の連絡先）を見る（C：先生は不可） */
  viewPersonal:     [ROLE.ADMIN],
  /* 生徒の在籍・休塾・退塾を切り替える */
  changeEnrollment: [ROLE.ADMIN],
  /* 先生のアカウントを発行する（D：運営者のみ） */
  manageTeachers:   [ROLE.ADMIN],
  /* すべての教場を横断して見る（B：先生は不可） */
  viewAllVenues:    [ROLE.ADMIN],
  /* 保護者へのメール送信の設定 */
  manageMail:       [ROLE.ADMIN],
};

const Auth = {
  /* いまの利用者。ログインしていないあいだは生徒として扱います */
  me: { role: ROLE.STUDENT, id: null, name: '', venue: null },

  /* 仮のログインの保存先。学習記録とは別の名前にしています */
  mockKey: 'manabi-card:mock-login',

  /* 役割が変わったときに呼ばれます。画面側で差しかえます */
  onchange: null,

  /**
   * いまの役割を読み込みます。
   * サーバーがあればサーバーに聞き、無ければ仮のログインを見ます。
   */
  async load() {
    if (Backend.remote) {
      this.me = await Backend.whoami();
    } else {
      this.me = this._readMock() || { role: ROLE.STUDENT, id: null, name: '', venue: null };
    }
    this._notify();
    return this.me;
  },

  /**
   * 役割による出し分けを効かせるかどうか。
   * 第1段階は1台を先生と生徒が共用する使い方なので、
   * 役割を選ぶまでは、これまでどおり全部の機能が見えます。
   * サーバーにつないだとき、または仮ログインしたときだけ効きます。
   */
  get enforcing() {
    return !!Backend.remote || !!this._readMock();
  },

  /** その操作をしてよいか。画面の出し分けはすべてこれで判断します */
  can(action) {
    const allowed = PERMISSIONS[action];
    if (!allowed) return false;      // 知らない操作は許さない
    if (!this.enforcing) return true;  // 役割を選ぶ前は、これまでどおり
    return allowed.indexOf(this.me.role) !== -1;
  },

  /**
   * その生徒の記録を見てよいか（B のご指定）。
   * 運営者はすべて、先生は自分の教場の生徒だけです。
   */
  canSeeStudent(student) {
    if (!student) return false;
    if (this.me.role === ROLE.ADMIN) return true;
    if (this.me.role === ROLE.TEACHER) return student.venue === this.me.venue;
    // 生徒は自分のぶんだけ
    return student.id != null && student.id === this.me.id;
  },

  /** 名前や連絡先を出してよいか（C のご指定） */
  canSeePersonalOf(student) {
    return this.can('viewPersonal') && this.canSeeStudent(student);
  },

  isStudent() { return this.me.role === ROLE.STUDENT; },
  isTeacher() { return this.me.role === ROLE.TEACHER; },
  isAdmin()   { return this.me.role === ROLE.ADMIN; },
  label()     { return ROLE_LABEL[this.me.role] || '生徒'; },

  /* ---------- 仮のログイン（サーバーができるまでの間だけ） ---------- */

  _readMock() {
    try {
      const v = JSON.parse(localStorage.getItem(this.mockKey));
      return (v && PERMISSIONS.study.indexOf(v.role) !== -1) ? v : null;
    } catch (e) {
      return null;
    }
  },

  /**
   * 仮のログイン。サーバーができるまで、この端末の中だけで役割を変えます。
   * 本物のログインでは、ここがサーバーへの問い合わせに置きかわります。
   */
  mockLogin(role, opts) {
    if (!ROLE_LABEL[role]) return false;
    const o = opts || {};
    this.me = {
      role,
      id: o.id != null ? o.id : null,
      name: o.name || ROLE_LABEL[role],
      venue: o.venue != null ? o.venue : (role === ROLE.TEACHER ? 'main' : null),
    };
    try { localStorage.setItem(this.mockKey, JSON.stringify(this.me)); } catch (e) { /* 保存できなくても続行 */ }
    this._notify();
    return true;
  },

  /** ログアウト。生徒に戻ります */
  logout() {
    this.me = { role: ROLE.STUDENT, id: null, name: '', venue: null };
    try { localStorage.removeItem(this.mockKey); } catch (e) { /* 消せなくても続行 */ }
    this._notify();
  },

  _notify() {
    if (typeof this.onchange === 'function') {
      try { this.onchange(this.me); } catch (e) { /* 画面側の都合で落とさない */ }
    }
  },
};
