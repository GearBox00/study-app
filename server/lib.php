<?php
/* ============================================================
   サーバー側の共通処理
   ------------------------------------------------------------
   2026-08-11 作成。

   ■ いちばん大事なこと
     画面側（js/auth.js）の出し分けは「うっかり触らせない」ための
     目隠しにすぎません。端末の中を書きかえれば通せてしまいます。
     ですから、同じ判定をここにも必ず書きます。
     このファイルの $PERMISSIONS は js/auth.js の PERMISSIONS と
     同じ中身でなければなりません（検証で突き合わせています）。
   ============================================================ */

declare(strict_types=1);

/* ---------- 役割と在籍の状態（js/auth.js と同じ文字を使います） ---------- */
const ROLE_STUDENT = 'student';
const ROLE_TEACHER = 'teacher';
const ROLE_ADMIN   = 'admin';

const ENROLL_ACTIVE = 'active';
const ENROLL_PAUSED = 'paused';
const ENROLL_LEFT   = 'left';

/*
 * できること／できないこと。
 * js/auth.js の PERMISSIONS と一字一句そろえてください。
 */
$PERMISSIONS = [
    'study'            => [ROLE_STUDENT, ROLE_TEACHER, ROLE_ADMIN],
    'ownRecord'        => [ROLE_STUDENT, ROLE_TEACHER, ROLE_ADMIN],
    'manageQuestions'  => [ROLE_TEACHER, ROLE_ADMIN],
    'printTest'        => [ROLE_TEACHER, ROLE_ADMIN],
    'viewGrades'       => [ROLE_TEACHER, ROLE_ADMIN],
    'viewPersonal'     => [ROLE_ADMIN],
    'changeEnrollment' => [ROLE_ADMIN],
    'manageTeachers'   => [ROLE_ADMIN],
    'viewAllVenues'    => [ROLE_ADMIN],
    'manageMail'       => [ROLE_ADMIN],
    'writePost'        => [ROLE_TEACHER, ROLE_ADMIN],
    'managePosts'      => [ROLE_ADMIN],
];

/* ---------- 設定と接続 ---------- */

function config(): array
{
    static $c = null;
    if ($c === null) {
        $path = __DIR__ . '/config.php';
        if (!is_file($path)) {
            fail(500, 'config.php がありません。config.sample.php をコピーして作ってください。');
        }
        $c = require $path;
    }
    return $c;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $c = config();
        $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            $c['db_host'], $c['db_port'], $c['db_name']);
        try {
            $pdo = new PDO($dsn, $c['db_user'], $c['db_pass'], [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                // 値を必ず分けて送ります。文字列を組み立てて渡さないためです
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]);
        } catch (PDOException $e) {
            // 中身は画面に出しません。接続情報が漏れるためです
            fail(500, 'データベースにつながりませんでした。');
        }
    }
    return $pdo;
}

/* ---------- 返事の形 ---------- */

function send_headers(): void
{
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: no-store');
    $origin = config()['allow_origin'] ?? '';
    if ($origin !== '') {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Access-Control-Allow-Credentials: true');
    }
}

function ok($data = null): void
{
    send_headers();
    echo json_encode(['ok' => true, 'data' => $data],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(int $status, string $msg): void
{
    fail_with($status, $msg, null);
}

/**
 * 失敗を返すときに、あわせて中身も渡します。
 * 記録の版番号が食い違ったとき（409）に、サーバー側の記録を
 * そのまま返して、アプリ側で突き合わせてもらうために使います。
 */
function fail_with(int $status, string $msg, $data): void
{
    http_response_code($status);
    send_headers();
    echo json_encode(['ok' => false, 'error' => $msg, 'data' => $data],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/** 送られてきたJSONを受け取ります */
function body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) return [];
    $v = json_decode($raw, true);
    return is_array($v) ? $v : [];
}

/* ---------- ログインの状態 ---------- */

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        // https のときだけ鍵つきにします（手元の http でも動くように）
        'secure'   => !empty($_SERVER['HTTPS']),
        'httponly' => true,       // JavaScript から読めないようにします
        'samesite' => 'Lax',      // ほかのサイトからの持ち出しを防ぎます
    ]);
    session_start();
}

/* ============================================================
   保守用のアカウント（2026-08-21 追加、08-21 に置き場所を変更）
   ------------------------------------------------------------
   動作の確認と保守のために使うものです。
   教室側の画面（名簿・アカウントの一覧）には出しません。

   ■ ログインIDは config.php に書きます
     このファイルは公開のリポジトリに入るため、ここには書きません。
     IDが分かると、あとはパスワードだけが守りになってしまいます。

         'dev_login_ids' => ['xxxx', 'yyyy'],

   ■ 書いていなければ、何も隠しません
     公開しているお試し版のように保守用アカウントが無い場所では、
     設定を書かなければ、そのまま全員が表示されます。

   ★消すときは、config.php のこの欄を空にして、
     データベースから該当の利用者を消してください。
   ============================================================ */

/** 保守用アカウントのログインID。設定していなければ空 */
function dev_login_ids(): array
{
    static $ids = null;
    if ($ids === null) {
        $v = config()['dev_login_ids'] ?? [];
        // 文字列だけを通します。設定を書き誤っても、変な値が混ざらないように
        $ids = is_array($v) ? array_values(array_filter(array_map('strval', $v), 'strlen')) : [];
    }
    return $ids;
}

/** その人は保守用のアカウントか */
function is_dev_user(?array $u): bool
{
    return $u !== null && in_array((string)($u['login_id'] ?? ''), dev_login_ids(), true);
}

/**
 * 一覧から隠すための条件。保守用で見ているときは隠しません。
 *
 * 値は設定ファイルから来ますが、念のため文字列として組み立てず、
 * 「?」で並べて渡せるようにした条件と、そこへ入れる値を返します。
 */
function dev_hidden_clause(?array $me, string $alias = 'u'): array
{
    $ids = dev_login_ids();
    if (is_dev_user($me) || !$ids) return ['', []];
    $marks = implode(',', array_fill(0, count($ids), '?'));
    return [" AND {$alias}.login_id NOT IN ({$marks}) ", $ids];
}

/** いまログインしている人。していなければ null */
function current_user(): ?array
{
    start_session();
    if (empty($_SESSION['uid'])) return null;

    static $u = null;
    if ($u === null) {
        $st = db()->prepare(
            'SELECT id, login_id, role, name, kana, grade, joined_on,
                    venue_id, enroll, app_access, can_post, parent_email
               FROM users WHERE id = ?');
        $st->execute([$_SESSION['uid']]);
        $u = $st->fetch() ?: null;

        /*
         * 使えないことにしている人は、そのままでは入れないようにします。
         *
         * 2026-08-12に「アプリを使えるかどうか」を在籍の状態から切り離したため、
         * 判断はその欄（app_access）だけを見ます。
         * 休塾の定義があとから決まっても、ここを直さずに済みます。
         * 運営者だけは、うっかり自分を締め出さないよう対象外にしています。
         */
        if ($u && $u['role'] !== ROLE_ADMIN && (int)$u['app_access'] === 0) {
            $u = null;
        }
    }
    return $u;
}

function require_login(): array
{
    $u = current_user();
    if (!$u) fail(401, 'ログインしてください。');
    return $u;
}

/** その操作をしてよいか。js/auth.js の can() と同じ判定です */
function can(?array $user, string $action): bool
{
    global $PERMISSIONS;
    if (!$user) return false;
    if (!isset($PERMISSIONS[$action])) return false;   // 知らない操作は許さない
    return in_array($user['role'], $PERMISSIONS[$action], true);
}

function require_can(array $user, string $action): void
{
    if (!can($user, $action)) fail(403, 'この操作をする権限がありません。');
}

/**
 * その生徒を見てよいか。js/auth.js の canSeeStudent() と同じ判定です。
 *  ・運営者 … すべて
 *  ・先生   … 自分の教場だけ（B）
 *  ・生徒   … 自分のぶんだけ
 */
function can_see_student(array $me, array $student): bool
{
    if ($me['role'] === ROLE_ADMIN) return true;
    if ($me['role'] === ROLE_TEACHER) {
        return $student['venue_id'] !== null && $student['venue_id'] === $me['venue_id'];
    }
    return (int)$student['id'] === (int)$me['id'];
}

/**
 * 画面へ渡す1行分。見てよくない項目はここで落とします（C）。
 * 画面側で判断させると書き漏らしが起きるので、出す前に削ります。
 */
function student_view(array $me, array $s): array
{
    $open = can($me, 'viewPersonal') && can_see_student($me, $s);
    return [
        'id'             => (int)$s['id'],
        'name'           => $open ? $s['name'] : ('生徒 ' . $s['id']),
        'kana'           => $open ? ($s['kana'] ?? '') : '',
        'parentEmail'    => $open ? ($s['parent_email'] ?? '') : '',
        'guardians'      => $open ? (int)($s['guardian_count'] ?? 0) : 0,
        'personalHidden' => !$open,
        /*
         * 学年と入塾日は、先生にもお見せします（2026-08-12 ご要望）。
         * 学年が分からないと、成績を見ても指導に結びつかないためです。
         */
        'grade'          => $s['grade'] ?? '',
        'joinedOn'       => $s['joined_on'] ?? '',
        'venue'          => $s['venue_id'] ?? '',
        'enroll'         => $s['enroll'],
        'appAccess'      => (int)($s['app_access'] ?? 1) === 1,
        'answered'       => (int)($s['answered'] ?? 0),
        'correct'        => (int)($s['correct'] ?? 0),
        'lastStudied'    => $s['last_studied'] ?? '',
        'note'           => $s['note'] ?? '',
    ];
}

/** 誰が何をしたかを残します */
function audit(?array $me, string $action, string $target = '', string $detail = ''): void
{
    try {
        $st = db()->prepare(
            'INSERT INTO audit_log (actor_id, action, target, detail) VALUES (?, ?, ?, ?)');
        $st->execute([$me['id'] ?? null, $action, $target, mb_substr($detail, 0, 255)]);
    } catch (Throwable $e) {
        // 記録に失敗しても、本来の処理は止めません
    }
}

/* ============================================================
   ログインの試行回数の制限（2026-08-21 追加）
   ------------------------------------------------------------
   同じログインIDで続けて LOGIN_FAIL_MAX 回まちがえると、
   そのIDは LOGIN_FAIL_MINUTES 分のあいだ受け付けません。
   時間がたてば自動でもとに戻ります。

   ■ なぜ「ログインIDごと」に数えるか
     端末やIPごとに数えると、教場の生徒さんは同じ回線をお使いのため、
     ひとりの打ち間違いで教室ごと締め出されてしまいます。

   ■ なぜ表を増やさないか
     もともと audit_log に login_failed を残しています。
     本番のデータベースを作りかえずに足せるよう、これを数えます。

   ■ 入れたときは、直前の失敗を数から外します
     消さずに action を login_failed_ok に書きかえるだけなので、
     「まちがえたが、そのあと本人が入れた」という跡は残ります。

   ■ IDが無い場合も同じように数えます
     存在するIDのときだけ止めると、止まったかどうかで
     「そのIDはある」と分かってしまうためです。
   ============================================================ */
const LOGIN_FAIL_MAX = 3;
const LOGIN_FAIL_MINUTES = 10;

/** そのログインIDが、いま何回続けてまちがえているか */
function login_fail_count(string $loginId): int
{
    try {
        $st = db()->prepare(
            'SELECT COUNT(*) FROM audit_log
              WHERE action = ? AND target = ?
                AND created_at > DATE_SUB(NOW(), INTERVAL ' . LOGIN_FAIL_MINUTES . ' MINUTE)');
        $st->execute(['login_failed', $loginId]);
        return (int)$st->fetchColumn();
    } catch (Throwable $e) {
        // 数えられないときは、締め出さない側に倒します
        return 0;
    }
}

/** いま止めるべきか */
function login_locked(string $loginId): bool
{
    return login_fail_count($loginId) >= LOGIN_FAIL_MAX;
}

/** 入れたので、直前までの失敗を数から外します */
function login_fail_clear(string $loginId): void
{
    try {
        $st = db()->prepare(
            'UPDATE audit_log SET action = ?
              WHERE action = ? AND target = ?
                AND created_at > DATE_SUB(NOW(), INTERVAL ' . LOGIN_FAIL_MINUTES . ' MINUTE)');
        $st->execute(['login_failed_ok', 'login_failed', $loginId]);
    } catch (Throwable $e) {
        // 外せなくても、入れたこと自体は妨げません
    }
}

/** POST 以外で呼ばれたら断ります（うっかりリンクで実行されるのを防ぎます） */
function require_post(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail(405, 'POST で呼んでください。');
}
