// 设置面板 · 精简后控件校验(v1.6.1)
// 验证:已删控件确实不存在 / 倍速与准确率/重做次数越界收敛 / 定时关闭 HH:MM 校验 / 自动开始与切章持久化
// 用法:node extras/tests/check-settings.mjs [--headed]
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
  const url = `${base}/mycourse/studentstudy?mooc2=1&cards=/cards.html`;
  console.log(`\n[mock] 设置面板: ${url}`);

  const browser = await chromium.launch({
    headless: !process.argv.includes('--headed'),
    executablePath: findChrome() || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-popup-blocking']
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript({ content: await loadGmShimCode() });
  // 垫片会预置一份「老存档」(speed 1 / 阈值 0.9),这里清掉以模拟真实全新安装,
  // 校验默认值确实是面板声明的 2x 与 100%
  await context.addInitScript({ content: "try{['cxConfig','cxMigV105','cxMigV150','cxMigV161'].forEach(k=>localStorage.removeItem('cxMock:'+k));}catch(e){}" });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ content: fs.readFileSync(SCRIPT, 'utf8') });
  await page.waitForSelector('#cxCfgBtn', { timeout: 15000 });

  const openCfg = async () => {
    if (await page.locator('#cxCfgPanel').count()) await page.evaluate(() => { const p = document.getElementById('cxCfgPanel'); if (p) p.remove(); });
    await page.click('#cxCfgBtn');
    await page.waitForSelector('#cxCfgPanel', { timeout: 5000 });
  };
  const readCfg = () => page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('cxMock:cxConfig') || '{}'); } catch (e) { return {}; }
  });

  // 1) v1.6.0 裁掉的控件必须真的不存在
  await openCfg();
  for (const id of ['cfgAccuracy', 'cfgAccCheck', 'cfgDeliberate', 'cfgAiVision', 'cfgReportUrl', 'cfgExport', 'cfgSkipStuck', 'cfgAutoSubmit', 'cfgDaily']) {
    const n = await page.locator('#' + id).count();
    record(`已删控件 #${id} 不存在`, n === 0, `count=${n}`);
  }
  // 2) 保留的控件都在
  for (const id of ['cfgSpeed', 'cfgAutoStart', 'cfgStopAt', 'cfgWebAI', 'cfgWebAiBatch', 'cfgWebAiUrl', 'cfgMinAcc', 'cfgAccRedoMax', 'cfgJump', 'cfgSave']) {
    const n = await page.locator('#' + id).count();
    record(`保留控件 #${id} 存在`, n === 1, `count=${n}`);
  }

  // 3) 倍速:默认 2,越界收敛到 1~2
  const defSpeed = await page.inputValue('#cfgSpeed');
  record('倍速默认 2', defSpeed === '2', `value=${defSpeed}`);
  await page.fill('#cfgSpeed', '3');
  await page.click('#cfgSave');
  await page.waitForTimeout(300);
  let cfg = await readCfg();
  record('倍速填 3 收敛为 2', Math.abs((cfg.speed || 0) - 2) < 1e-6, `speed=${cfg.speed}`);
  await openCfg();
  await page.fill('#cfgSpeed', '0.5');
  await page.click('#cfgSave');
  await page.waitForTimeout(300);
  cfg = await readCfg();
  record('倍速填 0.5 收敛为 1', Math.abs((cfg.speed || 0) - 1) < 1e-6, `speed=${cfg.speed}`);

  // 4) 准确率阈值:默认 100,可改,越界收敛
  await openCfg();
  const defAcc = await page.inputValue('#cfgMinAcc');
  record('准确率阈值默认 100', defAcc === '100', `value=${defAcc}`);
  await page.fill('#cfgMinAcc', '85');
  await page.click('#cfgSave');
  await page.waitForTimeout(300);
  cfg = await readCfg();
  record('改 85% 保存为 0.85', Math.abs((cfg.minAccuracy || 0) - 0.85) < 1e-6, `minAccuracy=${cfg.minAccuracy}`);
  await openCfg();
  const reopened = await page.inputValue('#cfgMinAcc');
  record('重新打开仍显示 85', reopened === '85', `value=${reopened}`);
  await page.fill('#cfgMinAcc', '150');
  await page.click('#cfgSave');
  await page.waitForTimeout(300);
  cfg = await readCfg();
  record('越界 150 收敛为 100', Math.abs((cfg.minAccuracy || 0) - 1) < 1e-6, `minAccuracy=${cfg.minAccuracy}`);
  await openCfg();
  await page.fill('#cfgMinAcc', '-20');
  await page.click('#cfgSave');
  await page.waitForTimeout(300);
  cfg = await readCfg();
  record('负数 -20 收敛为 0', Math.abs(cfg.minAccuracy || 0) < 1e-6, `minAccuracy=${cfg.minAccuracy}`);

  // 5) 最多自动重做:1~5
  await openCfg();
  await page.fill('#cfgAccRedoMax', '9');
  await page.click('#cfgSave');
  await page.waitForTimeout(300);
  cfg = await readCfg();
  record('重做次数 9 收敛为 5', cfg.accRedoMax === 5, `accRedoMax=${cfg.accRedoMax}`);
  await openCfg();
  await page.fill('#cfgAccRedoMax', '0');
  await page.click('#cfgSave');
  await page.waitForTimeout(300);
  cfg = await readCfg();
  record('重做次数 0 收敛为 1', cfg.accRedoMax === 1, `accRedoMax=${cfg.accRedoMax}`);

  // 6) 定时关闭:合法值生效、非法值不覆盖、清空即关闭
  await openCfg();
  await page.fill('#cfgStopAt', '23:30');
  await page.click('#cfgSave');
  await page.waitForTimeout(300);
  cfg = await readCfg();
  record('定时关闭 23:30 保存成功', cfg.stopAtTime === '23:30', `stopAtTime=${cfg.stopAtTime}`);
  await openCfg();
  await page.fill('#cfgStopAt', '25:99');
  await page.click('#cfgSave');
  await page.waitForTimeout(300);
  cfg = await readCfg();
  record('非法时间 25:99 不生效(保持 23:30)', cfg.stopAtTime === '23:30', `stopAtTime=${cfg.stopAtTime}`);
  await openCfg();
  await page.fill('#cfgStopAt', '');
  await page.click('#cfgSave');
  await page.waitForTimeout(300);
  cfg = await readCfg();
  record('清空后 stopAtTime 为空', !cfg.stopAtTime, `stopAtTime=${JSON.stringify(cfg.stopAtTime)}`);

  // 7) 自动开始 / 自动切章:勾选状态持久化
  await openCfg();
  await page.uncheck('#cfgAutoStart');
  await page.uncheck('#cfgJump');
  await page.click('#cfgSave');
  await page.waitForTimeout(300);
  cfg = await readCfg();
  record('关闭「进入页面自动开始」已存盘', cfg.autoStart === false, `autoStart=${cfg.autoStart}`);
  record('关闭「自动切章」已存盘', cfg.autoJump === false, `autoJump=${cfg.autoJump}`);
  await openCfg();
  const asChecked = await page.isChecked('#cfgAutoStart');
  const jumpChecked = await page.isChecked('#cfgJump');
  record('重开面板回显为未勾选', asChecked === false && jumpChecked === false, `autoStart=${asChecked} autoJump=${jumpChecked}`);

  // 8) 精简后不再写这些已删键(避免把死配置又存回存档)
  cfg = await readCfg();
  const ghost = ['aiVision', 'skipStuckChapter', 'autoSubmit', 'accCheckEnabled', 'accFixAllWrong', 'deliberateErrorRate', 'reportUrl']
    .filter((k) => Object.prototype.hasOwnProperty.call(cfg, k));
  record('存档里不再出现已删除的配置键', ghost.length === 0, ghost.join(',') || '无');

  record('运行期无 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | ') || '无');

  await page.screenshot({ path: path.join(__dirname, 'out', 'check-settings.png') });
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n结果:${pass}/${results.length} 项通过`);
  await browser.close();
  server.close();
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
