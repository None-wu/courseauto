// 端到端跑一遍被测脚本：无头 Chromium + GM 垫片 + 模拟学习通页面
// 用法:node run.mjs
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
  console.log(`\n[mock] 模拟学习通: ${base}`);
  console.log(`[mock] 被测脚本  : ${path.basename(SCRIPT)}`);
  console.log('[mock] 开始注入运行...\n');

  const exe = findChrome();
  const headed = process.argv.includes('--headed');
  const webai = process.argv.includes('--webai');
  const browser = await chromium.launch({
    headless: !headed,
    executablePath: exe || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-popup-blocking']
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript({ content: await loadGmShimCode() });

  // --webai:把配置切到「网页 AI」通道,指向本地模拟的 AI 对话页
  // 中转地址也指向 mock 自己的端口(默认 8790 是真实客户环境,测试机上通常没起 → 会误判"桥不在线")
  if (webai) {
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
        localStorage.setItem('cxRelay', relay);   // 桥脚本读这个:让它把心跳打到 mock 而不是 8790
      } catch (e) { /* ignore */ }
    }, { u: `${base}/ai`, relay: base });
    console.log('[mock] 通道切换:网页 AI(模拟对话页 ' + base + '/ai,中转 ' + base + ')\n');
  }

  const page = await context.newPage();
  const consoleLines = [];
  page.on('console', (m) => consoleLines.push(m.text()));
  page.on('pageerror', (e) => consoleLines.push('[pageerror] ' + e.message));

  await page.goto(`${base}/mycourse/studentstudy?mooc2=1`, { waitUntil: 'load' });
  await page.addScriptTag({ path: SCRIPT });

  const seen = new Set();
  const state = {
    quiz: false, submitted: false, audio: false, image: false,
    chapter2: false, error: false, panel: false, webAi: false
  };

  const logsText = async () => {
    try { return await page.$eval('#cxLogs', (el) => el.innerText); } catch { return ''; }
  };
  const frameBy = (frag) => page.frames().find((f) => f.url().includes(frag));

  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const text = await logsText();
    if (text) { state.panel = true; text.split('\n').forEach((l) => { if (l.trim()) seen.add(l.trim()); }); }
    if (/主循环异常|未捕获|TypeError/.test(text)) state.error = true;

    if (!state.quiz) {
      const f = frameBy('/ananas/modules/video/');
      if (f) { try { state.quiz = await f.evaluate(() => !!window.__quizAnswered); } catch { /* nav */ } }
    }
    if (!state.submitted) {
      const f = frameBy('/work/doHomeWorkNew');
      if (f) { try { state.submitted = await f.evaluate(() => !!window.__submitted); } catch { /* nav */ } }
    }
    if (!state.audio) {
      const f = frameBy('/ananas/modules/audio/');
      if (f) { try { state.audio = await f.evaluate(() => !!window.__audioDone); } catch { /* nav */ } }
    }
    if (!state.chapter2) {
      try {
        state.chapter2 = await page.$eval('#iframe', (el) => String(el.getAttribute('src') || '').includes('ch=2'));
      } catch { /* ignore */ }
    }
    if (!state.image && /图片任务处理完成/.test(text)) state.image = true;

    if (state.quiz && state.submitted && state.chapter2 && state.image && state.audio) break;
    await new Promise((r) => setTimeout(r, 300));
  }

  const all = [...seen].join('\n');
  const has = (s) => all.includes(s);

  console.log('断言:');
  record('面板已渲染并输出版本日志', state.panel && has('已加载'), '查 #cxLogs 与版本行');
  if (webai) {
    record('网页 AI 通道已连接', has('网页 AI 已连接'), 'CX_HELLO 握手');
    record('网页 AI 通道作答', has('[网页AI] 查到答案'), 'postMessage 往返取回答案');
  }
  record('视频任务开始播放', has('开始播放视频'), 'videoTask 进入');
  record('视频弹题被自动作答', state.quiz, '弹题"继续学习"被点击');
  record('视频任务完成', has('视频播放结束') || has('学习通报告本任务点已完成'), 'ended 或 isUnFinishJob');
  record('章节测验提交', state.submitted, 'btnBlueSubmit 被调用');
  record('测验逐题作答', /第 1\/4 题|共 4 题/.test(all), '4 题均被处理');
  record('自动切到第 2 章', state.chapter2, 'nextChapter 被点击');
  record('音频任务完成', state.audio || has('音频任务完成'), 'ended 事件');
  record('图片任务完成', state.image, '停留 5~8s 后收尾');
  record('主循环无异常', !state.error, '未出现"主循环异常"');

  // 上报链路
  const rep = await (await fetch(`${base}/report/last`)).json();
  record('状态上报链路可用', Array.isArray(rep) && rep.length > 0, `收到 ${rep.length} 条快照`);

  await page.screenshot({ path: path.join(OUT, 'run.png'), fullPage: false });
  if (webai) {
    const popup = page.context().pages().find((p) => p.url().includes('/ai'));
    if (popup) await popup.screenshot({ path: path.join(OUT, 'run-ai.png'), fullPage: false }).catch(() => {});
  }
  fs.writeFileSync(path.join(OUT, 'run.log'), '===== 面板日志 =====\n' + all + '\n\n===== console =====\n' + consoleLines.join('\n'), 'utf8');

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n结果:${passed}/${results.length} 项通过`);
  console.log(`截图:${path.join(OUT, 'run.png')}`);
  console.log(`日志:${path.join(OUT, 'run.log')}\n`);

  await browser.close();
  server.close();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
