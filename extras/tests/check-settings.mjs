// 设置面板 · 填充率固定 100% + 提交后准确率阈值 + 定时关闭
// 验证:填充率输入框只读固定 100% / 准确率阈值可改 0~100 且越界收敛 / 开关联动置灰 /
//       定时关闭 HH:MM 校验(非法值不生效) / 旧的「每日时长上限」已彻底移除
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

  // 1) 填充率固定 100%、只读不可改
  await openCfg();
  const fillVal = await page.inputValue('#cfgAccuracy');
  const fillDisabled = await page.isDisabled('#cfgAccuracy');
  record('填充率输入框固定显示 100%', fillVal.replace(/\s/g, '') === '100%', `value=${fillVal}`);
  record('填充率输入框只读不可编辑', fillDisabled === true, `disabled=${fillDisabled}`);

  // 2) 旧「每日时长上限」输入框已移除
  const hasDaily = await page.locator('#cfgDaily').count();
  record('旧的「每日时长上限」输入框已移除', hasDaily === 0, `#cfgDaily count=${hasDaily}`);

  // 3) 准确率阈值默认 90,可改
  const defAcc = await page.inputValue('#cfgMinAcc');
  record('准确率阈值默认 90', defAcc === '90', `value=${defAcc}`);
  await page.fill('#cfgMinAcc', '85');
  await page.click('#cfgSave');
  await page.waitForTimeout(300);
  const saved = await readCfg();
  record('改成 85% 后保存成功(0.85)', Math.abs((saved.minAccuracy || 0) - 0.85) < 1e-6, `minAccuracy=${saved.minAccuracy}`);

  // 4) 重新打开读回 85
  await openCfg();
  const reopened = await page.inputValue('#cfgMinAcc');
  record('重新打开设置仍显示 85', reopened === '85', `value=${reopened}`);

  // 5) 越界 150 → 100
  await page.fill('#cfgMinAcc', '150');
  await page.click('#cfgSave');
  await page.waitForTimeout(300);
  const clamped = await readCfg();
  record('越界值 150 自动收敛为 100', Math.abs((clamped.minAccuracy || 0) - 1) < 1e-6, `minAccuracy=${clamped.minAccuracy}`);

  // 6) 负数 -20 → 0
  await openCfg();
  await page.fill('#cfgMinAcc', '-20');
  await page.click('#cfgSave');
  await page.waitForTimeout(300);
  const neg = await readCfg();
  record('负数 -20 自动收敛为 0', Math.abs(neg.minAccuracy || 0) < 1e-6, `minAccuracy=${neg.minAccuracy}`);

  // 7) 关闭准确率检测开关 → 阈值输入置灰
  await openCfg();
  await page.uncheck('#cfgAccCheck');
  await page.waitForTimeout(150);
  const accDisabled = await page.isDisabled('#cfgMinAcc');
  record('关闭「提交后准确率检测」后阈值输入置灰', accDisabled === true, `disabled=${accDisabled}`);

  // 8) 定时关闭:合法值生效、非法值不覆盖
  await page.fill('#cfgStopAt', '23:30');
  await page.click('#cfgSave');
  await page.waitForTimeout(300);
  const stopOk = await readCfg();
  record('定时关闭 23:30 保存成功', stopOk.stopAtTime === '23:30', `stopAtTime=${stopOk.stopAtTime}`);

  await openCfg();
  await page.fill('#cfgStopAt', '25:99');
  await page.click('#cfgSave');
  await page.waitForTimeout(300);
  const stopBad = await readCfg();
  record('非法时间 25:99 不生效(保持 23:30)', stopBad.stopAtTime === '23:30', `stopAtTime=${stopBad.stopAtTime}`);

  // 9) 清空 → 不关闭
  await openCfg();
  await page.fill('#cfgStopAt', '');
  await page.click('#cfgSave');
  await page.waitForTimeout(300);
  const stopNone = await readCfg();
  record('清空定时关闭后 stopAtTime 为空', !stopNone.stopAtTime, `stopAtTime=${JSON.stringify(stopNone.stopAtTime)}`);

  record('运行期无 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | ') || '无');

  await page.screenshot({ path: path.join(__dirname, 'out', 'check-settings.png') });
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n结果:${pass}/${results.length} 项通过`);
  await browser.close();
  server.close();
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
