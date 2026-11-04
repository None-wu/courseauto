// 一键安装入口:检测本机浏览器/油猴 → 起本地安装站 → 打开安装向导
// 用法:node local/setup.mjs [port]      默认 8790
import { exec } from 'node:child_process';
import { scanBrowsers } from './detect.mjs';
import { startMock } from './server.mjs';

const PORT = Number(process.argv[2] || 8790);

const env = await scanBrowsers();

console.log('\n=== 本机环境检测 ===');
if (!env.browsers.length) {
  console.log('  未发现 Chromium 系浏览器配置目录(Chrome / Edge / Brave)');
} else {
  for (const b of env.browsers) {
    const mgr = b.managers.length
      ? b.managers.map((m) => `${m.name} v${m.version} (${m.profile})`).join('、')
      : '未安装脚本管理器';
    console.log(`  ${b.name.padEnd(14)} ${String(b.profiles.length).padStart(2)} 个配置  ${mgr}`);
  }
}

let server = null;
try {
  const r = await startMock(PORT);
  server = r.server;
  console.log(`\n安装向导已启动: http://127.0.0.1:${r.port}/setup`);
} catch (e) {
  if (String(e.code) === 'EADDRINUSE') {
    console.log(`\n端口 ${PORT} 已有服务在跑,直接复用: http://127.0.0.1:${PORT}/setup`);
  } else {
    throw e;
  }
}

const url = `http://127.0.0.1:${PORT}/setup`;
const cmd = process.platform === 'win32' ? `start "" "${url}"`
  : process.platform === 'darwin' ? `open "${url}"`
  : `xdg-open "${url}"`;

exec(cmd, { windowsHide: true }, (err) => {
  if (err) {
    console.log(`\n自动打开浏览器失败,请手动访问: ${url}`);
  }
});

if (!env.anyManager) {
  console.log('\n提示:当前未检测到油猴类扩展,向导第 1 步会给出对应浏览器的商店入口。');
} else {
  console.log('\n提示:已检测到脚本管理器,向导第 2 步可直接点「安装」把脚本装进油猴。');
}
console.log('按 Ctrl+C 结束本地安装服务。\n');

if (server) {
  process.on('SIGINT', () => { server.close(() => process.exit(0)); });
}
