// 版本更新检测与下载:启动时静默检查 GitHub 最新 Release
// 三个源依次尝试(任一可用即返回):GitHub API → releases/latest 跳转 → main 分支 version.json
// 容错:部分机器上有网络中间设备(杀软/校园网)导致 Node 认不出 GitHub 证书链(浏览器却正常),
//      此时严格校验必然失败 —— 会再用宽松校验重试一次,并校验返回内容(版本号格式 + 仓库地址),
//      结果里带 insecure 标记。全部失败才算"无法检测更新"。
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createWriteStream } from 'node:fs';

export const REPO = (process.env.CX_REPO || 'None-wu/courseauto').replace(/^\/+|\/+$/g, '');
const UA = 'courseauto-updater/1.0 (+https://github.com/' + REPO + ')';
const PER_SOURCE_TIMEOUT = 6000;

/* ---------------- 版本号 ---------------- */
export function parseVersion(v) {
  return String(v || '').replace(/^v/i, '').split(/[.\-+]/).slice(0, 3)
    .map((x) => parseInt(x, 10) || 0);
}

export function cmpVersion(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) > (y[i] || 0)) return 1;
    if ((x[i] || 0) < (y[i] || 0)) return -1;
  }
  return 0;
}

/* ---------------- HTTP 小工具(带超时/重定向) ---------------- */
function request(url, { headers = {}, timeout = PER_SOURCE_TIMEOUT, redirect = 5, insecure = false } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, val) => { if (!settled) { settled = true; fn(val); } };
    let req;
    try {
      const mod = url.startsWith('https:') ? https : http;
      const opt = { headers: { 'User-Agent': UA, Accept: '*/*', ...headers } };
      if (insecure) opt.rejectUnauthorized = false;
      req = mod.get(url, opt, (res) => {
        const code = res.statusCode || 0;
        if (code >= 300 && code < 400 && res.headers.location && redirect > 0) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          request(next, { headers, timeout, redirect: redirect - 1, insecure })
            .then((r) => done(resolve, r), (e) => done(reject, e));
          return;
        }
        const chunks = [];
        let size = 0;
        res.on('data', (c) => { size += c.length; if (size <= 3 * 1024 * 1024) chunks.push(c); });
        res.on('end', () => done(resolve, { code, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', (e) => done(reject, e));
      });
      req.setTimeout(timeout, () => { req.destroy(new Error('timeout ' + timeout + 'ms')); });
      req.on('error', (e) => done(reject, e));
    } catch (e) { done(reject, e); }
  });
}

/* ---------------- 检测 ---------------- */
function pickAsset(assets, version) {
  const list = (assets || []).filter((a) => a && a.name && /\.(exe|zip)$/i.test(a.name));
  const exact = list.find((a) => a.name === `刷课助手-v${version}.exe`);
  if (exact) return exact;
  const exe = list.find((a) => /\.exe$/i.test(a.name));
  if (exe) return exe;
  const zip = list.find((a) => /win64\.zip$/i.test(a.name));
  return zip || list[0] || null;
}

function badVersion(v) { return !/^\d+\.\d+\.\d+$/.test(String(v || '')); }

async function viaApi(current, opts) {
  const r = await request(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' }, ...opts
  });
  if (r.code === 404) return { state: 'up-to-date', source: 'api', note: '仓库暂无 Release' };
  if (r.code !== 200) throw new Error('api ' + r.code);
  const j = JSON.parse(r.body);
  const latest = String(j.tag_name || j.name || '').replace(/^v/i, '');
  if (badVersion(latest)) throw new Error('api: tag 不像版本号');
  const asset = pickAsset(j.assets, latest);
  return {
    source: 'api',
    latest,
    notes: String(j.body || '').slice(0, 4000),
    pageUrl: j.html_url || `https://github.com/${REPO}/releases/latest`,
    // 宽松校验下再多看一眼:返回的仓库确实是本项目
    trust: !opts || !opts.insecure ? true : new RegExp(REPO.replace('/', '\\/'), 'i').test(String(j.html_url || '') + String(j.url || '')),
    asset: asset ? { name: asset.name, size: asset.size, url: asset.browser_download_url } : null
  };
}

// 兜底下载地址:回退源(releases/latest、version.json)拿不到资产列表,只能按我们自己的命名规则拼。
// 线上 Release 的资产名是 courseauto-vX.Y.Z.exe(本地 pack 产物是中文名,上传时会改名),两个候选都留着;
// 真正下载时 downloadTo 会逐个试,404 自动换下一个。
function fallbackAssets(latest) {
  const names = [`courseauto-v${latest}.exe`, `刷课助手-v${latest}.exe`];
  return names.map((n) => ({
    name: n,
    size: 0,
    url: `https://github.com/${REPO}/releases/download/v${latest}/${encodeURIComponent(n)}`
  }));
}

async function viaRedirect(current, opts) {
  const r = await request(`https://github.com/${REPO}/releases/latest`, { redirect: 0, ...opts });
  const loc = r.headers && r.headers.location ? String(r.headers.location) : '';
  const m = loc.match(/\/releases\/tag\/(?:v)?([0-9][^\/?#]*)/);
  if (!m) throw new Error('redirect ' + r.code + ' 没有 tag');
  if (badVersion(m[1])) throw new Error('redirect 的 tag 不像版本号');
  const latest = m[1];
  return {
    source: 'redirect',
    latest,
    notes: '',
    pageUrl: `https://github.com/${REPO}/releases/tag/v${latest}`,
    trust: /\/releases\/tag\//.test(loc),
    asset: fallbackAssets(latest)[0],
    altAssets: fallbackAssets(latest).slice(1)
  };
}

async function viaRaw(current, opts) {
  const r = await request(`https://raw.githubusercontent.com/${REPO}/main/version.json`, { redirect: 3, ...opts });
  if (r.code !== 200) throw new Error('raw ' + r.code);
  const j = JSON.parse(r.body);
  const latest = String(j.v || j.version || '').replace(/^v/i, '');
  if (badVersion(latest)) throw new Error('raw: 版本号不合法');
  return {
    source: 'raw',
    latest,
    notes: '',
    pageUrl: `https://github.com/${REPO}/releases/latest`,
    trust: true,
    asset: fallbackAssets(latest)[0],
    altAssets: fallbackAssets(latest).slice(1)
  };
}

const SOURCES = [viaApi, viaRedirect, viaRaw];

/**
 * 检测是否有更新。
 * 返回 { state: 'has-update' | 'up-to-date' | 'unreachable', current, latest, insecure, ... }
 * unreachable = 所有源都连不上,客户端只提示"无法检测更新"
 */
export async function checkUpdate(currentVersion) {
  const current = String(currentVersion || '').replace(/^v/i, '') || '0.0.0';
  const errors = [];
  // 第一轮严格校验;严格全失败才用宽松校验重试(内容已做校验)
  for (const insecure of [false, true]) {
    for (const fn of SOURCES) {
      try {
        const r = await fn(current, { insecure });
        if (!r || !r.latest) continue;
        if (insecure && !r.trust) { errors.push(`${fn.name}: 宽松模式下返回内容对不上仓库,已丢弃`); continue; }
        const cmp = cmpVersion(r.latest, current);
        return {
          state: r.state === 'up-to-date' ? 'up-to-date' : (cmp > 0 ? 'has-update' : 'up-to-date'),
          current,
          latest: r.latest,
          source: r.source,
          insecure,
          notes: r.notes || '',
          pageUrl: r.pageUrl,
          asset: r.asset ? Object.assign({}, r.asset, { urls: [r.asset.url].concat((r.altAssets || []).map((a) => a.url)).filter(Boolean) }) : null,
          checkedAt: new Date().toISOString()
        };
      } catch (e) {
        errors.push(`${fn.name}${insecure ? '(宽松)' : ''}: ${e && e.message}`);
      }
    }
  }
  return {
    state: 'unreachable',
    current,
    latest: '',
    source: '',
    insecure: false,
    error: errors.join(' | '),
    pageUrl: `https://github.com/${REPO}/releases/latest`,
    checkedAt: new Date().toISOString()
  };
}

/* ---------------- 下载 ---------------- */
const JOBS = new Map();

export function downloadProgress(id) {
  const j = JOBS.get(id);
  if (!j) return null;
  return { id, state: j.state, received: j.received, total: j.total, file: j.file || '', error: j.error || '', insecure: j.insecure };
}

function safeName(name) {
  return String(name || 'update.exe').replace(/[\\/:*?"<>|]/g, '_');
}

function peOk(file) {
  // 下载回来的 exe 至少要是 PE 文件,避免把拦截页当成安装包
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(2);
    fs.readSync(fd, buf, 0, 2, 0);
    fs.closeSync(fd);
    return buf[0] === 0x4d && buf[1] === 0x5a;
  } catch { return false; }
}

export function startDownload(asset, dir) {
  const id = 'dl' + Date.now().toString(36);
  const job = { state: 'running', received: 0, total: Number(asset && asset.size) || 0, file: '', error: '', insecure: false };
  JOBS.set(id, job);
  const target = path.join(dir, safeName(asset && asset.name));
  const part = target + '.part';
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }

  // 候选地址:API 源直接给 browser_download_url;回退源只能按命名规则拼,
  // 撞上 404 就换下一个候选(历史资产用过 courseauto-vX.exe 的命名)
  const cands = ((asset && (Array.isArray(asset.urls) && asset.urls.length ? asset.urls : [asset.url])) || []).filter(Boolean);
  if (!cands.length) { job.state = 'failed'; job.error = '没有可用的下载地址'; return id; }

  const go = (ci, hop = 5, insecure = false) => {
    const url = cands[ci];
    const mod = url.startsWith('https:') ? https : http;
    const opt = { headers: { 'User-Agent': UA, Accept: '*/*' } };
    if (insecure) opt.rejectUnauthorized = false;
    const req = mod.get(url, opt, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location && hop > 0) {
        res.resume();
        return go(ci, hop - 1, insecure);
      }
      if (code !== 200) {
        res.resume();
        if (ci + 1 < cands.length) return go(ci + 1, 5, insecure);
        job.state = 'failed';
        job.error = 'HTTP ' + code + '(可能是该版本还没上传 exe,或网络被拦截)';
        return;
      }
      if (!job.total) job.total = Number(res.headers['content-length']) || 0;
      job.insecure = insecure;
      const out = createWriteStream(part);
      res.on('data', (c) => { job.received += c.length; });
      res.pipe(out);
      out.on('finish', () => {
        try {
          if (/\.exe$/i.test(target) && !peOk(part)) throw new Error('下载到的不是可执行文件(可能被网络拦截),请改用浏览器打开 Release 页面下载');
          fs.renameSync(part, target);
          job.state = 'done';
          job.file = target;
        } catch (e) {
          job.state = 'failed';
          job.error = String(e && e.message);
          try { fs.unlinkSync(part); } catch { /* ignore */ }
        }
      });
      out.on('error', (e) => { job.state = 'failed'; job.error = String(e && e.message); });
    });
    req.setTimeout(20000, () => req.destroy(new Error('下载超时')));
    req.on('error', (e) => {
      const msg = String((e && e.message) || '');
      if (!insecure && /certificate|verify|self.signed|unable to verify/i.test(msg)) {
        // 证书链认不出(网络中间设备):换个宽松连接再下,并要求 exe 头校验
        job.insecure = true;
        return go(ci, hop, true);
      }
      job.state = 'failed';
      job.error = msg || '下载失败';
    });
  };
  go(0);
  return id;
}
