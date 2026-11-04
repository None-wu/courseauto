// 端到端跑雨课堂适配器：无头 Chromium + GM 垫片 + 模拟课程页
// 重点验证:静音播放、被平台强制暂停后自动恢复(保活)、播完自动连播
// 用法:node dev/run-ykt.mjs [--headed]
import { chromium } from 'playwright-core';
import { startMock } from '../../local/server.mjs';
import { loadGmShimCode } from './gm-shim-code.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', '..', 'userscripts', 'courseauto.user.js');
const OUT = path.join(__dirname, 'out');

function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
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

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? '  — ' + detail : ''}`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, port } = await startMock(0);
  const base = `http://127.0.0.1:${port}`;
  console.log(`\n[mock] 模拟雨课堂: ${base}/yuketang/course.html`);

  const browser = await chromium.launch({
    headless: !process.argv.includes('--headed'),
    executablePath: findChrome() || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript({ content: await loadGmShimCode() });
  await context.addInitScript(() => { window.__CX_FORCE_PLATFORM = 'yuketang'; });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(`${base}/yuketang/course.html`, { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ content: fs.readFileSync(SCRIPT, 'utf8') });

  const st = async () => page.evaluate(() => (window.__ykt ? window.__ykt.state : null));

  // 等播放起来，并观察到"被平台暂停"至少一次(说明保活有活干)
  let s = null;
  let sawPlay = false;
  let maxPauseCount = 0;
  for (let i = 0; i < 70; i++) {
    s = await st();
    if (s) {
      if (s.t > 0 && !s.paused) sawPlay = true;
      maxPauseCount = Math.max(maxPauseCount, s.pauseCount);
      if (s.cur >= 1 && s.answered !== null) break;
    }
    await page.waitForTimeout(500);
  }

  // 等第 2 节自己播起来
  let s2 = s;
  for (let i = 0; i < 40; i++) {
    s2 = await st();
    if (s2 && s2.cur >= 1 && s2.t > 3 && !s2.paused) break;
    await page.waitForTimeout(500);
  }

  const logs = await page.evaluate(() => {
    const el = document.getElementById('cxLogs');
    return el ? el.textContent : '';
  }).catch(() => '');

  record('面板已渲染并显示平台徽标', logs.includes('雨课堂适配器'), '查 #cxLogs');
  record('视频被自动播放', sawPlay, '采样到 currentTime>0 且未暂停');
  record('视频被静音', !!s && s.muted === true, s ? `muted=${s.muted}` : '—');
  record('保活:被平台暂停后自动恢复', maxPauseCount > 0 && sawPlay, `平台强制暂停 ${maxPauseCount} 次,脚本已恢复播放`);
  record('弹题被识别并作答(B)', !!s && s.answered === 1, s ? `选项索引=${s.answered}` : '—');
  record('播完自动连播到第 2 节', !!s2 && s2.cur >= 1, s2 ? `当前节点=${s2.cur + 1}` : '—');
  record('运行期无 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | ') || '无');

  await page.screenshot({ path: path.join(OUT, 'run-ykt.png') });
  fs.writeFileSync(path.join(OUT, 'run-ykt.log'), logs, 'utf8');

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n结果:${pass}/${results.length} 项通过`);
  await browser.close();
  server.close();
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
