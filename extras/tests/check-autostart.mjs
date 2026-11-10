// 「进入页面自动开始」开关 · 端到端验证
//   ① 默认开启:进页面直接开始刷课(状态「工作中」、视频在播)
//   ② 设置里取消勾选并保存 → autoStart=false 落盘
//   ③ 重载页面:只挂面板不跑循环,状态「已暂停」、视频不自动播
//   ④ 暂停态点 ▶ 能正常开始(状态「工作中」、视频在播)
// 用法:node extras/tests/check-autostart.mjs [--headed]
import { chromium } from 'playwright-core';
import { startMock } from '../../local/server.mjs';
import { loadGmShimCode } from './gm-shim-code.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = process.env.CX_SCRIPT || path.join(__dirname, '..', '..', 'userscripts', 'courseauto.user.js');

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

const readState = (page) => page.evaluate(() => {
  const status = (document.getElementById('cxStatus') || {}).textContent || '';
  const btn = (document.getElementById('cxRunBtn') || {}).textContent || '';
  const logs = (document.getElementById('cxLogs') || {}).textContent || '';
  let cfg = null;
  try { cfg = JSON.parse(localStorage.getItem('cxMock:cxConfig') || 'null'); } catch (e) { /* ignore */ }
  let player = null;
  try {
    const cards = document.querySelector('#iframe');
    const frames = Array.from(cards.contentWindow.document.querySelectorAll('iframe'));
    const vf = frames.find((f) => String(f.src || '').includes('/ananas/modules/video/'));
    if (vf && vf.contentWindow && vf.contentWindow.videojs) player = { paused: vf.contentWindow.videojs().paused() };
  } catch (e) { /* ignore */ }
  return { status, btn, logs, autoStart: cfg ? cfg.autoStart : undefined, player };
}).catch(() => null);

async function waitFor(page, pred, timeoutMs = 20000, step = 250) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await readState(page);
    if (last && pred(last)) return last;
    await page.waitForTimeout(step);
  }
  return last;
}

async function inject(page) {
  await page.addScriptTag({ content: fs.readFileSync(SCRIPT, 'utf8') });
}

async function main() {
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  const { server, port } = await startMock(0);
  const headless = !process.argv.includes('--headed');
  const browser = await chromium.launch({
    headless,
    executablePath: findChrome() || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript({ content: await loadGmShimCode() });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));

  // ===== ① 默认开启:进页面即开始 =====
  await page.goto(`http://127.0.0.1:${port}/mycourse/studentstudy?mooc2=1&cards=/cards.html`, { waitUntil: 'domcontentloaded' });
  await inject(page);
  const playing = await waitFor(page, (s) => s.player && s.player.paused === false, 25000);
  record('默认配置下进页面直接开始刷课', !!playing && playing.player && playing.player.paused === false,
    `paused=${playing && playing.player && playing.player.paused} 状态=${playing && playing.status}`);
  record('默认配置下 autoStart 视为开启', !!playing && playing.autoStart !== false,
    `autoStart=${playing && String(playing.autoStart)}`);

  // ===== ② 设置里关掉自动开始并保存 =====
  await page.click('#cxCfgBtn');
  await page.waitForTimeout(300);
  const hasBox = await page.locator('#cfgAutoStart').count();
  record('设置面板出现「进入页面自动开始」开关', hasBox === 1, `#cfgAutoStart count=${hasBox}`);
  const checkedByDefault = hasBox === 1 ? await page.locator('#cfgAutoStart').isChecked() : null;
  record('开关默认勾选', checkedByDefault === true, `checked=${checkedByDefault}`);
  if (hasBox === 1) await page.locator('#cfgAutoStart').uncheck();
  await page.click('#cfgSave');
  const saved = await waitFor(page, (s) => s.autoStart === false, 5000);
  record('取消勾选保存后 autoStart=false 已落盘', !!saved && saved.autoStart === false, `autoStart=${saved && String(saved.autoStart)}`);

  // ===== ③ 重载页面:停在暂停,视频不自动播 =====
  await page.reload({ waitUntil: 'domcontentloaded' });
  await inject(page);
  const pausedStart = await waitFor(page, (s) => /已暂停/.test(s.status), 15000);
  record('重载后状态显示「已暂停」', !!pausedStart && /已暂停/.test(pausedStart.status), `状态=${pausedStart && pausedStart.status}`);
  record('重载后日志提示按设置停在暂停', !!pausedStart && /停在暂停状态/.test(pausedStart.logs), '查 #cxLogs');
  record('面板按钮显示 ▶(等待手动开始)', !!pausedStart && /▶/.test(pausedStart.btn), `btn=${pausedStart && pausedStart.btn}`);
  await page.waitForTimeout(6000);
  const stillPaused = await readState(page);
  record('暂停态视频没有自动播放', !!stillPaused && (!stillPaused.player || stillPaused.player.paused === true),
    `paused=${stillPaused && stillPaused.player ? stillPaused.player.paused : '无播放器'}`);
  record('暂停态没有进入「工作中」', !!stillPaused && !/工作中/.test(stillPaused.status), `状态=${stillPaused && stillPaused.status}`);

  // ===== ④ 点 ▶ 正常开始 =====
  await page.click('#cxRunBtn');
  const started = await waitFor(page, (s) => s.player && s.player.paused === false, 25000);
  record('点 ▶ 后开始刷课(视频在播)', !!started && started.player && started.player.paused === false,
    `paused=${started && started.player && started.player.paused} 状态=${started && started.status}`);
  const working = await waitFor(page, (s) => /工作中/.test(s.status), 8000);
  record('点 ▶ 后状态为「工作中」', !!working && /工作中/.test(working.status), `状态=${working && working.status}`);
  record('全程无 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | ') || '无');

  await page.screenshot({ path: path.join(__dirname, 'out', 'check-autostart.png') });
  fs.writeFileSync(path.join(__dirname, 'out', 'check-autostart.log'),
    ((await readState(page)) || {}).logs || '', 'utf8');

  await browser.close();
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n结果:${pass}/${results.length} 项通过`);
  server.close();
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
