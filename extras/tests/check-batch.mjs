// 整卷回归:流式中途只答一半(1.A\n2.C 稳定 2.8s)+ 输入条图标排(旧版误判操作栏)
// 期望:桥靠 expect 门槛等到最后一题(3.)出现才收货,不能返回残缺回复
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

const BASE = 'http://127.0.0.1:8790';
const N = 3;
const Q = `下面是 ${N} 道题。请按题号逐行给出答案,每行格式严格为「题号.答案」(如 1.A、2.正确、3.填空内容),不要解释、不要复述题目。\n\n1. (单选题) 1+1等于几?\nA. 1\nB. 2\n\n2. (单选题) 2+2等于几?\nA. 3\nB. 4\n\n3. (判断题) 地球是圆的。\n`;

const b = await chromium.launch({ headless: true, executablePath: findChrome() || undefined });
const ctx = await b.newContext();
const aiPage = await ctx.newPage();
await aiPage.goto(BASE + '/ai-sym', { waitUntil: 'networkidle' });
await aiPage.waitForTimeout(3000);

const cxId = 'batch' + Math.random().toString(36).slice(2);
await fetch(BASE + '/api/webai/ask', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ cxId, text: Q, site: '127.0.0.1:8790', expect: N })
});

let ans = null;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const o = await (await fetch(BASE + '/api/webai/answer/' + cxId)).json();
  if (o.done) { ans = o; break; }
}
const text = (ans && ans.text) || '';
const lines = text.split('\n').filter((s) => /^\s*\d+\s*[.、]/.test(s)).length;
const hasLast = new RegExp('(?:^|\\s)' + N + '\\s*[.、]').test(text);
const ok = !!ans && hasLast && lines >= N;
console.log('回传:', JSON.stringify(text).slice(0, 140));
console.log(`解析行数=${lines}/${N}, 含最后一题号=${hasLast} →`, ok ? 'PASS(没提前收货)' : 'FAIL(提前收货/残缺)');
await b.close();
process.exit(ok ? 0 : 1);
