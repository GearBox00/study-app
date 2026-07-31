/* ============================================================
   まなびカード - 本体
   ------------------------------------------------------------
   このデモではログイン不要。学習データは端末内(localStorage)に
   保存します。本番でアカウントを付ける場合も、この保存部分を
   サーバー通信に差し替えるだけで済むように分けてあります。
   ============================================================ */

'use strict';

/* ---------- 設定 ---------- */
const STORAGE_KEY = 'manabi-card-v2';
const TIME_LIMIT = 10;          // 4択・リスニングの制限時間（秒）
const TYPE_TIME_LIMIT = 15;     // タイピングテストの制限時間（秒）
const MASTER_STREAK = 2;        // 連続正解が何回で「習得」になるか
const DAY = 24 * 60 * 60 * 1000;

/* 間隔反復の間隔。連続正解が増えるほど、次に出るまでの間隔が延びます。
   （1回目=1日後、2回目=3日後、3回目=1週間後、4回目以降=2週間後）*/
const INTERVALS = [0, 1 * DAY, 3 * DAY, 7 * DAY, 14 * DAY];

/* バッジの定義。cond は Store.data を受け取って達成判定します */
const BADGES = [
  { id: 'first', icon: '🌱', name: 'はじめの一歩', cond: '1問解答', check: (d) => d.answered >= 1 },
  { id: 'a100', icon: '💯', name: '100問', cond: 'のべ100問', check: (d) => d.answered >= 100 },
  { id: 'a500', icon: '🏅', name: '500問', cond: 'のべ500問', check: (d) => d.answered >= 500 },
  { id: 'm10', icon: '🔑', name: '習得10', cond: '10問を習得', check: (d) => countMastered(d) >= 10 },
  { id: 'm50', icon: '🎓', name: '習得50', cond: '50問を習得', check: (d) => countMastered(d) >= 50 },
  { id: 's3', icon: '🔥', name: '3日連続', cond: '3日続ける', check: (d) => d.streak.current >= 3 },
  { id: 's7', icon: '⚡', name: '1週間連続', cond: '7日続ける', check: (d) => d.streak.current >= 7 },
  { id: 'goal', icon: '🎯', name: '目標達成', cond: '1日の目標を達成', check: (d) => todayCount(d) >= d.goal },
  { id: 'perfect', icon: '🌟', name: '全問正解', cond: '1セット全問正解', check: (d) => d.flags.perfect },
  { id: 'clean', icon: '🧹', name: '復習ゼロ', cond: '復習コーナーを空に', check: (d) => d.flags.clean },
];

/* ============================================================
   1. 保存データ
   ============================================================ */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dateKey(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function countMastered(d) {
  return Object.values(d.items).filter((r) => r.mastered).length;
}
function todayCount(d) {
  return (d.daily[today()] || { n: 0 }).n;
}

const Store = {
  data: null,

  blank() {
    return {
      nick: '',
      answered: 0,
      totalMs: 0,
      timedCount: 0,   // 時間を計ったモード（4択・タイピング）の解答数
      items: {},          // 問題ごとの記録
      customSets: [],     // CSVで取り込んだセット
      myWords: [],        // マイ単語帳
      daily: {},          // 日別の学習量 { '2026-07-29': {n, ok} }
      streak: { current: 0, best: 0, last: '' },
      goal: 30,
      settings: {
        direction: 'front',
        speed: 1,
        mask: false,
        timeLimit: null,   // 生徒が指定する制限時間（秒）。null=おまかせ、0=制限なし
        mode: 'practice',  // practice=生徒の設定を優先 / test=作問者の設定で固定
        auto: false,       // 自動送りモード
      },
      // 出席スタンプ（QR読み取り）
      attendance: { cards: 0, stamps: 0, totalDays: 0, totalMinutes: 0, logs: {} },
      venue: 'main',       // 拠点の合言葉
      badges: [],
      flags: { perfect: false, clean: false },
    };
  },

  load() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (e) {
      saved = null;
    }
    // 足りない項目は初期値で補う（古い保存データがあっても壊れないように）
    this.data = Object.assign(this.blank(), saved || {});
    const b = this.blank();
    ['streak', 'settings', 'flags', 'attendance'].forEach((k) => {
      this.data[k] = Object.assign(b[k], this.data[k] || {});
    });
    if (!this.data.attendance.logs) this.data.attendance.logs = {};
    ['items', 'daily'].forEach((k) => { if (!this.data[k]) this.data[k] = {}; });
    ['customSets', 'myWords', 'badges'].forEach((k) => { if (!this.data[k]) this.data[k] = []; });
    return this.data;
  },

  save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
  },

  item(id) {
    if (!this.data.items[id]) {
      this.data.items[id] = { streak: 0, mastered: false, wrong: 0, count: 0, ms: 0, due: null };
    }
    return this.data.items[id];
  },

  /** 連続学習日数を更新する */
  touchStreak() {
    const s = this.data.streak;
    const t = today();
    if (s.last === t) return;
    s.current = (s.last === dateKey(-1)) ? s.current + 1 : 1;
    s.best = Math.max(s.best, s.current);
    s.last = t;
  },

  /**
   * 解答を記録する。
   * 復習の予定日（due）もここで決めます。
   *  - 正解 … 連続正解の回数に応じて次回の出題を先延ばし
   *  - 不正解 … すぐ復習対象にする
   */
  record(id, isCorrect, ms) {
    const rec = this.item(id);
    this.data.answered++;
    rec.count++;
    if (ms) { rec.ms += ms; this.data.totalMs += ms; this.data.timedCount++; }

    if (isCorrect) {
      rec.streak++;
      if (rec.streak >= MASTER_STREAK) rec.mastered = true;
      rec.due = Date.now() + INTERVALS[Math.min(rec.streak, INTERVALS.length - 1)];
    } else {
      rec.streak = 0;
      rec.mastered = false;
      rec.wrong++;
      rec.due = Date.now();
    }

    const t = today();
    if (!this.data.daily[t]) this.data.daily[t] = { n: 0, ok: 0 };
    this.data.daily[t].n++;
    if (isCorrect) this.data.daily[t].ok++;
    this.touchStreak();

    this.save();
    return rec;
  },

  reset() {
    const keep = this.data.nick;
    const goal = this.data.goal;
    const settings = this.data.settings;
    this.data = this.blank();
    this.data.nick = keep;
    this.data.goal = goal;
    this.data.settings = settings;
    this.save();
    invalidateSearchIndex();   // 消した問題が検索に残らないようにする
  },
};

/* ============================================================
   2. 問題データの取り回し
   ============================================================ */

/** マイ単語帳・取り込みセットも含めた全科目 */
function allSubjects() {
  const list = SUBJECTS.slice();
  if (Store.data.myWords.length) {
    list.push({
      id: 'my', name: 'マイ単語帳', icon: '📕', lang: 'auto', speakField: 'front',
      levels: [{ id: 'my-1', name: '自分で登録した問題', items: Store.data.myWords }],
    });
  }
  if (Store.data.customSets.length) {
    list.push({
      id: 'custom', name: '取り込んだ問題', icon: '📥', lang: 'auto', speakField: 'front',
      levels: Store.data.customSets.map((s) => ({ id: s.id, name: s.name, items: s.items })),
    });
  }
  return list;
}

function findSubject(id) {
  return allSubjects().find((s) => s.id === id);
}

function splitSets(level) {
  const sets = [];
  for (let i = 0; i < level.items.length; i += SET_SIZE) {
    sets.push({ no: sets.length + 1, items: level.items.slice(i, i + SET_SIZE) });
  }
  return sets;
}

function everyItem() {
  const out = [];
  allSubjects().forEach((sub) => {
    sub.levels.forEach((lv) => lv.items.forEach((it) => out.push({ item: it, subject: sub })));
  });
  return out;
}

function subjectOfItem(item) {
  const hit = everyItem().find((p) => p.item.id === item.id);
  return hit ? hit.subject : { lang: 'auto', speakField: 'front' };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ============================================================
   解答の判定
   ------------------------------------------------------------
   打ち間違いではない差（大文字小文字・全角半角・余分な空白など）で
   不正解にならないよう、両方を同じ形に整えてから比べます。
   ============================================================ */
function normalizeAnswer(s) {
  return String(s == null ? '' : s)
    .normalize('NFKC')                 // 全角の英数字・記号を半角にそろえる
    .replace(/[’‘`´]/g, "'")           // アポストロフィの種類をそろえる
    .replace(/[“”]/g, '"')
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, ' ')              // 連続した空白を1つに
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:。、！？]+$/, ''); // 末尾の句読点は無視する
}

/** 解答が複数あるか（give / gave / given のようにスラッシュで区切られているか） */
function answerParts(correct) {
  return String(correct == null ? '' : correct)
    .split(/[\/／]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 入力が正解かどうか。
 * 複数解答は「順番は問わないが、すべてそろっていること」を条件とします。
 */
function answerMatches(input, correct) {
  const want = answerParts(correct).map(normalizeAnswer).filter(Boolean);
  if (want.length <= 1) return normalizeAnswer(input) === (want[0] || '');

  // 「look after」のように答えの中に空白がある場合、空白で区切ってしまうと
  // 正しい解答が不正解になるため、そのときは区切り記号だけで分けます。
  const hasSpace = want.some((w) => w.indexOf(' ') !== -1);
  const sep = hasSpace ? /[\/／,、]+/ : /[\/／,、\s]+/;
  const got = String(input == null ? '' : input)
    .split(sep)
    .map(normalizeAnswer)
    .filter(Boolean);
  if (got.length !== want.length) return false;
  const a = got.slice().sort();
  const b = want.slice().sort();
  return a.every((v, i) => v === b[i]);
}

/** 画面に出すときの表示（スラッシュの前後に空白を入れて読みやすくする） */
function displayAnswer(s) {
  const parts = answerParts(s);
  return parts.length > 1 ? parts.join(' / ') : String(s == null ? '' : s);
}

/**
 * この問題に使う制限時間（秒）を決める。0 なら制限なし。
 *  - テストモード … 作問者の指定（item.time）を必ず使う
 *  - 練習モード   … 生徒の設定があればそれを優先する
 */
function limitFor(item, base) {
  const s = Store.data.settings;
  const authored = Number(item && item.time) || 0;
  if (s.mode === 'test') return authored || base;
  if (s.timeLimit === 0) return 0;              // 生徒が「制限なし」を選んだ
  if (s.timeLimit) return s.timeLimit;          // 生徒が秒数を指定した
  return authored || base;
}

/* ---------- 出題の向き（問題→答え / 答え→問題） ---------- */
function qOf(item, dir) { return dir === 'back' ? item.back : item.front; }
function aOf(item, dir) { return dir === 'back' ? item.front : item.back; }

/** その問題が属する科目の全問題（誤答の補充に使います） */
function siblingItems(item) {
  const sub = subjectOfItem(item);
  if (!sub || !sub.levels) return [];
  const out = [];
  sub.levels.forEach((lv) => lv.items.forEach((it) => out.push(it)));
  return out;
}

/**
 * 4択の選択肢を自動生成する。
 * まず出題範囲の中から誤答を選び、足りなければ同じ科目 → 全科目の順に補います。
 * （復習コーナーが1問だけのときでも、きちんと4択になるようにするため）
 */
function makeChoices(item, pool, dir) {
  const answer = aOf(item, dir);
  const wrongs = [];

  const addFrom = (list) => {
    if (!list || wrongs.length >= 3) return;
    shuffle(list).forEach((p) => {
      if (wrongs.length >= 3) return;
      const a = aOf(p, dir);
      if (!a || p.id === item.id || a === answer || wrongs.indexOf(a) !== -1) return;
      wrongs.push(a);
    });
  };

  addFrom(pool);
  if (wrongs.length < 3) addFrom(siblingItems(item));
  if (wrongs.length < 3) addFrom(everyItem().map((p) => p.item));

  return shuffle([answer, ...wrongs]);
}

/* ============================================================
   3. 発音（ブラウザ標準の音声合成を使うので追加費用ゼロ）
   ============================================================ */
/** 穴埋めの記号 [ ] を外して、読み上げ用の文にする */
function stripBlanks(s) {
  return String(s || '').replace(/\[([^\]]*)\]/g, '$1');
}

const Speech = {
  supported: 'speechSynthesis' in window,
  unlocked: false,

  /**
   * iPhoneは「利用者が操作していない音声」を止める仕様のため、
   * 最初のタップのときに無音を1回鳴らして、以降の自動再生を許可させます。
   */
  unlock() {
    if (!this.supported || this.unlocked) return;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
      this.unlocked = true;
    } catch (e) { /* 失敗しても、発音ボタンからは鳴らせます */ }
  },

  /** 読み上げの言語は、問題ごとに中身を見て決めます（英語と日本語の混在に対応） */
  langOf(item, text) {
    if (item && item.lang) return item.lang;
    return /^[\x20-\x7E]+$/.test(text) ? 'en-US' : 'ja-JP';
  },

  textOf(subject, item) {
    if (item.speak) return item.speak;                                   // 読み上げ文の指定があれば優先
    if (subject && subject.speakField === 'reading' && item.reading) return item.reading;
    return stripBlanks(item.front).replace(/\s*[\/／]\s*/g, '、');        // 複数解答は区切って読む
  },

  /** onend … 読み終わったときに呼ばれます（自動送りで使います） */
  speak(subject, item, onend) {
    if (!this.supported) { if (onend) setTimeout(onend, 0); return; }
    const text = this.textOf(subject, item);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = this.langOf(item, text);
    u.rate = (u.lang === 'en-US' ? 0.9 : 1.0) * (Store.data.settings.speed || 1);
    let done = false;
    const finish = () => { if (done) return; done = true; if (onend) onend(); };
    u.onend = finish;
    u.onerror = finish;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    // 音声が鳴らない端末でも先へ進めるよう、保険の時間切れを設けます
    setTimeout(finish, Math.min(8000, 1200 + text.length * 90));
  },
};

// 最初のタップで音声を解錠する（iPhone対策）
['pointerdown', 'keydown'].forEach((ev) => {
  window.addEventListener(ev, () => Speech.unlock(), { once: true });
});

/* ============================================================
   4. 画面の切り替え
   ============================================================ */
const SCREENS = ['home', 'sets', 'mode', 'card', 'quiz', 'type', 'result', 'mypage',
  'search', 'add', 'stamp', 'venue', 'print', 'manage'];
const $ = (id) => document.getElementById(id);
let navStack = [];

function show(name, title) {
  SCREENS.forEach((s) => { $('screen-' + s).hidden = (s !== name); });
  $('appTitle').textContent = title || 'まなびカード';
  if (name === 'home') navStack = [];
  else navStack.push(name);
  $('backBtn').hidden = (name === 'home');
  window.scrollTo(0, 0);
  current.screen = name;
}

function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('is-show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('is-show'), 1800);
}

const current = { screen: 'home', subject: null, set: null, label: '' };

/* ============================================================
   5. ホーム
   ============================================================ */
function renderHome() {
  const d = Store.data;
  $('heroHello').textContent = `こんにちは、${d.nick || 'ゲスト'} さん`;

  // ストリーク（昨日か今日やっていれば継続中）
  const alive = d.streak.last === today() || d.streak.last === dateKey(-1);
  $('streakNum').textContent = alive ? d.streak.current : 0;
  $('streakChip').classList.toggle('is-off', !alive);

  $('statMastered').textContent = countMastered(d);
  $('statAnswered').textContent = d.answered;
  $('statSpeed').textContent = d.timedCount ? `${(d.totalMs / d.timedCount / 1000).toFixed(1)}秒` : '-';

  // 今日の目標
  const done = todayCount(d);
  const pct = Math.min(100, Math.round((done / d.goal) * 100));
  $('goalDone').textContent = done;
  $('goalTarget').textContent = d.goal;
  $('goalBar').style.width = pct + '%';
  const msg = $('goalMsg');
  if (done >= d.goal) {
    msg.textContent = '今日の目標を達成しました！ よくがんばりました 🎉';
    msg.classList.add('is-done');
  } else {
    msg.classList.remove('is-done');
    msg.textContent = done === 0
      ? '今日はまだ学習していません'
      : `目標まであと${d.goal - done}問`;
  }

  // 復習コーナー
  const due = reviewItems().length;
  const later = scheduledItems().length;
  const cta = $('reviewCta');
  cta.classList.toggle('is-active', due > 0);
  $('reviewCtaSub').textContent = due > 0
    ? `${due}問が復習の時期です。タップではじめる`
    : (later > 0 ? `いま復習する問題はありません（予定 ${later}問）` : '間違えた問題はここに自動でたまります');

  // 出席スタンプ（js/stamp.js が読み込まれていれば表示を更新）
  if (typeof renderStampSummary === 'function') renderStampSummary();

  // 科目一覧
  const list = $('subjectList');
  list.innerHTML = '';
  allSubjects().forEach((sub) => {
    const total = sub.levels.reduce((n, lv) => n + lv.items.length, 0);
    let doneN = 0;
    sub.levels.forEach((lv) => lv.items.forEach((it) => {
      if (d.items[it.id] && d.items[it.id].mastered) doneN++;
    }));
    const btn = document.createElement('button');
    btn.className = 'subject-card';
    btn.innerHTML = `
      <span class="subject-card__icon">${sub.icon}</span>
      <span class="subject-card__body">
        <span class="subject-card__name">${sub.name}</span>
        <span class="subject-card__meta">全${total}問 ・ 習得 ${doneN}問</span>
      </span>
      <span class="subject-card__arrow">›</span>`;
    btn.onclick = () => openSubject(sub.id);
    list.appendChild(btn);
  });
}

/* ---------- セット一覧 ---------- */
function openSubject(id) {
  const sub = findSubject(id);
  current.subject = sub;
  const wrap = $('levelList');
  wrap.innerHTML = '';

  sub.levels.forEach((lv) => {
    const block = document.createElement('div');
    block.className = 'level-block';
    const h = document.createElement('p');
    h.className = 'level-block__name';
    h.textContent = lv.name;
    block.appendChild(h);

    const grid = document.createElement('div');
    grid.className = 'set-grid';
    splitSets(lv).forEach((set) => {
      const done = set.items.filter((it) => Store.data.items[it.id] && Store.data.items[it.id].mastered).length;
      const pct = Math.round((done / set.items.length) * 100);
      const btn = document.createElement('button');
      btn.className = 'set-card';
      btn.innerHTML = `
        ${pct === 100 ? '<span class="set-card__done">✅</span>' : ''}
        <span class="set-card__name">セット${set.no}</span>
        <span class="set-card__meta">${set.items.length}問 ・ 習得${done}</span>
        <span class="set-card__bar"><i style="width:${pct}%"></i></span>`;
      btn.onclick = () => openModes(set.items, `${sub.name} ${lv.name} セット${set.no}`);
      grid.appendChild(btn);
    });
    block.appendChild(grid);
    wrap.appendChild(block);
  });

  $('setsTitle').textContent = `${sub.name}｜セットをえらぶ`;
  show('sets', sub.name);
}

/** つづりを入力できる問題か（英単語など） */
function isTypable(items) {
  return items.length > 0 && items.every((it) => /^[A-Za-z][A-Za-z '-]*$/.test(it.front));
}

function openModes(items, label) {
  current.set = items;
  current.label = label;
  $('modeTitle').textContent = label;
  $('modeTyping').hidden = !isTypable(items);
  $('modeListen').hidden = !Speech.supported;
  syncDirButtons();
  show('mode', label);
}

/* ============================================================
   6. 復習コーナー（間隔反復）
   ============================================================ */
/** いま復習すべき問題（予定日を過ぎたもの） */
function reviewItems() {
  const now = Date.now();
  return everyItem().filter(({ item }) => {
    const r = Store.data.items[item.id];
    return r && r.due !== null && r.due <= now;
  });
}
/** まだ予定日が来ていない問題 */
function scheduledItems() {
  const now = Date.now();
  return everyItem().filter(({ item }) => {
    const r = Store.data.items[item.id];
    return r && r.due !== null && r.due > now;
  });
}

function startReview() {
  const list = reviewItems();
  if (!list.length) {
    toast('いま復習する問題はありません');
    return;
  }
  const picked = shuffle(list).slice(0, SET_SIZE).map((p) => p.item);
  current.subject = null;
  startQuiz(picked, '復習コーナー', { review: true, pool: list.map((p) => p.item) });
}

/* ============================================================
   7. フラッシュカード（知っている / 知らない で仕分け）
   ============================================================ */
const cardSession = { items: [], idx: 0, known: 0, unknown: [], label: '', dir: 'front' };

function startCard(items, label) {
  cardSession.items = shuffle(items);
  cardSession.idx = 0;
  cardSession.known = 0;
  cardSession.unknown = [];
  cardSession.label = label;
  cardSession.dir = Store.data.settings.direction;
  show('card', label);
  drawCard();
}

function drawCard() {
  const s = cardSession;
  const item = s.items[s.idx];
  const sub = current.subject || subjectOfItem(item);

  const card = $('flashcard');
  card.classList.remove('is-flipped');
  card.style.transform = '';
  card.style.opacity = '';

  $('cardFront').textContent = qOf(item, s.dir);
  $('cardBack').textContent = aOf(item, s.dir);
  $('cardExp').textContent = item.explanation || '';
  setExample($('cardExample'), item);
  $('cardMask').hidden = !Store.data.settings.mask;
  $('cardCounter').textContent = `${s.idx + 1} / ${s.items.length}`;
  $('cardProgress').style.width = `${(s.idx / s.items.length) * 100}%`;
  $('cardSpeak').hidden = !Speech.supported;
  if (sub && sub.id === 'english') Speech.speak(sub, item);
}

function setExample(el, item) {
  if (item.example) {
    el.textContent = '例文： ' + item.example;
    el.hidden = false;
  } else {
    el.textContent = '';
    el.hidden = true;
  }
}

/** 知っている／知らない を記録して次のカードへ */
function judgeCard(known) {
  const s = cardSession;
  const item = s.items[s.idx];
  Store.record(item.id, known, 0);
  if (known) s.known++;
  else s.unknown.push(item);

  if (s.idx < s.items.length - 1) {
    s.idx++;
    drawCard();
  } else {
    Store.data.flags.clean = reviewItems().length === 0;
    Store.save();
    showResult({
      mode: 'card',
      total: s.items.length,
      correct: s.known,
      wrong: s.unknown,
      retryFn: (wrong) => startCard(wrong, s.label),
      againFn: () => startCard(s.items, s.label),
      quizFn: () => startQuiz(s.items, s.label),
    });
  }
}

// ドラッグで仕分けしたときは、続けて発生するクリックでめくらないようにする
let cardDragged = false;
$('flashcard').onclick = () => {
  if (cardDragged) { cardDragged = false; return; }
  $('flashcard').classList.toggle('is-flipped');
};
$('cardMask').onclick = (e) => { e.stopPropagation(); $('cardMask').hidden = true; };
$('cardSpeak').onclick = (e) => {
  e.stopPropagation();
  const item = cardSession.items[cardSession.idx];
  Speech.speak(current.subject || subjectOfItem(item), item);
};
$('cardKnown').onclick = () => judgeCard(true);
$('cardUnknown').onclick = () => judgeCard(false);

/* ---------- 左右へのドラッグで仕分け ---------- */
(() => {
  const card = $('flashcard');
  let startX = 0, dx = 0, dragging = false;

  const begin = (x) => { startX = x; dx = 0; dragging = true; card.classList.add('is-dragging'); };
  const move = (x) => {
    if (!dragging) return;
    dx = x - startX;
    card.style.transform = `translateX(${dx}px) rotate(${dx / 25}deg)`;
    card.style.opacity = String(1 - Math.min(Math.abs(dx) / 400, 0.5));
  };
  const end = () => {
    if (!dragging) return;
    dragging = false;
    card.classList.remove('is-dragging');
    if (Math.abs(dx) > 5) cardDragged = true;
    if (Math.abs(dx) > 90) judgeCard(dx > 0);
    else { card.style.transform = ''; card.style.opacity = ''; }
  };

  card.addEventListener('pointerdown', (e) => begin(e.clientX));
  card.addEventListener('pointermove', (e) => move(e.clientX));
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
  card.addEventListener('pointerleave', end);
})();

/* ============================================================
   8. 4択テスト / リスニング
   ============================================================ */
const quiz = {
  items: [], idx: 0, correct: 0, wrong: [], label: '', dir: 'front',
  listen: false, review: false, pool: [], timer: null, left: 0,
  locked: false, startAt: 0, skipped: {}, ms: 0,
};

function startQuiz(items, label, opts) {
  opts = opts || {};
  quiz.items = shuffle(items);
  quiz.idx = 0;
  quiz.correct = 0;
  quiz.wrong = [];
  quiz.label = label;
  quiz.listen = !!opts.listen;
  quiz.review = !!opts.review;
  quiz.pool = opts.pool || items;
  quiz.skipped = {};
  quiz.ms = 0;
  // リスニングは「音を聴いて意味を答える」ので向きは固定
  quiz.dir = quiz.listen ? 'front' : Store.data.settings.direction;
  show('quiz', label);
  drawQuiz();
}

function drawQuiz() {
  clearInterval(quiz.timer);
  quiz.locked = false;
  const item = quiz.items[quiz.idx];
  const sub = current.subject || subjectOfItem(item);

  $('quizFeedback').hidden = true;
  $('quizSkip').hidden = false;
  $('quizCounter').textContent = `${quiz.idx + 1} / ${quiz.items.length}`;
  $('quizProgress').style.width = `${(quiz.idx / quiz.items.length) * 100}%`;

  if (quiz.listen) {
    $('quizFront').textContent = '🔊 聴いて答えましょう';
  } else {
    $('quizFront').textContent = qOf(item, quiz.dir);
  }
  $('quizSpeak').hidden = !Speech.supported;

  const box = $('quizChoices');
  box.innerHTML = '';
  makeChoices(item, quiz.pool, quiz.dir).forEach((text) => {
    const b = document.createElement('button');
    b.className = 'choice';
    b.textContent = displayAnswer(text);   // 複数解答は「give / gave / given」と読みやすく出す
    b.dataset.raw = text;                  // 判定にはもとの値を使う
    b.onclick = () => answerQuiz(text === aOf(item, quiz.dir), b, item);
    box.appendChild(b);
  });

  if (quiz.listen || (sub && sub.id === 'english')) Speech.speak(sub, item);
  quiz.startAt = Date.now();
  startTimer(item);
}

function startTimer(item) {
  const limit = limitFor(item, TIME_LIMIT);
  const el = $('quizTimer');
  if (!limit) {                      // 制限なし
    el.textContent = '∞';
    el.classList.remove('is-hurry');
    return;
  }
  quiz.left = limit;
  el.textContent = limit;
  el.classList.remove('is-hurry');
  quiz.timer = setInterval(() => {
    quiz.left -= 0.1;
    const sec = Math.max(0, Math.ceil(quiz.left));
    el.textContent = sec;
    if (sec <= 3) el.classList.add('is-hurry');
    if (quiz.left <= 0) {
      clearInterval(quiz.timer);
      answerQuiz(false, null, item, true);
    }
  }, 100);
}

function answerQuiz(isCorrect, btn, item, timeUp) {
  if (quiz.locked) return;
  quiz.locked = true;
  clearInterval(quiz.timer);
  $('quizSkip').hidden = true;

  const sub = current.subject || subjectOfItem(item);
  const ms = Date.now() - quiz.startAt;
  quiz.ms += ms;
  Store.record(item.id, isCorrect, ms);
  if (isCorrect) quiz.correct++;
  else quiz.wrong.push(item);

  const answer = aOf(item, quiz.dir);
  Array.from($('quizChoices').children).forEach((b) => {
    b.disabled = true;
    if (b.dataset.raw === answer) b.classList.add('is-correct');
  });
  if (btn && !isCorrect) btn.classList.add('is-wrong');

  const mark = $('fbMark');
  mark.textContent = isCorrect ? '◯ 正解！' : (timeUp ? '△ 時間ぎれ' : '✕ ざんねん');
  mark.className = 'feedback__mark ' + (isCorrect ? 'ok' : 'ng');
  $('fbAnswer').textContent = `${displayAnswer(item.front)} ： ${item.back}`;
  $('fbExp').textContent = item.explanation || '';
  setExample($('fbExample'), item);
  $('fbSpeak').hidden = !Speech.supported;
  $('fbSpeak').onclick = () => Speech.speak(sub, item);
  $('quizFeedback').hidden = false;
  $('fbNext').textContent = (quiz.idx === quiz.items.length - 1) ? '結果を見る' : '次へ ›';

  // 正解・不正解・時間切れのいずれでも読み上げます
  Speech.speak(sub, item, () => autoAdvance(isCorrect, () => $('fbNext').click()));
}

/** スキップ … 記録せずに、その問題を後ろへ回す */
function skipQuiz() {
  if (quiz.locked) return;
  const item = quiz.items[quiz.idx];
  const n = (quiz.skipped[item.id] || 0) + 1;
  quiz.skipped[item.id] = n;
  clearInterval(quiz.timer);

  if (n <= 1 && quiz.idx < quiz.items.length - 1) {
    // 後ろに回して、いまの位置には次の問題を入れる
    quiz.items.splice(quiz.idx, 1);
    quiz.items.push(item);
    drawQuiz();
  } else if (quiz.idx < quiz.items.length - 1) {
    quiz.idx++;
    drawQuiz();
  } else {
    finishQuiz();
  }
}

function finishQuiz() {
  const opts = { review: quiz.review, pool: quiz.pool, listen: quiz.listen };
  const label = quiz.label;
  const items = quiz.items;
  const answered = quiz.correct + quiz.wrong.length;
  if (answered === items.length && quiz.wrong.length === 0) Store.data.flags.perfect = true;
  Store.data.flags.clean = reviewItems().length === 0;
  Store.save();

  showResult({
    mode: 'quiz',
    total: items.length,
    correct: quiz.correct,
    wrong: quiz.wrong,
    isReview: quiz.review,
    ms: quiz.ms,
    answered,
    retryFn: (wrong) => startQuiz(wrong, label, opts),
    againFn: () => startQuiz(items, label, opts),
  });
}

$('quizSkip').onclick = skipQuiz;
$('quizSpeak').onclick = () => {
  const item = quiz.items[quiz.idx];
  Speech.speak(current.subject || subjectOfItem(item), item);
};
$('fbNext').onclick = () => {
  cancelAuto();
  if (quiz.idx < quiz.items.length - 1) {
    quiz.idx++;
    drawQuiz();
  } else {
    finishQuiz();
  }
};

/* ============================================================
   自動送りモード
   ------------------------------------------------------------
   解答したあと、ボタンを押さなくても次の問題へ進みます。
   ・読み上げが終わるのを待ってから数えはじめます
   ・正解は短く、間違いは解説を読める長さだけ待ちます
   ・「一時停止」を押すと、その場で手動に切り替わります
   ============================================================ */
const AUTO_WAIT_OK = 900;    // 正解のときの待ち時間（ミリ秒）
const AUTO_WAIT_NG = 3500;   // 間違い・時間切れのときの待ち時間
let autoTimer = null;

function cancelAuto() {
  clearTimeout(autoTimer);
  autoTimer = null;
  document.querySelectorAll('.auto-pause').forEach((b) => { b.hidden = true; });
}

function autoAdvance(isCorrect, nextFn) {
  if (!Store.data.settings.auto) return;
  const wait = isCorrect ? AUTO_WAIT_OK : AUTO_WAIT_NG;

  // 一時停止ボタンを出す（押すとこの問題から手動に戻ります）
  const btn = document.querySelector('.screen:not([hidden]) .auto-pause');
  if (btn) {
    btn.hidden = false;
    btn.onclick = () => { cancelAuto(); toast('自動送りを止めました'); };
  }

  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    autoTimer = null;
    if (btn) btn.hidden = true;
    nextFn();
  }, wait);
}

/* ============================================================
   9. タイピングテスト
   ============================================================ */
const typing = {
  items: [], idx: 0, correct: 0, wrong: [], label: '',
  timer: null, left: 0, locked: false, startAt: 0, ms: 0, skipped: {},
};

function startTyping(items, label) {
  typing.items = shuffle(items);
  typing.idx = 0;
  typing.correct = 0;
  typing.wrong = [];
  typing.label = label;
  typing.ms = 0;
  typing.skipped = {};
  show('type', label);
  drawTyping();
}

function drawTyping() {
  clearInterval(typing.timer);
  typing.locked = false;
  const item = typing.items[typing.idx];

  $('typeFeedback').hidden = true;
  $('typeSkip').hidden = false;
  $('typeCounter').textContent = `${typing.idx + 1} / ${typing.items.length}`;
  $('typeProgress').style.width = `${(typing.idx / typing.items.length) * 100}%`;
  $('typeMeaning').textContent = item.back;
  const parts = answerParts(item.front);
  $('typeHint').textContent = parts.length > 1
    ? `${parts.length}つの語を「/」で区切って入力（順番は自由）`
    : `${item.front.length}文字 ・ 最初の文字は「${item.front[0]}」`;

  const input = $('typeInput');
  input.value = '';
  input.disabled = false;
  input.focus();
  drawEcho('');

  typing.startAt = Date.now();
  startTypeTimer();
}

function drawEcho(value) {
  const target = typing.items[typing.idx].front;
  const echo = $('typeEcho');
  echo.innerHTML = '';

  // 複数解答は順番を問わないため、1文字ずつの色分けをすると
  // 正しく打っていても赤く見えてしまいます。ここでは入力した数だけを示します。
  const parts = answerParts(target);
  if (parts.length > 1) {
    const given = String(value).split(/[\/／,、]+/).map((s) => s.trim()).filter(Boolean);
    const span = document.createElement('span');
    span.className = 'ok';
    span.textContent = value || '_';
    echo.appendChild(span);
    const count = document.createElement('span');
    count.className = 'rest';
    count.textContent = `　（${given.length} / ${parts.length}語）`;
    echo.appendChild(count);
    return;
  }

  for (let i = 0; i < target.length; i++) {
    const span = document.createElement('span');
    if (i < value.length) {
      span.textContent = value[i];
      span.className = value[i].toLowerCase() === target[i].toLowerCase() ? 'ok' : 'ng';
    } else {
      span.textContent = '_';
      span.className = 'rest';
    }
    echo.appendChild(span);
  }
  if (value.length > target.length) {
    const over = document.createElement('span');
    over.textContent = value.slice(target.length);
    over.className = 'ng';
    echo.appendChild(over);
  }
}

function startTypeTimer() {
  const limit = limitFor(typing.items[typing.idx], TYPE_TIME_LIMIT);
  const el = $('typeTimer');
  if (!limit) {
    el.textContent = '∞';
    el.classList.remove('is-hurry');
    return;
  }
  typing.left = limit;
  el.textContent = limit;
  el.classList.remove('is-hurry');
  typing.timer = setInterval(() => {
    typing.left -= 0.1;
    const sec = Math.max(0, Math.ceil(typing.left));
    el.textContent = sec;
    if (sec <= 3) el.classList.add('is-hurry');
    if (typing.left <= 0) {
      clearInterval(typing.timer);
      judgeTyping(true);
    }
  }, 100);
}

function judgeTyping(timeUp) {
  if (typing.locked) return;
  typing.locked = true;
  clearInterval(typing.timer);
  $('typeSkip').hidden = true;

  const item = typing.items[typing.idx];
  const sub = current.subject || subjectOfItem(item);
  const typed = $('typeInput').value;
  const isCorrect = !timeUp && answerMatches(typed, item.front);

  const ms = Date.now() - typing.startAt;
  typing.ms += ms;
  Store.record(item.id, isCorrect, ms);
  if (isCorrect) typing.correct++;
  else typing.wrong.push(item);

  $('typeInput').disabled = true;
  drawEcho($('typeInput').value);

  const mark = $('typeMark');
  mark.textContent = isCorrect ? '◯ 正解！' : (timeUp ? '△ 時間ぎれ' : '✕ おしい');
  mark.className = 'feedback__mark ' + (isCorrect ? 'ok' : 'ng');
  $('typeAnswer').textContent = `${displayAnswer(item.front)} ： ${item.back}`;
  $('typeExp').textContent = item.explanation || '';
  setExample($('typeExample'), item);
  $('typeSpeak').hidden = !Speech.supported;
  $('typeSpeak').onclick = () => Speech.speak(sub, item);
  $('typeFeedback').hidden = false;
  $('typeNext').textContent = (typing.idx === typing.items.length - 1) ? '結果を見る' : '次へ ›';
  $('typeNext').focus();

  // 正解・不正解・時間切れのいずれでも読み上げます
  Speech.speak(sub, item, () => autoAdvance(isCorrect, () => $('typeNext').click()));
}

function skipTyping() {
  if (typing.locked) return;
  const item = typing.items[typing.idx];
  const n = (typing.skipped[item.id] || 0) + 1;
  typing.skipped[item.id] = n;
  clearInterval(typing.timer);

  if (n <= 1 && typing.idx < typing.items.length - 1) {
    typing.items.splice(typing.idx, 1);
    typing.items.push(item);
    drawTyping();
  } else if (typing.idx < typing.items.length - 1) {
    typing.idx++;
    drawTyping();
  } else {
    finishTyping();
  }
}

function finishTyping() {
  const label = typing.label;
  const items = typing.items;
  const answered = typing.correct + typing.wrong.length;
  if (answered === items.length && typing.wrong.length === 0) Store.data.flags.perfect = true;
  Store.data.flags.clean = reviewItems().length === 0;
  Store.save();

  showResult({
    mode: 'type',
    total: items.length,
    correct: typing.correct,
    wrong: typing.wrong,
    ms: typing.ms,
    answered,
    retryFn: (wrong) => startTyping(wrong, label),
    againFn: () => startTyping(items, label),
  });
}

$('typeSkip').onclick = skipTyping;
$('typeInput').oninput = (e) => { if (!typing.locked) drawEcho(e.target.value); };
$('typeInput').onkeydown = (e) => { if (e.key === 'Enter') judgeTyping(false); };
$('typeNext').onclick = () => {
  cancelAuto();
  if (typing.idx < typing.items.length - 1) {
    typing.idx++;
    drawTyping();
  } else {
    finishTyping();
  }
};

/* ============================================================
   10. 結果画面
   ============================================================ */
function showResult(res) {
  const retry = $('resultRetryWrong');
  const again = $('resultAgain');
  const scoreLine = document.querySelector('.result__score');

  if (res.mode === 'card') {
    $('resultEmoji').textContent = '🗂️';
    scoreLine.hidden = false;
    $('resultCorrect').textContent = res.correct;
    $('resultTotal').textContent = res.total;
    scoreLine.lastChild.textContent = ' 問「知っている」';
    $('resultTime').textContent = '';
    $('resultNote').textContent = res.wrong.length
      ? `「知らない」に仕分けた${res.wrong.length}問は復習コーナーに入りました。`
      : 'すべて「知っている」に仕分けました。テストで確認してみましょう。';
    retry.hidden = false;
    retry.textContent = res.wrong.length ? '知らない問題だけカードで見る' : '4択テストに挑戦する';
    retry.onclick = () => (res.wrong.length ? res.retryFn(res.wrong) : res.quizFn());
    again.textContent = 'もう一度カードを見る';
    again.onclick = () => res.againFn();
  } else {
    const rate = res.correct / res.total;
    $('resultEmoji').textContent = rate === 1 ? '🎉' : rate >= 0.7 ? '👍' : '💪';
    scoreLine.hidden = false;
    scoreLine.lastChild.textContent = ' 問正解';
    $('resultCorrect').textContent = res.correct;
    $('resultTotal').textContent = res.total;
    $('resultTime').textContent = res.answered
      ? `1問あたり平均 ${(res.ms / res.answered / 1000).toFixed(1)}秒`
      : '';

    const left = reviewItems().length;
    if (res.wrong.length) {
      $('resultNote').textContent =
        `間違えた${res.wrong.length}問は復習コーナーに入りました。（復習待ち 合計${left}問）`;
      retry.hidden = false;
      retry.textContent = '間違えた問題だけやり直す';
      retry.onclick = () => res.retryFn(res.wrong);
    } else {
      $('resultNote').textContent = res.isReview
        ? '復習コーナーの問題をクリアしました！ 次の出題は数日後です。'
        : `全問正解！ 連続${MASTER_STREAK}回正解した問題は「習得」になります。`;
      retry.hidden = true;
    }
    again.textContent = 'もう一度';
    again.onclick = () => res.againFn();
  }

  showNewBadges();
  show('result', '結果');
}

$('resultHome').onclick = () => goHome();

/* ============================================================
   11. バッジ
   ============================================================ */
function checkBadges() {
  const got = [];
  BADGES.forEach((b) => {
    if (Store.data.badges.includes(b.id)) return;
    if (b.check(Store.data)) {
      Store.data.badges.push(b.id);
      got.push(b);
    }
  });
  if (got.length) Store.save();
  return got;
}

function showNewBadges() {
  const got = checkBadges();
  const box = $('badgeEarned');
  if (!got.length) { box.hidden = true; return; }
  box.innerHTML = '🏆 新しいバッジ： ' + got.map((b) => `${b.icon} ${b.name}`).join(' / ');
  box.hidden = false;
}

function renderBadges() {
  const box = $('badges');
  box.innerHTML = '';
  BADGES.forEach((b) => {
    const got = Store.data.badges.includes(b.id);
    const el = document.createElement('div');
    el.className = 'badge' + (got ? ' is-got' : '');
    el.innerHTML = `
      <span class="badge__icon">${b.icon}</span>
      <span class="badge__name">${b.name}</span>
      <span class="badge__cond">${b.cond}</span>`;
    box.appendChild(el);
  });
}

/* ============================================================
   12. マイページ（記録・グラフ・苦手リスト・設定）
   ============================================================ */
function renderMypage() {
  const d = Store.data;
  $('nickInput').value = d.nick || '';
  $('goalInput').value = d.goal;
  $('maskToggle').checked = !!d.settings.mask;
  $('autoToggle').checked = !!d.settings.auto;
  syncDirButtons();
  syncSpeedButtons();
  syncLimitButtons();

  // 科目別の記録
  let html = '<tr><th>科目</th><th>習得</th><th>復習待ち</th></tr>';
  const now = Date.now();
  allSubjects().forEach((sub) => {
    let mastered = 0, due = 0, total = 0;
    sub.levels.forEach((lv) => lv.items.forEach((it) => {
      total++;
      const r = d.items[it.id];
      if (!r) return;
      if (r.mastered) mastered++;
      if (r.due !== null && r.due <= now) due++;
    }));
    html += `<tr><td>${sub.icon} ${sub.name}</td><td>${mastered} / ${total}</td><td>${due}</td></tr>`;
  });
  $('mypageTable').innerHTML = html;
  $('mypageSummary').textContent =
    `のべ${d.answered}問 ・ 平均${d.timedCount ? (d.totalMs / d.timedCount / 1000).toFixed(1) : 0}秒 ・ ` +
    `連続${d.streak.current}日（最高${d.streak.best}日）`;

  renderGraph();
  renderBadges();
  renderWeak();
}

/** この2週間の学習量を棒グラフで表示 */
function renderGraph() {
  const box = $('graph');
  box.innerHTML = '';
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(dateKey(-i));
  const max = Math.max(Store.data.goal, ...days.map((k) => (Store.data.daily[k] || { n: 0 }).n));

  days.forEach((k) => {
    const n = (Store.data.daily[k] || { n: 0 }).n;
    const col = document.createElement('div');
    col.className = 'graph__col';
    const h = Math.round((n / max) * 100);
    col.innerHTML = `
      <span class="graph__val">${n || ''}</span>
      <span class="graph__bar ${n === 0 ? 'is-zero' : (n >= Store.data.goal ? 'is-goal' : '')}"
            style="height:${Math.max(h, n ? 6 : 2)}%"></span>
      <span class="graph__day">${Number(k.slice(8))}</span>`;
    box.appendChild(col);
  });
}

/** 間違えた回数が多い順に並べる */
function renderWeak() {
  const rows = everyItem()
    .map(({ item, subject }) => ({ item, subject, rec: Store.data.items[item.id] }))
    .filter((r) => r.rec && r.rec.wrong > 0)
    .sort((a, b) => b.rec.wrong - a.rec.wrong)
    .slice(0, 20);

  const box = $('weakList');
  box.innerHTML = '';
  if (!rows.length) {
    box.innerHTML = '<p class="note">まだ間違えた問題はありません。</p>';
    $('weakStart').hidden = true;
    return;
  }
  rows.forEach(({ item, subject, rec }) => {
    box.appendChild(itemRow(item, subject, `${rec.wrong}回まちがえた`));
  });
  const btn = $('weakStart');
  btn.hidden = false;
  btn.onclick = () => {
    current.subject = null;
    const items = rows.map((r) => r.item);
    startQuiz(items.slice(0, SET_SIZE), '苦手な問題', { pool: items });
  };
}

/** 一覧に出す1行（発音ボタンつき） */
function itemRow(item, subject, meta) {
  const row = document.createElement('div');
  row.className = 'item-row';
  const body = document.createElement('div');
  body.className = 'item-row__body';
  body.innerHTML = `
    <span class="item-row__front">${item.front}</span>
    <span class="item-row__back">${item.back}</span>
    ${meta ? `<span class="item-row__meta">${meta}</span>` : ''}
    ${item.example ? `<span class="item-row__ex">${item.example}</span>` : ''}`;
  row.appendChild(body);

  if (Speech.supported) {
    const sp = document.createElement('button');
    sp.className = 'speak-btn';
    sp.textContent = '🔊';
    sp.onclick = () => Speech.speak(subject, item);
    row.appendChild(sp);
  }
  return row;
}

$('nickInput').oninput = (e) => { Store.data.nick = e.target.value.trim(); Store.save(); };
$('goalInput').onchange = (e) => {
  const v = Math.max(5, Math.min(300, Number(e.target.value) || 30));
  Store.data.goal = v;
  e.target.value = v;
  Store.save();
  toast(`1日の目標を${v}問にしました`);
};
$('maskToggle').onchange = (e) => { Store.data.settings.mask = e.target.checked; Store.save(); };
$('autoToggle').onchange = (e) => {
  Store.data.settings.auto = e.target.checked;
  Store.save();
  toast(e.target.checked ? '自動送りをオンにしました' : '自動送りをオフにしました');
};

function syncDirButtons() {
  document.querySelectorAll('[data-dir]').forEach((b) => {
    b.classList.toggle('is-on', b.dataset.dir === Store.data.settings.direction);
  });
}
function syncSpeedButtons() {
  document.querySelectorAll('[data-speed]').forEach((b) => {
    b.classList.toggle('is-on', Number(b.dataset.speed) === Store.data.settings.speed);
  });
}
function syncLimitButtons() {
  const cur = Store.data.settings.timeLimit;
  document.querySelectorAll('[data-limit]').forEach((b) => {
    const v = b.dataset.limit === '' ? null : Number(b.dataset.limit);
    b.classList.toggle('is-on', v === cur);
  });
  document.querySelectorAll('[data-mode]').forEach((b) => {
    b.classList.toggle('is-on', b.dataset.mode === Store.data.settings.mode);
  });
  $('modeNote').textContent = Store.data.settings.mode === 'test'
    ? 'テスト中は、作問者が決めた制限時間で固定されます。'
    : '練習中は、上で選んだ制限時間が使われます。';
}
document.querySelectorAll('[data-limit]').forEach((b) => {
  b.onclick = () => {
    Store.data.settings.timeLimit = b.dataset.limit === '' ? null : Number(b.dataset.limit);
    Store.save();
    syncLimitButtons();
  };
});
document.querySelectorAll('[data-mode]').forEach((b) => {
  b.onclick = () => {
    Store.data.settings.mode = b.dataset.mode;
    Store.save();
    syncLimitButtons();
  };
});
document.querySelectorAll('[data-dir]').forEach((b) => {
  b.onclick = () => { Store.data.settings.direction = b.dataset.dir; Store.save(); syncDirButtons(); };
});
document.querySelectorAll('[data-speed]').forEach((b) => {
  b.onclick = () => {
    Store.data.settings.speed = Number(b.dataset.speed);
    Store.save();
    syncSpeedButtons();
    const sample = SUBJECTS[0].levels[0].items[0];
    Speech.speak(SUBJECTS[0], sample);
  };
});

$('resetBtn').onclick = () => {
  if (confirm('学習データをすべて消します。よろしいですか？')) {
    Store.reset();
    renderMypage();
    toast('リセットしました');
  }
};

/* ============================================================
   13. 単語をさがす
   ============================================================ */
/* 検索用の索引。
   毎回すべての問題を調べ直すと、1万件を超えたときに反応が遅くなるため、
   検索対象の文字列をあらかじめ1本にまとめて持っておきます。
   問題を追加・削除したときは invalidateSearchIndex() で作り直します。 */
const SearchIndex = {
  rows: null,

  build() {
    this.rows = everyItem().map(({ item, subject }) => ({
      item,
      subject,
      key: [item.front, item.back, item.reading, item.example, item.explanation]
        .filter(Boolean).join('\n').toLowerCase(),
    }));
    return this.rows;
  },

  all() {
    return this.rows || this.build();
  },

  find(q, limit) {
    const rows = this.all();
    const out = [];
    for (let i = 0; i < rows.length && out.length < limit; i++) {
      if (rows[i].key.indexOf(q) !== -1) out.push(rows[i]);
    }
    return out;
  },
};

function invalidateSearchIndex() { SearchIndex.rows = null; }

const SEARCH_LIMIT = 50;
let searchTimer = null;

function renderSearch(word) {
  const q = (word || '').trim().toLowerCase();
  const box = $('searchResults');
  box.innerHTML = '';
  if (!q) {
    $('searchCount').textContent = `全${SearchIndex.all().length}問から検索できます`;
    return;
  }
  const hits = SearchIndex.find(q, SEARCH_LIMIT);
  $('searchCount').textContent = hits.length
    ? (hits.length >= SEARCH_LIMIT ? `${SEARCH_LIMIT}件以上みつかりました（先頭の${SEARCH_LIMIT}件）` : `${hits.length}件みつかりました`)
    : '見つかりませんでした';
  hits.forEach(({ item, subject }) => box.appendChild(itemRow(item, subject, '')));
}

// 打っている途中で毎回検索すると重くなるため、少し待ってからまとめて検索します
$('searchInput').oninput = (e) => {
  const v = e.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => renderSearch(v), 150);
};

/* ============================================================
   14. 問題を追加（マイ単語帳 / CSV）
   ============================================================ */
$('myAddBtn').onclick = () => {
  const front = $('myFront').value.trim();
  const back = $('myBack').value.trim();
  if (!front || !back) { $('myMsg').textContent = '問題と答えは必須です。'; return; }

  Store.data.myWords.push({
    id: 'mw-' + Date.now(),
    front,
    back,
    explanation: $('myExp').value.trim(),
    example: $('myExample').value.trim(),
  });
  Store.save();
  invalidateSearchIndex();
  ['myFront', 'myBack', 'myExp', 'myExample'].forEach((id) => { $(id).value = ''; });
  $('myMsg').textContent = `「${front}」を追加しました。合計${Store.data.myWords.length}問。`;
  toast('マイ単語帳に追加しました');
};

/* CSVの取り込みは js/tools.js で扱います */

/* ============================================================
   15. 画面遷移のボタン
   ============================================================ */
function stopTimers() {
  clearInterval(quiz.timer);
  clearInterval(typing.timer);
  cancelAuto();
  if (Speech.supported) window.speechSynthesis.cancel();
}

function goHome() {
  stopTimers();
  renderHome();
  show('home', 'まなびカード');
}

$('backBtn').onclick = () => {
  stopTimers();
  navStack.pop();
  const prev = navStack.pop();
  if (!prev || prev === 'home') { goHome(); return; }
  if (prev === 'sets' && current.subject) { openSubject(current.subject.id); return; }
  if (prev === 'mode') { show('mode', current.label); return; }
  if (prev === 'mypage') { renderMypage(); show('mypage', 'マイページ'); return; }
  goHome();
};

$('mypageBtn').onclick = () => { renderMypage(); show('mypage', 'マイページ'); };
$('reviewCta').onclick = () => startReview();
$('searchLink').onclick = () => { $('searchInput').value = ''; renderSearch(''); show('search', '単語をさがす'); };
$('addLink').onclick = () => show('add', '問題を追加');

document.querySelectorAll('.mode-card').forEach((btn) => {
  btn.onclick = () => {
    const mode = btn.dataset.mode;
    if (mode === 'card') startCard(current.set, current.label);
    else if (mode === 'type') startTyping(current.set, current.label);
    else if (mode === 'listen') startQuiz(current.set, current.label, { listen: true });
    else startQuiz(current.set, current.label);
  };
});

/* 起動処理は js/boot.js にあります（他のファイルの読み込みを待つため） */
