<?php
/* ============================================================
   最初の用意（コマンドから実行します）
   ------------------------------------------------------------
     php server/setup.php               … 表を作るだけ
     php server/setup.php --sample      … 見本の利用者も入れる

   Xサーバーでは、管理画面でデータベースを作ってから
   config.php を書きかえて、SSH で一度だけ実行してください。
   ============================================================ */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    // 画面から実行できてしまうと、誰でも初期化できてしまいます
    http_response_code(403);
    exit("コマンドから実行してください。\n");
}

$cfg = require __DIR__ . '/config.php';

/* データベースそのものが無ければ作ります */
$dsn = sprintf('mysql:host=%s;port=%d;charset=utf8mb4', $cfg['db_host'], $cfg['db_port']);
$pdo = new PDO($dsn, $cfg['db_user'], $cfg['db_pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$pdo->exec(sprintf(
    'CREATE DATABASE IF NOT EXISTS `%s` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
    str_replace('`', '', $cfg['db_name'])));
$pdo->exec('USE `' . str_replace('`', '', $cfg['db_name']) . '`');

/* 表を作ります */
/*
 * コメント行を先に落としてから、命令ごとに分けます。
 * 先に分けると「コメント＋命令」がひとかたまりになり、
 * まるごと読み飛ばしてしまうためです。
 */
$sql = file_get_contents(__DIR__ . '/schema.sql');
$sql = preg_replace('/^\s*--.*$/m', '', $sql);
$made = 0;
foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) {
    $pdo->exec($stmt);
    $made++;
}
echo "表を用意しました（{$made}件の命令）。\n";

if (!in_array('--sample', $argv, true)) {
    echo "見本の利用者を入れるには --sample を付けてください。\n";
    exit(0);
}

/* ---------- 見本の利用者 ---------- */
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
$pdo->exec('TRUNCATE TABLE records');
$pdo->exec('TRUNCATE TABLE users');
$pdo->exec('TRUNCATE TABLE venues');
$pdo->exec('SET FOREIGN_KEY_CHECKS = 1');

$venues = [['main', '本部教場'], ['kita', '北教場'], ['minami', '南教場']];
$vs = $pdo->prepare('INSERT INTO venues (id, name) VALUES (?, ?)');
foreach ($venues as $v) $vs->execute($v);

$ins = $pdo->prepare(
    'INSERT INTO users (login_id, password_hash, role, name, venue_id, enroll, parent_email)
     VALUES (?, ?, ?, ?, ?, ?, ?)');

/*
 * 見本のパスワードです。手元で試すためだけのものなので、
 * 本番では必ず作り直してください。
 */
$pw = static fn(string $p): string => password_hash($p, PASSWORD_DEFAULT);

$ins->execute(['admin',    $pw('admin-pass'),   'admin',   '佐藤 潤',   null,     'active', '']);
$ins->execute(['sensei-k', $pw('sensei-pass'),  'teacher', '北教場の先生', 'kita',   'active', '']);
$ins->execute(['sensei-m', $pw('sensei-pass'),  'teacher', '南教場の先生', 'minami', 'active', '']);

$sei = ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤'];
$mei = ['はると', 'ゆい', 'そうた', 'あおい', 'れん', 'ひまり', 'ゆうと', 'いちか',
        'かえで', 'みなと', 'さくら', 'りく'];
$vids = ['main', 'kita', 'minami'];
$enr  = ['active', 'active', 'active', 'active', 'paused', 'left'];

for ($i = 0; $i < 24; $i++) {
    $ins->execute([
        'seito' . ($i + 1),
        $pw('seito-pass'),
        'student',
        $sei[$i % count($sei)] . ' ' . $mei[$i % count($mei)],
        $vids[$i % 3],
        $enr[$i % count($enr)],
        'hogosha' . ($i + 1) . '@example.com',
    ]);
}

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

echo "見本の利用者を入れました。\n";
echo "  運営者 … admin / admin-pass\n";
echo "  先生   … sensei-k, sensei-m / sensei-pass\n";
echo "  生徒   … seito1〜seito24 / seito-pass\n";
echo "※ 見本のパスワードです。本番では必ず作り直してください。\n";
