<?php
/* ============================================================
   保護者へのお知らせメール
   ------------------------------------------------------------
   2026-08-11 作成。入退室のQRを読んだときに送ります。

   ■ 気をつけていること
     ・日本語が化けないよう、件名も本文もきちんと組み立てます
     ・送信の失敗で、生徒の画面を止めません（記録は必ず残します）
     ・短い間に何度も読み取られても、連投しません
     ・お子さんの氏名以外の個人情報は本文に入れません
   ============================================================ */

declare(strict_types=1);

/* ---------- 設定の読み書き ---------- */

function setting(string $name, string $default = ''): string
{
    static $cache = [];
    if (array_key_exists($name, $cache)) return $cache[$name];
    $st = db()->prepare('SELECT value FROM settings WHERE name = ?');
    $st->execute([$name]);
    $row = $st->fetch();
    $cache[$name] = $row ? (string)$row['value'] : $default;
    return $cache[$name];
}

function set_setting(string $name, string $value): void
{
    $st = db()->prepare(
        'INSERT INTO settings (name, value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE value = VALUES(value)');
    $st->execute([$name, $value]);
}

/* ---------- 既定の文面 ---------- */

const MAIL_DEFAULTS = [
    'mail_enabled'   => '0',              // 既定は「送らない」。運営者が入にします
    'mail_from'      => '',               // 差出人。教室のドメインのメールアドレス
    'mail_from_name' => 'SJ式 学習アプリ',
    'mail_subject_in'   => '【SJ式】{name}さんが入室しました',
    'mail_subject_out'  => '【SJ式】{name}さんが退室しました',
    'mail_body_in'      => "いつもお世話になっております。\n\n"
        . "{name}さんが {time} に {venue} へ入室しました。\n\n"
        . "――――――――――――\n"
        . "このメールは自動でお送りしています。\n"
        . "ご返信いただいてもお答えできません。\n",
    'mail_body_out'     => "いつもお世話になっております。\n\n"
        . "{name}さんが {time} に {venue} を退室しました。\n"
        . "本日の学習時間は {minutes} でした。\n\n"
        . "――――――――――――\n"
        . "このメールは自動でお送りしています。\n"
        . "ご返信いただいてもお答えできません。\n",
];

function mail_setting(string $name): string
{
    return setting($name, MAIL_DEFAULTS[$name] ?? '');
}

/* ---------- 組み立て ---------- */

/** {name} などを実際の値に置きかえます */
function fill_template(string $tpl, array $vars): string
{
    foreach ($vars as $k => $v) {
        $tpl = str_replace('{' . $k . '}', (string)$v, $tpl);
    }
    return $tpl;
}

function format_minutes(?int $m): string
{
    if ($m === null) return '—';
    if ($m < 60) return $m . '分';
    return intdiv($m, 60) . '時間' . ($m % 60 > 0 ? ($m % 60) . '分' : '');
}

/**
 * メールアドレスとして使える形か。
 * 改行が混ざっていると、ヘッダーに別の宛先を紛れこませられるため、
 * 形の確認とあわせて必ず弾きます。
 */
function valid_email(string $addr): bool
{
    if ($addr === '') return false;
    if (preg_match('/[\r\n]/', $addr)) return false;
    return (bool)filter_var($addr, FILTER_VALIDATE_EMAIL);
}

/**
 * 件名を、日本語が化けない形に直します。
 * 改行の除去は send_mail() の入口で先に済ませてあります
 * （ここだけで行うと、手元で試すときの経路を素通りしてしまうためです）。
 */
function encode_subject(string $subject): string
{
    return mb_encode_mimeheader($subject, 'UTF-8', 'B', "\r\n");
}

/* ---------- 送信 ---------- */

/**
 * 1通送ります。送れたら true。
 * 失敗しても例外は投げません。呼び出し元の処理を止めないためです。
 */
function send_mail(string $to, string $subject, string $body, string &$error = ''): bool
{
    if (!valid_email($to)) { $error = '宛先の形が正しくありません。'; return false; }

    /*
     * 件名の改行は、ここでいちばん先に落とします。
     * 改行を残したままだと、そこから先が別のヘッダー（Bcc など）として
     * 解釈され、知らない宛先へ送られてしまいます。
     * 実際に送る直前ではなくここで落とすのは、手元で試すときの経路も
     * 同じ状態にして、検証が本番と食い違わないようにするためです。
     */
    $subject = str_replace(["\r", "\n"], '', $subject);

    $fromAddr = mail_setting('mail_from');
    if (!valid_email($fromAddr)) { $error = '差出人が設定されていません。'; return false; }

    $fromName = str_replace(["\r", "\n"], '', mail_setting('mail_from_name'));

    $headers = [
        'From: ' . mb_encode_mimeheader($fromName, 'UTF-8', 'B', "\r\n") . ' <' . $fromAddr . '>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        // 自動送信なので、不在通知などが返ってこないようにします
        'Auto-Submitted: auto-generated',
        'X-Auto-Response-Suppress: All',
    ];

    // 手元で試すときは、実際には送らずファイルに書き出します
    if (setting('mail_dry_run', '0') === '1') {
        $log = __DIR__ . '/mail-dryrun.log';
        $rec = sprintf("=== %s ===\nTo: %s\nSubject: %s\n\n%s\n\n",
            date('Y-m-d H:i:s'), $to, $subject, $body);
        file_put_contents($log, $rec, FILE_APPEND);
        return true;
    }

    $ok = @mail($to, encode_subject($subject), $body,
        implode("\r\n", $headers), '-f' . $fromAddr);
    if (!$ok) $error = 'サーバーが送信を受けつけませんでした。';
    return $ok;
}

/**
 * 入退室のお知らせを送ります。
 * 戻り値は 'sent' / 'failed' / 'skipped' のいずれか。
 *
 * 送らない場合（skipped）
 *   ・運営者が「送らない」設定にしている
 *   ・その生徒に保護者のメールが登録されていない
 *   ・直前に同じ知らせを送ったばかり（連投を防ぐため）
 */
function notify_guardian(array $student, string $kind, ?int $minutes, string &$error = ''): string
{
    if (mail_setting('mail_enabled') !== '1') return 'skipped';

    $to = (string)($student['parent_email'] ?? '');
    if (!valid_email($to)) return 'skipped';

    /*
     * 連投を防ぎます。
     * QRを続けて読み取ってしまったときに、保護者へ何通も届くと
     * 迷惑になりますし、送信数の上限も無駄に使ってしまいます。
     */
    $st = db()->prepare(
        "SELECT COUNT(*) FROM attendance
          WHERE user_id = ? AND kind = ? AND mail_state = 'sent'
            AND happened_at > (NOW() - INTERVAL 3 MINUTE)");
    $st->execute([$student['id'], $kind]);
    if ((int)$st->fetchColumn() > 0) return 'skipped';

    $venueName = $student['venue_name'] ?? ($student['venue_id'] ?? '教室');
    $vars = [
        'name'    => $student['name'] ?: 'お子様',
        'time'    => date('n月j日 G:i'),
        'venue'   => $venueName,
        'minutes' => format_minutes($minutes),
    ];

    $subject = fill_template(mail_setting($kind === 'in' ? 'mail_subject_in' : 'mail_subject_out'), $vars);
    $body    = fill_template(mail_setting($kind === 'in' ? 'mail_body_in' : 'mail_body_out'), $vars);

    return send_mail($to, $subject, $body, $error) ? 'sent' : 'failed';
}
