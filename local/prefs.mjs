// 本机偏好:以后用哪个浏览器打开向导 / 跳过哪个版本更新
// 落盘在 %LOCALAPPDATA%\XueXiTongAssistant\prefs.json(exe 旁边可能只读,不能存那里)
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

export const BROWSER_CHOICES = [
  { key: 'auto', label: '系统默认浏览器' },
  { key: 'edge', label: 'Microsoft Edge' },
  { key: 'chrome', label: 'Google Chrome' },
  { key: 'firefox', label: 'Mozilla Firefox' },
  { key: 'brave', label: 'Brave' },
  { key: 'none', label: '不自动打开(只显示地址,自己复制)' }
];

const WIN_PATHS = {
  edge: [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ],
  chrome: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ],
  firefox: [
    'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
    'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe'
  ],
  brave: [
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
  ]
};
const MAC_PATHS = {
  edge: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  chrome: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  firefox: ['/Applications/Firefox.app/Contents/MacOS/firefox'],
  brave: ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser']
};
const LINUX_BIN = {
  edge: ['microsoft-edge', 'microsoft-edge-stable'],
  chrome: ['google-chrome', 'google-chrome-stable', 'chromium'],
  firefox: ['firefox'],
  brave: ['brave-browser', 'brave']
};

function prefsFile(dataDir) {
  return path.join(dataDir, 'prefs.json');
}

export function loadPrefs(dataDir) {
  const def = { browser: '', browserPath: '', firstRunDone: false, skippedVersion: '', updateCheckedAt: '' };
  try {
    const j = JSON.parse(fs.readFileSync(prefsFile(dataDir), 'utf8'));
    return { ...def, ...(j && typeof j === 'object' ? j : {}) };
  } catch {
    return def;
  }
}

export function savePrefs(dataDir, patch) {
  const next = { ...loadPrefs(dataDir), ...(patch || {}) };
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(prefsFile(dataDir), JSON.stringify(next, null, 2), 'utf8');
  } catch (e) {
    console.log('  [提示] 偏好没写成文件:' + (e && e.message));
  }
  return next;
}

/** 探测本机已安装的浏览器,给向导页做"以后用哪个打开"的下拉 */
export function detectBrowsers() {
  const out = [];
  for (const c of BROWSER_CHOICES) {
    if (c.key === 'auto' || c.key === 'none') { out.push({ key: c.key, label: c.label, found: true, path: '' }); continue; }
    let hit = '';
    if (process.platform === 'win32') {
      hit = (WIN_PATHS[c.key] || []).find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || '';
    } else if (process.platform === 'darwin') {
      hit = (MAC_PATHS[c.key] || []).find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || '';
    } else {
      hit = (LINUX_BIN[c.key] || [])[0] || '';
    }
    out.push({ key: c.key, label: c.label, found: !!hit, path: hit });
  }
  return out;
}

/**
 * 按偏好打开向导地址。
 * 返回 { opened, via, error }:opened=false 表示按用户设置"不自动打开"
 * 安全:不接受任意命令,只认白名单 key 或"磁盘上真实存在的 .exe/.app 路径"
 */
export async function openByPref(pref, prefPath, url) {
  const key = String(pref || 'auto').trim();
  if (key === 'none') return { opened: false, via: 'none' };

  const spawnDetached = (file, args) => new Promise((resolve) => {
    try {
      const p = execFile(file, args, { windowsHide: true, detached: true }, () => { /* 忽略退出码 */ });
      p.unref?.();
      resolve({ opened: true, via: file });
    } catch (e) {
      resolve({ opened: false, via: file, error: String(e && e.message) });
    }
  });

  // target 为空 = 系统默认浏览器;非空 = 具体程序名(msedge/firefox)或路径
  const viaShell = (target) => new Promise((resolve) => {
    if (process.platform === 'win32') {
      // start 是 cmd 内建命令:url 放最后,作为参数而不是命令
      const args = ['/c', 'start', ''].concat(target ? [target] : [], [url]);
      execFile('cmd', args, { windowsHide: true }, (err) => resolve(!err));
    } else if (process.platform === 'darwin') {
      const args = target ? ['-a', target, url] : [url];
      execFile('open', args, { windowsHide: true }, (err) => resolve(!err));
    } else {
      execFile(target || 'xdg-open', [url], { windowsHide: true, detached: true }, (err) => resolve(!err));
    }
  });

  if (key === 'auto') {
    const ok = await viaShell('');
    return ok ? { opened: true, via: 'default' } : { opened: false, via: 'default', error: '系统默认浏览器启动失败' };
  }

  // 自定义路径:必须是磁盘上真实存在的可执行文件,避免把偏好当成命令执行
  if (key === 'custom') {
    const p = String(prefPath || '').trim();
    let ok = false;
    try { ok = !!p && fs.existsSync(p) && /\.(exe|app)$/i.test(p); } catch { ok = false; }
    if (!ok) return { opened: false, via: 'custom', error: '自定义浏览器路径不存在或不是可执行文件' };
    const r = await spawnDetached(p, [url]);
    return r.opened ? r : { opened: false, via: 'custom', error: '自定义浏览器启动失败' };
  }

  const exePath = (WIN_PATHS[key] || MAC_PATHS[key] || []).find((p) => { try { return fs.existsSync(p); } catch { return false; } });
  if (exePath) {
    const r = await spawnDetached(exePath, [url]);
    if (r.opened) return r;
  }
  // 没找到安装路径:交给系统按程序别名启动(如 start msedge)
  const alias = process.platform === 'win32' ? (key === 'edge' ? 'msedge' : key === 'chrome' ? 'chrome' : key) : key;
  const ok = await viaShell(alias);
  return ok ? { opened: true, via: key } : { opened: false, via: key, error: '未找到 ' + key + ' 的安装路径' };
}
