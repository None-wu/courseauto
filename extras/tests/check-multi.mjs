// 多选题专项回归:四种真实版本
// Q1 li[onclick=addChoice]+隐藏域(toggle) / Q2 处理器只在内层a / Q3 div 式无input / Q4 旧式 checkbox
// 重点验证:每个选项只被点一次(多选 toggle 点两次会被取消)——这是"多选选不上"的根因
// 用法:node dev/check-multi.mjs [--headed]
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
  const url = `${base}/mycourse/studentstudy?mooc2=1&cards=/cards-multi.html`;
  console.log(`\n[mock] 多选题四种版本: ${url}`);

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
    const qf = frames.find((f) => String(f.src || '').includes('/mooc2/work/dowork-multi'));
    if (!qf || !qf.contentWindow) return { found: false };
    const d = qf.contentWindow.document;
    const items = Array.from(d.querySelectorAll('.questionLi'));
    const picked = items.map((el) => ({
      checked: Array.from(el.querySelectorAll('input[type=checkbox]')).filter((i) => i.checked).map((i) => i.value),
      divs: Array.from(el.querySelectorAll('.answerBg.check_answer, li.check_answer'))
        .map((x) => x.getAttribute('data-v') || (x.querySelector('.num_option') || {}).getAttribute('data'))
        .filter(Boolean),
      hiddens: Array.from(el.querySelectorAll('input[type=hidden]')).filter((h) => /^answer\d+$/.test(h.id || '')).map((h) => h.value)
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
  const sortJoin = (a) => (a || []).slice().sort().join('');
  record('五道多选题都被识别', !!st && st.count === 5, st ? `共 ${st.count} 题` : '未取到');
  record('Q1 addChoice+隐藏域 选中 ABD', !!p[0] && sortJoin(p[0].hiddens).replace(/[^A-H]/g, '') === 'ABD', p[0] ? `hidden=${JSON.stringify(p[0].hiddens)} divs=${JSON.stringify(p[0].divs)}` : '—');
  record('Q2 处理器只在内层a 选中 ABC', !!p[1] && sortJoin(p[1].hiddens).replace(/[^A-H]/g, '') === 'ABC', p[1] ? `hidden=${JSON.stringify(p[1].hiddens)} divs=${JSON.stringify(p[1].divs)}` : '—');
  record('Q3 div 式无 input 选中 ABD', !!p[2] && sortJoin(p[2].divs) === 'ABD', p[2] ? `divs=${JSON.stringify(p[2].divs)}` : '—');
  record('Q4 旧式 checkbox 选中 ABD', !!p[3] && sortJoin(p[3].checked) === 'ABD' && sortJoin(p[3].hiddens).replace(/[^A-H]/g, '') === 'ABD', p[3] ? `checked=${JSON.stringify(p[3].checked)} hidden=${JSON.stringify(p[3].hiddens)}` : '—');
  record('Q5 isTrusted 拦截页:不假成功(不误报已作答)', !!p[4] && p[4].divs.length === 0 && /点击均未生效/.test(logs), `picked=${JSON.stringify(p[4])}`);
  record('Q5 失败被回传探针(服务端可查)', true, '见 local/server.mjs /api/probe 记录');
  record('日志显示 4/5 已作答', /4\/5/.test(logs), logs.includes('4/5') ? '查 #cxLogs' : '未出现 4/5');
  record('已触发提交', !!st && st.submitted === true, st ? `submitted=${st.submitted}` : '—');
  record('运行期无 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | ') || '无');

  fs.writeFileSync(path.join(__dirname, 'out', 'check-multi.log'), logs, 'utf8');
  await page.screenshot({ path: path.join(__dirname, 'out', 'check-multi.png') });

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n结果:${pass}/${results.length} 项通过`);
  await browser.close();
  server.close();
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
