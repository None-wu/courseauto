// 客户版入口:打包成单个 exe,双击即起本地服务并打开安装向导
// 打包:node tools/pack.mjs  →  dist/刷课助手-vX.exe
// 开发:node local/app.mjs   (没打包时自动从磁盘读脚本,行为一致)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';
import { createCore, APP_ID } from './core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DEFAULT_PORT = 8790;

const ARGV = process.argv.slice(2);
const PORT = Number((ARGV.find((a) => /^--port=/.test(a)) || '').split('=')[1]) || DEFAULT_PORT;
const NO_OPEN = ARGV.includes('--no-open');

// 采集到的页面结构落在用户数据目录:exe 可能被放在只读目录,不能写在自己旁边
const DATA_DIR = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.xuexitong-assistant'), 'XueXiTongAssistant');
const PROBE_DIR = path.join(DATA_DIR, 'probe');

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

function openBrowser(url) {
  if (NO_OPEN) return;
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, { windowsHide: true }, () => { /* 打不开就让用户手动复制地址 */ });
}

function line(ch = '─', n = 56) { return ch.repeat(n); }

function banner(port, reuse) {
  const url = `http://127.0.0.1:${port}/setup`;
  console.log('');
  console.log(`  ${TITLE} v${VERSION}  本地服务已启动`);
  console.log(`  ${line()}`);
  console.log(`  安装向导:  ${url}`);
  if (reuse) console.log('  提示:     已有一个本程序在运行,直接用上面的地址(无需重复启动)');
  else console.log('  浏览器会自动打开;没弹出就手动复制上面的地址到浏览器');
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
      handled = await core(req, res, url);
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
        openBrowser(`http://127.0.0.1:${PORT}/setup`);
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
  openBrowser(`http://127.0.0.1:${port}/setup`);
  const bye = () => {
    console.log('\n  已退出。\n');
    try { server.close(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}
