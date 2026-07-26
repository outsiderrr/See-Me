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

const state = { me: null, tags: [], view: 'library', tagId: null, q: '' };

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
        <div class="who" id="who"></div>
      </aside>
      <main class="main" id="main"></main>
    </div>`;
  drawNav();
  drawWho();
}

const VIEWS = [
  { id: 'library', label: '库' },
  { id: 'inbox', label: '收件箱' },
];

function drawNav(counts = {}) {
  const nav = document.getElementById('nav');
  if (!nav) return;
  nav.innerHTML = '';
  VIEWS.forEach((v) => {
    const a = el(`<a href="#/${v.id}" class="${state.view === v.id ? 'on' : ''}">
      <span>${esc(v.label)}</span>${counts[v.id] != null ? `<span class="count">${counts[v.id]}</span>` : ''}</a>`);
    nav.appendChild(a);
  });
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
  const main = document.getElementById('main');
  const inbox = state.view === 'inbox';
  main.innerHTML = `
    <div class="head">
      <h1>${inbox ? '收件箱' : '库'}</h1>
      <span class="hint">${inbox ? '还没打标签的笔记 —— 任何卡都看不到它们' : '你写下的一切'}</span>
    </div>
    <div id="composer"></div>
    <div class="toolbar">
      <input id="q" class="search" placeholder="搜索正文…" value="${esc(state.q)}" />
      <div class="picker" id="tagfilter"></div>
    </div>
    <div id="flow" class="loading">…</div>`;

  if (!inbox) mountComposer(document.getElementById('composer'));
  drawTagFilter();

  const q = document.getElementById('q');
  let timer;
  q.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { state.q = q.value.trim(); loadFlow(); }, 220); };
  loadFlow();
}

function drawTagFilter() {
  const box = document.getElementById('tagfilter');
  if (!box || state.view === 'inbox') return;
  box.innerHTML = '';
  const all = el(`<button class="pick ${state.tagId ? '' : 'on'}">全部</button>`);
  all.onclick = () => { state.tagId = null; drawTagFilter(); loadFlow(); };
  box.appendChild(all);
  state.tags.forEach((t) => {
    const b = el(`<button class="pick ${state.tagId === t.id ? 'on' : ''}">${esc(t.name)}</button>`);
    b.onclick = () => { state.tagId = state.tagId === t.id ? null : t.id; drawTagFilter(); loadFlow(); };
    box.appendChild(b);
  });
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
  if (n.tags.length) tagBox.innerHTML = n.tags.map((t) => `<span class="tag">${esc(t.name)}</span>`).join(' ');
  else tagBox.innerHTML = '<span class="untagged">未打标签 · 任何卡都看不到</span>';

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
      if (r.status === 201) { state.tags.push(r.body.tag); chosen.add(r.body.tag.id); redraw(); drawTagFilter(); }
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

/* ---------------- 启动 ---------------- */

async function refreshCounts() {
  const r = await get('/api/notes?untagged=1');
  if (r.status === 200) drawNav({ inbox: (r.body.notes || []).length });
}

function readHash() {
  const m = location.hash.match(/^#\/(library|inbox)$/);
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
