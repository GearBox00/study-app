<?php
/* ============================================================
   パスワードを忘れたとき
   ------------------------------------------------------------
   2026-08-14 追加。

     do=request … ログインIDを受け取り、登録のメール宛に
                  使い捨てのリンクを送ります
     do=check   … リンクの合言葉がまだ使えるかを確かめます
     do=commit  … 新しいパスワードに入れかえます

   ■ 「そのIDはありません」と答えません
     どのIDが実在するかが分かってしまうと、順に試して
     在籍者を探られてしまいます。**申請はいつでも同じ返事**にします。
     メールが登録されていない場合も同じです。

   ■ 合言葉そのものは残しません
     データベースにはハッシュだけを入れます。
     万一この表が漏れても、そこからパスワードは変えられません。

   ■ 送り先
     生徒 … 保護者のメール（guardians）。お子様は自分のメールを
             お持ちでない前提です
     先生・運営者 … 本人のメール（users.email）
   ============================================================ */
declare(strict_types=1);
require __DIR__ . '/../lib.php';
require __DIR__ . '/../mail.php';

require_post();
$in = body();
$do = (string)($in['do'] ?? '');

/* 合言葉が使える時間。長すぎると、盗み見られたときの危険が続きます */
const RESET_TTL_MINUTES = 60;
/* 同じ人から立て続けに申請できる回数（1時間あたり） */
const RESET_MAX_PER_HOUR = 3;

function hash_token(string $t): string
{
    return hash('sha256', $t);
}

/** 新しいパスワードとして受けつけてよいか */
function password_ng(string $p): ?string
{
    if (mb_strlen($p) < 8)  return 'パスワードは8文字以上にしてください。';
    if (mb_strlen($p) > 72) return 'パスワードは72文字までにしてください。';
    // 半角の英数字と記号だけにします。全角が混ざると入力しづらいためです
    if (!preg_match('/^[!-~]+$/', $p)) {
        return 'パスワードは半角の英数字と記号で入れてください。';
    }
    if (!preg_match('/[a-zA-Z]/', $p) || !preg_match('/[0-9]/', $p)) {
        return 'パスワードには英字と数字の両方を入れてください。';
    }
    return null;
}

/** その人へ知らせるメールの宛先。無ければ空の配列 */
function reset_targets(array $u): array
{
    if ($u['role'] === ROLE_STUDENT) {
        $st = db()->prepare('SELECT email FROM guardians WHERE user_id = ? AND email <> ""');
        $st->execute([$u['id']]);
        return array_column($st->fetchAll(), 'email');
    }
    return $u['email'] !== '' ? [$u['email']] : [];
}

/* ============================================================
   1. 申請する
   ============================================================ */
if ($do === 'request') {
    $loginId = trim((string)($in['loginId'] ?? ''));

    /*
     * 返事はいつも同じにします。
     * 見つかっても見つからなくても、ここから先で内容は変わりません。
     */
    $answer = [
        'message' => 'ご登録のメールアドレス宛に、再設定のご案内をお送りしました。'
                   . '届かない場合は、メールが登録されていないことも考えられます。'
                   . '教室へお申し出ください。',
    ];
    if ($loginId === '') ok($answer);

    $st = db()->prepare(
        'SELECT id, login_id, role, name, email, app_access FROM users WHERE login_id = ?');
    $st->execute([$loginId]);
    $u = $st->fetch();
    if (!$u) {
        audit(null, 'reset_request_unknown', $loginId);
        ok($answer);
    }
    // 使えないことにしている人には送りません（返事は同じです）
    if ($u['role'] !== ROLE_ADMIN && (int)$u['app_access'] === 0) {
        audit(null, 'reset_request_disabled', (string)$u['id']);
        ok($answer);
    }

    /* 立て続けの申請は受けつけません。メールを浴びせられないためです */
    $st = db()->prepare(
        'SELECT COUNT(*) FROM password_resets
          WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)');
    $st->execute([$u['id']]);
    if ((int)$st->fetchColumn() >= RESET_MAX_PER_HOUR) {
        audit(null, 'reset_request_toomany', (string)$u['id']);
        ok($answer);
    }

    $targets = reset_targets($u);
    if (!$targets) {
        audit(null, 'reset_request_nomail', (string)$u['id']);
        ok($answer);
    }

    /* まだ使っていない古い合言葉は、この時点で無効にします */
    $st = db()->prepare(
        'UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL');
    $st->execute([$u['id']]);

    $token = bin2hex(random_bytes(32));
    $st = db()->prepare(
        'INSERT INTO password_resets (user_id, token_hash, expires_at)
         VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))');
    $st->execute([$u['id'], hash_token($token), RESET_TTL_MINUTES]);

    $base = rtrim((string)(config()['app_url'] ?? ''), '/');
    $link = ($base !== '' ? $base : '') . '/index.html?reset=' . $token;

    $subject = '【SJ式】パスワード再設定のご案内';
    $bodytext =
        "いつもお世話になっております。\n\n"
      . "パスワードの再設定のお申し出をいただきました。\n"
      . "下のリンクを開いて、新しいパスワードをお決めください。\n\n"
      . $link . "\n\n"
      . "・このリンクは " . RESET_TTL_MINUTES . "分で使えなくなります。\n"
      . "・一度お使いになると、二度目は使えません。\n"
      . "・お心当たりがない場合は、このメールを破棄してください。\n"
      . "　パスワードはそのままで、変わることはありません。\n\n"
      . "SJ式 学習教室\n";

    /*
     * ここは mail_enabled（入退室のお知らせを送るか）を見ません。
     * その設定が「送らない」でも、パスワードの再設定は使えないと困るためです。
     *
     * 送れたかどうかは画面には出しません（IDの有無が分かってしまうため）。
     * そのかわり、記録には残します。届かないというお問い合わせがあったときに、
     * 運営者が「そもそも送れていない」のか「届いていない」のかを見分けられます。
     */
    $sent = 0;
    $lastError = '';
    foreach ($targets as $to) {
        $err = '';
        if (send_mail($to, $subject, $bodytext, $err)) $sent++;
        else $lastError = $err;
    }
    audit(null, $sent > 0 ? 'reset_request' : 'reset_request_failed',
        (string)$u['id'], $sent > 0 ? "{$sent}通" : $lastError);
    ok($answer);
}

/* ============================================================
   2. リンクがまだ使えるか
   ============================================================ */
function find_valid(string $token): ?array
{
    if ($token === '') return null;
    $st = db()->prepare(
        'SELECT r.id, r.user_id, u.login_id, u.name, u.role
           FROM password_resets r JOIN users u ON u.id = r.user_id
          WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > NOW()');
    $st->execute([hash_token($token)]);
    return $st->fetch() ?: null;
}

if ($do === 'check') {
    $r = find_valid((string)($in['token'] ?? ''));
    if (!$r) fail(400, 'このリンクは使えません。期限が切れているか、すでにお使いになっています。');
    // 誰のものかは、ログインIDだけをお見せします（氏名は出しません）
    ok(['loginId' => $r['login_id']]);
}

/* ============================================================
   3. 新しいパスワードにする
   ============================================================ */
if ($do === 'commit') {
    $token = (string)($in['token'] ?? '');
    $pw    = (string)($in['password'] ?? '');

    $ng = password_ng($pw);
    if ($ng !== null) fail(400, $ng);

    $pdo = db();
    $pdo->beginTransaction();

    /*
     * 取り出してから使い済みにするまでを1つのまとまりにします。
     * 同じリンクを2つの画面から同時に送られても、
     * 通るのは1回だけになります。
     */
    $st = $pdo->prepare(
        'SELECT id, user_id FROM password_resets
          WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() FOR UPDATE');
    $st->execute([hash_token($token)]);
    $r = $st->fetch();
    if (!$r) {
        $pdo->rollBack();
        fail(400, 'このリンクは使えません。期限が切れているか、すでにお使いになっています。');
    }

    $st = $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
    $st->execute([password_hash($pw, PASSWORD_DEFAULT), $r['user_id']]);

    $st = $pdo->prepare('UPDATE password_resets SET used_at = NOW() WHERE id = ?');
    $st->execute([$r['id']]);

    /* 同じ人の、まだ使っていない合言葉もまとめて無効にします */
    $st = $pdo->prepare(
        'UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL');
    $st->execute([$r['user_id']]);

    $pdo->commit();

    /*
     * どこかで開いたままの画面が使えないよう、席も片づけます。
     * 盗み見られたあとの入れかえで効きます。
     */
    start_session();
    if (!empty($_SESSION['uid']) && (int)$_SESSION['uid'] === (int)$r['user_id']) {
        session_regenerate_id(true);
        unset($_SESSION['uid']);
    }

    audit(null, 'reset_commit', (string)$r['user_id']);
    ok(['message' => 'パスワードを変えました。新しいパスワードでログインしてください。']);
}

fail(400, '知らない操作です。');
