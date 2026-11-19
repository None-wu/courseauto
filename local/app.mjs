// 客户版入口:打包成单个 exe,双击即起本地服务并打开安装向导
// 打包:node tools/pack.mjs  →  dist/刷课助手-vX.exe
// 开发:node local/app.mjs   (没打包时自动从磁盘读脚本,行为一致)
//
// 启动流程:
//   1) 起本地服务(端口 8790,被占则 +1)
//   2) 读本机偏好 prefs.json:以后用哪个浏览器打开向导(首次启动问一次,也可在向导页里改)
//   3) 后台静默检测 GitHub 最新版本(有更新 → 向导页横幅提示"是否下载";连不上 → 提示无法检测更新)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { createCore, APP_ID } from './core.mjs';
import { checkUpdate, downloadProgress, startDownload } from './update.mjs';
import { BROWSER_CHOICES, detectBrowsers, loadPrefs, openByPref, savePrefs } from './prefs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DEFAULT_PORT = 8790;

const ARGV = process.argv.slice(2);
const PORT = Number((ARGV.find((a) => /^--port=/.test(a)) || '').split('=')[1]) || DEFAULT_PORT;
const NO_OPEN = ARGV.includes('--no-open');

// 采集到的页面结构落在用户数据目录:exe 可能被放在只读目录,不能写在自己旁边
const DATA_DIR = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.xuexitong-assistant'), 'XueXiTongAssistant');
const PROBE_DIR = path.join(DATA_DIR, 'probe');
const UPDATE_DIR = path.join(DATA_DIR, 'updates');

const TITLE = '刷课助手';
let VERSION = '';

// 打包版:资源在编译期已内联;开发版:从仓库读文件
let EMBEDDED = null;
try { EMBEDDED = (await import('../build/assets.gen.mjs')).ASSETS; } catch { EMBEDDED = null; }

const DISK_FILES = {
  script: path.join(ROOT, 'userscripts', 'courseauto.user.js'),
  bridge: path.join(ROOT, 'userscripts', 'courseauto-webai-bridge.user.js'),
  setup: path.join(__dirname, 'pages', 'setup.html')
};

async function getAsset(key) {
  if (EMBEDDED && EMBEDDED[key]) return EMBEDDED[key];
  return readFile(DISK_FILES[key], 'utf8');
}

function line(ch = '─', n = 56) { return ch.repeat(n); }

/* ==================== 更新状态(启动即检测) ==================== */
let UPDATE = { state: 'checking', current: '', message: '正在检测更新…' };
let updatePromise = null;

async function runUpdateCheck(force = false) {
  if (updatePromise && !force) return updatePromise;
  updatePromise = (async () => {
    const cur = VERSION || '0.0.0';
    const r = await checkUpdate(cur);
    UPDATE = r;
    if (r.state === 'has-update') {
      console.log(`  [更新] 发现新版本 v${r.latest}(当前 v${cur})—— 向导页里可下载`);
    } else if (r.state === 'up-to-date') {
      console.log(`  [更新] 已是最新版本 v${cur}`);
    } else {
      console.log('  [更新] 无法检测更新(连不上 GitHub,不影响使用)');
    }
    return r;
  })();
  return updatePromise;
}

/* ==================== 浏览器打开方式 ==================== */
let PREFS = loadPrefs(DATA_DIR);

function urlOf(port) { return `http://127.0.0.1:${port}/setup`; }

function labelOf(key) {
  const hit = BROWSER_CHOICES.find((c) => c.key === key);
  return hit ? hit.label : (key === 'custom' ? '自定义浏览器' : key || '系统默认浏览器');
}

function askFirstRun() {
  // 首次启动问一次:以后用哪个浏览器打开向导(不打开也行)。12s 没回应就按默认浏览器开
  if (!process.stdin.isTTY || process.stdin.destroyed) return Promise.resolve('auto');
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      try { rl.close(); } catch { /* ignore */ }
      resolve(v);
    };
    console.log('');
    console.log('  第一次使用:请选择「以后」用哪个浏览器打开安装向导(只需选一次)');
    BROWSER_CHOICES.forEach((c, i) => {
      const hit = c.key === 'auto' || c.key === 'none' ? null : detectBrowsers().find((b) => b.key === c.key);
      const mark = hit ? (hit.found ? '' : '(未安装)') : '';
      console.log(`    ${i + 1}) ${c.label}${mark}`);
    });
    console.log('    6) 自定义浏览器路径');
    rl.question('\n  输入序号后回车(12 秒不选 = 用系统默认浏览器): ', (ans) => {
      const n = parseInt(String(ans).trim(), 10);
      const hit = BROWSER_CHOICES[n - 1];
      if (hit) return finish(hit.key);
      if (n === 6) return finish('custom');
      finish('auto');
    });
    setTimeout(() => finish('auto'), 12000);
  });
}

async function launchWizard(port, { firstRun = false } = {}) {
  const url = urlOf(port);
  if (NO_OPEN) { console.log(`  (已用 --no-open 启动,请手动打开:${url})`); return; }
  if (!PREFS.firstRunDone && firstRun) {
    const key = await askFirstRun();
    if (key === 'custom') {
      const p = ARGV.find((a) => /^--browser=/.test(a));
      PREFS = savePrefs(DATA_DIR, { browser: 'custom', browserPath: p ? p.split('=')[1] : '', firstRunDone: true });
    } else {
      PREFS = savePrefs(DATA_DIR, { browser: key, firstRunDone: true });
    }
    console.log(`  已记住:以后用「${labelOf(PREFS.browser)}」打开向导(可在向导页里改)`);
  }
  if (PREFS.browser === 'none') {
    console.log(`  按你的设置不自动打开浏览器,请手动访问:${url}`);
    return;
  }
  const r = await openByPref(PREFS.browser, PREFS.browserPath, url);
  if (!r.opened) console.log(`  自动打开浏览器失败(${r.error || '未知原因'}),请手动访问:${url}`);
}

/* ==================== 本地附加接口(更新 / 偏好) ==================== */
const GH_HOSTS = new Set([
  'github.com', 'objects.githubusercontent.com', 'raw.githubusercontent.com',
  'codeload.github.com', 'release-assets.githubusercontent.com'
]);

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 8192) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > limit) { buf = buf.slice(0, limit); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(buf || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

async function localRoutes(req, res, url) {
  const p = url.pathname;

  if (p === '/api/prefs') {
    if (req.method === 'GET') {
      json(res, 200, {
        ok: true,
        version: VERSION,
        browser: PREFS.browser || '',
        browserPath: PREFS.browserPath || '',
        firstRunDone: !!PREFS.firstRunDone,
        skippedVersion: PREFS.skippedVersion || '',
        choices: BROWSER_CHOICES,
        detected: detectBrowsers()
      });
      return true;
    }
    if (req.method === 'POST') {
      const b = await readBody(req);
      const key = String(b.browser || '').trim();
      const valid = BROWSER_CHOICES.some((c) => c.key === key) || key === 'custom';
      if (!valid) { json(res, 400, { ok: false, error: '未知的浏览器选项' }); return true; }
      if (key === 'custom') {
        const bp = String(b.browserPath || '').trim();
        let ok = false;
        try { ok = !!bp && fs.existsSync(bp) && /\.(exe|app)$/i.test(bp); } catch { ok = false; }
        if (!ok) { json(res, 400, { ok: false, error: '自定义浏览器路径不存在或不是可执行文件' }); return true; }
        PREFS = savePrefs(DATA_DIR, { browser: key, browserPath: bp, firstRunDone: true });
      } else {
        PREFS = savePrefs(DATA_DIR, { browser: key, firstRunDone: true });
      }
      console.log(`  [设置] 打开方式已改为:${labelOf(PREFS.browser)}`);
      json(res, 200, { ok: true, browser: PREFS.browser, browserPath: PREFS.browserPath });
      return true;
    }
  }

  if (p === '/api/update/check') {
    const force = url.searchParams.get('refresh') === '1';
    let r = UPDATE;
    if (force || r.state === 'checking') r = await runUpdateCheck(force);
    // 用户选择"跳过这个版本"时,还是把版本号告诉前端,由前端决定是否提示
    json(res, 200, { ok: true, ...r, skippedVersion: PREFS.skippedVersion || '' });
    return true;
  }

  if (p === '/api/update/download' && req.method === 'POST') {
    const b = await readBody(req);
    const assetUrl = String(b.url || '');
    let host = '';
    try { host = new URL(assetUrl).host; } catch { host = ''; }
    if (!host || !GH_HOSTS.has(host)) { json(res, 400, { ok: false, error: '下载地址不在 GitHub 域名内' }); return true; }
    console.log(`  [更新] 开始下载新版本:${String(b.name || '').slice(0, 60)}`);
    const id = startDownload({ url: assetUrl, name: b.name, size: b.size }, UPDATE_DIR);
    json(res, 200, { ok: true, id });
    return true;
  }

  if (p === '/api/update/progress') {
    const id = url.searchParams.get('id') || '';
    const pr = downloadProgress(id);
    if (!pr) { json(res, 404, { ok: false, error: '没有这个下载任务(程序可能被重启过)' }); return true; }
    if (pr.state === 'done') console.log(`  [更新] 下载完成:${pr.file}`);
    json(res, 200, { ok: true, ...pr });
    return true;
  }

  if (p === '/api/update/reveal' && req.method === 'POST') {
    const b = await readBody(req);
    const target = path.resolve(String(b.file || ''));
    if (!target.startsWith(path.resolve(UPDATE_DIR))) { json(res, 400, { ok: false, error: '只能打开更新目录里的文件' }); return true; }
    if (!fs.existsSync(target)) { json(res, 404, { ok: false, error: '文件不在了,请重新下载' }); return true; }
    try {
      if (process.platform === 'win32') execFile('explorer', ['/select,' + target], { windowsHide: true }, () => {});
      else if (process.platform === 'darwin') execFile('open', ['-R', target], { windowsHide: true }, () => {});
      else execFile('xdg-open', [path.dirname(target)], { windowsHide: true }, () => {});
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 500, { ok: false, error: String(e && e.message) });
    }
    return true;
  }

  if (p === '/api/update/skip' && req.method === 'POST') {
    const b = await readBody(req);
    const v = String(b.version || '').trim().slice(0, 32);
    PREFS = savePrefs(DATA_DIR, { skippedVersion: v });
    json(res, 200, { ok: true, skippedVersion: v });
    return true;
  }

  return false;
}

/* ==================== 启动 ==================== */
function banner(port, reuse) {
  const url = urlOf(port);
  const upTxt = UPDATE.state === 'has-update' ? `发现新版本 v${UPDATE.latest}`
    : UPDATE.state === 'up-to-date' ? '已是最新'
    : UPDATE.state === 'unreachable' ? '无法检测更新(连不上 GitHub)' : '检测中…';
  console.log('');
  console.log(`  ${TITLE} v${VERSION}  本地服务已启动`);
  console.log(`  ${line()}`);
  console.log(`  安装向导:  ${url}`);
  console.log(`  版本更新:  ${upTxt}`);
  console.log(`  打开方式:  ${labelOf(PREFS.browser || 'auto')}${PREFS.browser === 'none' ? '(按设置不自动开)' : ''}`);
  if (reuse) console.log('  提示:     已有一个本程序在运行,直接用上面的地址(无需重复启动)');
  else if (PREFS.browser === 'none') console.log('  提示:     把上面的地址复制到浏览器打开即可');
  else console.log('  提示:     浏览器会自动打开;没弹出就手动复制上面的地址');
  console.log(`  ${line()}`);
  console.log('  这个窗口要一直开着:脚本答题时靠它转发 AI 请求。');
  console.log('  关闭本窗口 = 退出(不影响已装好的脚本,只是 AI 网页模式会连不上)。');
  console.log('');
}

function ping(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/ping', timeout: 1200 }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(buf).app === APP_ID); } catch { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function listen(handler, port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

const server = await (async () => {
  const core = createCore({ getAsset, probeDir: PROBE_DIR });
  let asked = 0;
  let answered = 0;
  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;
    let handled = false;
    try {
      // 更新/偏好这类接口属于客户版外壳,先于内核脚本路由处理
      if (p.startsWith('/api/update') || p === '/api/prefs') {
        handled = await localRoutes(req, res, url);
      }
      if (!handled) handled = await core(req, res, url);
    } catch (e) {
      if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"ok":false}'); }
      console.log(`  [错误] ${p} ${e && e.message}`);
      return;
    }
    // 客户版没有模拟页面:未命中的路径直接 404,别把请求挂着
    if (!handled && !res.headersSent) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'not found', path: p }));
      return;
    }
    // 把中转流量显式打出来:客户一眼能看出"脚本 ↔ 本程序 ↔ AI 页"是否在通
    if (handled && p === '/api/webai/ask') {
      asked++;
      console.log(`  [中转] 收到题目 #${asked}${asked === 1 ? '(AI 网页里要开着对话页)' : ''}`);
    } else if (handled && p === '/api/webai/answer') {
      answered++;
      console.log(`  [中转] 已回传答案 #${answered}`);
    } else if (handled && p === '/api/webai/status' && url.searchParams.get('verbose') === '1') {
      console.log(`  [中转] 题目 ${asked} 条, 回传 ${answered} 条`);
    }
  };

  VERSION = (await getAsset('script')).match(/@version\s+(\S+)/)?.[1] || '';

  try {
    return await listen(handler, PORT);
  } catch (e) {
    if (String(e.code) === 'EADDRINUSE') {
      if (await ping(PORT)) {
        banner(PORT, true);
        if (!NO_OPEN && PREFS.browser !== 'none') await openByPref(PREFS.browser || 'auto', PREFS.browserPath, urlOf(PORT));
        else console.log(`  请手动访问:${urlOf(PORT)}`);
        setTimeout(() => process.exit(0), 800);
        return null;
      }
      // 端口被别的程序占了:换一个端口继续,别让客户卡住
      const alt = PORT + 1;
      console.log(`\n  端口 ${PORT} 被其他程序占用,改用 ${alt}。`);
      console.log('  (若脚本里配置的中转地址是 8790,请在面板 ⚙ 改成新地址)');
      return await listen(handler, alt);
    }
    throw e;
  }
})();

if (server) {
  const port = server.address().port;
  banner(port, false);
  // 先把向导打开(用户不用等网络),更新检测在后台跑,结果由向导页轮询拿走
  runUpdateCheck(true).then(() => banner(port, false)).catch(() => { /* 检测失败不影响启动 */ });
  await launchWizard(port, { firstRun: true });
  const bye = () => {
    console.log('\n  已退出。\n');
    try { server.close(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}
