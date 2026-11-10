// 构建:把 src/ 下的内核与适配器内联成单个油猴脚本
// 用法:node tools/build.mjs [--check]
// 产物:userscripts/courseauto.user.js
import { readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'userscripts', 'courseauto.user.js');

// 顺序即拼接顺序:元数据 → 注册表 → 内核 → 适配器 → 启动 → 收尾
const PARTS = [
  'src/00-meta.txt',
  'src/core/05-registry.js',
  'src/core/10-config.js',
  'src/core/15-clock.js',
  'src/core/20-util.js',
  'src/core/30-panel.js',
  'src/core/40-answer.js',
  'src/core/50-font.js',
  'src/core/70-update.js',
  'src/adapters/chaoxing.js',
  'src/adapters/zhihuishu.js',
  'src/adapters/yuketang.js',
  'src/core/90-main.js',
  'src/99-close.txt'
];

const chunks = [];
const used = [];
const missing = [];
for (const rel of PARTS) {
  const p = path.join(ROOT, rel);
  if (!existsSync(p)) { missing.push(rel); continue; }
  const code = await readFile(p, 'utf8');
  chunks.push(code.replace(/\s*$/, '\n'));
  used.push(rel);
}

const banner =
  '// ⚙️ 本文件由 tools/build.mjs 从 src/ 自动生成,请勿直接编辑;改源码后执行 npm run build\n';

let out = chunks[0] + banner;   // 元数据块必须在文件最顶部
for (let i = 1; i < chunks.length; i++) out += chunks[i];

await writeFile(OUT, out, 'utf8');
const size = (await stat(OUT)).size;

// 版本号只有 src/00-meta.txt 一个源头:同步到 version.json(自动更新标记)与 package.json,
// 避免"脚本升了但 version.json 没升 → 老用户永远收不到更新"
const version = (chunks[0].match(/@version\s+([0-9][\w.\-]*)/) || [])[1] || '';
if (version) {
  await writeFile(path.join(ROOT, 'version.json'), JSON.stringify({ v: version }) + '\n', 'utf8');
  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  if (pkg.version !== version) {
    pkg.version = version;
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  }
}

console.log('构建完成');
console.log('  产物:', path.relative(ROOT, OUT));
console.log('  版本:', version || '(未识别)');
console.log('  大小:', (size / 1024).toFixed(1) + ' KB');
console.log('  片段:', used.length + ' 个');
if (missing.length) console.log('  跳过(尚未创建):', missing.join(', '));
if (size > 300 * 1024) console.warn('  ⚠ 体积超过 300 KB,考虑按平台按需加载');
