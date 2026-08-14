<?php
/* ============================================================
   お知らせ・コラム
   ------------------------------------------------------------
   2026-08-14 追加（ご発注分）。

   ■ 誰が書けるか
     ・運営者 … いつでも書けます
     ・先生   … 運営者が「書ける」に設定した人だけ（users.can_post）
     ・生徒   … 読むだけ

   ■ 誰に見えるか
     記事ごとに「全体向け」か「この教場向け」かを決めます。
     教場向けの記事は、その教場の人と運営者だけに見えます。
     先生も、自分の教場の記事しか読めません（Bのご指定と同じ考え方）。

   ■ 下書き
     published が 0 のあいだは、書いた本人と運営者にしか見えません。
   ============================================================ */
declare(strict_types=1);
require __DIR__ . '/../lib.php';

$me = require_login();

/**
 * お知らせを書いてよい人か。
 * 役割だけでは決まらず、先生は1人ずつの設定を見ます。
 */
function can_write_post(array $me): bool
{
    if (!can($me, 'writePost')) return false;
    if ($me['role'] === ROLE_ADMIN) return true;
    return (int)($me['can_post'] ?? 0) === 1;
}

/** その記事を読んでよいか */
function can_read_post(array $me, array $post): bool
{
    if ($me['role'] === ROLE_ADMIN) return true;
    // 下書きは、書いた本人だけ
    if ((int)$post['published'] === 0) {
        return (int)$post['author_id'] === (int)$me['id'];
    }
    if ($post['venue_id'] === null || $post['venue_id'] === '') return true;
    return $post['venue_id'] === ($me['venue_id'] ?? null);
}

/** その記事を直してよいか。自分が書いたものか、運営者なら何でも */
function can_edit_post(array $me, array $post): bool
{
    if ($me['role'] === ROLE_ADMIN) return true;
    if (!can_write_post($me)) return false;
    return (int)$post['author_id'] === (int)$me['id'];
}

function find_post(int $id): ?array
{
    $st = db()->prepare('SELECT * FROM posts WHERE id = ?');
    $st->execute([$id]);
    return $st->fetch() ?: null;
}

function post_view(array $p, array $cats, array $venueNames = []): array
{
    return [
        'id'        => (int)$p['id'],
        'title'     => $p['title'],
        'body'      => $p['bodytext'],
        'category'  => $p['category_id'] === null ? null : (int)$p['category_id'],
        'categoryName' => $p['category_id'] !== null && isset($cats[(int)$p['category_id']])
                          ? $cats[(int)$p['category_id']] : '',
        'venue'     => $p['venue_id'] ?? '',
        'venueName' => $p['venue_id'] !== null && isset($venueNames[$p['venue_id']])
                       ? $venueNames[$p['venue_id']] : '',
        'author'    => $p['author_name'],
        'authorId'  => $p['author_id'] === null ? null : (int)$p['author_id'],
        'pinned'    => (int)$p['pinned'] === 1,
        'published' => (int)$p['published'] === 1,
        'createdAt' => $p['created_at'],
        'updatedAt' => $p['updated_at'],
    ];
}

function categories(): array
{
    $out = [];
    foreach (db()->query('SELECT id, name FROM post_categories') as $r) {
        $out[(int)$r['id']] = $r['name'];
    }
    return $out;
}

/* ============================================================
   取り出す
   ------------------------------------------------------------
   一覧をまるごと返します。件数が多くないことと、
   通信が無くても読めるよう端末に控えを持たせるためです。
   ============================================================ */
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    $cats = categories();
    $venueNames = [];
    foreach (db()->query('SELECT id, name FROM venues') as $r) $venueNames[$r['id']] = $r['name'];

    $rows = db()->query(
        'SELECT * FROM posts
          ORDER BY pinned DESC, created_at DESC, id DESC')->fetchAll();

    $list = [];
    foreach ($rows as $p) {
        if (!can_read_post($me, $p)) continue;
        $list[] = post_view($p, $cats, $venueNames);
    }

    $catList = [];
    foreach (db()->query('SELECT id, name, sort_order FROM post_categories
                           ORDER BY sort_order, id') as $r) {
        $catList[] = ['id' => (int)$r['id'], 'name' => $r['name'],
                      'order' => (int)$r['sort_order']];
    }

    /*
     * 出す先に選べる教場。
     * 先生には自分の教場だけを返します。画面側で選べないようにするだけでなく、
     * そもそも渡さないことで、よその教場の名前も見えないようにしています。
     */
    $venues = [];
    if (can_write_post($me)) {
        $sql = 'SELECT id, name FROM venues';
        $args = [];
        if ($me['role'] !== ROLE_ADMIN) {
            $sql .= ' WHERE id = ?';
            $args[] = $me['venue_id'];
        }
        $sql .= ' ORDER BY id';
        $st = db()->prepare($sql);
        $st->execute($args);
        $venues = $st->fetchAll();
    }

    ok([
        'posts'      => $list,
        'categories' => $catList,
        'venues'     => $venues,
        'canWrite'   => can_write_post($me),
        'canManage'  => can($me, 'managePosts'),
    ]);
}

/* ============================================================
   書く・直す・消す
   ============================================================ */
require_post();
$in = body();
$do = (string)($in['do'] ?? '');

/* ---------- 分類（運営者だけ） ---------- */
if ($do === 'addCategory' || $do === 'renameCategory' || $do === 'deleteCategory'
    || $do === 'sortCategory') {
    require_can($me, 'managePosts');

    if ($do === 'addCategory') {
        $name = trim((string)($in['name'] ?? ''));
        if ($name === '' || mb_strlen($name) > 20) fail(400, '分類の名前は1〜20文字にしてください。');
        $n = (int)db()->query('SELECT COUNT(*) FROM post_categories')->fetchColumn();
        if ($n >= 20) fail(400, '分類は20個までにしてください。');
        $st = db()->prepare('INSERT INTO post_categories (name, sort_order) VALUES (?, ?)');
        $st->execute([$name, ($n + 1) * 10]);
        /*
         * IDは監査ログを書く前に取ります。
         * audit() も INSERT なので、あとに回すと
         * ログ側のIDが返ってしまいます。
         */
        $newCat = (int)db()->lastInsertId();
        audit($me, 'post.category.add', $name);
        ok(['id' => $newCat]);
    }

    $id = (int)($in['id'] ?? 0);
    if ($id <= 0) fail(400, '分類が指定されていません。');

    if ($do === 'renameCategory') {
        $name = trim((string)($in['name'] ?? ''));
        if ($name === '' || mb_strlen($name) > 20) fail(400, '分類の名前は1〜20文字にしてください。');
        $st = db()->prepare('UPDATE post_categories SET name = ? WHERE id = ?');
        $st->execute([$name, $id]);
        audit($me, 'post.category.rename', (string)$id, $name);
        ok(true);
    }
    if ($do === 'sortCategory') {
        $st = db()->prepare('UPDATE post_categories SET sort_order = ? WHERE id = ?');
        $st->execute([(int)($in['order'] ?? 0), $id]);
        ok(true);
    }
    /*
     * 消しても記事は消えません。その記事の分類が「なし」になるだけです
     * （schema.sql の ON DELETE SET NULL）。
     */
    $st = db()->prepare('DELETE FROM post_categories WHERE id = ?');
    $st->execute([$id]);
    audit($me, 'post.category.delete', (string)$id);
    ok(true);
}

/* ---------- 書ける先生の指定（運営者だけ） ---------- */
if ($do === 'setWriter') {
    require_can($me, 'managePosts');
    $id = (int)($in['id'] ?? 0);
    $on = !empty($in['on']);

    $st = db()->prepare('SELECT id, role FROM users WHERE id = ?');
    $st->execute([$id]);
    $u = $st->fetch();
    if (!$u) fail(404, 'その利用者が見つかりません。');
    if ($u['role'] !== ROLE_TEACHER) fail(400, '先生にだけ指定できます。');

    $st = db()->prepare('UPDATE users SET can_post = ? WHERE id = ?');
    $st->execute([$on ? 1 : 0, $id]);
    audit($me, 'post.writer', (string)$id, $on ? 'on' : 'off');
    ok(['id' => $id, 'canPost' => $on]);
}

/* ---------- 記事 ---------- */
if (!can_write_post($me)) fail(403, 'お知らせを書く権限がありません。');

if ($do === 'save') {
    $id    = (int)($in['id'] ?? 0);
    $title = trim((string)($in['title'] ?? ''));
    $bodyt = (string)($in['body'] ?? '');
    if ($title === '' || mb_strlen($title) > 120) fail(400, '題名は1〜120文字にしてください。');
    if (mb_strlen($bodyt) > 8000) fail(400, '本文が長すぎます（8000文字まで）。');

    $cat = isset($in['category']) && $in['category'] !== null && $in['category'] !== ''
           ? (int)$in['category'] : null;
    if ($cat !== null) {
        $st = db()->prepare('SELECT COUNT(*) FROM post_categories WHERE id = ?');
        $st->execute([$cat]);
        if ((int)$st->fetchColumn() === 0) fail(400, 'その分類はありません。');
    }

    /*
     * 出す先の教場。
     * 先生は自分の教場向けか全体向けかしか選べません。
     * よその教場に出せてしまうと、Bのご指定と食い違うためです。
     */
    $venue = isset($in['venue']) && $in['venue'] !== '' ? (string)$in['venue'] : null;
    if ($venue !== null) {
        $st = db()->prepare('SELECT COUNT(*) FROM venues WHERE id = ?');
        $st->execute([$venue]);
        if ((int)$st->fetchColumn() === 0) fail(400, 'その教場はありません。');
        if ($me['role'] !== ROLE_ADMIN && $venue !== ($me['venue_id'] ?? null)) {
            fail(403, '自分の教場か、全体向けかを選んでください。');
        }
    }

    $pinned    = !empty($in['pinned']) ? 1 : 0;
    $published = array_key_exists('published', $in) ? (!empty($in['published']) ? 1 : 0) : 1;

    if ($id > 0) {
        $p = find_post($id);
        if (!$p) fail(404, 'その記事が見つかりません。');
        if (!can_edit_post($me, $p)) fail(403, 'この記事を直す権限がありません。');
        $st = db()->prepare(
            'UPDATE posts SET title = ?, bodytext = ?, category_id = ?, venue_id = ?,
                              pinned = ?, published = ? WHERE id = ?');
        $st->execute([$title, $bodyt, $cat, $venue, $pinned, $published, $id]);
        audit($me, 'post.update', (string)$id, $title);
        ok(['id' => $id]);
    }

    $st = db()->prepare(
        'INSERT INTO posts (title, bodytext, category_id, venue_id, author_id, author_name,
                            pinned, published)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    $st->execute([$title, $bodyt, $cat, $venue, (int)$me['id'], (string)$me['name'],
                  $pinned, $published]);
    $newId = (int)db()->lastInsertId();
    audit($me, 'post.create', (string)$newId, $title);
    ok(['id' => $newId]);
}

if ($do === 'delete') {
    $id = (int)($in['id'] ?? 0);
    $p  = find_post($id);
    if (!$p) fail(404, 'その記事が見つかりません。');
    if (!can_edit_post($me, $p)) fail(403, 'この記事を消す権限がありません。');
    $st = db()->prepare('DELETE FROM posts WHERE id = ?');
    $st->execute([$id]);
    audit($me, 'post.delete', (string)$id, $p['title']);
    ok(true);
}

if ($do === 'pin') {
    $id = (int)($in['id'] ?? 0);
    $p  = find_post($id);
    if (!$p) fail(404, 'その記事が見つかりません。');
    if (!can_edit_post($me, $p)) fail(403, 'この記事を直す権限がありません。');
    $on = !empty($in['on']);
    $st = db()->prepare('UPDATE posts SET pinned = ? WHERE id = ?');
    $st->execute([$on ? 1 : 0, $id]);
    ok(['id' => $id, 'pinned' => $on]);
}

fail(400, '知らない操作です。');
