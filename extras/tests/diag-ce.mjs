// 诊断:在 /ai-ce 页逐条模拟桥的选择器
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

function findChrome() {
  const root = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  for (const d of fs.readdirSync(root)) {
    if (!d.startsWith('chromium-')) continue;
    for (const s of ['chrome-win64', 'chrome-win']) {
      const e = path.join(root, d, s, 'chrome.exe');
      if (fs.existsSync(e)) return e;
    }
  }
  return null;
}

const b = await chromium.launch({ headless: true, executablePath: findChrome() || undefined });
const p = await b.newPage();
await p.goto('http://127.0.0.1:8790/ai-ce', { waitUntil: 'networkidle' });
await p.waitForTimeout(1000);
const info = await p.evaluate(() => {
  const sels = ['textarea', '[contenteditable="true"]', '.ql-editor', '.ProseMirror', 'div[role="textbox"]'];
  const out = {};
  for (const sel of sels) {
    const list = Array.from(document.querySelectorAll(sel)).filter((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width >= 2 && r.height >= 2 && cs.display !== 'none' && cs.visibility !== 'hidden';
    });
    out[sel] = list.length;
  }
  return out;
});
console.log(JSON.stringify(info));
await b.close();
