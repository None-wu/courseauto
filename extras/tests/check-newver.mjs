// 新版 newTiMu 结构专项回归(按用户真实探针复刻)
// 结构:li[onclick="addMultipleChoice(this)"][qid][role=checkbox] + span.num_option_dx[data] + answer<qid> 隐藏域,无 input
// 关键点:脚本运行在顶层,题目元素在内层 iframe —— 页面函数只挂在 iframe 的 window 上。
// 以前用 unsafeWindow(顶层)找函数永远找不到 → 点击无效;现在走"元素自身 onclick 函数对象"直调。
// 用法:node dev/check-newver.mjs [--headed]
import { chromium } from 'playwright-core';
import { startMock } from '../../local/server.mjs';
import { loadGmShimCode } from './gm-shim-code.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = process.env.CX_SCRIPT || path.join(__dirname, '..', '..', 'userscripts', 'xuexitong-autostudy.user.js');

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
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  const { server, port } = await startMock(0);
  const base = `http://127.0.0.1:${port}`;
  const url = `${base}/mycourse/studentstudy?mooc2=1&cards=/cards-newver.html`;
  console.log(`\n[mock] 新版 newTiMu 结构: ${url}`);

  const browser = await chromium.launch({
    headless: !process.argv.includes('--headed'),
    executablePath: findChrome() || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-popup-blocking']
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript({ content: await loadGmShimCode() });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ content: fs.readFileSync(SCRIPT, 'utf8') });

  const readState = () => page.evaluate(() => {
    const cards = document.querySelector('#iframe');
    if (!cards || !cards.contentWindow) return null;
    const frames = Array.from(cards.contentWindow.document.querySelectorAll('iframe'));
    const qf = frames.find((f) => String(f.src || '').includes('/mooc2/work/dowork-newver'));
    if (!qf || !qf.contentWindow) return { found: false };
    const d = qf.contentWindow.document;
    const items = Array.from(d.querySelectorAll('.TiMu'));
    return {
      found: true,
      count: items.length,
      submitted: !!qf.contentWindow.__submitted,
      answers: items.map((el) => {
        const h = el.querySelector('input[type=hidden][id^=answer]');
        return h ? h.value : '';
      }),
      marked: items.map((el) => el.querySelectorAll('.check_answer').length)
    };
  }).catch(() => null);

  let st = null;
  for (let i = 0; i < 150; i++) {
    st = await readState();
    if (st && st.found && st.submitted) break;
    await page.waitForTimeout(500);
  }

  const logs = await page.evaluate(() => {
    const el = document.getElementById('cxLogs');
    return el ? el.textContent : '';
  }).catch(() => '');
  fs.writeFileSync(path.join(__dirname, 'out', 'check-newver.log'), logs, 'utf8');
  await page.screenshot({ path: path.join(__dirname, 'out', 'check-newver.png') });

  const a = (st && st.answers) || [];
  const m = (st && st.marked) || [];
  record('四道题都被识别', !!st && st.count === 4, st ? `共 ${st.count} 题` : '未取到');
  record('Q1 多选 answer=ABD', a[0] === 'ABD', `answer=${JSON.stringify(a[0])} marked=${m[0]}`);
  record('Q2 多选 answer=ABC', a[1] === 'ABC', `answer=${JSON.stringify(a[1])} marked=${m[1]}`);
  record('Q3 判断 answer=true(HTTPS 443)', a[2] === 'true', `answer=${JSON.stringify(a[2])} marked=${m[2]}`);
  record('Q4 判断 answer=false(地球是平的)', a[3] === 'false', `answer=${JSON.stringify(a[3])} marked=${m[3]}`);
  record('选项有可见选中标记(至少 1 个/题)', m.length === 4 && m.every((n) => n >= 1), `marked=${JSON.stringify(m)}`);
  record('四题全部记作答成功', /4\/4/.test(logs), logs.includes('4/4') ? '查 #cxLogs' : '未出现 4/4');
  record('已触发提交', !!st && st.submitted === true, st ? `submitted=${st.submitted}` : '—');
  record('运行期无 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | ') || '无');

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n结果:${pass}/${results.length} 项通过`);
  await browser.close();
  server.close();
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
