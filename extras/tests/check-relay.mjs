// 中转通道端到端:模拟主脚本放题 → AI 页的桥脚本取题作答 → 回传
// 四种结构都测:/ai(textarea) /ai-ce(contenteditable+paste,模拟元宝/Quill) /ai-diff(仿元宝消息列表,无已知回复选择器→走文本增量识别) /ai-sym(英文UI+同类名气泡回显陷阱+图标发送按钮+英文停止按钮)
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

// 自己起 mock(随机端口):本机 8790 常被真实的中转 exe 占着,不能去碰它
const mock = await startMock(0);
const BASE = process.env.RELAY_BASE || `http://127.0.0.1:${mock.port}`;
const HOST = BASE.replace(/^https?:\/\//, '');
const Q = '请回答下面这道单选题。要求:第一行只写答案,不要解释、不要复述题目。\n\n题目:1+1等于几?\n选项:\nA. 1\nB. 2\nC. 3\nD. 4\n\n答案格式:单选题写字母(如 C);判断题写「正确」或「错误」。';
let failed = 0;

const b = await chromium.launch({ headless: true, executablePath: findChrome() || undefined });
// /ai-ds:DeepSeek 新输入条(受控 textarea + 图标圆钮 + 置灰态,回车不生效)
for (const pagePath of ['/ai', '/ai-ce', '/ai-diff', '/ai-sym', '/ai-ds']) {
  const ctx = await b.newContext();
  // 桥脚本从 localStorage.cxRelay 读中转地址(默认 8790)。测试机 8790 可能被真实 exe 占着,
  // 不指过来的话桥会把心跳打到真服务上,本 mock 永远收不到题
  await ctx.addInitScript((relay) => { try { localStorage.setItem('cxRelay', relay); } catch (e) {} }, BASE);
  const aiPage = await ctx.newPage();
  await aiPage.goto(BASE + pagePath, { waitUntil: 'networkidle' });
  await aiPage.waitForTimeout(3000);   // 等桥脚本起轮询

  const cxId = 'e2e' + Math.random().toString(36).slice(2);
  await fetch(BASE + '/api/webai/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cxId, text: Q, site: HOST })   // 模拟主脚本:站点匹配
  });

  let ans = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const o = await (await fetch(BASE + '/api/webai/answer/' + cxId)).json();
    if (o.done) { ans = o; break; }
  }
  const full = ans && ans.text && (ans.text.includes('题目完整') || /[A-D正确错误]/.test(ans.text.split('\n').pop() || ans.text));
  console.log(`[${pagePath}] 回传:`, ans ? JSON.stringify(ans).slice(0, 120) : '超时未回传', full ? '← 多行题目完整' : '← 多行丢失!');
  if (!full) failed++;
  await ctx.close();
}
await b.close();
mock.server.close();
process.exit(failed ? 1 : 0);
