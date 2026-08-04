/* ============================================================
   漢字の書き順
   ------------------------------------------------------------
   知りたい漢字を入れると、書き順をなぞって見せます。
   書き順のデータは KanjiVG（Ulrich Apel 氏／CC BY-SA 3.0）です。

   ・必要な漢字だけを、そのつど読み込みます（起動を重くしないため）
   ・一度読み込んだ漢字は端末に残るので、次からは通信なしで出せます
   ・「まとめて取り込む」を押すと、常用漢字2136字を先に入れておけます
   ============================================================ */

'use strict';

const STROKE_DIR = './kanji/';
const STROKE_MS = 700;        // 1画あたりの時間（ミリ秒）

const stroke = { paths: [], timer: null, at: 0, char: '' };

/** その漢字のファイル名（Unicodeの番号を16進数5桁にしたもの） */
function strokeFileOf(ch) {
  return STROKE_DIR + ch.codePointAt(0).toString(16).padStart(5, '0') + '.svg';
}

function strokeStop() {
  clearTimeout(stroke.timer);
  stroke.timer = null;
}

/** 線を「まだ書いていない」状態にする */
function strokeReset() {
  stroke.paths.forEach((p) => {
    const len = p.getTotalLength();
    p.style.transition = 'none';
    p.style.strokeDasharray = `${len} ${len}`;
    p.style.strokeDashoffset = String(len);
  });
  stroke.at = 0;
}

/** 1画だけ書く */
function strokeDraw(i, ms) {
  const p = stroke.paths[i];
  if (!p) return;
  const len = p.getTotalLength();
  p.style.transition = `stroke-dashoffset ${ms}ms linear`;
  p.style.strokeDashoffset = '0';
}

/** 最初から順に書いていく */
function strokePlay() {
  strokeStop();
  strokeReset();
  const step = () => {
    if (stroke.at >= stroke.paths.length) return;
    strokeDraw(stroke.at, STROKE_MS);
    stroke.at++;
    updateStrokeCount();
    stroke.timer = setTimeout(step, STROKE_MS + 120);
  };
  // 元に戻したことを画面に反映させてから始めます
  stroke.timer = setTimeout(step, 60);
}

/** 「1画ずつ」ボタン */
function strokeNext() {
  strokeStop();
  if (stroke.at >= stroke.paths.length) { strokeReset(); updateStrokeCount(); return; }
  strokeDraw(stroke.at, 300);
  stroke.at++;
  updateStrokeCount();
}

/** 「全部を表示」ボタン */
function strokeShowAll() {
  strokeStop();
  stroke.paths.forEach((p, i) => strokeDraw(i, 0));
  stroke.at = stroke.paths.length;
  updateStrokeCount();
}

function updateStrokeCount() {
  const n = stroke.paths.length;
  $('strokeCount').textContent = n ? `${stroke.char}　全${n}画（いま ${Math.min(stroke.at, n)} 画目）` : '';
}

/** 漢字を1文字読み込んで表示する */
async function showStroke(ch) {
  strokeStop();
  stroke.char = ch;
  const msg = $('strokeMsg');
  try {
    const res = await fetch(strokeFileOf(ch));
    if (!res.ok) throw new Error('not found');
    const svgText = await res.text();
    const box = $('strokeSvg');
    box.innerHTML = svgText;
    const svg = box.querySelector('svg');
    if (!svg) throw new Error('broken');
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    stroke.paths = [...svg.querySelectorAll('path')];
    $('strokeBox').hidden = false;
    msg.textContent = `「${ch}」の書き順です。`;
    strokePlay();
  } catch (e) {
    $('strokeBox').hidden = true;
    stroke.paths = [];
    msg.textContent = `「${ch}」の書き順は入っていません。常用漢字2136字が対象です。`
      + '（通信を切っている場合は、先に「まとめて取り込む」をお試しください）';
  }
}

/* 入力されたら、最初の漢字を1文字だけ見ます */
$('strokeInput').oninput = () => {
  const v = $('strokeInput').value;
  const hit = [...v].find((c) => /[一-鿿]/.test(c));
  if (!hit) {
    $('strokeBox').hidden = true;
    $('strokeMsg').textContent = '常用漢字2136字に対応しています。';
    return;
  }
  showStroke(hit);
};

$('strokePlay').onclick = () => strokePlay();
$('strokeStep').onclick = () => strokeNext();
$('strokeAll').onclick = () => strokeShowAll();

/* まとめて取り込む（教場でオフラインにする前に使います） */
$('strokePrefetch').onclick = async () => {
  const btn = $('strokePrefetch');
  const out = $('strokePrefetchMsg');
  btn.disabled = true;
  out.textContent = '一覧を読み込んでいます…';
  try {
    const res = await fetch(STROKE_DIR + 'list.json');
    const list = [...(await res.json()).kanji];
    let done = 0, ng = 0;
    // 端末や回線に負担をかけないよう、少しずつ取り込みます
    const CHUNK = 24;
    for (let i = 0; i < list.length; i += CHUNK) {
      await Promise.all(list.slice(i, i + CHUNK).map((ch) =>
        fetch(strokeFileOf(ch)).then((r) => { if (!r.ok) ng++; }).catch(() => { ng++; })));
      done = Math.min(i + CHUNK, list.length);
      out.textContent = `取り込み中… ${done} / ${list.length} 字`;
    }
    out.textContent = ng
      ? `${done - ng} 字を取り込みました（${ng} 字は取り込めませんでした）。`
      : `${done} 字すべてを取り込みました。通信がなくても書き順を見られます。`;
  } catch (e) {
    out.textContent = '取り込めませんでした。通信の状態をお確かめください。';
  }
  btn.disabled = false;
};

$('strokeLink').onclick = () => {
  show('stroke', '漢字の書き順');
  $('strokeInput').focus();
};
