<?php
/* いま誰としてログインしているか。js/storage.js の whoami() が呼びます */
declare(strict_types=1);
require __DIR__ . '/../lib.php';

$u = current_user();
if (!$u) {
    // ログインしていないときも、エラーにはしません。
    // アプリは「生徒」として動き出せるようにしてあります
    ok(['role' => ROLE_STUDENT, 'id' => null, 'name' => '', 'venue' => null]);
}
ok([
    'role'  => $u['role'],
    'id'    => (int)$u['id'],
    'name'  => $u['name'],
    'venue' => $u['venue_id'],
]);
