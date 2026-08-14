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

/* ============================================================
   あとから足した列
   ------------------------------------------------------------
   すでに動いているデータベースにも当てられるよう、
   「無ければ足す」形にしています。何度実行しても安全です。
   ============================================================ */
$dbName = $cfg['db_name'];
$addColumn = static function (PDO $pdo, string $db, string $table,
                             string $column, string $ddl) : bool {
    $st = $pdo->prepare(
        'SELECT COUNT(*) FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?');
    $st->execute([$db, $table, $column]);
    if ((int)$st->fetchColumn() > 0) return false;
    $pdo->exec("ALTER TABLE `{$table}` ADD COLUMN {$ddl}");
    return true;
};

$added = 0;
/* 学年。「小1」「中2」など、決まった文字で持ちます */
$added += (int)$addColumn($pdo, $dbName, 'users', 'grade',
    "`grade` VARCHAR(8) NOT NULL DEFAULT '' AFTER `kana`");
/* 入塾日 */
$added += (int)$addColumn($pdo, $dbName, 'users', 'joined_on',
    "`joined_on` DATE NULL AFTER `grade`");
/*
 * アプリを使えるかどうか。在籍の状態とは切り離して持ちます。
 * 休塾の定義があとから決められるようにするためです（2026-08-12 ご要望）。
 */
$added += (int)$addColumn($pdo, $dbName, 'users', 'app_access',
    "`app_access` TINYINT(1) NOT NULL DEFAULT 1 AFTER `enroll`");
/*
 * 記録の版番号。保存のたびに1つ進みます。
 * 2台で同時に使ったときに、あとから送ったほうで
 * 丸ごと上書きしてしまうのを防ぐために使います（2026-08-14）。
 */
$added += (int)$addColumn($pdo, $dbName, 'records', 'rev',
    "`rev` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `last_studied`");
/*
 * お知らせ・コラムを書けるかどうか。
 * 先生ごとに運営者が決めます（2026-08-14 ご発注分）。
 * 運営者は列の値によらず、いつでも書けます。
 */
$added += (int)$addColumn($pdo, $dbName, 'users', 'can_post',
    "`can_post` TINYINT(1) NOT NULL DEFAULT 0 AFTER `app_access`");
echo $added ? "列を{$added}件足しました。\n" : "足す列はありませんでした。\n";

/*
 * お知らせの分類のはじめの4つ。
 * まだ1件も無いときだけ入れます。運営者が消したものを
 * 実行のたびに復活させないためです。
 */
if ((int)$pdo->query('SELECT COUNT(*) FROM post_categories')->fetchColumn() === 0) {
    $st = $pdo->prepare('INSERT INTO post_categories (name, sort_order) VALUES (?, ?)');
    foreach (['重要', '事務連絡', '勉強', 'メッセージ'] as $i => $name) {
        $st->execute([$name, ($i + 1) * 10]);
    }
    echo "お知らせの分類を4件入れました。\n";
}

/*
 * すでに登録されている保護者のメールを、新しい表へ移します。
 * 何度実行しても二重にならないようにしています。
 */
$moved = $pdo->exec(
    "INSERT INTO guardians (user_id, relation, email, notify_attendance)
     SELECT u.id, '保護者', u.parent_email, 1
       FROM users u
      WHERE u.parent_email <> ''
        AND NOT EXISTS (SELECT 1 FROM guardians g
                         WHERE g.user_id = u.id AND g.email = u.parent_email)");
if ($moved) echo "保護者の連絡先を{$moved}件、新しい表へ移しました。\n";

/* 退塾している生徒は、アプリも使えない状態にそろえます */
$pdo->exec("UPDATE users SET app_access = 0 WHERE role = 'student' AND enroll = 'left'");

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
$pdo->exec('TRUNCATE TABLE posts');
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
