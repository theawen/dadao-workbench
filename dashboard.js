import {
  ENGINES, STATUSES, TYPES, DEFAULT_SETTINGS, DEFAULT_NOTICE,
  getAll, save, uid, todayStr, stamp, buildQueries, fillVars, hostOf,
  csvEscape, downloadText, safeName, classify, scoreResult, mergeDefaults,
  parseNovelId, jjBookUrl, pickFingerprints
} from './lib.js';
import { SearchRunner } from './search.js';
import { BING_FORM_URL, DEFAULT_BING_DESCRIPTION, bingFill, QUARK_IPP_URL, quarkFill } from './platforms.js';
import { verifyPage, verifySummary, captureEvidence, hasAllUrls, requestAllUrls, setMobileUA, fetchJJBook, fetchJJChapterParagraphs, waitTabComplete, recheckLink } from './net.js';

// ---------- 小工具 ----------
const $main = document.getElementById('main');
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
async function copy(text, what = '已复制') {
  await navigator.clipboard.writeText(text);
  toast(what);
}
const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
function head(title, desc) {
  return h('header', { class: 'view-head' }, h('h1', {}, title), desc ? h('p', {}, desc) : null);
}
function field(label, input, hint, wide) {
  return h('label', { class: 'field' + (wide ? ' wide' : '') }, h('span', {}, label), input, hint ? h('em', {}, hint) : null);
}

// ---------- 状态 ----------
let DB = null;
let view = location.hash.slice(1) || 'profile';
const ui = {
  review: { book: '', status: 'pending', type: '', sort: 'score', cursor: 0, selected: new Set(), open: new Set(), justStamped: '' },
  complainBook: '',
  editingBook: null
};
const logs = [];
let runState = { running: false, paused: false, done: 0, total: 0 };
const runner = new SearchRunner({
  onLog: (l) => { logs.push(l); if (logs.length > 400) logs.shift(); if (view === 'search') renderLogOnly(); },
  onState: (s) => { runState = s; if (view === 'search' || view === 'track') render(); },
  onNewResults: () => refresh(false)
});

async function refresh(rerender = true) {
  DB = await getAll();
  const pending = Object.values(DB.candidates).filter((c) => c.status === 'pending').length;
  document.getElementById('pendingBadge').textContent = pending || '';
  const alive = Object.values(DB.candidates).filter((c) => (c.complaints || []).length && c.recheck && c.recheck.state === 'alive').length;
  document.getElementById('trackBadge').textContent = alive || '';
  if (rerender) render();
}

function go(v) {
  view = v;
  history.replaceState(null, '', '#' + v);
  render();
  $main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));

function render() {
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  $main.replaceChildren();
  const fn = { profile: viewProfile, books: viewBooks, search: viewSearch, review: viewReview, complain: viewComplain, track: viewTrack, settings: viewSettings }[view] || viewProfile;
  fn();
}

// =====================================================================
// 1 作者资料
// =====================================================================
function viewProfile() {
  const p = DB.profile;
  const f = {
    realName: h('input', { type: 'text', value: p.realName || '' }),
    phone: h('input', { type: 'text', value: p.phone || '' }),
    email: h('input', { type: 'text', value: p.email || '' }),
    nameLastEn: h('input', { type: 'text', value: p.nameLastEn || '', placeholder: '例如 Zhang' }),
    nameFirstEn: h('input', { type: 'text', value: p.nameFirstEn || '', placeholder: '例如 San' }),
    address: h('input', { type: 'text', value: p.address || '' }),
    idNote: h('textarea', { rows: 2 }, p.idNote || ''),
    rightsNote: h('textarea', { rows: 2 }, p.rightsNote || ''),
    extra: h('textarea', { rows: 3 }, p.extra || '')
  };
  $main.append(
    head('作者资料', '投诉表单里反复要填的身份信息，在这里填一次。填写助手会从这里取值。'),
    h('section', { class: 'panel' },
      h('div', { class: 'grid2' },
        field('真实姓名', f.realName, '版权投诉需要权利人的真实身份'),
        field('手机', f.phone),
        field('邮箱', f.email, '海外平台（如必应）会把投诉信息转给对方或公开，建议用打盗专用邮箱'),
        field('拼音姓（Last name）', f.nameLastEn, '必应等英文表单使用'),
        field('拼音名（First name）', f.nameFirstEn),
        field('通讯地址', f.address, '《信息网络传播权保护条例》要求通知书写明联系方式和地址'),
        field('证件材料存放位置', f.idNote, '只记录文件放在哪，例如「桌面/打盗材料/身份证正反面.jpg」。工具不保存证件图片，上传请自己手动选文件。', true),
        field('权属证明说明', f.rightsNote, '例如：晋江签约合同编号、签约日期、合同扫描件所在文件夹', true),
        field('其他常用信息', f.extra, '会出现在填写助手里，方便复制', true)
      ),
      h('div', { class: 'row', style: 'margin-top:16px' },
        h('button', { class: 'btn primary', onclick: async () => {
          const profile = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value.trim()]));
          await save({ profile });
          await refresh(false);
          toast('作者资料已保存');
        } }, '保存资料'),
        h('span', { class: 'note' }, '资料只存在本机浏览器的扩展存储里，不会上传。')
      )
    )
  );
}

// =====================================================================
// 2 作品库
// =====================================================================
// 「粘贴晋江链接」输入框：在作品列表上方和空状态里使用
function importBox(compact) {
  const inp = h('input', { type: 'text', placeholder: '粘贴晋江作品链接，例如 https://www.jjwxc.net/onebook.php?novelid=…', style: 'flex:1;min-width:260px' });
  const go = () => {
    const id = parseNovelId(inp.value);
    if (!id) { toast('没认出作品 ID，请粘贴晋江作品页的链接'); inp.focus(); return; }
    const dup = DB.books.find((x) => x.novelId === id || parseNovelId(x.url) === id);
    if (dup) { toast('《' + dup.title + '》已经在作品库里了'); return; }
    ui.editingBook = 'new';
    ui.pendingImport = id;
    render();
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  return h('div', { class: 'row', style: compact ? 'flex:1;max-width:640px' : 'justify-content:center;margin-top:14px' }, inp, h('button', { class: 'btn primary', onclick: go }, '读取并添加'));
}

// 从晋江读取作品信息填进表单。新作品全部填入；编辑已有作品时只补空着的项。
async function importIntoForm(f, novelId, isNew, statusEl) {
  const say = (t) => { statusEl.textContent = t; };
  try {
    say('正在读取晋江作品页…');
    const info = await fetchJJBook(novelId);
    const put = (el, v) => { if (v && (isNew || !el.value.trim())) el.value = v; };
    put(f.title, info.title);
    put(f.penName, info.penName);
    put(f.url, info.url);
    put(f.firstPublished, info.firstPublished);
    put(f.blurb, info.blurb);
    if (info.info && !f.note.value.includes(info.info)) f.note.value = (f.note.value.trim() ? f.note.value.trim() + '\n' : '') + info.info;
    f.novelId = info.novelId;
    let fpMsg = '';
    if (!f.fingerprints.value.trim()) {
      say('正在从第 1 章挑选候选指纹句…');
      try {
        const fps = pickFingerprints(await fetchJJChapterParagraphs(novelId, 1), 3);
        if (fps.length) { f.fingerprints.value = fps.join('\n'); fpMsg = `；从免费的第 1 章挑了 ${fps.length} 句候选指纹句，建议再补 2～3 句付费章节的原句`; }
      } catch { fpMsg = '；第 1 章正文没读到，指纹句请手动填写'; }
    }
    say(`已读取《${info.title}》（${info.chapterCount} 章${info.firstPublished ? '，首发 ' + info.firstPublished.slice(0, 10) : ''}）${fpMsg}。核对无误后点「保存作品」。旧书名晋江页面上没有，需要你自己补。`);
  } catch (e) {
    say('读取失败：' + (e.message || e) + '。可以手动填写。');
  }
}

function viewBooks() {
  const books = DB.books;
  const editing = ui.editingBook;
  $main.append(head('作品库', '每本书的书名、旧书名、正版链接，以及用来核对盗文的「指纹句」。粘贴晋江链接可以自动读取大部分信息。'));

  const b = editing === 'new' ? { id: '', title: '', oldTitles: [], penName: '', url: '', firstPublished: '', blurb: '', fingerprints: [], note: '' } : books.find((x) => x.id === editing);
  if (b) {
    const f = {
      title: h('input', { type: 'text', value: b.title, required: true }),
      penName: h('input', { type: 'text', value: b.penName || '' }),
      url: h('input', { type: 'url', value: b.url || '', placeholder: 'https://www.jjwxc.net/onebook.php?novelid=…' }),
      firstPublished: h('input', { type: 'text', value: b.firstPublished || '', placeholder: '例如 2025-03-01' }),
      oldTitles: h('textarea', { rows: 2 }, (b.oldTitles || []).join('\n')),
      blurb: h('textarea', { rows: 4 }, b.blurb || ''),
      fingerprints: h('textarea', { rows: 5 }, (b.fingerprints || []).join('\n')),
      note: h('textarea', { rows: 2 }, b.note || ''),
      novelId: b.novelId || parseNovelId(b.url) || ''
    };
    const status = h('div', { class: 'note', role: 'status', style: 'margin-top:6px' });
    const jjIn = h('input', { type: 'text', value: b.url || '', placeholder: '粘贴晋江作品链接', style: 'flex:1;min-width:260px' });
    const doImport = () => {
      const id = parseNovelId(jjIn.value);
      if (!id) { status.textContent = '没认出作品 ID，请粘贴晋江作品页的链接（含 novelid=数字）。'; return; }
      const dup = DB.books.find((x) => x.id !== b.id && (x.novelId === id || parseNovelId(x.url) === id));
      if (dup) { status.textContent = '《' + dup.title + '》已经在作品库里了。'; return; }
      importIntoForm(f, id, !b.id, status);
    };
    jjIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') doImport(); });
    $main.append(h('section', { class: 'panel' },
      h('h2', {}, editing === 'new' ? '添加作品' : '编辑《' + b.title + '》'),
      h('div', { style: 'margin-bottom:18px;padding-bottom:16px;border-bottom:1px solid var(--line-2)' },
        h('div', { class: 'row' }, jjIn, h('button', { class: 'btn', onclick: doImport }, b.id ? '从晋江补全空着的项' : '从晋江读取')),
        status),
      h('div', { class: 'grid2' },
        field('书名', f.title),
        field('笔名', f.penName),
        field('正版链接', f.url, '晋江文章页地址，会写进通知书'),
        field('首发时间', f.firstPublished, '读取的是第 1 章的首发时间；千万不要删文重发'),
        field('旧书名（一行一个）', f.oldTitles, '盗文站经常用改名前的书名', true),
        field('指纹句（一行一句）', f.fingerprints, '从正文里挑 3～5 句有辨识度的原句，最好来自付费章节，每句 15 字以上。核验时会检查盗文页面里有没有这些句子；也会拿前 24 字去搜索。', true),
        field('文案', f.blurb, '', true),
        field('备注', f.note, '', true)
      ),
      h('div', { class: 'row', style: 'margin-top:16px' },
        h('button', { class: 'btn primary', onclick: async () => {
          if (!f.title.value.trim()) { f.title.focus(); toast('请先填书名'); return; }
          const nb = {
            ...b,
            id: b.id || uid(),
            novelId: parseNovelId(f.url.value) || f.novelId || '',
            title: f.title.value.trim(),
            penName: f.penName.value.trim(),
            url: f.url.value.trim(),
            firstPublished: f.firstPublished.value.trim(),
            oldTitles: lines(f.oldTitles.value),
            blurb: f.blurb.value.trim(),
            fingerprints: lines(f.fingerprints.value),
            note: f.note.value.trim()
          };
          const list = DB.books.filter((x) => x.id !== nb.id);
          const idx = DB.books.findIndex((x) => x.id === nb.id);
          if (idx >= 0) list.splice(idx, 0, nb); else list.push(nb);
          await save({ books: list });
          ui.editingBook = null;
          await refresh();
          toast('已保存《' + nb.title + '》');
        } }, '保存作品'),
        h('button', { class: 'btn', onclick: () => { ui.editingBook = null; render(); } }, '取消')
      )
    ));
    if (ui.pendingImport) {
      jjIn.value = jjBookUrl(ui.pendingImport);
      importIntoForm(f, ui.pendingImport, true, status);
      ui.pendingImport = null;
    } else {
      (b.id ? f.title : jjIn).focus();
    }
  }

  if (!books.length && b) return;
  if (!books.length && !b) {
    $main.append(h('section', { class: 'panel empty' },
      h('strong', {}, '还没有作品'),
      h('p', {}, '粘贴晋江作品链接，自动读取书名、笔名、文案和首发时间。'),
      importBox(false),
      h('p', { style: 'margin-top:14px' }, h('a', { href: '#books', onclick: (e) => { e.preventDefault(); ui.editingBook = 'new'; render(); } }, '或者手动填写'))));
    return;
  }

  const counts = (id) => {
    const cs = Object.values(DB.candidates).filter((c) => c.bookId === id);
    return { pending: cs.filter((c) => c.status === 'pending').length, piracy: cs.filter((c) => c.status === 'piracy').length };
  };
  $main.append(h('div', { class: 'row', style: 'margin-bottom:12px' },
    h('span', { class: 'note' }, `${books.length} 本作品`), h('span', { class: 'spacer' }),
    b ? null : importBox(true),
    b ? null : h('button', { class: 'btn', onclick: () => { ui.editingBook = 'new'; render(); } }, '手动添加')));
  $main.append(h('div', { class: 'book-list' }, books.map((bk) => {
    const c = counts(bk.id);
    const fpn = (bk.fingerprints || []).length;
    return h('div', { class: 'book' },
      h('div', {},
        h('h3', {}, '《' + bk.title + '》'),
        h('div', { class: 'meta' }, [bk.penName && '笔名 ' + bk.penName, bk.oldTitles?.length && '旧名 ' + bk.oldTitles.join('、'), `指纹句 ${fpn} 句`, `待核 ${c.pending}`, `已确认盗文 ${c.piracy}`].filter(Boolean).join('　')),
        fpn < 3 ? h('div', { class: 'warn' }, '建议补到 3 句以上指纹句，核验才靠得住。') : null,
        !bk.url ? h('div', { class: 'warn' }, '还没填正版链接，通知书会缺这一项。') : null
      ),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', onclick: () => { ui.editingBook = bk.id; render(); window.scrollTo(0, 0); } }, '编辑'),
        h('button', { class: 'btn sm danger', onclick: async () => {
          if (!confirm(`删除《${bk.title}》以及它的所有候选链接记录？此操作不能撤销。`)) return;
          const candidates = Object.fromEntries(Object.entries(DB.candidates).filter(([, v]) => v.bookId !== bk.id));
          await save({ books: DB.books.filter((x) => x.id !== bk.id), candidates });
          await refresh();
        } }, '删除')
      )
    );
  })));
}

// =====================================================================
// 3 搜索
// =====================================================================
const searchSel = { books: null, engines: null };
function viewSearch() {
  const { books, settings, usage } = DB;
  $main.append(head('搜索盗文', '在单独的浏览器窗口里逐条打开搜索页，读出结果交给你审核。每条之间会随机等待，避免被搜索引擎风控。'));
  if (!books.length) {
    $main.append(h('section', { class: 'panel empty' }, h('strong', {}, '先添加作品'), h('p', {}, '搜索要用到书名、笔名和指纹句。'),
      h('button', { class: 'btn primary', onclick: () => { ui.editingBook = 'new'; go('books'); } }, '添加作品')));
    return;
  }
  if (!searchSel.books) searchSel.books = new Set(books.map((b) => b.id));
  if (!searchSel.engines) searchSel.engines = new Set(Object.keys(settings.engines).filter((k) => settings.engines[k]));

  const used = usage[todayStr()] || 0;
  const sel = books.filter((b) => searchSel.books.has(b.id));
  const engines = [...searchSel.engines];
  const plan = runner.plan(sel, settings, engines);
  const cap = Math.min(settings.maxQueriesPerRun, Math.max(0, settings.dailyLimit - used));
  const avg = (settings.minDelay + settings.maxDelay) / 2 + 5;
  const est = Math.ceil((Math.min(plan.length, cap) * avg) / 60);

  const bookChecks = books.map((b) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: searchSel.books.has(b.id), disabled: runState.running, onchange: (e) => { e.target.checked ? searchSel.books.add(b.id) : searchSel.books.delete(b.id); render(); } }),
    '《' + b.title + '》'));
  const engChecks = Object.entries(ENGINES).map(([id, e]) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: searchSel.engines.has(id), disabled: runState.running, onchange: (ev) => { ev.target.checked ? searchSel.engines.add(id) : searchSel.engines.delete(id); render(); } }),
    e.name));

  const queries = sel.flatMap((b) => buildQueries(b, settings.queryTemplates).map((q) => `《${b.title}》 ${q}`));
  $main.append(h('section', { class: 'panel' },
    h('h2', {}, '搜哪些作品'), h('div', { class: 'chips' }, bookChecks),
    h('h2', { style: 'margin-top:18px' }, '用哪些搜索入口', h('small', {}, '夸克、头条/悟空、微博使用通用解析，需要登录的入口请先在 Chrome 里登录')),
    h('div', { class: 'chips' }, engChecks),
    h('details', { style: 'margin-top:14px' },
      h('summary', { class: 'note' }, `将使用 ${queries.length} 个搜索词（在「设置」里可改模板）`),
      h('div', { class: 'links', style: 'margin-top:8px' }, queries.join('\n') || '没有可用的搜索词'))
  ));

  const pct = runState.total ? Math.round((runState.done / runState.total) * 100) : 0;
  $main.append(h('section', { class: 'panel' },
    h('div', { class: 'row' },
      h('div', {},
        h('strong', {}, `计划 ${plan.length} 次搜索`),
        h('div', { class: 'note' }, `本轮最多 ${cap} 次（单轮上限 ${settings.maxQueriesPerRun}，今天已用 ${used}/${settings.dailyLimit}），预计约 ${est} 分钟。${settings.mobileMode ? '使用手机身份搜索。' : ''}`)
      ),
      h('span', { class: 'spacer' }),
      runState.running
        ? [
            runState.paused ? h('button', { class: 'btn primary', onclick: () => runner.resume() }, '我已完成验证，继续') : null,
            h('button', { class: 'btn danger', onclick: () => runner.stop() }, '停止搜索')
          ]
        : h('button', { class: 'btn primary', disabled: !plan.length || cap <= 0, onclick: () => runner.start(plan) }, '开始搜索')
    ),
    runState.running ? h('div', { class: 'progress' }, h('i', { style: `width:${pct}%` })) : null,
    runState.running ? h('div', { class: 'note', style: 'margin-top:6px' }, `已完成 ${runState.done} / ${runState.total}`) : null,
    runState.paused ? h('div', { class: 'alert' }, '搜索引擎要求验证或登录。请切到「搜索窗口」手动完成，再回来点「我已完成验证，继续」。工具不会替你过验证码。') : null,
    h('div', { class: 'log', id: 'log' })
  ));
  renderLogOnly();
}
function renderLogOnly() {
  const el = document.getElementById('log');
  if (!el) return;
  el.replaceChildren(...(logs.length ? logs.slice().reverse().map((l) => h('div', {}, h('time', {}, l.at.slice(11)), h('span', { class: l.kind }, l.msg))) : [h('div', { class: 'muted' }, h('span', {}), '还没有开始搜索。')]));
}

// =====================================================================
// 4 人工审核
// =====================================================================
function filteredCandidates() {
  const r = ui.review;
  let list = Object.values(DB.candidates);
  if (r.book) list = list.filter((c) => c.bookId === r.book);
  if (r.status === 'open') list = list.filter((c) => c.status !== 'official');
  else if (r.status) list = list.filter((c) => c.status === r.status);
  if (r.type) list = list.filter((c) => c.type === r.type);
  const key = {
    score: (c) => -(c.score + (c.verify && c.verify.hits ? 5 : 0)),
    found: (c) => -Date.parse(c.foundAt.replace(' ', 'T')),
    host: (c) => c.host
  }[r.sort];
  list.sort((a, b) => { const x = key(a), y = key(b); return x < y ? -1 : x > y ? 1 : 0; });
  return list;
}

async function setStatus(keys, status) {
  const { candidates } = await getAll();
  for (const k of keys) if (candidates[k]) { candidates[k].status = status; candidates[k].reviewedAt = stamp(); }
  await save({ candidates });
  if (status === 'piracy' && keys.length === 1) ui.review.justStamped = keys[0];
  await refresh();
  ui.review.justStamped = '';
}

async function verifyKeys(keys) {
  if (!(await requestAllUrls())) { toast('需要允许访问网站才能核验页面内容'); return; }
  const settings = DB.settings;
  if (settings.mobileMode) await setMobileUA([-1], true);
  try {
    let i = 0;
    for (const k of keys) {
      i++;
      const c = DB.candidates[k];
      if (!c) continue;
      const book = DB.books.find((b) => b.id === c.bookId) || {};
      toast(`核验中 ${i}/${keys.length}：${c.host}`);
      const v = await verifyPage(c.url, book);
      const { candidates } = await getAll();
      if (candidates[k]) {
        candidates[k].verify = v;
        // 搜索引擎跳转链接：核验时顺便记下真实网址
        if (candidates[k].unresolved && v.finalUrl && hostOf(v.finalUrl) && hostOf(v.finalUrl) !== candidates[k].host) {
          const cls = classify(v.finalUrl, DB.settings);
          Object.assign(candidates[k], { url: v.finalUrl, host: hostOf(v.finalUrl), type: cls.type, provider: cls.provider, unresolved: false });
          if (cls.type === 'official' && candidates[k].status === 'pending') candidates[k].status = 'official';
        }
        if (v.hits && candidates[k].score < 8) candidates[k].score = Math.min(10, candidates[k].score + 4);
        await save({ candidates });
      }
      await refresh();
      if (i < keys.length) await new Promise((r) => setTimeout(r, settings.verifyDelay * 1000));
    }
    toast('核验完成');
  } finally {
    if (settings.mobileMode) await setMobileUA([-1], false);
  }
}

async function captureKey(k) {
  if (!(await requestAllUrls())) { toast('需要允许访问网站才能截图取证'); return; }
  const c = DB.candidates[k];
  const book = DB.books.find((b) => b.id === c.bookId) || {};
  toast('正在打开页面截图，请稍候');
  try {
    const { blob, when, finalUrl } = await captureEvidence(c.url, { mobile: DB.settings.mobileMode, label: '《' + (book.title || '') + '》' });
    const fname = `打盗取证_${safeName(book.title)}_${safeName(c.host)}_${when.replace(/[: ]/g, '').replace(/-/g, '')}.png`;
    const a = h('a', { href: URL.createObjectURL(blob), download: fname });
    document.body.append(a); a.click(); a.remove();
    const { candidates } = await getAll();
    candidates[k].evidence = [...(candidates[k].evidence || []), { at: when, file: fname, finalUrl }];
    await save({ candidates });
    await refresh();
    toast('截图已保存到下载文件夹：' + fname);
  } catch (e) {
    toast('截图失败：' + (e.message || e));
  }
}

function viewReview() {
  const r = ui.review;
  const { books } = DB;
  $main.append(head('人工审核', '每条链接都要你亲自点开确认。只有标成「盗文」的链接会进入投诉材料。正版渠道和推文千万不要误标——举报责任在举报人。'));
  if (!Object.keys(DB.candidates).length) {
    $main.append(h('section', { class: 'panel empty' }, h('strong', {}, '还没有候选链接'), h('p', {}, '先去搜索，结果会出现在这里。'),
      h('button', { class: 'btn primary', onclick: () => go('search') }, '去搜索')));
    return;
  }
  const sel = (val, opts, on) => h('select', { onchange: (e) => { on(e.target.value); r.cursor = 0; r.selected.clear(); render(); } },
    opts.map(([v, t]) => h('option', { value: v, selected: v === val }, t)));
  $main.append(h('div', { class: 'toolbar' },
    sel(r.book, [['', '全部作品'], ...books.map((b) => [b.id, '《' + b.title + '》'])], (v) => (r.book = v)),
    sel(r.status, [['pending', '待核'], ['open', '全部（不含正版）'], ['', '全部'], ...Object.entries(STATUSES).filter(([k]) => k !== 'pending').map(([k, s]) => [k, s.label])], (v) => (r.status = v)),
    sel(r.type, [['', '所有类型'], ...Object.entries(TYPES).map(([k, t]) => [k, t])], (v) => (r.type = v)),
    sel(r.sort, [['score', '按疑似度'], ['found', '按发现时间'], ['host', '按网站']], (v) => (r.sort = v)),
    h('span', { class: 'spacer' }),
    h('span', { class: 'keys' }, h('kbd', {}, 'J'), '/', h('kbd', {}, 'K'), ' 上下　', h('kbd', {}, 'O'), ' 打开　', h('kbd', {}, '1'), ' 盗文　', h('kbd', {}, '2'), ' 推文　', h('kbd', {}, '3'), ' 正版　', h('kbd', {}, '4'), ' 失效　', h('kbd', {}, '5'), ' 空壳　', h('kbd', {}, '6'), ' 无关　', h('kbd', {}, 'V'), ' 核验')
  ));

  const list = filteredCandidates();
  r.cursor = Math.min(r.cursor, Math.max(0, list.length - 1));
  for (const k of [...r.selected]) if (!list.some((c) => c.key === k)) r.selected.delete(k);

  if (r.selected.size) {
    const keys = [...r.selected];
    $main.append(h('div', { class: 'bulk' },
      h('strong', {}, `已选 ${keys.length} 条`),
      ...Object.entries(STATUSES).map(([s, d]) => h('button', { class: 'btn sm', onclick: () => { r.selected.clear(); setStatus(keys, s); } }, '标为' + d.label)),
      h('button', { class: 'btn sm', onclick: () => verifyKeys(keys) }, '核验所选'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn sm', onclick: () => { r.selected.clear(); render(); } }, '取消选择')
    ));
  }

  if (!list.length) {
    $main.append(h('section', { class: 'panel empty' }, h('strong', {}, '这个筛选条件下没有链接'), h('p', {}, '换个状态或作品看看。')));
    return;
  }

  const bookName = (id) => (books.find((b) => b.id === id) || {}).title || '';
  const allSel = list.every((c) => r.selected.has(c.key));
  const table = h('table', { class: 'table' },
    h('thead', {}, h('tr', {},
      h('th', { style: 'width:28px' }, h('input', { type: 'checkbox', 'aria-label': '全选', checked: allSel, onchange: (e) => { list.forEach((c) => e.target.checked ? r.selected.add(c.key) : r.selected.delete(c.key)); render(); } })),
      h('th', { style: 'width:56px' }, '状态'),
      h('th', {}, '链接'),
      h('th', { style: 'width:120px' }, '类型 / 来源'),
      h('th', { style: 'width:120px' }, '疑似度 / 核验'),
      h('th', { style: 'width:250px' }, '标记'))),
    h('tbody', {}, list.flatMap((c, i) => {
      const sc = c.score >= 7 ? 'hi' : c.score >= 4 ? 'mid' : 'lo';
      const vs = verifySummary(c.verify);
      const tr = h('tr', { class: i === r.cursor ? 'cur' : '', 'data-i': i, onclick: (e) => { if (e.target.closest('button,a,input')) return; r.cursor = i; markCursor(); } },
        h('td', {}, h('input', { type: 'checkbox', 'aria-label': '选择', checked: r.selected.has(c.key), onchange: (e) => { e.target.checked ? r.selected.add(c.key) : r.selected.delete(c.key); render(); } })),
        h('td', {}, h('span', { class: `st ${c.status}${r.justStamped === c.key ? ' just' : ''}`, title: STATUSES[c.status].hint }, c.status === 'piracy' ? '盗' : STATUSES[c.status].label)),
        h('td', {},
          h('a', { class: 'c-title', href: c.url, target: '_blank', rel: 'noreferrer' }, c.title || c.url),
          h('div', { class: 'c-url' }, c.url, c.unresolved ? '　（搜索引擎跳转链接，打开后请记录真实网址）' : ''),
          !r.book ? h('div', { class: 'c-url' }, '《' + bookName(c.bookId) + '》') : null,
          c.snippet ? h('div', { class: 'c-snip' }, c.snippet.slice(0, 140)) : null),
        h('td', {},
          h('span', { class: 'tag ' + c.type }, TYPES[c.type]),
          h('div', { class: 'c-url' }, c.engines.map((e) => ENGINES[e]?.name || e).join('、'))),
        h('td', {},
          h('span', { class: 'score ' + sc }, c.score + ' / 10'),
          vs ? h('div', { class: 'verify' + (c.verify?.hits ? ' hit' : '') }, vs) : null,
          c.evidence?.length ? h('div', { class: 'c-url' }, `已截图 ${c.evidence.length} 张`) : null,
          c.complaints?.length ? h('div', { class: 'done-mark' }, `已投诉 ${c.complaints.length} 次`) : null),
        h('td', {},
          h('div', { class: 'mark' }, Object.entries(STATUSES).filter(([s]) => s !== 'pending').map(([s, d]) =>
            h('button', { 'data-s': s, class: c.status === s ? 'on' : '', title: d.hint, onclick: () => setStatus([c.key], c.status === s ? 'pending' : s) }, d.label))),
          h('div', { class: 'row', style: 'margin-top:6px;gap:6px' },
            h('button', { class: 'btn sm', onclick: () => verifyKeys([c.key]) }, '核验'),
            h('button', { class: 'btn sm', onclick: () => captureKey(c.key) }, '截图取证'),
            h('button', { class: 'btn sm', onclick: () => { r.open.has(c.key) ? r.open.delete(c.key) : r.open.add(c.key); render(); } }, r.open.has(c.key) ? '收起' : '详情')))
      );
      if (!r.open.has(c.key)) return [tr];
      const note = h('textarea', { rows: 2, placeholder: '备注，例如：第 35 章开始是正文；需要手机打开' }, c.note || '');
      const detail = h('tr', { class: 'detail' }, h('td', {}), h('td', { colspan: 5 },
        h('div', {}, `首次发现：${c.foundAt}　最近出现：${c.lastSeen}`),
        h('div', {}, '搜索词：' + [...new Set((c.sources || []).map((s) => `${ENGINES[s.engine]?.name}「${s.query}」`))].join('；')),
        c.verify ? h('div', {}, `核验于 ${c.verify.at}：${vs}${c.verify.finalUrl && c.verify.finalUrl !== c.url ? '；跳转到 ' + c.verify.finalUrl : ''}`) : null,
        ...(c.evidence || []).map((e) => h('div', {}, `截图 ${e.at}：${e.file}`)),
        ...(c.complaints || []).map((x) => h('div', { class: 'done-mark' }, `已投诉 ${x.at.slice(0, 10)}：${x.platform}`)),
        h('div', { class: 'row', style: 'margin-top:6px' }, note,
          h('button', { class: 'btn sm', onclick: async () => {
            const { candidates } = await getAll(); candidates[c.key].note = note.value.trim(); await save({ candidates }); await refresh(false); toast('备注已保存');
          } }, '保存备注'),
          h('button', { class: 'btn sm danger', onclick: async () => {
            const { candidates } = await getAll(); delete candidates[c.key]; await save({ candidates }); await refresh();
          } }, '删除这条'))
      ));
      return [tr, detail];
    }))
  );
  $main.append(table);
}

function markCursor() {
  document.querySelectorAll('.table tbody tr[data-i]').forEach((tr) => tr.classList.toggle('cur', +tr.dataset.i === ui.review.cursor));
  const cur = document.querySelector('.table tr.cur');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}

document.addEventListener('keydown', (e) => {
  if (view !== 'review' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest('input, textarea, select')) return;
  const list = filteredCandidates();
  const r = ui.review;
  const c = list[r.cursor];
  const map = { '1': 'piracy', '2': 'promo', '3': 'official', '4': 'dead', '5': 'ad', '6': 'ignored' };
  if (e.key === 'j') { r.cursor = Math.min(list.length - 1, r.cursor + 1); markCursor(); }
  else if (e.key === 'k') { r.cursor = Math.max(0, r.cursor - 1); markCursor(); }
  else if (e.key === 'o' && c) chrome.tabs.create({ url: c.url, active: true });
  else if (e.key === 'v' && c) verifyKeys([c.key]);
  else if (map[e.key] && c) setStatus([c.key], map[e.key]);
  else return;
  e.preventDefault();
});

// =====================================================================
// 5 投诉材料
// =====================================================================
function noticeFor(book, platform, links) {
  const p = DB.profile;
  return fillVars(DB.settings.noticeTemplate || DEFAULT_NOTICE, {
    平台: platform || '（平台名称）',
    真实姓名: p.realName || '（真实姓名）',
    笔名: book.penName || '（笔名）',
    作品名: book.title,
    正版链接: book.url || '（正版链接）',
    首发时间: book.firstPublished || '（首发时间）',
    侵权链接: links.map((u, i) => `${i + 1}. ${u}`).join('\n'),
    手机: p.phone || '（手机）',
    邮箱: p.email || '（邮箱）',
    地址: p.address || '（地址）',
    日期: todayStr()
  });
}

async function recordComplaint(keys, platform) {
  const { candidates } = await getAll();
  const at = stamp();
  for (const k of keys) if (candidates[k]) candidates[k].complaints = [...(candidates[k].complaints || []), { platform, at }];
  await save({ candidates });
  await refresh();
  toast(`已记录：${keys.length} 条链接投诉到${platform}`);
}

function viewComplain() {
  const { books, settings } = DB;
  $main.append(head('投诉材料', '把已确认的盗文按投诉渠道分好组：每组可以复制链接、生成通知书、打开投诉页。提交、勾选协议和验证都由你在投诉页面里亲自完成。'));
  if (!books.length) { $main.append(h('section', { class: 'panel empty' }, h('strong', {}, '还没有作品'))); return; }
  if (!ui.complainBook || !books.some((b) => b.id === ui.complainBook)) ui.complainBook = books[0].id;
  const book = books.find((b) => b.id === ui.complainBook);
  const confirmed = Object.values(DB.candidates).filter((c) => c.bookId === book.id && c.status === 'piracy');

  $main.append(h('div', { class: 'toolbar' },
    h('select', { onchange: (e) => { ui.complainBook = e.target.value; render(); } }, books.map((b) => h('option', { value: b.id, selected: b.id === book.id }, '《' + b.title + '》'))),
    h('span', { class: 'note' }, `已确认盗文 ${confirmed.length} 条`),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn', onclick: () => exportCsv(book) }, '导出本书全部记录（CSV）')
  ));

  const missing = [];
  if (!DB.profile.realName) missing.push('真实姓名');
  if (!DB.profile.phone && !DB.profile.email) missing.push('联系方式');
  if (!book.url) missing.push('正版链接');
  if (missing.length) $main.append(h('div', { class: 'alert', style: 'margin:0 0 16px' }, `通知书还缺：${missing.join('、')}。`, h('a', { href: '#', onclick: (e) => { e.preventDefault(); go(missing.includes('正版链接') ? 'books' : 'profile'); } }, '去补充')));

  if (!confirmed.length) {
    $main.append(h('section', { class: 'panel empty' }, h('strong', {}, '这本书还没有确认的盗文'), h('p', {}, '在「人工审核」里把确认是盗文的链接标成「盗文」，它们会出现在这里。'),
      h('button', { class: 'btn primary', onclick: () => { ui.review.book = book.id; go('review'); } }, '去审核')));
    return;
  }

  const platformByEngine = Object.fromEntries(settings.platforms.filter((p) => p.engine).map((p) => [p.engine, p]));
  const anyPlatform = settings.platforms.filter((p) => p.tier === 'any');

  const groupBlock = (title, items, platformName, platformUrl, hint, extra) => {
    const urls = items.map((c) => c.url);
    const already = items.filter((c) => (c.complaints || []).some((x) => x.platform === platformName)).length;
    return h('div', { class: 'group' },
      h('h3', {}, `${title}（${items.length}）`, already ? h('span', { class: 'done-mark' }, `　其中 ${already} 条已投诉过${platformName}`) : null),
      hint ? h('div', { class: 'note', style: 'margin-bottom:6px' }, hint) : null,
      h('div', { class: 'links' }, urls.join('\n')),
      h('div', { class: 'row' },
        extra || null,
        platformUrl && !extra ? h('button', { class: 'btn sm primary', onclick: () => chrome.tabs.create({ url: platformUrl }) }, `打开${platformName}投诉页`) : null,
        h('button', { class: 'btn sm', onclick: () => copy(urls.join('\n'), `已复制 ${urls.length} 条链接`) }, '复制链接'),
        h('button', { class: 'btn sm', onclick: () => copy(noticeFor(book, platformName, urls), '已复制通知书') }, '复制通知书'),
        h('button', { class: 'btn sm', onclick: () => downloadText(`权利通知书_${safeName(book.title)}_${safeName(platformName)}_${todayStr()}.txt`, noticeFor(book, platformName, urls)) }, '下载通知书'),
        h('span', { class: 'spacer' }),
        platformName ? h('button', { class: 'btn sm', onclick: () => recordComplaint(items.map((c) => c.key), platformName) }, `记录为已投诉${platformName}`) : null
      )
    );
  };

  // 第一档：网页链接，按发现它的搜索引擎分组（向对应搜索平台投诉下架搜索结果）
  const web = confirmed.filter((c) => c.type === 'web');
  if (web.length) {
    const byEngine = {};
    for (const c of web) for (const e of c.engines) (byEngine[e] ||= []).push(c);
    $main.append(h('section', { class: 'panel tier' },
      h('h2', {}, '第一档　盗文网页', h('span', { class: 'count' }, web.length)),
      h('p', { class: 'note' }, '向发现它的搜索平台提交版权投诉，删除搜索结果；也可以走晋江提供的快速通道。同一条链接可能出现在多个平台，每个平台都要单独投诉。'),
      ...Object.entries(byEngine).map(([e, items]) => {
        const p = platformByEngine[e] || { name: ENGINES[e]?.name || e, url: '' };
        const extra = e === 'bing'
          ? h('button', { class: 'btn sm primary', title: '打开必应投诉表单并填好资料；勾选声明、签名和提交由你自己完成', onclick: () => bingOneClick(book, items) }, '一键填好必应表单')
          : e === 'quark'
            ? [h('button', { class: 'btn sm primary', onclick: () => quarkOneClick(book, items, 'search') }, '一键填好夸克表单'),
               h('button', { class: 'btn sm', onclick: () => openPrintableNotice(book, items.map((c) => c.url)) }, '可打印的通知书')]
            : null;
        const hint = e === 'bing' ? '必应表单是英文的，一次可直接填 10 条链接，更多会自动生成批量文件上传（最多 1000 条）。已投诉过必应的链接不会重复填入。'
          : e === 'quark' ? '在夸克侵权投诉平台（ipp.quark.cn）投诉，功能模块选「夸克搜索」。请先在平台的「实名认证」里添加好权利人。' : '';
        return groupBlock(`在${ENGINES[e]?.name || e}上发现`, items, e === 'quark' ? '夸克' : p.name, p.url, hint, extra);
      }),
      ...anyPlatform.map((p) => groupBlock('全部盗文网页', web, p.name, p.url, '通用渠道：包含本书所有已确认的盗文网页'))
    ));
  }

  // 第二档：网盘，按网盘服务商分组
  const nd = confirmed.filter((c) => c.type === 'netdisk');
  if (nd.length) {
    const byProv = {};
    for (const c of nd) (byProv[c.provider] ||= []).push(c);
    $main.append(h('section', { class: 'panel tier' },
      h('h2', {}, '第二档　网盘链接', h('span', { class: 'count' }, nd.length)),
      h('p', { class: 'note' }, '按网盘服务商分别投诉。投诉入口在各网盘的分享页或帮助中心，可以在「设置」里把常用入口填进去。'),
      ...Object.entries(byProv).map(([prov, items]) => {
        if (prov === 'pan.quark.cn') {
          return groupBlock('夸克网盘', items, '夸克', '', '在夸克侵权投诉平台（ipp.quark.cn）投诉，功能模块选「夸克网盘」。请先在平台的「实名认证」里添加好权利人。链接带提取码的，在审核详情的备注里写「提取码：xxxx」，会自动填进访问码。',
            [h('button', { class: 'btn sm primary', onclick: () => quarkOneClick(book, items, 'netdisk') }, '一键填好夸克表单'),
             h('button', { class: 'btn sm', onclick: () => openPrintableNotice(book, items.map((c) => c.url)) }, '可打印的通知书')]);
        }
        const p = settings.platforms.find((x) => x.name === prov) || { name: prov, url: '' };
        return groupBlock(prov, items, p.name, p.url);
      })
    ));
  }

  // 社交平台
  const so = confirmed.filter((c) => c.type === 'social');
  if (so.length) {
    const byProv = {};
    for (const c of so) (byProv[c.provider] ||= []).push(c);
    $main.append(h('section', { class: 'panel tier' },
      h('h2', {}, '社交平台', h('span', { class: 'count' }, so.length)),
      h('p', { class: 'note' }, '社交平台一般要在每条内容上单独投诉。请再确认一遍：只推荐、不放正文和资源的推文不要投诉。'),
      ...Object.entries(byProv).map(([prov, items]) => {
        const p = settings.platforms.find((x) => x.name === prov || x.engine === 'weibo' && /weibo/.test(prov)) || { name: prov, url: '' };
        return groupBlock(prov, items, p.name, p.url);
      })
    ));
  }

  // 第三档：域名与服务商
  const domains = [...new Set(web.map((c) => c.host))].sort();
  if (domains.length) {
    $main.append(h('section', { class: 'panel tier' },
      h('h2', {}, '第三档　网站域名', h('span', { class: 'count' }, domains.length)),
      h('p', { class: 'note' }, '查询域名的注册商和托管服务商，再向服务商提交侵权投诉（海外服务商需要英文材料）。下面的链接打开公开的 ICANN 域名查询。'),
      h('table', { class: 'table' }, h('tbody', {}, domains.map((d) => {
        const n = web.filter((c) => c.host === d).length;
        const parts = d.split('.');
        const root = parts.slice(/^(com|net|org|gov|edu)\.(cn|hk|tw)$/.test(parts.slice(-2).join('.')) ? -3 : -2).join('.');
        return h('tr', {},
          h('td', {}, d),
          h('td', { class: 'note' }, `${n} 条盗文`),
          h('td', {}, h('a', { href: `https://lookup.icann.org/en/lookup?name=${encodeURIComponent(root)}`, target: '_blank', rel: 'noreferrer' }, '查询 ' + root)));
      }))),
      h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn sm', onclick: () => copy(domains.join('\n'), `已复制 ${domains.length} 个域名`) }, '复制域名清单'))
    ));
  }

  // 通知书预览
  $main.append(h('section', { class: 'panel' },
    h('h2', {}, '通知书预览', h('small', {}, '模板可在「设置」里修改')),
    h('pre', { class: 'notice' }, noticeFor(book, '（平台名称）', confirmed.map((c) => c.url)))
  ));
}

// 一键填好必应表单：只填写，不勾选声明、不签名、不提交
async function bingOneClick(book, items) {
  const p = DB.profile;
  const fresh = items.filter((c) => !(c.complaints || []).some((x) => x.platform === '必应'));
  if (!fresh.length) { toast('这些链接都已经投诉过必应了'); return; }
  const missing = [];
  if (!p.realName && !(p.nameLastEn && p.nameFirstEn)) missing.push('姓名');
  if (!p.email) missing.push('邮箱');
  if (missing.length) { toast(`必应表单需要${missing.join('和')}，请先在「作者资料」里填写`); return; }
  const list = fresh.slice(0, 1000);
  if (fresh.length > 1000) toast('必应一次最多 1000 条，本次先填前 1000 条');
  const urls = list.map((c) => c.url);
  const lastName = p.nameLastEn || (p.realName || '').slice(0, 1);
  const firstName = p.nameFirstEn || (p.realName || '').slice(1);
  const pinyin = p.nameLastEn && p.nameFirstEn ? `${p.nameFirstEn} ${p.nameLastEn}` : '';
  const ownerName = p.realName ? (pinyin ? `${p.realName} (${pinyin})` : p.realName) : pinyin;
  const description = fillVars(DB.settings.bingDescription || DEFAULT_BING_DESCRIPTION, {
    作品名: book.title, 笔名: book.penName || '-', 首发日期: (book.firstPublished || '').slice(0, 10) || '(date)', 正版链接: book.url || 'https://www.jjwxc.net/'
  });
  const english = [
    'NOTICE OF COPYRIGHT INFRINGEMENT',
    '',
    `Copyright owner: ${ownerName}`,
    `Pen name: ${book.penName || '-'}`,
    `Work: "${book.title}", a Chinese web novel first published on jjwxc.net${book.firstPublished ? ' on ' + book.firstPublished.slice(0, 10) : ''}`,
    `Original (authorized) location: ${book.url || '-'}`,
    `Contact email: ${p.email}`,
    '',
    'Infringing URLs (verified manually by the copyright owner):',
    ...urls.map((u, i) => `${i + 1}. ${u}`),
    '',
    `Date: ${todayStr()}`
  ].join('\n');
  const attachment = { name: `rights_notice_${book.novelId || safeName(book.title)}_${todayStr()}.txt`, text: '\ufeff' + english + '\n\n\n' + noticeFor(book, '必应（Microsoft Bing）', urls) };
  const additional = `Original work: ${book.url || '-'}\nEach URL was opened and checked by the copyright owner before submission (${todayStr()}).`;

  toast('正在打开必应投诉表单…');
  const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
  await chrome.tabs.update(tab.id, { url: BING_FORM_URL });
  await new Promise((r) => setTimeout(r, 300));
  await waitTabComplete(tab.id, 30000);
  await new Promise((r) => setTimeout(r, 1500));
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: bingFill,
      args: [{ firstName, lastName, ownerName, country: 'China', email: p.email, title: book.title, exampleUrl: book.url, description, urls, attachment, additional, keys: list.map((c) => c.key) }]
    });
    const r = res && res.result;
    if (r && r.missing.length) toast('有几项没找到，可能必应改版了：' + r.missing.join('、'));
  } catch (e) {
    toast('填写失败：' + (e.message || e) + '。可以用「复制链接」手动填写。');
  }
}

// ---------- 一键填好夸克表单（ipp.quark.cn）：只填写，不上传文件、不提交 ----------
function quarkCode(c) {
  try { const v = new URL(c.url).searchParams.get('pwd'); if (v) return v; } catch {}
  const m = String(c.note || '').match(/(?:提取码|访问码|密码|pwd)\s*[:：=]?\s*([A-Za-z0-9]{4,8})/i);
  return m ? m[1] : '';
}

function openPrintableNotice(book, urls) {
  const text = noticeFor(book, '夸克（阿里巴巴）', urls) + '\n\n\n权利人签名：＿＿＿＿＿＿＿＿＿＿　　日期：＿＿＿＿＿＿＿＿';
  const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const html = `<!doctype html><meta charset="utf-8"><title>权利通知书_${esc(book.title)}</title>
<style>@page{size:A4;margin:22mm}body{font:15px/1.9 "Songti SC","STSong","Noto Serif CJK SC",serif;color:#000;max-width:170mm;margin:24px auto;white-space:pre-wrap;word-break:break-all}
.tip{font:13px/1.6 sans-serif;background:#F5ECCB;padding:10px 14px;border-radius:6px;white-space:normal;margin-bottom:20px}@media print{.tip{display:none}}</style>
<div class="tip">打印这一页，签名后扫描或拍照，上传到投诉表单的「证明文件」。也可以在打印对话框里选「另存为 PDF」，再用电子签名。这条提示不会被打印。</div>${esc(text)}`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  chrome.tabs.create({ url });
}

async function quarkOneClick(book, items, module) {
  const fresh = items.filter((c) => !(c.complaints || []).some((x) => x.platform === '夸克'));
  if (!fresh.length) { toast('这些链接都已经投诉过夸克了'); return; }
  const list = fresh.slice(0, 50);
  if (fresh.length > 50) toast('一次最多填 50 条，本次先填前 50 条');
  const p = DB.profile;
  const description = `本人${p.realName ? p.realName + '（笔名' + (book.penName || '') + '）' : '（笔名' + (book.penName || '') + '）'}是网络小说《${book.title}》的著作权人，作品首发于晋江文学城 ${book.url || ''}${book.firstPublished ? '，首发时间 ' + book.firstPublished.slice(0, 10) : ''}。` +
    `以上${module === 'netdisk' ? '夸克网盘分享链接' : '网页'}未经本人许可，提供该作品的正文内容，侵犯了本人的信息网络传播权。每条链接均经本人打开核实。请删除或断开链接。`;
  toast('正在打开夸克侵权投诉平台…');
  const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
  await chrome.tabs.update(tab.id, { url: QUARK_IPP_URL });
  await new Promise((r) => setTimeout(r, 300));
  await waitTabComplete(tab.id, 30000);
  await new Promise((r) => setTimeout(r, 1500));
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: quarkFill,
      args: [{ module, urls: list.map((c) => c.url), codes: list.map(quarkCode), title: book.title, description, holderName: p.realName || '', keys: list.map((c) => c.key) }]
    });
    const r = res && res.result;
    if (r && r.missing.length) toast('需要你处理：' + r.missing.join('；'));
  } catch (e) {
    toast('填写失败：' + (e.message || e) + '。可以用填写助手或「复制链接」手动填写。');
  }
}

// =====================================================================
// 6 投诉跟踪：已投诉的链接一览 + 复查
// =====================================================================
const track = { book: '', filter: '', busy: false, progress: '' };
const RECHECK = { gone: '已失效', alive: '仍可访问', unclear: '待确认' };
const lastComplaint = (c) => (c.complaints || []).map((x) => x.at).sort().slice(-1)[0] || '';
const daysSince = (s) => (s ? Math.floor((Date.now() - Date.parse(s.replace(' ', 'T'))) / 864e5) : null);

// 投诉之后，发现它的那些搜索词有没有重新搜过、还搜不搜得到
function searchAfter(c, queryRuns) {
  const lc = lastComplaint(c);
  const runs = (c.sources || []).map((src) => queryRuns[c.bookId + '|' + src.engine + '|' + src.query]).filter(Boolean);
  const rechecked = runs.some((t) => t > lc);
  if (!rechecked) return { state: 'none', text: '投诉后还没重新搜过' };
  if (c.lastSeen > lc) return { state: 'seen', text: `投诉后仍搜得到（${c.lastSeen.slice(5, 16)}）` };
  return { state: 'clear', text: '投诉后重新搜索时没再出现' };
}

async function recheckKeys(keys) {
  if (track.busy) return;
  if (!(await requestAllUrls())) { toast('需要允许访问网站才能复查链接'); return; }
  track.busy = true;
  try {
    let i = 0;
    for (const k of keys) {
      i++;
      const c = DB.candidates[k];
      if (!c) continue;
      track.progress = `复查中 ${i}/${keys.length}：${c.host}`;
      if (view === 'track') render();
      const book = DB.books.find((b) => b.id === c.bookId) || {};
      const r = await recheckLink(c, book, { mobile: DB.settings.mobileMode });
      const { candidates } = await getAll();
      if (candidates[k]) {
        candidates[k].recheck = r;
        candidates[k].recheckHistory = [...(candidates[k].recheckHistory || []), r].slice(-10);
        await save({ candidates });
      }
      await refresh(false);
      if (i < keys.length) await new Promise((res) => setTimeout(res, DB.settings.verifyDelay * 1000));
    }
    toast('复查完成');
  } finally {
    track.busy = false;
    track.progress = '';
    if (view === 'track') render();
  }
}

function planSearchRecheck(list) {
  const seen = new Set();
  const items = [];
  for (const c of list) {
    const b = DB.books.find((x) => x.id === c.bookId);
    if (!b) continue;
    for (const src of c.sources || []) {
      if (!ENGINES[src.engine]) continue;
      const k = c.bookId + '|' + src.engine + '|' + src.query;
      if (seen.has(k)) continue;
      seen.add(k);
      items.push({ bookId: b.id, bookTitle: b.title, engine: src.engine, query: src.query, page: 0 });
    }
  }
  return items;
}

async function viewTrack() {
  const my = (track.seq = (track.seq || 0) + 1);
  const { queryRuns = {} } = await chrome.storage.local.get('queryRuns');
  if (view !== 'track' || my !== track.seq) return; // 期间又触发了一次重绘，以最新那次为准
  $main.replaceChildren();
  const { books } = DB;
  $main.append(head('投诉跟踪', '所有记录过「已投诉」的链接。可以复查链接还能不能打开，也可以把当初找到它的搜索词再搜一遍，看投诉后还搜不搜得到。'));
  let all = Object.values(DB.candidates).filter((c) => (c.complaints || []).length);
  if (!all.length) {
    $main.append(h('section', { class: 'panel empty' }, h('strong', {}, '还没有投诉记录'),
      h('p', {}, '在「投诉材料」或一键填写的提示条上点「记录投诉」后，链接会出现在这里。'),
      h('button', { class: 'btn primary', onclick: () => go('complain') }, '去投诉材料')));
    return;
  }
  if (track.book) all = all.filter((c) => c.bookId === track.book);
  const stateOf = (c) => (c.recheck ? c.recheck.state : 'never');
  const counts = { alive: 0, gone: 0, unclear: 0, never: 0 };
  all.forEach((c) => counts[stateOf(c)]++);
  let list = track.filter ? all.filter((c) => stateOf(c) === track.filter) : all;
  const order = { alive: 0, unclear: 1, never: 2, gone: 3 };
  list.sort((a, b) => order[stateOf(a)] - order[stateOf(b)] || lastComplaint(b).localeCompare(lastComplaint(a)));

  const sel = (val, opts, on) => h('select', { onchange: (e) => { on(e.target.value); render(); } }, opts.map(([v, t]) => h('option', { value: v, selected: v === val }, t)));
  $main.append(h('div', { class: 'toolbar' },
    sel(track.book, [['', '全部作品'], ...books.map((b) => [b.id, '《' + b.title + '》'])], (v) => (track.book = v)),
    sel(track.filter, [['', `全部（${all.length}）`], ['alive', `仍可访问（${counts.alive}）`], ['unclear', `待确认（${counts.unclear}）`], ['never', `还没复查（${counts.never}）`], ['gone', `已失效（${counts.gone}）`]], (v) => (track.filter = v)),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn', disabled: track.busy || !list.length, onclick: () => recheckKeys(list.map((c) => c.key)) }, `复查链接（${list.length}）`),
    h('button', { class: 'btn', disabled: runState.running || !list.length, title: '把当初找到这些链接的搜索词再搜一遍（计入每日搜索次数）', onclick: () => {
      const items = planSearchRecheck(list);
      if (!items.length) { toast('这些链接没有可重搜的搜索词'); return; }
      runner.start(items);
      toast(`开始重搜 ${items.length} 个搜索词，进度在「搜索盗文」里`);
    } }, '重新搜索'),
    h('button', { class: 'btn', onclick: () => exportTrackCsv(all, queryRuns) }, '导出表格（CSV）')
  ));
  if (track.progress) $main.append(h('div', { class: 'alert', style: 'margin:0 0 12px' }, track.progress));
  if (runState.running) $main.append(h('div', { class: 'alert', style: 'margin:0 0 12px' }, `正在搜索 ${runState.done}/${runState.total}，完成后这里的「搜索结果」一栏会更新。`));

  if (!list.length) { $main.append(h('section', { class: 'panel empty' }, h('strong', {}, '这个筛选条件下没有链接'))); return; }
  const bookName = (id) => (books.find((b) => b.id === id) || {}).title || '';
  $main.append(h('table', { class: 'table' },
    h('thead', {}, h('tr', {},
      h('th', { style: 'width:84px' }, '链接状态'), h('th', {}, '链接'), h('th', { style: 'width:190px' }, '投诉记录'),
      h('th', { style: 'width:170px' }, '搜索结果'), h('th', { style: 'width:150px' }, ''))),
    h('tbody', {}, list.map((c) => {
      const st = stateOf(c);
      const sa = searchAfter(c, queryRuns);
      const d = daysSince(lastComplaint(c));
      return h('tr', {},
        h('td', {},
          h('span', { class: 'rc ' + st }, st === 'never' ? '未复查' : RECHECK[st]),
          c.recheck ? h('div', { class: 'c-url' }, c.recheck.at.slice(5, 16)) : null),
        h('td', {},
          h('a', { class: 'c-title', href: c.url, target: '_blank', rel: 'noreferrer' }, c.url),
          h('div', { class: 'c-url' }, `《${bookName(c.bookId)}》　${TYPES[c.type]}${c.recheck && c.recheck.detail ? '　' + c.recheck.detail : ''}`)),
        h('td', {},
          ...(c.complaints || []).map((x) => h('div', { class: 'c-url' }, `${x.at.slice(0, 10)}　${x.platform}`)),
          d !== null ? h('div', { class: 'note' }, `距最近一次投诉 ${d} 天`) : null),
        h('td', {}, h('span', { class: 'sa ' + sa.state }, sa.text)),
        h('td', {}, h('div', { class: 'row', style: 'gap:6px' },
          h('button', { class: 'btn sm', disabled: track.busy, onclick: () => recheckKeys([c.key]) }, '复查'),
          h('button', { class: 'btn sm', onclick: () => captureKey(c.key) }, '截图'),
          st === 'gone' ? null : h('button', { class: 'btn sm', title: '回到投诉材料再投一次', onclick: () => { ui.complainBook = c.bookId; go('complain'); } }, '再投诉'))));
    }))
  ));
  $main.append(h('p', { class: 'note', style: 'margin-top:10px' }, '「链接状态」看的是链接本身还能不能打开、里面还有没有你的正文；「搜索结果」看的是投诉后重新搜索时它还在不在搜索结果里。投诉通常需要几天处理，建议投诉一周后再复查。'));
}

function exportTrackCsv(list, queryRuns) {
  const head = ['作品', '类型', '链接', '投诉记录', '链接状态', '复查时间', '复查说明', '搜索结果'];
  const rows = list.map((c) => [
    (DB.books.find((b) => b.id === c.bookId) || {}).title || '', TYPES[c.type], c.url,
    (c.complaints || []).map((x) => `${x.at.slice(0, 10)} ${x.platform}`).join(' ; '),
    c.recheck ? RECHECK[c.recheck.state] : '未复查', c.recheck ? c.recheck.at : '', c.recheck ? c.recheck.detail : '',
    searchAfter(c, queryRuns).text
  ]);
  downloadText(`投诉跟踪_${todayStr()}.csv`, [head, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n'), 'text/csv;charset=utf-8');
}

function exportCsv(book) {
  const rows = Object.values(DB.candidates).filter((c) => c.bookId === book.id);
  const headRow = ['状态', '类型', '服务商/网站', '链接', '标题', '发现于', '发现时间', '最近出现', '核验', '截图', '投诉记录', '备注'];
  const body = rows.map((c) => [
    STATUSES[c.status].label, TYPES[c.type], c.provider, c.url, c.title,
    c.engines.map((e) => ENGINES[e]?.name || e).join('/'), c.foundAt, c.lastSeen, verifySummary(c.verify),
    (c.evidence || []).map((e) => e.file).join(' ; '),
    (c.complaints || []).map((x) => `${x.at.slice(0, 10)} ${x.platform}`).join(' ; '), c.note
  ]);
  downloadText(`打盗记录_${safeName(book.title)}_${todayStr()}.csv`, [headRow, ...body].map((r) => r.map(csvEscape).join(',')).join('\n'), 'text/csv;charset=utf-8');
}

// =====================================================================
// 设置
// =====================================================================
function viewSettings() {
  const s = DB.settings;
  const num = (v, min, max) => h('input', { type: 'number', value: v, min, max });
  const f = {
    pages: num(s.pages, 1, 5),
    minDelay: num(s.minDelay, 5, 600),
    maxDelay: num(s.maxDelay, 5, 900),
    maxQueriesPerRun: num(s.maxQueriesPerRun, 1, 500),
    dailyLimit: num(s.dailyLimit, 1, 2000),
    verifyDelay: num(s.verifyDelay, 1, 60),
    mobileMode: h('input', { type: 'checkbox', checked: s.mobileMode }),
    queryTemplates: h('textarea', { rows: 6 }, s.queryTemplates.join('\n')),
    whitelist: h('textarea', { rows: 5 }, s.whitelist.join('\n')),
    netdisk: h('textarea', { rows: 5 }, s.netdisk.join('\n')),
    social: h('textarea', { rows: 5 }, s.social.join('\n')),
    noticeTemplate: h('textarea', { rows: 14 }, s.noticeTemplate),
    bingDescription: h('textarea', { rows: 6 }, s.bingDescription || DEFAULT_BING_DESCRIPTION)
  };
  const engChecks = Object.fromEntries(Object.keys(ENGINES).map((k) => [k, h('input', { type: 'checkbox', checked: !!s.engines[k] })]));
  const plats = s.platforms.map((p) => ({ ...p }));
  const platRows = h('tbody');
  const drawPlats = () => platRows.replaceChildren(...plats.map((p, i) => h('tr', {},
    h('td', {}, h('input', { type: 'text', value: p.name, oninput: (e) => (p.name = e.target.value) })),
    h('td', {}, h('input', { type: 'url', value: p.url, placeholder: '投诉页面地址（从作者区教程里找，自己核对后填写）', oninput: (e) => (p.url = e.target.value) })),
    h('td', { style: 'width:60px' }, h('button', { class: 'btn sm danger', onclick: () => { plats.splice(i, 1); drawPlats(); } }, '删除'))
  )));
  drawPlats();

  $main.append(head('设置与备份', '调整搜索节奏、链接分类规则、投诉入口和通知书模板。'));
  $main.append(h('section', { class: 'panel' },
    h('h2', {}, '搜索节奏', h('small', {}, '太快会被搜索引擎软封禁，之后什么都搜不出来')),
    h('div', { class: 'grid3' },
      field('每个搜索词翻几页', f.pages), field('最短间隔（秒）', f.minDelay), field('最长间隔（秒）', f.maxDelay),
      field('单轮最多搜索次数', f.maxQueriesPerRun), field('每天最多搜索次数', f.dailyLimit), field('核验间隔（秒）', f.verifyDelay)),
    h('label', { class: 'check', style: 'margin-top:12px' }, f.mobileMode, '用手机身份搜索、核验和截图（很多盗文站只在手机上显示正文）'),
    h('h2', { style: 'margin-top:18px' }, '默认勾选的搜索入口'),
    h('div', { class: 'chips' }, Object.entries(ENGINES).map(([k, e]) => h('label', { class: 'check' }, engChecks[k], e.name))),
    h('div', { style: 'margin-top:14px' }, field('搜索词模板（一行一个）', f.queryTemplates, '可用变量：{书名} {笔名} {旧书名} {指纹句}。带 {旧书名} 或 {指纹句} 的模板会按每个旧书名、每句指纹各生成一条。', true))
  ));
  $main.append(h('section', { class: 'panel' },
    h('h2', {}, '链接分类规则', h('small', {}, '带点的按域名后缀匹配，不带点的按包含匹配')),
    h('div', { class: 'grid3' },
      field('正版渠道（自动排除）', f.whitelist, '请把晋江的合作渠道站、wap 地址都加进来，避免误打渠道商'),
      field('网盘', f.netdisk),
      field('社交平台', f.social))
  ));
  $main.append(h('section', { class: 'panel' },
    h('h2', {}, '投诉入口', h('small', {}, '名称和搜索入口同名时会自动对应；网盘名称写成域名（如 pan.quark.cn）会对应到该网盘分组')),
    h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, '名称'), h('th', {}, '投诉页地址'), h('th', {}))), platRows),
    h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn sm', onclick: () => { plats.push({ name: '', tier: 'any', engine: '', url: '' }); drawPlats(); } }, '添加入口'))
  ));
  $main.append(h('section', { class: 'panel' },
    h('h2', {}, '通知书模板'),
    field('', f.noticeTemplate, '可用变量：{{平台}} {{真实姓名}} {{笔名}} {{作品名}} {{正版链接}} {{首发时间}} {{侵权链接}} {{手机}} {{邮箱}} {{地址}} {{日期}}', true),
    h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn sm', onclick: () => { f.noticeTemplate.value = DEFAULT_NOTICE; } }, '恢复默认模板')),
    h('h2', { style: 'margin-top:20px' }, '必应表单的英文说明'),
    field('', f.bingDescription, '填进必应表单的 Description 栏。可用变量：{{作品名}} {{笔名}} {{首发日期}} {{正版链接}}', true),
    h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn sm', onclick: () => { f.bingDescription.value = DEFAULT_BING_DESCRIPTION; } }, '恢复默认说明'))
  ));

  $main.append(h('div', { class: 'row', style: 'margin-bottom:24px' },
    h('button', { class: 'btn primary', onclick: async () => {
      const n = (el, d) => (Number.isFinite(+el.value) && el.value !== '' ? +el.value : d);
      const settings = mergeDefaults({
        ...s,
        pages: n(f.pages, 1), minDelay: n(f.minDelay, 20), maxDelay: Math.max(n(f.maxDelay, 45), n(f.minDelay, 20)),
        maxQueriesPerRun: n(f.maxQueriesPerRun, 30), dailyLimit: n(f.dailyLimit, 120), verifyDelay: n(f.verifyDelay, 4),
        mobileMode: f.mobileMode.checked,
        engines: Object.fromEntries(Object.entries(engChecks).map(([k, el]) => [k, el.checked])),
        queryTemplates: lines(f.queryTemplates.value),
        whitelist: lines(f.whitelist.value), netdisk: lines(f.netdisk.value), social: lines(f.social.value),
        platforms: plats.filter((p) => p.name.trim()).map((p) => ({ ...p, name: p.name.trim(), url: p.url.trim() })),
        noticeTemplate: f.noticeTemplate.value,
        bingDescription: f.bingDescription.value
      });
      await save({ settings });
      // 分类规则变了：重新给候选链接分类（不改动已人工标记的状态）
      const { candidates, books } = await getAll();
      for (const c of Object.values(candidates)) {
        const cls = classify(c.url, settings);
        c.type = cls.type; c.provider = cls.provider;
        if (cls.type === 'official' && c.status === 'pending') c.status = 'official';
        const b = books.find((x) => x.id === c.bookId);
        if (b) c.score = Math.max(c.score, scoreResult({ title: c.title, snippet: c.snippet, type: c.type }, b));
      }
      await save({ candidates });
      searchSel.engines = null;
      await refresh();
      toast('设置已保存');
    } }, '保存设置')
  ));

  const fileIn = h('input', { type: 'file', accept: 'application/json', style: 'display:none', onchange: async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || data.app !== 'dadao') throw new Error('不是打盗工作台的备份文件');
      if (!confirm('导入会覆盖当前的全部资料，确定吗？')) return;
      await chrome.storage.local.clear();
      await save({ profile: data.profile || {}, books: data.books || [], candidates: data.candidates || {}, settings: data.settings || {}, usage: data.usage || {} });
      await refresh();
      toast('备份已导入');
    } catch (err) { toast('导入失败：' + err.message); }
  } });
  $main.append(h('section', { class: 'panel' },
    h('h2', {}, '备份与清除'),
    h('p', { class: 'note' }, '备份文件包含你的真实姓名和联系方式，请妥善保管，不要发给别人。'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: async () => {
        const all = await getAll();
        downloadText(`打盗工作台备份_${todayStr()}.json`, JSON.stringify({ app: 'dadao', version: 1, exportedAt: stamp(), ...all }, null, 2), 'application/json');
      } }, '导出备份'),
      h('button', { class: 'btn', onclick: () => fileIn.click() }, '导入备份'), fileIn,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn danger', onclick: async () => {
        if (!confirm('清除全部资料、作品和链接记录？建议先导出备份。')) return;
        await chrome.storage.local.clear();
        await refresh();
        toast('已清除');
      } }, '清除全部数据')
    ),
    h('p', { class: 'note', style: 'margin-top:12px' }, '访问网站权限：', h('span', { id: 'permState' }, '检查中…'))
  ));
  hasAllUrls().then((ok) => {
    const el = document.getElementById('permState');
    if (el) el.textContent = ok ? '已允许（用于核验页面内容和截图取证）。如需收回，可在 Chrome 扩展详情页里关闭。' : '未允许。第一次核验或截图时会询问你。';
  });
}

// ---------- 启动 ----------
// 填写助手或另一个工作台标签页改了数据时同步过来；表单页面不自动重绘，以免冲掉正在编辑的内容
let syncTimer;
chrome.storage.onChanged.addListener((changes) => {
  if (!['candidates', 'settings', 'books', 'profile', 'queryRuns'].some((k) => k in changes)) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    if (changes.settings) searchSel.engines = null;
    await refresh(false);
    if (['review', 'complain'].includes(view) || (view === 'track' && !track.busy) || (view === 'search' && !runState.running)) render();
  }, 150);
});
window.addEventListener('hashchange', () => {
  const v = location.hash.slice(1);
  if (v && v !== view) { view = v; render(); }
});
window.addEventListener('beforeunload', (e) => { if (runState.running) { e.preventDefault(); e.returnValue = ''; } });
refresh();
