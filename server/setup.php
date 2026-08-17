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

/* ============================================================
   ブラウザから実行する場合について
   ------------------------------------------------------------
   誰でも初期化できてしまうと危険なので、ふだんは断ります。
   ただし、SSHが使えないサーバーでは最初の用意ができません。

   そこで、config.php に「setup_token」を書いたときだけ、
   その合言葉つきで実行できるようにしています。

     1. config.php に setup_token を書く（長い文字列）
     2. ブラウザで  .../server/setup.php?token=（その文字列）  を開く
     3. 終わったら、config.php の setup_token を空に戻す

   ■ 画面からは見本の利用者を入れません
     本番に見本の生徒が並んでしまうと困るためです。
     見本が要るときは、これまでどおりコマンドから --sample を付けます。
   ============================================================ */
$cfg = require __DIR__ . '/config.php';
$fromWeb = (PHP_SAPI !== 'cli');

if ($fromWeb) {
    header('Content-Type: text/plain; charset=utf-8');
    $token = (string)($cfg['setup_token'] ?? '');
    $given = (string)($_GET['token'] ?? '');

    // 合言葉が設定されていなければ、画面からは実行できません
    if ($token === '' || strlen($token) < 20) {
        http_response_code(403);
        exit("コマンドから実行してください。\n"
           . "（画面から行う場合は、config.php の setup_token を設定してください）\n");
    }
    /*
     * 文字を1つずつ比べると、合っている長さが返事の速さに出てしまいます。
     * hash_equals は、その差が出ない比べ方をします。
     */
    if (!hash_equals($token, $given)) {
        http_response_code(403);
        exit("合言葉が違います。\n");
    }
    echo "画面から実行しています。\n\n";
}

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
/*
 * 本人の連絡先。先生と運営者が、パスワードを忘れたときの宛先に使います。
 * 生徒は保護者のメール（guardians）へ送るので、ここは空のままです。
 */
$added += (int)$addColumn($pdo, $dbName, 'users', 'email',
    "`email` VARCHAR(255) NOT NULL DEFAULT '' AFTER `kana`");
/*
 * 保護者ごとの、配信を止めるための合言葉。
 * 入退室のお知らせメールの末尾に、この合言葉つきのリンクを載せます。
 * 保護者の方が、教室に申し出なくてもご自分で止められるようにするためです。
 */
$added += (int)$addColumn($pdo, $dbName, 'guardians', 'unsub_token',
    "`unsub_token` CHAR(64) NOT NULL DEFAULT '' AFTER `notify_attendance`");
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

/*
 * まだ合言葉が入っていない保護者に、割り当てます。
 * すでに入っているものは変えません（前に配ったリンクが使えなくなるため）。
 */
$rows = $pdo->query("SELECT id FROM guardians WHERE unsub_token = ''")->fetchAll(PDO::FETCH_COLUMN);
if ($rows) {
    $up = $pdo->prepare('UPDATE guardians SET unsub_token = ? WHERE id = ?');
    foreach ($rows as $gid) $up->execute([bin2hex(random_bytes(32)), $gid]);
    echo '保護者の配信停止用の合言葉を' . count($rows) . "件つくりました。
";
}

/* 退塾している生徒は、アプリも使えない状態にそろえます */
$pdo->exec("UPDATE users SET app_access = 0 WHERE role = 'student' AND enroll = 'left'");

/* ============================================================
   はじめの運営者アカウント
   ------------------------------------------------------------
   運営者は、アカウント発行の画面からは作れません（Fのご指定）。
   そのため、まだ1人もいないときだけ、ここで作ります。

   すでに運営者がいる場合は、何もしません。
   実行し直しても、パスワードが変わってしまうことはありません。
   ============================================================ */
$adminCount = (int)$pdo->query("SELECT COUNT(*) FROM users WHERE role = 'admin'")->fetchColumn();
if ($adminCount === 0) {
    $loginId = 'admin';
    if ($fromWeb && isset($_GET['admin'])) {
        $loginId = trim((string)$_GET['admin']);
    } elseif (!$fromWeb) {
        foreach ($argv as $a) {
            if (strpos($a, '--admin=') === 0) $loginId = substr($a, 8);
        }
    }
    if (!preg_match('/^[A-Za-z0-9_-]{3,64}$/', $loginId)) {
        exit("運営者のログインIDは、半角の英数字と - _ で3文字以上にしてください。\n");
    }

    /*
     * 読み間違えやすい文字（0 O 1 l I）を外しています。
     * 紙に書いてお渡しすることを想定しているためです。
     */
    $chars = 'abcdefghijkmnpqrstuvwxyz23456789';
    $password = '';
    for ($i = 0; $i < 12; $i++) $password .= $chars[random_int(0, strlen($chars) - 1)];

    $st = $pdo->prepare(
        "INSERT INTO users (login_id, password_hash, role, name, enroll, app_access)
         VALUES (?, ?, 'admin', ?, 'active', 1)");
    $st->execute([$loginId, password_hash($password, PASSWORD_DEFAULT), '運営者']);

    echo "\n";
    echo "============================================\n";
    echo "  運営者のアカウントを作りました\n";
    echo "============================================\n";
    echo "  ログインID : {$loginId}\n";
    echo "  パスワード : {$password}\n";
    echo "============================================\n";
    echo "★ このパスワードは、ここでしか表示されません。\n";
    echo "  控えたうえで、ログイン後に必ず変更してください。\n\n";
} else {
    echo "運営者のアカウントはすでにあります（{$adminCount}名）。何もしていません。\n";
}

/*
 * 見本の利用者は、コマンドから実行したときだけ入れます。
 * 画面から実行できてしまうと、本番に見本の生徒が並び、
 * しかも既存の利用者を消してしまいます（下で TRUNCATE しています）。
 */
if ($fromWeb) {
    echo "\n表の用意が終わりました。\n";
    echo "続けて、次のことを行ってください。\n";
    echo "  1. 上の運営者のパスワードを控える\n";
    echo "  2. config.php の setup_token を空（''）に戻す\n";
    echo "  3. アプリを開いてログインし、パスワードを変更する\n";
    exit(0);
}

if (!in_array('--sample', $argv, true)) {
    echo "見本の利用者を入れるには --sample を付けてください。\n";
    exit(0);
}

/* ---------- 見本の利用者 ---------- */
/*
 * 中身は server/setup-sample.php にあります。
 * 本番のサーバーには、そのファイルを置きません。
 * 見本のパスワードと、利用者をいったん全部消す処理が入っているためです。
 */
$samplePath = __DIR__ . '/setup-sample.php';
if (!is_file($samplePath)) {
    echo "見本のファイル（setup-sample.php）がありません。
";
    echo "本番のサーバーでは、これが正しい状態です。
";
    exit(0);
}
require $samplePath;
