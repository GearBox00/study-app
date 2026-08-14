<?php
/* ============================================================
   パスワードを変える（ログインしている本人）
   ------------------------------------------------------------
   2026-08-14 追加。

   「忘れたとき」の再設定（reset.php）とは別です。
   覚えてはいるが変えたい、というときに使います。

   ■ いまのパスワードを必ず聞きます
     開いたままの端末を他人が触って、勝手に変えられないようにするためです。

   ■ 変えたあとも、そのまま使えます
     席（ログインの状態）は取り直しますが、入り直す必要はありません。
     学習の途中で変えても、続きから続けられます。
   ============================================================ */
declare(strict_types=1);
require __DIR__ . '/../lib.php';

require_post();
$me = require_login();

$in  = body();
$now = (string)($in['current'] ?? '');
$new = (string)($in['password'] ?? '');

if ($now === '' || $new === '') {
    fail(400, 'いまのパスワードと、新しいパスワードを入れてください。');
}

/* 決まりは reset.php と同じにします。片方だけ緩いと意味がないためです */
if (mb_strlen($new) < 8)  fail(400, 'パスワードは8文字以上にしてください。');
if (mb_strlen($new) > 72) fail(400, 'パスワードは72文字までにしてください。');
if (!preg_match('/^[!-~]+$/', $new)) {
    fail(400, 'パスワードは半角の英数字と記号で入れてください。');
}
if (!preg_match('/[a-zA-Z]/', $new) || !preg_match('/[0-9]/', $new)) {
    fail(400, 'パスワードには英字と数字の両方を入れてください。');
}

$st = db()->prepare('SELECT password_hash FROM users WHERE id = ?');
$st->execute([$me['id']]);
$hash = (string)$st->fetchColumn();

if (!password_verify($now, $hash)) {
    audit($me, 'password_change_failed', (string)$me['id']);
    fail(401, 'いまのパスワードがちがいます。');
}

if (password_verify($new, $hash)) {
    fail(400, 'いまと同じパスワードです。ちがうものにしてください。');
}

$up = db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
$up->execute([password_hash($new, PASSWORD_DEFAULT), $me['id']]);

/*
 * まだ使っていない「忘れたとき」のリンクは、ここで無効にします。
 * 変えたあとに古いリンクで戻されては困るためです。
 */
$up = db()->prepare(
    'UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL');
$up->execute([$me['id']]);

/* 席の番号だけ取り直します。入り直さずにそのまま使えます */
start_session();
session_regenerate_id(true);

audit($me, 'password_change', (string)$me['id']);
ok(['message' => 'パスワードを変えました。次からは新しいパスワードでお入りください。']);
