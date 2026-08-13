<?php
/* ログイン。ログインIDとパスワードを受け取り、合っていれば席を用意します */
declare(strict_types=1);
require __DIR__ . '/../lib.php';
require_post();

$in = body();
$loginId = trim((string)($in['loginId'] ?? ''));
$password = (string)($in['password'] ?? '');

if ($loginId === '' || $password === '') {
    fail(400, 'ログインIDとパスワードを入れてください。');
}

$st = db()->prepare('SELECT id, login_id, password_hash, role, name, venue_id, enroll, app_access
                       FROM users WHERE login_id = ?');
$st->execute([$loginId]);
$u = $st->fetch();

/*
 * IDが無い場合も、パスワードが違う場合も、同じ文言を返します。
 * 「そのIDは存在する」と分かってしまうと、狙い撃ちされるためです。
 * 見つからないときも照合の処理を通し、返事の速さで見分けられないようにします。
 */
$hash = $u['password_hash'] ?? '$2y$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
if (!password_verify($password, $hash) || !$u) {
    audit(null, 'login_failed', $loginId);
    fail(401, 'ログインIDまたはパスワードがちがいます。');
}

/*
 * 使えないことにしている人は入れません。
 * 2026-08-12に「アプリを使えるかどうか」を在籍の状態から切り離したため、
 * ここも current_user() と同じ欄だけを見ます。
 */
if ($u['role'] !== ROLE_ADMIN && (int)$u['app_access'] === 0) {
    audit($u, 'login_denied_left', (string)$u['id']);
    fail(403, 'このアカウントは現在ご利用いただけません。教室へお問い合わせください。');
}

// 保存の仕方が古くなっていたら、この機会に新しくします
if (password_needs_rehash($u['password_hash'], PASSWORD_DEFAULT)) {
    $up = db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
    $up->execute([password_hash($password, PASSWORD_DEFAULT), $u['id']]);
}

start_session();
// 別人の席を乗っ取られないよう、ログインのたびに席の番号を取り直します
session_regenerate_id(true);
$_SESSION['uid'] = (int)$u['id'];

audit($u, 'login', (string)$u['id']);

ok([
    'role'  => $u['role'],
    'id'    => (int)$u['id'],
    'name'  => $u['name'],
    'venue' => $u['venue_id'],
]);
