// 设置面板 · 自动提交正确率阈值(可自定义)
// 验证:默认 60 / 可改成任意 0~100 / 保存后持久化 / 越界自动收敛 / 关闭开关时输入框置灰
// 用法:node dev/check-settings.mjs [--headed]
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
    await page.click('#cxCfgBtn');
    await page.waitForSelector('#cxCfgPanel', { timeout: 5000 });
  };
  const readCfg = () => page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('cxMock:cxConfig') || '{}'); } catch (e) { return {}; }
  });

  // 1) 默认值 60
  await openCfg();
  const defVal = await page.inputValue('#cfgAccuracy');
  const defEnabled = await page.isEnabled('#cfgAccuracy');
  record('设置面板出现「正确率阈值」输入框,默认 60', defVal === '60' && defEnabled, `value=${defVal} enabled=${defEnabled}`);

  // 2) 改成 85 保存并持久化
  await page.fill('#cfgAccuracy', '85');
  await page.click('#cfgSave');
  await page.waitForTimeout(300);
  const saved = await readCfg();
  record('改成 85% 后保存成功(0.85)', Math.abs((saved.minAccuracy || 0) - 0.85) < 1e-6, `minAccuracy=${saved.minAccuracy}`);

  // 3) 重新打开面板,读回 85
  await openCfg();
  const reopened = await page.inputValue('#cfgAccuracy');
  record('重新打开设置仍显示 85', reopened === '85', `value=${reopened}`);

  // 4) 越界:150 → 收敛为 100
  await page.fill('#cfgAccuracy', '150');
  await page.click('#cfgSave');
  await page.waitForTimeout(300);
  const clamped = await readCfg();
  await openCfg();
  const clampVal = await page.inputValue('#cfgAccuracy');
  record('越界值 150 自动收敛为 100', Math.abs((clamped.minAccuracy || 0) - 1) < 1e-6 && clampVal === '100', `minAccuracy=${clamped.minAccuracy} value=${clampVal}`);

  // 5) 负数 → 收敛为 0(不看正确率)
  await page.fill('#cfgAccuracy', '-20');
  await page.click('#cfgSave');
  await page.waitForTimeout(300);
  const neg = await readCfg();
  await openCfg();
  const negVal = await page.inputValue('#cfgAccuracy');
  record('负数 -20 自动收敛为 0', Math.abs(neg.minAccuracy || 0) < 1e-6 && negVal === '0', `minAccuracy=${neg.minAccuracy} value=${negVal}`);

  // 6) 关闭「自动提交」后输入框置灰
  await page.uncheck('#cfgSubmit');
  await page.waitForTimeout(150);
  const disabled = await page.isDisabled('#cfgAccuracy');
  record('关闭自动提交后阈值输入框置灰不可编辑', disabled === true, `disabled=${disabled}`);

  record('运行期无 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | ') || '无');

  await page.screenshot({ path: path.join(__dirname, 'out', 'check-settings.png') });
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n结果:${pass}/${results.length} 项通过`);
  await browser.close();
  server.close();
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
