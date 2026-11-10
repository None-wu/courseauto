// 提交规则 · 端到端验证(填充率 100% + 提交后准确率检测)
// 覆盖四个场景:
//   A 填充率不足(2 题只填上 1 题)     → 不提交,记入「未提交」栏
//   B 填充率 100% + 准确率达标          → 提交后直接进下一个节点
//   C 填充率 100% + 准确率不达标 + 可重做 → 重问错题、写错题本、点击重做
//   D 填充率 100% + 准确率不达标 + 不可重做 → 只报告,不做后续处理
//   E 弹窗式判分(只弹「未达及格线,请重做」,无分数无对错图标)→ 关弹窗、按错题处理、点重做
// 用法:node extras/tests/check-accuracy.mjs [--headed]
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

// 终止标志:日志里出现任一条即说明该场景已经走到终点,不用再等
const STOP_MARKS = ['填充率必须 100%', '准确率达标', '无错题', '没有「重做」入口', '错题处理完成', '未读到判分结果'];

async function runCase(port, headless, opt) {
  const base = `http://127.0.0.1:${port}`;
  const url = `${base}/mycourse/studentstudy?mooc2=1&cards=${opt.cards}`;
  const browser = await chromium.launch({
    headless,
    executablePath: findChrome() || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-popup-blocking']
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript({ content: await loadGmShimCode() });
  await context.addInitScript(({ acc, check, fixAll, redoMax }) => {
    try {
      // 预置迁移标记:否则脚本首启的 v1.5.0 迁移会把 minAccuracy 强制重置为 0.9,
      // 测试注入的阈值就白设了
      localStorage.setItem('cxMock:cxMigV105', 'true');
      localStorage.setItem('cxMock:cxMigV150', 'true');
      const k = 'cxMock:cxConfig';
      const raw = localStorage.getItem(k);
      const cfg = raw ? JSON.parse(raw) : {};
      cfg.autoSubmit = true;
      cfg.minAccuracy = acc;
      cfg.accCheckEnabled = check;
      if (typeof fixAll === 'boolean') cfg.accFixAllWrong = fixAll;
      if (typeof redoMax === 'number') cfg.accRedoMax = redoMax;
      localStorage.setItem(k, JSON.stringify(cfg));
    } catch (e) { /* ignore */ }
  }, { acc: opt.acc, check: opt.check !== false, fixAll: opt.fixAll, redoMax: opt.redoMax });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ content: fs.readFileSync(SCRIPT, 'utf8') });

  const readState = () => page.evaluate(() => {
    const out = { logs: '', submitted: false, noSubmit: false, redoClicked: false, statFail: '', fixCount: 0, gateOk: 0, gateLeft: false };
    const el = document.getElementById('cxLogs');
    out.logs = el ? el.textContent : '';
    const fc = document.getElementById('cxStatFail');
    out.statFail = fc ? String(fc.textContent || '') : '';
    try { out.fixCount = JSON.parse(localStorage.getItem('cxMock:cxFixBank') || '[]').length; } catch (e) { /* ignore */ }
    const cards = document.querySelector('#iframe');
    if (cards && cards.contentWindow) {
      const frames = Array.from(cards.contentWindow.document.querySelectorAll('iframe'));
      const qf = frames.find((f) => /dowork-(acc|gate)/.test(String(f.src || '')));
      if (qf && qf.contentWindow) {
        out.submitted = !!qf.contentWindow.__submitted;
        out.noSubmit = !!qf.contentWindow.__noSubmit;
        out.redoClicked = !!qf.contentWindow.__redoClicked;
        out.gateOk = qf.contentWindow.__gateOk || 0;
        const box = qf.contentWindow.document.getElementById('gateBox');
        out.gateLeft = !!(box && box.classList.contains('on'));
      }
    }
    return out;
  }).catch(() => null);

  let st = null;
  for (let i = 0; i < 120; i++) {
    st = await readState();
    if (st && STOP_MARKS.some((m) => st.logs.includes(m))) break;
    await page.waitForTimeout(500);
  }
  const tag = opt.tag;
  fs.writeFileSync(path.join(__dirname, 'out', `check-accuracy-${tag}.log`), st ? st.logs : '(no state)', 'utf8');
  await page.screenshot({ path: path.join(__dirname, 'out', `check-accuracy-${tag}.png`) });
  await browser.close();
  return { st, errors };
}

async function main() {
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  const { server, port } = await startMock(0);
  const headless = !process.argv.includes('--headed');

  // A) 填充率不足:第 2 题 AI 给不出有效答案 → 填充率 50% → 不提交
  const a = await runCase(port, headless, { tag: 'fill', cards: '/cards-accuracy.html', acc: 0.4 });
  record('填充率 50%:不自动提交', a.st && a.st.submitted === false && a.st.noSubmit === true,
    `submitted=${a.st && a.st.submitted} noSubmit=${a.st && a.st.noSubmit}`);
  record('日志说明填充率必须 100%', !!a.st && /填充率\s*50%/.test(a.st.logs) && /填充率必须 100%/.test(a.st.logs), '查 #cxLogs');
  record('未提交任务点计入「未提交」栏', !!a.st && a.st.statFail === '1', `statFail=${a.st && a.st.statFail}`);

  // B) 全对(无错题)→ 直接进下一个节点,不折腾重做
  const b0 = await runCase(port, headless, { tag: 'allright', cards: '/cards-acc2.html?all=1', acc: 0.9 });
  record('无错题判定为全对', !!b0.st && /无错题/.test(b0.st.logs), '查 #cxLogs');
  record('全对时不点重做', !!b0.st && b0.st.redoClicked === false, `redoClicked=${b0.st && b0.st.redoClicked}`);
  record('全对时不写错题本', !!b0.st && b0.st.fixCount === 0, `fixBank=${b0.st && b0.st.fixCount}`);

  // C) 有 1 道错题 + 准确率 50% ≥ 阈值 40% +「有错题就修」开(默认)→ 仍要修错题并重做
  //    (新语义:先看有没有错题,有错就修,不被整体准确率放过)
  const b = await runCase(port, headless, { tag: 'fixall', cards: '/cards-acc2.html', acc: 0.4, fixAll: true });
  record('填充率 100%:自动提交', !!b.st && b.st.submitted === true, `submitted=${b.st && b.st.submitted}`);
  record('有错题就修:准确率达标也修错题', !!b.st && /错题处理完成/.test(b.st.logs) && b.st.fixCount >= 1, `fixBank=${b.st && b.st.fixCount}`);
  record('有错题就修:点击「重做」', !!b.st && b.st.redoClicked === true, `redoClicked=${b.st && b.st.redoClicked}`);

  // D) 关掉「有错题就修」+ 准确率 50% ≥ 阈值 40% → 按阈值放行,不重做
  const c0 = await runCase(port, headless, { tag: 'pass', cards: '/cards-acc2.html', acc: 0.4, fixAll: false });
  record('阈值模式:准确率 50% ≥ 40% 判定达标', !!c0.st && /准确率达标/.test(c0.st.logs), '查 #cxLogs');
  record('阈值模式达标时不点重做', !!c0.st && c0.st.redoClicked === false, `redoClicked=${c0.st && c0.st.redoClicked}`);

  // E) 关掉「有错题就修」+ 准确率 50% < 阈值 90% + 有重做入口 → 错题重问 + 写错题本 + 点重做
  const c = await runCase(port, headless, { tag: 'retry', cards: '/cards-acc2.html', acc: 0.9, fixAll: false });
  record('阈值模式:准确率 50% < 90% 判定未通过', !!c.st && /提交后准确率\s*50%/.test(c.st.logs) && !/准确率达标/.test(c.st.logs), '查 #cxLogs');
  record('未通过时逐题处理错题并写错题本', !!c.st && /错题处理完成/.test(c.st.logs) && c.st.fixCount >= 1, `fixBank=${c.st && c.st.fixCount}`);
  record('未通过时点击「重做」', !!c.st && c.st.redoClicked === true, `redoClicked=${c.st && c.st.redoClicked}`);

  // F) 不可重复提交(无重做入口)→ 只报告不处理
  const d = await runCase(port, headless, { tag: 'noredo', cards: '/cards-acc2.html?redo=0', acc: 0.9, fixAll: false });
  record('不可重复提交:不点重做', !!d.st && d.st.redoClicked === false, `redoClicked=${d.st && d.st.redoClicked}`);
  record('不可重复提交:日志说明放弃后续处理', !!d.st && /没有「重做」入口/.test(d.st.logs), '查 #cxLogs');

  // G) 弹窗式判分:提交后只弹「未达及格线,请重做」,页面没有正确率也没有对错 class
  //    → 必须点掉弹窗、按"有错题"处理、写错题本、点重做;不能报"未读到判分结果"就放弃
  const g = await runCase(port, headless, { tag: 'gate', cards: '/cards-acc2.html?gate=1', acc: 0.9, fixAll: true });
  record('弹窗式判分:识别到未达及格线弹窗', !!g.st && /未达及格线/.test(g.st.logs), '查 #cxLogs');
  record('弹窗式判分:不再误报"未读到判分结果"', !!g.st && !/未读到判分结果/.test(g.st.logs),
    g.st && /未读到判分结果/.test(g.st.logs) ? '仍出现未读到判分' : '无');
  record('弹窗式判分:点掉弹窗(确定)', !!g.st && g.st.gateOk >= 1 && g.st.gateLeft === false,
    `gateOk=${g.st && g.st.gateOk} gateLeft=${g.st && g.st.gateLeft}`);
  record('弹窗式判分:按错题处理并写错题本', !!g.st && /错题处理完成/.test(g.st.logs) && g.st.fixCount >= 1, `fixBank=${g.st && g.st.fixCount}`);
  record('弹窗式判分:点击「重做」', !!g.st && g.st.redoClicked === true, `redoClicked=${g.st && g.st.redoClicked}`);

  record('六个场景均无 JS 异常',
    [b0, b, c0, c, d, g].every((x) => x.errors.length === 0),
    [...b0.errors, ...b.errors, ...c0.errors, ...c.errors, ...d.errors, ...g.errors].slice(0, 2).join(' | ') || '无');

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n结果:${pass}/${results.length} 项通过`);
  server.close();
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
