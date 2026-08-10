/* ============================================================
   名簿（生徒の一覧と在籍の状態）
   ------------------------------------------------------------
   2026-08-11 追加。運営者用の画面で使います。

   ■ いまは見本のデータです
     サーバーがまだ無いので、この端末の中だけに名簿を持ちます。
     Roster.remote に「サーバーとやりとりする係」を差しこめば、
     本物の名簿に切り替わります。画面側は書き換えません。

   ■ 見えるものは役割で変わります（js/auth.js のご指定どおり）
     ・先生は、自分の教場の生徒だけ（B）
     ・先生は、氏名と保護者の連絡先を見られない（C）
     ・在籍・休塾・退塾を切り替えられるのは運営者だけ（G・F）

   ■ ここでの制限は目隠しです
     端末の中を書き換えれば通せてしまいます。
     サーバーを入れるときは、同じ判定をサーバー側にも書いてください。
   ============================================================ */

'use strict';

const Roster = {
  key: 'manabi-card:roster',

  /* サーバーとやりとりする係。第2段階でここに入れます */
  remote: null,

  /* 読み込んだ名簿。画面はここを見ます */
  students: [],

  /* ---------- 読み書き ---------- */

  async load() {
    if (this.remote) {
      try {
        this.students = (await this.remote.list()) || [];
        return this.students;
      } catch (e) {
        // つながらないときは、この端末に残っているものを使います
      }
    }
    try {
      const v = JSON.parse(localStorage.getItem(this.key));
      this.students = Array.isArray(v) ? v : [];
    } catch (e) {
      this.students = [];
    }
    return this.students;
  },

  async save() {
    if (this.remote) {
      try { await this.remote.save(this.students); } catch (e) { /* 下で端末にも残します */ }
    }
    try {
      localStorage.setItem(this.key, JSON.stringify(this.students));
      return true;
    } catch (e) {
      return false;
    }
  },

  /* ---------- 取り出し ---------- */

  /**
   * 条件にあう生徒を返します。
   * 見てよい範囲は Auth が決めるので、ここでは絞りこみだけを行います。
   *
   * filter = { enroll:'all'|'active'|'paused'|'left', venue:'', word:'' }
   */
  list(filter) {
    const f = filter || {};
    const word = String(f.word || '').trim().toLowerCase();

    return this.students
      .filter((s) => Auth.canSeeStudent(s))                       // B：教場の壁
      .filter((s) => !f.enroll || f.enroll === 'all' || s.enroll === f.enroll)
      .filter((s) => !f.venue || s.venue === f.venue)
      .filter((s) => {
        if (!word) return true;
        // 先生には氏名が見えないので、名前での検索も先生にはさせません（C）
        const fields = [s.venue, s.note];
        if (Auth.canSeePersonalOf(s)) fields.push(s.name, s.kana, s.parentEmail);
        return fields.filter(Boolean).some((v) => String(v).toLowerCase().indexOf(word) !== -1);
      });
  },

  /** 教場の一覧（絞りこみの選択肢に使います） */
  venues() {
    const seen = [];
    this.students.forEach((s) => {
      if (s.venue && seen.indexOf(s.venue) === -1 && Auth.canSeeStudent(s)) seen.push(s.venue);
    });
    return seen.sort();
  },

  /** 状態ごとの人数（見てよい範囲の中で数えます） */
  counts() {
    const c = { all: 0, active: 0, paused: 0, left: 0 };
    this.students.filter((s) => Auth.canSeeStudent(s)).forEach((s) => {
      c.all++;
      if (c[s.enroll] !== undefined) c[s.enroll]++;
    });
    return c;
  },

  /**
   * 画面に出す用の1行分。
   * 見てよくない項目は、ここで伏せてから渡します。
   * 画面側で「出す・出さない」を判断させると、書き漏らしが起きるためです。
   */
  view(s) {
    const open = Auth.canSeePersonalOf(s);
    return {
      id: s.id,
      name: open ? s.name : `生徒 ${s.id}`,
      kana: open ? (s.kana || '') : '',
      parentEmail: open ? (s.parentEmail || '') : '',
      personalHidden: !open,
      venue: s.venue || '',
      enroll: s.enroll || ENROLL.ACTIVE,
      answered: s.answered || 0,
      correct: s.correct || 0,
      lastStudied: s.lastStudied || '',
      note: s.note || '',
    };
  },

  /* ---------- 書きかえ ---------- */

  /**
   * 在籍の状態を変えます（G）。
   * 変えてよいのは運営者だけです。
   */
  async setEnroll(id, enroll) {
    if (!Auth.can('changeEnrollment')) return { ok: false, msg: 'この操作は運営者だけができます。' };
    if (!ENROLL_LABEL[enroll]) return { ok: false, msg: '知らない状態です。' };
    const s = this.students.find((x) => x.id === id);
    if (!s) return { ok: false, msg: '見つかりませんでした。' };
    if (!Auth.canSeeStudent(s)) return { ok: false, msg: 'この生徒は担当ではありません。' };

    /*
     * サーバーがあるときは、サーバーに変えてもらいます。
     * 断られたら画面側も変えません。
     * 先に画面を変えてしまうと、直っていないのに直ったように見えるためです。
     */
    if (this.remote && typeof this.remote.setEnroll === 'function') {
      try {
        await this.remote.setEnroll(id, enroll);
      } catch (e) {
        return { ok: false, msg: e.message || 'サーバーで変更できませんでした。' };
      }
    }

    s.enroll = enroll;
    s.enrollChangedAt = new Date().toISOString().slice(0, 10);
    await this.save();
    return { ok: true, msg: `${s.name} さんを「${ENROLL_LABEL[enroll]}」にしました。` };
  },

  /* ---------- 見本のデータ（サーバーができるまでの確認用） ---------- */

  /**
   * 画面の見え方を確かめるための見本を作ります。
   * 本物のデータではありません。運営者だけが入れられます。
   */
  async fillSample() {
    if (!Auth.can('manageTeachers')) return { ok: false, msg: 'この操作は運営者だけができます。' };

    const sei = ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤'];
    const mei = ['はると', 'ゆい', 'そうた', 'あおい', 'れん', 'ひまり', 'ゆうと', 'いちか',
                 'かえで', 'みなと', 'さくら', 'りく'];
    const venues = ['main', 'kita', 'minami'];
    const enrolls = [ENROLL.ACTIVE, ENROLL.ACTIVE, ENROLL.ACTIVE, ENROLL.ACTIVE,
                     ENROLL.PAUSED, ENROLL.LEFT];

    const list = [];
    for (let i = 0; i < 24; i++) {
      const answered = 40 + ((i * 37) % 260);
      list.push({
        id: 1001 + i,
        name: `${sei[i % sei.length]} ${mei[i % mei.length]}`,
        kana: '',
        venue: venues[i % venues.length],
        enroll: enrolls[i % enrolls.length],
        parentEmail: `hogosha${i + 1}@example.com`,
        answered,
        correct: Math.round(answered * (0.55 + ((i * 7) % 35) / 100)),
        lastStudied: `2026-08-${String(1 + (i % 11)).padStart(2, '0')}`,
        note: '',
      });
    }
    this.students = list;
    await this.save();
    return { ok: true, msg: `見本の生徒を${list.length}名入れました。` };
  },

  async clear() {
    if (!Auth.can('manageTeachers')) return { ok: false, msg: 'この操作は運営者だけができます。' };
    this.students = [];
    await this.save();
    return { ok: true, msg: '名簿を空にしました。' };
  },
};
