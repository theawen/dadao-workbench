document.getElementById('open').addEventListener('click', async () => {
  const url = chrome.runtime.getURL('dashboard.html');
  const [existing] = await chrome.tabs.query({ url });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
  window.close();
});

document.getElementById('assist').addEventListener('click', async () => {
  const msg = document.getElementById('msg');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https?:/.test(tab.url || '')) {
      msg.textContent = '填写助手只能在普通网页上使用。';
      return;
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['assist.js'] });
    window.close();
  } catch (e) {
    msg.textContent = '无法在这个页面打开：' + (e.message || e);
  }
});
