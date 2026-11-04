// 判断题专项回归:三种真实版本(点 li 无效只认 label / div 式无 input / value=对·错)
// + AI 答案写法差异(正确、错误、带句号、字母)
// 用法:node dev/check-judge.mjs [--headed]
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

async function main() {
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  const { server, port } = await startMock(0);
  const base = `http://127.0.0.1:${port}`;
  const url = `${base}/mycourse/studentstudy?mooc2=1&cards=/cards-judge.html`;
  console.log(`\n[mock] 判断题三种版本: ${url}`);

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
    const qf = frames.find((f) => String(f.src || '').includes('/mooc2/work/dowork-judge'));
    if (!qf || !qf.contentWindow) return { found: false };
    const d = qf.contentWindow.document;
    const items = Array.from(d.querySelectorAll('.questionLi'));
    const picked = items.map((el) => ({
      inputs: Array.from(el.querySelectorAll('input:checked')).map((i) => i.value),
      divs: Array.from(el.querySelectorAll('.answerBg.check_answer, li.check_answer')).map((x) => x.getAttribute('data-v')),
      hiddens: Array.from(el.querySelectorAll('input[type=hidden]')).filter((h) => /^answer\d+$/.test(h.id || '')).map((h) => h.value),
      options: Array.from(el.querySelectorAll('.answerBg')).length
    }));
    return { found: true, count: items.length, picked, submitted: !!qf.contentWindow.__submitted };
  }).catch(() => null);

  let st = null;
  for (let i = 0; i < 120; i++) {
    st = await readState();
    if (st && st.found && st.submitted) break;
    await page.waitForTimeout(500);
  }

  const logs = await page.evaluate(() => {
    const el = document.getElementById('cxLogs');
    return el ? el.textContent : '';
  }).catch(() => '');

  const p = (st && st.picked) || [];
  record('七道判断题都被识别', !!st && st.count === 8, st ? `共 ${st.count} 题` : '未取到');
  record('Q1 只认 label 的站点已选中「正确」', !!p[0] && p[0].inputs.join('') === 'true', p[0] ? `checked=${JSON.stringify(p[0].inputs)}` : '—');
  record('Q2 div 式无 input 的站点已选中「错误」', !!p[1] && p[1].divs.join('') === 'false', p[1] ? `divs=${JSON.stringify(p[1].divs)}` : '—');
  record('Q3 value=对/错 的站点已选中「对」', !!p[2] && p[2].inputs.join('') === '对', p[2] ? `checked=${JSON.stringify(p[2].inputs)}` : '—');
  record('Q4 选项加密乱码的站点按顺序选中「正确」', !!p[3] && p[3].inputs.join('') === 'A', p[3] ? `checked=${JSON.stringify(p[3].inputs)}` : '—');
  record('Q5 div 式+乱码文字的站点按顺序选中「错误」', !!p[4] && p[4].divs.join('') === 'false', p[4] ? `divs=${JSON.stringify(p[4].divs)}` : '—');
  record('Q6 无radio+处理器在内层a的站点已选中「正确」', !!p[5] && p[5].divs.join('') === 'true', p[5] ? `divs=${JSON.stringify(p[5].divs)}` : '—');
  record('Q7 无radio+连写文字+pointerdown的站点已选中「错误」', !!p[6] && p[6].divs.join('') === 'false', p[6] ? `divs=${JSON.stringify(p[6].divs)}` : '—');
  record('Q8 真实探针结构(addChoice+隐藏域)已记录答案', !!p[7] && p[7].hiddens.join('') === 'B', p[7] ? `hiddens=${JSON.stringify(p[7].hiddens)}` : '—');
  record('日志显示 8/8 已作答', /8\/8/.test(logs), logs.includes('8/8') ? '查 #cxLogs' : '未出现 8/8');
  record('已触发提交', !!st && st.submitted === true, st ? `submitted=${st.submitted}` : '—');
  record('运行期无 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | ') || '无');

  fs.writeFileSync(path.join(__dirname, 'out', 'check-judge.log'), logs, 'utf8');
  await page.screenshot({ path: path.join(__dirname, 'out', 'check-judge.png') });

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n结果:${pass}/${results.length} 项通过`);
  await browser.close();
  server.close();
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
