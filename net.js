// 网络相关：跳转解析、手机身份、页面核验、截图取证
import { hostOf, inlineRedirectTarget, normText, sleep, stamp } from './lib.js';

export const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

// ---------- 权限 ----------
export async function hasAllUrls() {
  return chrome.permissions.contains({ origins: ['<all_urls>'] });
}
// 必须在点击事件里直接调用
export async function requestAllUrls() {
  if (await hasAllUrls()) return true;
  return chrome.permissions.request({ origins: ['<all_urls>'] });
}

// ---------- 手机身份（只作用于指定标签页或扩展自身发出的请求） ----------
const RULE_BASE = 9000;
export async function setMobileUA(tabIds, on) {
  const ids = tabIds.map((t, i) => RULE_BASE + (t === -1 ? 0 : (t % 100000) + 1));
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids });
  if (!on) return;
  await chrome.declarativeNetRequest.updateSessionRules({
    addRules: tabIds.map((t, i) => ({
      id: ids[i],
      priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'user-agent', operation: 'set', value: MOBILE_UA }] },
      condition: { tabIds: [t], resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'other'] }
    }))
  });
}

// ---------- 搜索引擎跳转链接 → 真实地址 ----------
export async function resolveRedirect(url) {
  const inline = inlineRedirectTarget(url);
  if (inline) return inline;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { redirect: 'follow', credentials: 'omit', signal: ctrl.signal });
    if (hostOf(r.url) && hostOf(r.url) !== hostOf(url)) return r.url;
    const t = (await r.text()).slice(0, 20000);
    const m =
      t.match(/location\.replace\(\s*["']([^"']+)["']/) ||
      t.match(/location\.href\s*=\s*["']([^"']+)["']/) ||
      t.match(/window\.location\s*=\s*["']([^"']+)["']/) ||
      t.match(/http-equiv=["']?refresh["']?[^>]*url\s*=\s*'?([^'">\s]+)/i);
    if (m && /^https?:/i.test(m[1])) return m[1];
  } catch {}
  finally { clearTimeout(timer); }
  return null;
}

// ---------- 核验：抓取页面，看是否含有书名和指纹句 ----------
function pickCharset(contentType, headBytes) {
  const m1 = /charset=([\w-]+)/i.exec(contentType || '');
  if (m1) return m1[1];
  const head = new TextDecoder('latin1').decode(headBytes.slice(0, 4096));
  const m2 = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head);
  return m2 ? m2[1] : 'utf-8';
}

export async function verifyPage(url, book) {
  const res = { at: stamp(), httpStatus: 0, hits: 0, total: 0, titleHit: false, error: '', finalUrl: '' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { redirect: 'follow', credentials: 'omit', signal: ctrl.signal, cache: 'no-store' });
    res.httpStatus = r.status;
    res.finalUrl = r.url;
    const buf = new Uint8Array(await r.arrayBuffer());
    let cs = pickCharset(r.headers.get('content-type'), buf);
    let html;
    try { html = new TextDecoder(cs).decode(buf); } catch { html = new TextDecoder('utf-8').decode(buf); }
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ');
    const flat = normText(text);
    const fps = (book.fingerprints || []).map(normText).filter((s) => s.length >= 6);
    res.total = fps.length;
    for (const f of fps) {
      // 允许只命中指纹句的前 2/3，降低盗文站改字、插广告带来的漏判
      const part = f.slice(0, Math.max(6, Math.floor(f.length * 0.66)));
      if (flat.includes(f) || flat.includes(part)) res.hits++;
    }
    const titles = [book.title, ...(book.oldTitles || [])].map(normText).filter(Boolean);
    res.titleHit = titles.some((t) => flat.includes(t));
    res.textLength = flat.length;
  } catch (e) {
    res.error = e.name === 'AbortError' ? '超时' : '无法访问（' + (e.message || '网络错误') + '）';
  } finally {
    clearTimeout(timer);
  }
  return res;
}

export function verifySummary(v) {
  if (!v) return '';
  if (v.error) return v.error;
  if (v.httpStatus >= 400) return `HTTP ${v.httpStatus}`;
  const parts = [];
  if (v.total) parts.push(`指纹 ${v.hits}/${v.total}`);
  parts.push(v.titleHit ? '含书名' : '无书名');
  if (v.textLength !== undefined && v.textLength < 300) parts.push('页面几乎无文字');
  return parts.join('，');
}

// ---------- 投诉后复查：链接还能不能打开 ----------
const GONE_WORDS = /分享不存在|分享已失效|分享已取消|已失效|已过期|已被删除|已被取消|文件不存在|内容不存在|页面不存在|找不到页面|无法找到|违规|涉嫌侵权|已屏蔽|已被屏蔽|该内容已删除|404 Not Found|Page Not Found|not found/i;

// 在一个不抢焦点的小窗口里打开页面，等它渲染完再读文字（网盘分享页这类要靠脚本渲染的页面用这个）
export async function readRenderedPage(url, { mobile = false } = {}) {
  const win = await chrome.windows.create({ url: 'about:blank', focused: false, type: 'normal', width: mobile ? 430 : 1000, height: 800 });
  const tabId = win.tabs[0].id;
  try {
    if (mobile) await setMobileUA([tabId], true);
    await chrome.tabs.update(tabId, { url });
    await waitTabComplete(tabId, 30000);
    await sleep(3500);
    const tab = await chrome.tabs.get(tabId);
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: () => (document.title + '\n' + (document.body ? document.body.innerText : '')).slice(0, 20000) });
    return { text: (r && r.result) || '', finalUrl: tab.url || url };
  } catch (e) {
    return { text: '', finalUrl: url, error: e.message || String(e) };
  } finally {
    if (mobile) await setMobileUA([tabId], false).catch(() => {});
    await chrome.windows.remove(win.id).catch(() => {});
  }
}

// 返回 { state: 'gone' | 'alive' | 'unclear', detail }
export async function recheckLink(c, book, { mobile = false } = {}) {
  const at = stamp();
  const needsRender = c.type === 'netdisk' || c.type === 'social';
  if (!needsRender) {
    const v = await verifyPage(c.url, book);
    if (v.httpStatus === 404 || v.httpStatus === 410) return { at, state: 'gone', detail: `HTTP ${v.httpStatus}` };
    if (v.httpStatus >= 200 && v.httpStatus < 400 && (v.hits || v.titleHit)) {
      return { at, state: 'alive', detail: [v.total ? `指纹 ${v.hits}/${v.total}` : '', v.titleHit ? '含书名' : ''].filter(Boolean).join('，') };
    }
    // 抓不到正文的情况交给真实浏览器再看一眼
  }
  const r = await readRenderedPage(c.url, { mobile });
  if (r.error && !r.text) return { at, state: 'unclear', detail: '打不开：' + r.error };
  const flat = normText(r.text);
  const titles = [book.title, ...(book.oldTitles || [])].map(normText).filter(Boolean);
  const fps = (book.fingerprints || []).map(normText).filter((s) => s.length >= 6);
  const hits = fps.filter((f) => flat.includes(f.slice(0, Math.max(6, Math.floor(f.length * 0.66))))).length;
  const titleHit = titles.some((t) => flat.includes(t));
  const gone = r.text.slice(0, 3000).match(GONE_WORDS);
  if (gone && !hits) return { at, state: 'gone', detail: `页面显示「${gone[0]}」` };
  if (hits || titleHit) return { at, state: 'alive', detail: [fps.length ? `指纹 ${hits}/${fps.length}` : '', titleHit ? '含书名' : ''].filter(Boolean).join('，') };
  if (flat.length < 80) return { at, state: 'gone', detail: '页面几乎是空的' };
  return { at, state: 'unclear', detail: '页面还在，但没找到书名或指纹句，请打开看一下' };
}

// ---------- 晋江作品页导入 ----------
async function fetchJJDoc(url) {
  const r = await fetch(url, { credentials: 'omit', cache: 'no-store' });
  if (!r.ok) throw new Error(`晋江页面返回 ${r.status}`);
  const html = new TextDecoder('gb18030').decode(await r.arrayBuffer());
  return new DOMParser().parseFromString(html, 'text/html');
}
const textWithBreaks = (el) => {
  if (!el) return '';
  const c = el.cloneNode(true);
  c.querySelectorAll('script,style').forEach((e) => e.remove());
  c.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  c.querySelectorAll('p,div').forEach((p) => p.append('\n'));
  return c.textContent.replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
};

export async function fetchJJBook(novelId) {
  const url = `https://www.jjwxc.net/onebook.php?novelid=${novelId}`;
  const d = await fetchJJDoc(url);
  const q = (s) => d.querySelector(s);
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const title = clean(q('[itemprop=articleSection]')?.textContent || q('h1')?.textContent);
  if (!title) throw new Error('没有在页面上找到书名，可能作品已锁定、链接有误，或晋江页面改版了');
  const penName = clean(q('[itemprop=author]')?.textContent) || clean(q('h2')?.textContent).replace(/^作者[:：]/, '');
  const blurb = textWithBreaks(q('#novelintro'));
  // 第一章那一行的悬浮提示里有「章节首发时间」
  let firstPublished = '';
  const firstRow = q('tr[itemprop~=chapter]');
  if (firstRow) {
    for (const td of firstRow.querySelectorAll('td[title], td')) {
      const m = (td.getAttribute('title') || '').match(/首发时间[:：]\s*([\d-]+\s*[\d:]*)/);
      if (m) { firstPublished = m[1].trim(); break; }
    }
  }
  const tags = [...d.querySelectorAll('.smallreadbody a[href*="bookbase.php"]')].map((a) => clean(a.textContent)).filter(Boolean);
  const info = [
    clean(q('[itemprop=genre]')?.textContent),
    clean(q('[itemprop=updataStatus]')?.textContent),
    clean(q('[itemprop=wordCount]')?.textContent),
    tags.length ? '标签：' + [...new Set(tags)].slice(0, 10).join('、') : ''
  ].filter(Boolean).join('　');
  const chapterCount = d.querySelectorAll('tr[itemprop~=chapter]').length;
  return { novelId: String(novelId), url, title, penName, blurb, firstPublished, info, chapterCount };
}

// 取某一章（默认第 1 章，免费）的正文段落；付费章节取不到，返回空数组
export async function fetchJJChapterParagraphs(novelId, chapterId = 1) {
  const d = await fetchJJDoc(`https://www.jjwxc.net/onebook.php?novelid=${novelId}&chapterid=${chapterId}`);
  let el = d.querySelector('#paragraph_comment_content');
  if (!el) {
    const nt = d.querySelector('.noveltext');
    if (!nt) return [];
    el = nt.cloneNode(true);
    el.querySelectorAll('div,script,style,h2').forEach((e) => e.remove());
  }
  return textWithBreaks(el).split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
}

// ---------- 截图取证：打开页面 → 截图 → 在底部加上网址和时间 ----------
function waitTabComplete(tabId, timeout = 30000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; chrome.tabs.onUpdated.removeListener(onUpd); clearTimeout(t); resolve(); } };
    const onUpd = (id, info) => { if (id === tabId && info.status === 'complete') finish(); };
    const t = setTimeout(finish, timeout);
    chrome.tabs.onUpdated.addListener(onUpd);
    chrome.tabs.get(tabId).then((tab) => { if (tab.status === 'complete') finish(); }).catch(finish);
  });
}
export { waitTabComplete };

export async function captureEvidence(url, { mobile = false, label = '' } = {}) {
  const win = await chrome.windows.create({
    url: 'about:blank',
    focused: true,
    type: 'normal',
    width: mobile ? 430 : 1280,
    height: 900
  });
  const tabId = win.tabs[0].id;
  try {
    if (mobile) await setMobileUA([tabId], true);
    await chrome.tabs.update(tabId, { url });
    await waitTabComplete(tabId);
    await sleep(2500);
    const tab = await chrome.tabs.get(tabId);
    const shot = await chrome.tabs.captureVisibleTab(win.id, { format: 'png' });
    const when = stamp();
    const blob = await annotate(shot, [`网址：${tab.url || url}`, `页面标题：${tab.title || ''}`, `取证时间：${when}${label ? '　' + label : ''}`]);
    return { blob, when, finalUrl: tab.url || url, title: tab.title || '' };
  } finally {
    if (mobile) await setMobileUA([tabId], false).catch(() => {});
    await chrome.windows.remove(win.id).catch(() => {});
  }
}

async function annotate(dataUrl, lines) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });
  const pad = 16, lh = 26;
  const footer = pad * 2 + lh * lines.length;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height + footer;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.fillStyle = '#17241F';
  g.fillRect(0, img.height, c.width, footer);
  g.fillStyle = '#FFFFFF';
  g.font = '16px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif';
  g.textBaseline = 'top';
  lines.forEach((l, i) => {
    let s = l;
    while (g.measureText(s).width > c.width - pad * 2 && s.length > 10) s = s.slice(0, -2);
    if (s !== l) s += '…';
    g.fillText(s, pad, img.height + pad + i * lh);
  });
  return new Promise((r) => c.toBlob(r, 'image/png'));
}
