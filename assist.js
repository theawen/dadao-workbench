// 填写助手：注入到投诉页面右侧的小面板。
// 只做一件事：把你点选的资料填进你选中的输入框。不勾选协议、不处理验证码、不点提交。
(() => {
  if (window.__dadaoAssist) { window.__dadaoAssist.toggle(); return; }

  const TYPES = { web: '网页', netdisk: '网盘', social: '社交平台' };
  let last = null;           // 最近聚焦的页面输入框
  let mode = 'replace';      // replace | append
  let state = { profile: {}, books: [], candidates: {}, settings: {} };
  let bookId = '';
  let scope = 'all';
  let platform = '';
  const filled = new Set();

  const host = document.createElement('div');
  host.id = 'dadao-assist-host';
  host.style.cssText = 'all:initial;position:fixed;top:12px;right:12px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  document.documentElement.appendChild(host);

  root.innerHTML = `
  <style>
    :host { all: initial; }
    * { box-sizing: border-box; }
    .p { width: 320px; max-height: calc(100vh - 24px); display: flex; flex-direction: column; background: #F2F5F1; color: #17241F; border: 1px solid #C7D2CB; border-radius: 8px; box-shadow: 0 8px 28px rgba(23,36,31,.22); font: 13px/1.5 "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif; overflow: hidden; }
    .hd { display: flex; align-items: center; gap: 8px; padding: 9px 12px; background: #17241F; color: #fff; }
    .hd b { font: 600 14px "Songti SC","Noto Serif CJK SC",serif; flex: 1; }
    .seal { width: 20px; height: 20px; display: grid; place-items: center; background: #B5321F; border-radius: 3px; font-size: 12px; transform: rotate(-4deg); }
    .hd button { all: unset; cursor: pointer; padding: 0 4px; color: #B9C7C0; font-size: 16px; }
    .hd button:hover { color: #fff; }
    .bd { padding: 10px 12px; overflow: auto; }
    .tip { background: #F5ECCB; border-left: 3px solid #A57A12; padding: 6px 9px; border-radius: 0 6px 6px 0; margin-bottom: 8px; font-size: 12px; }
    .target { font-size: 12px; color: #4B5B54; margin-bottom: 8px; }
    .target.on { color: #1F5A41; font-weight: 600; }
    select, input[type=text] { width: 100%; font: inherit; padding: 5px 8px; border: 1px solid #D4DDD7; border-radius: 6px; background: #fff; color: inherit; margin-bottom: 6px; }
    .row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
    .row label { display: inline-flex; gap: 4px; align-items: center; cursor: pointer; }
    h4 { margin: 10px 0 4px; font: 600 13px "Songti SC","Noto Serif CJK SC",serif; }
    .it { display: grid; grid-template-columns: 1fr auto; gap: 2px 6px; padding: 6px 8px; background: #fff; border: 1px solid #E6ECE8; border-radius: 6px; margin-bottom: 4px; cursor: pointer; }
    .it:hover { border-color: #2C7A58; }
    .it .k { font-size: 12px; color: #4B5B54; }
    .it .v { grid-column: 1 / -1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .it.done { border-color: #B9D8C8; background: #F3FAF6; }
    .it.done .k::after { content: "  已填"; color: #2C7A58; }
    .cp { all: unset; font-size: 12px; color: #2C7A58; cursor: pointer; }
    .cp:hover { text-decoration: underline; }
    .btn { font: inherit; border: 1px solid #D4DDD7; background: #fff; padding: 5px 10px; border-radius: 6px; cursor: pointer; }
    .btn.primary { background: #2C7A58; border-color: #2C7A58; color: #fff; }
    .muted { color: #7D8B85; font-size: 12px; }
    .toast { position: absolute; left: 12px; right: 12px; bottom: 12px; background: #17241F; color: #fff; padding: 6px 10px; border-radius: 6px; opacity: 0; transition: opacity .2s; pointer-events: none; }
    .toast.show { opacity: 1; }
    .min .bd { display: none; }
    .min.p { width: 180px; }
  </style>
  <div class="p" id="panel">
    <div class="hd"><span class="seal">盗</span><b>填写助手</b><button id="min" title="收起">–</button><button id="close" title="关闭">×</button></div>
    <div class="bd" id="bd"></div>
    <div class="toast" id="toast"></div>
  </div>`;

  const $ = (s) => root.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let tt;
  const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 1800); };

  // ---------- 记住你点过的输入框 ----------
  const TEXTY = /^(text|email|tel|url|search|number|date|datetime-local|month)$/i;
  const editable = (el) =>
    el && el !== host && (
      (el.tagName === 'TEXTAREA' && !el.readOnly && !el.disabled) ||
      (el.tagName === 'INPUT' && TEXTY.test(el.type || 'text') && !el.readOnly && !el.disabled) ||
      el.isContentEditable
    );
  const onFocus = (e) => {
    const path = e.composedPath ? e.composedPath() : [e.target];
    if (path.includes(host)) return;
    const t = path[0];
    if (editable(t)) { last = t; updateTarget(); }
  };
  document.addEventListener('focusin', onFocus, true);

  function describe(el) {
    if (!el) return '';
    const lab = (el.labels && el.labels[0] && el.labels[0].innerText) || el.getAttribute('aria-label') || el.placeholder || el.name || el.id || el.tagName.toLowerCase();
    return String(lab).replace(/\s+/g, ' ').slice(0, 30);
  }
  function updateTarget() {
    const t = $('#target');
    if (!t) return;
    t.className = 'target' + (last && last.isConnected ? ' on' : '');
    t.textContent = last && last.isConnected ? `将填入：${describe(last)}` : '先点一下页面上要填的输入框';
  }

  function fill(value, id) {
    if (!last || !last.isConnected) { toast('先点一下页面上要填的输入框'); return; }
    const el = last;
    el.focus();
    if (el.isContentEditable) {
      if (mode === 'replace') document.execCommand('selectAll', false);
      else if (el.innerText.trim()) document.execCommand('insertText', false, '\n');
      document.execCommand('insertText', false, value);
    } else {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      let v = value;
      if (mode === 'append' && el.value.trim()) v = el.value.replace(/\s+$/, '') + (el.tagName === 'TEXTAREA' ? '\n' : ' ') + value;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (id) filled.add(id);
    toast('已填入：' + describe(el));
    draw();
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('已复制'); }
    catch { toast('复制失败，请手动选择'); }
  }

  // ---------- 数据 ----------
  const fillVars = (tpl, vars) => tpl.replace(/\{\{?([^{}]+)\}?\}/g, (m, k) => (vars[k.trim()] ? vars[k.trim()] : m));
  const today = () => { const d = new Date(), z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };

  async function loadState() {
    state = Object.assign({ profile: {}, books: [], candidates: {}, settings: {} }, await chrome.storage.local.get(['profile', 'books', 'candidates', 'settings']));
    if (!bookId || !state.books.some((b) => b.id === bookId)) bookId = state.books[0] ? state.books[0].id : '';
    if (!platform) platform = guessPlatform();
  }

  function guessPlatform() {
    const h = location.hostname;
    const list = (state.settings && state.settings.platforms) || [];
    for (const p of list) { try { if (p.url && new URL(p.url).hostname === h) return p.name; } catch {} }
    if (/baidu/.test(h)) return '百度';
    if (/quark|sm\.cn|uc\.cn/.test(h)) return '夸克';
    if (/bing|microsoft/.test(h)) return '必应';
    if (/weibo/.test(h)) return '微博';
    return '';
  }

  function links() {
    return Object.values(state.candidates || {})
      .filter((c) => c.bookId === bookId && c.status === 'piracy' && (scope === 'all' || c.type === scope))
      .sort((a, b) => a.url.localeCompare(b.url));
  }

  // ---------- 绘制 ----------
  function draw() {
    const bd = $('#bd');
    if (!state.books.length) {
      bd.innerHTML = '<div class="tip">还没有作品资料。请先在「打盗工作台」里填写作者资料和作品。</div>';
      return;
    }
    const p = state.profile || {};
    const book = state.books.find((b) => b.id === bookId) || state.books[0];
    const ls = links();
    const urls = ls.map((c) => c.url);
    const notice = fillVars((state.settings && state.settings.noticeTemplate) || '', {
      平台: platform, 真实姓名: p.realName, 笔名: book.penName, 作品名: book.title, 正版链接: book.url,
      首发时间: book.firstPublished, 侵权链接: urls.map((u, i) => `${i + 1}. ${u}`).join('\n'),
      手机: p.phone, 邮箱: p.email, 地址: p.address, 日期: today()
    });

    const items = [
      ['真实姓名', p.realName], ['手机', p.phone], ['邮箱', p.email], ['通讯地址', p.address],
      ['笔名', book.penName], ['作品名', book.title], ['作品名（带书名号）', book.title && `《${book.title}》`],
      ['正版链接', book.url], ['首发时间', book.firstPublished], ['文案', book.blurb],
      ['权属说明', p.rightsNote], ['其他信息', p.extra],
      [`侵权链接（${urls.length} 条，每行一条）`, urls.join('\n')],
      [`侵权链接（${urls.length} 条，逗号分隔）`, urls.join(',')],
      ['权利通知书全文', notice]
    ].filter(([, v]) => v);

    bd.innerHTML = `
      <div class="tip">先点页面上的输入框，再点下面的条目。勾选协议、上传证件、验证码和提交请你自己完成。</div>
      <div id="target" class="target"></div>
      <select id="book">${state.books.map((b) => `<option value="${esc(b.id)}" ${b.id === book.id ? 'selected' : ''}>《${esc(b.title)}》</option>`).join('')}</select>
      <div class="row">
        <select id="scope" style="margin:0">
          <option value="all" ${scope === 'all' ? 'selected' : ''}>全部已确认盗文</option>
          ${Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${scope === k ? 'selected' : ''}>只要${t}</option>`).join('')}
        </select>
      </div>
      <div class="row">
        <label><input type="radio" name="mode" value="replace" ${mode === 'replace' ? 'checked' : ''}>替换原内容</label>
        <label><input type="radio" name="mode" value="append" ${mode === 'append' ? 'checked' : ''}>追加到末尾</label>
      </div>
      <h4>资料</h4>
      ${items.map(([k, v], i) => `<div class="it ${filled.has('i' + i) ? 'done' : ''}" data-i="${i}"><span class="k">${esc(k)}</span><button class="cp" data-c="${i}">复制</button><span class="v">${esc(String(v).split('\n')[0])}</span></div>`).join('')}
      <h4>逐条链接（${ls.length}）</h4>
      ${ls.length ? ls.map((c, i) => `<div class="it ${filled.has('l' + c.key) ? 'done' : ''}" data-l="${i}"><span class="k">${i + 1}. ${esc(c.host)}</span><button class="cp" data-lc="${i}">复制</button><span class="v">${esc(c.url)}</span></div>`).join('') : '<div class="muted">这本书还没有标记为「盗文」的链接。</div>'}
      <h4>记录投诉</h4>
      <input type="text" id="plat" placeholder="平台名称，例如：百度" value="${esc(platform)}">
      <button class="btn primary" id="rec" ${ls.length ? '' : 'disabled'}>提交成功后，记录这 ${ls.length} 条为已投诉</button>
      <div class="muted" style="margin-top:6px">只在你确认投诉已经提交成功后再点。记录会出现在工作台里。</div>
    `;
    updateTarget();

    bd.querySelector('#book').onchange = (e) => { bookId = e.target.value; draw(); };
    bd.querySelector('#scope').onchange = (e) => { scope = e.target.value; draw(); };
    bd.querySelectorAll('input[name=mode]').forEach((r) => (r.onchange = (e) => { mode = e.target.value; }));
    bd.querySelector('#plat').oninput = (e) => { platform = e.target.value.trim(); };
    bd.querySelectorAll('.it[data-i]').forEach((el) => (el.onclick = (e) => { if (e.target.closest('.cp')) return; fill(items[+el.dataset.i][1], 'i' + el.dataset.i); }));
    bd.querySelectorAll('.cp[data-c]').forEach((b) => (b.onclick = () => copy(items[+b.dataset.c][1])));
    bd.querySelectorAll('.it[data-l]').forEach((el) => (el.onclick = (e) => { if (e.target.closest('.cp')) return; const c = ls[+el.dataset.l]; fill(c.url, 'l' + c.key); }));
    bd.querySelectorAll('.cp[data-lc]').forEach((b) => (b.onclick = () => copy(ls[+b.dataset.lc].url)));
    bd.querySelector('#rec').onclick = async () => {
      if (!platform) { toast('先填平台名称'); return; }
      if (!confirm(`确认已经在${platform}成功提交了这 ${ls.length} 条链接的投诉？`)) return;
      const data = await chrome.storage.local.get('candidates');
      const cands = data.candidates || {};
      const d = new Date(), z = (n) => String(n).padStart(2, '0');
      const at = `${today()} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
      for (const c of ls) if (cands[c.key]) cands[c.key].complaints = [...(cands[c.key].complaints || []), { platform, at }];
      await chrome.storage.local.set({ candidates: cands });
      await loadState();
      toast(`已记录 ${ls.length} 条投诉到${platform}`);
      draw();
    };
  }

  // ---------- 面板控制 ----------
  $('#close').onclick = () => destroy();
  $('#min').onclick = () => $('#panel').classList.toggle('min');
  const onStore = () => loadState().then(draw);
  chrome.storage.onChanged.addListener(onStore);
  function destroy() {
    document.removeEventListener('focusin', onFocus, true);
    chrome.storage.onChanged.removeListener(onStore);
    host.remove();
    delete window.__dadaoAssist;
  }
  window.__dadaoAssist = {
    toggle() { host.style.display = host.style.display === 'none' ? '' : 'none'; }
  };

  if (editable(document.activeElement)) last = document.activeElement;
  loadState().then(draw);
})();
