/* ============================================================
   運用まわりの機能
   ------------------------------------------------------------
   ・記録の書き出し／読み込み（USBメモリでの持ち運びに使います）
   ・紙のテストの印刷
   ・登録した問題の編集・削除
   ・CSV／Excel貼り付けからの取り込み
   ・問題データを外部のCSVファイルから読み込む仕組み
   ============================================================ */

'use strict';

/* ============================================================
   1. 表データの解析（CSV・Excelからの貼り付けの両方に対応）
   ------------------------------------------------------------
   ・区切りはカンマとタブを自動判別
   ・"..." で囲めば、中にカンマや改行があっても1つの項目として扱う
   ============================================================ */
function parseTable(text) {
  const src = text.replace(/\r\n?/g, '\n').trim();
  if (!src) return [];

  // 1行目にタブが多ければタブ区切りとみなす（Excelからの貼り付け）
  const head = src.split('\n')[0];
  const delim = (head.split('\t').length > head.split(',').length) ? '\t' : ',';

  const rows = [];
  let row = [], field = '', quoted = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }   // "" は文字としての "
        else quoted = false;
      } else field += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === delim) {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  row.push(field);
  rows.push(row);

  return rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.length >= 2 && r[0] && r[1]);
}

/**
 * 表の1行を問題データに変換する。
 * 列の順番： 問題, 答え, 解説, 例文, 制限時間, 読み, 誤答1, 誤答2, 誤答3, セット
 * 7列目から先は無くてもかまいません（そのときは誤答を自動で作ります）。
 * 10列目の「セット」は、1つのファイルを単元ごとに分けて登録するための欄です
 * （2026-08-06 追加）。空欄なら、これまでどおり画面で入れた名前でまとめます。
 */
function rowToItem(cols, idPrefix, i) {
  const wrong = [cols[6], cols[7], cols[8]]
    .map((s) => String(s == null ? '' : s).trim())
    .filter(Boolean);
  return {
    id: `${idPrefix}-${i}`,
    front: cols[0],
    back: cols[1],
    explanation: cols[2] || '',
    example: cols[3] || '',
    time: Number(cols[4]) || 0,
    reading: cols[5] || '',
    wrong,                 // 作問者が指定した誤答（4択で使います）
    set: String(cols[9] == null ? '' : cols[9]).trim(),
    image: String(cols[10] == null ? '' : cols[10]).trim(),
  };
}

/**
 * 「セット」欄の中身で、問題を単元ごとに分けます。
 * 書いていない問題は、画面で入れた名前（fallback）にまとめます。
 * 並び順は、ファイルに出てきた順のままです（先生が並べた順を尊重するため）。
 */
function groupBySet(items, fallback) {
  const order = [];
  const map = new Map();
  items.forEach((it) => {
    const name = it.set || fallback;
    if (!map.has(name)) { map.set(name, []); order.push(name); }
    map.get(name).push(it);
    it.set = name;         // 書き出したときに、同じ形で戻せるようにします
  });
  return order.map((name) => ({ name, items: map.get(name) }));
}

/** 分けた単元を、まとめて登録します。戻り値は登録した単元の数と問題数 */
function addGroupedSets(rows, fallback, idBase) {
  const items = rows.map((cols, i) => rowToItem(cols, idBase, i));
  const groups = groupBySet(items, fallback);
  groups.forEach((g, gi) => {
    Store.data.customSets.push({ id: `${idBase}-g${gi}`, name: g.name, items: g.items });
  });
  Store.save();
  invalidateSearchIndex();
  return { groups: groups.length, count: items.length, names: groups.map((g) => g.name) };
}

/**
 * 1行目が見出し（項目名）かどうかを見分けます。
 * 「問題,答え,…」のような行を問題として登録してしまわないようにするためです。
 */
const HEADER_WORDS = ['問題', '答え', '正解', '解説', '例文', '制限時間', '読み',
                      '誤答', 'ダミー', '由来', 'セット', '単元', '画像', '図'];
function looksLikeHeader(row) {
  if (!row || row.length < 2) return false;
  const hit = row.filter((c) => HEADER_WORDS.some((w) => String(c).indexOf(w) === 0)).length;
  // 先頭2つが項目名らしく、行全体の半分以上が項目名なら見出しとみなします
  return hit >= 2 && hit >= Math.ceil(row.length / 2);
}

/** 見出し行があれば取り除く */
function dropHeader(rows) {
  return (rows.length && looksLikeHeader(rows[0])) ? rows.slice(1) : rows;
}

/* ============================================================
   2. CSVでまとめて追加
   ============================================================ */
$('csvImportBtn').onclick = () => {
  const raw = $('csvInput').value;
  const rows = dropHeader(parseTable(raw));
  if (!rows.length) { $('csvMsg').textContent = 'データが読み取れませんでした。'; return; }
  if (rows.length < 4) {
    $('csvMsg').textContent = '4択にするため、4行以上のデータを入れてください。';
    return;
  }

  const stamp = Date.now();
  const fallback = $('csvName').value.trim() || `取り込み ${Store.data.customSets.length + 1}`;
  const r = addGroupedSets(rows, fallback, `cs-${stamp}`);
  $('csvInput').value = '';
  $('csvName').value = '';
  $('csvMsg').textContent = r.groups > 1
    ? `${r.count}問を、${r.groups}つの単元に分けて追加しました（${r.names.join('／')}）。`
    : `${r.count}問を追加しました。ホームの「取り込んだ問題」から使えます。`;
  toast(`${r.count}問を追加しました`);
};

/* ============================================================
   3. 記録の書き出し／読み込み（USBメモリでの持ち運び）
   ============================================================ */
function exportData() {
  const payload = {
    app: 'manabi-card',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: Store.data,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const name = (Store.data.nick || 'ゲスト').replace(/[\\/:*?"<>|]/g, '');
  downloadBlob(blob, `SJ式_${name}_${today()}.json`);
  toast('記録を書き出しました');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    let payload;
    try {
      payload = JSON.parse(reader.result);
    } catch (e) {
      $('ioMsg').textContent = 'ファイルを読み取れませんでした。';
      return;
    }
    if (!payload || payload.app !== 'manabi-card' || !payload.data) {
      $('ioMsg').textContent = 'このアプリの記録ファイルではないようです。';
      return;
    }
    const nick = payload.data.nick || 'ゲスト';
    if (!confirm(`「${nick}」さんの記録を読み込みます。\nいまこの端末にある記録は置きかえられます。よろしいですか？`)) return;

    // 読み込んだ記録を端末に置いてから読み直します。
    // サーバーを使う設定のときは、このあと裏で送信されます
    Backend.writeLocal(payload.data);
    await Store.load();
    Store.save();
    invalidateSearchIndex();
    $('ioMsg').textContent = `「${nick}」さんの記録を読み込みました。`;
    renderMypage();
    toast('記録を読み込みました');
  };
  reader.readAsText(file);
}

$('exportBtn').onclick = exportData;
$('importInput').onchange = (e) => {
  if (e.target.files && e.target.files[0]) importData(e.target.files[0]);
  e.target.value = '';
};

/* ============================================================
   3-1-2. 先生用の機能の出し分け
   ------------------------------------------------------------
   「CSVでまとめて追加」は生徒には見せない、というご要望への対応です。
   合言葉を入れた端末だけで表示します。
   ※これは「うっかり触らせない」ための目隠しです。端末の中を
     調べれば合言葉は分かるため、鍵として扱わないでください。
   ============================================================ */
const DEFAULT_TEACHER_CODE = 'sensei';

function teacherCode() {
  return Store.data.teacherCode || DEFAULT_TEACHER_CODE;
}

function renderTeacher() {
  /*
   * 役割が選ばれているときは、合言葉ではなく役割で決めます。
   * 選ばれていないあいだ（第1段階の使い方）は、これまでどおり合言葉です。
   */
  const on = Auth.enforcing ? Auth.can('manageQuestions') : !!Store.data.flags.teacher;
  $('csvCard').hidden = !on;
  $('teacherCard').hidden = !on;
  // 役割で決まるようになったら、合言葉の入り口は出しません
  $('teacherUnlock').hidden = on || Auth.enforcing;
  $('teacherCodeInput').value = teacherCode();
}

$('teacherUnlock').onclick = () => {
  const code = prompt('先生用の合言葉を入力してください');
  if (code === null) return;
  if (code.trim() !== teacherCode()) { toast('合言葉がちがいます'); return; }
  Store.data.flags.teacher = true;
  Store.save();
  renderTeacher();
  toast('先生用の機能を表示しました');
};

$('teacherLock').onclick = () => {
  Store.data.flags.teacher = false;
  Store.save();
  renderTeacher();
  toast('先生用の機能を隠しました');
};

$('teacherCodeInput').onchange = () => {
  const v = $('teacherCodeInput').value.trim();
  if (!v) { $('teacherCodeInput').value = teacherCode(); return; }
  Store.data.teacherCode = v;
  Store.save();
  toast('合言葉を変えました');
};

/* ============================================================
   3-2. 問題データの書き出し／ファイル取り込み
   ------------------------------------------------------------
   作った問題をCSVファイルにして配れるようにします。
   受け取った側は「問題を追加 → ファイルを選ぶ」で読み込めます。
   ============================================================ */
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n\t]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** 問題の配列を、取り込みと同じ列順のCSVにする（1行目に見出しを付けます） */
const CSV_HEADER = ['問題', '答え', '解説', '例文', '制限時間', '読み', '誤答1', '誤答2', '誤答3', 'セット', '画像'];
function itemsToCsv(items) {
  const rows = items.map((it) => {
    const w = Array.isArray(it.wrong) ? it.wrong : [];
    return [
      it.front, it.back, it.explanation || '', it.example || '',
      it.time || '', it.reading || '',
      w[0] || '', w[1] || '', w[2] || '', it.set || '', it.image || '',
    ].map(csvCell).join(',');
  });
  return [CSV_HEADER.join(',')].concat(rows).join('\r\n');
}

function exportQuestions(items, name) {
  if (!items.length) { toast('書き出す問題がありません'); return; }
  // Excelで開いても文字化けしないよう、先頭に印を付けます
  const blob = new Blob(['﻿' + itemsToCsv(items)], { type: 'text/csv;charset=utf-8' });
  const safe = String(name || '問題').replace(/[\\/:*?"<>|]/g, '');
  downloadBlob(blob, `${safe}_${today()}.csv`);
  toast(`${items.length}問を書き出しました`);
}

function allMyQuestions() {
  const out = Store.data.myWords.slice();
  Store.data.customSets.forEach((s) => { out.push.apply(out, s.items); });
  return out;
}

$('exportAllQuestions').onclick = () => exportQuestions(allMyQuestions(), 'SJ式_問題');

/** CSVファイルを選んで取り込む */
$('csvFileInput').onchange = (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const rows = dropHeader(parseTable(String(reader.result).replace(/^﻿/, '')));
    if (rows.length < 4) {
      $('csvMsg').textContent = '4択にするため、4行以上のデータが入ったファイルを選んでください。';
      return;
    }
    const stamp = Date.now();
    const fallback = file.name.replace(/\.(csv|txt)$/i, '').replace(/_\d{4}-\d{2}-\d{2}$/, '');
    const r = addGroupedSets(rows, fallback, `cs-${stamp}`);
    $('csvMsg').textContent = r.groups > 1
      ? `ファイルから${r.count}問を、${r.groups}つの単元に分けて追加しました（${r.names.join('／')}）。`
      : `ファイルから${r.count}問を追加しました。`;
    toast(`${r.count}問を追加しました`);
  };
  reader.readAsText(file);
};

/* ============================================================
   3-3. 学習記録のCSV書き出し（先生の集計用）
   ============================================================ */
function toCsvRows(rows) {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

function saveCsv(rows, name) {
  const blob = new Blob(['﻿' + toCsvRows(rows)], { type: 'text/csv;charset=utf-8' });
  const nick = (Store.data.nick || 'ゲスト').replace(/[\\/:*?"<>|]/g, '');
  downloadBlob(blob, `${name}_${nick}_${today()}.csv`);
  toast('CSVで書き出しました');
}

/** 問題ごとの記録 */
$('exportItemsCsv').onclick = () => {
  const now = Date.now();
  const rows = [['科目', 'レベル', '問題', '答え', '解答回数', '間違い回数',
                 'わからない回数', '連続正解', '習得', '平均秒', '次に復習する日']];
  allSubjects().forEach((sub) => {
    sub.levels.forEach((lv) => lv.items.forEach((it) => {
      const r = Store.data.items[it.id];
      if (!r || !r.count) return;                 // 一度も解いていない問題は出しません
      rows.push([
        sub.name, lv.name, stripBlanks(it.front), it.back,
        r.count, r.wrong, r.unknown || 0, r.streak, r.mastered ? '習得' : '',
        r.ms && r.count ? (r.ms / r.count / 1000).toFixed(1) : '',
        r.due ? new Date(r.due).toLocaleDateString('ja-JP') : '',
      ]);
    }));
  });
  if (rows.length === 1) { toast('まだ記録がありません'); return; }
  saveCsv(rows, '学習記録_問題ごと');
};

/** 日ごとの記録（学習量と出席） */
$('exportDailyCsv').onclick = () => {
  const d = Store.data;
  const keys = Object.keys(d.daily).concat(Object.keys(d.attendance.logs));
  const days = Array.from(new Set(keys)).sort();
  if (!days.length) { toast('まだ記録がありません'); return; }

  const rows = [['日付', '解答数', '正解数', '正答率', '出席', '入室', '退室', '勉強時間（分）']];
  days.forEach((day) => {
    const s = d.daily[day] || { n: 0, ok: 0 };
    const a = d.attendance.logs[day];
    const first = a && a.sessions.length ? a.sessions[0] : null;
    const last = a && a.sessions.length ? a.sessions[a.sessions.length - 1] : null;
    const hm = (t) => (t ? new Date(t).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '');
    rows.push([
      day, s.n, s.ok, s.n ? Math.round((s.ok / s.n) * 100) + '%' : '',
      a ? '○' : '', hm(first && first.in),
      (last && last.noExit) ? '記録なし' : hm(last && last.out),
      a ? a.minutes : '',
    ]);
  });
  saveCsv(rows, '学習記録_日ごと');
};

/* ============================================================
   3-4. 今日のまとめ（おうちの人へ渡す1枚）
   ============================================================ */
function renderSummary() {
  const d = Store.data;
  const day = today();
  const s = d.daily[day] || { n: 0, ok: 0 };
  const a = d.attendance.logs[day];
  const hm = (t) => new Date(t).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

  let attend = '<p class="sum__none">今日の出入りの記録はありません。</p>';
  if (a && a.sessions.length) {
    const lines = a.sessions.map((x) => {
      if (x.noExit) return `${hm(x.in)} 〜 <span class="sum__warn">退室の記録なし</span>`;
      return x.out ? `${hm(x.in)} 〜 ${hm(x.out)}` : `${hm(x.in)} 〜 （まだ勉強中）`;
    });
    attend = `<p class="sum__big">${lines.join('<br>')}</p>
      <p class="sum__sub">今日の勉強時間　<b>${formatMinutes(a.minutes)}</b></p>`;
  }

  // 今日間違えて、まだ復習が終わっていない問題
  const now = Date.now();
  const weak = everyItem()
    .filter(({ item }) => {
      const r = d.items[item.id];
      return r && r.wrong > 0 && r.due !== null && r.due <= now;
    })
    .slice(0, 8)
    .map(({ item }) => `<li>${escapeHtml(stripBlanks(item.front))}　<span class="sum__muted">${escapeHtml(item.back)}</span></li>`)
    .join('');

  $('summarySheet').innerHTML = `
    <div class="sum">
      <h1 class="sum__title">今日のまとめ</h1>
      <p class="sum__meta">${escapeHtml(d.nick || 'ゲスト')} さん　／　${day.replace(/-/g, '年').replace(/年(\d+)$/, '月$1日')}</p>

      <h2 class="sum__h">教場への出入り</h2>
      ${attend}

      <h2 class="sum__h">今日の学習</h2>
      <div class="sum__grid">
        <div><span class="sum__num">${s.n}</span><span class="sum__label">解いた問題</span></div>
        <div><span class="sum__num">${s.ok}</span><span class="sum__label">正解</span></div>
        <div><span class="sum__num">${s.n ? Math.round((s.ok / s.n) * 100) : 0}%</span><span class="sum__label">正答率</span></div>
      </div>
      <p class="sum__sub">
        スタンプ　<b>${d.attendance.stamps} / ${STAMP_MAX}</b>（${d.attendance.cards + 1}枚目）　／
        連続　<b>${d.streak.current}日</b>　／　これまでに習得　<b>${countMastered(d)}問</b>
      </p>

      <h2 class="sum__h">これから復習する問題</h2>
      ${weak ? `<ol class="sum__list">${weak}</ol>` : '<p class="sum__none">いまのところ、復習が必要な問題はありません。</p>'}

      <p class="sum__foot">この記録は、お子さまの端末の中だけに保存されています。</p>
    </div>`;
}

$('summaryLink').onclick = () => { renderSummary(); show('summary', '今日のまとめ'); };
$('summaryPrint').onclick = () => window.print();

/* ============================================================
   4. 紙のテストを印刷する
   ============================================================ */
function renderPrintForm() {
  const sel = $('printRange');
  sel.innerHTML = '';
  const add = (value, label) => {
    const o = document.createElement('option');
    o.value = value; o.textContent = label;
    sel.appendChild(o);
  };
  add('weak', '苦手な問題');
  add('review', '復習の時期がきた問題');
  allSubjects().forEach((sub) => {
    sub.levels.forEach((lv) => add(`lv:${sub.id}:${lv.id}`, `${sub.name} ${lv.name}`));
  });
}

/** 選ばれた範囲の問題を集める */
function printPool() {
  const v = $('printRange').value;
  if (v === 'weak') {
    return everyItem()
      .filter(({ item }) => { const r = Store.data.items[item.id]; return r && r.wrong > 0; })
      .sort((a, b) => Store.data.items[b.item.id].wrong - Store.data.items[a.item.id].wrong)
      .map((p) => p.item);
  }
  if (v === 'review') return reviewItems().map((p) => p.item);
  const [, subId, lvId] = v.split(':');
  const sub = findSubject(subId);
  if (!sub) return [];
  const lv = sub.levels.find((l) => l.id === lvId);
  return lv ? lv.items.slice() : [];
}

function buildPrint() {
  const pool = printPool();
  if (pool.length < 4) {
    $('printMsg').textContent = 'この範囲には問題が足りません（4問以上必要です）。';
    return;
  }
  const count = Math.min(Number($('printCount').value) || 20, pool.length);
  const style = $('printStyle').value;          // choice = 4択 / write = 記述
  const dir = $('printDir').value;              // front / back
  const withAnswer = $('printAnswer').checked;
  const items = shuffle(pool).slice(0, count);

  const title = $('printTitle').value.trim() || 'テスト';
  const head = `
    <div class="sheet__head">
      <h1>${escapeHtml(title)}</h1>
      <p>名前：<span class="sheet__blank"></span>　　点数：<span class="sheet__blank sheet__blank--s"></span></p>
    </div>`;

  let body = '<ol class="sheet__list">';
  // 4択のとき、正解が選択肢の何番目に並んだかを覚えておきます（解答欄にA〜Dを出すため）
  const marks = [];
  items.forEach((item) => {
    const q = escapeHtml(displayText(qOf(item, dir)));
    // 図を見て答える問題は、図がないと解けないので紙にも刷ります
    const src = imageSrcOf(item);
    const img = src ? `<img class="sheet__img" src="${escapeHtml(src)}" alt="">` : '';
    if (style === 'choice') {
      const choices = makeChoices(item, pool, dir);
      const at = choices.indexOf(aOf(item, dir));
      marks.push(at >= 0 ? 'ABCD'[at] : '');
      body += `<li><p class="sheet__q">${q}</p>${img}<ol class="sheet__choices">` +
        choices.map((c) => `<li>${escapeHtml(displayText(c))}</li>`).join('') + '</ol></li>';
    } else {
      marks.push('');
      body += `<li><p class="sheet__q">${q}</p>${img}<p class="sheet__line"></p></li>`;
    }
  });
  body += '</ol>';

  let answers = '';
  if (withAnswer) {
    answers = '<div class="sheet__answers"><h2>解答</h2><ol>' +
      items.map((item, i) => {
        const mark = marks[i] ? `<b class="sheet__mark">${marks[i]}</b>` : '';
        return `<li>${mark}${escapeHtml(displayText(aOf(item, dir)))}</li>`;
      }).join('') +
      '</ol></div>';
  }

  $('printSheet').innerHTML = head + body + answers;
  $('printMsg').textContent = `${items.length}問のテストを作りました。下の「印刷する」を押してください。`;
  $('printActions').hidden = false;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

$('printBuild').onclick = buildPrint;
$('printGo').onclick = () => window.print();

/* ============================================================
   5. 登録した問題の編集・削除
   ============================================================ */
function renderManage() {
  const box = $('manageList');
  box.innerHTML = '';

  const groups = [];
  if (Store.data.myWords.length) {
    groups.push({ name: '📕 マイ単語帳', items: Store.data.myWords, kind: 'my' });
  }
  Store.data.customSets.forEach((s) => {
    groups.push({ name: '📥 ' + s.name, items: s.items, kind: 'set', set: s });
  });

  $('manageExportCard').hidden = !groups.length;
  if (!groups.length) {
    box.innerHTML = '<p class="note">まだ自分で追加した問題はありません。</p>';
    return;
  }

  groups.forEach((g) => {
    const block = document.createElement('div');
    block.className = 'card';
    const title = document.createElement('div');
    title.className = 'manage-head';
    title.innerHTML = `<h3 class="card__title">${escapeHtml(g.name)}（${g.items.length}問）</h3>`;

    const out = document.createElement('button');
    out.className = 'mini-btn';
    out.textContent = '書き出す';
    out.onclick = () => exportQuestions(g.items, g.name.replace(/^[^\s]+\s*/, ''));
    title.appendChild(out);

    if (g.kind === 'set') {
      const del = document.createElement('button');
      del.className = 'mini-btn mini-btn--danger';
      del.textContent = 'セットごと削除';
      del.onclick = () => {
        if (!confirm(`「${g.set.name}」を削除します。よろしいですか？`)) return;
        Store.data.customSets = Store.data.customSets.filter((s) => s.id !== g.set.id);
        Store.save();
        invalidateSearchIndex();
        renderManage();
        toast('削除しました');
      };
      title.appendChild(del);
    }
    block.appendChild(title);

    g.items.forEach((item) => block.appendChild(manageRow(item, g)));
    box.appendChild(block);
  });
}

function manageRow(item, group) {
  const row = document.createElement('div');
  row.className = 'item-row';
  const body = document.createElement('div');
  body.className = 'item-row__body';
  body.innerHTML = `
    <span class="item-row__front">${escapeHtml(item.front)}</span>
    <span class="item-row__back">${escapeHtml(item.back)}</span>`;
  row.appendChild(body);

  const edit = document.createElement('button');
  edit.className = 'mini-btn';
  edit.textContent = '編集';
  edit.onclick = () => startEdit(item, group);
  row.appendChild(edit);

  const del = document.createElement('button');
  del.className = 'mini-btn mini-btn--danger';
  del.textContent = '削除';
  del.onclick = () => {
    if (!confirm(`「${item.front}」を削除します。よろしいですか？`)) return;
    if (group.kind === 'my') {
      Store.data.myWords = Store.data.myWords.filter((x) => x.id !== item.id);
    } else {
      group.set.items = group.set.items.filter((x) => x.id !== item.id);
      if (!group.set.items.length) {
        Store.data.customSets = Store.data.customSets.filter((s) => s.id !== group.set.id);
      }
    }
    delete Store.data.items[item.id];
    Store.save();
    invalidateSearchIndex();
    renderManage();
    toast('削除しました');
  };
  row.appendChild(del);
  return row;
}

function startEdit(item, group) {
  const front = prompt('問題（単語・用語）', item.front);
  if (front === null) return;
  const back = prompt('答え（意味）', item.back);
  if (back === null) return;
  const exp = prompt('解説（空欄でも可）', item.explanation || '');
  if (exp === null) return;
  const ex = prompt('例文（空欄でも可）', item.example || '');
  if (ex === null) return;

  if (!front.trim() || !back.trim()) { toast('問題と答えは必須です'); return; }
  item.front = front.trim();
  item.back = back.trim();
  item.explanation = exp.trim();
  item.example = ex.trim();
  Store.save();
  invalidateSearchIndex();
  renderManage();
  toast('保存しました');
}

/* ============================================================
   6. 問題データを外部のCSVファイルから読み込む
   ------------------------------------------------------------
   questions/index.json に科目とファイルを書いておくと、
   起動時に読み込んで科目一覧に加えます。
   （数千問を扱うときは、この方式に移していきます）
   ============================================================ */
async function loadExternalQuestions() {
  let index;
  try {
    const res = await fetch('questions/index.json', { cache: 'no-cache' });
    if (!res.ok) return;
    index = await res.json();
  } catch (e) {
    return;   // ファイルが無い場合は何もしない（内蔵データだけで動きます）
  }
  if (!index || !Array.isArray(index.subjects)) return;

  // まずは目次だけを登録します（中身は開いたときに読み込みます）
  index.subjects.forEach((sub) => {
    const levels = (sub.levels || []).map((lv) => ({
      id: lv.id, name: lv.name, items: [],
      file: lv.file, count: lv.count || 0, loaded: false,
    }));
    if (!levels.length) return;

    const existing = SUBJECTS.find((s) => s.id === sub.id);
    if (existing) existing.levels = levels;
    else SUBJECTS.push({
      id: sub.id,
      name: sub.name,
      icon: sub.icon || '📗',
      lang: sub.lang || 'auto',
      speakField: sub.speakField || 'front',
      levels,
    });
  });

  // 一度でも開いたことのある科目は、起動時にそろえておきます
  for (const id of Store.data.loadedSubjects.slice()) {
    await ensureSubjectLoaded(id);
  }
}

/** その科目の問題ファイルを読み込む（読み込み済みなら何もしません） */
async function ensureSubjectLoaded(subId) {
  const sub = SUBJECTS.find((s) => s.id === subId);
  if (!sub) return;

  let changed = false;
  for (const lv of sub.levels) {
    if (lv.loaded || !lv.file) continue;
    try {
      const res = await fetch('questions/' + lv.file, { cache: 'no-cache' });
      if (!res.ok) continue;
      const rows = dropHeader(parseTable(await res.text()));
      lv.items = rows.map((cols, i) => rowToItem(cols, `${sub.id}-${lv.id}`, i));
      lv.loaded = true;
      changed = true;
    } catch (e) { /* 読めないファイルは飛ばす */ }
  }

  if (changed) {
    if (Store.data.loadedSubjects.indexOf(subId) === -1) {
      Store.data.loadedSubjects.push(subId);
      Store.save();
    }
    invalidateSearchIndex();
  }
}

/** まだ読み込んでいない科目 */
function unloadedSubjects() {
  return SUBJECTS.filter((s) => s.levels.some((lv) => lv.file && !lv.loaded));
}

/** すべての科目をそろえる（検索や紙のテストで、範囲をまたぐときに使います） */
async function loadAllSubjects() {
  for (const s of unloadedSubjects()) await ensureSubjectLoaded(s.id);
}

/* ---------- 画面のボタン ---------- */
$('searchLoadAll').onclick = async () => {
  const btn = $('searchLoadAll');
  btn.textContent = '読み込んでいます…';
  await loadAllSubjects();
  btn.hidden = true;
  renderSearch($('searchInput').value);
  toast('すべての科目を読み込みました');
};

$('printLink').onclick = async () => {
  await loadAllSubjects();     // 範囲をまたいで出題するため、全科目をそろえます
  renderPrintForm();
  $('printSheet').innerHTML = '';
  $('printActions').hidden = true;
  $('printMsg').textContent = '';
  show('print', '紙のテストを作る');
};
$('manageLink').onclick = () => { renderManage(); show('manage', '問題の管理'); };

/* ============================================================
   6. 役割の切り替え（第2段階の作りこみ中）
   ------------------------------------------------------------
   サーバーができるまでのあいだ、この端末の中だけで役割を変えて
   画面の見え方を確かめるための画面です。
   本番ではログインしたアカウントで役割が決まります。
   ============================================================ */

/* 画面に出す「できること」の一覧。左が説明、右が js/auth.js の判定名 */
const PERM_ROWS = [
  ['学習する', 'study'],
  ['自分の記録を見る', 'ownRecord'],
  ['問題を作る・直す・配る', 'manageQuestions'],
  ['紙のテストを作る', 'printTest'],
  ['生徒の成績を見る', 'viewGrades'],
  ['生徒の氏名・保護者の連絡先を見る', 'viewPersonal'],
  ['在籍・休塾・退塾を切り替える', 'changeEnrollment'],
  ['先生のアカウントを発行する', 'manageTeachers'],
  ['ほかの教場も見る', 'viewAllVenues'],
  ['保護者へのメールを設定する', 'manageMail'],
];

function renderRole() {
  const me = Auth.me;
  const on = Auth.enforcing;

  $('roleNow').textContent = on
    ? `${Auth.label()}${me.venue ? `（教場：${me.venue}）` : ''}`
    : 'まだ選ばれていません';
  $('roleNowNote').textContent = on
    ? '下の一覧のとおりに画面が出し分けられています。'
    : '第1段階と同じで、すべての機能が見えている状態です。';

  document.querySelectorAll('#screen-role .role-btn').forEach((b) => {
    b.classList.toggle('is-on', on && b.dataset.role === me.role);
  });
  $('roleVenueField').hidden = !(on && me.role === ROLE.TEACHER);
  $('roleVenue').value = me.venue || '';
  $('roleLogout').hidden = !on;

  $('permTable').innerHTML = PERM_ROWS.map(([label, key]) => {
    // 役割を選ぶ前は全部できるので、そのときは「—」を出します
    const mark = !on ? '—' : (Auth.can(key) ? '○' : '×');
    const cls = !on ? '' : (Auth.can(key) ? 'perm--yes' : 'perm--no');
    return `<tr><td>${escapeHtml(label)}</td><td class="${cls}">${mark}</td></tr>`;
  }).join('');
}

/** 役割が変わったときに、画面全体を出し分け直します */
function applyRole() {
  // ホームの入り口
  $('addLink').hidden = !Auth.can('manageQuestions');
  $('manageLink').hidden = !Auth.can('manageQuestions');
  $('printLink').hidden = !Auth.can('printTest');
  // マイページの先生用カード
  renderTeacher();
  renderRole();
}

$('roleLink').onclick = () => { renderRole(); show('role', '役割の切り替え'); };

document.querySelectorAll('#screen-role .role-btn').forEach((btn) => {
  btn.onclick = () => {
    const role = btn.dataset.role;
    Auth.mockLogin(role, { venue: role === ROLE.TEACHER ? ($('roleVenue').value.trim() || 'main') : null });
    applyRole();
    toast(`${Auth.label()}として表示します`);
  };
});

$('roleVenue').onchange = () => {
  if (!Auth.isTeacher()) return;
  Auth.mockLogin(ROLE.TEACHER, { venue: $('roleVenue').value.trim() || 'main' });
  applyRole();
  toast('教場を変えました');
};

$('roleLogout').onclick = () => {
  Auth.logout();
  applyRole();
  toast('役割を解除しました');
};
