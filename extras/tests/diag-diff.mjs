// 诊断 /ai-diff 抓取:tail 锚点在新归一化(normNL,保留换行)下是否还能匹配
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

function findChrome() {
  const root = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (!fs.existsSync(root)) return null;
  for (const dir of fs.readdirSync(root)) {
    if (!dir.startsWith('chromium-')) continue;
    for (const sub of ['chrome-win64', 'chrome-win']) {
      const exe = path.join(root, dir, sub, 'chrome.exe');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null;
}

const b = await chromium.launch({ headless: true, executablePath: findChrome() || undefined });
const pg = await b.newPage();
await pg.goto('http://127.0.0.1:8790/ai-diff', { waitUntil: 'networkidle' });
const Q = '请回答下面这道单选题。要求:第一行只写答案,不要解释、不要复述题目。\n\n题目:1+1等于几?\n选项:\nA. 1\nB. 2\nC. 3\nD. 4\n\n答案格式:单选题写字母(如 C);判断题写「正确」或「错误」。';
const r = await pg.evaluate((q) => {
  const normNL = (s) => String(s || '').replace(/[\t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  const editor = document.getElementById('editor');
  const sel = window.getSelection(); const range = document.createRange();
  range.selectNodeContents(editor); sel.removeAllRanges(); sel.addRange(range);
  document.execCommand('delete');
  const dt = new DataTransfer(); dt.setData('text/plain', q);
  editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  document.getElementById('send').click();
  return new Promise((res) => setTimeout(() => {
    const btns = Array.from(document.querySelectorAll('button')).filter((x) => /^展开$/.test(x.textContent.trim()));
    if (btns.length) btns[btns.length - 1].click();
    setTimeout(() => {
      const chat = document.querySelector('.agent-chat__list');
      const tail = normNL(q).slice(-40);
      const norm = normNL(chat.innerText);
      const idx = norm.lastIndexOf(tail);
      res({
        tail: JSON.stringify(tail),
        normTail: JSON.stringify(norm.slice(-90)),
        idx,
        rep: idx >= 0 ? JSON.stringify(norm.slice(idx + tail.length)) : 'NO_MATCH'
      });
    }, 800);
  }, 900));
}, Q);
console.log(JSON.stringify(r, null, 1));
await b.close();
