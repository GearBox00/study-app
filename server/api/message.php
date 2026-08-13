<?php
/* ============================================================
   保護者へのご連絡（運営者だけ）
   ------------------------------------------------------------
   2026-08-12 作成。個別にも、しぼりこんで一斉にも送れます。

   ■ 送る前に必ず「下見」ができます
     一斉送信は取り消せません。誰に届くのかを先に見て、
     人数を確かめてから送っていただく形にしています。

   ■ 宛先はひとりずつ送ります
     まとめて送ると、ほかの保護者のアドレスが見えてしまうためです。
   ============================================================ */
declare(strict_types=1);
require __DIR__ . '/../lib.php';
require __DIR__ . '/../mail.php';

$me = require_login();
require_can($me, 'manageMail');   // 運営者だけ

/**
 * 送り先を集めます。
 * 入退室のお知らせとは別で、ここでは登録されている全員が対象です
 *（「ご連絡だけ受け取る」方にも届きます）。
 */
function collect_targets(array $in): array
{
    $where = ["u.role = 'student'"];
    $args  = [];

    /* 個別送信：生徒を名指しで指定 */
    $ids = [];
    if (isset($in['studentIds']) && is_array($in['studentIds'])) {
        foreach ($in['studentIds'] as $x) {
            $n = (int)$x;
            if ($n > 0) $ids[] = $n;
        }
    }
    if ($ids) {
        $where[] = 'u.id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')';
        foreach ($ids as $n) $args[] = $n;
    } else {
        /* 一斉送信：教場と在籍の状態でしぼります */
        $venue = trim((string)($in['venue'] ?? ''));
        if ($venue !== '') {
            $where[] = 'u.venue_id = ?';
            $args[] = $venue;
        }
        $enroll = (string)($in['enroll'] ?? 'active');
        if (in_array($enroll, [ENROLL_ACTIVE, ENROLL_PAUSED, ENROLL_LEFT], true)) {
            $where[] = 'u.enroll = ?';
            $args[] = $enroll;
        }
        // 'all' のときは在籍でしぼりません
    }

    $sql = 'SELECT u.id AS user_id, u.name AS student_name, u.venue_id,
                   g.id AS guardian_id, g.name AS guardian_name, g.relation, g.email
              FROM users u
              JOIN guardians g ON g.user_id = u.id
             WHERE ' . implode(' AND ', $where) . '
             ORDER BY u.id, g.id';
    $st = db()->prepare($sql);
    $st->execute($args);
    return $st->fetchAll();
}

/* ---------- 送った控えの一覧 ---------- */
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    $st = db()->query(
        'SELECT m.id, m.subject, m.scope, m.sent_count, m.fail_count, m.created_at,
                u.name AS sender_name
           FROM messages m LEFT JOIN users u ON u.id = m.sender_id
          ORDER BY m.id DESC LIMIT 30');
    ok($st->fetchAll());
}

require_post();
$in = body();
$do = (string)($in['do'] ?? 'preview');

/* ---------- 下見（誰に届くか） ---------- */
if ($do === 'preview') {
    $rows = collect_targets($in);
    $list = [];
    $students = [];
    foreach ($rows as $r) {
        $students[$r['user_id']] = true;
        $list[] = [
            'studentId'   => (int)$r['user_id'],
            'studentName' => $r['student_name'],
            'venue'       => $r['venue_id'],
            'relation'    => $r['relation'],
            'email'       => $r['email'],
        ];
    }
    ok(['recipients' => $list,
        'mailCount' => count($list),
        'studentCount' => count($students)]);
}

/* ---------- 送る ---------- */
if ($do !== 'send') fail(400, '知らない操作です。');

if (mail_setting('mail_enabled') !== '1') {
    fail(400, 'メールの送信が「切」になっています。設定画面で入にしてください。');
}

$subject = trim((string)($in['subject'] ?? ''));
$bodyText = (string)($in['body'] ?? '');
if ($subject === '') fail(400, '件名を入れてください。');
if (trim($bodyText) === '') fail(400, '本文を入れてください。');
if (mb_strlen($subject) > 120) fail(400, '件名が長すぎます（120文字まで）。');
if (mb_strlen($bodyText) > 4000) fail(400, '本文が長すぎます（4000文字まで）。');

$rows = collect_targets($in);
if (!$rows) fail(400, '送り先が1件もありません。しぼりこみをご確認ください。');

/*
 * 送りすぎを防ぎます。
 * Xサーバーの上限は1時間1,500通ですので、
 * 1回の操作ではそれより十分に少ない数で止めます。
 */
if (count($rows) > 500) {
    fail(400, '一度に送れるのは500通までです。教場などでしぼってお送りください。');
}

$sent = 0;
$fail = 0;
$errors = [];
foreach ($rows as $r) {
    /* お子さんのお名前を差しこめるようにします */
    $vars = ['name' => $r['student_name'], 'venue' => $r['venue_id'] ?? ''];
    $e = '';
    if (send_mail($r['email'], fill_template($subject, $vars),
                  fill_template($bodyText, $vars), $e)) {
        $sent++;
    } else {
        $fail++;
        if (count($errors) < 5) $errors[] = ['email' => $r['email'], 'error' => $e];
    }
}

/* 送った控えを残します。あとから「何を送ったか」を確かめられるようにするためです */
$scope = !empty($in['studentIds'])
    ? '個別 ' . count($in['studentIds']) . '名'
    : '一斉 教場=' . (($in['venue'] ?? '') ?: 'すべて') . ' 状態=' . ($in['enroll'] ?? 'active');
$ins = db()->prepare(
    'INSERT INTO messages (sender_id, subject, bodytext, scope, sent_count, fail_count)
     VALUES (?, ?, ?, ?, ?, ?)');
$ins->execute([$me['id'], $subject, $bodyText, $scope, $sent, $fail]);

audit($me, 'message_send', '', "sent={$sent} fail={$fail} {$scope}");
ok(['sent' => $sent, 'failed' => $fail, 'errors' => $errors]);
