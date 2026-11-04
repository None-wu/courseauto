#!/usr/bin/env node
/**
 * 把所有"仓库归属"引用统一改成指定账号,避免改名/换账号时漏改。
 *
 *   node tools/set-repo.mjs None-wu courseauto
 *
 * 覆盖:src/00-meta.txt(@homepageURL/@updateURL/@downloadURL)、README 徽章与一键安装链接、
 *       package.json(repository/homepage/bugs)、extras/docs 里的 jsDelivr 地址。
 * 不动:.git / node_modules / dist / extras/backup / extras/mock(模拟页面里的示例链接)
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const [owner, repo = 'courseauto'] = process.argv.slice(2);
if (!owner) {
  console.error('用法: node tools/set-repo.mjs <GitHub账号> [仓库名,默认 courseauto]');
  process.exit(1);
}

const ROOT = path.resolve(import.meta.dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'backup', 'mock', 'probe', 'out']);
const EXTS = /\.(js|mjs|json|md|html|txt|yml|yaml)$/;

// 旧归属(可能同时存在多个历史写法)
const OLD = [
  { o: 'DaRin1403', r: 'xuexitong-autostudy' },
  { o: 'DaRin1403', r: 'courseauto' },
  { o: 'None-wu', r: 'courseauto' },
  { o: 'None-wu', r: 'xuexitong-autostudy' },
];

const changed = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    if (!EXTS.test(name)) continue;
    let s = readFileSync(p, 'utf8');
    const before = s;
    for (const { o, r } of OLD) {
      if (o === owner && r === repo) continue;
      s = s.split(`github.com/${o}/${r}`).join(`github.com/${owner}/${repo}`);
      s = s.split(`gh/${o}/${r}`).join(`gh/${owner}/${repo}`);
      s = s.split(`git+https://github.com/${o}/${r}.git`).join(`git+https://github.com/${owner}/${repo}.git`);
    }
    if (s !== before) {
      writeFileSync(p, s);
      changed.push(path.relative(ROOT, p));
    }
  }
}
walk(ROOT);

// 脚本元信息里的仓库名也要跟着换(userscripts 由 build 重新生成,这里只提示)
console.log(`已指向 github.com/${owner}/${repo}`);
console.log(changed.length ? '修改文件:\n  ' + changed.join('\n  ') : '  (无变化)');
console.log('下一步:node tools/build.mjs 重新生成脚本(其中的 @updateURL 会同步)');
