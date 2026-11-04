// 端到端跑智慧树适配器：无头 Chromium + GM 垫片 + 模拟 playVideo 页
// 用法:node dev/run-zhs.mjs [--headed]
import { chromium } from 'playwright-core';
import { startMock } from '../../local/server.mjs';
import { loadGmShimCode } from './gm-shim-code.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', '..', 'userscripts', 'xuexitong-autostudy.user.js');
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
  console.log(`\n[mock] 模拟智慧树: ${base}/zhihuishu/videoStudy.html`);

  const browser = await chromium.launch({
    headless: !process.argv.includes('--headed'),
    executablePath: findChrome() || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript({ content: await loadGmShimCode() });
  // 页面是本地 mock,用测试钩子让适配器认领(真实环境靠域名匹配)
  await context.addInitScript(() => { window.__CX_FORCE_PLATFORM = 'zhihuishu'; });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(`${base}/zhihuishu/videoStudy.html`, { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ content: fs.readFileSync(SCRIPT, 'utf8') });

  const has = async (kw) => page.evaluate((k) => {
    const el = document.getElementById('cxLogs');
    return el ? el.textContent.includes(k) : false;
  }, kw).catch(() => false);

  const st = async () => page.evaluate(() => (window.__zhs ? window.__zhs.state : null));

  // 阶段一:等视频开播 + 弹题被答 + 播完自动切到第 2 节
  let s = null;
  let sawPlaying = false;
  let firstRate = 0;
  for (let i = 0; i < 90; i++) {
    s = await st();
    if (s) {
      if (s.t > 0 && !s.paused) { sawPlaying = true; firstRate = s.rate; }
      if (s.cur >= 1 && s.popupAnswered !== null) break;
    }
    await page.waitForTimeout(500);
  }

  // 阶段二:第 2 节应该自己播起来(切换后需要几秒)
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

  record('面板已渲染并显示平台徽标', logs.includes('智慧树适配器') || (await has('智慧树')), '查 #cxLogs');
  record('视频被自动播放', sawPlaying, '播放过程中采样到 currentTime>0 且未暂停');
  record('视频被静音', !!s && s.muted === true, s ? `muted=${s.muted}` : '—');
  record('播放速率被限制在 1.5x 以内', firstRate > 0 && firstRate <= 1.5, `rate=${firstRate}`);
  record('弹题被识别并作答(B)', !!s && s.popupAnswered === 1, s ? `选项索引=${s.popupAnswered}` : '—');
  record('播完自动切到下一个节点', !!s2 && s2.cur >= 1, s2 ? `当前节点=${s2.cur + 1}` : '—');
  record('切换后继续播放', !!s2 && s2.paused === false && s2.t > 3, s2 ? `currentTime=${s2.t}` : '—');
  record('运行期无 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | ') || '无');

  await page.screenshot({ path: path.join(OUT, 'run-zhs.png') });
  fs.writeFileSync(path.join(OUT, 'run-zhs.log'), logs, 'utf8');

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n结果:${pass}/${results.length} 项通过`);
  console.log(`截图:${path.join(OUT, 'run-zhs.png')}`);
  await browser.close();
  server.close();
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
