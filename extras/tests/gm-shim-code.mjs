// 读取 gm-shim 并把 GM_info 的名称/版本替换为构建产物元数据的真实值
// 用途:demo 页与端到端测试里,面板显示的版本号必须与油猴里装的一致
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHIM = path.join(__dirname, '..', '..', 'local', 'lib', 'gm-shim.js');
const SCRIPT = path.join(__dirname, '..', '..', 'userscripts', 'courseauto.user.js');

export async function loadGmShimCode() {
  const [shim, main] = await Promise.all([readFile(SHIM, 'utf8'), readFile(SCRIPT, 'utf8')]);
  const name = (main.match(/^\s*\/\/\s*@name\s+(.+)$/m) || [, '刷课助手'])[1].trim();
  const version = (main.match(/^\s*\/\/\s*@version\s+(\S+)/m) || [, 'unknown'])[1];
  return shim.replace(/__SCRIPT_NAME__/g, name).replace(/__SCRIPT_VERSION__/g, version);
}
