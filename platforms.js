// 各投诉平台的「一键填好」：打开平台的投诉表单，把资料填进去。
// 声明勾选、电子签名、提交按钮一律不碰，由作者本人核对后操作。

export const QUARK_IPP_URL = 'https://ipp.quark.cn/';

// 注入到夸克侵权投诉平台执行；必须自包含。只填写，不上传证明文件、不提交。
export async function quarkFill(data) {
  const report = { filled: [], missing: [], rows: 0, truncated: 0 };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => el && el.offsetParent !== null;
  const setInput = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  };
  const radio = async (text) => {
    const lab = [...document.querySelectorAll('label.ant-radio-wrapper')].find((l) => l.innerText.trim() === text && visible(l));
    if (!lab) { report.missing.push(text); return; }
    const inp = lab.querySelector('input[type=radio]');
    if (!inp.checked) inp.click();
    report.filled.push(text);
    await sleep(150);
  };

  // 等表单出现（从首页点「发起侵权投诉」后才渲染）
  for (let i = 0; i < 40 && !document.querySelector('input[placeholder^="侵权链接"]'); i++) await sleep(250);
  if (!document.querySelector('input[placeholder^="侵权链接"]')) {
    const btn = [...document.querySelectorAll('button')].find((b) => b.innerText.replace(/\s/g, '') === '发起侵权投诉');
    if (btn) { btn.click(); for (let i = 0; i < 40 && !document.querySelector('input[placeholder^="侵权链接"]'); i++) await sleep(250); }
  }
  if (!document.querySelector('input[placeholder^="侵权链接"]')) {
    report.missing.push('投诉表单（请确认已登录，并在页面上点开「发起侵权投诉」后再试）');
    return report;
  }

  await radio('权利人');
  await radio('知识产权');
  await radio('著作权(含视频、图文、图集等)');
  await radio(data.module === 'search' ? '夸克搜索' : '夸克网盘');
  await radio('小说');

  // 选择权利人（需要先在「实名认证」里添加过）
  const sel = document.querySelector('.ant-select-selection');
  if (sel) {
    sel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    sel.click();
    await sleep(500);
    const opts = [...document.querySelectorAll('.ant-select-dropdown-menu-item')].filter(visible);
    const pick = opts.find((o) => data.holderName && o.innerText.includes(data.holderName)) || (opts.length === 1 ? opts[0] : null);
    if (pick) { pick.click(); report.filled.push('权利人：' + pick.innerText.trim()); }
    else {
      report.missing.push(opts.length ? '权利人（有多个选项，请手动选择）' : '权利人（请先在「实名认证」里添加权利人）');
      document.body.click();
    }
    await sleep(200);
  }

  // 侵权链接：按需点「点击添加链接」增加行，每行填链接和作品名称
  const MAX = 50;
  const urls = data.urls.slice(0, MAX);
  report.truncated = Math.max(0, data.urls.length - MAX);
  const linkInputs = () => [...document.querySelectorAll('input[placeholder^="侵权链接"]')];
  const addBtn = [...document.querySelectorAll('a.add')].find((a) => a.innerText.trim() === '点击添加链接');
  for (let guard = 0; linkInputs().length < urls.length && addBtn && guard < MAX; guard++) { addBtn.click(); await sleep(120); }
  const rows = linkInputs();
  urls.forEach((u, i) => {
    const li = rows[i];
    if (!li) return;
    setInput(li, u);
    const row = li.closest('.ant-row') || li.parentElement;
    const nameInput = row && row.querySelector('input[placeholder^="请输入作品名称"]');
    if (nameInput) setInput(nameInput, data.title);
    const codeInput = row && row.querySelector('input[placeholder^="对应访问码"]');
    if (codeInput && data.codes && data.codes[i]) setInput(codeInput, data.codes[i]);
    report.rows++;
  });
  if (report.rows) report.filled.push(`侵权链接 ${report.rows} 条`);
  if (report.rows < urls.length) report.missing.push(`有 ${urls.length - report.rows} 条链接没填进去`);

  const desc = document.querySelector('textarea[placeholder^="请客观公正"]');
  if (desc) { setInput(desc, data.description.slice(0, 1000)); report.filled.push('投诉内容描述'); } else report.missing.push('投诉内容描述');

  // 标出需要本人操作的地方：上传证明文件、提交
  const submit = [...document.querySelectorAll('button.ant-btn-primary')].find((b) => b.innerText.replace(/\s/g, '') === '提交');
  [...document.querySelectorAll('.ant-upload'), submit].filter(Boolean).forEach((el) => { el.style.outline = '3px solid #B5321F'; el.style.outlineOffset = '3px'; });

  document.getElementById('dadao-quark-bar')?.remove();
  const bar = document.createElement('div');
  bar.id = 'dadao-quark-bar';
  bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#17241F;color:#fff;padding:12px 18px;font:14px/1.6 "PingFang SC","Microsoft YaHei",sans-serif;display:flex;gap:14px;align-items:center;flex-wrap:wrap;box-shadow:0 -2px 12px rgba(0,0,0,.25)';
  const msg = document.createElement('div');
  msg.style.flex = '1';
  msg.textContent = `打盗工作台已填好：${report.filled.join('、')}。` +
    (report.truncated ? `一次最多填 ${MAX} 条，还有 ${report.truncated} 条请下次再投或用「批量导入」。` : '') +
    (report.missing.length ? `需要你处理：${report.missing.join('；')}。` : '') +
    ` 请在红框处上传：证明文件（签字的权利通知书 PDF/图片、首发证明或签约合同），其他证明（侵权页面截图）。有提取码但没自动填上的网盘链接，请补上访问码。核对无误后自己点「提交」。`;
  const rec = document.createElement('button');
  rec.textContent = '我已提交成功，记录投诉';
  rec.style.cssText = 'font:inherit;background:#2C7A58;color:#fff;border:0;border-radius:6px;padding:7px 14px;cursor:pointer';
  rec.onclick = async () => {
    const keys = data.keys.slice(0, report.rows);
    if (!confirm(`确认已经在夸克成功提交了这 ${keys.length} 条链接？`)) return;
    const store = await chrome.storage.local.get('candidates');
    const cands = store.candidates || {};
    const d = new Date(), z = (n) => String(n).padStart(2, '0');
    const at = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
    for (const k of keys) if (cands[k]) cands[k].complaints = [...(cands[k].complaints || []), { platform: '夸克', at }];
    await chrome.storage.local.set({ candidates: cands });
    rec.textContent = '已记录';
    rec.disabled = true;
  };
  const close = document.createElement('button');
  close.textContent = '×';
  close.style.cssText = 'font:18px/1 sans-serif;background:none;color:#B9C7C0;border:0;cursor:pointer';
  close.onclick = () => bar.remove();
  bar.append(msg, rec, close);
  document.body.appendChild(bar);
  return report;
}

export const BING_FORM_URL = 'https://www.bing.com/webmaster/contentremovalform/showcontentremovalform';

export const DEFAULT_BING_DESCRIPTION = `I am the author and copyright owner of the Chinese web novel "{{作品名}}" (pen name: {{笔名}}), first published on Jinjiang Literature City (jjwxc.net) on {{首发日期}}: {{正版链接}}
The URLs listed in this notice reproduce chapters of my novel verbatim. I have not authorized these websites to copy or distribute my work. I request that these URLs be removed from Bing search results.
A rights notice (Chinese and English) is attached.`;

// 注入到必应表单页面执行；必须自包含（不能引用外部变量）
export function bingFill(data) {
  const report = { filled: [], missing: [], bulk: false, urlCount: data.urls.length };
  const byBind = (key) => document.querySelector(`[data-bind*="${key}"]`);
  const fire = (el) => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  };
  const setText = (key, value, label) => {
    const el = byBind(key);
    if (!el) { report.missing.push(label); return; }
    if (value === undefined || value === null || value === '') return;
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    fire(el);
    report.filled.push(label);
  };
  const setSelect = (key, value, label) => {
    const el = byBind(key);
    if (!el) { report.missing.push(label); return; }
    const opt = [...el.options].find((o) => o.value === value || o.text.trim() === value);
    if (!opt) { report.missing.push(label + '（没有找到选项 ' + value + '）'); return; }
    el.value = opt.value;
    fire(el);
    report.filled.push(label);
  };
  const setFiles = (el, files, label) => {
    if (!el) { report.missing.push(label); return; }
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(new File([f.text], f.name, { type: 'text/plain' }));
    el.files = dt.files;
    fire(el);
    report.filled.push(label);
  };

  setSelect('value:searchType', 'Web', 'Search Type');
  setText('value: firstName', data.firstName, '名');
  setText('value: lastName', data.lastName, '姓');
  setText('value: copyrightOwnerFullName', data.ownerName, '版权人全名');
  setSelect('value:copyrightOwnerCountry', data.country || 'China', '国家/地区');
  setText('value: emailAddress', data.email, '邮箱');
  setSelect('value:typeOfWork', 'Text', '作品类型');
  setText('value: titleOfWork', data.title, '作品名');
  setText('value: authorizedExample', data.exampleUrl, '正版链接');
  setText('value: description', data.description, '作品说明');

  if (data.urls.length <= 10) {
    setText('value: urlsToRemove', data.urls.join('\n'), `侵权链接 ${data.urls.length} 条`);
  } else {
    report.bulk = true;
    setFiles(document.getElementById('bulkSubmission') || byBind('value: bulkSubmissionData'),
      [{ name: 'infringing_urls.txt', text: data.urls.join('\r\n') }], `侵权链接 ${data.urls.length} 条（批量文件）`);
  }
  if (data.attachment) setFiles(document.getElementById('attachment') || byBind('value: attachmentData'), [data.attachment], '附件：权利通知书');
  setText('value: additionalInformation', data.additional, '补充说明');

  // 把需要本人操作的地方标出来
  const mustDo = [
    ...['goodFaithStatement', 'authorityToActStatement', 'acknowledgementStatement'].map((k) => byBind('checked: ' + k)),
    byBind('value: signature'),
    document.getElementById('submitUrl')
  ].filter(Boolean);
  mustDo.forEach((el) => { el.style.outline = '3px solid #B5321F'; el.style.outlineOffset = '3px'; });

  // 顶部提示条
  document.getElementById('dadao-bing-bar')?.remove();
  const bar = document.createElement('div');
  bar.id = 'dadao-bing-bar';
  bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#17241F;color:#fff;padding:12px 18px;font:14px/1.6 "PingFang SC","Microsoft YaHei",sans-serif;display:flex;gap:14px;align-items:center;flex-wrap:wrap;box-shadow:0 2px 12px rgba(0,0,0,.25)';
  const msg = document.createElement('div');
  msg.style.flex = '1';
  msg.textContent = `打盗工作台已填好 ${report.filled.length} 项（${report.urlCount} 条链接${report.bulk ? '，超过 10 条已转成批量文件上传' : ''}）。请你从上到下核对一遍，然后勾选红框里的三项声明，在签名栏输入你的英文/拼音全名，最后自己点 Submit。` +
    (report.missing.length ? ` 没找到的项：${report.missing.join('、')}，请手动填写。` : '');
  const rec = document.createElement('button');
  rec.textContent = '我已提交成功，记录投诉';
  rec.style.cssText = 'font:inherit;background:#2C7A58;color:#fff;border:0;border-radius:6px;padding:7px 14px;cursor:pointer';
  rec.onclick = async () => {
    if (!confirm(`确认已经在必应成功提交了这 ${data.keys.length} 条链接？`)) return;
    const store = await chrome.storage.local.get('candidates');
    const cands = store.candidates || {};
    const d = new Date(), z = (n) => String(n).padStart(2, '0');
    const at = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
    for (const k of data.keys) if (cands[k]) cands[k].complaints = [...(cands[k].complaints || []), { platform: '必应', at }];
    await chrome.storage.local.set({ candidates: cands });
    rec.textContent = '已记录';
    rec.disabled = true;
  };
  const close = document.createElement('button');
  close.textContent = '×';
  close.title = '关闭提示';
  close.style.cssText = 'font:18px/1 sans-serif;background:none;color:#B9C7C0;border:0;cursor:pointer';
  close.onclick = () => bar.remove();
  bar.append(msg, rec, close);
  document.body.appendChild(bar);
  document.body.style.paddingTop = (bar.offsetHeight + 8) + 'px';
  return report;
}
