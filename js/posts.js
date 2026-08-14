/* ============================================================
   お知らせ・コラム（2026-08-14 追加）
   ------------------------------------------------------------
   ■ 通信が無くても読めます
     一度受け取った記事は端末に控えます。次からは、まず控えを
     出してから、つながっていれば裏で新しいものに入れかえます。
     電波の悪い教場でも、開いた瞬間に読める状態にするためです。

   ■ 「新しい記事の印」は生徒さんごとです
     読んだ記事のIDを学習の記録（Store.data.readPosts）に入れます。
     記録はサーバーと行き来しますので、教場でも自宅でも同じように
     「まだ読んでいないもの」が分かります。

   ■ 誰が何を見られるかは、サーバー側が決めます
     ここでの出し分けは見た目だけです。本当の判定は
     server/api/posts.php にあります。
   ============================================================ */

'use strict';

const Posts = {
  /* 端末に残す控えの名前。記録とは別に持ちます */
  key: 'manabi-card-posts',

  list: [],
  categories: [],
  venues: [],
  canWrite: false,
  canManage: false,
  loaded: false,

  /** 端末の控えを読みます（通信の前に、まずこれを出します） */
  readCache() {
    try {
      const v = JSON.parse(localStorage.getItem(this.key));
      if (!v || !Array.isArray(v.posts)) return false;
      this.list = v.posts;
      this.categories = v.categories || [];
      this.venues = v.venues || [];
      return true;
    } catch (e) {
      return false;
    }
  },

  writeCache() {
    try {
      localStorage.setItem(this.key,
        JSON.stringify({ posts: this.list, categories: this.categories,
                         venues: this.venues }));
    } catch (e) { /* 残せなくても読むことはできます */ }
  },

  /**
   * サーバーから取り直します。
   * つながらないときは控えのままにして、例外は投げません。
   * お知らせが読めないだけで学習を止めたくないためです。
   */
  async load() {
    this.loaded = this.readCache() || this.loaded;
    if (!Remote.enabled) return false;
    try {
      const r = await Remote.posts();
      this.list = r.posts || [];
      this.categories = r.categories || [];
      this.venues = r.venues || [];
      this.canWrite = !!r.canWrite;
      this.canManage = !!r.canManage;
      this.loaded = true;
      this.writeCache();
      return true;
    } catch (e) {
      return false;
    }
  },

  /** まだ読んでいない記事の数 */
  unreadCount() {
    const read = (Store.data && Store.data.readPosts) || [];
    return this.list.filter((p) => p.published && read.indexOf(p.id) === -1).length;
  },

  isUnread(post) {
    const read = (Store.data && Store.data.readPosts) || [];
    return post.published && read.indexOf(post.id) === -1;
  },

  /** 読んだことにします。すでに読んでいれば何もしません */
  markRead(id) {
    if (!Store.data) return;
    if (!Array.isArray(Store.data.readPosts)) Store.data.readPosts = [];
    if (Store.data.readPosts.indexOf(id) !== -1) return;
    Store.data.readPosts.push(id);
    Store.save();
  },

  /*
   * 端末の控えを捨てます。
   * 前の人が見ていた記事（下書きや、その人の教場だけのお知らせ）を
   * 次の人に見せてしまわないためです。
   */
  clearCache() {
    this.list = [];
    this.categories = [];
    this.venues = [];
    this.canWrite = false;
    this.canManage = false;
    this.loaded = false;
    try { localStorage.removeItem(this.key); } catch (e) { /* 消せなくても続行 */ }
  },

  find(id) {
    return this.list.filter((p) => p.id === id)[0] || null;
  },

  categoryName(id) {
    const c = this.categories.filter((x) => x.id === id)[0];
    return c ? c.name : '';
  },
};

/* 別の人がログインしたら、端末に控えたお知らせも捨てます */
Backend.onuserchange = () => Posts.clearCache();

/* ============================================================
   一覧
   ============================================================ */

let postFilterId = 'all';     // 'all' またはお知らせの分類のID
let postEditingId = 0;        // 0 のときは新しく書くところ

function renderPostsCta() {
  const cta = $('postsCta');
  if (!cta) return;
  /*
   * サーバーにつないでいないときは出しません。
   * 第1段階のまま使っている場合に、押しても何も無い入口を
   * 見せてしまわないようにするためです。
   */
  cta.hidden = !Remote.enabled;
  if (cta.hidden) return;

  const n = Posts.unreadCount();
  const badge = $('postsCtaBadge');
  badge.hidden = n === 0;
  badge.textContent = n ? `${n}件` : '';
  $('postsCtaSub').textContent = n
    ? 'まだ読んでいないお知らせがあります'
    : '教室からのお知らせを読めます';
  cta.classList.toggle('is-active', n > 0);
}

function renderPostFilter() {
  const wrap = $('postFilter');
  const used = {};
  Posts.list.forEach((p) => { if (p.category) used[p.category] = true; });

  const btns = [{ id: 'all', name: 'すべて' }]
    .concat(Posts.categories.filter((c) => used[c.id]));

  // 分類が1つも使われていないときは、しぼりこみ自体を隠します
  $('postFilterWrap').hidden = btns.length <= 1;

  wrap.innerHTML = '';
  btns.forEach((c) => {
    const b = document.createElement('button');
    b.textContent = c.name;
    b.dataset.cat = String(c.id);
    if (String(c.id) === String(postFilterId)) b.className = 'is-on';
    b.onclick = () => { postFilterId = c.id; renderPostFilter(); renderPostList(); };
    wrap.appendChild(b);
  });
}

function postDateLabel(s) {
  // '2026-08-14 10:00:00' → '8月14日'
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return `${Number(m[2])}月${Number(m[3])}日`;
}

function renderPostList() {
  const box = $('postList');
  box.innerHTML = '';

  const rows = Posts.list.filter(
    (p) => postFilterId === 'all' || p.category === postFilterId);

  $('postEmpty').hidden = rows.length > 0;
  $('postNew').hidden = !Posts.canWrite;
  $('postManageLink').hidden = !Posts.canManage;

  rows.forEach((p) => {
    const row = document.createElement('button');
    row.className = 'post-row';
    if (p.pinned) row.classList.add('post-row--pinned');
    if (!p.published) row.classList.add('post-row--draft');

    const head = document.createElement('div');
    head.className = 'post-row__head';

    if (Posts.isUnread(p)) {
      const dot = document.createElement('span');
      dot.className = 'post-row__new';
      dot.textContent = 'NEW';
      head.appendChild(dot);
    }
    if (p.pinned) {
      const pin = document.createElement('span');
      pin.className = 'post-row__pin';
      pin.textContent = '📌';
      head.appendChild(pin);
    }
    const t = document.createElement('span');
    t.className = 'post-row__title';
    t.textContent = p.title;
    head.appendChild(t);
    row.appendChild(head);

    const meta = document.createElement('div');
    meta.className = 'post-row__meta';
    const bits = [postDateLabel(p.createdAt)];
    if (p.categoryName) bits.push(p.categoryName);
    if (p.venue) bits.push((p.venueName || p.venue) + '向け');
    if (!p.published) bits.push('下書き');
    meta.textContent = bits.filter(Boolean).join('　・　');
    row.appendChild(meta);

    row.onclick = () => openPost(p.id);
    box.appendChild(row);
  });
}

/* ============================================================
   本文
   ============================================================ */

function openPost(id) {
  const p = Posts.find(id);
  if (!p) return;

  const bits = [postDateLabel(p.createdAt)];
  if (p.categoryName) bits.push(p.categoryName);
  if (p.author) bits.push(p.author);
  if (p.venue) bits.push((p.venueName || p.venue) + '向け');
  if (!p.published) bits.push('下書き');
  $('postOneMeta').textContent = bits.filter(Boolean).join('　・　');
  $('postOneTitle').textContent = p.title;

  /*
   * 本文は textContent で入れます。
   * 記事はHTMLとしては扱いません。書いた人がタグを入れても
   * そのまま文字として出ます（画面を壊されないためです）。
   */
  const body = $('postOneBody');
  body.innerHTML = '';
  String(p.body).split('\n').forEach((line) => {
    const el = document.createElement('p');
    el.textContent = line;
    body.appendChild(el);
  });

  // 自分が書いたものか、運営者なら直せます
  const mine = Auth.me && Auth.me.id && p.authorId === Auth.me.id;
  $('postEditThis').hidden = !(Posts.canManage || (Posts.canWrite && mine));
  $('postEditThis').onclick = () => openPostEdit(p.id);

  Posts.markRead(p.id);
  show('post', 'お知らせ');
  renderPostsCta();
}

/* ============================================================
   書く・直す
   ============================================================ */

function renderPostCategoryOptions(sel) {
  const el = $('postCategory');
  el.innerHTML = '<option value="">分類なし</option>';
  Posts.categories.forEach((c) => {
    const o = document.createElement('option');
    o.value = String(c.id);
    o.textContent = c.name;
    el.appendChild(o);
  });
  el.value = sel ? String(sel) : '';
}

function renderPostVenueOptions(sel) {
  const el = $('postVenue');
  el.innerHTML = '<option value="">全体向け（すべての教場）</option>';

  /*
   * 先生は、自分の教場か全体向けかしか選べません。
   * よその教場へ出せてしまうと、
   * 「先生は自分の教場だけ」というご指定と食い違うためです。
   */
  // 選べる教場はサーバーが決めます（先生には自分の教場だけが返ります）
  Posts.venues.forEach((v) => {
    const o = document.createElement('option');
    o.value = v.id;
    o.textContent = v.name + '向け';
    el.appendChild(o);
  });
  el.value = sel || '';
}

function openPostEdit(id) {
  postEditingId = id || 0;
  const p = id ? Posts.find(id) : null;

  $('postEditTitle').textContent = p ? 'お知らせを直す' : 'お知らせを書く';
  $('postTitle').value = p ? p.title : '';
  $('postBody').value = p ? p.body : '';
  $('postPinned').checked = p ? p.pinned : false;
  $('postPublished').checked = p ? p.published : true;
  renderPostCategoryOptions(p ? p.category : '');
  renderPostVenueOptions(p ? p.venue : '');
  $('postDelete').hidden = !p;
  $('postEditResult').textContent = '';

  show('postEdit', p ? 'お知らせを直す' : 'お知らせを書く');
}

/* ============================================================
   分類と、書ける先生の設定（運営者だけ）
   ============================================================ */

function renderPostCategoryManage() {
  const box = $('postCatList');
  box.innerHTML = '';
  if (!Posts.categories.length) {
    box.appendChild(el('p', 'note', '分類がありません。下から足せます。'));
    return;
  }
  Posts.categories.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'cat-row';

    const name = document.createElement('span');
    name.className = 'cat-row__name';
    name.textContent = c.name;
    row.appendChild(name);

    const rename = document.createElement('button');
    rename.className = 'text-link text-link--slim';
    rename.textContent = '名前を変える';
    rename.onclick = async () => {
      const v = prompt('新しい名前', c.name);
      if (v === null) return;
      const name2 = v.trim();
      if (!name2) return;
      try {
        await Remote.renamePostCategory(c.id, name2);
        await Posts.load();
        renderPostCategoryManage(); renderPostFilter(); renderPostList();
        toast('名前を変えました');
      } catch (e) { toast(e.message); }
    };
    row.appendChild(rename);

    const del = document.createElement('button');
    del.className = 'text-link text-link--slim';
    del.textContent = '消す';
    del.onclick = async () => {
      if (!confirm(`「${c.name}」を消します。\n記事は消えません（分類なしになります）。`)) return;
      try {
        await Remote.deletePostCategory(c.id);
        await Posts.load();
        renderPostCategoryManage(); renderPostFilter(); renderPostList();
        toast('消しました');
      } catch (e) { toast(e.message); }
    };
    row.appendChild(del);

    box.appendChild(row);
  });
}

async function renderPostWriters() {
  const box = $('postWriterList');
  box.innerHTML = '';
  let users = [];
  try {
    users = (await Remote.accounts()).users || [];
  } catch (e) {
    box.appendChild(el('p', 'note', '先生の一覧を取り出せませんでした。'));
    return;
  }
  const teachers = users.filter((u) => u.role === 'teacher');
  if (!teachers.length) {
    box.appendChild(el('p', 'note', '先生のアカウントがまだありません。'));
    return;
  }
  teachers.forEach((t) => {
    const row = document.createElement('label');
    row.className = 'check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!t.canPost;
    cb.onchange = async () => {
      try {
        await Remote.setPostWriter(t.id, cb.checked);
        toast(cb.checked ? '書けるようにしました' : '書けないようにしました');
      } catch (e) {
        cb.checked = !cb.checked;
        toast(e.message);
      }
    };
    row.appendChild(cb);
    row.appendChild(el('span', '',
      `${t.name || t.loginId}${t.venueName ? '（' + t.venueName + '）' : ''}`));
    box.appendChild(row);
  });
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/* ============================================================
   画面のつなぎこみ
   ============================================================ */

async function openPosts() {
  show('posts', 'お知らせ・コラム');
  $('postManageCard').hidden = true;
  renderPostFilter();
  renderPostList();
  await Posts.load();
  renderPostFilter();
  renderPostList();
  renderPostsCta();
}

$('postsCta').onclick = () => openPosts();
$('postNew').onclick = () => openPostEdit(0);

$('postManageLink').onclick = () => {
  const card = $('postManageCard');
  card.hidden = !card.hidden;
  if (!card.hidden) {
    renderPostCategoryManage();
    renderPostWriters();
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};

$('postCatAdd').onclick = async () => {
  const name = $('postCatNew').value.trim();
  if (!name) { toast('分類の名前を入れてください'); return; }
  try {
    await Remote.addPostCategory(name);
    $('postCatNew').value = '';
    await Posts.load();
    renderPostCategoryManage(); renderPostFilter(); renderPostList();
    toast('分類を足しました');
  } catch (e) { toast(e.message); }
};

$('postSave').onclick = async () => {
  const title = $('postTitle').value.trim();
  const bodyt = $('postBody').value;
  if (!title) { $('postEditResult').textContent = '題名を入れてください。'; return; }

  const v = {
    id: postEditingId,
    title,
    body: bodyt,
    category: $('postCategory').value ? Number($('postCategory').value) : null,
    venue: $('postVenue').value,
    pinned: $('postPinned').checked,
    published: $('postPublished').checked,
  };
  try {
    await Remote.savePost(v);
    await Posts.load();
    toast(postEditingId ? '直しました' : '書きました');
    await openPosts();
  } catch (e) {
    $('postEditResult').textContent = e.message;
  }
};

$('postDelete').onclick = async () => {
  if (!postEditingId) return;
  if (!confirm('この記事を消します。もとに戻せません。')) return;
  try {
    await Remote.deletePost(postEditingId);
    await Posts.load();
    toast('消しました');
    await openPosts();
  } catch (e) {
    $('postEditResult').textContent = e.message;
  }
};
