<?php
/* ============================================================
   見本の利用者と問題（手元で試すためだけのもの）
   ------------------------------------------------------------
   setup.php に --sample を付けたときだけ読み込まれます。

   ★ このファイルは、本番のサーバーへ上げないでください。
     ・見本のパスワードがそのまま書かれています
     ・利用者・記録・お知らせを、いったん全部消してから入れ直します

     転送用の一式を作る 検証/make_upload.py は、
     このファイルを外すようにしてあります。

   setup.php から読み込まれる前提で書いています（$pdo を使います）。
   ============================================================ */

/* ---------- 見本の利用者 ---------- */
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
$pdo->exec('TRUNCATE TABLE records');
$pdo->exec('TRUNCATE TABLE users');
$pdo->exec('TRUNCATE TABLE venues');
$pdo->exec('TRUNCATE TABLE posts');
/*
 * 保護者と、再設定の合言葉も消します。
 * 利用者を作り直すと番号が1から振り直されるため、消さずにおくと
 * 古い行が新しい利用者のものとして残り、
 * 「受け取らない」にした設定などが引き継がれてしまいます。
 */
$pdo->exec('TRUNCATE TABLE guardians');
$pdo->exec('TRUNCATE TABLE password_resets');
$pdo->exec('SET FOREIGN_KEY_CHECKS = 1');

$venues = [['main', '本部教場'], ['kita', '北教場'], ['minami', '南教場']];
$vs = $pdo->prepare('INSERT INTO venues (id, name) VALUES (?, ?)');
foreach ($venues as $v) $vs->execute($v);

$ins = $pdo->prepare(
    'INSERT INTO users (login_id, password_hash, role, name, venue_id, enroll, app_access, parent_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)');

/*
 * 見本のパスワードです。手元で試すためだけのものなので、
 * 本番では必ず作り直してください。
 */
$pw = static fn(string $p): string => password_hash($p, PASSWORD_DEFAULT);

$ins->execute(['admin',    $pw('admin-pass'),   'admin',   '佐藤 潤',   null,     'active', 1, '']);
$ins->execute(['sensei-k', $pw('sensei-pass'),  'teacher', '北教場の先生', 'kita',   'active', 1, '']);
$ins->execute(['sensei-m', $pw('sensei-pass'),  'teacher', '南教場の先生', 'minami', 'active', 1, '']);

$sei = ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤'];
$mei = ['はると', 'ゆい', 'そうた', 'あおい', 'れん', 'ひまり', 'ゆうと', 'いちか',
        'かえで', 'みなと', 'さくら', 'りく'];
$vids = ['main', 'kita', 'minami'];
$enr  = ['active', 'active', 'active', 'active', 'paused', 'left'];

for ($i = 0; $i < 24; $i++) {
    $enroll = $enr[$i % count($enr)];
    $ins->execute([
        'seito' . ($i + 1),
        $pw('seito-pass'),
        'student',
        $sei[$i % count($sei)] . ' ' . $mei[$i % count($mei)],
        $vids[$i % 3],
        $enroll,
        // 退塾の生徒はアプリも使えない状態にそろえます
        $enroll === 'left' ? 0 : 1,
        'hogosha' . ($i + 1) . '@example.com',
    ]);
}

/*
 * 見本の保護者。上で表を空にしているので、ここで作り直します。
 * 配信を止めるための合言葉も、このときに割り当てます。
 */
$g = $pdo->prepare(
    'INSERT INTO guardians (user_id, relation, email, notify_attendance, unsub_token)
     VALUES (?, ?, ?, 1, ?)');
$made = 0;
foreach ($pdo->query("SELECT id, parent_email FROM users
                       WHERE role='student' AND parent_email <> ''") as $row) {
    $g->execute([$row['id'], '保護者', $row['parent_email'], bin2hex(random_bytes(32))]);
    $made++;
}
echo "見本の保護者を{$made}件入れました。
";

/* 一覧の見え方を確かめるため、学習の記録も少し入れます */
$rec = $pdo->prepare(
    'INSERT INTO records (user_id, payload, answered, correct, last_studied) VALUES (?, ?, ?, ?, ?)');
$ids = $pdo->query("SELECT id FROM users WHERE role='student' ORDER BY id")->fetchAll(PDO::FETCH_COLUMN);
foreach ($ids as $n => $uid) {
    $answered = 40 + (($n * 37) % 260);
    $rec->execute([
        $uid,
        json_encode(['nick' => '', 'answered' => $answered], JSON_UNESCAPED_UNICODE),
        $answered,
        (int)round($answered * (0.55 + (($n * 7) % 35) / 100)),
        sprintf('2026-08-%02d', 1 + ($n % 11)),
    ]);
}

/*
 * メールの設定。手元では実際には送らず、
 * server/mail-dryrun.log に書き出すだけにします。
 * 本番へ移すときは mail_dry_run を消してください。
 */
$set = $pdo->prepare('INSERT INTO settings (name, value) VALUES (?, ?)
                      ON DUPLICATE KEY UPDATE value = VALUES(value)');
$set->execute(['mail_dry_run', '1']);
$set->execute(['mail_enabled', '0']);
$set->execute(['mail_from', 'info@example.com']);

/* ---------- 見本のお知らせ ---------- */
/* 北教場の先生には、書ける権限を付けた状態にしておきます */
$pdo->exec("UPDATE users SET can_post = 1 WHERE login_id = 'sensei-k'");

$adminId  = (int)$pdo->query("SELECT id FROM users WHERE login_id='admin'")->fetchColumn();
$senseiId = (int)$pdo->query("SELECT id FROM users WHERE login_id='sensei-k'")->fetchColumn();
$cat = [];
foreach ($pdo->query('SELECT id, name FROM post_categories') as $r) $cat[$r['name']] = (int)$r['id'];

$ps = $pdo->prepare(
    'INSERT INTO posts (title, bodytext, category_id, venue_id, author_id, author_name, pinned, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
$ps->execute(['お盆期間の休講について',
    "8月13日（木）から8月16日（日）までお休みをいただきます。\n\n"
    . "この間もアプリはお使いいただけます。\n宿題のセットを入れてありますので、進めておいてください。",
    $cat['重要'] ?? null, null, $adminId, '佐藤 潤', 1, '2026-08-10 09:00:00']);
$ps->execute(['夏期講習の残り日程',
    "8月20日以降の空きがわずかとなりました。\nご希望の方はお早めにお申し出ください。",
    $cat['事務連絡'] ?? null, null, $adminId, '佐藤 潤', 0, '2026-08-12 14:30:00']);
$ps->execute(['漢字は「読み」から覚えると速くなります',
    "書き取りから入ると手が止まりがちです。\n"
    . "まず読みだけを一周してから書き取りに進むと、覚えるまでの回数が減ります。\n\n"
    . "アプリでも、同じセットを「読み」→「書き取り」の順に回せます。",
    $cat['勉強'] ?? null, null, $senseiId, '北教場の先生', 0, '2026-08-13 18:00:00']);
$ps->execute(['北教場：教室の移動について',
    "9月から2階の教室に移ります。1階の入口からお入りください。",
    $cat['事務連絡'] ?? null, 'kita', $senseiId, '北教場の先生', 0, '2026-08-14 10:00:00']);

echo "見本のお知らせを4件入れました。\n";
echo "見本の利用者を入れました。\n";
echo "  運営者 … admin / admin-pass\n";
echo "  先生   … sensei-k, sensei-m / sensei-pass\n";
echo "  生徒   … seito1〜seito24 / seito-pass\n";
echo "※ 見本のパスワードです。本番では必ず作り直してください。\n";
