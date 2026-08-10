<?php
/* ============================================================
   生徒の名簿
   ------------------------------------------------------------
   js/roster.js の list() と setEnroll() が呼びます。

   ■ 画面側と同じ判定を、ここでも必ず行います
     ・先生は自分の教場の生徒だけ（B）… SQL の段階で絞ります
     ・先生には氏名と連絡先を渡さない（C）… student_view() で落とします
     ・在籍の切り替えは運営者だけ（G）… require_can で断ります
   ============================================================ */
declare(strict_types=1);
require __DIR__ . '/../lib.php';

$me = require_login();

/* ---------- 一覧 ---------- */
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    require_can($me, 'viewGrades');

    $where = ["u.role = 'student'"];
    $args  = [];

    /*
     * B：先生は自分の教場だけ。
     * 画面から教場を送られても、それは無視して、
     * ログインしている先生の教場で固定します。
     * 送られてきた値を信じると、書きかえて他の教場を覗けてしまうためです。
     */
    if (!can($me, 'viewAllVenues')) {
        if ($me['venue_id'] === null) ok([]);      // 教場が無い先生には誰も見えません
        $where[] = 'u.venue_id = ?';
        $args[]  = $me['venue_id'];
    } elseif (!empty($_GET['venue'])) {
        $where[] = 'u.venue_id = ?';
        $args[]  = (string)$_GET['venue'];
    }

    // G：在籍の状態でしぼる
    $enroll = (string)($_GET['enroll'] ?? 'all');
    if (in_array($enroll, [ENROLL_ACTIVE, ENROLL_PAUSED, ENROLL_LEFT], true)) {
        $where[] = 'u.enroll = ?';
        $args[]  = $enroll;
    }

    $sql = 'SELECT u.id, u.name, u.kana, u.venue_id, u.enroll, u.parent_email, u.note,
                   r.answered, r.correct, r.last_studied
              FROM users u
              LEFT JOIN records r ON r.user_id = u.id
             WHERE ' . implode(' AND ', $where) . '
             ORDER BY r.last_studied IS NULL DESC, r.last_studied ASC, u.id ASC';
    $st = db()->prepare($sql);
    $st->execute($args);

    $rows = [];
    foreach ($st->fetchAll() as $s) {
        // 二重の守りとして、取り出したあとにも見てよい相手か確かめます
        if (!can_see_student($me, $s)) continue;
        $rows[] = student_view($me, $s);
    }

    audit($me, 'students_list', '', 'count=' . count($rows));
    ok($rows);
}

/* ---------- 在籍の状態を変える（G） ---------- */
require_post();
require_can($me, 'changeEnrollment');

$in = body();
$id = isset($in['id']) ? (int)$in['id'] : 0;
$enroll = (string)($in['enroll'] ?? '');

if (!in_array($enroll, [ENROLL_ACTIVE, ENROLL_PAUSED, ENROLL_LEFT], true)) {
    fail(400, '知らない状態です。');
}

$st = db()->prepare("SELECT id, name, venue_id, enroll, role FROM users WHERE id = ? AND role = 'student'");
$st->execute([$id]);
$s = $st->fetch();
if (!$s) fail(404, 'その生徒は見つかりませんでした。');
if (!can_see_student($me, $s)) fail(403, 'この生徒は担当ではありません。');

$up = db()->prepare('UPDATE users SET enroll = ?, enroll_changed_at = CURDATE() WHERE id = ?');
$up->execute([$enroll, $id]);

audit($me, 'enroll_change', (string)$id, $s['enroll'] . ' -> ' . $enroll);
ok(['id' => $id, 'enroll' => $enroll]);
