/* ============================================================
   まなびカード - 本体
   ------------------------------------------------------------
   このデモではログイン不要。学習データは端末内(localStorage)に
   保存します。本番でアカウントを付ける場合も、この保存部分を
   サーバー通信に差し替えるだけで済むように分けてあります。
   ============================================================ */

'use strict';

/* ---------- 設定 ---------- */
const STORAGE_KEY = 'manabi-card-v1';
const TIME_LIMIT = 10;          // 4択テストの制限時間（秒）
const MASTER_STREAK = 2;        // 連続正解が何回で「習得」になるか

/* ============================================================
   1. 保存データ
   ============================================================ */
const Store = {
  data: null,

  load() {
    try {
      this.data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
    } catch (e) {
      this.data = null;
    }
    if (!this.data) {
      this.data = { nick: '', answered: 0, items: {}, customSets: [] };
    }
    if (!this.data.items) this.data.items = {};
    if (!this.data.customSets) this.data.customSets = [];
    return this.data;
  },

  save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
  },

  /** 1問分の記録を取り出す（無ければ初期値） */
  item(id) {
    if (!this.data.items[id]) {
      this.data.items[id] = { streak: 0, mastered: false, wrong: 0, review: false };
    }
    return this.data.items[id];
  },

  /** 解答を記録する。復習コーナーへの出し入れもここで行う */
  record(id, isCorrect) {
    const rec = this.item(id);
    this.data.answered++;
    if (isCorrect) {
      rec.streak++;
      if (rec.streak >= MASTER_STREAK) rec.mastered = true;
      // 復習コーナーは「正解できたら卒業」
      if (rec.review) rec.review = false;
    } else {
      rec.streak = 0;
      rec.mastered = false;
      rec.wrong++;
      rec.review = true; // 間違えたら自動で復習コーナーへ
    }
    this.save();
    return rec;
  },

  reset() {
    this.data = { nick: this.data.nick, answered: 0, items: {}, customSets: [] };
    this.save();
  },
};

/* ============================================================
   2. 問題データの取り回し
   ============================================================ */

/** 取り込んだCSVのセットも含めた、全科目のリストを返す */
function allSubjects() {
  const list = SUBJECTS.slice();
  if (Store.data.customSets.length) {
    list.push({
      id: 'custom',
      name: '取り込んだ問題',
      icon: '📥',
      lang: 'auto',
      speakField: 'front',
      levels: Store.data.customSets.map((s) => ({
        id: s.id,
        name: s.name,
        items: s.items,
      })),
    });
  }
  return list;
}

function findSubject(id) {
  return allSubjects().find((s) => s.id === id);
}

/** レベルの中の問題を SET_SIZE ごとに区切ってセットにする */
function splitSets(level) {
  const sets = [];
  for (let i = 0; i < level.items.length; i += SET_SIZE) {
    sets.push({
      no: sets.length + 1,
      items: level.items.slice(i, i + SET_SIZE),
    });
  }
  return sets;
}

/** 全問題を1つの配列で（復習コーナー用） */
function everyItem() {
  const out = [];
  allSubjects().forEach((sub) => {
    sub.levels.forEach((lv) => {
      lv.items.forEach((it) => out.push({ item: it, subject: sub }));
    });
  });
  return out;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 4択の選択肢を自動生成する（同じレベルの他の答えを誤答に使う） */
function makeChoices(item, pool) {
  const wrongs = shuffle(pool.filter((p) => p.id !== item.id && p.back !== item.back))
    .slice(0, 3)
    .map((p) => p.back);
  return shuffle([item.back, ...wrongs]);
}

/* ============================================================
   3. 発音（ブラウザ標準の音声合成を使うので追加費用ゼロ）
   ============================================================ */
const Speech = {
  supported: 'speechSynthesis' in window,

  langOf(subject, text) {
    if (subject.lang && subject.lang !== 'auto') return subject.lang;
    // 半角英字だけなら英語、それ以外は日本語と判定
    return /^[\x20-\x7E]+$/.test(text) ? 'en-US' : 'ja-JP';
  },

  textOf(subject, item) {
    if (subject.speakField === 'reading') return item.reading || item.front;
    return item.front;
  },

  speak(subject, item) {
    if (!this.supported) return;
    const text = this.textOf(subject, item);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = this.langOf(subject, text);
    u.rate = u.lang === 'en-US' ? 0.9 : 1.0;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  },
};

/* ============================================================
   4. 画面の切り替え
   ============================================================ */
const SCREENS = ['home', 'sets', 'mode', 'card', 'quiz', 'result', 'mypage', 'import'];
const $ = (id) => document.getElementById(id);
let navStack = [];

function show(name, title, opts) {
  opts = opts || {};
  SCREENS.forEach((s) => { $('screen-' + s).hidden = (s !== name); });
  $('appTitle').textContent = title || 'まなびカード';
  if (!opts.noHistory) {
    if (name === 'home') navStack = [];
    else navStack.push(name);
  }
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

/* ============================================================
   5. 画面ごとの描画
   ============================================================ */
const current = { screen: 'home', subject: null, set: null, label: '' };

/* ---------- ホーム ---------- */
function renderHome() {
  const d = Store.data;
  const nick = d.nick || 'ゲスト';
  $('heroHello').textContent = `こんにちは、${nick} さん`;

  let mastered = 0;
  Object.values(d.items).forEach((r) => { if (r.mastered) mastered++; });
  const reviewCount = reviewItems().length;

  $('statMastered').textContent = mastered;
  $('statAnswered').textContent = d.answered;
  $('statReview').textContent = reviewCount;

  const cta = $('reviewCta');
  if (reviewCount > 0) {
    cta.classList.add('is-active');
    $('reviewCtaSub').textContent = `${reviewCount}問たまっています。タップで復習をはじめる`;
  } else {
    cta.classList.remove('is-active');
    $('reviewCtaSub').textContent = '間違えた問題はここに自動でたまります';
  }

  const list = $('subjectList');
  list.innerHTML = '';
  allSubjects().forEach((sub) => {
    const total = sub.levels.reduce((n, lv) => n + lv.items.length, 0);
    let done = 0;
    sub.levels.forEach((lv) => lv.items.forEach((it) => {
      if (d.items[it.id] && d.items[it.id].mastered) done++;
    }));
    const btn = document.createElement('button');
    btn.className = 'subject-card';
    btn.innerHTML = `
      <span class="subject-card__icon">${sub.icon}</span>
      <span class="subject-card__body">
        <span class="subject-card__name">${sub.name}</span>
        <span class="subject-card__meta">全${total}問 ・ 習得 ${done}問</span>
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
      btn.onclick = () => {
        current.set = set.items;
        current.label = `${sub.name} ${lv.name} セット${set.no}`;
        $('modeTitle').textContent = current.label;
        show('mode', current.label);
      };
      grid.appendChild(btn);
    });
    block.appendChild(grid);
    wrap.appendChild(block);
  });

  $('setsTitle').textContent = `${sub.name}｜セットをえらぶ`;
  show('sets', sub.name);
}

/* ---------- 復習コーナー ---------- */
function reviewItems() {
  return everyItem().filter(({ item }) => {
    const r = Store.data.items[item.id];
    return r && r.review;
  });
}

function startReview() {
  const list = reviewItems();
  if (!list.length) {
    toast('復習する問題はまだありません');
    return;
  }
  const picked = shuffle(list).slice(0, SET_SIZE);
  current.subject = null; // 科目混在
  startQuiz(picked.map((p) => p.item), '復習コーナー', {
    review: true,
    subjectOf: (item) => (list.find((p) => p.item.id === item.id) || picked[0]).subject,
    pool: list.map((p) => p.item),
  });
}

/* ============================================================
   6. フラッシュカード
   ============================================================ */
const cardSession = { items: [], idx: 0 };

function startCard(items, label) {
  cardSession.items = shuffle(items);
  cardSession.idx = 0;
  show('card', label);
  drawCard();
}

function drawCard() {
  const s = cardSession;
  const item = s.items[s.idx];
  const sub = current.subject;
  $('flashcard').classList.remove('is-flipped');
  $('cardFront').textContent = item.front;
  $('cardBack').textContent = item.back;
  $('cardExp').textContent = item.explanation || '';
  $('cardCounter').textContent = `${s.idx + 1} / ${s.items.length}`;
  $('cardProgress').style.width = `${((s.idx) / s.items.length) * 100}%`;
  $('cardSpeak').hidden = !Speech.supported;
  $('cardNext').textContent = (s.idx === s.items.length - 1) ? '終わる' : '次へ ›';
  if (sub && sub.id === 'english') Speech.speak(sub, item);
}

$('flashcard').onclick = () => $('flashcard').classList.toggle('is-flipped');
$('cardSpeak').onclick = (e) => {
  e.stopPropagation();
  Speech.speak(current.subject || { lang: 'auto', speakField: 'front' }, cardSession.items[cardSession.idx]);
};
$('cardNext').onclick = () => {
  const s = cardSession;
  if (s.idx < s.items.length - 1) {
    s.idx++;
    drawCard();
  } else {
    showResult({ mode: 'card', total: s.items.length });
  }
};

/* ============================================================
   7. 4択テスト
   ============================================================ */
const quiz = {
  items: [], idx: 0, correct: 0, wrong: [], label: '',
  review: false, subjectOf: null, pool: [], timer: null, left: 0, locked: false,
};

function startQuiz(items, label, opts) {
  opts = opts || {};
  quiz.items = shuffle(items);
  quiz.idx = 0;
  quiz.correct = 0;
  quiz.wrong = [];
  quiz.label = label;
  quiz.review = !!opts.review;
  quiz.subjectOf = opts.subjectOf || (() => current.subject);
  quiz.pool = opts.pool || items;
  show('quiz', label);
  drawQuiz();
}

function drawQuiz() {
  clearInterval(quiz.timer);
  quiz.locked = false;
  const item = quiz.items[quiz.idx];
  const sub = quiz.subjectOf(item);

  $('quizFeedback').hidden = true;
  $('quizCounter').textContent = `${quiz.idx + 1} / ${quiz.items.length}`;
  $('quizProgress').style.width = `${(quiz.idx / quiz.items.length) * 100}%`;
  $('quizFront').textContent = item.front;
  $('quizSpeak').hidden = !Speech.supported;

  const box = $('quizChoices');
  box.innerHTML = '';
  makeChoices(item, quiz.pool).forEach((text) => {
    const b = document.createElement('button');
    b.className = 'choice';
    b.textContent = text;
    b.onclick = () => answer(text === item.back, b, item);
    box.appendChild(b);
  });

  if (sub && sub.id === 'english') Speech.speak(sub, item);
  startTimer(item);
}

function startTimer(item) {
  quiz.left = TIME_LIMIT;
  const el = $('quizTimer');
  el.textContent = TIME_LIMIT;
  el.classList.remove('is-hurry');
  quiz.timer = setInterval(() => {
    quiz.left -= 0.1;
    const sec = Math.max(0, Math.ceil(quiz.left));
    el.textContent = sec;
    if (sec <= 3) el.classList.add('is-hurry');
    if (quiz.left <= 0) {
      clearInterval(quiz.timer);
      answer(false, null, item, true);
    }
  }, 100);
}

function answer(isCorrect, btn, item, timeUp) {
  if (quiz.locked) return;
  quiz.locked = true;
  clearInterval(quiz.timer);

  const sub = quiz.subjectOf(item);
  Store.record(item.id, isCorrect);
  if (isCorrect) quiz.correct++;
  else quiz.wrong.push(item);

  // 選択肢の色分け（正解を必ず緑で見せる）
  Array.from($('quizChoices').children).forEach((b) => {
    b.disabled = true;
    if (b.textContent === item.back) b.classList.add('is-correct');
  });
  if (btn && !isCorrect) btn.classList.add('is-wrong');

  const mark = $('fbMark');
  mark.textContent = isCorrect ? '◯ 正解！' : (timeUp ? '△ 時間ぎれ' : '✕ ざんねん');
  mark.className = 'feedback__mark ' + (isCorrect ? 'ok' : 'ng');
  $('fbAnswer').textContent = `${item.front} ： ${item.back}`;
  $('fbExp').textContent = item.explanation || '';
  $('fbSpeak').hidden = !Speech.supported;
  $('fbSpeak').onclick = () => Speech.speak(sub, item);
  $('quizFeedback').hidden = false;

  if (!isCorrect) Speech.speak(sub, item);
  $('fbNext').textContent = (quiz.idx === quiz.items.length - 1) ? '結果を見る' : '次へ ›';
}

$('quizSpeak').onclick = () => {
  const item = quiz.items[quiz.idx];
  Speech.speak(quiz.subjectOf(item), item);
};

$('fbNext').onclick = () => {
  if (quiz.idx < quiz.items.length - 1) {
    quiz.idx++;
    drawQuiz();
  } else {
    showResult({
      mode: 'quiz',
      total: quiz.items.length,
      correct: quiz.correct,
      wrong: quiz.wrong,
    });
  }
};

/* ============================================================
   8. 結果画面
   ============================================================ */
function showResult(res) {
  const retry = $('resultRetryWrong');
  const again = $('resultAgain');

  if (res.mode === 'card') {
    $('resultEmoji').textContent = '🗂️';
    $('resultCorrect').parentElement.hidden = true;
    $('resultNote').textContent = `カードを${res.total}枚めくりました。次はテストで確認してみましょう。`;
    retry.hidden = false;
    retry.textContent = '4択テストに挑戦する';
    retry.onclick = () => startQuiz(cardSession.items, current.label);
    again.textContent = 'もう一度カードを見る';
    again.onclick = () => startCard(cardSession.items, current.label);
  } else {
    const rate = res.correct / res.total;
    $('resultEmoji').textContent = rate === 1 ? '🎉' : rate >= 0.7 ? '👍' : '💪';
    $('resultCorrect').parentElement.hidden = false;
    $('resultCorrect').textContent = res.correct;
    $('resultTotal').textContent = res.total;

    const left = reviewItems().length;
    if (res.wrong.length) {
      $('resultNote').textContent =
        `間違えた${res.wrong.length}問は復習コーナーに入りました。（復習待ち 合計${left}問）`;
      retry.hidden = false;
      retry.textContent = '間違えた問題だけやり直す';
      retry.onclick = () => startQuiz(res.wrong, quiz.label, {
        review: quiz.review, subjectOf: quiz.subjectOf, pool: quiz.pool,
      });
    } else {
      $('resultNote').textContent = quiz.review
        ? '復習コーナーの問題をクリアしました！'
        : `全問正解！ 連続${MASTER_STREAK}回正解した問題は「習得」になります。`;
      retry.hidden = true;
    }
    again.textContent = 'もう一度';
    again.onclick = () => startQuiz(quiz.items, quiz.label, {
      review: quiz.review, subjectOf: quiz.subjectOf, pool: quiz.pool,
    });
  }

  show('result', '結果');
}

$('resultHome').onclick = () => goHome();

/* ============================================================
   9. マイページ
   ============================================================ */
function renderMypage() {
  $('nickInput').value = Store.data.nick || '';
  const tb = $('mypageTable');
  let html = '<tr><th>科目</th><th>習得</th><th>復習待ち</th></tr>';
  allSubjects().forEach((sub) => {
    let mastered = 0, review = 0, total = 0;
    sub.levels.forEach((lv) => lv.items.forEach((it) => {
      total++;
      const r = Store.data.items[it.id];
      if (!r) return;
      if (r.mastered) mastered++;
      if (r.review) review++;
    }));
    html += `<tr><td>${sub.icon} ${sub.name}</td><td>${mastered} / ${total}</td><td>${review}</td></tr>`;
  });
  tb.innerHTML = html;
}

$('nickInput').oninput = (e) => {
  Store.data.nick = e.target.value.trim();
  Store.save();
};

$('resetBtn').onclick = () => {
  if (confirm('学習データをすべて消します。よろしいですか？')) {
    Store.reset();
    renderMypage();
    toast('リセットしました');
  }
};

/* ============================================================
   10. CSV取り込み
   ============================================================ */
$('csvImportBtn').onclick = () => {
  const raw = $('csvInput').value.trim();
  if (!raw) { $('csvMsg').textContent = 'データが入力されていません。'; return; }

  const items = [];
  raw.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const cols = line.split(',').map((c) => c.trim());
    if (cols.length < 2 || !cols[0] || !cols[1]) return;
    items.push({
      id: `cs-${Date.now()}-${i}`,
      front: cols[0],
      back: cols[1],
      explanation: cols[2] || '',
      reading: cols[3] || '',
    });
  });

  if (items.length < 4) {
    $('csvMsg').textContent = '4択にするため、4行以上のデータを入れてください。';
    return;
  }

  Store.data.customSets.push({
    id: 'cs-' + Date.now(),
    name: $('csvName').value.trim() || `取り込み ${Store.data.customSets.length + 1}`,
    items,
  });
  Store.save();
  $('csvInput').value = '';
  $('csvName').value = '';
  $('csvMsg').textContent = `${items.length}問を追加しました。ホームの「取り込んだ問題」から使えます。`;
  toast(`${items.length}問を追加しました`);
};

/* ============================================================
   11. 画面遷移のボタン
   ============================================================ */
function goHome() {
  clearInterval(quiz.timer);
  renderHome();
  show('home', 'まなびカード');
}

$('backBtn').onclick = () => {
  clearInterval(quiz.timer);
  navStack.pop();                 // 今の画面
  const prev = navStack.pop();    // ひとつ前
  if (!prev || prev === 'home') { goHome(); return; }
  if (prev === 'sets' && current.subject) { openSubject(current.subject.id); return; }
  if (prev === 'mode') { show('mode', current.label); return; }
  goHome();
};

$('mypageBtn').onclick = () => {
  renderMypage();
  show('mypage', 'マイページ');
};

$('reviewCta').onclick = () => startReview();
$('importLink').onclick = () => show('import', 'CSVで問題を追加');

document.querySelectorAll('.mode-card').forEach((btn) => {
  btn.onclick = () => {
    const mode = btn.dataset.mode;
    if (mode === 'card') startCard(current.set, current.label);
    else startQuiz(current.set, current.label);
  };
});

/* ============================================================
   12. 起動
   ============================================================ */
Store.load();
goHome();

// PWA（ホーム画面に追加・オフライン表示）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* デモでは失敗しても無視 */ });
  });
}
