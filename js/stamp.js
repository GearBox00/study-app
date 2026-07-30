/* ============================================================
   出席スタンプカード
   ------------------------------------------------------------
   拠点に掲示したQRコードを読み取って、
     ・1日1回「出席した」を記録し、スタンプを1つ押す（全25マス）
     ・入室時と退室時に読み取ることで、その日の勉強時間を記録する
   記録はこの端末の中だけに保存されます（サーバーへは送りません）。
   ============================================================ */

'use strict';

const STAMP_ROWS = 5;
const STAMP_COLS = 5;
const STAMP_MAX = STAMP_ROWS * STAMP_COLS;   // 25マス
const QR_PREFIX = 'manabi-card:v1:';         // このアプリのQRだと判別するための印

/* ---------- 記録の読み書き ---------- */
function todayLog() {
  const a = Store.data.attendance;
  if (!a.logs[today()]) a.logs[today()] = { sessions: [], minutes: 0 };
  return a.logs[today()];
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
    // スタンプは1日1つだけ
    a.stamps++;
    a.totalDays++;
    stamped = true;
    if (a.stamps >= STAMP_MAX) {
      a.stamps = 0;
      a.cards++;
    }
  }
  Store.save();

  if (stamped && a.stamps === 0) {
    return {
      ok: true, kind: 'in', complete: true,
      title: 'カード1枚を達成しました！',
      body: `25マスすべてに💮がそろいました。これで${a.cards}枚目です。`,
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

/** スタンプカードの画面 */
function renderStamp() {
  const a = Store.data.attendance;
  const state = stampState();
  const log = Store.data.attendance.logs[today()];

  // 25マス
  const grid = $('stampGrid');
  grid.innerHTML = '';
  for (let i = 0; i < STAMP_MAX; i++) {
    const cell = document.createElement('div');
    const filled = i < a.stamps;
    cell.className = 'stamp-cell' + (filled ? ' is-filled' : '');
    cell.textContent = filled ? '💮' : '';
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
$('venuePrint').onclick = () => window.print();
