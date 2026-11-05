// 暂停 / 恢复 / 手动切页 · 端到端验证
// 场景 A(章节页 1,视频任务):
//   ① 点暂停 → 视频立刻停、运行时长冻结
//   ② 点恢复 → 视频继续、时长继续走
// 场景 B(新开一页,视频播放中手动把 #iframe 切到第 2 章):
//   ③ 脚本识别到切换并重扫新页面(继续处理第 2 章任务)
// 用法:node extras/tests/check-pause.mjs [--headed]
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
  const time = (document.getElementById('cxStatTime') || {}).textContent || '';
  const logs = (document.getElementById('cxLogs') || {}).textContent || '';
  const cards = document.querySelector('#iframe');
  let player = null;
  try {
    const frames = Array.from(cards.contentWindow.document.querySelectorAll('iframe'));
    const vf = frames.find((f) => String(f.src || '').includes('/ananas/modules/video/'));
    if (vf && vf.contentWindow && vf.contentWindow.videojs) player = { paused: vf.contentWindow.videojs().paused() };
  } catch (e) { /* ignore */ }
  return { status, time, logs, player };
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

async function openPage(browser, port) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript({ content: await loadGmShimCode() });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await page.goto(`http://127.0.0.1:${port}/mycourse/studentstudy?mooc2=1&cards=/cards.html`, { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ content: fs.readFileSync(SCRIPT, 'utf8') });
  return { page, errors };
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

  // ===== 场景 A:暂停 / 恢复 =====
  const a = await openPage(browser, port);
  const playing = await waitFor(a.page, (s) => s.player && s.player.paused === false, 25000);
  record('挂机开始后视频在播', !!playing && playing.player && playing.player.paused === false,
    `paused=${playing && playing.player && playing.player.paused} 状态=${playing && playing.status}`);

  await a.page.click('#cxRunBtn');
  const pausedSoon = await waitFor(a.page, (s) => s.player && s.player.paused === true, 5000);
  record('点暂停后视频立刻停止(≤5s)', !!pausedSoon && pausedSoon.player && pausedSoon.player.paused === true,
    `paused=${pausedSoon && pausedSoon.player && pausedSoon.player.paused}`);
  record('状态显示「已暂停」', !!pausedSoon && /已暂停/.test(pausedSoon.status), `状态=${pausedSoon && pausedSoon.status}`);

  await a.page.waitForTimeout(1500);
  const settled = await readState(a.page);
  const t1 = settled && settled.time;
  await a.page.waitForTimeout(3000);
  const after3s = await readState(a.page);
  const t2 = after3s && after3s.time;
  record('暂停期间运行时长不再增长', !!t1 && !!t2 && t1 === t2, `${t1} → ${t2}`);
  record('暂停期间视频保持暂停(没被自动拉起)', !!after3s && after3s.player && after3s.player.paused === true,
    `paused=${after3s && after3s.player && after3s.player.paused}`);

  await a.page.click('#cxRunBtn');
  const resumed = await waitFor(a.page, (s) => s.player && s.player.paused === false, 8000);
  record('点恢复后视频继续播放', !!resumed && resumed.player && resumed.player.paused === false,
    `paused=${resumed && resumed.player && resumed.player.paused}`);
  await a.page.waitForTimeout(2500);
  const laterTime = await readState(a.page);
  record('恢复后运行时长继续增长', !!laterTime && !!t2 && laterTime.time !== t2, `${t2} → ${laterTime && laterTime.time}`);
  record('场景 A 无 JS 异常', a.errors.length === 0, a.errors.slice(0, 2).join(' | ') || '无');
  await a.page.screenshot({ path: path.join(__dirname, 'out', 'check-pause.png') });
  await a.page.context().close();

  // ===== 场景 B:视频播放中手动切到第 2 章 =====
  const b = await openPage(browser, port);
  const playingB = await waitFor(b.page, (s) => s.player && s.player.paused === false, 25000);
  await b.page.evaluate(() => {   // 模拟用户点左侧目录换节
    const f = document.querySelector('#iframe');
    if (f) f.src = '/cards.html?ch=2';
  });
  const switched = await waitFor(b.page, (s) => /检测到页面已切换/.test(s.logs) && /(开始播放音频|图片任务)/.test(s.logs), 40000);
  const logsB = (switched && switched.logs) || '';
  record('切页前视频在播(触发切换场景)', !!playingB && playingB.player && playingB.player.paused === false, '查 #cxLogs');
  record('识别到手动切页并提示重扫', /检测到页面已切换/.test(logsB), '查 #cxLogs');
  record('切页后按新页面继续处理(第 2 章音频/图片任务)', /(开始播放音频|图片任务)/.test(logsB), '查 #cxLogs');
  const doneB = await waitFor(b.page, (s) => /(本章扫描结束|✓ 音频任务完成|✓ 图片任务处理完成)/.test(s.logs), 40000);
  const logsDone = (doneB && doneB.logs) || logsB;
  record('切页后任务能跑完,不卡在「工作中」空转', /(本章扫描结束|✓ 音频任务完成|✓ 图片任务处理完成)/.test(logsDone), '查 #cxLogs');
  record('场景 B 无 JS 异常', b.errors.length === 0, b.errors.slice(0, 2).join(' | ') || '无');
  fs.writeFileSync(path.join(__dirname, 'out', 'check-pause.log'), logsB, 'utf8');
  await b.page.screenshot({ path: path.join(__dirname, 'out', 'check-pause-switch.png') });

  await browser.close();
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n结果:${pass}/${results.length} 项通过`);
  server.close();
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
