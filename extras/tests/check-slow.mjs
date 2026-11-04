// 整卷"慢答"回归:30 题逐行慢慢输出,第 12 题后停顿 12 秒(模拟 AI 思考/网络卡顿)。
// 验证桥不会在中途停顿处提前收货 —— 这是"没答完就开始逐题补问"的直接原因。
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
const N = 30;
// 构造与 buildBatchPrompt 同样格式的整卷 prompt
let q = `下面是 ${N} 道题。请按题号逐行给出答案,每行格式严格为「题号.答案」,不要解释、不要复述题目。\n\n`;
const typeName = { 0: '单选题', 3: '判断题' };
for (let i = 1; i <= N; i++) {
  q += `${i}. (${typeName[i % 4 === 0 ? 0 : 3]}) 第 ${i} 题的题干内容\nA. 选项一\nB. 选项二\n\n`;
}

const b = await chromium.launch({ headless: true, executablePath: findChrome() || undefined });
const ctx = await b.newContext();
const pg = await ctx.newPage();
await pg.goto(BASE + '/ai-slow', { waitUntil: 'networkidle' });
await pg.waitForTimeout(3000);

const cxId = 'slow' + Math.random().toString(36).slice(2);
const t0 = Date.now();
await fetch(BASE + '/api/webai/ask', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ cxId, text: q, site: '127.0.0.1:8790', expect: N, timeout: 300000 })
});

let ans = null;
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const o = await (await fetch(BASE + '/api/webai/answer/' + cxId)).json();
  if (o.done) { ans = o; break; }
}
await b.close();

const text = (ans && ans.text) || '';
const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
const gotNums = lines.map((s) => parseInt(s, 10)).filter((v) => v > 0);
const lastNo = gotNums.length ? Math.max(...gotNums) : 0;
const secs = Math.round((Date.now() - t0) / 1000);
const pass = ans && ans.done && lastNo === N && lines.length >= N;

console.log(`耗时 ${secs}s, 回传 ${lines.length} 行, 最大题号 ${lastNo}, done=${!!(ans && ans.done)}`);
if (!pass) console.log('回传内容尾部:', JSON.stringify(text.slice(-120)));
console.log(pass ? 'PASS(等齐 30 题才收货,中途停顿未误判)' : 'FAIL(提前收货或超时)');
process.exit(pass ? 0 : 1);
