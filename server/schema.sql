-- ============================================================
--  SJ式 学習アプリ　第2段階のデータベース
--  ------------------------------------------------------------
--  2026-08-11 作成。Xサーバーの MySQL / MariaDB で動かす前提です。
--
--  役割のご指定（A〜G）にそのまま対応しています。
--    A 生徒はアカウントを持つ            → users
--    B 先生は自分の教場の生徒だけ        → users.venue_id で絞る
--    C 先生は個人情報を見られない        → 取り出すときに列を出さない
--    D 先生アカウントの発行は運営者だけ  → 権限の判定はPHP側
--    E 保護者はメールのみ                → users.parent_email
--    F 運営者は佐藤様おひとり            → role='admin' を1件だけ
--    G 在籍・休塾・退塾                  → users.enroll
--
--  文字コードは utf8mb4 にします。絵文字を含むニックネームでも
--  文字化けしないためです。
-- ============================================================

SET NAMES utf8mb4;

-- ---------- 教場 ----------
CREATE TABLE IF NOT EXISTS venues (
  id          VARCHAR(32)  NOT NULL PRIMARY KEY,   -- 'main' など。QRの合言葉と同じ
  name        VARCHAR(100) NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 利用者（生徒・先生・運営者） ----------
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  login_id      VARCHAR(64)  NOT NULL,             -- ログインに使う文字列
  password_hash VARCHAR(255) NOT NULL,             -- password_hash() の結果。生のパスワードは持ちません
  role          ENUM('student','teacher','admin') NOT NULL DEFAULT 'student',
  name          VARCHAR(100) NOT NULL DEFAULT '',  -- 氏名（C：先生には渡しません）
  kana          VARCHAR(100) NOT NULL DEFAULT '',
  venue_id      VARCHAR(32)  NULL,                 -- 所属する教場。運営者は NULL
  enroll        ENUM('active','paused','left') NOT NULL DEFAULT 'active',
  parent_email  VARCHAR(255) NOT NULL DEFAULT '',  -- E：保護者への通知先
  note          VARCHAR(255) NOT NULL DEFAULT '',
  enroll_changed_at DATE     NULL,                 -- G：状態を変えた日
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_login (login_id),
  KEY idx_venue_enroll (venue_id, enroll),         -- B と G の絞りこみを速くします
  CONSTRAINT fk_users_venue FOREIGN KEY (venue_id) REFERENCES venues(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 学習の記録 ----------
-- アプリが持っている記録をまるごと預かります。
-- 中身の形はアプリ側（js/storage.js）が決めるので、ここでは触りません。
-- 集計に使う値だけ、取り出しやすいように別の列にも持っておきます。
CREATE TABLE IF NOT EXISTS records (
  user_id      INT UNSIGNED NOT NULL PRIMARY KEY,
  payload      LONGTEXT     NOT NULL,              -- 記録そのもの（JSON）
  answered     INT UNSIGNED NOT NULL DEFAULT 0,    -- のべ解答数
  correct      INT UNSIGNED NOT NULL DEFAULT 0,    -- 正解数
  last_studied DATE         NULL,                  -- 最後に学習した日
  rev          INT UNSIGNED NOT NULL DEFAULT 0,    -- 版番号。保存のたびに1つ進みます
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_records_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 出入りの記録（監査用） ----------
-- 誰がいつ何をしたかを残します。個人情報を扱う以上、
-- 「見た・変えた」の跡が残る状態にしておくべきだからです。
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_id   INT UNSIGNED NULL,
  action     VARCHAR(64)  NOT NULL,
  target     VARCHAR(64)  NOT NULL DEFAULT '',
  detail     VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 入退室の記録（2026-08-11 追加） ----------
-- 保護者へのお知らせに使います。誰がいつ入って、いつ出たか。
CREATE TABLE IF NOT EXISTS attendance (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  venue_id   VARCHAR(32)  NULL,
  kind       ENUM('in','out') NOT NULL,
  happened_at DATETIME    NOT NULL,
  minutes    INT UNSIGNED NULL,               -- 退室のときだけ。その回の勉強時間
  mail_state ENUM('none','sent','failed','skipped') NOT NULL DEFAULT 'none',
  mail_error VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_time (user_id, happened_at),
  CONSTRAINT fk_att_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 設定（2026-08-11 追加） ----------
-- 運営者が画面から変えられる値を入れます。メールの文面など。
CREATE TABLE IF NOT EXISTS settings (
  name       VARCHAR(64)  NOT NULL PRIMARY KEY,
  value      TEXT         NOT NULL,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
--  2026-08-12 の追加
--  ------------------------------------------------------------
--  ・学年と入塾日（佐藤様のご要望）
--  ・アプリを使えるかどうかを、在籍の状態とは切り離して生徒ごとに持つ
--    （休塾の定義を後から決められるようにするため）
--  ・保護者を複数登録できるようにする（父母・祖母など）
--
--  すでに動いているデータベースにも当てられるよう、
--  ALTER は setup.php 側で「無ければ足す」形にしています。
-- ============================================================

-- ---------- 保護者（1人の生徒に何人でも） ----------
CREATE TABLE IF NOT EXISTS guardians (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,               -- どの生徒の保護者か
  name       VARCHAR(100) NOT NULL DEFAULT '',    -- お名前（任意）
  relation   VARCHAR(32)  NOT NULL DEFAULT '',    -- 続柄（母・父・祖母など）
  email      VARCHAR(255) NOT NULL,
  -- 入退室のお知らせも送るか。祖母には大事な連絡だけ、という使い分けのため
  notify_attendance TINYINT(1) NOT NULL DEFAULT 1,
  -- 配信を止めるための合言葉。お知らせメールの末尾のリンクに入れます
  unsub_token CHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user (user_id),
  CONSTRAINT fk_guardian_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 保護者へ送ったご連絡の控え ----------
CREATE TABLE IF NOT EXISTS messages (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sender_id  INT UNSIGNED NULL,                   -- 送った人（運営者）
  subject    VARCHAR(200) NOT NULL,
  bodytext   TEXT         NOT NULL,
  scope      VARCHAR(64)  NOT NULL DEFAULT '',    -- 個別／一斉のしぼりこみ条件の控え
  sent_count INT UNSIGNED NOT NULL DEFAULT 0,
  fail_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- お知らせ・コラムの分類 ----------
-- 「重要」「事務連絡」などの区分です。運営者が追加・変更・削除できます。
CREATE TABLE IF NOT EXISTS post_categories (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(40)  NOT NULL,
  sort_order INT          NOT NULL DEFAULT 0,     -- 一覧での並び順
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- お知らせ・コラムの記事 ----------
CREATE TABLE IF NOT EXISTS posts (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title       VARCHAR(120) NOT NULL,
  bodytext    TEXT         NOT NULL,
  category_id INT UNSIGNED NULL,                  -- 分類。消された分類は NULL になります
  -- どの教場に出すか。NULL なら全体向けです
  venue_id    VARCHAR(32)  NULL,
  author_id   INT UNSIGNED NULL,                  -- 書いた人
  author_name VARCHAR(100) NOT NULL DEFAULT '',   -- 書いた人が消えても表示できるよう控えます
  pinned      TINYINT(1)   NOT NULL DEFAULT 0,    -- 一番上に固定するか
  published   TINYINT(1)   NOT NULL DEFAULT 1,    -- 下書きのあいだは 0
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_list (published, pinned, created_at),
  KEY idx_venue (venue_id),
  CONSTRAINT fk_post_category FOREIGN KEY (category_id) REFERENCES post_categories(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- パスワードの再設定 ----------
-- 「パスワードを忘れたとき」に発行する、使い捨ての合言葉です。
-- 合言葉そのものは残さず、ハッシュだけを持ちます。
-- 万一この表が漏れても、そこから再設定はできません。
CREATE TABLE IF NOT EXISTS password_resets (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  token_hash CHAR(64)     NOT NULL,          -- sha256。合言葉そのものは保存しません
  expires_at DATETIME     NOT NULL,
  used_at    DATETIME     NULL,              -- 一度使ったら二度目は通しません
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_token (token_hash),
  KEY idx_user_time (user_id, created_at),   -- 短時間に何度も申請されていないかを見ます
  CONSTRAINT fk_reset_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
