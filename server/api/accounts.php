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
// メールアドレスの形を確かめる valid_email() を使います
require __DIR__ . '/../mail.php';

$me = require_login();
require_can($me, 'manageTeachers');

/*
 * 選べる学年（2026-08-12 追加）。
 * 自由に入力できるようにすると表記がばらつき、繰り上げもできなくなるため、
 * 決まった文字だけを使います。
 */
const GRADES = ['小1', '小2', '小3', '小4', '小5', '小6',
                '中1', '中2', '中3', '高1', '高2', '高3', 'その他'];

/* 進級で1つ上がる先。高3とその他は上がりません */
const GRADE_NEXT = [
    '小1' => '小2', '小2' => '小3', '小3' => '小4', '小4' => '小5', '小5' => '小6',
    '小6' => '中1', '中1' => '中2', '中2' => '中3', '中3' => '高1',
    '高1' => '高2', '高2' => '高3',
];

/* ---------- 一覧 ---------- */
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    $st = db()->query(
        "SELECT u.id, u.login_id, u.role, u.name, u.grade, u.joined_on,
                u.venue_id, u.enroll, u.app_access, u.can_post, u.parent_email,
                u.email, u.created_at,
                v.name AS venue_name
           FROM users u LEFT JOIN venues v ON v.id = u.venue_id
          ORDER BY FIELD(u.role,'admin','teacher','student'), u.id");
    $rows = [];
    foreach ($st->fetchAll() as $u) {
        $rows[] = [
            'id'        => (int)$u['id'],
            'loginId'   => $u['login_id'],
            'role'      => $u['role'],
            'name'      => $u['name'],
            'grade'     => $u['grade'],
            'joinedOn'  => $u['joined_on'] ?? '',
            'venue'     => $u['venue_id'],
            'venueName' => $u['venue_name'],
            'enroll'    => $u['enroll'],
            'appAccess' => (int)$u['app_access'] === 1,
            'canPost'   => (int)($u['can_post'] ?? 0) === 1,
            'email'     => $u['email'] ?? '',
            'parentEmail' => $u['parent_email'],
            'createdAt' => $u['created_at'],
        ];
    }
    $vs = db()->query('SELECT id, name FROM venues ORDER BY id')->fetchAll();
    ok(['users' => $rows, 'venues' => $vs, 'grades' => GRADES]);
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

    /* 学年（2026-08-12 追加）。決まった文字だけを受けつけます */
    $grade = trim((string)($in['grade'] ?? ''));
    if ($grade !== '' && !in_array($grade, GRADES, true)) {
        fail(400, 'その学年は選べません。');
    }
    if ($role === ROLE_TEACHER) $grade = '';    // 先生に学年はありません

    /* 入塾日（2026-08-12 追加） */
    $joined = trim((string)($in['joinedOn'] ?? ''));
    if ($joined !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $joined)) {
        fail(400, '入塾日の形が正しくありません（例：2026-04-01）。');
    }
    if ($joined === '') $joined = null;

    /*
     * 先生の連絡先（2026-08-14 追加）。
     * パスワードを忘れたときの宛先に使います。
     * 生徒には持たせません。保護者のアドレスへ送るためです。
     */
    $email = trim((string)($in['email'] ?? ''));
    if ($role === ROLE_STUDENT) $email = '';
    if ($email !== '' && !valid_email($email)) {
        fail(400, 'メールアドレスの形が正しくありません。');
    }

    $password = make_password();
    $ins = db()->prepare(
        'INSERT INTO users (login_id, password_hash, role, name, grade, joined_on,
                            venue_id, enroll, app_access, parent_email, email)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)');
    $ins->execute([$loginId, password_hash($password, PASSWORD_DEFAULT),
                   $role, $name, $grade, $joined, $venue, ENROLL_ACTIVE, $parentEmail, $email]);
    $newId = (int)db()->lastInsertId();

    /* 保護者の連絡先も、新しい表へ入れておきます */
    if ($role === ROLE_STUDENT && $parentEmail !== '') {
        $g = db()->prepare(
            'INSERT INTO guardians (user_id, relation, email, notify_attendance)
             VALUES (?, ?, ?, 1)');
        $g->execute([$newId, '保護者', $parentEmail]);
    }

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

    /*
     * 在籍の状態とあわせて、アプリの利用可否もそろえます。
     * 2026-08-12に「使えるかどうか」を別の欄へ移したため、
     * ここを変え忘れると、止めたのに使えたままになります。
     */
    $next = ($do === 'disable') ? ENROLL_LEFT : ENROLL_ACTIVE;
    $access = ($do === 'disable') ? 0 : 1;
    $up = db()->prepare(
        'UPDATE users SET enroll = ?, app_access = ?, enroll_changed_at = CURDATE() WHERE id = ?');
    $up->execute([$next, $access, $id]);

    audit($me, 'account_' . $do, (string)$id, $u['login_id']);
    ok(['id' => $id, 'enroll' => $next]);
}

/* ============================================================
   学年と入塾日を直す（2026-08-12 追加）
   ============================================================ */
if ($do === 'setProfile') {
    $id = (int)($in['id'] ?? 0);
    $st = db()->prepare("SELECT id, login_id, role FROM users WHERE id = ?");
    $st->execute([$id]);
    $u = $st->fetch();
    if (!$u) fail(404, 'その利用者は見つかりませんでした。');

    $sets = [];
    $args = [];
    if (array_key_exists('grade', $in)) {
        $grade = trim((string)$in['grade']);
        if ($grade !== '' && !in_array($grade, GRADES, true)) fail(400, 'その学年は選べません。');
        $sets[] = 'grade = ?';
        $args[] = $grade;
    }
    if (array_key_exists('joinedOn', $in)) {
        $joined = trim((string)$in['joinedOn']);
        if ($joined !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $joined)) {
            fail(400, '入塾日の形が正しくありません（例：2026-04-01）。');
        }
        $sets[] = 'joined_on = ?';
        $args[] = ($joined === '' ? null : $joined);
    }
    /*
     * 先生と運営者の連絡先。パスワードを忘れたときの宛先に使います。
     * 生徒には持たせません。お子様は自分のメールをお持ちでない前提で、
     * 生徒への連絡は保護者のアドレス（guardians）へ送るためです。
     */
    if (array_key_exists('email', $in)) {
        $email = trim((string)$in['email']);
        if ($u['role'] === ROLE_STUDENT && $email !== '') {
            fail(400, '生徒には本人のメールアドレスを登録しません。保護者の連絡先をお使いください。');
        }
        if ($email !== '' && !valid_email($email)) {
            fail(400, 'メールアドレスの形が正しくありません。');
        }
        $sets[] = 'email = ?';
        $args[] = $email;
    }
    if (!$sets) fail(400, '変える項目がありません。');

    $args[] = $id;
    $up = db()->prepare('UPDATE users SET ' . implode(', ', $sets) . ' WHERE id = ?');
    $up->execute($args);
    audit($me, 'profile_change', (string)$id, implode(',', array_keys($in)));
    ok(['id' => $id]);
}

/* ============================================================
   進級（全員の学年を1つ繰り上げる）
   ------------------------------------------------------------
   一度押すと全員に及ぶ操作ですので、
   「下見」と「実行」を分けています。
   下見で内容を確かめてから実行していただく形です。
   ============================================================ */
if ($do === 'promotePreview' || $do === 'promote') {
    $st = db()->query(
        "SELECT id, name, grade, venue_id, enroll FROM users
          WHERE role = 'student' AND grade <> '' ORDER BY grade, id");

    $changes = [];
    $stay = [];
    foreach ($st->fetchAll() as $u) {
        $next = GRADE_NEXT[$u['grade']] ?? null;
        $row = [
            'id'    => (int)$u['id'],
            'name'  => $u['name'],
            'from'  => $u['grade'],
            'to'    => $next,
            'venue' => $u['venue_id'],
            'enroll' => $u['enroll'],
        ];
        if ($next === null) {
            // 高3とその他は上がりません（卒業される学年です）
            $row['reason'] = 'これ以上は上がりません';
            $stay[] = $row;
        } else {
            $changes[] = $row;
        }
    }

    if ($do === 'promotePreview') {
        ok(['changes' => $changes, 'stay' => $stay]);
    }

    /* 実行。除きたい生徒さんは exclude で指定できます */
    $exclude = [];
    if (isset($in['exclude']) && is_array($in['exclude'])) {
        foreach ($in['exclude'] as $x) $exclude[] = (int)$x;
    }

    $up = db()->prepare('UPDATE users SET grade = ? WHERE id = ?');
    $done = 0;
    db()->beginTransaction();
    try {
        foreach ($changes as $c) {
            if (in_array($c['id'], $exclude, true)) continue;
            $up->execute([$c['to'], $c['id']]);
            $done++;
        }
        db()->commit();
    } catch (Throwable $e) {
        db()->rollBack();
        fail(500, '繰り上げの途中で問題が起きたため、元に戻しました。');
    }

    audit($me, 'promote', '', "done={$done} excluded=" . count($exclude));
    ok(['promoted' => $done, 'excluded' => count($exclude), 'stayed' => count($stay)]);
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
