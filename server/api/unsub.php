<?php
/* ============================================================
   入退室のお知らせを止める（保護者ご自身）
   ------------------------------------------------------------
   2026-08-14 追加。

   お知らせメールの末尾のリンクから開かれます。
   ログインは要りません。合言葉を持っていること自体が、
   そのメールを受け取った本人である証になります。

   ■ 止まるのは「入退室のお知らせ」だけです
     教室からの大事なご連絡（一斉のご案内など）は届きます。
     頻繁に届くものだけを止められるようにするためです。

   ■ 誰のことかは、なるべく出しません
     リンクが人手に渡っても、お子様のお名前が分からないようにします。
     ご自分の宛先だと分かるよう、メールアドレスだけを伏せ字で出します。
   ============================================================ */
declare(strict_types=1);
require __DIR__ . '/../lib.php';

require_post();
$in = body();
$do = (string)($in['do'] ?? '');
$token = (string)($in['token'] ?? '');

/** aaa@example.com → a**@example.com */
function mask_email(string $mail): string
{
    $at = strpos($mail, '@');
    if ($at === false || $at < 1) return '****';
    $head = substr($mail, 0, $at);
    $keep = mb_substr($head, 0, 1);
    return $keep . str_repeat('*', max(1, mb_strlen($head) - 1)) . substr($mail, $at);
}

function find_guardian(string $token): ?array
{
    if (!preg_match('/^[0-9a-f]{64}$/', $token)) return null;
    $st = db()->prepare(
        'SELECT id, email, notify_attendance FROM guardians WHERE unsub_token = ?');
    $st->execute([$token]);
    return $st->fetch() ?: null;
}

if ($do === 'check') {
    $g = find_guardian($token);
    if (!$g) fail(400, 'このリンクは使えません。お手数ですが教室へお問い合わせください。');
    ok([
        'email'    => mask_email($g['email']),
        'notified' => (int)$g['notify_attendance'] === 1,
    ]);
}

if ($do === 'stop' || $do === 'resume') {
    $g = find_guardian($token);
    if (!$g) fail(400, 'このリンクは使えません。お手数ですが教室へお問い合わせください。');

    $on = ($do === 'resume') ? 1 : 0;
    $st = db()->prepare('UPDATE guardians SET notify_attendance = ? WHERE id = ?');
    $st->execute([$on, $g['id']]);

    /*
     * 誰が止めたかは記録に残します。
     * 「届かない」というお問い合わせがあったときに、
     * 運営者が理由を確かめられるようにするためです。
     */
    audit(null, $on ? 'unsub_resume' : 'unsub_stop', (string)$g['id']);

    ok([
        'notified' => $on === 1,
        'message'  => $on
            ? '入退室のお知らせを、またお送りします。'
            : '入退室のお知らせを止めました。教室からの大事なご連絡は、これまでどおり届きます。',
    ]);
}

fail(400, '知らない操作です。');
