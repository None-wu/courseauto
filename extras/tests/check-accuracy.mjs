// 自动提交阈值 · 端到端验证
// 场景:2 题测验,固定只有 1 题能答对(50%)。
//   阈值 60% → 不提交(暂存);阈值 40% → 自动提交。
// 用法:node dev/check-accuracy.mjs [--headed]
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

async function runCase(port, headless, minAccuracy) {
  const base = `http://127.0.0.1:${port}`;
  const url = `${base}/mycourse/studentstudy?mooc2=1&cards=/cards-accuracy.html`;
  const browser = await chromium.launch({
    headless,
    executablePath: findChrome() || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-popup-blocking']
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript({ content: await loadGmShimCode() });
  await context.addInitScript(({ acc }) => {
    try {
      const k = 'cxMock:cxConfig';
      const raw = localStorage.getItem(k);
      const cfg = raw ? JSON.parse(raw) : {};
      cfg.autoSubmit = true;
      cfg.minAccuracy = acc;
      localStorage.setItem(k, JSON.stringify(cfg));
    } catch (e) { /* ignore */ }
  }, { acc: minAccuracy });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ content: fs.readFileSync(SCRIPT, 'utf8') });

  const readState = () => page.evaluate(() => {
    const cards = document.querySelector('#iframe');
    if (!cards || !cards.contentWindow) return null;
    const frames = Array.from(cards.contentWindow.document.querySelectorAll('iframe'));
    const qf = frames.find((f) => String(f.src || '').includes('/mooc2/work/dowork-accuracy'));
    if (!qf || !qf.contentWindow) return { found: false };
    return {
      found: true,
      submitted: !!qf.contentWindow.__submitted,
      noSubmit: !!qf.contentWindow.__noSubmit,
      checked: Array.from(qf.contentWindow.document.querySelectorAll('input[type=radio]:checked')).map((i) => i.value)
    };
  }).catch(() => null);

  let st = null;
  for (let i = 0; i < 120; i++) {
    st = await readState();
    if (st && st.found && (st.submitted || st.noSubmit)) break;
    await page.waitForTimeout(500);
  }
  const logs = await page.evaluate(() => {
    const el = document.getElementById('cxLogs');
    return el ? el.textContent : '';
  }).catch(() => '');
  fs.writeFileSync(path.join(__dirname, 'out', `check-accuracy-${Math.round(minAccuracy * 100)}.log`), logs, 'utf8');
  await page.screenshot({ path: path.join(__dirname, 'out', `check-accuracy-${Math.round(minAccuracy * 100)}.png`) });
  await browser.close();
  return { st, logs, errors };
}

async function main() {
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  const { server, port } = await startMock(0);
  const headless = !process.argv.includes('--headed');

  // 场景一:阈值 60%,实际 50% → 不提交
  const a = await runCase(port, headless, 0.6);
  record('阈值 60% / 实际 50%:未自动提交', a.st && a.st.submitted === false, `submitted=${a.st && a.st.submitted}`);
  record('日志说明低于阈值且提示可调设置', /低于阈值 60%/.test(a.logs) && /可在设置里调整阈值/.test(a.logs), '查 #cxLogs');
  record('两道题都尝试作答(答不出的记失败)', a.st && a.st.checked.length >= 1, `checked=${JSON.stringify(a.st && a.st.checked)}`);

  // 场景二:阈值 40%,实际 50% → 提交
  const b = await runCase(port, headless, 0.4);
  record('阈值 40% / 实际 50%:自动提交', !!b.st && b.st.submitted === true, `submitted=${b.st && b.st.submitted}`);
  record('提交日志带出阈值 40%', /≥ 阈值 40%/.test(b.logs), '查 #cxLogs');

  record('两个场景均无 JS 异常', a.errors.length === 0 && b.errors.length === 0,
    [...a.errors, ...b.errors].slice(0, 2).join(' | ') || '无');

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n结果:${pass}/${results.length} 项通过`);
  server.close();
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
