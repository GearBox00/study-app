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

    /*
     * 並び順（2026-08-12にご要望で選べるようにしました）
     *   recent … 最終学習日が古い順。しばらく来ていない子が上に来ます（既定）
     *   name  … お名前順
     *   id    … 登録した順
     * 先生には氏名が見えないので、名前順は運営者だけにします。
     */
    $order = (string)($_GET['order'] ?? 'recent');
    if ($order === 'name' && can($me, 'viewPersonal')) {
        $orderSql = 'u.kana ASC, u.name ASC, u.id ASC';
    } elseif ($order === 'id') {
        $orderSql = 'u.id ASC';
    } else {
        $orderSql = 'r.last_studied IS NULL DESC, r.last_studied ASC, u.id ASC';
    }

    /* 保守用のアカウントは、教室側の名簿には出しません（2026-08-21） */
    [$devHide, $devArgs] = dev_hidden_clause($me);

    $sql = 'SELECT u.id, u.name, u.kana, u.grade, u.joined_on,
                   u.venue_id, u.enroll, u.app_access, u.parent_email, u.note,
                   r.answered, r.correct, r.last_studied,
                   (SELECT COUNT(*) FROM guardians g WHERE g.user_id = u.id) AS guardian_count
              FROM users u
              LEFT JOIN records r ON r.user_id = u.id
             WHERE ' . implode(' AND ', $where) . $devHide . '
             ORDER BY ' . $orderSql;
    $st = db()->prepare($sql);
    // 除外するIDは、WHERE のいちばん後ろに足しているので、値もそのあとに並べます
    $st->execute(array_merge($args, $devArgs));

    $rows = [];
    foreach ($st->fetchAll() as $s) {
        // 二重の守りとして、取り出したあとにも見てよい相手か確かめます
        if (!can_see_student($me, $s)) continue;
        $rows[] = student_view($me, $s);
    }

    audit($me, 'students_list', '', 'count=' . count($rows));
    ok($rows);
}

/* ---------- 在籍の状態、またはアプリの利用可否を変える ---------- */
require_post();
require_can($me, 'changeEnrollment');

$in = body();
$id = isset($in['id']) ? (int)$in['id'] : 0;

$st = db()->prepare("SELECT id, name, venue_id, enroll, app_access, role
                       FROM users WHERE id = ? AND role = 'student'");
$st->execute([$id]);
$s = $st->fetch();
if (!$s) fail(404, 'その生徒は見つかりませんでした。');
if (!can_see_student($me, $s)) fail(403, 'この生徒は担当ではありません。');

/* ---- アプリの利用可否だけを変える場合（2026-08-12 追加） ---- */
if (array_key_exists('appAccess', $in)) {
    $access = $in['appAccess'] ? 1 : 0;
    $up = db()->prepare('UPDATE users SET app_access = ? WHERE id = ?');
    $up->execute([$access, $id]);
    audit($me, 'app_access', (string)$id, $access ? 'on' : 'off');
    ok(['id' => $id, 'appAccess' => (bool)$access]);
}

/* ---- 在籍の状態を変える（G） ---- */
$enroll = (string)($in['enroll'] ?? '');
if (!in_array($enroll, [ENROLL_ACTIVE, ENROLL_PAUSED, ENROLL_LEFT], true)) {
    fail(400, '知らない状態です。');
}

/*
 * 在籍の状態を変えたら、アプリの利用可否も自動でそろえます。
 * 毎回2か所を触るのは手間なためです。
 * 休塾のときだけは、いまの設定をそのままにします
 * （休塾の定義がお決まりでないため、運営者に個別に決めていただきます）。
 */
$access = (int)$s['app_access'];
if ($enroll === ENROLL_ACTIVE)    $access = 1;
elseif ($enroll === ENROLL_LEFT)  $access = 0;

$up = db()->prepare(
    'UPDATE users SET enroll = ?, app_access = ?, enroll_changed_at = CURDATE() WHERE id = ?');
$up->execute([$enroll, $access, $id]);

audit($me, 'enroll_change', (string)$id,
      $s['enroll'] . ' -> ' . $enroll . ' / access=' . ($access ? 'on' : 'off'));
ok(['id' => $id, 'enroll' => $enroll, 'appAccess' => (bool)$access]);
