/* ============================================================
   ディクテーション（書き取り）
   ------------------------------------------------------------
   音声を聞いて、空いているところを入力する形式です。

   問題データの書き方（front の列）：
     I have been [studying] English for three years.
       → 角かっこの中が答え。かっこ以外はそのまま画面に出ます
     わたしは[毎日|まいにち]走っています。
       → 「|」で区切ると、どちらで答えても正解になります
     角かっこが無い場合は、文全体を書き取る問題になります

   日本語入力（漢字変換）については、変換を確定するための Enter と
   「答え合わせ」がぶつからないよう、変換中は送信しないようにしています。
   ============================================================ */

'use strict';

const DICT_TIME_LIMIT = 40;   // 制限時間の初期値（秒）

const dict = {
  items: [], idx: 0, correct: 0, wrong: [], label: '',
  timer: null, left: 0, locked: false, startAt: 0, ms: 0, skipped: {},
  parts: [],
};

/* ---------- 問題文の解析 ---------- */

/** 角かっこの有無で、書き取り問題かどうかを判定する */
function isDictationItem(item) {
  return !!(item && item.front && /\[[^\]]+\]/.test(item.front));
}

/**
 * そのセットが書き取り向きか（空欄のある問題が1問でもあるか）。
 * 「すべての問題に空欄があること」を条件にすると、1問でも角かっこを
 * 書き忘れたときにセットごと書き取りモードが消えてしまうため、
 * 1問でもあれば使えるようにしています。空欄のない問題は全文入力になります。
 */
function isDictationSet(items) {
  return items.length > 0 && items.some(isDictationItem);
}

/**
 * 「I have been [studying] English.」を
 * [{text:'I have been '}, {blank:true, answers:['studying']}, {text:' English.'}]
 * の形に分解する。
 */
function parseSentence(front) {
  const src = String(front || '');
  if (!/\[[^\]]+\]/.test(src)) {
    // 空欄が無いときは、文全体を書き取ってもらう
    return [{ blank: true, answers: [src], whole: true }];
  }
  const parts = [];
  const re = /\[([^\]]+)\]/g;
  let last = 0, m;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) parts.push({ text: src.slice(last, m.index) });
    parts.push({
      blank: true,
      answers: m[1].split('|').map((s) => s.trim()).filter(Boolean),
    });
    last = m.index + m[0].length;
  }
  if (last < src.length) parts.push({ text: src.slice(last) });
  // 文全体を [ ] で囲んだときも「全文の書き取り」として扱い、
  // 入力欄を文の長さに合わせて広くします。
  if (parts.length === 1 && parts[0].blank) parts[0].whole = true;
  return parts;
}

/** 空欄の答えのどれかに一致するか */
function blankMatches(input, answers) {
  return answers.some((a) => answerMatches(input, a));
}

/* ---------- 出題 ---------- */
function startDictation(items, label) {
  resetAnswered();
  dict.items = shuffle(items);
  dict.idx = 0;
  dict.correct = 0;
  dict.wrong = [];
  dict.label = label;
  dict.ms = 0;
  dict.skipped = {};
  show('dict', label);
  drawDictation();
}

function drawDictation() {
  clearInterval(dict.timer);
  dict.locked = false;
  const item = dict.items[dict.idx];
  const sub = current.subject || subjectOfItem(item);

  $('dictFeedback').hidden = true;
  $('dictSkip').hidden = false;
  $('dictDontKnow').hidden = false;
  $('dictCheck').hidden = false;
  $('dictCounter').textContent = `${dict.idx + 1} / ${dict.items.length}`;
  $('dictProgress').style.width = `${(dict.idx / dict.items.length) * 100}%`;

  dict.parts = parseSentence(item.front);
  renderSentence();

  const blanks = dict.parts.filter((p) => p.blank);
  $('dictHint').textContent = blanks.length === 1 && blanks[0].whole
    ? '聞こえた文をそのまま入力してください'
    : `空いているところ ${blanks.length} か所を入力してください`;

  const first = document.querySelector('#dictSentence .dict-blank');
  if (first) first.focus();

  dict.startAt = Date.now();
  Speech.speak(sub, item);       // 最初に一度読み上げる
  startDictTimer(item);
}

/** 文を組み立てて画面に出す（空欄は入力欄になります） */
function renderSentence() {
  const box = $('dictSentence');
  box.innerHTML = '';
  const item = dict.items[dict.idx];

  dict.parts.forEach((p, i) => {
    if (!p.blank) {
      const span = document.createElement('span');
      span.className = 'dict-text';
      span.textContent = p.text;
      box.appendChild(span);
      return;
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'dict-blank' + (p.whole ? ' dict-blank--wide' : '');
    input.dataset.part = String(i);
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    if (!p.whole) {
      // 答えの長さに合わせて入力欄の幅を決めます（長さのヒントにもなります）
      const len = Math.max(4, p.answers[0].length + 2);
      input.style.width = Math.min(len, 24) + 'ch';
    }
    // 日本語入力の変換中かどうかを覚えておく
    input.addEventListener('compositionstart', () => { input.dataset.composing = '1'; });
    input.addEventListener('compositionend', () => { delete input.dataset.composing; });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      // 変換を確定するためのEnterでは答え合わせをしない
      if (input.dataset.composing || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      const all = [...document.querySelectorAll('#dictSentence .dict-blank')];
      const next = all[all.indexOf(input) + 1];
      if (next) next.focus();
      else judgeDictation(false);
    });
    box.appendChild(input);
  });

  if (item && !dict.parts.some((p) => !p.blank)) {
    box.classList.add('dict-sentence--whole');
  } else {
    box.classList.remove('dict-sentence--whole');
  }
}

function startDictTimer(item) {
  const limit = limitFor(item, DICT_TIME_LIMIT);
  const el = $('dictTimer');
  if (!limit) { el.textContent = '∞'; el.classList.remove('is-hurry'); return; }
  dict.left = limit;
  el.textContent = limit;
  el.classList.remove('is-hurry');
  dict.timer = setInterval(() => {
    dict.left -= 0.1;
    const sec = Math.max(0, Math.ceil(dict.left));
    el.textContent = sec;
    if (sec <= 3) el.classList.add('is-hurry');
    if (dict.left <= 0) {
      clearInterval(dict.timer);
      judgeDictation(true);
    }
  }, 100);
}

/* ---------- 採点 ---------- */
function judgeDictation(timeUp, unknown) {
  if (dict.locked) return;
  dict.locked = true;
  clearInterval(dict.timer);
  $('dictSkip').hidden = true;
  $('dictCheck').hidden = true;
  $('dictDontKnow').hidden = true;

  const item = dict.items[dict.idx];
  const sub = current.subject || subjectOfItem(item);
  const inputs = [...document.querySelectorAll('#dictSentence .dict-blank')];

  let allOk = !timeUp && !unknown;
  inputs.forEach((input) => {
    const part = dict.parts[Number(input.dataset.part)];
    const ok = !timeUp && !unknown && blankMatches(input.value, part.answers);
    input.classList.add(ok ? 'is-ok' : 'is-ng');
    input.disabled = true;
    if (!ok) {
      allOk = false;
      // 正しい答えを空欄の下に出す
      const tag = document.createElement('span');
      tag.className = 'dict-correct';
      tag.textContent = part.answers[0];
      input.insertAdjacentElement('afterend', tag);
    }
  });

  const ms = Date.now() - dict.startAt;
  dict.ms += ms;
  Store.record(item.id, allOk, ms, { unknown: !!unknown });
  if (allOk) dict.correct++;
  else dict.wrong.push(item);

  const outcome = outcomeOf(allOk, timeUp, unknown);
  pushAnswered(item, outcome);
  const mark = $('dictMark');
  mark.textContent = { ok: '◯ 正解！', ng: '✕ おしい', timeup: '△ 時間ぎれ', unknown: '？ わからない' }[outcome];
  mark.className = 'feedback__mark ' + (allOk ? 'ok' : 'ng');
  $('dictAnswer').textContent = stripBlanks(item.front);
  $('dictExp').textContent = item.explanation || (item.back ? `意味： ${item.back}` : '');
  setExample($('dictExample'), item);
  $('dictSpeak').hidden = !Speech.supported;
  $('dictSpeak').onclick = () => Speech.speak(sub, item);
  $('dictFeedback').hidden = false;
  $('dictNext').textContent = (dict.idx === dict.items.length - 1) ? '結果を見る' : '次へ ›';

  Speech.speak(sub, item, () => autoAdvance(outcome, () => $('dictNext').click()));
}

function skipDictation() {
  if (dict.locked) return;
  const item = dict.items[dict.idx];
  const n = (dict.skipped[item.id] || 0) + 1;
  dict.skipped[item.id] = n;
  clearInterval(dict.timer);

  if (n <= 1 && dict.idx < dict.items.length - 1) {
    dict.items.splice(dict.idx, 1);
    dict.items.push(item);
    drawDictation();
  } else if (dict.idx < dict.items.length - 1) {
    dict.idx++;
    drawDictation();
  } else {
    finishDictation();
  }
}

function finishDictation() {
  const label = dict.label;
  const items = dict.items;
  const answered = dict.correct + dict.wrong.length;
  if (answered === items.length && dict.wrong.length === 0) Store.data.flags.perfect = true;
  Store.data.flags.clean = reviewItems().length === 0;
  Store.save();

  showResult({
    mode: 'dict',
    total: items.length,
    correct: dict.correct,
    wrong: dict.wrong,
    ms: dict.ms,
    answered,
    retryFn: (wrong) => startDictation(wrong, label),
    againFn: () => startDictation(items, label),
  });
}

/* ---------- ボタン ---------- */
$('dictPlay').onclick = () => {
  const item = dict.items[dict.idx];
  Speech.speak(current.subject || subjectOfItem(item), item);
};
$('dictCheck').onclick = () => judgeDictation(false);
$('dictSkip').onclick = skipDictation;
$('dictDontKnow').onclick = () => judgeDictation(false, true);
$('dictNext').onclick = () => {
  cancelAuto();
  if (dict.idx < dict.items.length - 1) {
    dict.idx++;
    drawDictation();
  } else {
    finishDictation();
  }
};
