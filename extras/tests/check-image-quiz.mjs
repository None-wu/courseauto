// 端到端:题干是图片时,主脚本能不能把图抓出来、跟着题一起送到网页 AI
// 复现的痛点:题干里只有一个 <img>,「复制题目」拿到的是一串地址,AI 看到的是 [图片1] 和链接 → 答不出
// 用法:node check-image-quiz.mjs [--headed]
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

const { server, port } = await startMock(0);
const base = `http://127.0.0.1:${port}`;
const url = `${base}/mycourse/studentstudy?mooc2=1&cards=/cards-img.html`;
console.log(`\n[mock] 图片题干测验: ${url}`);

const browser = await chromium.launch({
  headless: !process.argv.includes('--headed'),
  executablePath: findChrome() || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-popup-blocking']
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addInitScript({ content: await loadGmShimCode() });
// 网页 AI 通道 + 中转都指到 mock 自己(否则桥会去打默认的 8790,测试机上没人应答)
await context.addInitScript(({ u, relay }) => {
  try {
    const k = 'cxMock:cxConfig';
    const raw = localStorage.getItem(k);
    const cfg = raw ? JSON.parse(raw) : {};
    cfg.webAiEnabled = true;
    cfg.webAiUrl = u;
    cfg.webAiRelay = relay;
    cfg.aiEnabled = false;
    localStorage.setItem(k, JSON.stringify(cfg));
    localStorage.setItem('cxRelay', relay);
  } catch (e) { /* ignore */ }
}, { u: `${base}/ai`, relay: base });

const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

let aiPage = null;
context.on('page', (p) => { if (p !== page && p.url().includes('/ai')) aiPage = p; });

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.addScriptTag({ content: fs.readFileSync(SCRIPT, 'utf8') });

// 轮询 dowork iframe 里的作答状态
const quizState = () => page.evaluate(() => {
  const cards = document.querySelector('#iframe');
  if (!cards || !cards.contentWindow) return null;
  const frames = Array.from(cards.contentWindow.document.querySelectorAll('iframe'));
  const qf = frames.find((f) => String(f.src || '').includes('/mooc2/work/dowork'));
  if (!qf || !qf.contentWindow) return { found: false };
  const d = qf.contentWindow.document;
  const items = Array.from(d.querySelectorAll('.questionLi'));
  return {
    found: true,
    count: items.length,
    picked: items.map((el) => {
      const inputs = Array.from(el.querySelectorAll('input[type=radio], input[type=checkbox]'));
      return { checked: inputs.filter((i) => i.checked).map((i) => i.value) };
    }),
    submitted: !!qf.contentWindow.__submitted
  };
}).catch(() => null);

let st = null;
// 图片题逐题问 + 剩余文字题整批问,每题要等网页 AI 气泡稳定(约 28s),整卷跑完约 2 分钟
for (let i = 0; i < 400; i++) {
  st = await quizState();
  if (st && st.found && st.submitted) break;
  await page.waitForTimeout(500);
}

// 脚本会自己 window.open 网页 AI 页;兜底从 context 里按 URL 找一遍
if (!aiPage) aiPage = context.pages().find((p) => p.url().includes('/ai')) || null;
await page.waitForTimeout(1500);

const logs = await page.evaluate(() => {
  const el = document.getElementById('cxLogs');
  return el ? el.textContent : '';
}).catch(() => '');

const p = (st && st.picked) || [];
console.log('断言:');
record('图片题干测验被识别并作答', !!st && st.found && st.count === 4, st ? `共 ${st.count} 题` : '未取到');
record('图片被抽出并随题发送', /这道题含\s*\d+\s*张图片/.test(logs), (logs.match(/这道题含[^\n]*/) || [''])[0].slice(0, 46));
const sentImgs = aiPage ? await aiPage.evaluate(() => window.__lastSentImgs || 0).catch(() => 0) : 0;
// 以服务端为准:整卷后半段是纯文字题,所以看"累计带图请求数"而不是最后一次
const lastChat = await (await fetch(base + '/mock/last-chat')).json().catch(() => ({}));
const imgAsks = Number(lastChat.imgAsks || 0) || (Number(lastChat.imgParts || 0) ? 1 : 0);
console.log(`  · 页面变量 ${sentImgs} 张 / 服务端带图请求 ${imgAsks} 次`);
record('图片真的出现在 AI 输入框', imgAsks >= 1 || sentImgs >= 1,
  `带图提问 ${imgAsks} 次:${String(lastChat.lastImgPrompt || lastChat.prompt || '').replace(/\s+/g, ' ').slice(0, 46)}`);
record('文字题+图片题都作答(单选 A)', !!p[0] && p[0].checked.join('') === 'A', p[0] ? `checked=${JSON.stringify(p[0].checked)}` : '—');
record('纯图片题干判断题作答', !!p[1] && p[1].checked.length > 0, p[1] ? `checked=${JSON.stringify(p[1].checked)}` : '—');
record('多选题作答(ABD)', !!p[2] && p[2].checked.slice().sort().join('') === 'ABD', p[2] ? `checked=${JSON.stringify(p[2].checked)}` : '—');
record('已触发提交', !!st && st.submitted === true, st ? `submitted=${st.submitted}` : '—');
record('未走图片抓取失败兜底', !/题目图片抓取失败/.test(logs), '查 #cxLogs');
record('运行期无 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | ') || '无');

fs.mkdirSync(OUT, { recursive: true });
await page.screenshot({ path: path.join(OUT, 'run-quiz-img.png') });
fs.writeFileSync(path.join(OUT, 'run-quiz-img.log'), logs, 'utf8');

const pass = results.filter((r) => r.ok).length;
console.log(`\n结果:${pass}/${results.length} 项通过`);
console.log(`截图:${path.join(OUT, 'run-quiz-img.png')}`);
await browser.close();
server.close();
process.exit(pass === results.length ? 0 : 1);
