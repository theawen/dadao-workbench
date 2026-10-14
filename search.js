// 搜索执行器：在一个单独的浏览器窗口里，像真人一样逐条打开搜索页并读取结果。
// 遇到验证码 / 登录页会暂停，等你在窗口里手动处理后再继续；不会尝试绕过。
import {
  ENGINES, getAll, save, classify, normalizeUrl, scoreResult, buildQueries,
  isRedirectLink, inlineRedirectTarget, hostOf, sleep, todayStr, stamp
} from './lib.js';
import { resolveRedirect, setMobileUA, waitTabComplete } from './net.js';

// 注入到搜索结果页执行；必须自包含
export function extractResults(engineId) {
  const out = { blocked: false, reason: '', results: [], url: location.href };
  const body = document.body ? document.body.innerText || '' : '';
  const head = (document.title + ' ' + body.slice(0, 600));
  if (/wappass\.baidu\.com|\/captcha|antispider|passport\.weibo|login\.sina|verify\.|\/sorry\//i.test(location.href) ||
      /百度安全验证|安全验证|请输入验证码|人机验证|异常流量|unusual traffic|请完成验证|拖动滑块|访问过于频繁|请登录后/i.test(head)) {
    out.blocked = true;
    out.reason = document.title || '需要验证';
    return out;
  }
  const seen = new Set();
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const push = (a, block, real) => {
    if (!a) return;
    const href = a.href;
    if (!href || !/^https?:/i.test(href)) return;
    const key = real || href;
    if (seen.has(key)) return;
    seen.add(key);
    const title = clean(a.innerText || a.textContent).slice(0, 120);
    let snippet = clean(block ? block.innerText : '');
    if (title && snippet.startsWith(title)) snippet = snippet.slice(title.length).trim();
    out.results.push({
      href,
      real: real && /^https?:/i.test(real) ? real : '',
      title,
      snippet: snippet.slice(0, 260)
    });
  };
  const jsonUrl = (s) => { try { return JSON.parse(s).url || ''; } catch { return ''; } };
  const q = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  if (engineId === 'baidu') {
    q('#content_left > div').forEach((b) => {
      const a = b.querySelector('h3 a');
      if (a) push(a, b, b.getAttribute('mu') || jsonUrl(b.getAttribute('data-tools')));
    });
  } else if (engineId === 'bing') {
    q('#b_results > li.b_algo').forEach((b) => push(b.querySelector('h2 a'), b, ''));
  } else if (engineId === 'sogou') {
    q('.vrwrap, .rb').forEach((b) => {
      const a = b.querySelector('h3 a');
      const d = b.querySelector('[data-url]');
      push(a, b, d ? d.getAttribute('data-url') : '');
    });
  } else if (engineId === 'so360') {
    q('.res-list, .result li').forEach((b) => {
      const a = b.querySelector('h3 a');
      if (a) push(a, b, a.getAttribute('data-mdurl') || a.getAttribute('data-url') || '');
    });
  } else if (engineId === 'weibo') {
    q('.card-wrap[mid], .card-wrap').forEach((b) => {
      const link = b.querySelector('.from a[href*="weibo.com/"]');
      const txt = b.querySelector('.txt');
      if (!link) return;
      const fake = { href: link.href, innerText: txt ? txt.innerText.slice(0, 60) : '微博' };
      push(fake, txt || b, '');
      // 微博正文里的外链（常见的网盘、文包）
      if (txt) q('a[href]', txt).forEach((a) => {
        if (/^https?:/.test(a.href) && !/weibo\.(com|cn)\/(n|p|search|weibo)\b|s\.weibo\.com/.test(a.href)) push(a, txt, '');
      });
    });
  }

  if (!out.results.length) {
    // 通用解析：取正文区域里指向其他网站（或带 url= 跳转参数）的链接
    const nav = /^(登录|注册|设置|反馈|帮助|隐私|更多|下一页|上一页|首页|网页|图片|视频|资讯|地图|问答|贴吧|百科|\d+)$/;
    const root = document.querySelector('main, #main, #content, #results, .results, #container') || document.body;
    q('a[href]', root).forEach((a) => {
      const t = clean(a.innerText);
      if (t.length < 6 || nav.test(t)) return;
      let real = '';
      try {
        const u = new URL(a.href);
        const p = u.searchParams.get('url') || u.searchParams.get('target');
        if (p && /^https?:/i.test(p)) real = p;
        if (u.hostname === location.hostname && !real) return;
      } catch { return; }
      const block = a.closest('article, li, .result, .c-container, [class*="result"], [class*="card"]') || a.parentElement;
      push(a, block, real);
    });
    out.results = out.results.slice(0, 40);
  }
  return out;
}

export class SearchRunner {
  constructor({ onLog, onState, onNewResults }) {
    this.onLog = onLog || (() => {});
    this.onState = onState || (() => {});
    this.onNewResults = onNewResults || (() => {});
    this.running = false;
    this.paused = false;
    this.stopFlag = false;
    this.queue = [];
    this.done = 0;
    this.winId = null;
    this.tabId = null;
    this._resume = null;
  }

  log(msg, kind = 'info') { this.onLog({ at: stamp(), msg, kind }); }
  state() { this.onState({ running: this.running, paused: this.paused, done: this.done, total: this.queue.length }); }

  plan(books, settings, engineIds) {
    const items = [];
    for (const b of books) {
      for (const query of buildQueries(b, settings.queryTemplates)) {
        for (const e of engineIds) {
          for (let p = 0; p < Math.max(1, settings.pages); p++) items.push({ bookId: b.id, bookTitle: b.title, engine: e, query, page: p });
        }
      }
    }
    return items;
  }

  async start(items) {
    if (this.running) return;
    const { settings, usage } = await getAll();
    const today = todayStr();
    const usedToday = usage[today] || 0;
    const room = Math.max(0, settings.dailyLimit - usedToday);
    const cap = Math.min(settings.maxQueriesPerRun, room);
    if (cap <= 0) { this.log(`今天已经搜了 ${usedToday} 次，达到每日上限 ${settings.dailyLimit}。明天再来，或者在设置里调高上限。`, 'warn'); return; }
    if (items.length > cap) this.log(`计划 ${items.length} 次搜索，本轮只执行前 ${cap} 次（单轮上限 / 今日剩余额度）。`, 'warn');
    this.queue = items.slice(0, cap);
    this.done = 0;
    this.running = true;
    this.stopFlag = false;
    this.paused = false;
    this.state();

    try {
      const win = await chrome.windows.create({ url: 'about:blank', focused: false, type: 'normal', width: settings.mobileMode ? 430 : 1200, height: 900 });
      this.winId = win.id;
      this.tabId = win.tabs[0].id;
      if (settings.mobileMode) await setMobileUA([this.tabId], true);
      const onRemoved = (wid) => { if (wid === this.winId) { this.stopFlag = true; this.winId = null; if (this._resume) this._resume(); } };
      chrome.windows.onRemoved.addListener(onRemoved);
      this._onRemoved = onRemoved;
      this.log(`已打开搜索窗口，共 ${this.queue.length} 次搜索。搜索期间请保持本页面打开。`);

      for (let i = 0; i < this.queue.length; i++) {
        if (this.stopFlag) break;
        const it = this.queue[i];
        const ok = await this.runOne(it, settings);
        if (ok === 'retry') { i--; continue; }
        this.done = i + 1;
        this.state();
        if (this.stopFlag || i === this.queue.length - 1) break;
        const wait = (settings.minDelay + Math.random() * Math.max(0, settings.maxDelay - settings.minDelay)) * 1000;
        this.log(`等待 ${Math.round(wait / 1000)} 秒再搜下一条，避免触发风控。`, 'muted');
        await this.sleepInterruptible(wait);
      }
    } catch (e) {
      this.log('搜索中断：' + (e.message || e), 'error');
    } finally {
      await this.cleanup();
      this.running = false;
      this.paused = false;
      this.state();
      this.log(this.stopFlag ? '已停止。' : '本轮搜索完成，去「审核」逐条确认吧。', 'done');
    }
  }

  async sleepInterruptible(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end && !this.stopFlag) await sleep(Math.min(500, end - Date.now()));
  }

  async runOne(it, settings) {
    const eng = ENGINES[it.engine];
    const url = eng.url(encodeURIComponent(it.query), it.page);
    this.log(`${eng.name}：${it.query}${it.page ? `（第 ${it.page + 1} 页）` : ''}`);
    await chrome.tabs.update(this.tabId, { url });
    await waitTabComplete(this.tabId, 30000);
    await sleep(2500 + Math.random() * 1500);
    let res;
    try {
      const [inj] = await chrome.scripting.executeScript({ target: { tabId: this.tabId }, func: extractResults, args: [it.engine] });
      res = inj && inj.result;
    } catch (e) {
      this.log(`读取结果失败：${e.message}`, 'error');
      return 'next';
    }
    await this.bumpUsage();
    if (!res) return 'next';
    if (res.blocked) {
      this.log(`${eng.name} 要求验证或登录（${res.reason}）。请到搜索窗口里手动完成，然后点「继续」。`, 'warn');
      this.paused = true;
      this.state();
      await chrome.windows.update(this.winId, { focused: true }).catch(() => {});
      await new Promise((r) => { this._resume = r; });
      this._resume = null;
      this.paused = false;
      this.state();
      return this.stopFlag ? 'next' : 'retry';
    }
    // 记下这个搜索词在这个引擎上最近一次成功搜索的时间，供「投诉跟踪」判断投诉后是否复查过
    const { queryRuns = {} } = await chrome.storage.local.get('queryRuns');
    queryRuns[it.bookId + '|' + it.engine + '|' + it.query] = stamp();
    await save({ queryRuns });
    const n = await this.ingest(res.results, it);
    this.log(`读到 ${res.results.length} 条结果，新增 ${n.added} 条候选${n.official ? `，${n.official} 条是正版渠道已自动排除` : ''}。`, n.added ? 'good' : 'muted');
    if (n.added) this.onNewResults();
    return 'next';
  }

  resume() { if (this._resume) this._resume(); }
  stop() { this.stopFlag = true; if (this._resume) this._resume(); }

  async bumpUsage() {
    const { usage } = await getAll();
    const d = todayStr();
    usage[d] = (usage[d] || 0) + 1;
    for (const k of Object.keys(usage)) if (k < todayStr(new Date(Date.now() - 14 * 864e5))) delete usage[k];
    await save({ usage });
  }

  async ingest(results, it) {
    const { candidates, settings, books } = await getAll();
    const book = books.find((b) => b.id === it.bookId);
    if (!book) return { added: 0, official: 0 };
    let added = 0, official = 0;
    for (const r of results) {
      let real = r.real || inlineRedirectTarget(r.href) || (isRedirectLink(r.href) ? null : r.href);
      if (!real) real = await resolveRedirect(r.href);
      const finalUrl = real || r.href;
      const unresolved = !real;
      const norm = normalizeUrl(finalUrl);
      const key = book.id + '|' + norm;
      const cls = classify(finalUrl, settings);
      const src = { engine: it.engine, query: it.query, at: stamp() };
      if (candidates[key]) {
        const c = candidates[key];
        c.lastSeen = src.at;
        if (!c.engines.includes(it.engine)) c.engines.push(it.engine);
        c.sources = [...(c.sources || []), src].slice(-8);
        continue;
      }
      if (cls.type === 'official') official++;
      candidates[key] = {
        key,
        bookId: book.id,
        url: norm,
        searchUrl: r.href,
        unresolved,
        host: hostOf(finalUrl),
        title: r.title,
        snippet: r.snippet,
        type: cls.type,
        provider: cls.provider,
        engines: [it.engine],
        sources: [src],
        foundAt: src.at,
        lastSeen: src.at,
        score: scoreResult({ title: r.title, snippet: r.snippet, type: cls.type }, book),
        status: cls.type === 'official' ? 'official' : 'pending',
        verify: null,
        evidence: [],
        complaints: [],
        note: ''
      };
      if (cls.type !== 'official') added++;
    }
    await save({ candidates });
    return { added, official };
  }

  async cleanup() {
    if (this._onRemoved) chrome.windows.onRemoved.removeListener(this._onRemoved);
    if (this.tabId) await setMobileUA([this.tabId], false).catch(() => {});
    if (this.winId) await chrome.windows.remove(this.winId).catch(() => {});
    this.winId = null;
    this.tabId = null;
  }
}
