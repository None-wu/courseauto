// 本机浏览器 / 油猴扩展 自动检测
// 原理:读取各浏览器用户数据目录下每个扩展的 manifest.json,按名称识别脚本管理器
//      (比硬编码扩展 ID 更可靠,换壳版本/其他管理器也能认出来)
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const LOCAL = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const ROAM = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');

const CHROME_STORE = 'https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo';
const EDGE_STORE = 'https://microsoftedge.microsoft.com/addons/search/tampermonkey';

// 已知扩展 ID(名称读取失败时兜底)
const KNOWN_IDS = {
  dhdgffkkebhmkfjojejmpbldmpobfkfo: 'Tampermonkey',        // Chrome 商店版
  iikmkjmpaadaobahmlepeloendndfphd: 'Tampermonkey',        // Edge 加载项版
  gcalenpjmijncebpfijmoaglllgpjagf: 'Tampermonkey Beta',
  jffddkbflmbbnaammlfbpfgcnnocedo: 'Violentmonkey'
};

const MANAGER_KEYWORDS = [/tampermonkey/i, /violentmonkey/i, /greasemonkey/i, /scriptcat/i, /篡改猴/i, /油猴/i, /脚本猫/i];

function browserList() {
  const list = [
    { key: 'chrome', name: 'Google Chrome', userData: path.join(LOCAL, 'Google', 'Chrome', 'User Data'), store: CHROME_STORE },
    { key: 'edge', name: 'Microsoft Edge', userData: path.join(LOCAL, 'Microsoft', 'Edge', 'User Data'), store: EDGE_STORE },
    { key: 'brave', name: 'Brave', userData: path.join(LOCAL, 'BraveSoftware', 'Brave-Browser', 'User Data'), store: CHROME_STORE },
    { key: 'chrome-beta', name: 'Chrome Beta', userData: path.join(LOCAL, 'Google', 'Chrome Beta', 'User Data'), store: CHROME_STORE },
    { key: 'vivaldi', name: 'Vivaldi', userData: path.join(LOCAL, 'Vivaldi', 'User Data'), store: CHROME_STORE }
  ];
  // 部分环境把配置放在 Roaming 下
  if (ROAM !== LOCAL) {
    list.push({ key: 'chrome-roaming', name: 'Google Chrome', userData: path.join(ROAM, 'Google', 'Chrome', 'User Data'), store: CHROME_STORE });
  }
  return list;
}

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function readJson(p) {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; }
}

// manifest 里的 name 可能是 __MSG_xxx__,去 _locales 里取真名
async function resolveName(dir, manifest) {
  const raw = manifest && typeof manifest.name === 'string' ? manifest.name : '';
  const m = /^__MSG_(.+)__$/.exec(raw);
  if (!m) return raw;
  const key = m[1].toLowerCase();
  for (const loc of ['zh_CN', 'en', 'en_US']) {
    const msg = await readJson(path.join(dir, '_locales', loc, 'messages.json'));
    if (msg) {
      const hit = Object.keys(msg).find((k) => k.toLowerCase() === key);
      if (hit && msg[hit] && msg[hit].message) return msg[hit].message;
    }
  }
  return raw;
}

// 读取扩展的运行时设置:
//   user_scripts_enabled —— 新版 Chrome/Edge 的「允许用户脚本」总开关(默认关闭,关着时油猴脚本一条都不执行)
//   存在 Secure Preferences 里;部分版本/系统下可能读不到,此时返回 null 表示"未知",不要误判成未开启
async function readExtensionPrefs(profileDir) {
  const map = {};
  for (const file of ['Secure Preferences', 'Preferences']) {
    const j = await readJson(path.join(profileDir, file));
    const settings = j && j.extensions && j.extensions.settings;
    if (!settings) continue;
    for (const [id, e] of Object.entries(settings)) {
      if (!e || typeof e !== 'object') continue;
      const prev = map[id] || {};
      map[id] = {
        enabled: prev.enabled !== undefined ? prev.enabled : (e.state === undefined ? undefined : e.state === 1),
        userScriptsEnabled: prev.userScriptsEnabled !== undefined
          ? prev.userScriptsEnabled
          : (typeof e.user_scripts_enabled === 'boolean' ? e.user_scripts_enabled : undefined)
      };
    }
  }
  return map;
}

async function scanProfile(profileDir) {
  const extRoot = path.join(profileDir, 'Extensions');
  if (!(await exists(extRoot))) return { name: path.basename(profileDir), managers: [] };
  let ids = [];
  try { ids = await readdir(extRoot); } catch { return { name: path.basename(profileDir), managers: [] }; }

  const prefs = await readExtensionPrefs(profileDir);
  const managers = [];
  for (const id of ids) {
    let versions = [];
    try { versions = await readdir(path.join(extRoot, id)); } catch { continue; }
    // 取最高版本目录(排序不严格也无所谓,manifest 只是用来读名字)
    for (const ver of versions.slice(-1)) {
      const dir = path.join(extRoot, id, ver);
      const manifest = await readJson(path.join(dir, 'manifest.json'));
      if (!manifest) continue;
      const name = await resolveName(dir, manifest);
      const label = String(name || KNOWN_IDS[id] || '');
      if (MANAGER_KEYWORDS.some((re) => re.test(label)) || KNOWN_IDS[id]) {
        const p = prefs[id] || {};
        managers.push({
          id,
          name: KNOWN_IDS[id] || label,
          version: manifest.version || ver,
          enabled: p.enabled !== undefined ? p.enabled : null,
          // true = 已开启; false = 明确关闭; null = 无法读取(旧版本浏览器没有该开关)
          userScriptsEnabled: p.userScriptsEnabled !== undefined ? p.userScriptsEnabled : null
        });
        break;
      }
    }
  }
  return { name: path.basename(profileDir), managers };
}

export async function scanBrowsers() {
  const browsers = [];
  for (const b of browserList()) {
    const installed = await exists(b.userData);
    let profiles = [];
    if (installed) {
      let entries = [];
      try { entries = await readdir(b.userData, { withFileTypes: true }); } catch { /* ignore */ }
      const profDirs = entries
        .filter((e) => e.isDirectory() && /^(Default|Profile \d+|Guest Profile)$/i.test(e.name))
        .map((e) => path.join(b.userData, e.name));
      for (const pd of profDirs) profiles.push(await scanProfile(pd));
    }
    const managers = [];
    for (const p of profiles) {
      for (const mgr of p.managers) {
        const hit = managers.find((x) => x.id === mgr.id);
        if (!hit) managers.push({ ...mgr, profile: p.name });
        // 同 ID 出现在多个配置里:只要有一个配置开了「允许用户脚本」就算开了
        else if (hit.userScriptsEnabled !== true && mgr.userScriptsEnabled === true) hit.userScriptsEnabled = true;
      }
    }
    browsers.push({
      key: b.key,
      name: b.name,
      userData: b.userData,
      installed,
      store: b.store,
      profiles: profiles.map((p) => ({ name: p.name, managers: p.managers })),
      managers
    });
  }
  const found = browsers.filter((b) => b.installed);
  return {
    platform: process.platform,
    scannedAt: new Date().toISOString(),
    browsers: found,
    anyManager: found.some((b) => b.managers.length > 0),
    // 「允许用户脚本」是否已放行:三态,false 才是明确没开
    anyUserScriptsEnabled: found.some((b) => b.managers.some((m) => m.userScriptsEnabled === true)),
    userScriptsBlocked: found.some((b) => b.managers.length > 0) &&
      found.every((b) => b.managers.every((m) => m.userScriptsEnabled !== true)),
    // 只保留有扩展管理器的浏览器信息供页面顶部展示
    summary: found.map((b) => ({
      key: b.key,
      name: b.name,
      installed: b.installed,
      managers: b.managers.map((m) => ({
        name: m.name,
        version: m.version,
        profile: m.profile,
        enabled: m.enabled,
        userScriptsEnabled: m.userScriptsEnabled
      }))
    }))
  };
}

// 命令行直接运行时打印一张检测表
if (process.argv[1] && process.argv[1].endsWith('detect.mjs')) {
  const r = await scanBrowsers();
  const flag = (m) => (m.userScriptsEnabled === true ? '允许用户脚本:已开启'
    : m.userScriptsEnabled === false ? '允许用户脚本:未开启 ← 脚本不会执行'
    : '允许用户脚本:无法读取(旧版浏览器通常默认允许)');
  console.log('\n本机浏览器检测:');
  if (!r.browsers.length) console.log('  未发现 Chrome / Edge / Brave 等 Chromium 系浏览器配置目录');
  for (const b of r.browsers) {
    if (!b.managers.length) {
      console.log(`  ${b.name.padEnd(16)} ${b.profiles.length} 个配置  未安装脚本管理器`);
      continue;
    }
    console.log(`  ${b.name.padEnd(16)} ${b.profiles.length} 个配置`);
    for (const m of b.managers) {
      console.log(`    - ${m.name} v${m.version}(${m.profile})  ${flag(m)}`);
    }
  }
  console.log('');
  if (!r.anyManager) console.log('结论:未检测到油猴类扩展,需先安装 Tampermonkey。\n');
  else if (r.anyUserScriptsEnabled) console.log('结论:油猴已装好且「允许用户脚本」已开启,可直接安装脚本。\n');
  else if (r.userScriptsBlocked) console.log('结论:油猴已装好,但「允许用户脚本」未开启 —— 脚本会显示"已启用"却不执行。\n      去 扩展管理页 → 该扩展「详细信息」→ 打开「允许用户脚本」。\n');
  else console.log('结论:已检测到油猴类扩展,可直接安装脚本。\n');
}
