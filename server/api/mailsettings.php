<?php
/* ============================================================
   保護者メールの設定（運営者だけ）
   ------------------------------------------------------------
   送る／送らない、差出人、件名と本文のひな形を変えられます。
   送信の失敗した件数もここで分かるようにしています。
   ============================================================ */
declare(strict_types=1);
require __DIR__ . '/../lib.php';
require __DIR__ . '/../mail.php';

$me = require_login();
require_can($me, 'manageMail');

/* 画面から変えられる項目。ここに無い名前は受けつけません */
const EDITABLE = [
    'mail_enabled', 'mail_from', 'mail_from_name',
    'mail_subject_in', 'mail_subject_out',
    'mail_body_in', 'mail_body_out',
];

/* ---------- いまの設定を見る ---------- */
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    $out = [];
    foreach (EDITABLE as $k) $out[$k] = mail_setting($k);

    /* 直近の送信のようす。うまくいっているか分かるようにします */
    $st = db()->query(
        "SELECT mail_state, COUNT(*) AS n FROM attendance
          WHERE happened_at > (NOW() - INTERVAL 30 DAY)
          GROUP BY mail_state");
    $stat = ['sent' => 0, 'failed' => 0, 'skipped' => 0, 'none' => 0];
    foreach ($st->fetchAll() as $r) $stat[$r['mail_state']] = (int)$r['n'];

    $st2 = db()->query(
        "SELECT a.happened_at, a.kind, a.mail_error
           FROM attendance a
          WHERE a.mail_state = 'failed'
          ORDER BY a.happened_at DESC LIMIT 5");

    ok(['settings' => $out, 'stats30d' => $stat, 'recentErrors' => $st2->fetchAll()]);
}

/* ---------- 設定を変える ---------- */
require_post();
$in = body();

/* 送信を入にするなら、差出人が要ります */
$next = [];
foreach (EDITABLE as $k) {
    if (array_key_exists($k, $in)) $next[$k] = (string)$in[$k];
}

$enabled = $next['mail_enabled'] ?? mail_setting('mail_enabled');
$from    = $next['mail_from']    ?? mail_setting('mail_from');
if ($enabled === '1' && !valid_email($from)) {
    fail(400, '送信を入にするには、差出人のメールアドレスが必要です。');
}

/*
 * 本文と件名の長さに上限を置きます。
 * 上限が無いと、誤って巨大な文面を保存されたときに
 * 送信そのものが失敗し続けます。
 */
foreach (['mail_subject_in', 'mail_subject_out'] as $k) {
    if (isset($next[$k]) && mb_strlen($next[$k]) > 120) fail(400, '件名が長すぎます（120文字まで）。');
}
foreach (['mail_body_in', 'mail_body_out'] as $k) {
    if (isset($next[$k]) && mb_strlen($next[$k]) > 2000) fail(400, '本文が長すぎます（2000文字まで）。');
}

foreach ($next as $k => $v) set_setting($k, $v);
audit($me, 'mail_settings', '', implode(',', array_keys($next)));

$out = [];
foreach (EDITABLE as $k) $out[$k] = mail_setting($k);
ok($out);
