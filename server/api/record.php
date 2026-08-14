<?php
/* ============================================================
   学習の記録の受け渡し
   ------------------------------------------------------------
   js/storage.js の pull() と push() が呼びます。

   ■ 自分の記録しか読み書きできません
     ほかの人のIDを送りつけられても受けつけません。
     どの記録を扱うかは、送られてきた値ではなく
     ログインしている席から決めます。
   ============================================================ */
declare(strict_types=1);
require __DIR__ . '/../lib.php';

$me = require_login();

/* ---------- 取り出す ---------- */
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    $st = db()->prepare('SELECT payload, rev FROM records WHERE user_id = ?');
    $st->execute([$me['id']]);
    $row = $st->fetch();
    // まだ無いときは中身を null で返します。アプリは端末の記録で始めます
    if (!$row) ok(['data' => null, 'rev' => 0]);

    $data = json_decode($row['payload'], true);
    ok(['data' => is_array($data) ? $data : null, 'rev' => (int)$row['rev']]);
}

/* ---------- 預ける ---------- */
require_post();
require_can($me, 'ownRecord');

$in = body();
$data = $in['data'] ?? null;
if (!is_array($data)) fail(400, '記録の形が正しくありません。');

$json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($json === false) fail(400, '記録を保存できる形に変換できませんでした。');

/*
 * 大きすぎる記録は受けつけません。
 * 上限を決めておかないと、1人で保存領域を使い切られてしまいます。
 * 4MBあれば、問題データを含む記録でも十分に収まります。
 */
if (strlen($json) > 4 * 1024 * 1024) {
    fail(413, '記録が大きすぎます。教室へお問い合わせください。');
}

/* 一覧に出す集計値だけ、取り出しやすいように別の列にも入れます */
$answered = 0;
$correct = 0;
$lastStudied = null;
if (isset($data['answered']) && is_numeric($data['answered'])) {
    $answered = max(0, (int)$data['answered']);
}
if (isset($data['items']) && is_array($data['items'])) {
    foreach ($data['items'] as $rec) {
        if (!is_array($rec)) continue;
        $count = isset($rec['count']) ? (int)$rec['count'] : 0;
        $wrong = isset($rec['wrong']) ? (int)$rec['wrong'] : 0;
        $correct += max(0, $count - $wrong);
    }
}
if (isset($data['daily']) && is_array($data['daily']) && $data['daily']) {
    $days = array_keys($data['daily']);
    sort($days);
    $last = (string)end($days);
    // 日付として読める形のときだけ入れます
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $last)) $lastStudied = $last;
}

/* ============================================================
   版番号の確認
   ------------------------------------------------------------
   アプリは「前に受け取った版番号」を一緒に送ってきます。
   その間にサーバー側が別の端末から書き換わっていたら、
   ここでは保存せず、409 と一緒にサーバーの記録を返します。
   アプリ側（js/merge.js）が両方を突き合わせて送り直します。

   取り出しから書き込みまでを1つのまとまりにしているのは、
   ちょうど同じ瞬間に2台から届いたときに、
   確認をすり抜けて両方が書き込んでしまわないようにするためです。
   ============================================================ */
$rev = isset($in['rev']) && is_numeric($in['rev']) ? (int)$in['rev'] : null;

$pdo = db();
$pdo->beginTransaction();

$st = $pdo->prepare('SELECT payload, rev FROM records WHERE user_id = ? FOR UPDATE');
$st->execute([$me['id']]);
$cur = $st->fetch();
$curRev = $cur ? (int)$cur['rev'] : 0;

/*
 * 版番号を送ってこない古いアプリからの保存は、これまでどおり通します。
 * 途中で動かなくなるほうが困るためです。
 */
if ($rev !== null && $rev !== $curRev) {
    $pdo->rollBack();
    $theirs = $cur ? json_decode($cur['payload'], true) : null;
    fail_with(409, 'ほかの端末で先に保存されています。', [
        'data' => is_array($theirs) ? $theirs : null,
        'rev'  => $curRev,
    ]);
}

$newRev = $curRev + 1;
$st = $pdo->prepare(
    'INSERT INTO records (user_id, payload, answered, correct, last_studied, rev)
          VALUES (:uid, :payload, :answered, :correct, :last, :rev)
     ON DUPLICATE KEY UPDATE
          payload = VALUES(payload),
          answered = VALUES(answered),
          correct = VALUES(correct),
          last_studied = VALUES(last_studied),
          rev = VALUES(rev)');
$st->execute([
    ':uid'      => $me['id'],
    ':payload'  => $json,
    ':answered' => $answered,
    ':correct'  => $correct,
    ':last'     => $lastStudied,
    ':rev'      => $newRev,
]);
$pdo->commit();

ok(['answered' => $answered, 'correct' => $correct,
    'lastStudied' => $lastStudied, 'rev' => $newRev]);
