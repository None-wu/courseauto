// 诊断:完整走一次中转流程,观察 /ai-ce 页桥脚本的运行时行为
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

const BASE = 'http://127.0.0.1:8790';
const Q = '请回答下面这道单选题。要求:第一行只写答案。\n\n题目:1+1等于几?\n选项:\nA. 1\nB. 2\nC. 3\nD. 4';

const b = await chromium.launch({ headless: true, executablePath: findChrome() || undefined });
const ctx = await b.newContext();
const p = await ctx.newPage();
p.on('console', (m) => console.log('[ai-ce console]', m.type(), m.text()));
p.on('pageerror', (e) => console.log('[ai-ce pageerror]', e.message));
await p.goto(BASE + '/ai-ce', { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);

const cxId = 'diag' + Math.random().toString(36).slice(2);
await fetch(BASE + '/api/webai/ask', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ cxId, text: Q })
});
for (let i = 0; i < 15; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const o = await (await fetch(BASE + '/api/webai/answer/' + cxId)).json();
  if (o.done) { console.log('回传:', JSON.stringify(o)); break; }
}
// 最后看一眼输入框里留下了什么
console.log('editor 内容:', await p.evaluate(() => document.getElementById('editor').innerText.slice(0, 80)));
await b.close();
