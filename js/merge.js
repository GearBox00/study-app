/* ============================================================
   記録を合わせる（2026-08-14 追加）
   ------------------------------------------------------------
   同じアカウントを2台で使ったときに、あとから送ったほうで
   丸ごと上書きしてしまい、片方の学習が消える問題への対処です。

   ■ なぜ「控え」が要るのか
     たとえば、ある問題を解いた回数が
       この端末 … 12回 ／ サーバー … 10回
     だったとき、これだけでは
       「10回のうえに2回ふえた（＝12回が正しい）」のか
       「別々に12回と10回ずつ解いた（＝22回が正しい）」のか
     が分かりません。
     そこで、前にサーバーと一致していた時点の数を控えておき、
     「そこから何回ふえたか」を両側で出して足します。

   ■ 控えは数だけです
     単語帳や取り込んだ問題、画像は控えません。
     これらは「増えた分を足す」ものではなく、IDで重ねれば
     両方残せるためです。控えを軽くしておかないと、
     端末の保存領域を二重に使ってしまいます。

   ■ 控えが無いとき
     入れ替え直後などで控えが無い場合は、足し算をやめて
     「大きいほう」を採ります。少なめに出ることはあっても、
     二重に数えて実際より多く出ることは避けます。
   ============================================================ */

'use strict';

const Merge = {
  /*
   * 数の入っている場所。ここに挙げたものだけを控えます。
   *
   * のべ解答数（answered）と合計時間（totalMs）はここに入れません。
   * この2つは、問題ごとの回数と時間をぜんぶ足したものと必ず一致するので
   * （js/app.js の Store.record が同時に増やしています）、
   * 合わせたあとに数え直すほうが確実です。
   * 控えが無いときでも正しく出せます。
   */
  TOTALS: ['timedCount'],
  ITEM_COUNTS: ['count', 'wrong', 'ms', 'unknown'],
  ATTEND_COUNTS: ['cards', 'stamps', 'totalDays', 'totalMinutes'],

  /**
   * 控え（数だけの写し）を作ります。
   * サーバーと一致した直後に呼び、次に食い違ったときの基準にします。
   */
  base(data) {
    const d = data || {};
    const out = { items: {}, daily: {}, attendance: {} };
    this.TOTALS.forEach((k) => { out[k] = num(d[k]); });

    const items = d.items || {};
    Object.keys(items).forEach((id) => {
      const r = items[id] || {};
      const o = {};
      this.ITEM_COUNTS.forEach((k) => { o[k] = num(r[k]); });
      out.items[id] = o;
    });

    const daily = d.daily || {};
    Object.keys(daily).forEach((day) => {
      const r = daily[day] || {};
      out.daily[day] = { n: num(r.n), ok: num(r.ok) };
    });

    const a = d.attendance || {};
    this.ATTEND_COUNTS.forEach((k) => { out.attendance[k] = num(a[k]); });
    return out;
  },

  /**
   * 3つを突き合わせて1つにまとめます。
   *   mine   … この端末の記録
   *   theirs … サーバーにある記録
   *   base   … 前に一致していた時点の控え（無ければ null）
   *
   * 戻り値は新しい記録です。mine と theirs は書き換えません。
   */
  merge(mine, theirs, base) {
    const m = mine || {};
    const t = theirs || {};
    if (!theirs) return clone(m);
    if (!mine) return clone(t);

    const b = base || null;
    const add = (key) => sum(num(m[key]), num(t[key]), b ? num(b[key]) : null);

    // 設定やニックネームは、いま操作している端末のものを採ります。
    // 数えるものではないので、足すと意味がおかしくなります。
    const out = Object.assign({}, t, m);

    this.TOTALS.forEach((k) => { out[k] = add(k); });

    out.items = this._items(m.items, t.items, b && b.items);

    // のべ解答数と合計時間は、合わせたあとの問題ごとの記録から数え直します
    out.answered = 0;
    out.totalMs = 0;
    Object.keys(out.items).forEach((id) => {
      out.answered += num(out.items[id].count);
      out.totalMs += num(out.items[id].ms);
    });

    out.daily = this._daily(m.daily, t.daily, b && b.daily);
    out.attendance = this._attendance(m.attendance, t.attendance, b && b.attendance);
    out.streak = this._streak(m.streak, t.streak);

    // IDで重ねれば両方残せるもの
    out.myWords = byId(m.myWords, t.myWords);
    out.customSets = byId(m.customSets, t.customSets);
    out.badges = union(m.badges, t.badges);
    out.loadedSubjects = union(m.loadedSubjects, t.loadedSubjects);

    const mf = m.flags || {};
    const tf = t.flags || {};
    out.flags = { perfect: !!(mf.perfect || tf.perfect), clean: !!(mf.clean || tf.clean) };

    // 学習の途中経過は、その端末だけのものです。持ち込みません
    out.session = m.session === undefined ? null : m.session;
    return out;
  },

  /* ---------- 問題ごとの記録 ---------- */

  _items(mine, theirs, base) {
    const m = mine || {};
    const t = theirs || {};
    const out = {};

    Object.keys(m).concat(Object.keys(t)).forEach((id) => {
      if (out[id]) return;
      const a = m[id];
      const c = t[id];
      if (!a) { out[id] = clone(c); return; }
      if (!c) { out[id] = clone(a); return; }

      const bb = base ? base[id] : null;
      const r = {};
      this.ITEM_COUNTS.forEach((k) => {
        r[k] = sum(num(a[k]), num(c[k]), bb ? num(bb[k]) : null);
      });

      /*
       * 連続正解・修得済み・次回の復習日は、足せる数ではありません。
       * よく解いているほう（解答数の多いほう）の状態を採ります。
       * 同じなら、あとに復習する予定になっているほうを採ります。
       */
      const win = pickState(a, c);
      r.streak = num(win.streak);
      r.mastered = !!win.mastered;
      r.due = win.due == null ? null : win.due;
      out[id] = r;
    });
    return out;
  },

  /* ---------- 日別の学習量 ---------- */

  _daily(mine, theirs, base) {
    const m = mine || {};
    const t = theirs || {};
    const out = {};
    Object.keys(m).concat(Object.keys(t)).forEach((day) => {
      if (out[day]) return;
      const a = m[day];
      const c = t[day];
      if (!a || !c) { out[day] = clone(a || c); return; }
      const bb = base ? base[day] : null;
      out[day] = {
        n: sum(num(a.n), num(c.n), bb ? num(bb.n) : null),
        ok: sum(num(a.ok), num(c.ok), bb ? num(bb.ok) : null),
      };
    });
    return out;
  },

  /* ---------- 出席スタンプ ---------- */

  _attendance(mine, theirs, base) {
    const m = mine || {};
    const t = theirs || {};
    const out = Object.assign({}, t, m);
    this.ATTEND_COUNTS.forEach((k) => {
      out[k] = sum(num(m[k]), num(t[k]), base ? num(base[k]) : null);
    });
    out.logs = this._logs(m.logs, t.logs);
    return out;
  },

  /*
   * 入退室の記録は、日ごとに「入った時刻」で重ねます。
   * 同じ時刻のものは同じ入室とみなし、退室の時刻が入っている
   * ほうを採ります（片方だけ退室を読み取れていた場合のため）。
   */
  _logs(mine, theirs) {
    const m = mine || {};
    const t = theirs || {};
    const out = {};
    Object.keys(m).concat(Object.keys(t)).forEach((day) => {
      if (out[day]) return;
      const a = m[day];
      const c = t[day];
      if (!a || !c) { out[day] = clone(a || c); return; }

      const seen = {};
      (a.sessions || []).concat(c.sessions || []).forEach((s) => {
        if (!s) return;
        const k = String(s.in);
        if (!seen[k] || (!seen[k].out && s.out)) seen[k] = clone(s);
      });
      const sessions = Object.keys(seen)
        .sort((x, y) => Number(x) - Number(y))
        .map((k) => seen[k]);

      out[day] = Object.assign({}, c, a, { sessions });
      // 分数はセッションから決まる値なので、重ねたあとで数え直します
      if ('minutes' in (a || {}) || 'minutes' in (c || {})) {
        out[day].minutes = sessions.reduce(
          (n, s) => n + (s && s.out ? Math.max(0, Math.round((s.out - s.in) / 60000)) : 0), 0);
      }
    });
    return out;
  },

  /* ---------- 連続学習日数 ---------- */

  _streak(mine, theirs) {
    const m = mine || {};
    const t = theirs || {};
    const last = String(m.last || '') >= String(t.last || '') ? m : t;
    return {
      current: num(last.current),
      best: Math.max(num(m.best), num(t.best), num(last.current)),
      last: String(last.last || ''),
    };
  },
};

/* ---------- 小さな道具 ---------- */

function num(v) {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

/*
 * 両側の「ふえた分」を足します。
 * 控えが無いときは足さず、大きいほうを採ります（多く数えないため）。
 */
function sum(mine, theirs, base) {
  if (base == null) return Math.max(mine, theirs);
  return Math.max(0, mine + theirs - base) || 0;
}

/* 解答数の多いほう。同じなら、次の復習が先のほう */
function pickState(a, c) {
  const ac = num(a.count);
  const cc = num(c.count);
  if (ac !== cc) return ac > cc ? a : c;
  return num(a.due) >= num(c.due) ? a : c;
}

/* IDのあるものを重ねます。同じIDならこの端末のものを残します */
function byId(mine, theirs) {
  const out = [];
  const seen = {};
  (mine || []).concat(theirs || []).forEach((x) => {
    if (!x) return;
    const k = String(x.id);
    if (seen[k]) return;
    seen[k] = true;
    out.push(clone(x));
  });
  return out;
}

/* ただの並び（バッジなど）を重ねます */
function union(mine, theirs) {
  const out = [];
  (mine || []).concat(theirs || []).forEach((x) => {
    if (out.indexOf(x) === -1) out.push(x);
  });
  return out;
}

/* 検証（node）から読めるようにします。ブラウザでは何もしません */
if (typeof module !== 'undefined' && module.exports) module.exports = { Merge };
