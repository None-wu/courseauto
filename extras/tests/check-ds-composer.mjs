// 反证:/ai-ds 这个 mock 能不能复现「只改 DOM value + dispatch input」发不出去?
// 直接用"旧做法"填值 + 点发送键,应当发送失败(说明这页真的模拟了受控组件的坑)
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

const mock = await startMock(0);
const BASE = process.env.RELAY_BASE || `http://127.0.0.1:${mock.port}`;
const b = await chromium.launch({ headless: true, executablePath: findChrome() || undefined });
const page = await b.newPage();
await page.goto(BASE + '/ai-ds', { waitUntil: 'load' });
await page.waitForTimeout(500);

// ① 旧做法:原生 setter + 合成 input 事件(untrusted)
const filled = await page.evaluate(() => {
  const ta = document.querySelector('textarea');
  ta.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, '测试题目 1+1=?');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.dispatchEvent(new Event('change', { bubbles: true }));
  return ta.value;
});
const disabledAfterOld = await page.evaluate(() => document.querySelector('.ds-button--circle').getAttribute('aria-disabled'));
await page.evaluate(() => document.querySelector('.ds-button--circle').click());
await page.waitForTimeout(400);
const sentByOld = await page.evaluate(() => !!window.__dsSent);
const ignored = await page.evaluate(() => window.__dsClickIgnored || 0);

// ② 新做法:execCommand('insertText')(可信事件)
const disabledAfterNew = await page.evaluate(() => {
  const ta = document.querySelector('textarea');
  ta.focus();
  ta.select();
  document.execCommand('insertText', false, '测试题目 1+1=?');
  return document.querySelector('.ds-button--circle').getAttribute('aria-disabled');
});
await page.evaluate(() => document.querySelector('.ds-button--circle').click());
await page.waitForTimeout(1200);
const sentByNew = await page.evaluate(() => !!window.__dsSent);

console.log('旧做法: 填入=', JSON.stringify(filled), '发送键 aria-disabled=', disabledAfterOld, '发出=', sentByOld, '被忽略点击=', ignored);
console.log('新做法: 发送键 aria-disabled=', disabledAfterNew, '发出=', sentByNew);
const ok = sentByOld === false && ignored > 0 && sentByNew === true;
console.log(ok ? '\n✓ mock 有效:旧做法确实发不出去,新做法能发出去' : '\n✗ mock 没复现故障,测试无意义');
await b.close();
mock.server.close();
process.exit(ok ? 0 : 1);
