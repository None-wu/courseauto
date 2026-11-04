// 打包客户版:一个 exe,双击即用(内置安装向导 + 两个脚本 + 网页 AI 中转)
// 用法:node tools/pack.mjs [--no-zip] [--keep]
//   产物:dist/刷课助手-vX.Y.Z.exe + dist/使用说明.txt (+ dist/刷课助手-vX.Y.Z-win64.zip)
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const DIST = path.join(ROOT, 'dist');

const argv = process.argv.slice(2);
const NO_ZIP = argv.includes('--no-zip');
const KEEP = argv.includes('--keep');

const meta = readFileSync(path.join(ROOT, 'src', '00-meta.txt'), 'utf8');
const VERSION = (meta.match(/@version\s+(\S+)/) || [, '0.0.0'])[1];
const SCRIPT = path.join(ROOT, 'userscripts', 'courseauto.user.js');
const BRIDGE = path.join(ROOT, 'userscripts', 'courseauto-webai-bridge.user.js');
const SETUP = path.join(ROOT, 'local', 'pages', 'setup.html');

function step(n, msg) { console.log(`\n[${n}/4] ${msg}`); }

// ---- 1. 先构建最新脚本,保证 exe 里带的是当前版本 ----
step(1, '构建油猴脚本(内核 + 适配器)');
execSync(`node "${path.join(ROOT, 'tools', 'build.mjs')}"`, { stdio: 'inherit' });

const scriptCode = readFileSync(SCRIPT, 'utf8');
const bridgeCode = readFileSync(BRIDGE, 'utf8');
const setupHtml = readFileSync(SETUP, 'utf8');
const sv = (scriptCode.match(/@version\s+(\S+)/) || [, VERSION])[1];
const bv = (bridgeCode.match(/@version\s+(\S+)/) || [, '?'])[1];
console.log(`   脚本 ${sv} / 桥 ${bv} / 安装页 ${(setupHtml.length / 1024).toFixed(1)} KB`);

// ---- 2. 把三个资源内联成 JS 模块(bun 编译时一起打进 exe,运行时不再依赖磁盘) ----
step(2, '内联资源 → build/assets.gen.mjs');
mkdirSync(BUILD, { recursive: true });
const assetsModule =
  '// 自动生成,勿手改:tools/pack.mjs\n' +
  'export const ASSETS = {\n' +
  `  script: ${JSON.stringify(scriptCode)},\n` +
  `  bridge: ${JSON.stringify(bridgeCode)},\n` +
  `  setup: ${JSON.stringify(setupHtml)}\n` +
  '};\n';
writeFileSync(path.join(BUILD, 'assets.gen.mjs'), assetsModule, 'utf8');
console.log(`   ${(assetsModule.length / 1024).toFixed(0)} KB`);

// 打包前先做一次语法/导入自检(用 node 跑内核,避免 exe 编出来才发现错)
execSync(`node --check "${path.join(ROOT, 'local', 'core.mjs')}"`, { stdio: 'inherit' });

// ---- 3. 编译单文件 exe ----
step(3, 'bun 编译单文件 exe');
let bun = null;
const bunCandidates = [
  process.env.BUN,
  path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'bun', 'bin', 'bun.exe'),
  path.join(process.env.USERPROFILE || '', '.bun', 'bin', 'bun.exe'),
  'bun'
].filter(Boolean);
for (const cmd of bunCandidates) {
  try { execFileSync(cmd, ['--version'], { stdio: 'ignore' }); bun = cmd; break; } catch { /* 试下一个 */ }
}
if (!bun) {
  // npm 装的 bun 只有 sh 包装脚本时,退回 shell 调用
  try { execSync('bun --version', { stdio: 'ignore' }); bun = 'bun'; } catch { /* ignore */ }
}
if (!bun) {
  console.error('   ✗ 没找到 bun。安装:https://bun.sh   (或 npm i -g bun)');
  process.exit(1);
}
mkdirSync(DIST, { recursive: true });
const exeName = `刷课助手-v${sv}.exe`;
const exePath = path.join(DIST, exeName);
if (existsSync(exePath)) rmSync(exePath);

execFileSync(bun, [
  'build', '--compile',
  path.join(ROOT, 'local', 'app.mjs'),
  '--outfile', exePath
], { stdio: 'inherit', cwd: ROOT });

const mb = (statSync(exePath).size / 1024 / 1024).toFixed(0);
console.log(`   ✓ ${exeName}  (${mb} MB)`);

// ---- 4. 使用说明 + 压缩包(微信/邮件发大文件时用) ----
step(4, '生成使用说明');
const guide = `刷课助手 v${sv}  使用说明
================================================

【这是什么】
一个自动刷课 / 自动答题的浏览器脚本(学习通、智慧树、雨课堂)。
本程序是它的"安装向导 + 本地小服务":负责把脚本装进你的浏览器,
并在脚本调用 AI 答题时代为转发请求。不需要安装 Node/Python,双击本文件即可。

【三步上手】
1) 双击 ${exeName}
   会弹出这个黑色窗口,同时浏览器自动打开安装向导。
   ⚠ 这个窗口要一直开着;关掉它 = 退出程序(已装好的脚本不受影响)。

2) 按向导装油猴(Tampermonkey)扩展
   - Chrome / Edge 用户:点向导第 1 步的商店链接安装扩展
   - 已经装过 Tampermonkey / 脚本猫 / Violentmonkey 的话,这步会显示"已检测到",直接下一步

3) 回向导点"安装「刷课助手」",在油猴弹出的页面里点"安装"
   可选:再点"安装「网页 AI 桥」"(用网页版 AI 答网页题时才需要)

4) 点向导第 4 步的网站入口,直接进课程页
   学习通 / 智慧树 / 雨课堂 三个按钮,点哪个进哪个。
   进课程页后右下角会出现"刷课助手"面板:
   - 首次使用:面板 ⚙ → 填 AI Key(DeepSeek 等),或选"网页 AI"模式
   - 然后点"开始"

【用网页版 AI 答题(可选,不用 API Key)】
- 面板 ⚙ 里 AI 通道选"网页 AI",中转地址保持 http://127.0.0.1:8790
- 另开一个标签页登录 DeepSeek / 豆包 / Kimi 等,并打开一个新对话
- 保持本程序窗口和那个 AI 标签页都开着,脚本会自动把题目送过去、把答案取回来

【常见问题】
Q: 双击后提示"端口被占用"?
A: 说明已经有一个本程序在跑,直接用浏览器里打开的向导页即可;不是问题。

Q: Windows 提示"已保护你的电脑"(蓝色窗口)?
A: 点"更多信息 → 仍要运行"。这是个人打包程序的常规提示,不是病毒。

Q: 向导里没检测到我装的油猴?
A: 检测靠读扩展目录,个别浏览器(改过安装路径/绿色版)读不到属正常。
   只要扩展确实装了,直接点"安装「刷课助手」"也能装。

Q: 脚本装好了但不答题?
A: 学习通改版会导致选择器失配。面板会提示"自检失败"并把页面结构自动采集到
   本机("数据"目录),把这个文件发回给作者即可快速适配。

【风险提示】
学习通平台声明会用 AI 监控"刷课"行为,并可能通报所在高校。
请自行评估风险,保持默认的拟人化设置(原速、随机延迟、每日上限),不要为了快而关闭。
本程序仅供个人学习辅助与技术研究,使用产生的一切后果由使用者自负。

版本:v${sv}    脚本:v${sv}    网页 AI 桥:v${bv}
`;
const guidePath = path.join(DIST, '使用说明.txt');
writeFileSync(guidePath, utf8Bom(guide), 'utf8');

if (!NO_ZIP) {
  const zipName = `刷课助手-v${sv}-win64.zip`;
  const zipPath = path.join(DIST, zipName);
  if (existsSync(zipPath)) rmSync(zipPath);
  try {
    // 用系统自带的 Compress-Archive(Windows)/ zip(其他平台),避免引入依赖
    if (process.platform === 'win32') {
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Compress-Archive -LiteralPath '${exePath}','${guidePath}' -DestinationPath '${zipPath}' -Force`],
        { stdio: 'inherit' });
    } else {
      execFileSync('zip', ['-j', zipPath, exePath, guidePath], { stdio: 'inherit' });
    }
    const zmb = (statSync(zipPath).size / 1024 / 1024).toFixed(0);
    console.log(`   ✓ ${zipName}  (${zmb} MB)`);
  } catch (e) {
    console.log(`   ! 压缩失败(不影响 exe):${e.message}`);
  }
}

if (!KEEP) {
  // 中间产物(内联资源)不必留:下次打包会重新生成
  rmSync(path.join(BUILD, 'assets.gen.mjs'), { force: true });
}

console.log(`\n完成 → ${DIST}`);
console.log(`   ${exeName}${existsSync(path.join(DIST, `刷课助手-v${sv}-win64.zip`)) ? ` + 刷课助手-v${sv}-win64.zip` : ''} + 使用说明.txt`);
console.log('   直接把这个 exe(或压缩包)发给客户,双击即可运行。\n');

function utf8Bom(s) { return '\ufeff' + s; }   // 记事本打开中文不乱码
