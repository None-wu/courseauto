// 开发用本地服务:模拟学习通页面 + 假 AI + 复用安装/中转内核
// 用法:node local/server.mjs [port]      默认 8790
// 客户版不打包本文件(只打 app.mjs);模拟页面放在 extras/mock/,与程序目录隔离
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createCore, readBody } from './core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PAGES = path.join(ROOT, 'extras', 'mock');
const PROBE_DIR = path.join(ROOT, 'extras', 'probe');
const SCRIPT = path.join(ROOT, 'userscripts', 'courseauto.user.js');
const BRIDGE = path.join(ROOT, 'userscripts', 'courseauto-webai-bridge.user.js');
const SETUP_PAGE = path.join(__dirname, 'pages', 'setup.html');

const ASSET_FILES = { script: SCRIPT, bridge: BRIDGE, setup: SETUP_PAGE };

const PAGES_MAP = {
  '/mycourse/studentstudy': 'chapter.html',
  '/cards.html': 'cards.html',
  '/ananas/modules/video/index.html': 'video.html',
  '/ananas/modules/audio/index.html': 'audio.html',
  '/ananas/modules/pdf/index.html': 'pdf.html',
  '/ananas/modules/img/index.html': 'img.html',
  '/ananas/modules/work/index.html': 'work-outer.html',
  '/work/doHomeWorkNew': 'work-inner.html',
  '/mooc2/work/dowork': 'work-dowork.html',
  '/mooc2/work/dowork-judge': 'work-dowork-judge.html',
  '/mooc2/work/dowork-multi': 'work-dowork-multi.html',
  '/mooc2/work/dowork-accuracy': 'work-dowork-accuracy.html',
  '/mooc2/work/dowork-newver': 'work-dowork-newver.html',
  '/cards-direct.html': 'cards-direct.html',
  '/cards-judge.html': 'cards-judge.html',
  '/cards-multi.html': 'cards-multi.html',
  '/cards-accuracy.html': 'cards-accuracy.html',
  '/cards-newver.html': 'cards-newver.html',
  '/ai': 'ai-chat.html',
  '/ai-ce': 'ai-ce.html',
  '/ai-diff': 'ai-diff.html',
  '/ai-slow': 'ai-slow.html',
  '/ai-sym': 'ai-sym.html',
  '/zhihuishu/videoStudy.html': 'zhihuishu.html',
  '/yuketang/course.html': 'yuketang.html'
};

// 题面关键词 -> 标准答案(模拟大模型)
const AI_TABLE = [
  [/默认端口/, 'A'],
  [/故意无解/, 'Z'],
  [/安全教育的目的/, 'A'],
  [/443\s*端口以外/, '错误'],
  [/443\s*端口/, '正确'],
  [/HTTP\s*常见方法/, 'ABC'],
  [/HTTP\s*请求方法/, 'ABD'],
  [/状态码\s*200/, '成功'],
  [/1\s*\+\s*1/, 'B'],
  [/地球是平的/, '错误'],
  [/沸点/, '正确'],
  [/明文传输/, '正确'],
  [/窃听/, '正确'],
  [/哈希/, '错误'],
  [/人工智能/, '错误']
];

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

async function getAsset(key) {
  return readFile(ASSET_FILES[key], 'utf8');
}

export function createMockServer() {
  const core = createCore({ getAsset, probeDir: PROBE_DIR });

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;

    // ---- 模拟 AI:POST /v1/chat/completions ----
    if (p === '/v1/chat/completions' && req.method === 'POST') {
      const raw = await readBody(req);
      let prompt = '';
      try {
        const b = JSON.parse(raw);
        prompt = (b.messages || []).map((m) => m.content || '').join('\n');
      } catch { /* ignore */ }
      const hit = AI_TABLE.find(([re]) => re.test(prompt));
      const answer = hit ? hit[1] : 'A';
      console.log(`[mock-ai] ${prompt.replace(/\s+/g, ' ').slice(0, 60)} => ${answer}`);
      return json(res, 200, {
        choices: [{ message: { role: 'assistant', content: answer } }],
        usage: { total_tokens: 42 }
      });
    }

    // ---- 安装向导 / 脚本分发 / 中转 / 采集 / 环境检测:与客户版共用同一份实现 ----
    if (await core(req, res, url)) return;

    // ---- 被测脚本与垫片(仅开发环境:demo 页面直接注入) ----
    if (p === '/userscript.js' || p === '/gm-shim.js' || p === '/ai-bridge.js') {
      const src = p === '/userscript.js' ? SCRIPT
        : p === '/ai-bridge.js' ? BRIDGE
        : path.join(__dirname, 'lib', 'gm-shim.js');
      try {
        let code = await readFile(src, 'utf8');
        // gm-shim 的 GM_info 用真实产物元数据填充,demo 页面板显示的版本与油猴一致
        if (p === '/gm-shim.js') {
          const main = await readFile(SCRIPT, 'utf8');
          code = code
            .replace(/__SCRIPT_NAME__/g, (main.match(/^\s*\/\/\s*@name\s+(.+)$/m) || [, '刷课助手'])[1].trim())
            .replace(/__SCRIPT_VERSION__/g, (main.match(/^\s*\/\/\s*@version\s+(\S+)/m) || [, 'unknown'])[1]);
        }
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(code);
      } catch (e) {
        return json(res, 500, { error: String(e.message) });
      }
    }

    // ---- 模拟页面 ----
    const file = PAGES_MAP[p];
    if (file) {
      try {
        let html = await readFile(path.join(PAGES, file), 'utf8');
        // 演示模式:?demo=1 直接把 GM 垫片和被测脚本注入页面,浏览器打开即可看到脚本自动跑
        if (url.searchParams.get('demo') === '1') {
          html = html.replace('</body>',
            '<script src="/gm-shim.js"></script>\n<script src="/userscript.js"></script>\n</body>');
        }
        // 模拟网页版 AI:始终注入"桥"脚本(真实场景由油猴按 @match 注入)
        if (p.startsWith('/ai')) {
          html = html.replace('</body>', '<script src="/ai-bridge.js"></script>\n</body>');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(html);
      } catch (e) {
        return json(res, 500, { error: String(e.message) });
      }
    }

    json(res, 404, { error: 'not found', path: p });
  });
}

export function startMock(port = 8790) {
  const server = createMockServer();
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

if (process.argv[1] && process.argv[1].endsWith('server.mjs')) {
  const port = Number(process.argv[2] || 8790);
  startMock(port).then(({ port }) => {
    console.log(`\n模拟学习通已启动: http://127.0.0.1:${port}/mycourse/studentstudy?mooc2=1`);
    console.log(`被测脚本地址:    http://127.0.0.1:${port}/userscript.js\n`);
  });
}
