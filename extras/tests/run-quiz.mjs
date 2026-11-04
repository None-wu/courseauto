// 端到端:新版「测验直嵌 dowork」结构下,章节测验能否被识别并作答
// 复现的真实结构:任务点 iframe 直接是 /mooc2/work/dowork,外面没有 ananas/modules/work 包装层
// 用法:node dev/run-quiz.mjs [--headed]
import { chromium } from 'playwright-core';
import { startMock } from '../../local/server.mjs';
import { loadGmShimCode } from './gm-shim-code.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = process.env.CX_SCRIPT || path.join(__dirname, '..', '..', 'userscripts', 'courseauto.user.js');
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
  const url = `${base}/mycourse/studentstudy?mooc2=1&cards=/cards-direct.html`;
  console.log(`\n[mock] 测验直嵌结构: ${url}`);

  // --webai:改用「网页 AI」通道(模拟对话页 /ai),验证你实际使用的那条链路
  const webai = process.argv.includes('--webai');
  const browser = await chromium.launch({
    headless: !process.argv.includes('--headed'),
    executablePath: findChrome() || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-popup-blocking']
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript({ content: await loadGmShimCode() });
  if (webai) {
    await context.addInitScript(({ u }) => {
      try {
        const k = 'cxMock:cxConfig';
        const raw = localStorage.getItem(k);
        const cfg = raw ? JSON.parse(raw) : {};
        cfg.webAiEnabled = true;
        cfg.webAiUrl = u;
        cfg.aiEnabled = false;
        localStorage.setItem(k, JSON.stringify(cfg));
      } catch (e) { /* ignore */ }
    }, { u: `${base}/ai` });
    console.log('[mock] 通道切换:网页 AI(模拟对话页 ' + base + '/ai）');
  }

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ content: fs.readFileSync(SCRIPT, 'utf8') });

  // 轮询 dowork iframe 内的作答状态
  const quizState = () => page.evaluate(() => {
    const cards = document.querySelector('#iframe');
    if (!cards || !cards.contentWindow) return null;
    const frames = Array.from(cards.contentWindow.document.querySelectorAll('iframe'));
    const qf = frames.find((f) => String(f.src || '').includes('/mooc2/work/dowork'));
    if (!qf || !qf.contentWindow) return { found: false };
    const d = qf.contentWindow.document;
    const items = Array.from(d.querySelectorAll('.questionLi'));
    const picked = items.map((el) => {
      const inputs = Array.from(el.querySelectorAll('input[type=radio], input[type=checkbox]'));
      const checked = inputs.filter((i) => i.checked).map((i) => i.value);
      const ta = el.querySelector('textarea');
      return { checked, text: ta ? ta.value : '' };
    });
    return { found: true, count: items.length, picked, submitted: !!qf.contentWindow.__submitted };
  }).catch(() => null);

  let st = null;
  for (let i = 0; i < 90; i++) {
    st = await quizState();
    if (st && st.found && st.submitted) break;
    await page.waitForTimeout(500);
  }

  const logs = await page.evaluate(() => {
    const el = document.getElementById('cxLogs');
    return el ? el.textContent : '';
  }).catch(() => '');

  const p = (st && st.picked) || [];
  record('测验任务点被识别(未当成未知类型)', logs.includes('🧩 题目容器已定位') && !logs.includes('未知任务类型'), '查 #cxLogs');
  record('题目全部识别', !!st && st.count === 4, st ? `共 ${st.count} 题` : '未取到');
  record('单选题作答(A)', !!p[0] && p[0].checked.join('') === 'A', p[0] ? `checked=${JSON.stringify(p[0].checked)}` : '—');
  record('判断题按选项文字兜底作答(正确)', !!p[1] && p[1].checked.join('') === 'true', p[1] ? `checked=${JSON.stringify(p[1].checked)}` : '—');
  record('多选题作答(ABD)', !!p[2] && p[2].checked.slice().sort().join('') === 'ABD', p[2] ? `checked=${JSON.stringify(p[2].checked)}` : '—');
  record('填空题写入内容', !!p[3] && p[3].text.trim().length > 0, p[3] ? `"${p[3].text}"` : '—');
  record('已触发提交', !!st && st.submitted === true, st ? `submitted=${st.submitted}` : '—');
  if (webai) record('网页 AI 通道参与作答', logs.includes('网页 AI'), '查 #cxLogs 的网页 AI 回复行');
  record('运行期无 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | ') || '无');

  await page.screenshot({ path: path.join(OUT, webai ? 'run-quiz-ai.png' : 'run-quiz.png') });
  fs.writeFileSync(path.join(OUT, webai ? 'run-quiz-ai.log' : 'run-quiz.log'), logs, 'utf8');

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n结果:${pass}/${results.length} 项通过`);
  console.log(`截图:${path.join(OUT, webai ? 'run-quiz-ai.png' : 'run-quiz.png')}`);
  await browser.close();
  server.close();
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
