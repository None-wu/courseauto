// 安装页回归:验证第 3 步的版本提示文字并截图(dev/out/setup-ver.png)
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
const p = await b.newPage({ viewport: { width: 900, height: 800 } });
await p.goto('http://127.0.0.1:8790/setup', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
await p.screenshot({ path: 'out/setup-ver.png' });
console.log('verNote:', await p.textContent('#verNote'));
console.log('verMain:', await p.textContent('#verMain'));
await b.close();
