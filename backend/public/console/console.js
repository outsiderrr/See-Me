// Fathom（潜心）控制台（A 端）。Vanilla JS，纸页设计。
// 这里是"发布决策"发生的地方：给一条笔记打标签，就是决定它可能被谁看到。
// 无标签的笔记匹配不上任何分享的必含集 ⇒ 任何卡都看不到（v2 §1 决策 7）。
const TOKEN_KEY = 'fathom_console_token';
const getToken = () => localStorage.getItem(TOKEN_KEY);
const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
const clearToken = () => localStorage.removeItem(TOKEN_KEY);

async function api(path, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
  const t = getToken();
  if (t) headers.Authorization = 'Bearer ' + t;
  const res = await fetch(path, { ...opts, headers });
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
}
const get = (p) => api(p);
const post = (p, b) => api(p, { method: 'POST', body: JSON.stringify(b) });
const patch = (p, b) => api(p, { method: 'PATCH', body: JSON.stringify(b) });
const put = (p, b) => api(p, { method: 'PUT', body: JSON.stringify(b) });
const del = (p) => api(p, { method: 'DELETE' });

const app = () => document.getElementById('app');
const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 同 B 端的 markdown 配置：html:false 防 XSS，image 语法禁用——作者不该能借
// 外链图片收集读者访问信号（红线 #4），控制台预览必须和读者端所见一致。
const md = window.markdownit({ html: false, breaks: true, linkify: true });
md.disable('image');

const state = { me: null, tags: [], view: 'library', tagId: null, q: '', tagQ: '' };

/* ---------------- 登录 ---------------- */

function renderGate() {
  app().innerHTML = '';
  let phase = 'phone';
  let phone = '';
  const v = el(`
    <div class="gate">
      <div class="mark">Fathom</div>
      <div class="sub">控制台 —— 写、审、决定谁能看见。</div>
      <input id="phone" class="field" placeholder="手机号" inputmode="tel" autocomplete="tel" />
      <div id="codeRow" style="display:none"><input id="code" class="field" placeholder="6 位验证码" inputmode="numeric" /></div>
      <button id="go" class="btn">发送验证码</button>
      <div id="msg" class="note-msg"></div>
    </div>`);
  app().appendChild(v);
  const q = (id) => v.querySelector('#' + id);
  const submit = async () => {
    const msg = q('msg');
    msg.textContent = '';
    if (phase === 'phone') {
      phone = q('phone').value.trim();
      if (!/^\+?\d{8,15}$/.test(phone)) { msg.textContent = '手机号格式不对'; return; }
      const r = await post('/api/auth/request-code', { phone });
      if (r.status === 200) {
        phase = 'code'; q('codeRow').style.display = 'block'; q('go').textContent = '进入';
        q('code').focus();
      } else msg.textContent = r.status === 429 ? '太频繁了，稍后再试' : '发送失败';
    } else {
      const r = await post('/api/auth/verify', { phone, code: q('code').value.trim() });
      if (r.status === 200 && r.body?.token) { setToken(r.body.token); boot(); }
      else msg.textContent = '验证码不对';
    }
  };
  q('go').onclick = submit;
  v.querySelectorAll('.field').forEach((f) => (f.onkeydown = (e) => { if (e.key === 'Enter') submit(); }));
  q('phone').focus();
}

/* ---------------- 骨架 ---------------- */

function renderShell() {
  app().innerHTML = `
    <div class="shell">
      <aside class="side">
        <div class="mark">Fathom</div>
        <nav class="nav" id="nav"></nav>
        <div class="tagbox">
          <input id="tagsearch" class="tagsearch" placeholder="搜索或新建标签" />
          <div class="taglist" id="taglist"></div>
        </div>
        <div class="who" id="who"></div>
      </aside>
      <main class="main" id="main"></main>
    </div>`;
  drawNav();
  mountTagSearch();
  drawTagList();
  drawWho();
}

const VIEWS = [
  { id: 'library', label: '库' },
  { id: 'inbox', label: '收件箱' },
  { id: 'cards', label: '卡' },
];

function drawNav(counts = {}) {
  const nav = document.getElementById('nav');
  if (!nav) return;
  nav.innerHTML = '';
  VIEWS.forEach((v) => {
    const a = el(`<a href="#/${v.id}" class="${state.view === v.id ? 'on' : ''}">
      <span>${esc(v.label)}</span>${counts[v.id] != null ? `<span class="count">${counts[v.id]}</span>` : ''}</a>`);
    if (v.id === 'library') {
      // 已在库里再点「库」= 回到全部（清掉标签筛选）。hash 不变不会触发重绘，手动来。
      a.onclick = () => {
        if (state.view === 'library' && state.tagId) { state.tagId = null; drawTagList(); renderMain(); }
      };
    }
    nav.appendChild(a);
  });
}

/* ---------------- 左栏标签列（flomo 式：点击=浏览筛选，拖动=贴标签） ---------------- */

async function refreshTags() {
  const r = await get('/api/tags');
  if (r.status === 200) { state.tags = r.body?.tags || []; drawTagList(); }
}

function mountTagSearch() {
  const input = document.getElementById('tagsearch');
  if (!input) return;
  input.value = state.tagQ;
  input.oninput = () => { state.tagQ = input.value.trim(); drawTagList(); };
  input.onkeydown = async (e) => {
    if (e.key === 'Escape') { input.value = ''; state.tagQ = ''; drawTagList(); return; }
    if (e.key !== 'Enter') return;
    const name = input.value.trim();
    if (!name) return;
    const exact = state.tags.find((t) => t.name === name);
    if (exact) { selectTag(exact.id); return; }
    await createTagByName(name);
  };
}

async function createTagByName(name) {
  const r = await post('/api/tags', { name });
  if (r.status === 201) {
    const input = document.getElementById('tagsearch');
    if (input) { input.value = ''; state.tagQ = ''; }
    await refreshTags(); // 要计数和排序的真值，别自己拼
  } else alert(r.status === 409 ? '这个标签已经有了' : '建不了');
}

function selectTag(id) {
  state.tagId = state.tagId === id ? null : id;
  drawTagList();
  if (state.view !== 'library') { location.hash = '#/library'; return; } // hashchange 那边会重画
  renderMain();
}

function tagRow(t) {
  const row = el(`<div class="tagrow ${state.tagId === t.id ? 'on' : ''}" draggable="true" title="点击筛选，拖到右边贴标签">
      <span class="thash">#</span><span class="tname">${esc(t.icon ? t.icon + ' ' + t.name : t.name)}</span>
      <button class="pin" title="${t.isPinned ? '取消置顶' : '置顶'}">${t.isPinned ? '↓' : '置顶'}</button>
      <span class="tcount">${t.noteCount ?? ''}</span>
    </div>`);
  row.onclick = () => selectTag(t.id);
  const pin = row.querySelector('.pin');
  pin.onclick = async (e) => {
    e.stopPropagation();
    const r = await patch('/api/tags/' + encodeURIComponent(t.id), { pinned: !t.isPinned });
    if (r.status === 200) refreshTags();
  };

  // 拖动 = 把标签带去右边的某条笔记。自绘一个小拖影，比浏览器默认的整行截图轻得多。
  row.ondragstart = (e) => {
    e.dataTransfer.setData('application/x-fathom-tag', t.id);
    e.dataTransfer.setData('text/plain', t.name); // 兜底：有些环境只认 text/plain
    e.dataTransfer.effectAllowed = 'copy';
    const ghost = el(`<div class="drag-ghost">#${esc(t.name)}</div>`);
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 12, 14);
    row.classList.add('dragging');
    document.body.classList.add('tagdrag');
    row._ghost = ghost;
  };
  row.ondragend = () => {
    row.classList.remove('dragging');
    document.body.classList.remove('tagdrag');
    row._ghost?.remove();
  };
  return row;
}

function drawTagList() {
  const host = document.getElementById('taglist');
  if (!host) return;
  host.innerHTML = '';
  const q = state.tagQ.toLowerCase();
  const match = (t) => !q || t.name.toLowerCase().includes(q);
  const pinned = state.tags.filter((t) => t.isPinned && match(t));
  const rest = state.tags.filter((t) => !t.isPinned && match(t));

  if (pinned.length) {
    host.appendChild(el('<div class="taggroup">置顶标签</div>'));
    pinned.forEach((t) => host.appendChild(tagRow(t)));
  }
  if (rest.length) {
    host.appendChild(el(`<div class="taggroup">${pinned.length ? '全部标签' : '标签'}</div>`));
    rest.forEach((t) => host.appendChild(tagRow(t)));
  }
  const name = state.tagQ.trim();
  if (name && !state.tags.some((t) => t.name === name)) {
    const mk = el(`<div class="tagrow new"><span class="thash">+</span><span class="tname">回车新建「${esc(name)}」</span></div>`);
    mk.onclick = () => createTagByName(name);
    host.appendChild(mk);
  }
  if (!state.tags.length && !name) {
    host.appendChild(el('<div class="keyhint" style="padding:4px 8px">还没有标签。\n在上面输入名字回车即建。</div>'));
  }
}

function drawWho() {
  const who = document.getElementById('who');
  if (!who || !state.me) return;
  const name = state.me.displayName;
  who.innerHTML = '';
  who.appendChild(el(`<div>${name ? esc(name) : '<span style="color:var(--brick)">未设置名字</span>'}</div>`));
  const edit = el(`<button>${name ? '改名字' : '设置名字 →'}</button>`);
  edit.onclick = async () => {
    // 读者在免登录卡上看到的那一行「X 分享给你」就来自这里。没设名字 = 那行是空的。
    const next = prompt('读者会看到「XX 分享给你」，这里填 XX：', name || '');
    if (next === null) return;
    const r = await patch('/api/me', { displayName: next.trim() || null });
    if (r.status === 200) { state.me.displayName = r.body.displayName; drawWho(); }
    else alert(r.body?.error === 'too_long' ? '名字太长了（最多 24 字）' : '改不了');
  };
  who.appendChild(edit);
  const out = el('<button style="margin-left:10px">退出</button>');
  out.onclick = () => { post('/api/auth/logout', {}); clearToken(); boot(); };
  who.appendChild(out);
}

/* ---------------- 库 / 收件箱 ---------------- */

function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}
function hhmm(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function renderMain() {
  if (state.view === 'cards') return renderCardsView();
  const main = document.getElementById('main');
  const inbox = state.view === 'inbox';
  const filtered = !inbox && state.tagId ? state.tags.find((t) => t.id === state.tagId) : null;
  main.innerHTML = `
    <div class="head">
      <h1>${filtered ? `<span class="hh">#</span> ${esc(filtered.name)}` : inbox ? '收件箱' : '库'}</h1>
      <span class="hint">${inbox ? '还没打标签的笔记 —— 任何卡都看不到它们。从左边拖个标签过来即发布' : filtered ? '再点一下左边的标签回到全部' : '你写下的一切'}</span>
    </div>
    <div id="composer"></div>
    <div class="toolbar">
      <input id="q" class="search" placeholder="搜索正文…" value="${esc(state.q)}" />
    </div>
    <div id="flow" class="loading">…</div>`;

  if (!inbox) mountComposer(document.getElementById('composer'));

  const q = document.getElementById('q');
  let timer;
  q.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { state.q = q.value.trim(); loadFlow(); }, 220); };
  loadFlow();
}

async function loadFlow() {
  const flow = document.getElementById('flow');
  if (!flow) return;
  const params = new URLSearchParams();
  if (state.view === 'inbox') params.set('untagged', '1');
  else if (state.tagId) params.set('tagId', state.tagId);
  if (state.q) params.set('q', state.q);
  const r = await get('/api/notes' + (params.toString() ? '?' + params : ''));
  if (r.status === 401) { clearToken(); return boot(); }
  const notes = r.body?.notes || [];

  flow.className = '';
  flow.innerHTML = '';
  refreshCounts(); // 徽标必须在空列表分支之前刷新：清空收件箱正是它最该归零的时刻
  if (notes.length === 0) {
    flow.className = 'empty';
    flow.textContent = state.view === 'inbox'
      ? '收件箱是空的。\n导入的笔记会先落在这里，等你决定给谁看。'
      : state.q || state.tagId ? '没有匹配的笔记。' : '还什么都没写。';
    return;
  }

  let day = null;
  let group = null;
  notes.forEach((n) => {
    const k = dayKey(n.createdAt);
    if (k !== day) {
      day = k;
      group = el(`<section class="daygroup"><div class="day">${k}</div></section>`);
      flow.appendChild(group);
    }
    group.appendChild(entry(n));
  });
}

function entry(n) {
  const node = el(`<article class="entry">
      <div class="body">${md.render(n.body || '')}</div>
      <div class="foot">
        <span class="time">${hhmm(n.createdAt)}</span>
        <span class="tags"></span>
        <span class="acts"></span>
      </div>
    </article>`);
  const tagBox = node.querySelector('.tags');
  if (n.tags.length) {
    n.tags.forEach((t) => {
      const chip = el(`<span class="tag">${esc(t.name)}<button class="x" title="去掉这个标签">×</button></span>`);
      chip.querySelector('.x').onclick = () => removeTagFromNote(node, n, t.id);
      tagBox.appendChild(chip);
    });
  } else tagBox.innerHTML = '<span class="untagged">未打标签 · 任何卡都看不到</span>';

  // 接住左栏拖来的标签。dragenter/leave 在子元素间会反复触发，用 relatedTarget 兜住。
  const isTagDrag = (e) => [...(e.dataTransfer?.types || [])].includes('application/x-fathom-tag');
  node.ondragover = (e) => { if (isTagDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } };
  node.ondragenter = (e) => { if (isTagDrag(e)) node.classList.add('droptarget'); };
  node.ondragleave = (e) => { if (!node.contains(e.relatedTarget)) node.classList.remove('droptarget'); };
  node.ondrop = (e) => {
    e.preventDefault();
    node.classList.remove('droptarget');
    const tagId = e.dataTransfer.getData('application/x-fathom-tag');
    if (tagId) addTagToNote(node, n, tagId);
  };

  const acts = node.querySelector('.acts');
  const mk = (label, cls, fn) => { const b = el(`<button class="${cls}">${label}</button>`); b.onclick = fn; acts.appendChild(b); };
  mk('标签', '', () => openTagEditor(node, n));
  mk('编辑', '', () => openBodyEditor(node, n));
  mk('删除', 'del', async () => {
    if (!confirm('删掉这条？读者那边会同时消失，且不留痕迹。')) return;
    const r = await del('/api/notes/' + encodeURIComponent(n.id));
    if (r.status === 200) loadFlow();
  });
  return node;
}

/* 拖拽/点 × 的就地更新：不整页刷新，滚动位置不动。
   收件箱里贴上标签 = 这条完成审校，动画送走；库里去掉当前筛选的标签同理。 */

function removeEntryAnimated(node) {
  const group = node.closest('.daygroup');
  node.classList.add('leaving');
  setTimeout(() => {
    node.remove();
    if (group && !group.querySelector('.entry')) group.remove();
    const flow = document.getElementById('flow');
    if (flow && !flow.querySelector('.entry')) loadFlow(); // 空了让它画空态文案
  }, 200);
}

async function addTagToNote(node, n, tagId) {
  if (node.dataset.busy) return;
  if (n.tags.some((t) => t.id === tagId)) { // 已有：不打接口，抖一下示意
    node.classList.add('shake');
    setTimeout(() => node.classList.remove('shake'), 300);
    return;
  }
  node.dataset.busy = '1';
  const r = await put(`/api/notes/${encodeURIComponent(n.id)}/tags`, { tagIds: [...n.tags.map((t) => t.id), tagId] });
  delete node.dataset.busy;
  if (r.status !== 200) return alert('没贴上，再试一次');
  const updated = r.body.note;
  if (state.view === 'inbox') { removeEntryAnimated(node); refreshCounts(); }
  else node.replaceWith(entry(updated));
  refreshTags(); // 左栏计数变了
}

async function removeTagFromNote(node, n, tagId) {
  if (node.dataset.busy) return;
  node.dataset.busy = '1';
  const r = await put(`/api/notes/${encodeURIComponent(n.id)}/tags`, { tagIds: n.tags.filter((t) => t.id !== tagId).map((t) => t.id) });
  delete node.dataset.busy;
  if (r.status !== 200) return alert('没去掉，再试一次');
  const updated = r.body.note;
  if (state.view === 'library' && state.tagId === tagId) { removeEntryAnimated(node); refreshCounts(); }
  else { node.replaceWith(entry(updated)); refreshCounts(); }
  refreshTags();
}

/* ---------------- 打标签（= 发布决策） ---------------- */

async function openTagEditor(node, n) {
  const chosen = new Set(n.tags.map((t) => t.id));
  const panel = el('<div class="composer" style="margin-top:12px"><div class="picker" id="pk"></div><div class="row"><span class="grow"></span></div></div>');
  const pk = panel.querySelector('#pk');
  const row = panel.querySelector('.row');

  const redraw = () => {
    pk.innerHTML = '';
    state.tags.forEach((t) => {
      const b = el(`<button class="pick ${chosen.has(t.id) ? 'on' : ''}">${esc(t.name)}</button>`);
      b.onclick = () => { chosen.has(t.id) ? chosen.delete(t.id) : chosen.add(t.id); redraw(); };
      pk.appendChild(b);
    });
    const add = el('<button class="pick new">+ 新标签</button>');
    add.onclick = async () => {
      const name = prompt('新标签名');
      if (!name || !name.trim()) return;
      const r = await post('/api/tags', { name: name.trim() });
      if (r.status === 201) { state.tags.push(r.body.tag); chosen.add(r.body.tag.id); redraw(); refreshTags(); }
      else alert(r.status === 409 ? '这个标签已经有了' : '建不了');
    };
    pk.appendChild(add);
  };
  redraw();

  const save = el('<button class="btn small">保存</button>');
  save.onclick = async () => {
    save.disabled = true;
    const r = await put(`/api/notes/${encodeURIComponent(n.id)}/tags`, { tagIds: [...chosen] });
    if (r.status === 200) loadFlow(); else { alert('保存失败'); save.disabled = false; }
  };
  const cancel = el('<button class="btn small quiet">取消</button>');
  cancel.onclick = () => panel.remove();
  row.appendChild(cancel);
  row.appendChild(save);
  node.appendChild(panel);
}

function openBodyEditor(node, n) {
  const panel = el(`<div class="composer" style="margin-top:12px">
      <textarea>${esc(n.body)}</textarea>
      <div class="row"><span class="grow"></span></div>
    </div>`);
  const ta = panel.querySelector('textarea');
  const row = panel.querySelector('.row');
  const save = el('<button class="btn small">保存</button>');
  save.onclick = async () => {
    const body = ta.value.trim();
    if (!body) return;
    save.disabled = true;
    // 编辑只改 updated_at，不动 created_at —— 可见范围不会因为今天改旧文而变（spec §2.1）
    const r = await patch('/api/notes/' + encodeURIComponent(n.id), { body });
    if (r.status === 200) loadFlow(); else { alert('保存失败'); save.disabled = false; }
  };
  const cancel = el('<button class="btn small quiet">取消</button>');
  cancel.onclick = () => panel.remove();
  row.appendChild(cancel);
  row.appendChild(save);
  node.appendChild(panel);
  ta.focus();
}

/* ---------------- 写 ---------------- */

function mountComposer(host) {
  const chosen = new Set();
  const box = el(`<div class="composer">
      <textarea placeholder="写点什么…"></textarea>
      <div class="row"><div class="picker grow" id="pk"></div></div>
    </div>`);
  const ta = box.querySelector('textarea');
  const pk = box.querySelector('#pk');
  const row = box.querySelector('.row');

  const redraw = () => {
    pk.innerHTML = '';
    state.tags.forEach((t) => {
      const b = el(`<button class="pick ${chosen.has(t.id) ? 'on' : ''}">${esc(t.name)}</button>`);
      b.onclick = () => { chosen.has(t.id) ? chosen.delete(t.id) : chosen.add(t.id); redraw(); };
      pk.appendChild(b);
    });
  };
  redraw();

  const save = el('<button class="btn small">记下</button>');
  save.onclick = async () => {
    const body = ta.value.trim();
    if (!body) return;
    save.disabled = true;
    const r = await post('/api/notes', { body, tagIds: [...chosen] });
    save.disabled = false;
    if (r.status === 201) { ta.value = ''; chosen.clear(); redraw(); loadFlow(); }
    else alert('存不下来');
  };
  row.appendChild(save);
  host.appendChild(box);
}

/* ---------------- 卡 ---------------- */
/* 一张卡 = 一组规则，不含内容。它决定「谁能看见什么」。
   这里刻意没有、且永远不会有的东西：持卡人数、身份、兑换时间（红线 #7）。
   A 端不存在读者可见面——作废与轮换都作用于码/链接本身，不基于持有人列表。 */

const tagName = (id) => (state.tags.find((t) => t.id === id) || {}).name || '?';
const openLink = (slug) => `${location.origin}/c/${slug}`;

async function renderCardsView() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="head"><h1>卡</h1><span class="hint">谁能看见什么</span></div>
    <div id="newcard"></div>
    <div id="cardlist" class="loading">…</div>`;
  mountCardCreator(document.getElementById('newcard'));
  loadCards();
}

async function loadCards() {
  const box = document.getElementById('cardlist');
  if (!box) return;
  const r = await get('/api/cards');
  if (r.status === 401) { clearToken(); return boot(); }
  const cards = r.body?.cards || [];
  box.className = '';
  box.innerHTML = '';
  if (cards.length === 0) {
    box.className = 'empty';
    box.textContent = '还没有卡。\n卡是你给出去的那把钥匙——建一张，决定它能开哪几扇门。';
    return;
  }
  cards.forEach((c) => box.appendChild(cardRow(c)));
}

function cardRow(c) {
  const open = c.kind === 'open';
  const node = el(`<section class="cardrow">
      <div class="cardtop">
        <div>
          <span class="kind ${open ? 'open' : ''}">${open ? '免登录' : '需登录'}</span>
          <span class="cardname">${esc(c.title)}</span>
        </div>
        <div class="cardacts"></div>
      </div>
      <div class="cardkey"></div>
      <div class="shares"></div>
      <div class="cardfoot"></div>
      <div class="cardpanel"></div>
    </section>`);

  // 凭证：免登录卡是链接本身，登录卡是 8 位码。
  const key = node.querySelector('.cardkey');
  if (open) {
    const url = openLink(c.publicSlug);
    key.appendChild(el(`<code class="link">${esc(url)}</code>`));
    const copy = el('<button class="btn small quiet">复制</button>');
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(url); copy.textContent = '已复制'; }
      catch { copy.textContent = '复制失败'; }
      setTimeout(() => (copy.textContent = '复制'), 1400);
    };
    key.appendChild(copy);
    // 这条链接就是这张卡的全部凭证。明文 HTTP 会把它暴露给链路上每一跳。
    if (location.protocol !== 'https:') {
      key.appendChild(el('<div class="warn">当前是明文 HTTP —— slug 会在链路上暴露。上 HTTPS 之前别对外发。</div>'));
    }
  } else {
    key.appendChild(el(`<code class="link">${esc(c.inviteCode)}</code>`));
    key.appendChild(el('<span class="keyhint">读者在登录后输入这个码</span>'));
  }

  // 分享 = 读者看到的 tab。这里显示构成它的标签（A 端自己的卡，标签可见；读者端永不下发）。
  const shares = node.querySelector('.shares');
  if (c.shares.length === 0) {
    shares.appendChild(el('<div class="keyhint">没有分享 —— 这张卡目前什么都看不到。</div>'));
  }
  c.shares.forEach((s) => shares.appendChild(shareRow(c, s)));

  const cutoff = new Date(c.visibleUntil);
  node.querySelector('.cardfoot').textContent =
    `冻结分享只显示 ${cutoff.getFullYear()}.${String(cutoff.getMonth() + 1).padStart(2, '0')}.${String(cutoff.getDate()).padStart(2, '0')} ${String(cutoff.getHours()).padStart(2, '0')}:${String(cutoff.getMinutes()).padStart(2, '0')} 之前的笔记`;

  const acts = node.querySelector('.cardacts');
  const panel = node.querySelector('.cardpanel');
  const act = (label, cls, fn) => { const b = el(`<button class="${cls}">${label}</button>`); b.onclick = fn; acts.appendChild(b); };

  act('预览', '', () => togglePanel(panel, 'preview', () => previewPanel(c)));
  act('加分享', '', () => togglePanel(panel, 'share', () => addSharePanel(c)));
  act('推进时间', '', async () => {
    if (!confirm('把可见范围推进到现在？冻结的分享会开始显示这之前的所有笔记。只会放宽，不会收紧。')) return;
    if ((await post(`/api/cards/${encodeURIComponent(c.id)}/advance`, {})).status === 200) loadCards();
  });
  act('轮换', '', async () => {
    if (!confirm(open
      ? '换一条新链接？旧链接立即失效——已经发出去的人会打不开。'
      : '换一个新邀请码？旧码立即失效。已经兑换过的读者不受影响。')) return;
    const r = await post(`/api/cards/${encodeURIComponent(c.id)}/rotate-code`, {});
    if (r.status === 200) loadCards();
  });
  act('删除', 'del', async () => {
    if (!confirm(open
      ? '删掉这张卡？链接立即失效，且不留痕迹。这是唯一真正的撤回——清空分享做不到（链接还打得开）。'
      : '删掉这张卡？所有持卡人立即失去访问，且不留痕迹。')) return;
    if ((await del('/api/cards/' + encodeURIComponent(c.id))).status === 200) loadCards();
  });
  return node;
}

/** 预览和加分享共用一个面板位。用 key 区分：点同一个按钮是收起，点另一个是切换
 *  （否则开着预览时点「加分享」只会把预览关掉，看起来像按钮坏了）。
 *  build() 可以是同步或异步（预览要打一次接口）—— await 兼容两者。 */
async function togglePanel(panel, key, build) {
  if (panel.dataset.open === key) { panel.dataset.open = ''; panel.innerHTML = ''; return; }
  panel.dataset.open = key;
  panel.innerHTML = '<div class="loading">…</div>';
  const node = await build();
  if (panel.dataset.open !== key) return; // 等接口期间用户又点了别的
  panel.innerHTML = '';
  if (node) panel.appendChild(node);
}

function shareRow(c, s) {
  const inc = s.include.map((t) => `<span class="tag">${esc(t.name)}</span>`).join('');
  const exc = s.exclude.length
    ? ' <span class="minus">−</span> ' + s.exclude.map((t) => `<span class="tag ex">${esc(t.name)}</span>`).join('')
    : '';
  const node = el(`<div class="share">
      <span class="sharename">${esc(s.name)}</span>
      <span class="rule">${inc}${exc}</span>
      ${s.isAutoUpdate ? '<span class="auto">自动更新</span>' : ''}
      <span class="shareacts"></span>
    </div>`);
  const acts = node.querySelector('.shareacts');
  const mk = (label, cls, fn) => { const b = el(`<button class="${cls}">${label}</button>`); b.onclick = fn; acts.appendChild(b); };
  mk('改名', '', async () => {
    const name = prompt('读者看到的名字（内部标签名永不外泄）：', s.name);
    if (name === null || !name.trim()) return;
    if ((await patch(`/api/cards/${encodeURIComponent(c.id)}/shares/${encodeURIComponent(s.id)}`, { name: name.trim() })).status === 200) loadCards();
  });
  mk(s.isAutoUpdate ? '改冻结' : '改自动', '', async () => {
    const next = !s.isAutoUpdate;
    if (next && !confirm('设为自动更新？以后凡是符合这组标签的新笔记都会自动出现，不再受时间截止点限制。')) return;
    if ((await patch(`/api/cards/${encodeURIComponent(c.id)}/shares/${encodeURIComponent(s.id)}`, { autoUpdate: next })).status === 200) loadCards();
  });
  mk('收回', 'del', async () => {
    if (!confirm(`收回「${s.name}」？读者那边这个 tab 和它带来的内容会直接消失，零痕迹。`)) return;
    if ((await del(`/api/cards/${encodeURIComponent(c.id)}/shares/${encodeURIComponent(s.id)}`)).status === 200) loadCards();
  });
  return node;
}

/** 分享规则编辑器：必含（交集）+ 排除。一条分享至少要一个必含标签。 */
function ruleEditor(initial = { include: [], exclude: [] }) {
  const include = new Set(initial.include);
  const exclude = new Set(initial.exclude);
  const box = el(`<div class="rules">
      <div class="rulerow"><span class="rulelabel">必含</span><div class="picker" id="inc"></div></div>
      <div class="rulerow"><span class="rulelabel">排除</span><div class="picker" id="exc"></div></div>
      <div class="keyhint">必含 = 笔记要同时带上全部这些标签（交集）。排除 = 带了任一个就不给看。</div>
    </div>`);
  const draw = () => {
    ['inc', 'exc'].forEach((which) => {
      const host = box.querySelector('#' + which);
      const mine = which === 'inc' ? include : exclude;
      const other = which === 'inc' ? exclude : include;
      host.innerHTML = '';
      state.tags.forEach((t) => {
        const b = el(`<button class="pick ${mine.has(t.id) ? 'on' : ''}">${esc(t.name)}</button>`);
        b.disabled = other.has(t.id); // 同一个标签不能既必含又排除
        b.onclick = () => { mine.has(t.id) ? mine.delete(t.id) : mine.add(t.id); draw(); };
        host.appendChild(b);
      });
    });
  };
  draw();
  return { node: box, include, exclude };
}

function addSharePanel(c) {
  const wrap = el('<div class="composer"></div>');
  const ed = ruleEditor();
  wrap.appendChild(ed.node);
  const row = el('<div class="row"><input class="field name" placeholder="读者看到的名字（留空则用标签名）" style="margin:0;flex:1" /></div>');
  wrap.appendChild(row);
  const auto = el('<label class="keyhint" style="display:flex;gap:6px;align-items:center"><input type="checkbox" /> 自动更新（新笔记自动进来）</label>');
  row.appendChild(auto);
  const save = el('<button class="btn small">加上</button>');
  save.onclick = async () => {
    if (ed.include.size === 0) { alert('至少要一个必含标签，否则这条分享没有意义。'); return; }
    save.disabled = true;
    const r = await post(`/api/cards/${encodeURIComponent(c.id)}/shares`, {
      name: row.querySelector('.name').value.trim() || undefined,
      autoUpdate: auto.querySelector('input').checked,
      include: [...ed.include],
      exclude: [...ed.exclude],
    });
    if (r.status === 200) loadCards();
    else { alert('加不上'); save.disabled = false; }
  };
  row.appendChild(save);
  return wrap;
}

async function previewPanel(c) {
  const wrap = el('<div class="composer"><div class="keyhint">这是持卡人现在打开会看到的东西（实时算的，不会建持卡记录）。</div><div class="pv loading">…</div></div>');
  const host = wrap.querySelector('.pv');
  const r = await get(`/api/cards/${encodeURIComponent(c.id)}/preview`);
  host.className = 'pv';
  host.innerHTML = '';
  if (r.status !== 200) { host.textContent = '预览失败'; return wrap; }
  const tabs = ['最近更新', ...(r.body.tabs || []).map((t) => t.name)];
  host.appendChild(el(`<div class="pvtabs">${tabs.map((t) => `<span class="tab">${esc(t)}</span>`).join('')}</div>`));
  const notes = r.body.notes || [];
  if (notes.length === 0) { host.appendChild(el('<div class="keyhint">读者现在什么都看不到。</div>')); return wrap; }
  notes.slice(0, 5).forEach((n) => {
    const chips = (n.shares || []).map((s) => `<span class="tag">${esc(s.name)}</span>`).join(' ');
    host.appendChild(el(`<div class="pvnote"><div class="body">${md.render(n.body || '')}</div><div class="keyhint">${chips}</div></div>`));
  });
  if (notes.length > 5) host.appendChild(el(`<div class="keyhint">…还有 ${notes.length - 5} 条</div>`));
  return wrap;
}

/** 建卡。默认走 spec 的快速模式：选中的每个标签各自成为一条分享，分享名 = 标签名。 */
function mountCardCreator(host) {
  const box = el(`<div class="composer">
      <div class="row" style="margin:0;padding:0;border:none">
        <input class="field title" placeholder="卡的名字，比如「写给在意的人」" style="margin:0;flex:1" />
        <button class="btn small" id="mk">建卡</button>
      </div>
      <div class="rulerow" style="margin-top:10px">
        <span class="rulelabel">类型</span>
        <div class="picker" id="kind"></div>
      </div>
      <div class="keyhint" id="kindhint"></div>
      <div class="rulerow" style="margin-top:8px">
        <span class="rulelabel">标签</span>
        <div class="picker" id="qtags"></div>
      </div>
      <div class="keyhint">选中的每个标签各成一条分享，分享名就是标签名。要交集或排除，建完卡再用「加分享」。</div>
    </div>`);
  let kind = 'private';
  const chosen = new Set();

  const KIND_HINT = {
    private: '需登录：读者用手机号登录后输入 8 位邀请码。会留下持卡记录（你看不到，数据层保留）。',
    open: '免登录：有链接就能看，不需要账号。数据层不留任何读者记录——这也意味着无法逐个撤回，只能轮换链接或删卡。',
  };
  const drawKind = () => {
    const h = box.querySelector('#kind');
    h.innerHTML = '';
    [['private', '需登录'], ['open', '免登录']].forEach(([k, label]) => {
      const b = el(`<button class="pick ${kind === k ? 'on' : ''}">${label}</button>`);
      b.onclick = () => { kind = k; drawKind(); };
      h.appendChild(b);
    });
    box.querySelector('#kindhint').textContent = KIND_HINT[kind];
  };
  const drawTags = () => {
    const h = box.querySelector('#qtags');
    h.innerHTML = '';
    state.tags.forEach((t) => {
      const b = el(`<button class="pick ${chosen.has(t.id) ? 'on' : ''}">${esc(t.name)}</button>`);
      b.onclick = () => { chosen.has(t.id) ? chosen.delete(t.id) : chosen.add(t.id); drawTags(); };
      h.appendChild(b);
    });
    if (state.tags.length === 0) h.appendChild(el('<span class="keyhint">还没有标签 —— 先去「库」给笔记打几个。</span>'));
  };
  drawKind();
  drawTags();

  box.querySelector('#mk').onclick = async () => {
    const title = box.querySelector('.title').value.trim();
    if (!title) { alert('给卡起个名字'); return; }
    if (chosen.size === 0) { alert('至少选一个标签，否则这张卡什么都看不到。'); return; }
    const btn = box.querySelector('#mk');
    btn.disabled = true;
    const r = await post('/api/cards', {
      title,
      kind,
      shares: [...chosen].map((id) => ({ name: tagName(id), include: [id] })),
    });
    btn.disabled = false;
    if (r.status === 201) {
      box.querySelector('.title').value = '';
      chosen.clear(); drawTags();
      loadCards();
    } else alert('建不了：' + (r.body?.error || r.status));
  };
  host.appendChild(box);
}

/* ---------------- 启动 ---------------- */

async function refreshCounts() {
  const r = await get('/api/notes?untagged=1');
  if (r.status === 200) drawNav({ inbox: (r.body.notes || []).length });
}

function readHash() {
  const m = location.hash.match(/^#\/(library|inbox|cards)$/);
  state.view = m ? m[1] : 'library';
}

window.addEventListener('hashchange', () => { readHash(); drawNav(); renderMain(); });

async function boot() {
  if (!getToken()) return renderGate();
  const me = await get('/api/me');
  if (me.status === 401) { clearToken(); return renderGate(); }
  state.me = me.body.user;
  const tags = await get('/api/tags');
  state.tags = tags.body?.tags || [];
  readHash();
  renderShell();
  renderMain();
}

boot();
