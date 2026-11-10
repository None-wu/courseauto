// 本地服务内核:安装向导 + 脚本分发 + 网页 AI 中转 + 环境检测 + 结构采集
// 开发环境由 server.mjs 复用(叠加模拟页面);客户版由 app.mjs 直接使用(无模拟页面)
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { scanBrowsers } from './detect.mjs';

export const APP_ID = 'courseauto';

// 报告(答题自检工具上报)与网页 AI 中转队列都放内存:客户版不需要落盘,重启即清空
const reports = [];
const webaiQueue = [];              // 待取题目 {cxId,text,href,site,expect,timeout,ttl,at}
const webaiAnswers = new Map();     // cxId -> {text,error,site,ver,at}
let webaiBridgeSeenAt = 0;
const webaiBridgeSites = new Map();

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(body)
  }, {}));
  res.end(body);
}

// 1.2.0 > 1.1.9(按数字段比,不能用字符串)
export function cmpVer(a, b) {
  const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export function readBody(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => { buf += c; });
    req.on('end', () => resolve(buf));
  });
}

export function versionOf(code) {
  const m = String(code || '').match(/^\s*\/\/\s*@version\s+(\S+)/m);
  return m ? m[1] : 'unknown';
}

/**
 * @param {object} opt
 * @param {(key:'script'|'bridge'|'setup')=>Promise<string>} opt.getAsset 取内置资源(打包版直接返回内存字符串)
 * @param {string} opt.probeDir 页面结构采集落盘目录
 */
export function createCore({ getAsset, probeDir }) {
  const INSTALL_ROUTES = {
    '/install/courseauto.user.js': { key: 'script', name: 'courseauto.user.js' },
    '/install/courseauto-webai-bridge.user.js': { key: 'bridge', name: 'courseauto-webai-bridge.user.js' }
  };

  return async function handle(req, res, url) {
    const p = url.pathname;

    // ---- CORS 预检:桥脚本在 AI 站域名下跨域到本服务,浏览器会先发 OPTIONS ----
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      res.end();
      return true;
    }

    // ---- 存活探针:客户版用它判断"是否已有本程序在跑" ----
    if (p === '/api/ping') {
      json(res, 200, { ok: true, app: APP_ID, pid: process.pid, up: Math.round(process.uptime()) });
      return true;
    }

    // ---- 状态上报(答题记录自检工具) ----
    if (p === '/report' && req.method === 'POST') {
      const raw = await readBody(req);
      try { reports.push(JSON.parse(raw)); } catch { /* ignore */ }
      if (reports.length > 200) reports.shift();
      return json(res, 200, { ok: true, count: reports.length }), true;
    }
    if (p === '/report/last') {
      json(res, 200, reports.slice(-5));
      return true;
    }

    // ---- 页面结构采集:适配器自检失败时把真实 DOM 发回来,落盘供写选择器 ----
    if (p === '/api/probe' && req.method === 'POST') {
      const raw = await readBody(req);
      try {
        const obj = JSON.parse(raw);
        await mkdir(probeDir, { recursive: true });
        const host = String(obj.host || 'unknown').replace(/[^\w.-]/g, '_');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const file = path.join(probeDir, `${host}-${stamp}.json`);
        await writeFile(file, JSON.stringify(obj, null, 2), 'utf8');
        return json(res, 200, { ok: true, file: path.basename(file) }), true;
      } catch (e) {
        return json(res, 400, { ok: false, error: String(e.message) }), true;
      }
    }
    if (p === '/api/probe/list') {
      try {
        const names = await readdir(probeDir);
        json(res, 200, names.filter((n) => n.endsWith('.json')).sort());
      } catch {
        json(res, 200, []);
      }
      return true;
    }

    // ---- 网页 AI 中转 ----
    if (p === '/api/webai/ask' && req.method === 'POST') {       // 主脚本:放题
      const raw = await readBody(req);
      try {
        const o = JSON.parse(raw);
        const cxId = String(o.cxId || ('cx' + Date.now().toString(36)));
        const ttl = Math.max(90 * 1000, Number(o.timeout) || 0);
        // images:题目配图的 dataURL(最多 3 张),由 AI 页的桥负责转成文件上传
        const images = Array.isArray(o.images) ? o.images.filter((s) => typeof s === 'string' && s.startsWith('data:image/')).slice(0, 3) : [];
        webaiQueue.push({ cxId, text: String(o.text || ''), href: String(o.href || ''), site: String(o.site || ''), expect: Number(o.expect) || 0, timeout: Number(o.timeout) || 0, ttl, images, at: Date.now() });
        while (webaiQueue.length > 20) webaiQueue.shift();
        return json(res, 200, { ok: true, cxId }), true;
      } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }), true; }
    }
    if (p === '/api/webai/next') {                                // 桥脚本:取一条题
      const wantSite = url.searchParams.get('site') || '';
      const wantVer = url.searchParams.get('v') || '?';
      const wantCap = url.searchParams.get('cap') === '1';
      const tick = url.searchParams.get('tick') === '1';   // 桥是否跑在节流免疫时钟上(诊断用)
      webaiBridgeSeenAt = Date.now();
      // 版本压制:同一站点可能开着多个 AI 标签页(含没刷新的旧版桥)。旧版桥会抢题却答不好,
      // 所以 30 秒内见过更高版本的桥,就让低版本桥只轮询不取题。
      if (wantSite) {
        const prev = webaiBridgeSites.get(wantSite) || {};
        const VER_RE = /^\d+(\.\d+)*$/;
        const bothVer = prev.ver && VER_RE.test(String(prev.ver)) && VER_RE.test(wantVer);
        if (bothVer && cmpVer(wantVer, prev.ver) < 0 && Date.now() - prev.at < 30000) {
          return json(res, 200, { ok: true, item: null, stale: true, current: prev.ver }), true;
        }
        const capAt = wantCap ? Date.now() : (prev.capAt || 0);
        webaiBridgeSites.set(wantSite, { at: Date.now(), ver: wantVer, capAt, tick });
        if (!wantCap && Date.now() - capAt < 30000) {
          return json(res, 200, { ok: true, item: null, noInput: true }), true;   // 没有输入框的页面不派题
        }
      }
      const nowTs = Date.now();
      for (let i = webaiQueue.length - 1; i >= 0; i--) {
        if (nowTs - webaiQueue[i].at > (webaiQueue[i].ttl || 90 * 1000)) webaiQueue.splice(i, 1);
      }
      const idx = webaiQueue.findIndex((it) => (it.site ? wantSite === it.site : true));
      if (idx === -1) return json(res, 200, { ok: true, item: null }), true;
      const [item] = webaiQueue.splice(idx, 1);
      return json(res, 200, { ok: true, item }), true;
    }
    if (p === '/api/webai/answer' && req.method === 'POST') {     // 桥脚本:回传答案
      const raw = await readBody(req);
      try {
        const o = JSON.parse(raw);
        webaiAnswers.set(String(o.cxId), { text: String(o.text || ''), error: String(o.error || ''), site: String(o.site || ''), ver: String(o.ver || ''), at: Date.now() });
        if (webaiAnswers.size > 60) webaiAnswers.delete(webaiAnswers.keys().next().value);
        return json(res, 200, { ok: true }), true;
      } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }), true; }
    }
    if (p === '/api/webai/requeue' && req.method === 'POST') {     // 桥:答不了,把题退回队列
      const raw = await readBody(req);
      try {
        const o = JSON.parse(raw);
        const it = o && o.item;
        if (!it || !it.cxId) return json(res, 200, { ok: false }), true;
        const tries = Number(it.tries || 0) + 1;
        if (tries > 2) return json(res, 200, { ok: false, tries }), true;
        webaiQueue.push({ cxId: it.cxId, text: String(it.text || ''), href: String(it.href || ''), site: String(it.site || ''), expect: Number(it.expect) || 0, timeout: Number(it.timeout) || 0, ttl: it.ttl, images: Array.isArray(it.images) ? it.images : [], tries, at: Date.now() });
        return json(res, 200, { ok: true, tries }), true;
      } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }), true; }
    }
    if (p === '/api/webai/answers') {                             // 诊断:答案流水(不消费)
      const list = Array.from(webaiAnswers.entries())
        .sort((a, b) => b[1].at - a[1].at).slice(0, 20)
        .map(([cxId, a]) => ({ cxId, text: String(a.text || '').slice(0, 60), error: a.error || '', site: a.site || '', ver: a.ver || '', agoMs: Date.now() - a.at }));
      return json(res, 200, { ok: true, list }), true;
    }
    if (p.startsWith('/api/webai/answer/')) {                     // 主脚本:轮询答案
      const cxId = p.split('/').pop();
      const a = webaiAnswers.get(cxId);
      if (a) webaiAnswers.delete(cxId);
      json(res, 200, { ok: true, done: !!a, text: a ? a.text : '', error: a ? a.error : '', site: a ? a.site : '', ver: a ? a.ver : '' });
      return true;
    }
    if (p === '/api/webai/status') {                              // 诊断:AI 页是否在线
      const sites = [];
      for (const [host, info] of webaiBridgeSites) {
        const t = info && info.at;
        // 在线窗口 30s:容忍后台页偶发断档(桥 1.3.0 已用 Worker 心跳,正常 2s 一跳)
        if (t && Date.now() - t < 30000) sites.push({ host, ver: info.ver, tick: !!info.tick });
      }
      json(res, 200, {
        ok: true,
        bridgeOnline: Date.now() - webaiBridgeSeenAt < 30000,
        bridgeSeenAgo: webaiBridgeSeenAt ? Date.now() - webaiBridgeSeenAt : null,
        sites,
        pending: webaiQueue.length
      });
      return true;
    }

    // ---- 安装向导:环境检测 ----
    if (p === '/api/env') {
      try {
        const env = await scanBrowsers();
        env.scripts = { main: versionOf(await getAsset('script')), bridge: versionOf(await getAsset('bridge')) };
        json(res, 200, env);
      } catch (e) {
        json(res, 500, { error: String(e.message) });
      }
      return true;
    }

    // ---- 安装向导:脚本安装地址(油猴拦截 .user.js 导航并弹安装页) ----
    if (INSTALL_ROUTES[p]) {
      const { key, name } = INSTALL_ROUTES[p];
      try {
        const code = await getAsset(key);
        const headers = {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*'
        };
        if (url.searchParams.get('download') === '1') headers['Content-Disposition'] = `attachment; filename="${name}"`;
        res.writeHead(200, headers);
        res.end(code);
      } catch (e) {
        json(res, 500, { error: String(e.message) });
      }
      return true;
    }

    // ---- 安装向导页 ----
    if (p === '/setup' || p === '/' || p === '/index.html') {
      try {
        const html = await getAsset('setup');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(html);
      } catch (e) {
        json(res, 500, { error: String(e.message) });
      }
      return true;
    }

    if (p === '/favicon.ico') { res.writeHead(204); res.end(); return true; }

    return false;   // 交给外层(开发版会继续匹配模拟页面)
  };
}
