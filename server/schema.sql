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
