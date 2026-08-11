<?php
/* ============================================================
   アカウントの発行（運営者だけ）
   ------------------------------------------------------------
   2026-08-11 作成。D のご指定「先生アカウントの発行は運営者のみ」。
   生徒のアカウントも同じ仕組みなので、ここでまとめて扱います。

   ■ パスワードは一度しか見られません
     作った直後に一度だけお返しし、こちらでは password_hash() の
     結果しか持ちません。忘れた場合は作り直します。
     「あとから見る」ができないのは不便ですが、
     預かったパスワードが漏れる余地を残さないためです。

   ■ 運営者は増やせません（F）
     佐藤様おひとりというご指定なので、
     この画面から作れるのは「先生」と「生徒」だけです。
   ============================================================ */
declare(strict_types=1);
require __DIR__ . '/../lib.php';

$me = require_login();
require_can($me, 'manageTeachers');

/* ---------- 一覧 ---------- */
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    $st = db()->query(
        "SELECT u.id, u.login_id, u.role, u.name, u.venue_id, u.enroll,
                u.parent_email, u.created_at, v.name AS venue_name
           FROM users u LEFT JOIN venues v ON v.id = u.venue_id
          ORDER BY FIELD(u.role,'admin','teacher','student'), u.id");
    $rows = [];
    foreach ($st->fetchAll() as $u) {
        $rows[] = [
            'id'        => (int)$u['id'],
            'loginId'   => $u['login_id'],
            'role'      => $u['role'],
            'name'      => $u['name'],
            'venue'     => $u['venue_id'],
            'venueName' => $u['venue_name'],
            'enroll'    => $u['enroll'],
            'parentEmail' => $u['parent_email'],
            'createdAt' => $u['created_at'],
        ];
    }
    $vs = db()->query('SELECT id, name FROM venues ORDER BY id')->fetchAll();
    ok(['users' => $rows, 'venues' => $vs]);
}

require_post();
$in = body();
$do = (string)($in['do'] ?? 'create');

/* ---------- 使えるパスワードを作る ---------- */

/**
 * 見まちがえにくい文字だけで、仮のパスワードを作ります。
 * 0とO、1とlとI は紙に書いて渡すと必ず取りちがえるので入れません。
 */
function make_password(int $len = 10): string
{
    $chars = 'abcdefghijkmnpqrstuvwxyz23456789';   // l, o, 0, 1 を除いています
    $out = '';
    $max = strlen($chars) - 1;
    for ($i = 0; $i < $len; $i++) {
        // random_int は推測されにくい値を返します（rand は使いません）
        $out .= $chars[random_int(0, $max)];
    }
    return $out;
}

/* ---------- ログインIDの確認 ---------- */

function check_login_id(string $id): string
{
    $id = strtolower(trim($id));
    if ($id === '') fail(400, 'ログインIDを入れてください。');
    if (!preg_match('/^[a-z0-9][a-z0-9_-]{2,63}$/', $id)) {
        fail(400, 'ログインIDは半角の英数字と - _ で、3文字以上にしてください。');
    }
    return $id;
}

function assert_unused(string $loginId, ?int $exceptId = null): void
{
    $sql = 'SELECT id FROM users WHERE login_id = ?';
    $args = [$loginId];
    if ($exceptId !== null) { $sql .= ' AND id <> ?'; $args[] = $exceptId; }
    $st = db()->prepare($sql);
    $st->execute($args);
    if ($st->fetch()) fail(409, 'そのログインIDはすでに使われています。');
}

/* ============================================================
   新しく作る
   ============================================================ */
if ($do === 'create') {
    $role = (string)($in['role'] ?? '');
    if (!in_array($role, [ROLE_TEACHER, ROLE_STUDENT], true)) {
        // F：運営者は増やせません
        fail(400, '作れるのは先生と生徒だけです。');
    }

    $loginId = check_login_id((string)($in['loginId'] ?? ''));
    assert_unused($loginId);

    $name = trim((string)($in['name'] ?? ''));
    if ($name === '') fail(400, 'お名前を入れてください。');
    if (mb_strlen($name) > 100) fail(400, 'お名前が長すぎます。');

    $venue = trim((string)($in['venue'] ?? ''));
    if ($venue === '') {
        fail(400, '教場を選んでください。');
    }
    $st = db()->prepare('SELECT id FROM venues WHERE id = ?');
    $st->execute([$venue]);
    if (!$st->fetch()) fail(400, 'その教場は登録されていません。');

    $parentEmail = trim((string)($in['parentEmail'] ?? ''));
    if ($role === ROLE_STUDENT && $parentEmail !== '') {
        if (preg_match('/[\r\n]/', $parentEmail)
            || !filter_var($parentEmail, FILTER_VALIDATE_EMAIL)) {
            fail(400, '保護者のメールアドレスの形が正しくありません。');
        }
    }
    if ($role === ROLE_TEACHER) $parentEmail = '';   // 先生には保護者欄はありません

    $password = make_password();
    $ins = db()->prepare(
        'INSERT INTO users (login_id, password_hash, role, name, venue_id, enroll, parent_email)
         VALUES (?, ?, ?, ?, ?, ?, ?)');
    $ins->execute([$loginId, password_hash($password, PASSWORD_DEFAULT),
                   $role, $name, $venue, ENROLL_ACTIVE, $parentEmail]);
    $newId = (int)db()->lastInsertId();

    // 記録に残すのはIDと役割だけ。パスワードは絶対に残しません
    audit($me, 'account_create', (string)$newId, $role . ' ' . $loginId);

    ok([
        'id'       => $newId,
        'loginId'  => $loginId,
        'role'     => $role,
        'name'     => $name,
        'venue'    => $venue,
        // この1回だけお返しします。あとから取り出すことはできません
        'password' => $password,
    ]);
}

/* ============================================================
   パスワードを作り直す
   ============================================================ */
if ($do === 'reset') {
    $id = (int)($in['id'] ?? 0);
    $st = db()->prepare('SELECT id, login_id, role, name FROM users WHERE id = ?');
    $st->execute([$id]);
    $u = $st->fetch();
    if (!$u) fail(404, 'その利用者は見つかりませんでした。');
    if ($u['role'] === ROLE_ADMIN && (int)$u['id'] !== (int)$me['id']) {
        fail(403, 'ほかの運営者のパスワードは変えられません。');
    }

    $password = make_password();
    $up = db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
    $up->execute([password_hash($password, PASSWORD_DEFAULT), $id]);

    audit($me, 'account_reset', (string)$id, $u['login_id']);
    ok(['id' => $id, 'loginId' => $u['login_id'], 'name' => $u['name'],
        'password' => $password]);
}

/* ============================================================
   使えなくする／戻す
   ------------------------------------------------------------
   消しません。消すと学習の記録も一緒に消えてしまうためです。
   生徒は「退塾」、先生も同じ仕組みで止めます。
   ============================================================ */
if ($do === 'disable' || $do === 'enable') {
    $id = (int)($in['id'] ?? 0);
    if ($id === (int)$me['id']) fail(400, 'ご自身のアカウントは止められません。');

    $st = db()->prepare('SELECT id, login_id, role FROM users WHERE id = ?');
    $st->execute([$id]);
    $u = $st->fetch();
    if (!$u) fail(404, 'その利用者は見つかりませんでした。');
    if ($u['role'] === ROLE_ADMIN) fail(403, '運営者は止められません。');

    $next = ($do === 'disable') ? ENROLL_LEFT : ENROLL_ACTIVE;
    $up = db()->prepare('UPDATE users SET enroll = ?, enroll_changed_at = CURDATE() WHERE id = ?');
    $up->execute([$next, $id]);

    audit($me, 'account_' . $do, (string)$id, $u['login_id']);
    ok(['id' => $id, 'enroll' => $next]);
}

/* ============================================================
   教場を足す
   ============================================================ */
if ($do === 'addVenue') {
    $vid = strtolower(trim((string)($in['venueId'] ?? '')));
    if (!preg_match('/^[a-z0-9][a-z0-9_-]{0,31}$/', $vid)) {
        fail(400, '教場のIDは半角の英数字と - _ にしてください。');
    }
    $vname = trim((string)($in['venueName'] ?? ''));
    if ($vname === '') fail(400, '教場の名前を入れてください。');
    if (mb_strlen($vname) > 100) fail(400, '教場の名前が長すぎます。');

    $st = db()->prepare('SELECT id FROM venues WHERE id = ?');
    $st->execute([$vid]);
    if ($st->fetch()) fail(409, 'その教場IDはすでにあります。');

    $ins = db()->prepare('INSERT INTO venues (id, name) VALUES (?, ?)');
    $ins->execute([$vid, $vname]);
    audit($me, 'venue_add', $vid, $vname);
    ok(['id' => $vid, 'name' => $vname]);
}

fail(400, '知らない操作です。');
