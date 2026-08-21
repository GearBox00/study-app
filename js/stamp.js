/* ============================================================
   出席スタンプカード
   ------------------------------------------------------------
   拠点に掲示したQRコードを読み取って、
     ・1日1回「出席した」を記録し、スタンプを1つ押す（全50マス）
     ・入室時と退室時に読み取ることで、その日の勉強時間を記録する
   記録はこの端末の中だけに保存されます（サーバーへは送りません）。
   ============================================================ */

'use strict';

const STAMP_COLS = 5;
const STAMP_ROWS = 10;
const STAMP_MAX = STAMP_ROWS * STAMP_COLS;   // 50マス（5列×10行）
const QR_PREFIX = 'manabi-card:v1:';         // 入退室用のQR
const REWARD_PREFIX = 'manabi-card:r1:';     // ごほうびスタンプ用のQR（別物として扱います）

/* ごほうびスタンプの色。名前と、台紙に出す印をひとまとめにしています */
const STAMP_COLORS = [
  { key: 'red',    name: '赤',       icon: '🔴' },
  { key: 'pink',   name: 'ピンク',   icon: '🌸' },
  { key: 'orange', name: 'オレンジ', icon: '🟠' },
  { key: 'yellow', name: '黄',       icon: '🟡' },
  { key: 'green',  name: '緑',       icon: '🟢' },
  { key: 'blue',   name: '青',       icon: '🔵' },
  { key: 'purple', name: 'むらさき', icon: '🟣' },
];
function colorOf(key) {
  return STAMP_COLORS.find((c) => c.key === key) || STAMP_COLORS[0];
}

/**
 * 台紙に印を1つ足します。
 * 出席スタンプもごほうびスタンプも、同じ台紙に順番に押していきます。
 * 従来の記録は「押した数（stamps）」だけを持っていたため、
 * 数はそのまま使い、内訳を marks に足す形にしています。
 * こうすると、これまでの記録をそのまま読み込めます。
 */
function pushMark(kind, name, color) {
  const a = Store.data.attendance;
  if (!Array.isArray(a.marks)) a.marks = [];

  // 色ごとの通算（2026-08-05 追加）。台紙は1枚たまると内訳が消えるため、
  // 枚数をまたいで数えられるよう、ここで別に足しています。
  // これまでに押した分はさかのぼれないので、この日から先の分を数えます。
  if (kind === 'reward') {
    if (!a.rewardTotals) a.rewardTotals = {};
    const key = color || 'other';
    a.rewardTotals[key] = (a.rewardTotals[key] || 0) + 1;
  }
  // これまでの記録には内訳がないので、すでに押してある分を出席スタンプで埋めます。
  // これをしないと、古い出席スタンプが後ろへずれてしまいます。
  while (a.marks.length < a.stamps) a.marks.push({ kind: 'attend', name: '', color: '' });
  a.marks.push({ kind, name: name || '', color: color || '' });
  a.stamps++;
  if (a.stamps >= STAMP_MAX) {   // 1枚たまったら次の台紙へ
    a.stamps = 0;
    a.marks = [];
    a.cards++;
    return true;
  }
  return false;
}

/* ---------- 記録の読み書き ---------- */
function todayLog() {
  const a = Store.data.attendance;
  if (!a.logs[today()]) a.logs[today()] = { sessions: [], minutes: 0 };
  return a.logs[today()];
}

/**
 * 退室のスキャンを忘れたまま残っている記録を締めます。
 * ・前の日の入りっぱなし
 * ・今日でも12時間以上経っている入りっぱなし
 * 勉強時間は分からないため0分のまま、「退室の記録なし」として残します。
 */
function closeStaleSessions() {
  const a = Store.data.attendance;
  let changed = false;
  Object.keys(a.logs).forEach((d) => {
    (a.logs[d].sessions || []).forEach((s) => {
      if (s.out) return;
      const tooOld = (d !== today()) || (Date.now() - s.in > 12 * 60 * 60 * 1000);
      if (tooOld) { s.out = s.in; s.noExit = true; changed = true; }
    });
  });
  if (changed) Store.save();
}

/** いまの状態： 'none'（未読み取り） / 'in'（入室中） / 'done'（退室済み） */
function stampState() {
  const log = Store.data.attendance.logs[today()];
  if (!log || !log.sessions.length) return 'none';
  const last = log.sessions[log.sessions.length - 1];
  return last.out ? 'done' : 'in';
}

function minutesBetween(a, b) {
  return Math.max(0, Math.round((b - a) / 60000));
}

/**
 * QRを読み取ったときの処理。
 * 戻り値は画面に出すメッセージ。
 */
function handleScan(text) {
  closeStaleSessions();

  // ごほうびスタンプのQR（入退室とは別。回数の制限はありません）
  if (text && text.indexOf(REWARD_PREFIX) === 0) {
    const body = text.slice(REWARD_PREFIX.length);
    const at = body.lastIndexOf('|');
    const name = (at >= 0 ? body.slice(0, at) : body).trim() || 'ごほうび';
    const col = colorOf(at >= 0 ? body.slice(at + 1).trim() : '');
    const done = pushMark('reward', name, col.key);
    const a = Store.data.attendance;
    Store.save();
    if (done) {
      return {
        ok: true, kind: 'reward', complete: true,
        title: 'カード1枚を達成しました！',
        body: `${STAMP_MAX}マスすべてがそろいました。これで${a.cards}枚目です。`,
      };
    }
    return {
      ok: true, kind: 'reward',
      title: `${col.icon} ${name}のスタンプ！`,
      body: `台紙は ${a.stamps} / ${STAMP_MAX} マスになりました。`,
    };
  }

  if (!text || text.indexOf(QR_PREFIX) !== 0) {
    return { ok: false, title: 'このQRコードは使えません', body: '学習拠点に掲示されているQRコードを読み取ってください。' };
  }
  const venue = text.slice(QR_PREFIX.length).trim() || 'main';
  const a = Store.data.attendance;
  const log = todayLog();
  const now = Date.now();
  const state = stampState();

  if (state === 'in') {
    // 退室の記録
    const last = log.sessions[log.sessions.length - 1];
    last.out = now;
    const m = minutesBetween(last.in, now);
    log.minutes += m;
    a.totalMinutes += m;
    Store.save();
    notifyAttendance('out', m);
    return {
      ok: true, kind: 'out',
      title: 'おつかれさま！',
      body: `今日の勉強時間は ${formatMinutes(log.minutes)} でした。`,
    };
  }

  // 入室の記録
  log.sessions.push({ in: now, out: null, venue });
  const first = log.sessions.length === 1;
  let stamped = false;
  if (first) {
    // 出席のスタンプは、これまでどおり1日1つだけです
    a.totalDays++;
    stamped = true;
    pushMark('attend');
  }
  Store.save();
  notifyAttendance('in', null);

  if (stamped && a.stamps === 0) {
    return {
      ok: true, kind: 'in', complete: true,
      title: 'カード1枚を達成しました！',
      body: `${STAMP_MAX}マスすべてに💮がそろいました。これで${a.cards}枚目です。`,
    };
  }
  return {
    ok: true, kind: 'in',
    title: first ? 'スタンプを押しました！' : 'おかえりなさい',
    body: first
      ? `今日の出席を記録しました。今のカードは ${a.stamps} / ${STAMP_MAX} マスです。`
      : '勉強時間の計測を再開しました。',
  };
}

function formatMinutes(m) {
  if (m < 60) return `${m}分`;
  return `${Math.floor(m / 60)}時間${m % 60 ? (m % 60) + '分' : ''}`;
}

/**
 * 入退室をサーバーへ知らせます（2026-08-11 追加）。
 * 保護者へのお知らせメールは、サーバー側が送ります。
 *
 * わざと「待たない」形にしています。
 * メールの送信を待ってから画面を出すと、通信が遅い教場で
 * 生徒がその場で待たされてしまうためです。
 * サーバーへ届かなくても、出席の記録は端末に残っています。
 */
function notifyAttendance(kind, minutes) {
  if (typeof Backend !== 'object' || !Backend.remote) return;
  if (typeof Remote !== 'object' || !Remote.enabled) return;
  Remote.attendance(kind, minutes).catch(() => {
    // 送れなくても、生徒の画面には出しません。生徒には直せないためです
  });
}

/* ============================================================
   画面の描画
   ============================================================ */

/** ホームに出す1行 */
function renderStampSummary() {
  const a = Store.data.attendance;
  const state = stampState();
  const log = Store.data.attendance.logs[today()];
  $('stampCtaCount').textContent = `${a.stamps} / ${STAMP_MAX}`;

  const sub = $('stampCtaSub');
  if (state === 'none') {
    sub.textContent = 'QRを読み取って今日のスタンプをもらおう';
  } else if (state === 'in') {
    sub.textContent = '勉強中です。帰るときにもう一度読み取ってください';
  } else {
    sub.textContent = `今日の勉強時間 ${formatMinutes(log.minutes)}`;
  }
  $('stampCta').classList.toggle('is-active', state === 'in');
}

/**
 * ごほうびスタンプの色ごとの個数（通算）。
 * ご要望により、スタンプカードより先に表示します（2026-08-05 追加）。
 * 1つももらっていないうちは、欄ごと出しません。
 */
function renderRewardTotals() {
  const totals = Store.data.attendance.rewardTotals || {};
  const box = $('rewardTotals');
  const card = $('rewardTotalsCard');
  box.innerHTML = '';

  let sum = 0;
  STAMP_COLORS.forEach((c) => {
    const n = totals[c.key] || 0;
    if (!n) return;                       // もらっていない色は並べません
    sum += n;
    const chip = document.createElement('div');
    chip.className = 'reward-total';
    chip.innerHTML = `<span class="reward-total__icon">${c.icon}</span>`
      + `<span class="reward-total__name">${c.name}</span>`
      + `<b class="reward-total__num">${n}</b>`;
    box.appendChild(chip);
  });

  card.hidden = sum === 0;
}

/** スタンプカードの画面 */
function renderStamp() {
  const a = Store.data.attendance;
  const state = stampState();
  const log = Store.data.attendance.logs[today()];

  renderRewardTotals();

  // 50マス。出席スタンプとごほうびスタンプが同じ台紙に並びます
  const marks = Array.isArray(a.marks) ? a.marks : [];
  const grid = $('stampGrid');
  grid.innerHTML = '';
  for (let i = 0; i < STAMP_MAX; i++) {
    const cell = document.createElement('div');
    const filled = i < a.stamps;
    cell.className = 'stamp-cell' + (filled ? ' is-filled' : '');
    if (filled) {
      // 内訳が無い古い記録は、これまでどおり出席スタンプとして表示します
      const m = marks[i];
      if (m && m.kind === 'reward') {
        const c = colorOf(m.color);
        cell.textContent = c.icon;
        cell.title = m.name ? `${m.name}（${c.name}）` : c.name;
      } else {
        cell.textContent = '💮';
        cell.title = '出席';
      }
    }
    grid.appendChild(cell);
  }

  $('stampCardNo').textContent = a.cards + 1;
  $('stampCount').textContent = `${a.stamps} / ${STAMP_MAX}`;
  $('stampDays').textContent = a.totalDays;
  $('stampTotalTime').textContent = formatMinutes(a.totalMinutes);

  const st = $('stampToday');
  const btn = $('scanBtn');
  if (state === 'none') {
    st.textContent = '今日はまだ読み取っていません';
    st.className = 'stamp-today';
    btn.textContent = '📷 QRを読み取る（入室）';
  } else if (state === 'in') {
    const last = log.sessions[log.sessions.length - 1];
    st.textContent = `勉強中（${new Date(last.in).getHours()}時${String(new Date(last.in).getMinutes()).padStart(2, '0')}分から）`;
    st.className = 'stamp-today is-in';
    btn.textContent = '📷 QRを読み取る（退室）';
  } else {
    st.textContent = `今日の勉強時間 ${formatMinutes(log.minutes)}`;
    st.className = 'stamp-today is-done';
    btn.textContent = '📷 QRを読み取る（もう一度勉強する）';
  }

  renderStampHistory();
}

/** 直近の記録を一覧で */
function renderStampHistory() {
  const logs = Store.data.attendance.logs;
  const keys = Object.keys(logs).sort().reverse().slice(0, 14);
  const box = $('stampHistory');
  box.innerHTML = '';
  if (!keys.length) {
    box.innerHTML = '<p class="note">まだ記録がありません。</p>';
    return;
  }
  keys.forEach((k) => {
    const l = logs[k];
    const row = document.createElement('div');
    row.className = 'item-row';
    const times = l.sessions.map((s) => {
      const f = (t) => `${new Date(t).getHours()}:${String(new Date(t).getMinutes()).padStart(2, '0')}`;
      if (s.noExit) return `${f(s.in)}〜（退室の記録なし）`;
      return s.out ? `${f(s.in)}〜${f(s.out)}` : `${f(s.in)}〜`;
    }).join('、');
    row.innerHTML = `
      <div class="item-row__body">
        <span class="item-row__front">${k.slice(5).replace('-', '月')}日</span>
        <span class="item-row__back">${times}</span>
      </div>
      <span class="stamp-mins">${formatMinutes(l.minutes)}</span>`;
    box.appendChild(row);
  });
}

/* ============================================================
   カメラでQRを読み取る
   ============================================================ */
const Scanner = {
  stream: null,
  raf: null,
  detector: null,

  async start() {
    const video = $('scanVideo');
    const msg = $('scanMsg');
    msg.textContent = 'カメラを準備しています…';
    $('scanArea').hidden = false;
    $('scanResult').hidden = true;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
    } catch (e) {
      $('scanArea').hidden = true;
      showScanResult({
        ok: false,
        title: 'カメラを使えませんでした',
        body: 'ブラウザの設定でカメラの使用を許可してください。うまくいかないときは、下の「手入力で記録する」をお使いください。',
      });
      return;
    }

    video.srcObject = this.stream;
    video.setAttribute('playsinline', '');
    await video.play();
    msg.textContent = 'QRコードを枠の中に入れてください';

    // 端末がQR読み取り機能を持っていればそれを使い、無ければ同梱のライブラリを使う
    if ('BarcodeDetector' in window) {
      try { this.detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { this.detector = null; }
    }
    this.loop();
  },

  loop() {
    const video = $('scanVideo');
    const canvas = $('scanCanvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const tick = async () => {
      if (!this.stream) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        let text = null;
        if (this.detector) {
          try {
            const codes = await this.detector.detect(canvas);
            if (codes.length) text = codes[0].rawValue;
          } catch (e) { /* 読み取れなければ次のコマへ */ }
        } else if (typeof jsQR === 'function') {
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (code) text = code.data;
        }

        if (text) {
          this.stop();
          showScanResult(handleScan(text));
          return;
        }
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  },

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    $('scanArea').hidden = true;
  },
};

function showScanResult(res) {
  const box = $('scanResult');
  box.hidden = false;
  box.className = 'scan-result ' + (res.ok ? 'is-ok' : 'is-ng');
  $('scanTitle').textContent = res.title;
  $('scanBody').textContent = res.body;
  if (res.ok) renderStamp();
}

/* ============================================================
   拠点用のQRコードを作る（掲示・印刷用）
   ============================================================ */
function renderVenue() {
  $('venueInput').value = Store.data.venue || 'main';
  drawVenueQr();
  $('rewardName').value = Store.data.rewardName || '';
  renderRewardColors();
  drawRewardQr();
}

function drawVenueQr() {
  const name = ($('venueInput').value.trim() || 'main');
  Store.data.venue = name;
  Store.save();

  const text = QR_PREFIX + name;
  $('venueText').textContent = text;

  const box = $('venueQr');
  box.innerHTML = '';
  if (typeof qrcode !== 'function') {
    box.textContent = 'QRコードの部品が読み込めませんでした。';
    return;
  }
  const qr = qrcode(0, 'M');       // 型番自動・誤り訂正レベルM
  qr.addData(text);
  qr.make();
  box.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
  const svg = box.querySelector('svg');
  if (svg) { svg.removeAttribute('width'); svg.removeAttribute('height'); svg.style.width = '100%'; }
}

/* ---------- ごほうびスタンプのQRコード ---------- */
function renderRewardColors() {
  const box = $('rewardColors');
  box.innerHTML = '';
  STAMP_COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.dataset.rewardcolor = c.key;
    b.textContent = `${c.icon} ${c.name}`;
    b.onclick = () => { Store.data.rewardColor = c.key; Store.save(); drawRewardQr(); };
    box.appendChild(b);
  });
}

function drawRewardQr() {
  const name = ($('rewardName').value.trim() || 'ごほうび');
  const col = colorOf(Store.data.rewardColor);
  Store.data.rewardName = name;
  Store.save();

  document.querySelectorAll('[data-rewardcolor]').forEach((b) => {
    b.classList.toggle('is-on', b.dataset.rewardcolor === col.key);
  });

  const text = `${REWARD_PREFIX}${name}|${col.key}`;
  $('rewardText').textContent = text;
  $('rewardTitleName').textContent = `${col.icon} ${name}`;
  $('rewardNote').textContent = `読み取ると「${name}」のスタンプ（${col.name}）がもらえます`;

  const box = $('rewardQr');
  box.innerHTML = '';
  if (typeof qrcode !== 'function') {
    box.textContent = 'QRコードの部品が読み込めませんでした。';
    return;
  }
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  box.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
  const svg = box.querySelector('svg');
  if (svg) { svg.removeAttribute('width'); svg.removeAttribute('height'); svg.style.width = '100%'; }
}

/* ============================================================
   画面のボタン
   ============================================================ */
$('stampCta').onclick = () => { renderStamp(); show('stamp', '出席スタンプ'); };
$('scanBtn').onclick = () => Scanner.start();
$('scanCancel').onclick = () => { Scanner.stop(); $('scanMsg').textContent = ''; };

/* カメラが使えないとき用の手入力 */
$('manualBtn').onclick = () => {
  const code = prompt('拠点の合言葉を入力してください（例： main）');
  if (code === null) return;
  showScanResult(handleScan(QR_PREFIX + code.trim()));
};

$('venueLink').onclick = () => { renderVenue(); show('venue', '拠点用QRコード'); };
$('venueInput').oninput = () => drawVenueQr();
$('rewardName').oninput = () => drawRewardQr();
// 印刷は、押したQRだけが紙に出るようにします
$('venuePrint').onclick = () => printSheet('rewardSheet');
$('rewardPrint').onclick = () => printSheet('venueSheet');

function printSheet(hideId) {
  const el = $(hideId);
  const was = el.hidden;
  el.hidden = true;
  window.print();
  setTimeout(() => { el.hidden = was; }, 300);
}
