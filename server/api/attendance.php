<?php
/* ============================================================
   入退室の記録と、保護者へのお知らせ
   ------------------------------------------------------------
   生徒がQRを読み取ったときに呼ばれます。

   ■ 記録が先、メールは後
     メールの送信に失敗しても、入退室の記録は必ず残します。
     順番を逆にすると、メールが送れないときに出席が消えてしまいます。

   ■ 誰の記録かは、送られてきた値では決めません
     ログインしている席から決めます。
   ============================================================ */
declare(strict_types=1);
require __DIR__ . '/../lib.php';
require __DIR__ . '/../mail.php';

$me = require_login();

/* ---------- 自分の入退室の履歴 ---------- */
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    $st = db()->prepare(
        'SELECT id, kind, venue_id, happened_at, minutes, mail_state
           FROM attendance WHERE user_id = ?
          ORDER BY happened_at DESC LIMIT 50');
    $st->execute([$me['id']]);
    ok($st->fetchAll());
}

/* ---------- 入室・退室を記録する ---------- */
require_post();

$in = body();
$kind = (string)($in['kind'] ?? '');
if (!in_array($kind, ['in', 'out'], true)) fail(400, '入室か退室かを指定してください。');

$minutes = null;
if ($kind === 'out' && isset($in['minutes']) && is_numeric($in['minutes'])) {
    // ありえない値を弾きます（1日ぶんを超える滞在は受けつけません）
    $minutes = max(0, min(24 * 60, (int)$in['minutes']));
}

/* 教場は、送られてきた値ではなく、その生徒の所属から決めます */
$st = db()->prepare(
    'SELECT u.id, u.name, u.venue_id, u.parent_email, u.enroll, v.name AS venue_name
       FROM users u LEFT JOIN venues v ON v.id = u.venue_id
      WHERE u.id = ?');
$st->execute([$me['id']]);
$student = $st->fetch();
if (!$student) fail(404, '利用者が見つかりません。');

/* 休塾中はお知らせを送りません。記録だけ残します */
$paused = ($student['enroll'] !== ENROLL_ACTIVE);

/* まず記録します */
$ins = db()->prepare(
    'INSERT INTO attendance (user_id, venue_id, kind, happened_at, minutes)
     VALUES (?, ?, ?, NOW(), ?)');
$ins->execute([$me['id'], $student['venue_id'], $kind, $minutes]);
$attId = (int)db()->lastInsertId();

/* そのあとでお知らせを送ります */
$error = '';
if ($paused) {
    $state = 'skipped';
} else {
    $state = notify_guardian($student, $kind, $minutes, $error);
}

$up = db()->prepare('UPDATE attendance SET mail_state = ?, mail_error = ? WHERE id = ?');
$up->execute([$state, mb_substr($error, 0, 255), $attId]);

audit($me, 'attendance_' . $kind, (string)$me['id'], 'mail=' . $state);

/*
 * メールが送れなくても ok を返します。
 * 生徒の画面に「エラー」と出しても、生徒には直せないためです。
 * 送信の失敗は運営者の画面で分かるようにしてあります。
 */
ok(['id' => $attId, 'kind' => $kind, 'mail' => $state]);
