<?php
/* ============================================================
   保護者の連絡先（運営者だけ）
   ------------------------------------------------------------
   2026-08-12 作成。1人の生徒に、お父様・お母様・お祖母様など
   何人でも登録できます。

   ■ 入退室のお知らせを受け取るかは、1人ずつ選べます
     お祖母様には日々の入退室ではなく、大事なご連絡だけ、
     という使い分けができるようにするためです。

   ■ 先生は触れません
     保護者の連絡先は個人情報ですので、
     氏名と同じく先生には見せない扱いにしています（ご指定C）。
   ============================================================ */
declare(strict_types=1);
require __DIR__ . '/../lib.php';

$me = require_login();
require_can($me, 'viewPersonal');   // 運営者だけ

/** その生徒を扱ってよいかを確かめ、生徒の行を返します */
function must_student(array $me, int $id): array
{
    $st = db()->prepare("SELECT id, name, venue_id FROM users WHERE id = ? AND role = 'student'");
    $st->execute([$id]);
    $s = $st->fetch();
    if (!$s) fail(404, 'その生徒は見つかりませんでした。');
    if (!can_see_student($me, $s)) fail(403, 'この生徒は担当ではありません。');
    return $s;
}

function check_email(string $email): string
{
    $email = trim($email);
    if ($email === '') fail(400, 'メールアドレスを入れてください。');
    // 改行が入っていると、別の宛先を紛れこませられるため必ず弾きます
    if (preg_match('/[\r\n]/', $email) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        fail(400, 'メールアドレスの形が正しくありません。');
    }
    if (mb_strlen($email) > 255) fail(400, 'メールアドレスが長すぎます。');
    return $email;
}

/* ---------- 一覧 ---------- */
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    $id = (int)($_GET['id'] ?? 0);
    $s = must_student($me, $id);

    $st = db()->prepare(
        'SELECT id, name, relation, email, notify_attendance
           FROM guardians WHERE user_id = ? ORDER BY id');
    $st->execute([$id]);

    $rows = [];
    foreach ($st->fetchAll() as $g) {
        $rows[] = [
            'id'       => (int)$g['id'],
            'name'     => $g['name'],
            'relation' => $g['relation'],
            'email'    => $g['email'],
            'notifyAttendance' => (int)$g['notify_attendance'] === 1,
        ];
    }
    ok(['student' => ['id' => (int)$s['id'], 'name' => $s['name']], 'guardians' => $rows]);
}

require_post();
$in = body();
$do = (string)($in['do'] ?? 'add');

/* ---------- 追加 ---------- */
if ($do === 'add') {
    $userId = (int)($in['userId'] ?? 0);
    must_student($me, $userId);

    $email = check_email((string)($in['email'] ?? ''));
    $name = mb_substr(trim((string)($in['name'] ?? '')), 0, 100);
    $relation = mb_substr(trim((string)($in['relation'] ?? '')), 0, 32);
    $notify = !empty($in['notifyAttendance']) ? 1 : 0;

    /* 同じ生徒に同じアドレスを二重に登録しないようにします */
    $st = db()->prepare('SELECT id FROM guardians WHERE user_id = ? AND email = ?');
    $st->execute([$userId, $email]);
    if ($st->fetch()) fail(409, 'そのメールアドレスは、すでに登録されています。');

    $ins = db()->prepare(
        'INSERT INTO guardians (user_id, name, relation, email, notify_attendance)
         VALUES (?, ?, ?, ?, ?)');
    $ins->execute([$userId, $name, $relation, $email, $notify]);
    $newId = (int)db()->lastInsertId();

    sync_primary_email($userId);
    audit($me, 'guardian_add', (string)$userId, $relation);
    ok(['id' => $newId]);
}

/* ---------- 直す ---------- */
if ($do === 'update') {
    $gid = (int)($in['id'] ?? 0);
    $st = db()->prepare('SELECT id, user_id FROM guardians WHERE id = ?');
    $st->execute([$gid]);
    $g = $st->fetch();
    if (!$g) fail(404, 'その連絡先は見つかりませんでした。');
    must_student($me, (int)$g['user_id']);

    $sets = [];
    $args = [];
    if (array_key_exists('email', $in)) {
        $sets[] = 'email = ?';
        $args[] = check_email((string)$in['email']);
    }
    if (array_key_exists('name', $in)) {
        $sets[] = 'name = ?';
        $args[] = mb_substr(trim((string)$in['name']), 0, 100);
    }
    if (array_key_exists('relation', $in)) {
        $sets[] = 'relation = ?';
        $args[] = mb_substr(trim((string)$in['relation']), 0, 32);
    }
    if (array_key_exists('notifyAttendance', $in)) {
        $sets[] = 'notify_attendance = ?';
        $args[] = $in['notifyAttendance'] ? 1 : 0;
    }
    if (!$sets) fail(400, '変える項目がありません。');

    $args[] = $gid;
    $up = db()->prepare('UPDATE guardians SET ' . implode(', ', $sets) . ' WHERE id = ?');
    $up->execute($args);

    sync_primary_email((int)$g['user_id']);
    audit($me, 'guardian_update', (string)$g['user_id'], implode(',', array_keys($in)));
    ok(['id' => $gid]);
}

/* ---------- 消す ---------- */
if ($do === 'delete') {
    $gid = (int)($in['id'] ?? 0);
    $st = db()->prepare('SELECT id, user_id, email FROM guardians WHERE id = ?');
    $st->execute([$gid]);
    $g = $st->fetch();
    if (!$g) fail(404, 'その連絡先は見つかりませんでした。');
    must_student($me, (int)$g['user_id']);

    $del = db()->prepare('DELETE FROM guardians WHERE id = ?');
    $del->execute([$gid]);

    sync_primary_email((int)$g['user_id']);
    audit($me, 'guardian_delete', (string)$g['user_id'], $g['email']);
    ok(true);
}

fail(400, '知らない操作です。');

/**
 * users.parent_email を、いちばん先に登録された連絡先にそろえます。
 * 名簿の一覧では代表の1件だけを出しているためです。
 * 1人も登録がなければ空にします。
 */
function sync_primary_email(int $userId): void
{
    $st = db()->prepare('SELECT email FROM guardians WHERE user_id = ? ORDER BY id LIMIT 1');
    $st->execute([$userId]);
    $first = $st->fetchColumn();
    $up = db()->prepare('UPDATE users SET parent_email = ? WHERE id = ?');
    $up->execute([$first !== false ? $first : '', $userId]);
}
