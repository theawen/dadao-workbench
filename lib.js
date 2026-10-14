// 共享逻辑：存储、默认设置、链接分类、查询生成、模板填充
// 工作台页面以 ES module 方式引入；不在内容脚本里使用。

export const ENGINES = {
  baidu:   { name: '百度',   url: (q, p) => `https://www.baidu.com/s?wd=${q}&pn=${p * 10}`, host: 'www.baidu.com' },
  quark:   { name: '夸克',   url: (q, p) => `https://quark.sm.cn/s?q=${q}${p ? `&page=${p + 1}` : ''}`, host: 'quark.sm.cn' },
  bing:    { name: '必应',   url: (q, p) => `https://cn.bing.com/search?q=${q}&first=${p * 10 + 1}`, host: 'cn.bing.com' },
  sogou:   { name: '搜狗',   url: (q, p) => `https://www.sogou.com/web?query=${q}&page=${p + 1}`, host: 'www.sogou.com' },
  so360:   { name: '360',    url: (q, p) => `https://www.so.com/s?q=${q}&pn=${p + 1}`, host: 'www.so.com' },
  toutiao: { name: '头条/悟空', url: (q, p) => `https://so.toutiao.com/search?keyword=${q}&pd=synthesis&page_num=${p}`, host: 'so.toutiao.com' },
  weibo:   { name: '微博',   url: (q, p) => `https://s.weibo.com/weibo?q=${q}&page=${p + 1}`, host: 's.weibo.com' }
};

export const STATUSES = {
  pending:  { label: '待核', hint: '还没人工确认' },
  piracy:   { label: '盗文', hint: '确认含有正文的盗版页面' },
  promo:    { label: '推文', hint: '只推荐、不放正文或资源' },
  official: { label: '正版', hint: '晋江或合作渠道' },
  dead:     { label: '失效', hint: '404 或已删除' },
  ad:       { label: '空壳', hint: '有关键词但只有广告' },
  ignored:  { label: '无关', hint: '与作品无关' }
};

export const TYPES = {
  web:      '网页',
  netdisk:  '网盘',
  social:   '社交平台',
  official: '正版渠道'
};

export const DEFAULT_NOTICE = `权利通知书

致：{{平台}}

本人{{真实姓名}}（笔名：{{笔名}}）是作品《{{作品名}}》的著作权人（或经授权的权利人）。该作品首发于 {{正版链接}}，首发时间 {{首发时间}}。

经核查，下列网络地址未经许可提供上述作品内容，侵犯了本人对该作品享有的信息网络传播权：
{{侵权链接}}

请依据《信息网络传播权保护条例》等相关规定，删除上述内容或断开相关链接。

随附材料：身份证明、权属证明（签约合同或授权文件）、侵权页面截图。

本人承诺：本通知所述内容真实，如有不实，愿承担相应法律责任。

权利人：{{真实姓名}}
联系电话：{{手机}}
电子邮箱：{{邮箱}}
通讯地址：{{地址}}
日期：{{日期}}`;

export const DEFAULT_SETTINGS = {
  engines: { baidu: true, quark: true, bing: true, sogou: false, so360: false, toutiao: false, weibo: false },
  queryTemplates: [
    '"{书名}"',
    '"{书名}" {笔名}',
    '"{书名}" 全文阅读',
    '"{书名}" txt',
    '"{旧书名}"',
    '"{指纹句}"'
  ],
  pages: 1,
  minDelay: 20,
  maxDelay: 45,
  maxQueriesPerRun: 30,
  dailyLimit: 120,
  mobileMode: false,
  verifyDelay: 4,
  whitelist: ['jjwxc.net', 'jjwxc.com'],
  netdisk: [
    'pan.baidu.com', 'yun.baidu.com', 'pan.quark.cn', 'alipan.com', 'aliyundrive.com',
    '123pan.com', '123pan.cn', '123684.com', '123865.com', '123912.com', '115.com', '115cdn.com',
    'pan.xunlei.com', 'cloud.189.cn', 'caiyun.139.com', 'yun.139.com', 'weiyun.com',
    'ctfile.com', 'feijipan.com', 'pan.uc.cn', 'drive.uc.cn', 'lanzou'
  ],
  social: [
    'weibo.com', 'weibo.cn', 'xiaohongshu.com', 'xhslink.com', 'douban.com', 'zhihu.com',
    'bilibili.com', 'b23.tv', 'douyin.com', 'iesdouyin.com', 'kuaishou.com', 'lofter.com',
    'tieba.baidu.com', 'mp.weixin.qq.com', 'toutiao.com', 'baijiahao.baidu.com', 'haokan.baidu.com'
  ],
  platforms: [
    { name: '百度', tier: 'web', engine: 'baidu', url: '' },
    { name: '夸克', tier: 'web', engine: 'quark', url: '' },
    { name: '必应', tier: 'web', engine: 'bing', url: 'https://www.bing.com/webmaster/contentremovalform/showcontentremovalform' },
    { name: '搜狗', tier: 'web', engine: 'sogou', url: '' },
    { name: '360', tier: 'web', engine: 'so360', url: '' },
    { name: '头条/悟空', tier: 'web', engine: 'toutiao', url: '' },
    { name: '微博', tier: 'social', engine: 'weibo', url: '' },
    { name: '晋江快速通道', tier: 'any', engine: '', url: '' }
  ],
  noticeTemplate: DEFAULT_NOTICE
};

export const PIRACY_WORDS = ['全文', '免费阅读', '在线阅读', '阅读', 'txt', '下载', '最新章节', '笔趣阁', '无弹窗', '全本', '完结', '小说网', '番外', '百度网盘', '网盘', '资源'];

// ---------- 存储 ----------
export async function load(keys) {
  return chrome.storage.local.get(keys);
}
export async function save(obj) {
  return chrome.storage.local.set(obj);
}
export async function getSettings() {
  const { settings } = await load('settings');
  return mergeDefaults(settings || {});
}
export function mergeDefaults(s) {
  const out = { ...DEFAULT_SETTINGS, ...s };
  out.engines = { ...DEFAULT_SETTINGS.engines, ...(s.engines || {}) };
  return out;
}
export async function getAll() {
  const data = await load(['profile', 'books', 'candidates', 'settings', 'usage']);
  return {
    profile: data.profile || {},
    books: data.books || [],
    candidates: data.candidates || {},
    settings: mergeDefaults(data.settings || {}),
    usage: data.usage || {}
  };
}

// ---------- 工具 ----------
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const todayStr = (d = new Date()) => {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
};
export const stamp = (d = new Date()) => {
  const z = (n) => String(n).padStart(2, '0');
  return `${todayStr(d)} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
};

export function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

const TRACKING = /^(utm_|spm|from|share_|_t$|timestamp$|wfr$|for$)/i;
export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    let s = u.toString();
    if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
    return s;
  } catch {
    return url.trim();
  }
}

// 域名匹配：带点的条目按后缀匹配（a.com 匹配 x.a.com），不带点的按包含匹配（lanzou 匹配 www.lanzoui.com）
export function hostMatches(host, list) {
  if (!host) return null;
  for (const raw of list || []) {
    const d = String(raw).trim().toLowerCase();
    if (!d) continue;
    if (d.includes('.')) {
      if (host === d || host.endsWith('.' + d)) return d;
    } else if (host.includes(d)) {
      return d;
    }
  }
  return null;
}

export function classify(url, settings) {
  const host = hostOf(url);
  if (hostMatches(host, settings.whitelist)) return { type: 'official', provider: hostMatches(host, settings.whitelist) };
  const nd = hostMatches(host, settings.netdisk);
  if (nd) return { type: 'netdisk', provider: nd };
  const so = hostMatches(host, settings.social);
  if (so) return { type: 'social', provider: so };
  return { type: 'web', provider: host };
}

// 疑似度：0-10，只用于排序，不代替人工判断
export function scoreResult({ title = '', snippet = '', type }, book) {
  const text = (title + ' ' + snippet).toLowerCase();
  let s = 0;
  if (book.title && text.includes(book.title.toLowerCase())) s += 3;
  for (const t of book.oldTitles || []) if (t && text.includes(t.toLowerCase())) { s += 2; break; }
  if (book.penName && text.includes(book.penName.toLowerCase())) s += 1;
  let w = 0;
  for (const word of PIRACY_WORDS) if (text.includes(word.toLowerCase())) w++;
  s += Math.min(w, 3);
  if (type === 'netdisk') s += 2;
  for (const fp of book.fingerprints || []) {
    const n = normText(fp).slice(0, 12);
    if (n.length >= 6 && normText(text).includes(n)) { s += 3; break; }
  }
  return Math.min(s, 10);
}

// 去掉空白和标点，只保留文字、字母、数字，用于指纹比对
export function normText(s) {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

export function buildQueries(book, templates) {
  const out = [];
  const add = (q) => { q = q.replace(/\s+/g, ' ').trim(); if (q && !/[{}]/.test(q) && !out.includes(q)) out.push(q); };
  for (const t of templates) {
    if (t.includes('{旧书名}')) {
      for (const ot of book.oldTitles || []) if (ot) add(fillVars(t, { 旧书名: ot, 书名: book.title, 笔名: book.penName }));
      continue;
    }
    if (t.includes('{指纹句}')) {
      for (const fp of book.fingerprints || []) {
        const short = String(fp).replace(/\s+/g, '').slice(0, 24);
        if (short.length >= 8) add(fillVars(t, { 指纹句: short, 书名: book.title, 笔名: book.penName }));
      }
      continue;
    }
    if (t.includes('{笔名}') && !book.penName) continue;
    add(fillVars(t, { 书名: book.title, 笔名: book.penName }));
  }
  return out;
}

export function fillVars(tpl, vars) {
  return tpl.replace(/\{\{?([^{}]+)\}?\}/g, (m, k) => (vars[k.trim()] !== undefined && vars[k.trim()] !== null && vars[k.trim()] !== '' ? vars[k.trim()] : m));
}

// bing 的 /ck/a?...&u=a1<base64url> 跳转
export function decodeBingCk(url) {
  try {
    const u = new URL(url);
    if (!/bing\.com$/.test(u.hostname) || !u.pathname.startsWith('/ck/')) return null;
    let v = u.searchParams.get('u');
    if (!v || !v.startsWith('a1')) return null;
    v = v.slice(2).replace(/-/g, '+').replace(/_/g, '/');
    while (v.length % 4) v += '=';
    const s = decodeURIComponent(escape(atob(v)));
    return /^https?:\/\//.test(s) ? s : null;
  } catch {
    return null;
  }
}

// 判断一个结果链接是否还是搜索引擎自己的跳转链接
export function isRedirectLink(url) {
  const h = hostOf(url);
  if (!h) return false;
  try {
    const u = new URL(url);
    if (/(^|\.)baidu\.com$/.test(h) && u.pathname.startsWith('/link')) return true;
    if (/(^|\.)sogou\.com$/.test(h) && u.pathname.startsWith('/link')) return true;
    if (/(^|\.)so\.com$/.test(h) && u.pathname.startsWith('/link')) return true;
    if (/(^|\.)bing\.com$/.test(h) && u.pathname.startsWith('/ck/')) return true;
    const p = u.searchParams.get('url') || u.searchParams.get('target');
    if (p && /^https?:/i.test(p) && Object.values(ENGINES).some((e) => h === e.host || h.endsWith('.' + e.host.split('.').slice(-2).join('.')))) return true;
  } catch {}
  return false;
}

export function inlineRedirectTarget(url) {
  const ck = decodeBingCk(url);
  if (ck) return ck;
  try {
    const u = new URL(url);
    const p = u.searchParams.get('url') || u.searchParams.get('target');
    if (p && /^https?:/i.test(p)) return p;
  } catch {}
  return null;
}

// 从各种晋江链接里取出作品 ID：onebook.php?novelid=、book2/、onebook_vip.php?novelid= 等
export function parseNovelId(input) {
  const s = String(input || '').trim();
  if (/^\d{3,}$/.test(s)) return s;
  const m = s.match(/[?&]novelid=(\d+)/i) || s.match(/jjwxc\.(?:net|com)\/book2\/(\d+)/i) || s.match(/jjwxc\.(?:net|com)\/.*?(?:book|novel)[/=](\d{4,})/i);
  return m ? m[1] : null;
}
export const jjBookUrl = (id) => `https://www.jjwxc.net/onebook.php?novelid=${id}`;

// 从章节正文里挑几句适合做指纹的句子：叙述句、长度适中、分散在章节前中后
export function pickFingerprints(paragraphs, n = 3) {
  const sentences = [];
  for (const p of paragraphs) {
    for (const raw of p.split(/(?<=[。！？!?…])/)) {
      const s = raw.trim();
      const len = [...s].length;
      if (len < 16 || len > 42) continue;
      if (/^[“"「『]/.test(s)) continue; // 对话开头的句子容易被改写，少用
      if (/http|www\.|晋江|作者|本章|收藏|评论/.test(s)) continue;
      sentences.push(s);
    }
  }
  if (sentences.length <= n) return sentences;
  const out = [];
  for (let i = 0; i < n; i++) out.push(sentences[Math.floor(((i + 0.5) * sentences.length) / n)]);
  return [...new Set(out)];
}

export function csvEscape(v) {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob(['﻿' + text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

export function safeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
}
