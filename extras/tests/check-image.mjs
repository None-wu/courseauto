// 图片题送图链路:主脚本 →(中继 images 字段)→ 桥 → AI 页的 file input → 提问带上图
// 以前题干是图片时,复制出来只是一串地址,AI 看不到图;这条用例锁住"图真的传上去了"
import { chromium } from 'playwright-core';
import { startMock } from '../../local/server.mjs';
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

// 8x8 红色 PNG(够小,base64 固定,不依赖外部资源)
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX/AAD///9BHTQRAAAADklEQVQI12P4z8DAwMAAAA0AAf8B9tYAAAAASUVORK5CYII=';
const Q = '请回答下面这道单选题。要求:第一行只写答案,不要解释、不要复述题目。\n\n题目:[图片1] 1+1等于几?(题干是图片,请看图作答)\n选项:\nA. 1\nB. 2\nC. 3\nD. 4\n\n答案格式:单选题写字母(如 C)。';

let failed = 0;
const ok = (cond, name, extra) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? '  — ' + extra : ''}`);
  if (!cond) failed++;
};

const mock = await startMock(0);
const BASE = `http://127.0.0.1:${mock.port}`;
const HOST = BASE.replace(/^https?:\/\//, '');
const b = await chromium.launch({ headless: true, executablePath: findChrome() || undefined });
const ctx = await b.newContext();
await ctx.addInitScript((relay) => { try { localStorage.setItem('cxRelay', relay); } catch (e) {} }, BASE);
const aiPage = await ctx.newPage();
await aiPage.goto(BASE + '/ai', { waitUntil: 'networkidle' });
await aiPage.waitForTimeout(3000);   // 等桥起轮询

const cxId = 'img' + Math.random().toString(36).slice(2);
const askRes = await fetch(BASE + '/api/webai/ask', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  // images 就是主脚本 ensureQuestionImages() 抓出来的 dataURL(最多 3 张)
  body: JSON.stringify({ cxId, text: Q, site: HOST, images: [PNG, PNG] })
});
const askBody = await askRes.json().catch(() => ({}));
console.log('  · /api/webai/ask 入队:', JSON.stringify(askBody).slice(0, 100));

let ans = null;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const o = await (await fetch(BASE + '/api/webai/answer/' + cxId)).json();
  if (o.done) { ans = o; break; }
}

console.log('断言:');
ok(!!ans, '图片题收到 AI 回答', ans ? String(ans.text || '').slice(0, 40) : '超时未回传');
ok(!!ans && /[B]/.test(String(ans.text || '')), '回答内容可用(1+1 → B)', ans ? String(ans.text).slice(0, 20) : '');
const sentImgs = await aiPage.evaluate(() => window.__lastSentImgs || 0);
ok(sentImgs >= 1, '配图真的传进了 AI 输入框', `AI 页收到 ${sentImgs} 张图`);
const bubbles = await aiPage.evaluate(() => Array.from(document.querySelectorAll('.msg.me')).map((n) => n.textContent || ''));
ok(bubbles.some((t) => /附图\s*\d+\s*张/.test(t)), '提问气泡里带上附图标记', (bubbles[0] || '').replace(/\n/g, ' | ').slice(0, 60));

await b.close();
mock.server.close();
console.log(`\n结果:${failed ? failed + ' 项失败' : '全部通过'}`);
process.exit(failed ? 1 : 0);
