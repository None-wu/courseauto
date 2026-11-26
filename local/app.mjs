// 客户版入口:打包成单个 exe,双击即起本地服务并打开安装向导
// 打包:node tools/pack.mjs  →  dist/courseauto-vX.exe
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
const FORCE_SETUP = ARGV.includes('--setup');        // 本次强制打开安装向导(即使已经装过)
const RESET_SETUP = ARGV.includes('--reset-setup');  // 清掉"向导已完成"标记,下次启动重新进向导

// 采集到的页面结构落在用户数据目录:exe 可能被放在只读目录,不能写在自己旁边
const DATA_DIR = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.xuexitong-assistant'), 'XueXiTongAssistant');
const PROBE_DIR = path.join(DATA_DIR, 'probe');
const UPDATE_DIR = path.join(DATA_DIR, 'updates');

/* ---------- 运行日志:内存环形缓冲 + 磁盘留档 + 控制台着色 ----------
   客户版 exe 以无控制台方式启动(双击不出黑窗), 启动信息/运行日志统一由
   前端「运行状态」页 /console 承载; 有控制台时(开发版、--console 打包)仍并排打印。 */
const TTY = !!process.stdout.isTTY;
const LOG_MAX = 400;
const LOGS = [];
let LOG_SEQ = 0;
const START_AT = Date.now();
const LIFE = { port: 0 };
let SERVER = null;
const RELAY = { asked: 0, answered: 0 };

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m', gray: '\x1b[90m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', blue: '\x1b[34m', white: '\x1b[97m'
};
const LV_COLOR = { info: C.white, ok: C.green, warn: C.yellow, err: C.red, net: C.cyan, sys: C.blue };

function hhmmss() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

function logLine(lv, msg, opts) {
  const tx = String(msg == null ? '' : msg).replace(/\x1b\[[0-9;]*m/g, '');
  LOG_SEQ += 1;
  LOGS.push({ seq: LOG_SEQ, t: Date.now(), lv, tx });
  if (LOGS.length > LOG_MAX) LOGS.splice(0, LOGS.length - LOG_MAX);
  if (!TTY || (opts && opts.quiet)) return;
  const c = LV_COLOR[lv] || C.white;
  for (const one of tx.split('\n')) {
    process.stdout.write(`  ${C.gray}${hhmmss()}${C.reset} ${c}${one}${C.reset}\n`);
  }
}

// 原有 console.* 一律并入缓冲:无控制台版本也能在状态页里看到全部输出
const sink = (lv) => (...args) => logLine(lv, args.map((a) => (typeof a === 'string' ? a : (a && a.message) || String(a))).join(' '));
console.log = sink('info');
console.info = sink('info');
console.warn = sink('warn');
console.error = sink('err');

const TITLE = '刷课助手';
let VERSION = '';

// 打包版:资源在编译期已内联;开发版:从仓库读文件
let EMBEDDED = null;
try { EMBEDDED = (await import('../build/assets.gen.mjs')).ASSETS; } catch { EMBEDDED = null; }

const DISK_FILES = {
  script: path.join(ROOT, 'userscripts', 'courseauto.user.js'),
  bridge: path.join(ROOT, 'userscripts', 'courseauto-webai-bridge.user.js'),
  setup: path.join(__dirname, 'pages', 'setup.html'),
  console: path.join(__dirname, 'pages', 'console.html')
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
if (RESET_SETUP) {
  PREFS = savePrefs(DATA_DIR, { firstRunDone: false, setupDone: false });
  console.log('  [设置] 已清除"向导已完成"标记,本次启动重新打开安装向导');
}

// 首启进安装向导,之后每次启动直接进运行状态页
function setupDone() { return !!(PREFS.firstRunDone || PREFS.setupDone); }
function entryPath() { return (FORCE_SETUP || !setupDone()) ? '/setup' : '/console'; }
function urlOf(port) { return `http://127.0.0.1:${port}${entryPath()}`; }
function wizardUrl(port) { return `http://127.0.0.1:${port}/setup`; }
function statusUrl(port) { return `http://127.0.0.1:${port}/console`; }

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
      PREFS = savePrefs(DATA_DIR, { browser: key, firstRunDone: true, setupDone: true });
    }
    console.log(`  已记住:以后用「${labelOf(PREFS.browser)}」打开(可在运行状态页改)`);
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
        setupDone: setupDone(),
        skippedVersion: PREFS.skippedVersion || '',
        choices: BROWSER_CHOICES,
        detected: detectBrowsers()
      });
      return true;
    }
    if (req.method === 'POST') {
      const b = await readBody(req);
      // 只标记「向导已完成」(不动浏览器设置):之后启动直接进运行状态页
      if (b.setupDone && !String(b.browser || '').trim()) {
        PREFS = savePrefs(DATA_DIR, { setupDone: true });
        console.log('  [设置] 安装向导已标记完成,以后启动直接进运行状态页');
        json(res, 200, { ok: true, setupDone: true, browser: PREFS.browser || '' });
        return true;
      }
      const key = String(b.browser || '').trim();
      const valid = BROWSER_CHOICES.some((c) => c.key === key) || key === 'custom';
      if (!valid) { json(res, 400, { ok: false, error: '未知的浏览器选项' }); return true; }
      if (key === 'custom') {
        const bp = String(b.browserPath || '').trim();
        let ok = false;
        try { ok = !!bp && fs.existsSync(bp) && /\.(exe|app)$/i.test(bp); } catch { ok = false; }
        if (!ok) { json(res, 400, { ok: false, error: '自定义浏览器路径不存在或不是可执行文件' }); return true; }
        PREFS = savePrefs(DATA_DIR, { browser: key, browserPath: bp, firstRunDone: true, setupDone: true });
      } else {
        PREFS = savePrefs(DATA_DIR, { browser: key, firstRunDone: true, setupDone: true });
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
function updateText() {
  return UPDATE.state === 'has-update' ? `发现新版本 v${UPDATE.latest}`
    : UPDATE.state === 'up-to-date' ? '已是最新'
    : UPDATE.state === 'unreachable' ? '无法检测更新(连不上 GitHub)' : '检测中…';
}

function banner(port, reuse, opts = {}) {
  LIFE.port = Number(port) || LIFE.port;
  const base = `http://127.0.0.1:${LIFE.port}`;
  const upTxt = updateText();
  const openTxt = `${labelOf(PREFS.browser || 'auto')}${PREFS.browser === 'none' ? '(按设置不自动开)' : ''}`;
  const firstRun = !setupDone();
  const plain = [
    `${TITLE} v${VERSION} 已启动 · 端口 ${LIFE.port}${reuse ? ' · 复用已在运行的实例' : ''}`,
    firstRun ? `首次使用 ${base}/setup  (装好后自动进运行状态页)` : `运行状态 ${base}/console  (安装向导 ${base}/setup)`,
    `本次打开 ${base}${entryPath()}`,
    `版本更新 ${upTxt}`,
    `打开方式 ${openTxt}`,
    reuse ? '已有实例在运行,无需重复启动' : '本进程需保持运行(答题中转靠它);关闭网页不影响,退出请到状态页点「退出程序」'
  ];

  if (opts.quiet) {   // 更新检测回来只补一条,不重画整块
    logLine('sys', `版本更新 ${upTxt}`);
    return;
  }
  if (TTY) {
    const out = [''];
    out.push(`  ${C.bold}${C.white}${TITLE} v${VERSION}${C.reset}    ${C.green}● 运行中${C.reset}`);
    out.push(`  ${C.gray}${line('─', 54)}${C.reset}`);
    out.push(`  ${C.gray}本次打开${C.reset}  ${C.cyan}${base}${entryPath()}${C.reset}  ${C.dim}${firstRun ? '(首次使用,先装脚本)' : '(直接进运行状态)'}${C.reset}`);
    out.push(`  ${C.gray}安装向导${C.reset}  ${C.cyan}${base}/setup${C.reset}`);
    out.push(`  ${C.gray}运行状态${C.reset}  ${C.cyan}${base}/console${C.reset}`);
    out.push(`  ${C.gray}版本更新${C.reset}  ${upTxt.startsWith('发现') ? C.yellow : C.white}${upTxt}${C.reset}`);
    out.push(`  ${C.gray}打开方式${C.reset}  ${C.white}${openTxt}${C.reset}`);
    out.push(`  ${C.gray}${line('─', 54)}${C.reset}`);
    out.push(`  ${C.dim}状态、日志、中转计数都在「运行状态」页,窗口可最小化。${C.reset}`);
    out.push(`  ${C.dim}关闭网页不影响服务;要退出请到状态页点「退出程序」。${C.reset}`);
    out.push('');
    process.stdout.write(out.join('\n') + '\n');
  }
  for (const one of plain) logLine('sys', one, { quiet: true });
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

/* ---------- 客户版外壳:运行状态页 + 状态/日志/退出接口 ---------- */
async function appRoutes(req, res, url) {
  const p = url.pathname;
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };

  // 运行状态页(前端版"命令窗口")
  if (p === '/console' || p === '/console.html' || p === '/status') {
    try {
      const html = await getAsset('console');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
    } catch (e) {
      send(500, { ok: false, error: String(e.message) });
    }
    return true;
  }

  if (p === '/api/app/status') {
    send(200, {
      ok: true,
      app: APP_ID,
      title: TITLE,
      version: VERSION,
      port: LIFE.port,
      url: `http://127.0.0.1:${LIFE.port}`,
      entry: entryPath(),
      setupDone: setupDone(),
      setupUrl: wizardUrl(LIFE.port),
      consoleUrl: statusUrl(LIFE.port),
      pid: process.pid,
      startedAt: START_AT,
      uptime: Date.now() - START_AT,
      headless: !TTY,
      node: process.version,
      platform: process.platform,
      dataDir: DATA_DIR,
      logFile: '',   // 日志不再落盘(只保留内存环形缓冲,避免占用系统盘)
      update: { state: UPDATE.state || 'checking', latest: UPDATE.latest || '', text: updateText() },
      browser: { key: PREFS.browser || 'auto', label: labelOf(PREFS.browser || 'auto') },
      relay: { asked: RELAY.asked, answered: RELAY.answered },
      log: { seq: LOG_SEQ, keep: LOG_MAX }
    });
    return true;
  }

  if (p === '/api/app/log') {
    const since = Number(url.searchParams.get('since') || 0) || 0;
    const lines = LOGS.filter((x) => x.seq > since);
    send(200, { ok: true, seq: LOG_SEQ, lines });
    return true;
  }

  if (p === '/api/app/open' && req.method === 'POST') {
    const to = url.searchParams.get('to') === 'console' ? '/console' : '/setup';
    try {
      await openByPref(PREFS.browser || 'auto', PREFS.browserPath, `http://127.0.0.1:${LIFE.port}${to}`);
      send(200, { ok: true });
    } catch (e) {
      send(500, { ok: false, error: String(e.message) });
    }
    return true;
  }

  if (p === '/api/app/recheck' && req.method === 'POST') {
    runUpdateCheck(true).catch(() => { /* 失败由状态体现 */ });
    send(200, { ok: true });
    return true;
  }

  if (p === '/api/app/quit' && req.method === 'POST') {
    send(200, { ok: true });
    setTimeout(() => exitApp('在运行状态页点了退出'), 150);
    return true;
  }

  return false;
}

function exitApp(reason) {
  logLine('warn', `正在退出:${reason || '收到退出信号'}`);
  try { if (SERVER) SERVER.close(); } catch { /* ignore */ }
  setTimeout(() => process.exit(0), 140);
}

function notify(title, msg, icon) {
  const tx = String(msg == null ? '' : msg).replace(/["'`]/g, '').replace(/\r?\n/g, ' ').slice(0, 220);
  const ttl = String(title || TITLE).replace(/["'`]/g, '').slice(0, 60);
  const ps = `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show("${tx}","${ttl}","OK","${icon || 'Information'}") | Out-Null`;
  try { execFile('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], { windowsHide: true }, () => {}); } catch { /* ignore */ }
}

function notifyFatal(e) { notify(`${TITLE} 运行异常`, (e && e.message) || e || '未知错误', 'Warning'); }

function notifyInfo(tx) { notify(`${TITLE} 提示`, tx, 'Information'); }

const server = await (async () => {
  const core = createCore({ getAsset, probeDir: PROBE_DIR });
  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;
    let handled = false;
    try {
      // 更新/偏好这类接口属于客户版外壳,先于内核脚本路由处理
      if (p === '/console' || p === '/console.html' || p === '/status' || p.startsWith('/api/app/')) {
        handled = await appRoutes(req, res, url);
      } else if (p.startsWith('/api/update') || p === '/api/prefs') {
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
      RELAY.asked++;
      console.log(`  [中转] 收到题目 #${RELAY.asked}${RELAY.asked === 1 ? '(AI 网页里要开着对话页)' : ''}`);
    } else if (handled && p === '/api/webai/answer') {
      RELAY.answered++;
      console.log(`  [中转] 已回传答案 #${RELAY.answered}`);
    } else if (handled && p === '/api/webai/status' && url.searchParams.get('verbose') === '1') {
      console.log(`  [中转] 题目 ${RELAY.asked} 条, 回传 ${RELAY.answered} 条`);
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
        else {
          console.log(`  请手动访问:${urlOf(PORT)}`);
          if (!TTY) notifyInfo(`已有一个${TITLE}在运行,请直接在浏览器打开 ${urlOf(PORT)}`);
        }
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
  runUpdateCheck(true).then(() => banner(port, false, { quiet: true })).catch(() => { /* 检测失败不影响启动 */ });
  await launchWizard(port, { firstRun: true });
  // 无窗口版:浏览器没被自动拉起时必须有可见反馈,否则用户以为"双击没反应"
  if (!TTY && (NO_OPEN || PREFS.browser === 'none')) {
    notifyInfo(`${TITLE} 已在后台运行,请在浏览器打开 ${urlOf(port)}`);
  }
  SERVER = server;
  process.on('SIGINT', () => exitApp('收到 Ctrl+C'));
  process.on('SIGTERM', () => exitApp('系统请求终止'));
}

/* 无控制台打包时也能留下证据:异常写日志,必要时弹窗(不静默吞掉) */
process.on('uncaughtException', (e) => {
  logLine('err', '未捕获异常:' + ((e && (e.stack || e.message)) || e));
  if (!TTY) notifyFatal(e);
});
process.on('unhandledRejection', (e) => {
  logLine('err', '未处理的 Promise 拒绝:' + ((e && (e.stack || e.message)) || e));
});
