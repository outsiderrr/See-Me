// See Me — B (reader) web. Vanilla JS, zero-pressure: no likes/comments/receipts.
const TOKEN_KEY = 'see_me_token';
const getToken = () => localStorage.getItem(TOKEN_KEY);
const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
const clearToken = () => localStorage.removeItem(TOKEN_KEY);

async function api(path, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
  const t = getToken();
  if (t) headers['Authorization'] = 'Bearer ' + t;
  const res = await fetch(path, { ...opts, headers });
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

async function apiBlob(path) {
  const headers = {};
  const t = getToken();
  if (t) headers.Authorization = 'Bearer ' + t;
  const res = await fetch(path, { headers });
  return res.ok ? res.blob() : null;
}

const app = () => document.getElementById('app');
const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function route() {
  if (!getToken()) return renderLogin();
  const m = location.hash.match(/^#card\/(.+)$/);
  if (m) return renderCard(decodeURIComponent(m[1]));
  return renderCards();
}
window.addEventListener('hashchange', route);

function renderLogin() {
  app().innerHTML = '';
  let phase = 'phone';
  let phone = '';
  const view = el(`
    <div class="screen center">
      <div class="brand">See Me</div>
      <p class="hint">别人想了解你时，来这里看。</p>
      <div class="form">
        <input id="phone" class="input" placeholder="手机号" inputmode="tel" autocomplete="tel" />
        <div id="codeRow" style="display:none"><input id="code" class="input" placeholder="6 位验证码" inputmode="numeric" /></div>
        <button id="go" class="btn">发送验证码</button>
        <p id="msg" class="msg"></p>
      </div>
    </div>`);
  app().appendChild(view);
  const q = (id) => view.querySelector('#' + id);
  q('go').onclick = async () => {
    const msg = q('msg');
    if (phase === 'phone') {
      phone = q('phone').value.trim();
      if (!/^\+?\d{8,15}$/.test(phone)) { msg.textContent = '手机号格式不对'; return; }
      const r = await api('/api/auth/request-code', { method: 'POST', body: JSON.stringify({ phone }) });
      if (r.status === 200) {
        phase = 'code'; q('codeRow').style.display = 'block'; q('go').textContent = '登录';
        msg.textContent = '验证码已发送'; q('code').focus();
      } else msg.textContent = r.status === 429 ? '太频繁了，稍后再试' : '发送失败';
    } else {
      const code = q('code').value.trim();
      const r = await api('/api/auth/verify', { method: 'POST', body: JSON.stringify({ phone, code }) });
      if (r.status === 200 && r.body && r.body.token) { setToken(r.body.token); location.hash = ''; route(); }
      else msg.textContent = '验证码不对';
    }
  };
}

async function renderCards() {
  app().innerHTML = `
    <div class="screen">
      <div class="topbar"><div class="title">收到的邀请卡</div></div>
      <div id="list" class="list"></div>
      <div class="bottom"><button id="add" class="btn ghost">+ 添加邀请卡</button><button id="out" class="link">退出</button></div>
    </div>`;
  const r = await api('/api/my-cards');
  if (r.status === 401) { clearToken(); return route(); }
  const list = document.getElementById('list');
  const cards = (r.body && r.body.cards) || [];
  if (cards.length === 0) {
    list.innerHTML = '<div class="empty">还没有邀请卡。<br/>输入别人给你的邀请码看看。</div>';
  } else {
    cards.forEach((c) => list.appendChild(el(
      `<a class="card" href="#card/${encodeURIComponent(c.id)}"><div class="card-title">${esc(c.title)}</div><div class="card-go">›</div></a>`,
    )));
  }
  document.getElementById('add').onclick = async () => {
    const code = prompt('输入 8 位邀请码');
    if (!code) return;
    const rr = await api('/api/redeem', { method: 'POST', body: JSON.stringify({ code }) });
    if (rr.status === 200) renderCards();
    else if (rr.status === 400) alert('邀请码格式不对');
    else if (rr.status === 429) alert('太频繁了，稍后再试');
    else alert('没找到这张卡');
  };
  document.getElementById('out').onclick = () => { api('/api/auth/logout', { method: 'POST' }); clearToken(); route(); };
}

async function renderCard(id) {
  app().innerHTML = `
    <div class="screen">
      <div class="topbar"><a class="back" href="#">‹</a><div id="ctitle" class="title">…</div></div>
      <div id="tabs" class="tabs"></div>
      <div id="feed" class="feed"></div>
    </div>`;
  const head = await api('/api/read/' + id);
  if (head.status === 401) { clearToken(); return route(); }
  if (head.status !== 200) { document.getElementById('feed').innerHTML = '<div class="empty">这张卡看不了了。</div>'; return; }
  document.getElementById('ctitle').textContent = head.body.title;

  const tabs = [{ id: 'recent', name: '最近更新' }, ...(head.body.tabs || [])];
  let active = 'recent';
  const tabsEl = document.getElementById('tabs');
  function drawTabs() {
    tabsEl.innerHTML = '';
    tabs.forEach((t) => {
      const b = el(`<button class="tab ${t.id === active ? 'on' : ''}">${esc(t.name)}</button>`);
      b.onclick = () => { active = t.id; drawTabs(); loadFeed(); };
      tabsEl.appendChild(b);
    });
  }
  async function loadFeed() {
    const feed = document.getElementById('feed');
    feed.innerHTML = '<div class="loading">…</div>';
    const q = active === 'recent' ? '' : '?tab=' + encodeURIComponent(active);
    const r = await api('/api/read/' + id + '/notes' + q);
    feed.innerHTML = '';
    const notes = (r.body && r.body.notes) || [];
    if (notes.length === 0) { feed.innerHTML = '<div class="empty">这里还没有内容。</div>'; return; }
    notes.forEach((n) => feed.appendChild(noteCard(n, id)));
    let cursor = r.body.nextCursor;
    if (cursor) {
      const more = el('<button class="btn ghost more">加载更多</button>');
      more.onclick = async () => {
        const rr = await api('/api/read/' + id + '/notes' + (q ? q + '&' : '?') + 'cursor=' + encodeURIComponent(cursor));
        more.remove();
        ((rr.body && rr.body.notes) || []).forEach((n) => feed.appendChild(noteCard(n, id)));
        cursor = rr.body && rr.body.nextCursor;
        if (cursor) feed.appendChild(more);
      };
      feed.appendChild(more);
    }
  }
  drawTabs();
  loadFeed();
}

function noteCard(n, cardId) {
  const d = new Date(n.createdAt);
  const ds = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  const chips = (n.shares || []).map((s) => `<span class="chip">${esc(s.name)}</span>`).join('');
  const node = el(`<article class="note"><div class="note-body">${esc(n.body)}</div><div class="note-images"></div><div class="note-meta"><span class="date">${ds}</span>${chips}</div></article>`);
  const grid = node.querySelector('.note-images');
  (n.images || []).forEach(async (image) => {
    const blob = await apiBlob(`/api/read/${encodeURIComponent(cardId)}/images/${encodeURIComponent(image.id)}`);
    if (!blob) return;
    const img = document.createElement('img');
    img.src = URL.createObjectURL(blob);
    img.onload = () => URL.revokeObjectURL(img.src);
    grid.appendChild(img);
  });
  return node;
}

route();
