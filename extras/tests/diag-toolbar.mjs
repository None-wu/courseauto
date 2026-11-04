// 验证 actionToolbarSeen 的结构识别逻辑:回复下方出现"一排纯图标小控件"时判定为操作栏
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
await pg.goto('http://127.0.0.1:8790/ai-sym', { waitUntil: 'networkidle' });
const r = await pg.evaluate(() => new Promise((res) => {
  document.getElementById('input').value = 'hello';
  document.getElementById('send').click();
  // 3.5s 后回复+操作栏已出现,跑一遍 actionToolbarSeen 的结构识别逻辑
  setTimeout(() => {
    const box = document.querySelector('.chat-messages');
    let hit = false;
    for (const row of box.querySelectorAll('div')) {
      const kids = Array.from(row.children);
      if (kids.length < 3 || kids.length > 12) continue;
      if (row.querySelector('textarea, [contenteditable="true"]')) continue;
      let icon = 0;
      for (const k of kids) {
        const rc = k.getBoundingClientRect();
        if (rc.width >= 16 && rc.width <= 60 && rc.height >= 16 && rc.height <= 60 && (k.querySelector('svg') || k.tagName === 'BUTTON')) icon++;
      }
      if (icon === kids.length) { hit = true; break; }
    }
    res({ toolbarSeen: hit });
  }, 3500);
}));
console.log(JSON.stringify(r));
await b.close();
