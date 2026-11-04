// ==UserScript==
// @name         学习通刷课助手
// @namespace    cx-auto-study
// @version      1.2.0
// @description  学习通任务点自动完成:视频/音频原速静音连播、自动切章、弹题与章节测验自动答题(字体加密自动解密 + DeepSeek AI 作答)、文档/图片任务处理、拟人化防检测
// @author       cx-auto-study contributors
// @license      MIT
// @homepageURL  https://github.com/DaRin1403/xuexitong-autostudy
// @supportURL   https://github.com/DaRin1403/xuexitong-autostudy/issues
// @updateURL    https://cdn.jsdelivr.net/gh/DaRin1403/xuexitong-autostudy@main/userscripts/xuexitong-autostudy.user.js
// @downloadURL  https://cdn.jsdelivr.net/gh/DaRin1403/xuexitong-autostudy@main/userscripts/xuexitong-autostudy.user.js
// @match        *://*.chaoxing.com/*
// @run-at       document-end
// @grant        GM_getValue
// @grant        GM_info
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      api.tikuhai.com
// @connect      cx.icodef.com
// @connect      tk.enncy.cn
// @connect      api.muketool.com
// @connect      api.deepseek.com
// @connect      cdn.jsdelivr.net
// @noframes
// ==/UserScript==
//
// ⚠️ 免责声明
// 本脚本仅供个人学习辅助与技术研究使用。使用本脚本可能违反学习通(超星)平台服务条款,
// 平台已声明使用人工智能等技术监控"刷课"行为并可能通报所在高校。请自行评估风险,
// 合理设置(原速、每日上限、拟人化),使用产生的一切后果由使用者自行承担。

(function () {
  'use strict';

  /* ==================== 配置 ==================== */
  const DEFAULT_CONFIG = {
    speed: 2,              // 视频倍速(默认 2x 最快;1 = 原速最安全,2x 检测风险最高,自行权衡)
    autoVideo: true,       // 自动处理视频任务
    autoAudio: true,       // 自动处理音频任务
    autoWork: true,        // 自动做章节测验
    autoSubmit: true,      // 正确率达标自动提交测验
    autoJump: true,        // 本章完成后自动切下一章
    answerIntervalMin: 0,  // 每题最小间隔(秒,0=最快)
    answerIntervalMax: 0,  // 每题最大间隔(秒,0=最快)
    submitDelayMin: 0,     // 提交前最小延迟(秒,0=最快)
    submitDelayMax: 0,     // 提交前最大延迟(秒,0=最快)
    minAccuracy: 0.6,      // 最低正确率,低于则暂存不提交
    quizDelayMin: 0,       // 弹题作答前等待(秒,0=最快)
    quizDelayMax: 0,
    dailyLimitMinutes: 0,   // 每日刷课时长上限(分钟),0 = 不限
    deliberateErrorRate: 0, // 故意答错率 0~0.2(0=不故意错)
    aiEnabled: false,      // 启用 DeepSeek AI 答题(需填 key)
    aiKey: '',              // 个人 API Key:点面板 ⚙ 填写(platform.deepseek.com 创建,只存本机)
    aiUrl: 'https://api.deepseek.com/v1/chat/completions',
    aiModel: 'deepseek-reasoner',
    useTiku: false,         // 免费题库站(已停止免费,默认关闭,纯 AI 答题)
    reportUrl: '',          // 状态上报地址(调试用,留空=关闭);如 http://127.0.0.1:8790/report
    webAiEnabled: false,    // 网页 AI 答题(免 API Key,需配合「学习通网页AI桥」脚本)
    webAiUrl: 'https://chat.deepseek.com/',  // 网页 AI 地址
    webAiTimeout: 60,       // 等网页 AI 回复的超时(秒)
  };

  function loadConfig() {
    try {
      const saved = (typeof GM_getValue !== 'undefined')
        ? GM_getValue('cxConfig', null)
        : JSON.parse(localStorage.getItem('cxConfig') || 'null');
      if (saved && typeof saved === 'object') return Object.assign({}, DEFAULT_CONFIG, saved);
    } catch (e) { /* ignore */ }
    return Object.assign({}, DEFAULT_CONFIG);
  }
  function saveConfig(cfg) {
    try {
      if (typeof GM_setValue !== 'undefined') GM_setValue('cxConfig', cfg);
      else localStorage.setItem('cxConfig', JSON.stringify(cfg));
    } catch (e) { /* ignore */ }
  }
  let CONFIG = loadConfig();
  // 一次性迁移(v1.0.6):旧存储的 240 分钟上限 / 1x 倍速 强制升级为新默认(0 不限 + 2x)
  try {
    const MIG = 'cxMigV105';
    const done = (typeof GM_getValue !== 'undefined') ? GM_getValue(MIG, false) : localStorage.getItem(MIG);
    if (!done) {
      CONFIG.dailyLimitMinutes = 0;
      CONFIG.speed = 2;
      saveConfig(CONFIG);
      if (typeof GM_setValue !== 'undefined') GM_setValue(MIG, true);
      else localStorage.setItem(MIG, '1');
    }
  } catch (e) { /* ignore */ }
  if (CONFIG.speed > 2) { CONFIG.speed = 2; }  // 倍速上限 2x

  /* 题目收集器:做过的题(题干+选项+答案)自动积累,导出后交给 AI 整理成考前手册 */
  let COLLECTED = [];
  try {
    COLLECTED = (typeof GM_getValue !== 'undefined')
      ? GM_getValue('cxQuestions', [])
      : JSON.parse(localStorage.getItem('cxQuestions') || '[]');
    if (!Array.isArray(COLLECTED)) COLLECTED = [];
  } catch (e) { COLLECTED = []; }
  function recordQuestion(q, answer) {
    try {
      COLLECTED.push({ q: q.question, t: String(q.type), o: (q.options || []).join('§'), a: (answer || []).join('|') });
      if (COLLECTED.length > 5000) COLLECTED = COLLECTED.slice(-5000);
      if (typeof GM_setValue !== 'undefined') GM_setValue('cxQuestions', COLLECTED);
      else localStorage.setItem('cxQuestions', JSON.stringify(COLLECTED));
    } catch (e) { /* ignore */ }
  }
  function exportQuestions() {
    if (!COLLECTED.length) { log('📋 还没有收集到题目(做完学习检测/弹题后自动收集)', 'warn'); return; }
    const data = JSON.stringify(COLLECTED);
    const done = () => log(`📋 已导出 ${COLLECTED.length} 道题,全选复制发给 AI 助手`, 'ok');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(data).then(done).catch(() => { showExportBox(data); });
      } else showExportBox(data);
    } catch (e) { showExportBox(data); }
  }
  function showExportBox(data) {
    const ta = document.createElement('textarea');
    ta.value = data;
    ta.style.cssText = 'position:fixed;left:16px;bottom:16px;width:460px;height:220px;z-index:2147483647;background:rgba(255,255,255,0.95);color:#3b3b43;border:1px solid rgba(255,255,255,0.6);border-radius:8px;padding:8px;font:12px monospace;box-shadow:0 8px 32px rgba(160,60,120,0.22)';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    ta.addEventListener('blur', () => { try { ta.remove(); } catch (e) {} });
    log('📋 题目数据已生成在左下角文本框,全选(Ctrl+A)复制后发给 AI 助手', 'ok');
  }

  /* ==================== 工具函数 ==================== */
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
  const randomSleep = (min, max) => sleep(Math.floor(Math.random() * (max - min + 1)) + min);

  function waitElementLoaded(win, selector, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        try {
          if (win.document.querySelector(selector)) { clearInterval(timer); resolve(); return; }
        } catch (e) { /* iframe 未就绪 */ }
        if (Date.now() - start > timeoutMs) { clearInterval(timer); reject(new Error('等待元素超时: ' + selector)); }
      }, 200);
    });
  }

  function waitIframeLoaded(iframe, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        try {
          if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') { clearInterval(timer); resolve(); return; }
        } catch (e) { /* ignore */ }
        if (Date.now() - start > timeoutMs) { clearInterval(timer); reject(new Error('iframe 加载超时')); }
      }, 200);
    });
  }

  // HTML 转纯文本(保留 img/sub/sup/br)
  function clean(html) {
    if (html == null) return '';
    return String(html)
      .replace(/<((?!img|sub|sup|br)[^>]+)>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .trim();
  }
  // 去题型前缀【单选题】和分值后缀(2.0分)
  const cl = (str) => String(str).replace(/^【.*?】\s*/, '').replace(/\s*（\d+(\.\d+)?分）$/, '');

  // 跨域请求:油猴环境用 GM_xmlhttpRequest,普通环境降级 fetch
  function cxFetch(url, { method = 'GET', data = null, headers = {}, timeout = 10000 } = {}) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'undefined') {
        GM_xmlhttpRequest({
          method, url, data, headers, timeout,
          onload: (res) => resolve(res.responseText),
          onerror: (err) => reject(err),
          ontimeout: () => reject(new Error('timeout'))
        });
      } else {
        fetch(url, { method, headers, body: data }).then((r) => r.text()).then(resolve).catch(reject);
      }
    });
  }

  /* ==================== 日志面板 ==================== */
  let logPanel = null;
  let logLines = [];
  const STATS = { answered: 0, jobsDone: 0, jobsTotal: 0, startedAt: null };

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtDur(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    const p = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(ss)}` : `${p(m)}:${p(ss)}`;
  }

  function setStatus(text) {
    const el = document.getElementById('cxStatus');
    if (el) {
      el.innerHTML = '<i></i>' + escHtml(text);
      el.className = 'cx-pill ' + (text === '工作中' ? 'run' : text === '已暂停' ? 'pause' : text === '出错' ? 'err' : 'idle');
    }
    if (text === '工作中' && !STATS.startedAt) STATS.startedAt = Date.now();
    // 状态文字右侧按钮:工作中(未暂停)→ 停止;待机/已暂停 → 开始
    const btn = document.getElementById('cxRunBtn');
    if (btn) btn.textContent = (text === '工作中' && !PAUSED) ? '⏸' : '▶';
  }

  function renderLogs() {
    const logsEl = document.getElementById('cxLogs');
    if (!logsEl) return;
    logsEl.innerHTML = logLines.map((l) => {
      const t = l.t ? `<span class="t">${l.t}</span>` : '';
      return `<div class="${l.level}">${t}<span class="m">${escHtml(l.msg || l.line)}</span></div>`;
    }).join('');
    logsEl.scrollTop = logsEl.scrollHeight;
  }

  function log(msg, level = 'info') {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const line = `[${time}] ${msg}`;
    const color = level === 'ok' ? '#7ee787' : level === 'warn' ? '#f0b72f' : level === 'err' ? '#f85149' : '#58a6ff';
    console.log(`%c[刷课助手] ${line}`, `color:${color}`);
    if (logPanel) {
      logLines.push({ t: time, msg: String(msg), line, level });
      if (logLines.length > 60) logLines.shift();
      renderLogs();
    }
    scheduleReport();
  }

  // ===== 本地状态上报(可选:填了「上报地址」才生效,把页面真实状态推给本机监听程序)=====
  let lastReportAt = 0;
  let reportTimer = null;
  function scriptVersion() {
    try { if (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) return GM_info.script.version; } catch (e) { /* ignore */ }
    return 'unknown';
  }
  function buildSnapshot() {
    const v = document.querySelector('video');
    const jobs = Array.from(document.querySelectorAll('.ans-job-icon'));
    const statusEl = document.getElementById('cxStatus');
    return {
      at: Date.now(),
      time: new Date().toLocaleString('zh-CN'),
      version: scriptVersion(),
      url: location.href,
      title: document.title,
      status: statusEl ? statusEl.textContent : '',
      config: {
        speed: CONFIG.speed, aiEnabled: CONFIG.aiEnabled, aiModel: CONFIG.aiModel,
        useTiku: CONFIG.useTiku, dailyLimitMinutes: CONFIG.dailyLimitMinutes,
        autoSubmit: CONFIG.autoSubmit, autoJump: CONFIG.autoJump,
        minAccuracy: CONFIG.minAccuracy, deliberateErrorRate: CONFIG.deliberateErrorRate,
        answerIntervalMin: CONFIG.answerIntervalMin, submitDelayMin: CONFIG.submitDelayMin
      },
      video: v ? {
        cur: Math.round(v.currentTime), dur: Math.round(v.duration) || null,
        rate: v.playbackRate, paused: v.paused, muted: v.muted
      } : null,
      jobsOld: jobs.length ? {
        total: jobs.length,
        finished: jobs.filter((e) => e.classList.contains('ans-job-finished')).length
      } : null,
      cards: document.querySelectorAll('mooc-ans, .knowledge-card').length,
      frames: Array.from(document.querySelectorAll('iframe')).map((f) => (f.src || '').slice(0, 120)).slice(0, 12),
      quiz: {
        TiMu: document.querySelectorAll('.TiMu').length,
        questionLi: document.querySelectorAll('.questionLi').length,
        fontEnc: document.querySelectorAll('.font-cxsecret').length,
        checked: document.querySelectorAll('input[type=radio]:checked, input[type=checkbox]:checked').length
      },
      logs: logLines.slice(-25).map((l) => l.line),
      diag: (function () {
        try {
          const li = document.querySelector('.questionLi') || document.querySelector('.TiMu');
          if (!li) return null;
          const ti = li.querySelector('input[name^=answertype]');
          const ue = (typeof window.UE !== 'undefined') ? window.UE : null;
          const keys = (ue && ue.instants) ? Object.keys(ue.instants) : null;
          let ueLen = null;
          try {
            if (keys && keys.length) {
              const ed = ue.instants[keys[0]];
              if (ed && typeof ed.getContent === 'function') ueLen = String(ed.getContent()).replace(/<[^>]*>/g, '').length;
            }
          } catch (e) { /* ignore */ }
          return {
            answertype: ti ? ti.value : null,
            textareas: Array.from(li.querySelectorAll('textarea')).map((t) => ({
              id: t.id || null, name: t.name || null,
              hidden: (t.offsetParent === null), cls: (t.className || '').slice(0, 40)
            })),
            iframes: Array.from(li.querySelectorAll('iframe')).map((f) => ({
              id: f.id || null, cls: (f.className || '').slice(0, 40),
              sameOrigin: (function () { try { return !!f.contentDocument; } catch (e) { return false; } })()
            })),
            editables: li.querySelectorAll('[contenteditable="true"]').length,
            hasUE: !!ue,
            ueInstants: keys,
            ueContentLen: ueLen,
            optionInputs: li.querySelectorAll('input[type=radio], input[type=checkbox]').length
          };
        } catch (e) { return { error: String(e && e.message) }; }
      })()
    };
  }
  function pushReport(force) {
    const url = (CONFIG.reportUrl || '').trim();
    if (!url) return;
    const now = Date.now();
    if (!force && now - lastReportAt < 4000) return;   // 限流:最快 4 秒一次
    lastReportAt = now;
    try {
      GM_xmlhttpRequest({
        method: 'POST',
        url: url,
        data: JSON.stringify(buildSnapshot()),
        headers: { 'Content-Type': 'application/json' },
        timeout: 4000,
        onerror: () => {},
        ontimeout: () => {}
      });
    } catch (e) { /* 上报是可选能力,失败静默 */ }
  }
  function scheduleReport() {
    if (reportTimer) return;
    reportTimer = setTimeout(() => { reportTimer = null; pushReport(true); }, 800);
  }
  function startReporterHeartbeat() {
    if (!(CONFIG.reportUrl || '').trim()) return;
    pushReport(true);
    setInterval(() => pushReport(false), 10000);
  }

  function initPanel() {
    if (logPanel) return;
    logPanel = document.createElement('div');
    logPanel.id = 'cx-panel';
    logPanel.innerHTML =
      '<div id="cxTitle" title="按住此处可拖动面板">' +
        '<span class="cx-brand">📚</span>' +
        '<span class="cx-name">学习通刷课助手</span>' +
        '<span id="cxStatus" class="cx-pill idle"><i></i>待机</span>' +
        '<span class="cx-spacer"></span>' +
        '<span id="cxRunBtn" class="cx-ic" title="开始/停止挂机">▶</span>' +
        '<span id="cxToggleBtn" class="cx-ic" title="展开/收起日志">▼</span>' +
        '<span id="cxCfgBtn" class="cx-ic" title="配置">⚙</span>' +
      '</div>' +
      '<div id="cxStats">' +
        '<div class="cell"><b id="cxStatJobs">—</b><span>任务点</span></div>' +
        '<div class="cell"><b id="cxStatAns">0</b><span>已答题</span></div>' +
        '<div class="cell"><b id="cxStatTime">—</b><span>运行时长</span></div>' +
      '</div>' +
      '<div id="cxLogs"></div>';
    const style = document.createElement('style');
    style.textContent =
      // ===== 墨白主题(Black & White · 单色玻璃)=====
      '#cx-panel{position:fixed;right:16px;bottom:16px;width:384px;background:linear-gradient(168deg,rgba(24,24,26,0.97),rgba(10,10,12,0.97));color:#e8e8ea;border:1px solid rgba(255,255,255,0.14);border-radius:12px;font:12px/1.6 "Microsoft YaHei",sans-serif;z-index:2147483647;box-shadow:inset 0 1px 0 rgba(255,255,255,0.08),0 16px 44px rgba(0,0,0,0.55);backdrop-filter:blur(16px);filter:grayscale(1);overflow:hidden}' +
      '#cxTitle{padding:9px 10px 9px 12px;font-weight:600;cursor:move;display:flex;gap:7px;align-items:center;color:#fafafa;background:linear-gradient(rgba(42,42,46,0.96),rgba(26,26,30,0.96));border-bottom:1px solid rgba(255,255,255,0.1);box-shadow:inset 0 1px 0 rgba(255,255,255,0.07);user-select:none}' +
      '#cxTitle .cx-brand{font-size:14px;filter:grayscale(1) brightness(1.6)}' +
      '#cxTitle .cx-name{font-size:13px;letter-spacing:0.6px;color:#fafafa}' +
      '#cxTitle .cx-spacer{flex:1}' +
      '.cx-pill{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:400;padding:1px 9px 1px 7px;border-radius:999px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.16);color:#a1a1aa;transition:all .25s}' +
      '.cx-pill i{width:6px;height:6px;border-radius:50%;background:#6b6b73;flex:none}' +
      '.cx-pill.run i{background:#fff;box-shadow:0 0 0 0 rgba(255,255,255,0.55);animation:cxAura 1.7s infinite}' +
      '.cx-pill.run{color:#fff;border-color:rgba(255,255,255,0.4)}' +
      '.cx-pill.pause i{background:transparent;border:1.5px solid #a1a1aa;box-sizing:border-box}.cx-pill.pause{color:#d4d4d8}' +
      '.cx-pill.err i{background:#fff;border-radius:1px;transform:rotate(45deg)}.cx-pill.err{color:#fff;border-color:rgba(255,255,255,0.55)}' +
      '@keyframes cxAura{0%{box-shadow:0 0 0 0 rgba(255,255,255,0.5)}70%{box-shadow:0 0 0 5px rgba(255,255,255,0)}100%{box-shadow:0 0 0 0 rgba(255,255,255,0)}}' +
      '.cx-ic{cursor:pointer;font-size:12px;color:#d4d4d8;min-width:26px;height:22px;display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.16);border-radius:6px;padding:0 6px;line-height:1.4;transition:all .15s;user-select:none}' +
      '.cx-ic:hover{background:#fafafa;color:#0a0a0a;border-color:#fafafa}' +
      '.cx-ic:active{transform:scale(0.96)}' +
      '#cxStats{display:flex;gap:8px;padding:9px 12px 7px}' +
      '#cxStats .cell{flex:1;display:flex;flex-direction:column;align-items:center;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:5px 2px 4px}' +
      '#cxStats .cell b{font-size:14px;font-weight:700;color:#fafafa;font-variant-numeric:tabular-nums;line-height:1.3;letter-spacing:0.3px}' +
      '#cxStats .cell span{font-size:10px;color:#7d7d86;line-height:1.3}' +
      '#cxLogs{padding:2px 12px 10px;overflow-y:auto;max-height:236px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.25) transparent}' +
      '#cxLogs::-webkit-scrollbar{width:5px}' +
      '#cxLogs::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.22);border-radius:3px}' +
      '#cxLogs div{display:flex;gap:6px;align-items:baseline;color:#b4b4bb;margin:3px 0;padding:2px 7px 2px 6px;background:rgba(255,255,255,0.03);border-radius:4px;border-left:2px solid rgba(255,255,255,0.18);word-break:break-all;line-height:1.55}' +
      '#cxLogs div .t{flex:none;color:#5f5f66;font-size:10.5px;font-variant-numeric:tabular-nums}' +
      '#cxLogs div.ok{border-left-color:#fafafa;background:rgba(255,255,255,0.06)}#cxLogs div.ok .m{color:#f4f4f5}' +
      '#cxLogs div.warn{border-left-color:rgba(255,255,255,0.45);border-left-style:dashed}#cxLogs div.warn .m{color:#d4d4d8}' +
      '#cxLogs div.err{border-left-color:#fff;background:rgba(255,255,255,0.1)}#cxLogs div.err .m{color:#fff;font-weight:700}' +
      '#cxCfgPanel{position:fixed;right:16px;bottom:8px;width:420px;max-height:84vh;overflow-y:auto;background:linear-gradient(170deg,rgba(22,22,25,0.98),rgba(10,10,12,0.98));color:#e4e4e7;border:1px solid rgba(255,255,255,0.14);border-radius:12px;z-index:2147483647;font:13px/1.5 "Microsoft YaHei";box-shadow:inset 0 1px 0 rgba(255,255,255,0.08),0 16px 44px rgba(0,0,0,0.6);backdrop-filter:blur(16px);filter:grayscale(1);scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.25) transparent}' +
      '#cxCfgPanel .cfgHead{position:sticky;top:0;display:flex;align-items:center;justify-content:space-between;padding:11px 14px;font-size:14px;font-weight:700;color:#fafafa;background:linear-gradient(rgb(40,40,44),rgb(27,27,31));border-bottom:1px solid rgba(255,255,255,0.12);z-index:1}' +
      '#cxCfgPanel .cfgHead small{font-weight:400;font-size:11px;color:#8b8b93;margin-left:8px}' +
      '#cxCfgPanel .cfgBody{padding:2px 14px 12px}' +
      '#cxCfgPanel .sec{margin:14px 0 2px;font-size:12px;font-weight:700;color:#fafafa;letter-spacing:1px;display:flex;align-items:center;gap:6px}' +
      '#cxCfgPanel .sec::after{content:"";flex:1;border-bottom:1px dashed rgba(255,255,255,0.2)}' +
      '#cxCfgPanel .field{margin:9px 0;padding-bottom:9px;border-bottom:1px solid rgba(255,255,255,0.07)}' +
      '#cxCfgPanel .field:last-of-type{border-bottom:none}' +
      '#cxCfgPanel .label{font-weight:600;margin-bottom:4px;color:#e4e4e7}' +
      '#cxCfgPanel .row{display:flex;align-items:center;justify-content:space-between;gap:10px}' +
      '#cxCfgPanel .row .label{margin:0}' +
      '#cxCfgPanel .hint{font-size:11px;color:#86868f;margin-top:4px;line-height:1.55}' +
      '#cxCfgPanel input[type=text],#cxCfgPanel input[type=password],#cxCfgPanel input[type=number],#cxCfgPanel select{width:100%;box-sizing:border-box;background:rgba(255,255,255,0.05);color:#f4f4f5;border:1px solid rgba(255,255,255,0.14);border-radius:6px;padding:6px 9px;transition:border-color .15s,box-shadow .15s}' +
      '#cxCfgPanel input[type=text]:focus,#cxCfgPanel input[type=password]:focus,#cxCfgPanel input[type=number]:focus,#cxCfgPanel select:focus{outline:none;border-color:#fafafa;box-shadow:0 0 0 3px rgba(255,255,255,0.1)}' +
      '#cxCfgPanel input::placeholder{color:#5f5f66}' +
      '#cxCfgPanel input[type=checkbox]{appearance:none;-webkit-appearance:none;width:40px;height:21px;flex:none;border-radius:999px;background:rgba(255,255,255,0.16);position:relative;cursor:pointer;transition:background .2s;margin:0}' +
      '#cxCfgPanel input[type=checkbox]::after{content:"";position:absolute;left:2px;top:2px;width:17px;height:17px;border-radius:50%;background:#dadade;transition:left .2s,background .2s}' +
      '#cxCfgPanel input[type=checkbox]:checked{background:#fafafa}' +
      '#cxCfgPanel input[type=checkbox]:checked::after{left:21px;background:#0a0a0a}' +
      '#cxCfgPanel .btns{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}' +
      '#cxCfgPanel button{background:#fafafa;border:1px solid #fafafa;color:#0a0a0a;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:13px;font-weight:600;transition:all .15s}' +
      '#cxCfgPanel button:hover{background:#fff;box-shadow:0 0 0 3px rgba(255,255,255,0.12)}' +
      '#cxCfgPanel button:active{transform:scale(0.98)}' +
      '#cxCfgPanel button.ghost{background:transparent;color:#e4e4e7;border:1px solid rgba(255,255,255,0.22);font-weight:400}' +
      '#cxCfgPanel button.ghost:hover{background:rgba(255,255,255,0.09);box-shadow:none}' +
      '#cxCfgPanel button#cfgClose{background:transparent;color:#d4d4d8;border:none;box-shadow:none;font-size:20px;font-weight:400;line-height:1;padding:2px 6px;border-radius:6px}' +
      '#cxCfgPanel button#cfgClose:hover{background:rgba(255,255,255,0.14);transform:none}';
    document.head.appendChild(style);
    document.body.appendChild(logPanel);
    log('刷课助手 v' + scriptVersion() + ' 已加载(看这一行确认版本)');
    document.getElementById('cxCfgBtn').addEventListener('click', showConfigUI);
    document.getElementById('cxRunBtn').addEventListener('click', togglePause);
    // 展开/收起日志(小按钮,表头其余区域留给拖拽)
    document.getElementById('cxToggleBtn').addEventListener('click', () => {
      const logsEl = document.getElementById('cxLogs');
      const hidden = logsEl.style.display === 'none';
      logsEl.style.display = hidden ? '' : 'none';
      document.getElementById('cxToggleBtn').textContent = hidden ? '▼' : '▲';
    });
    // 表头拖拽移动面板(按住表头空白处拖动;按钮区域不触发拖拽)
    const titleEl = document.getElementById('cxTitle');
    titleEl.addEventListener('mousedown', (e) => {
      if (e.target.closest('#cxRunBtn, #cxToggleBtn, #cxCfgBtn')) return;
      e.preventDefault();
      const rect = logPanel.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      logPanel.style.left = rect.left + 'px';
      logPanel.style.top = rect.top + 'px';
      logPanel.style.right = 'auto';
      logPanel.style.bottom = 'auto';
      const onMove = (ev) => {
        logPanel.style.left = (rect.left + ev.clientX - startX) + 'px';
        logPanel.style.top = (rect.top + ev.clientY - startY) + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    // 首次启动引导(显示在日志区顶部,滚动可见)
    if (logLines.length === 0) {
      logLines.push({ line: '💡 打开课程章节页即自动开始挂机(无需任何操作)', level: 'info' });
      logLines.push({ line: '⚙ 设置(每项都有说明) | 「开始/停止」控制挂机 | ▼ 展开收起日志', level: 'info' });
      logLines.push({ line: '🤖 自动做题:请点 ⚙ → 勾选 AI 答题并填写 DeepSeek API Key', level: 'warn' });
    }
    renderLogs();
    // 统计栏每秒刷新(任务点进度 / 已答题数 / 运行时长)
    setInterval(() => {
      const j = document.getElementById('cxStatJobs');
      const a = document.getElementById('cxStatAns');
      const t = document.getElementById('cxStatTime');
      if (j) j.textContent = STATS.jobsTotal ? (STATS.jobsDone + '/' + STATS.jobsTotal) : '—';
      if (a) a.textContent = String(STATS.answered);
      if (t) t.textContent = STATS.startedAt ? fmtDur(Date.now() - STATS.startedAt) : '—';
    }, 1000);
  }

  let PAUSED = false;
  function togglePause() {
    PAUSED = !PAUSED;
    setStatus(PAUSED ? '已暂停' : '工作中');
    log(PAUSED ? '⏸ 已暂停挂机(当前任务完成后不再继续,点「开始」恢复)' : '▶ 已恢复挂机', PAUSED ? 'warn' : 'ok');
  }

  function showConfigUI() {
    const existing = document.getElementById('cxCfgPanel');
    if (existing) { existing.remove(); return; }
    const panel = document.createElement('div');
    panel.id = 'cxCfgPanel';
    panel.innerHTML =
      '<div class="cfgHead">⚙ 设置<small>改完记得点右下「保存」</small><button id="cfgClose" type="button" title="关闭">×</button></div>' +
      '<div class="cfgBody">' +
      '<div class="sec">🎬 播放与节奏</div>' +
      '<div class="field"><div class="row"><div class="label">🎬 视频倍速</div></div>' +
        '<input id="cfgSpeed" type="number" step="0.25" min="1" max="2" value="' + CONFIG.speed + '">' +
        '<div class="hint">默认 2x(最快);1 = 原速最安全,2x 被检测风险最高,自行权衡</div></div>' +
      '<div class="field"><div class="row"><div class="label">⏱ 每日刷课上限(分钟)</div></div>' +
        '<input id="cfgDaily" type="number" step="30" min="0" max="1440" value="' + CONFIG.dailyLimitMinutes + '">' +
        '<div class="hint">0 = 不限时长(当前默认);设正数则刷满该时长自动停止,第二天恢复。防"一天刷完"的异常曲线时可设 240</div></div>' +
      '<div class="sec">🤖 AI 答题 · 网页版(免 Key,优先)</div>' +
      '<div class="field"><div class="row"><div class="label">🌐 网页 AI 答题</div>' +
        '<input id="cfgWebAI" type="checkbox" ' + (CONFIG.webAiEnabled ? 'checked' : '') + '></div>' +
        '<div class="hint">勾选后不再走 API:脚本打开 AI 网页、把题目发过去、自动填入并发送、再把回答抓回来。需要同时安装「学习通网页AI桥」脚本(仓库同名文件),并已在该网站登录</div></div>' +
      '<div class="field"><div class="row"><div class="label">🔗 网页 AI 地址</div></div>' +
        '<input id="cfgWebAiUrl" type="text" value="' + CONFIG.webAiUrl + '">' +
        '<button id="cfgOpenWebAI" type="button" class="ghost" style="margin-top:6px">🔗 打开并连接网页 AI</button>' +
        '<div class="hint">DeepSeek / Kimi / 豆包 / ChatGPT 等网页版都可以。换站点时改这里的地址,并确认桥脚本的 @match 覆盖该域名。浏览器可能拦截弹窗,点上面按钮(用户点击)即可放行</div></div>' +
      '<div class="sec">🤖 AI 答题 · API 方式</div>' +
      '<div class="field"><div class="row"><div class="label">🤖 启用 AI 答题</div>' +
        '<input id="cfgAI" type="checkbox" ' + (CONFIG.aiEnabled ? 'checked' : '') + '></div>' +
        '<div class="hint">开启后,网页 AI 和题库都查不到的题目交给大模型自动作答(单选/判断接近 100%)。需在下方填写 API Key</div></div>' +
      '<div class="field"><div class="row"><div class="label">🏢 AI 平台</div></div>' +
        '<select id="cfgProvider">' +
        '<option value="deepseek">DeepSeek(推荐)</option>' +
        '<option value="siliconflow">硅基流动(注册送额度)</option>' +
        '<option value="minimax">MiniMax</option>' +
        '<option value="zhipu">智谱 AI</option>' +
        '<option value="qwen">通义千问</option>' +
        '<option value="kimi">Kimi(月之暗面)</option>' +
        '<option value="openai">OpenAI 官方</option>' +
        '<option value="custom">其他 / 自定义</option>' +
        '</select>' +
        '<div class="hint">选好平台后,下面的模型名和接口地址会自动填好,你只需填 Key。选"其他/自定义"时手动填下面两格</div></div>' +
      '<div class="field"><div class="row"><div class="label">🔑 API Key</div></div>' +
        '<input id="cfgAIKey" type="password" placeholder="sk-..." value="' + CONFIG.aiKey + '">' +
        '<div class="hint">到所选平台的官网注册并创建 API Key(sk- 开头)。只保存在你本机浏览器,不会上传;各平台注册地址见仓库 docs/get-api-key.md</div></div>' +
      '<div class="field"><div class="row"><div class="label">🧠 AI 模型</div></div>' +
        '<input id="cfgAIModel" type="text" list="cxModelList" value="' + CONFIG.aiModel + '">' +
        '<datalist id="cxModelList"></datalist>' +
        '<button id="cfgFetchModels" type="button" class="ghost" style="margin-top:6px">📋 自动获取模型列表</button>' +
        '<div class="hint">先填好上方 Key 和接口地址,再点按钮:自动拉取该平台的可用模型,点输入框即可选择,无需手动抄模型名。拉取失败就手动填(各平台模型名见仓库 docs/get-api-key.md)</div></div>' +
      '<div class="field"><div class="row"><div class="label">🌐 接口地址</div></div>' +
        '<input id="cfgAIUrl" type="text" value="' + CONFIG.aiUrl + '">' +
        '<div class="hint">OpenAI 兼容接口地址(以 /chat/completions 结尾)。默认 DeepSeek;MiniMax、智谱、硅基流动等平台的地址见仓库 docs/get-api-key.md</div></div>' +
      '<div class="sec">🛡 安全与拟人</div>' +
      '<div class="field"><div class="row"><div class="label">🎭 故意答错率(%)</div></div>' +
        '<input id="cfgErrRate" type="number" step="1" min="0" max="20" value="' + Math.round(CONFIG.deliberateErrorRate * 100) + '">' +
        '<div class="hint">拟人化:真人不会全对。填 8 = 8% 概率故意答错(判断题反着点、单选题点错项);填 0 关闭;多选不受影响</div></div>' +
      '<div class="field"><div class="row"><div class="label">📤 自动提交测验(正确率 ≥ 60% 才交)</div>' +
        '<input id="cfgSubmit" type="checkbox" ' + (CONFIG.autoSubmit ? 'checked' : '') + '></div>' +
        '<div class="hint">达标才自动提交;不足则暂存不交(不乱交卷),你可以回该章重做</div></div>' +
      '<div class="sec">🔧 其他</div>' +
      '<div class="field"><div class="row"><div class="label">📖 自动切章</div>' +
        '<input id="cfgJump" type="checkbox" ' + (CONFIG.autoJump ? 'checked' : '') + '></div>' +
        '<div class="hint">本章任务点全部完成后,自动进入下一章继续刷</div></div>' +
      '<div class="field"><div class="row"><div class="label">📡 状态上报(调试用)</div></div>' +
        '<input id="cfgReport" type="text" placeholder="http://127.0.0.1:8790/report" value="' + CONFIG.reportUrl + '">' +
        '<div class="hint">留空 = 关闭。填入本机监听地址后,脚本会把当前页面状态(视频进度/任务点/题目容器/最近日志)定时推过去,方便本机程序或 AI 直接读真实状态。只发往你自己填的地址,不经过任何第三方服务器</div></div>' +
      '<div class="field"><div class="row"><div class="label">📋 导出已收集题目</div>' +
        '<button id="cfgExport" type="button" class="ghost">复制题目数据</button></div>' +
        '<div class="hint">把做过的所有题目(题干+选项+答案)复制到剪贴板,可发给 AI 整理成考前手册;也可以拿去做题库备份</div></div>' +
      '<div class="btns"><button id="cfgSave" type="button">💾 保存</button></div>' +
      '</div>';
    document.body.appendChild(panel);
    document.getElementById('cfgSave').addEventListener('click', () => {
      CONFIG.speed = parseFloat(document.getElementById('cfgSpeed').value) || 1;
      if (CONFIG.speed < 1) CONFIG.speed = 1;
      if (CONFIG.speed > 2) CONFIG.speed = 2;
      CONFIG.aiEnabled = document.getElementById('cfgAI').checked;
      CONFIG.aiKey = document.getElementById('cfgAIKey').value.trim();
      CONFIG.aiModel = document.getElementById('cfgAIModel').value.trim() || 'deepseek-reasoner';
      CONFIG.aiUrl = document.getElementById('cfgAIUrl').value.trim() || 'https://api.deepseek.com/v1/chat/completions';
      CONFIG.webAiEnabled = document.getElementById('cfgWebAI').checked;
      CONFIG.webAiUrl = document.getElementById('cfgWebAiUrl').value.trim() || 'https://chat.deepseek.com/';
      CONFIG.deliberateErrorRate = (parseFloat(document.getElementById('cfgErrRate').value) || 0) / 100;
      CONFIG.dailyLimitMinutes = parseFloat(document.getElementById('cfgDaily').value) || 0;
      CONFIG.autoSubmit = document.getElementById('cfgSubmit').checked;
      CONFIG.autoJump = document.getElementById('cfgJump').checked;
      CONFIG.reportUrl = document.getElementById('cfgReport').value.trim();
      saveConfig(CONFIG);
      log('配置已保存(倍速 ' + CONFIG.speed + 'x, AI ' + (CONFIG.aiEnabled ? '开' : '关') + ')', 'ok');
      panel.remove();
    });
    document.getElementById('cfgClose').addEventListener('click', () => panel.remove());
    document.getElementById('cfgExport').addEventListener('click', exportQuestions);
    // 打开网页 AI:必须由用户点击触发,否则浏览器会当作弹窗拦截
    document.getElementById('cfgOpenWebAI').addEventListener('click', () => {
      const w = openWebAI();
      if (w) log('🔗 已打开网页 AI,请确认已登录;连接成功会显示「网页 AI 已连接」', 'ok');
      else log('弹窗被浏览器拦截,请在地址栏右侧允许本站弹窗后重试', 'warn');
    });
    // 平台预设:选平台自动填接口地址和默认模型
    const PROVIDERS = {
      deepseek: { url: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-reasoner' },
      siliconflow: { url: 'https://api.siliconflow.cn/v1/chat/completions', model: 'deepseek-ai/DeepSeek-V3' },
      minimax: { url: 'https://api.minimaxi.com/v1/chat/completions', model: 'MiniMax-Text-01' },
      zhipu: { url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4-plus' },
      qwen: { url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-plus' },
      kimi: { url: 'https://api.moonshot.cn/v1/chat/completions', model: 'moonshot-v1-8k' },
      openai: { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
      custom: { url: '', model: '' }
    };
    document.getElementById('cfgProvider').addEventListener('change', (e) => {
      const p = PROVIDERS[e.target.value] || PROVIDERS.custom;
      document.getElementById('cfgAIUrl').value = p.url;
      document.getElementById('cfgAIModel').value = p.model;
    });
    // 自动拉取模型列表:调 OpenAI 兼容的 /models 接口,填充下拉候选
    document.getElementById('cfgFetchModels').addEventListener('click', async () => {
      const base = document.getElementById('cfgAIUrl').value.trim();
      const key = document.getElementById('cfgAIKey').value.trim();
      const btn = document.getElementById('cfgFetchModels');
      if (!base) { log('请先填写 AI 接口地址', 'warn'); return; }
      const modelsUrl = base.replace(/\/chat\/completions\/?$/, '/models');
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = '拉取中...';
      try {
        const text = await cxFetch(modelsUrl, { method: 'GET', headers: { 'Authorization': 'Bearer ' + key }, timeout: 15000 });
        const obj = JSON.parse(text);
        const list = (obj.data || []).map((m) => m.id).filter(Boolean);
        if (list.length) {
          const dl = document.getElementById('cxModelList');
          dl.innerHTML = list.map((id) => '<option value="' + String(id).replace(/"/g, '') + '"></option>').join('');
          log('✅ 已拉取 ' + list.length + ' 个模型:点输入框右侧箭头选择', 'ok');
        } else {
          log('该平台未返回模型列表,请手动填写', 'warn');
        }
      } catch (e) {
        log('拉取失败(该平台可能不支持 /models 接口),请手动填写模型名', 'warn');
      }
      btn.disabled = false;
      btn.textContent = old;
    });
  }

  /* ==================== 答案通道 ==================== */
  // 免费题库站(协议参考社区成熟脚本,无 token 时部分接口仍返回免费额度答案)
  async function channelTikuHai(q) {
    try {
      const res = JSON.parse(await cxFetch('http://api.tikuhai.com/search', {
        method: 'POST',
        data: JSON.stringify({ question: q.question, type: q.type }),
        headers: { 'Content-Type': 'application/json' }
      }));
      if (res.code === -1) return { form: '题库海', answer: String(res.msg || '').split('#') };
      const a = (res.data && res.data.answer) || res.msg || '';
      return { form: '题库海', answer: String(a).split('#') };
    } catch (e) { return { form: '题库海', answer: [] }; }
  }
  async function channelYizhi(q) {
    try {
      const ip = Array.from({ length: 4 }, () => Math.floor(255 * Math.random())).join('.');
      const res = JSON.parse(await cxFetch('http://cx.icodef.com/wyn-nb?v=4', {
        method: 'POST',
        data: JSON.stringify({ question: q.question }),
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, 'X-Real-IP': ip }
      }));
      if (res.code !== 1) return { form: '一之题库', answer: [] };
      let data = String(res.data || '').replace(/javascript:void\(0\);/g, '').replace(/\n/g, '').trim();
      if (/(叛逆|公众号|李恒雅|一之)/.test(data)) return { form: '一之题库', answer: [] };
      return { form: '一之题库', answer: data.split('#') };
    } catch (e) { return { form: '一之题库', answer: [] }; }
  }
  async function channelYanxi(q) {
    try {
      const res = JSON.parse(await cxFetch('https://tk.enncy.cn/query', {
        method: 'POST',
        data: JSON.stringify({ title: q.question }),
        headers: { 'Content-Type': 'application/json' }
      }));
      if (res.code !== 1) return { form: '言溪题库', answer: [] };
      return { form: '言溪题库', answer: String(res.data.answer || '').split('#') };
    } catch (e) { return { form: '言溪题库', answer: [] }; }
  }
  async function channelMuketool(q) {
    try {
      const res = JSON.parse(await cxFetch('https://api.muketool.com/cx/v2/query', {
        method: 'POST',
        data: JSON.stringify({ question: q.question, type: parseInt(q.type, 10) || 0 }),
        headers: { 'Content-Type': 'application/json' }
      }));
      if (res.code !== 1) return { form: '木课工具', answer: [] };
      return { form: '木课工具', answer: String(res.data || '').split('#') };
    } catch (e) { return { form: '木课工具', answer: [] }; }
  }
  let aiFailCount = 0;
  let aiCooldownUntil = 0;
  let aiCooldownWarned = false;
  function channelAI(q) {
    return new Promise((resolve) => {
      if (Date.now() < aiCooldownUntil) {
        if (!aiCooldownWarned) {
          aiCooldownWarned = true;
          log('AI 通道冷却中(连续失败后暂停 10 分钟),请检查 ⚙ 里的 Key/平台/接口地址/模型', 'warn');
        }
        resolve({ form: 'AI(冷却中)', answer: [] });
        return;
      }
      const prompt = buildAIPrompt(q);
      const data = JSON.stringify({
        model: CONFIG.aiModel,
        messages: [
          { role: 'system', content: '你是答题助手。回复的第一个字符必须是最终答案,严禁输出思考过程、解释、重复题目或任何多余内容。' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 300
      });
      const done = (answer, errLog) => {
        if (errLog) {
          aiFailCount++;
          log(`AI 请求失败(${aiFailCount}/3): ${errLog}`, 'err');
          if (aiFailCount >= 3) {
            aiCooldownUntil = Date.now() + 10 * 60 * 1000;
            aiCooldownWarned = false;
            aiFailCount = 0;
            log('AI 通道连续失败 3 次,暂停 10 分钟后自动重试。常见原因:Key 错误/余额不足/接口地址或模型名填错', 'warn');
          }
        } else {
          aiFailCount = 0;
          aiCooldownUntil = 0;
          aiCooldownWarned = false;
        }
        resolve({ form: 'AI', answer });
      };
      GM_xmlhttpRequest({
        method: 'POST',
        url: CONFIG.aiUrl,
        data,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CONFIG.aiKey },
        timeout: 30000,
        onload: (res) => {
          try {
            if (res.status !== 200) {
              done([], `HTTP ${res.status}: ${String(res.responseText).slice(0, 180)}`);
              return;
            }
            const obj = JSON.parse(res.responseText);
            let content = ((obj.choices && obj.choices[0] && obj.choices[0].message && obj.choices[0].message.content) || '').trim();
            // 推理模型(deepseek-reasoner)有时把结论放在 reasoning_content、content 留空——取推理末尾作答案
            if (!content) {
              const rc = ((obj.choices && obj.choices[0] && obj.choices[0].message && obj.choices[0].message.reasoning_content) || '').trim();
              content = rc.slice(-300);
            }
            if (!content) { done([], '返回内容为空'); return; }
            done(parseAIAnswer(q.type, content));
          } catch (e) {
            done([], '解析失败: ' + (e.message || e));
          }
        },
        onerror: () => { done([], '网络错误'); },
        ontimeout: () => { done([], '超时(30s)'); }
      });
    });
  }

  function buildAIPrompt(q) {
    const opts = (q.options || []).map((o, i) => `${String.fromCharCode(65 + i)}.${o}`).join(' ');
    const base = '你是一位专业的学习辅导老师,知识面广。规则:你的回复必须以最终答案开头(第一个字符就是答案),只输出答案本身,不要任何解释、思考或多余文字。';
    switch (String(q.type)) {
      case '3': return `${base}\n判断题。题目:${q.question}\n只输出"正确"或"错误"。`;
      case '1': return `${base}\n多选题。题目:${q.question}\n选项:${opts}\n只输出所有正确选项的字母组合(如 ABD)。`;
      case '2': return `${base}\n填空题。题目:${q.question}\n直接输出答案,多个空用 | 分隔。`;
      case '0': return `${base}\n单选题。题目:${q.question}\n选项:${opts}\n只输出正确选项的字母(如 C)。`;
      default: return `${base}\n简答题。题目:${q.question}\n输出完整答案:若题目要求字数(例如"不少于800字""800字以上"),必须写够该字数;直接给正文,不要"以下是""简答如下"之类的开场白,也不要写提纲。`;
    }
  }

  function parseAIAnswer(type, content) {
    content = String(content).trim();
    switch (String(type)) {
      case '3': return [/正确|对|√|true|是/i.test(content) ? '正确' : '错误'];
      case '1': { const m = content.match(/[A-Ha-h]{1,8}/); return m ? m[0].toUpperCase().split('') : [content]; }
      case '0': { const m = content.match(/[A-Ha-h]/); return m ? [m[0].toUpperCase()] : [content]; }
      case '2': return content.split('|').map((s) => s.trim()).filter(Boolean);
      default: return [content];
    }
  }

  /* ==================== 网页 AI 通道(免 API Key) ==================== */
  // 同源策略挡住了跨域 DOM,所以不能"打开网页直接 querySelector 抓答案"。
  // 做法:window.open 打开 AI 网站 → postMessage 把题目发过去 → AI 侧的「学习通网页AI桥」
  // 脚本负责填入输入框、点发送、等回答稳定,再把文本 postMessage 回来。
  let webAiWin = null;
  let webAiReady = false;
  let webAiSeq = 0;
  let webAiWaiters = [];

  function webAiOrigin() {
    try { return new URL(CONFIG.webAiUrl).origin; } catch (e) { return '*'; }
  }

  function openWebAI() {
    try {
      if (webAiWin && !webAiWin.closed) { webAiWin.focus(); return webAiWin; }
      webAiReady = false;
      webAiWin = window.open(CONFIG.webAiUrl, 'cx-web-ai', 'popup=yes,width=560,height=820');
      return webAiWin;
    } catch (e) { return null; }
  }

  // AI 页面加载完成后会主动发 CX_HELLO,这里据此判定"通道就绪"(也用于页面刷新后重新挂接)
  function onWebAiMessage(e) {
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.cxType === 'CX_HELLO') {
      webAiWin = e.source || webAiWin;
      if (!webAiReady) {
        webAiReady = true;
        log('🔗 网页 AI 已连接(可开始答题)', 'ok');
      }
      webAiWaiters.splice(0).forEach((fn) => fn());
    }
  }
  window.addEventListener('message', onWebAiMessage);

  function waitWebAiReady(timeoutMs = 15000) {
    if (webAiReady) return Promise.resolve(true);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), timeoutMs);
      webAiWaiters.push(() => { clearTimeout(t); resolve(true); });
    });
  }

  function buildAskText(q) {
    const typeName = ({ '0': '单选题', '1': '多选题', '2': '填空题', '3': '判断题' })[String(q.type)] || '简答题';
    const opts = (q.options || []).map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n');
    return [
      `请回答下面这道${typeName}。要求:第一行只写答案,不要解释、不要复述题目。`,
      '',
      `题目:${q.question}`,
      opts ? `选项:\n${opts}` : '',
      '',
      '答案格式:单选题写字母(如 C);多选题写字母组合(如 ABD);判断题写「正确」或「错误」;填空题多个空用 | 分隔。'
    ].filter(Boolean).join('\n');
  }

  async function askWebAI(text, timeoutMs) {
    let win = webAiWin && !webAiWin.closed ? webAiWin : null;
    if (!win) {
      win = window.open(CONFIG.webAiUrl, 'cx-web-ai', 'popup=yes,width=560,height=820');
      webAiReady = false;
    }
    if (!win) return { text: '', error: '弹窗被拦截:请点 ⚙ →「打开并连接网页 AI」后再试' };

    await waitWebAiReady(15000);

    const cxId = 'cx' + Date.now().toString(36) + (++webAiSeq);
    return new Promise((resolve) => {
      let done = false;
      const finish = (r) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        resolve(r);
      };
      const onMsg = (e) => {
        const d = e.data;
        if (!d || d.cxType !== 'CX_ANSWER' || d.cxId !== cxId) return;
        finish({ text: String(d.text || ''), error: d.error || '' });
      };
      const timer = setTimeout(() => finish({ text: '', error: `等待网页 AI 回复超时(${Math.round(timeoutMs / 1000)}s)` }), timeoutMs);
      window.addEventListener('message', onMsg);
      try { win.postMessage({ cxType: 'CX_ASK', cxId, text }, webAiOrigin()); }
      catch (e) { finish({ text: '', error: '消息发送失败: ' + (e.message || e) }); }
    });
  }

  async function channelWebAI(q) {
    const timeout = (CONFIG.webAiTimeout || 60) * 1000;
    const r = await askWebAI(buildAskText(q), timeout);
    if (r.error) { log('网页 AI: ' + r.error, 'warn'); return { form: '网页AI', answer: [] }; }
    const raw = String(r.text || '').trim();
    if (!raw) { log('网页 AI 返回内容为空', 'warn'); return { form: '网页AI', answer: [] }; }
    log('网页 AI 原始回复: ' + raw.replace(/\s+/g, ' ').slice(0, 80), 'info');
    return { form: '网页AI', answer: parseAIAnswer(q.type, raw) };
  }

  // 答案通道:AI 优先(准确率最高),免费题库并行兜底
  function filterAnswers(arr) {
    return (arr || []).map(String).map(clean)
      .filter((a) => a && a !== '暂无答案' && a !== '略' && !/(付费|购买|卡密|升级|公众号|扫码|微信)/.test(a));
  }
  let aiKeyWarned = false;
  async function getAnswers(q) {
    if (CONFIG.webAiEnabled) {
      const r = await channelWebAI(q);
      const ans = filterAnswers(r.answer);
      if (ans.length) {
        STATS.answered++;
        log(`[${r.form}] 查到答案: ${ans.join(' / ')}`, 'ok');
        return ans;
      }
    } else if (CONFIG.aiEnabled && CONFIG.aiKey) {
      const r = await channelAI(q);
      const ans = filterAnswers(r.answer);
      if (ans.length) {
        STATS.answered++;
        log(`[AI] 查到答案: ${ans.join(' / ')}`, 'ok');
        return ans;
      }
    } else if (!aiKeyWarned) {
      aiKeyWarned = true;
      log('⚠ 未启用 AI 答题:点面板 ⚙ → 勾选「网页 AI 答题」或「AI 答题」并配置,否则无法自动做题', 'warn');
    }
    const results = CONFIG.useTiku
      ? await Promise.all([channelTikuHai(q), channelYizhi(q), channelYanxi(q), channelMuketool(q)])
      : [];
    for (const r of results) {
      const ans = filterAnswers(r.answer);
      if (ans.length) {
        STATS.answered++;
        log(`[${r.form}] 查到答案: ${ans.join(' / ')}`, 'ok');
        return ans;
      }
    }
    log('未查到答案' + ((!CONFIG.aiEnabled || !CONFIG.aiKey) ? '(原因:AI 答题未启用,请点 ⚙ 配置)' : ''), 'warn');
    return [];
  }

  /* ==================== 题目提取 ==================== */
  // 章节测验(.TiMu 容器)
  function extractQuizQuestion(el) {
    try {
      const label = el.querySelector('.clearfix .fontLabel');
      const titleEl = label || el.querySelector('.Zy_TItle');
      const text = cl(clean(titleEl ? titleEl.innerHTML : ''));
      if (!text) return null;
      const typeInput = el.querySelector('input[name^=answertype]');
      const type = typeInput ? typeInput.value : '0';
      // 选项:多种结构兜底(学习通不同版本选项 DOM 不同)
      let options = Array.from(el.querySelectorAll('ul li .after')).map((o) => clean(o.innerHTML)).filter(Boolean);
      if (!options.length) options = Array.from(el.querySelectorAll('ul li')).map((o) => clean(o.innerHTML)).filter(Boolean);
      if (!options.length) options = Array.from(el.querySelectorAll('.answerBg, .num_option, .after')).map((o) => clean(o.innerHTML)).filter(Boolean);
      return { question: text, options, type };
    } catch (e) { return null; }
  }
  // 作业页(.questionLi 容器)
  function extractWorkQuestion(el) {
    try {
      const mark = el.querySelector('.mark_name');
      let html = mark ? mark.innerHTML : '';
      const idx = html.indexOf('</span>');
      const text = cl(clean(idx >= 0 ? html.substring(idx + 7) : html));
      if (!text) return null;
      const typeInput = el.querySelector('input[name^=answertype]');
      const type = typeInput ? typeInput.value : '0';
      const options = Array.from(el.querySelectorAll('.answer_p')).map((o) => clean(o.innerHTML));
      return { question: text, options, type };
    } catch (e) { return null; }
  }

  /* ==================== 自动作答 ==================== */
  function matchAnswer(answerArr, options) {
    const idx = [];
    const opts = (options || []).map((o) => cl(clean(String(o))));
    for (const raw of answerArr) {
      const a = cl(clean(String(raw)));
      if (!a) continue;
      const letters = /^[A-Ha-h]+$/.test(a) ? a.toUpperCase().split('') : [];
      for (let i = 0; i < opts.length; i++) {
        if (idx.includes(i)) continue;
        const letter = String.fromCharCode(65 + i);
        const opt = opts[i];
        if (!opt) continue;
        if (letters.includes(letter)) { idx.push(i); continue; }
        if (a.startsWith(letter + '.') || a.startsWith(letter + '、') || a.startsWith(letter + ':') || a.startsWith(letter + ')')) { idx.push(i); continue; }
        if (a.length >= 2 && (opt.includes(a) || a.includes(opt))) { idx.push(i); continue; }
        if (opt === a) idx.push(i);
      }
    }
    return idx;
  }

  // 清空当前已勾选的选项(重做时避免旧答案残留叠加)
  function clearCurrent(el) {
    el.querySelectorAll('input[type=radio], input[type=checkbox]').forEach((inp) => {
      if (inp.checked) { try { inp.click(); } catch (e) { /* ignore */ } }
    });
  }

  function setQuizAnswer(answerArr, q, el, win) {
    const $$ = (sel) => Array.from(el.querySelectorAll(sel));
    switch (String(q.type)) {
      case '0':
      case '1': {
        let idx = matchAnswer(answerArr, q.options);
        if (!idx.length) return false;
        // 拟人:单选题按配置概率故意点错(多选不故意错)
        if (String(q.type) === '0' && CONFIG.deliberateErrorRate > 0 && Math.random() < CONFIG.deliberateErrorRate && q.options && q.options.length > 1) {
          const wrongIdx = [];
          for (let i = 0; i < q.options.length; i++) if (!idx.includes(i)) wrongIdx.push(i);
          if (wrongIdx.length) {
            idx = [wrongIdx[Math.floor(Math.random() * wrongIdx.length)]];
            log('🎭 拟人模式:本题故意答错(配置概率)', 'info');
          }
        }
        clearCurrent(el);
        const lis = $$('ul li');
        if (lis.length) {
          lis.forEach((li, i) => {
            if (idx.includes(i)) {
              const input = li.querySelector('input[type=radio], input[type=checkbox]');
              try { if (input) input.click(); } catch (e) { /* ignore */ }
              try { li.click(); } catch (e) { /* ignore */ }
            }
          });
          return true;
        }
        // 兜底1:直接点第 idx 个选项控件
        const inputs = $$('input[type=radio], input[type=checkbox]');
        if (inputs.length) {
          idx.forEach((i) => { const inp = inputs[i]; if (inp) { try { inp.click(); } catch (e) { /* ignore */ } } });
          return true;
        }
        // 兜底2:点第 idx 个常见选项容器
        const optEls = $$('.answerBg, .num_option, .after, .ans-opt');
        if (optEls.length) {
          idx.forEach((i) => { const o = optEls[i]; if (o) { try { o.click(); } catch (e) { /* ignore */ } } });
          return true;
        }
        return false;
      }
      case '3': {
        const ans = String(answerArr[0] || '');
        const isTrue = /(^|[,|#])(True|true|正确|对|√|T|是)([,|#]|$)/.test(ans);
        const isFalse = /(^|[,|#])(False|false|错误|错|×|F|否)([,|#]|$)/.test(ans);
        if (!isTrue && !isFalse) return false;
        let wantTrue = isTrue, wantFalse = isFalse;
        if (CONFIG.deliberateErrorRate > 0 && Math.random() < CONFIG.deliberateErrorRate) {
          wantTrue = isFalse; wantFalse = isTrue;
          log('🎭 拟人模式:本题故意答错(配置概率)', 'info');
        }
        clearCurrent(el);
        $$('ul li').forEach((li) => {
          const input = li.querySelector('input');
          const val = input ? String(input.value) : '';
          if ((wantTrue && val === 'true') || (wantFalse && val === 'false')) {
            try { li.click(); } catch (e) { /* ignore */ }
          }
        });
        return true;
      }
      case '2':
      case '4':
      case '5':
      case '6':
      case '7':
      case '9': {
        return fillTextAnswer(el, answerArr, win);
      }
      default:
        return false;
    }
  }

  // ===== 文本类(填空/简答)填写:兼容 UEditor 等富文本编辑器(正文在 iframe 里) =====
  // 关键:UEditor 的正文是 iframe 内的 contenteditable body,顶层只有隐藏 textarea,
  // 直接给顶层 textarea 赋值用户看不到任何东西。这里必须逐层找、写完回读校验。
  function textValueOf(node) {
    try {
      if (!node) return '';
      if (typeof node.value === 'string' && node.value) return node.value;
      return (node.innerText || node.textContent || '').replace(/\s+/g, '');
    } catch (e) { return ''; }
  }
  function isRichHost(node, frame) {
    try {
      if (node && node.isContentEditable) return true;
      const tag = frame ? (frame.className || '') + ' ' + (frame.id || '') : '';
      return /edui|ueditor|cke|ql-editor|w-e-text/i.test(tag);
    } catch (e) { return false; }
  }
  function collectTextTargets(el) {
    const rich = [];   // 富文本(iframe body / contenteditable)
    const plain = [];  // textarea / 单行 input
    const seen = new Set();
    const pushRich = (doc, node) => {
      if (!node || seen.has(node)) return;
      seen.add(node);
      rich.push({ kind: 'rich', doc, node });
    };
    const scanFrames = (root) => Array.from(root.querySelectorAll('iframe')).forEach((f) => {
      try {
        const doc = f.contentDocument;
        if (!doc || !doc.body) return;
        if (isRichHost(doc.body, f)) pushRich(doc, doc.body);
      } catch (e) { /* 跨域跳过 */ }
    });
    scanFrames(el);
    Array.from(el.querySelectorAll('[contenteditable="true"], [contenteditable=""]')).forEach((n) => pushRich(n.ownerDocument, n));
    // 有的页面把编辑器渲染在题目容器之外 → 扩大到整页再找一次
    if (!rich.length) {
      scanFrames(document);
      Array.from(document.querySelectorAll('[contenteditable="true"], .edui-body, .ql-editor, .w-e-text, .cke_editable')).forEach((n) => pushRich(n.ownerDocument, n));
    }
    const pushPlain = (n) => plain.push({
      kind: (n.tagName || '').toLowerCase() === 'textarea' ? 'textarea' : 'input',
      doc: n.ownerDocument,
      node: n,
      hidden: n.offsetParent === null
    });
    Array.from(el.querySelectorAll('textarea')).forEach(pushPlain);
    Array.from(el.querySelectorAll('input[type=text], input:not([type])')).forEach(pushPlain);
    if (!plain.length) {
      Array.from(document.querySelectorAll('textarea')).forEach(pushPlain);
      Array.from(document.querySelectorAll('.questionLi input[type=text], .TiMu input[type=text]')).forEach(pushPlain);
    }
    return { rich, plain };
  }
  function writeRich(t, text) {
    const { doc, node } = t;
    try { if (node.focus) node.focus(); } catch (e) { /* ignore */ }
    try {
      if (doc && doc.execCommand) {
        const sel = doc.getSelection ? doc.getSelection() : doc.defaultView.getSelection();
        const range = doc.createRange();
        range.selectNodeContents(node);
        sel.removeAllRanges();
        sel.addRange(range);
        doc.execCommand('delete', false, null);
        doc.execCommand('insertText', false, text);
      }
    } catch (e) { /* ignore */ }
    if (textValueOf(node).length < Math.min(6, text.length)) {
      try { node.textContent = text; } catch (e) { /* ignore */ }
    }
    try {
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
      node.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    } catch (e) { /* ignore */ }
  }
  function stripTags(s) { return String(s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ''); }
  // UEditor 官方 API:能同步编辑器内部状态(提交时才带得走)
  function tryUE(win, text, need) {
    try {
      const UE = win && win.UE;
      if (!UE || !UE.instants) return false;
      return Object.keys(UE.instants).some((k) => {
        const ed = UE.instants[k];
        if (!ed || typeof ed.setContent !== 'function') return false;
        if (typeof ed.getContent === 'function') {
          const cur = stripTags(ed.getContent());
          if (cur.length >= need(text) && cur.indexOf(text.slice(0, 6)) >= 0) return true;  // 已经写好了
        }
        ed.setContent(text);
        return typeof ed.getContent === 'function' && stripTags(ed.getContent()).length >= need(text);
      });
    } catch (e) { return false; }
  }
  function setPlain(t, val) {
    try {
      t.node.value = val;
      t.node.dispatchEvent(new Event('input', { bubbles: true }));
      t.node.dispatchEvent(new Event('change', { bubbles: true }));
      t.node.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    } catch (e) { /* ignore */ }
    return textValueOf(t.node).length >= Math.min(6, val.length);
  }
  function fillTextAnswer(el, answerArr, win) {
    const texts = (answerArr || []).map((a) => cl(clean(String(a == null ? '' : a)).replace(/^第.空[:：]?/, ''))).filter(Boolean);
    if (!texts.length) return false;
    const need = (t) => Math.min(6, t.length);

    // ① UEditor 官方 API 最优先(能同步编辑器内部状态,提交时带得走)
    if (tryUE(win, texts[0], need)) return true;

    const { rich, plain } = collectTextTargets(el);

    // ② 富文本容器注入(iframe body / contenteditable)
    for (const t of rich) {
      writeRich(t, texts[0]);
      if (textValueOf(t.node).length >= need(texts[0])) return true;
    }

    // ③ 可见文本框:多空填空逐框填,单框填整段
    const vis = plain.filter((t) => !t.hidden);
    if (vis.length > 1 && texts.length > 1) {
      let filled = 0;
      vis.forEach((t, i) => { if (setPlain(t, texts[i] != null ? texts[i] : texts[0])) filled++; });
      if (filled) return true;
    }
    for (const t of vis) {
      if (setPlain(t, texts[0])) return true;
    }

    // ④ 隐藏 textarea 兜底:只写值不算成功,必须 UE API 能回读确认
    for (const t of plain.filter((x) => x.hidden)) {
      setPlain(t, texts[0]);
      try {
        const name = t.node.getAttribute && t.node.getAttribute('name');
        if (name && win && win.UE && typeof win.UE.getEditor === 'function') {
          const ed = win.UE.getEditor(name);
          if (ed && typeof ed.setContent === 'function') {
            ed.setContent(texts[0]);
            if (stripTags(ed.getContent && ed.getContent()).length >= need(texts[0])) return true;
          }
        }
      } catch (e) { /* ignore */ }
    }
    return false;
  }

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = el.ownerDocument.defaultView.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function clickButtonByText(win, texts) {
    const nodes = win.document.querySelectorAll('button, .btn, a, .el-button, .jb_btn, input[type=button], input[type=submit]');
    for (const n of nodes) {
      const t = (n.textContent || n.value || '').trim();
      for (const kw of texts) {
        if (t && (t === kw || t.includes(kw))) {
          try { n.click(); } catch (e) { /* ignore */ }
          return true;
        }
      }
    }
    return false;
  }

  /* ==================== 字体加密解密(Canvas 字形对比法) ==================== */
  // 候选字符集:常用汉字 + 数字字母 + 常见符号(课程题目用字基本都在内)
  const COMMON_CHARS =
    '的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物实现加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处队南给色光门即保治北造百规热领七海口东导器压志世金增争济阶油思术极交受联什认六共权收证改清己美再采转更单风切打白教速花带安场身车例真务具万每目至达走积示议声报斗完类八离华名确才科张信马节话米整空元况今集温传土许步群广石记需段研界拉林律叫且究观越织装影算低持音众书布复容儿须际商非验连断深难近千周委素技备半办青省列习响约支般史感劳便团往酸历市克何除消构府称太准精值号率族维划选标写存候毛亲快效斯院查江型眼王按格养易置派层片始却专状育厂京识适属圆包火住调满县局照参红细引听该铁价严龙飞' +
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' +
    '，。、；：？！“”‘’（）《》〈〉【】[]{}·—…%＋－×÷＝√（）+-×÷=%/\\.,;:!?_*&#@' +
    '一二三四五六七八九十百千万亿年月日时分秒甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥';
  const FONT_NAME = 'cxfontdec';
  let _fontCanvas = null;
  let _fontCtx = null;

  function getFontCtx() {
    if (!_fontCanvas) {
      _fontCanvas = document.createElement('canvas');
      _fontCanvas.width = 32;
      _fontCanvas.height = 32;
      _fontCtx = _fontCanvas.getContext('2d');
    }
    return _fontCtx;
  }

  // 用解密字体渲染一个字符,返回二值化的字形指纹
  function glyphBits(ch) {
    const ctx = getFontCtx();
    ctx.clearRect(0, 0, 32, 32);
    ctx.font = '28px ' + FONT_NAME;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, 16, 17);
    const d = ctx.getImageData(0, 0, 32, 32).data;
    let s = '';
    for (let i = 3; i < d.length; i += 4) s += d[i] > 120 ? '1' : '0';
    return s;
  }

  function extractFontBase64(win) {
    const styles = win.document.querySelectorAll('style');
    for (const st of styles) {
      const t = st.textContent || '';
      if (t.includes('font-cxsecret') || t.includes('cxsecret')) {
        const m = t.match(/base64,([\w\W]+?)'/);
        if (m) return m[1];
        const m2 = t.match(/base64,([\w\W]+?)"/);
        if (m2) return m2[1];
      }
    }
    return null;
  }

  // 核心:学习通的加密字体内,把"真实字符"的字形映射到了错误码点。
  // 用同一字体渲染"候选常用字"和"乱码字符",字形指纹相同即为同一字符。
  async function decodeFont(win) {
    const b64 = extractFontBase64(win);
    if (!b64) {
      if (win.document.querySelector('.font-cxsecret')) log('未找到字体定义(可能为其他加密方式)', 'warn');
      return false;
    }
    try {
      const ff = new FontFace(FONT_NAME, 'url(data:font/ttf;base64,' + b64 + ')');
      document.fonts.add(ff);
      await ff.load();
    } catch (e) { log('加密字体加载失败: ' + (e.message || e), 'warn'); return false; }
    const els = Array.from(win.document.querySelectorAll('.font-cxsecret'));
    if (!els.length) return false;
    const targets = new Set();
    els.forEach((el) => { for (const ch of String(el.textContent || '')) targets.add(ch); });
    if (!targets.size) return false;
    const tHashes = new Map();
    for (const ch of targets) {
      try { tHashes.set(ch, glyphBits(ch)); } catch (e) { /* ignore */ }
    }
    if (!tHashes.size) return false;
    log(`🔓 字体解密: ${tHashes.size} 个乱码字符,正在对比常用字字形...`, 'info');
    const resolved = new Map();
    const start = Date.now();
    outer:
    for (let ci = 0; ci < COMMON_CHARS.length; ci++) {
      const ch = COMMON_CHARS[ci];
      if (resolved.size < tHashes.size) {
        const bits = glyphBits(ch);
        for (const [target, thash] of tHashes) {
          if (!resolved.has(target) && bits === thash) {
            resolved.set(target, ch);
            if (resolved.size >= tHashes.size) break outer;
          }
        }
      }
      if (Date.now() - start > 10000) { log('字体解密超时,部分字符可能未映射', 'warn'); break; }
    }
    if (!resolved.size) { log('字体解密未能匹配(可能含非常用字),跳过自动作答', 'warn'); return false; }
    els.forEach((el) => {
      let text = String(el.textContent || '');
      for (const [t, r] of resolved) text = text.split(t).join(r);
      el.textContent = text;
      el.classList.remove('font-cxsecret');
    });
    log(`🔓 字体解密完成,还原 ${resolved.size} 个字符`, 'ok');
    return true;
  }

  /* ==================== 视频弹题处理 ==================== */
  const QUIZ_SELECTORS = ['.TiMu', '.topic-item', '.ans-videoquiz', '.ans-topic', '#subtitle .TiMu', '.el-dialog .TiMu', '.popContent .TiMu', '.maskDiv .TiMu'];

  // 启发式:找"题干特征 + 2~8 个选项控件"的可见容器
  function heuristicFindQuiz(win) {
    let best = null;
    let bestLen = Infinity;
    let nodes;
    try { nodes = win.document.querySelectorAll('div, section, form, fieldset, ul'); } catch (e) { return null; }
    for (const el of nodes) {
      if (!isVisible(el)) continue;
      const t = String(el.textContent || '').trim();
      if (t.length < 8 || t.length > 900) continue;
      const nInputs = el.querySelectorAll('input[type=radio], input[type=checkbox]').length;
      const nLis = el.querySelectorAll('li').length;
      const optCount = nInputs || nLis;
      if (optCount < 2 || optCount > 8) continue;
      if (!/[?？]|（\s*）|\(\s*\)|__+/.test(t)) continue;
      if (t.length < bestLen) { bestLen = t.length; best = el; }
    }
    return best;
  }

  // 启发式提取:判断题(对/错双选项)与单选
  function extractHeuristicQuestion(el) {
    try {
      const optNodes = Array.from(el.querySelectorAll('li'));
      const opts = optNodes.map((li) => clean(li.textContent))
        .filter((t) => t && t.length < 80 && !/(提交|继续学习|回看|确定|下一题|上一题|提交中)/.test(t));
      let type = '0';
      // 判断题:两个选项,去掉"A、"这类前缀后是 对/错
      const norm = (t) => String(t).replace(/^[A-Ha-h][、.．:)\s]+/, '').trim();
      if (opts.length === 2 && /^(正确|对|√|错误|错|×)$/.test(norm(opts[0])) && /^(正确|对|√|错误|错|×)$/.test(norm(opts[1]))) type = '3';
      let text = String(el.textContent || '');
      for (const o of opts) text = text.split(o).join('');
      text = cl(clean(text)).replace(/[（(]\s*[)）]\s*$/, '').slice(0, 300);
      if (!text) return null;
      return { question: text, options: opts, type };
    } catch (e) { return null; }
  }

  // 启发式作答:判断题按语义点击,选择题按索引点击
  function setHeuristicAnswer(answerArr, q, el) {
    try {
      if (String(q.type) === '3') {
        const ans = String(answerArr[0] || '');
        let wantTrue = /正确|对|√|True|true|T|是/.test(ans);
        let wantFalse = /错误|错|×|False|false|F|否/.test(ans);
        if (!wantTrue && !wantFalse) return false;
        // 拟人:按配置概率故意答错(真人不会全对)
        if (CONFIG.deliberateErrorRate > 0 && Math.random() < CONFIG.deliberateErrorRate) {
          const t = wantTrue; wantTrue = wantFalse; wantFalse = t;
          log('🎭 拟人模式:本题故意答错(配置概率)', 'info');
        }
        const normOpt = (t) => String(t).replace(/^[A-Ha-h][、.．:)\s]+/, '').trim();
        const nodes = Array.from(el.querySelectorAll('li, label, .option, div, span, a'))
          .filter((n) => /^(正确|对|√|错误|错|×)$/.test(normOpt(clean(n.textContent))));
        for (const n of nodes) {
          const t = normOpt(clean(n.textContent));
          const isTrueOpt = /^(正确|对|√)$/.test(t);
          if ((wantTrue && isTrueOpt) || (wantFalse && !isTrueOpt)) {
            try { const inp = n.querySelector('input'); if (inp) inp.click(); } catch (e) { /* ignore */ }
            try { n.click(); } catch (e) { /* ignore */ }
          }
        }
        return nodes.length > 0;
      }
      let idx = matchAnswer(answerArr, q.options || []);
      if (!idx.length) return false;
      // 拟人:单选按配置概率故意点一个错误选项
      if (CONFIG.deliberateErrorRate > 0 && Math.random() < CONFIG.deliberateErrorRate && (q.options || []).length > 1) {
        const wrongIdx = [];
        for (let i = 0; i < q.options.length; i++) if (!idx.includes(i)) wrongIdx.push(i);
        if (wrongIdx.length) {
          idx = [wrongIdx[Math.floor(Math.random() * wrongIdx.length)]];
          log('🎭 拟人模式:本题故意答错(配置概率)', 'info');
        }
      }
      const lis = Array.from(el.querySelectorAll('li'));
      if (!lis.length) return false;
      lis.forEach((li, i) => {
        if (idx.includes(i)) {
          try { const inp = li.querySelector('input'); if (inp) inp.click(); } catch (e) { /* ignore */ }
          try { li.click(); } catch (e) { /* ignore */ }
        }
      });
      return true;
    } catch (e) { return false; }
  }

  // 弹题"已处理"标记有效期:60 秒后过期,支持"答错→回看→重弹"场景的重新作答
  function wasHandledRecently(el) {
    return !!el.__cxHandledAt && (Date.now() - el.__cxHandledAt < 60000);
  }

  async function tryPopupQuiz(wins, player) {
    for (const win of wins) {
      if (!win || !win.document) continue;
      let container = null;
      for (const sel of QUIZ_SELECTORS) {
        let els;
        try { els = win.document.querySelectorAll(sel); } catch (e) { continue; }
        for (const el of els) {
          if (wasHandledRecently(el)) continue;
          if (isVisible(el)) { container = el; break; }
        }
        if (container) break;
      }
      if (!container) container = heuristicFindQuiz(win);
      if (!container || wasHandledRecently(container)) continue;
      container.__cxHandledAt = Date.now();
      let q = extractQuizQuestion(container);
      const fromHeuristic = !q || !q.question;
      if (fromHeuristic) q = extractHeuristicQuestion(container);
      if (!q || !q.question) {
        log('⚠ 发现疑似弹题但无法解析题目,已记录 DOM', 'warn');
        log('DOM: ' + String(container.outerHTML).slice(0, 1500), 'info');
        continue;
      }
      if (!container.__cxDomLogged) {
        container.__cxDomLogged = true;
        log('DOM侦察: ' + String(container.outerHTML).slice(0, 1500), 'info');
      }
      log(`❓ 检测到视频弹题${fromHeuristic ? '(启发式)' : ''}: ${q.question.slice(0, 40)}...`, 'warn');
      await sleep(0.2); // 极速:不等待
      const answers = await getAnswers(q);
      const ok = setHeuristicAnswer(answers, q, container);
      recordQuestion(q, answers);  // 收集弹题进题库
      log(ok ? '弹题已作答,继续播放' : '弹题未能作答,尝试直接继续', ok ? 'ok' : 'warn');
      await sleep(0.3); // 极速:答完立即继续
      // 精确优先:先点"继续学习"(视频弹题专用),再兜底其他常见按钮
      if (!clickButtonByText(win, ['继续学习'])) {
        clickButtonByText(win, ['确定', '提交', '下一题', '关闭', '继续', '我知道了']);
      }
      try { if (player) player.play(); } catch (e) { /* ignore */ }
      return true;
    }
    return false;
  }

  /* ==================== 每日刷课时长统计(纪律) ==================== */
  function getTodayStats() {
    try {
      const s = (typeof GM_getValue !== 'undefined')
        ? GM_getValue('cxDaily', null)
        : JSON.parse(localStorage.getItem('cxDaily') || 'null');
      const today = new Date().toDateString();
      if (s && s.date === today) return s;
      return { date: today, minutes: 0 };
    } catch (e) { return { date: new Date().toDateString(), minutes: 0 }; }
  }
  function saveTodayStats(s) {
    try {
      if (typeof GM_setValue !== 'undefined') GM_setValue('cxDaily', s);
      else localStorage.setItem('cxDaily', JSON.stringify(s));
    } catch (e) { /* ignore */ }
  }
  let dailyLimitReached = false;

  /* ==================== 任务点处理 ==================== */
  async function videoTask(iframe, outerWin) {
    // 每日时长上限检查
    if (CONFIG.dailyLimitMinutes > 0) {
      const st = getTodayStats();
      if (st.minutes >= CONFIG.dailyLimitMinutes) {
        dailyLimitReached = true;
        log(`⏹ 今日刷课已达上限 ${CONFIG.dailyLimitMinutes} 分钟,自动停止(明天自动恢复)`, 'warn');
        return;
      }
      log(`⏱ 今日已刷约 ${st.minutes} 分钟 / 上限 ${CONFIG.dailyLimitMinutes} 分钟`);
    }
    await waitIframeLoaded(iframe);
    const win = iframe.contentWindow;
    await waitElementLoaded(win, '#video_html5_api', 90000);
    let player = null;
    try { player = win.videojs('video_html5_api'); } catch (e) { /* ignore */ }
    if (!player) { log('无法获取播放器对象,跳过', 'err'); return; }
    try { player.muted(true); } catch (e) { /* ignore */ }
    try { player.playbackRate(CONFIG.speed); } catch (e) { /* ignore */ }
    try { player.play(); } catch (e) { /* ignore */ }
    log(`▶ 开始播放视频(静音, ${CONFIG.speed}x 原速)`, 'ok');
    await new Promise((resolve) => {
      let finished = false;
      let timer = null;
      let quizBusy = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearInterval(timer);
        resolve();
      };
      timer = setInterval(async () => {
        if (quizBusy) return;
        quizBusy = true;
        try {
          if (player.paused()) {
            // 暂停 = 大概率是弹题,先在三个窗口里找题目(播放器iframe/章节iframe/顶层)
            await tryPopupQuiz([win, outerWin, window], player);
          }
          if (typeof win.isUnFinishJob === 'function' && !win.isUnFinishJob()) {
            log('学习通报告本任务点已完成', 'ok');
            finish();
            return;
          }
          if (player.paused()) {
            try { player.play(); } catch (e) { /* ignore */ }
          }
        } catch (e) { /* ignore */ }
        quizBusy = false;
      }, 2000);
      try { player.on('ended', () => { log('视频播放结束', 'ok'); finish(); }); } catch (e) { /* ignore */ }
    });
    // 累加今日刷课时长(按视频实际时长折算)
    try {
      const dur = typeof player.duration === 'function' ? player.duration() : 0;
      if (dur > 0) {
        const st = getTodayStats();
        st.minutes += Math.round(dur / 60);
        saveTodayStats(st);
        log(`⏱ 今日累计刷课约 ${st.minutes} 分钟`, 'info');
      }
    } catch (e) { /* ignore */ }
    log('✓ 视频任务完成');
  }

  async function audioTask(iframe) {
    await waitIframeLoaded(iframe);
    const win = iframe.contentWindow;
    await waitElementLoaded(win, '#audio_html5_api', 90000);
    const audio = win.document.getElementById('audio_html5_api');
    audio.muted = true;
    audio.volume = 0;
    try { audio.play().catch(() => { /* 首次可能需要用户点击页面 */ }); } catch (e) { /* ignore */ }
    log('♪ 开始播放音频(静音)', 'ok');
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        if (audio.ended) { clearInterval(timer); resolve(); return; }
        if (audio.paused) { try { audio.play().catch(() => { /* ignore */ }); } catch (e) { /* ignore */ } }
      }, 2000);
      audio.addEventListener('ended', () => { clearInterval(timer); resolve(); });
    });
    log('✓ 音频任务完成');
  }

  async function pdfTask(iframe) {
    await waitIframeLoaded(iframe);
    const win = iframe.contentWindow;
    try {
      const pan = win.document.querySelector('#panView');
      if (pan && pan.contentWindow) {
        const pw = pan.contentWindow;
        pw.scrollTo(0, pw.document.body.scrollHeight);
        await sleep(1);
        pw.scrollTo(0, pw.document.body.scrollHeight);
      } else {
        win.scrollTo(0, win.document.body.scrollHeight);
      }
    } catch (e) { /* ignore */ }
    await sleep(1);
    log('✓ 文档任务处理完成');
  }

  // 图片任务点:没有视频,打开后"看完"图片即完成(停留 + 轻微滚动模拟查看)
  async function imageTask(iframe) {
    await waitIframeLoaded(iframe);
    const win = iframe.contentWindow;
    try {
      win.scrollTo(0, win.document.body.scrollHeight);
      await sleep(0.5);
      win.scrollTo(0, 0);
    } catch (e) { /* ignore */ }
    log('🖼 图片任务:已打开并停留查看...', 'ok');
    await randomSleep(5, 8);
    log('✓ 图片任务处理完成');
  }

  async function workTask(iframe) {
    await waitIframeLoaded(iframe);
    const outerWin = iframe.contentWindow;
    let innerIframe = null;
    try { innerIframe = outerWin.document.querySelector('iframe'); } catch (e) { /* ignore */ }
    if (!innerIframe) { log('测验内层 iframe 未找到,跳过', 'warn'); return; }
    await waitIframeLoaded(innerIframe);
    const win = innerIframe.contentWindow;
    await waitElementLoaded(win, '.TiMu, .questionLi', 30000);
    if (win.document.querySelector('.font-cxsecret')) {
      log('🔐 测验检测到字体加密,正在自动解密...', 'warn');
      await decodeFont(win);
      if (win.document.querySelector('.font-cxsecret')) {
        log('⚠ 字体解密未成功,跳过自动作答(不会乱提交)', 'warn');
        try { win.alert = () => {}; if (typeof win.noSubmit === 'function') win.noSubmit(); } catch (e) { /* ignore */ }
        return;
      }
    }
    // 双结构:老版章节测验(.TiMu)/ 新版内嵌作业(.questionLi,如 doHomeWorkNew)
    let els = Array.from(win.document.querySelectorAll('.TiMu'));
    let workStyle = false;
    if (!els.length) {
      els = Array.from(win.document.querySelectorAll('.questionLi'));
      workStyle = true;
    }
    if (!els.length) { log('未找到题目', 'warn'); return; }
    log(`📝 章节测验${workStyle ? '(作业结构)' : ''},共 ${els.length} 题`, 'ok');
    const tasks = [];
    for (const el of els) {
      const q = workStyle ? extractWorkQuestion(el) : extractQuizQuestion(el);
      if (q) tasks.push({ q, el });
    }
    let okCount = 0;
    STATS.jobsTotal = tasks.length;
    STATS.jobsDone = 0;
    for (let i = 0; i < tasks.length; i++) {
      const { q, el } = tasks[i];
      await randomSleep(CONFIG.answerIntervalMin, CONFIG.answerIntervalMax);
      const answers = await getAnswers(q);
      const ok = setQuizAnswer(answers, q, el, win);
      recordQuestion(q, answers);  // 收集测验题进题库
      if (ok) okCount++;
      STATS.jobsDone = okCount;
      log(`第 ${i + 1}/${tasks.length} 题(类型 ${q.type}) ${ok ? '✓ 已作答' : '✗ 无答案'}`, ok ? 'ok' : 'warn');
    }
    const accuracy = tasks.length ? okCount / tasks.length : 0;
    if (CONFIG.autoSubmit && accuracy >= CONFIG.minAccuracy) {
      await randomSleep(CONFIG.submitDelayMin, CONFIG.submitDelayMax);
      log(`正确率 ${Math.round(accuracy * 100)}%,正在提交...`, 'ok');
      let submitted = false;
      try {
        if (typeof win.btnBlueSubmit === 'function') { win.btnBlueSubmit(); submitted = true; }
        else if (typeof win.submitWork === 'function') { win.submitWork(); submitted = true; }
      } catch (e) { /* ignore */ }
      if (!submitted) submitted = clickButtonByText(win, ['交卷', '提交', '确认提交']);
      if (submitted) {
        await sleep(3);
        try { if (typeof win.submitCheckTimes === 'function') win.submitCheckTimes(); } catch (e) { /* ignore */ }
        log('已触发提交', 'ok');
      } else {
        log('未找到提交入口,请手动提交', 'warn');
      }
    } else {
      log(`正确率 ${Math.round(accuracy * 100)}% 低于阈值 ${Math.round(CONFIG.minAccuracy * 100)}%,暂存不提交`, 'warn');
      try { win.alert = () => {}; if (typeof win.noSubmit === 'function') win.noSubmit(); } catch (e) { /* ignore */ }
    }
  }

  async function homeworkTask() {
    initPanel();
    await waitElementLoaded(window, '.questionLi', 30000);
    if (window.document.querySelector('.font-cxsecret')) {
      log('🔐 作业检测到字体加密,正在自动解密...', 'warn');
      await decodeFont(window);
    }
    const els = Array.from(document.querySelectorAll('.questionLi'));
    if (!els.length) { log('未找到作业题目', 'warn'); return; }
    log(`📝 作业页,共 ${els.length} 题(填写后不会自动交卷,请检查后手动提交)`, 'ok');
    let okCount = 0;
    for (let i = 0; i < els.length; i++) {
      await randomSleep(CONFIG.answerIntervalMin, CONFIG.answerIntervalMax);
      const q = extractWorkQuestion(els[i]);
      if (!q) continue;
      const answers = await getAnswers(q);
      const ok = setQuizAnswer(answers, q, els[i], window);
      if (ok) okCount++;
      const size = (answers || []).join('').length;
      log(`第 ${i + 1}/${els.length} 题 ${ok ? `✓ 已作答(回读校验通过, ${size} 字)` : `✗ 写入失败或无可匹配答案(收到 ${size} 字)`}`, ok ? 'ok' : 'warn');
    }
    log(`作业填写完成(${okCount}/${els.length}),请人工检查后手动提交`);
  }

  /* ==================== 章节主循环 ==================== */
  let running = false;
  let lastIframeUrl = '';

  // 通用:按可见文本点击元素(tab/按钮)
  function clickByText(win, texts) {
    const nodes = win.document.querySelectorAll('button, a, div, span, li');
    for (const n of nodes) {
      const t = (n.textContent || '').trim();
      if (!t || t.length > 20) continue;
      for (const kw of texts) {
        if (t === kw || (t.includes(kw) && !n.querySelector('input'))) {
          try { n.click(); } catch (e) { /* ignore */ }
          return true;
        }
      }
    }
    return false;
  }

  // 切下一节:优先老版 .nextChapter,兜底新版"下一节"按钮
  function clickNextSection() {
    const next = document.querySelector('.nextChapter');
    if (next) { try { next.click(); } catch (e) { /* ignore */ } return true; }
    const nodes = Array.from(document.querySelectorAll('button, a, div, span'));
    for (const n of nodes) {
      if ((n.textContent || '').trim() === '下一节') {
        try { n.click(); } catch (e) { /* ignore */ }
        return true;
      }
    }
    return false;
  }

  // 顶层弹题处理(2026 新版弹题直接渲染在顶层 document,选项是 radio)
  async function topLevelQuiz() {
    const els = Array.from(document.querySelectorAll('.TiMu'));
    if (els.length) {
      log(`📝 检测到顶层测验(共 ${els.length} 题)`, 'ok');
      let okCount = 0;
      for (let i = 0; i < els.length; i++) {
        await randomSleep(CONFIG.answerIntervalMin, CONFIG.answerIntervalMax);
        const q = extractQuizQuestion(els[i]);
        if (!q) continue;
        const answers = await getAnswers(q);
        const ok = setQuizAnswer(answers, q, els[i], window);
        if (ok) okCount++;
        log(`第 ${i + 1}/${els.length} 题 ${ok ? '✓ 已作答' : '✗ 无答案'}`, ok ? 'ok' : 'warn');
      }
      log(`顶层测验作答完成(${okCount}/${els.length}),请留意提交按钮`, 'ok');
      return;
    }
    const container = heuristicFindQuiz(window);
    if (container) {
      const q = extractHeuristicQuestion(container);
      if (q && q.question) {
        log(`❓ 检测到顶层弹题: ${q.question.slice(0, 40)}...`, 'warn');
        const answers = await getAnswers(q);
        const ok = setHeuristicAnswer(answers, q, container);
        log(ok ? '弹题已作答' : '弹题未能作答', ok ? 'ok' : 'warn');
        await sleep(0.3);
        clickButtonByText(window, ['继续学习', '确定', '提交', '下一题', '关闭', '继续', '我知道了']);
      }
    }
  }

  // 新版知识卡片循环(2025-2026 knowledge/cards 结构:卡片内嵌视频/图片/检测模块,顶层切节)
  async function newChapterLoop(cardsWin) {
    log('🧭 检测到新版知识卡片结构,启用新适配', 'ok');
    const limitHit = () => {
      try {
        const txt = String(document.body ? document.body.textContent : '') + ' ' + String(cardsWin.document.body ? cardsWin.document.body.textContent : '');
        return txt.includes('今日视频任务点完成数已达上限');
      } catch (e) { return false; }
    };
    if (limitHit()) {
      log('⏹ 平台提示:今日视频任务点已达上限,跳过视频任务(明天恢复),只处理学习检测', 'warn');
    }
    // 0) 顶层题目(新版弹题/判断题直接渲染在顶层 document)
    await topLevelQuiz();
    // 1) 学习检测:点击 tab → 等 work iframe → 做题;若无 work iframe 则尝试顶层题目
    if (CONFIG.autoWork) {
      const tabClicked = clickByText(cardsWin, ['学习检测', '学习测验']);
      if (tabClicked) {
        await sleep(2);
        let workFrame = null;
        for (let i = 0; i < 20 && !workFrame; i++) {
          const fs = Array.from(cardsWin.document.querySelectorAll('iframe'));
          workFrame = fs.find((f) => /\/ananas\/modules\/work\//.test(String(f.src || ''))) || null;
          if (!workFrame) await sleep(1);
        }
        if (workFrame) {
          await workTask(workFrame);
          log('✓ 学习检测完成', 'ok');
        } else {
          log('学习检测 tab 已点,但未找到 work iframe,尝试顶层题目', 'warn');
          await topLevelQuiz();
        }
      }
    }
    // 2) 视频任务(平台未限流时)
    if (!limitHit()) {
      let videoFrame = null;
      for (let i = 0; i < 20 && !videoFrame; i++) {
        const fs = Array.from(cardsWin.document.querySelectorAll('iframe'));
        videoFrame = fs.find((f) => /\/ananas\/modules\/video\//.test(String(f.src || ''))) || null;
        if (!videoFrame) await sleep(1);
      }
      if (videoFrame && CONFIG.autoVideo) {
        await videoTask(videoFrame, cardsWin);
      }
    }
    // 3) 图片任务
    {
      const fs = Array.from(cardsWin.document.querySelectorAll('iframe'));
      const imgFrame = fs.find((f) => /\/ananas\/modules\/(img|image|picture)\//.test(String(f.src || '')));
      if (imgFrame) await imageTask(imgFrame);
    }
    // 3.5) PDF/文档任务(纯 PDF 单模块卡片,如 3.8 节)
    {
      const fs = Array.from(cardsWin.document.querySelectorAll('iframe'));
      const pdfFrame = fs.find((f) => /\/ananas\/modules\/pdf\//.test(String(f.src || '')));
      if (pdfFrame) await pdfTask(pdfFrame);
    }
    // 4) 切下一节
    await sleep(0.3);
    if (CONFIG.autoJump && clickNextSection()) {
      log('→ 切换到下一节', 'ok');
    } else {
      log('未找到"下一节"按钮(可能已是最后一节)', 'warn');
    }
  }

  async function chapterLoop() {
    await waitElementLoaded(window, '#iframe', 30000);
    const cardsIframe = document.querySelector('#iframe');
    await waitIframeLoaded(cardsIframe);
    let cardsWin = null;
    try { cardsWin = cardsIframe.contentWindow; } catch (e) {
      log('章节 iframe 无法访问(跨域),请确认页面域名与脚本匹配', 'err');
      return;
    }
    try { if (typeof window.scroll2Job === 'function') window.scroll2Job(); } catch (e) { /* ignore */ }
    const icons = cardsWin.document.querySelectorAll('.ans-job-icon');
    if (!icons.length) {
      log('未找到任务点图标,尝试新版知识卡片模式处理...', 'warn');
      // 结构侦察:输出卡片 iframe 信息,帮助定位新版页面结构
      try {
        const frames = Array.from(cardsWin.document.querySelectorAll('iframe'));
        const srcs = frames.map((f) => String(f.src || f.getAttribute('data') || '').slice(0, 120));
        log('🔍 侦察:卡片 iframe 共 ' + frames.length + ' 个,src 列表: ' + JSON.stringify(srcs), 'info');
      } catch (e) {
        log('🔍 侦察失败: ' + e.message, 'err');
      }
      // 降级:按新版知识卡片模式直接处理(纯 PDF/视频/图片单模块卡片也能过)
      await newChapterLoop(cardsWin);
      return;
    }
    let finishedCount = 0;
    for (const icon of Array.from(icons)) {
      if (PAUSED) { log('⏸ 已暂停,本轮任务停止(点面板 ▶ 恢复)', 'warn'); return; }
      if (dailyLimitReached) { log('⏹ 今日刷课已到上限,停止任务处理', 'warn'); return; }
      const parent = icon.parentElement;
      if (parent && parent.classList.contains('ans-job-finished')) { finishedCount++; continue; }
      const iframe = parent ? parent.querySelector('iframe') : null;
      if (!iframe) { log('任务点无 iframe,跳过', 'warn'); continue; }
      let info = {};
      try { info = JSON.parse(iframe.getAttribute('data') || '{}'); } catch (e) { /* ignore */ }
      const name = info.name || info.title || '';
      const src = iframe.src || '';
      log(`开始任务点: ${name || src.slice(-40)}`);
      try {
        if (src.includes('/ananas/modules/video/index.html')) {
          if (CONFIG.autoVideo) await videoTask(iframe, cardsWin); else log('视频任务已跳过(配置关闭)');
        } else if (src.includes('/ananas/modules/audio/index.html')) {
          if (CONFIG.autoAudio) await audioTask(iframe); else log('音频任务已跳过(配置关闭)');
        } else if (src.includes('/ananas/modules/work/index.html')) {
          if (CONFIG.autoWork) await workTask(iframe); else log('测验任务已跳过(配置关闭)');
        } else if (src.includes('/ananas/modules/pdf/index.html')) {
          await pdfTask(iframe);
        } else if (src.includes('/ananas/modules/img/') || src.includes('/ananas/modules/image/') || src.includes('/ananas/modules/picture/') || /img.*index\.html/.test(src)) {
          await imageTask(iframe);
        } else {
          log('未知任务类型: ' + src, 'warn');
          // 记录未知类型 src,方便识别新模块
          log('🔍 未知模块 src 全文: ' + src, 'info');
        }
      } catch (e) {
        log(`任务处理异常: ${e.message}`, 'err');
      }
      await sleep(0.3);
    }
    log(`本章扫描结束(共 ${icons.length} 个任务点)`, 'ok');
    if (CONFIG.autoJump) {
      const next = document.querySelector('.nextChapter');
      if (next) { log('→ 切换到下一章'); next.click(); }
      else log('未找到下一章按钮(可能已是最后一章)', 'warn');
    }
  }

  function startWatch() {
    initPanel();
    log('挂机引擎已启动,开始扫描任务点...', 'ok');
    setInterval(async () => {
      try {
        const f = document.querySelector('#iframe');
        if (!f || !f.contentWindow) return;
        let url = '';
        try { url = f.contentWindow.location.href; } catch (e) { return; }
        if (url !== lastIframeUrl) {
          lastIframeUrl = url;
          if (!running) {
            running = true;
            setStatus('工作中');
            try { await chapterLoop(); } catch (e) { log('主循环异常: ' + e.message, 'err'); }
            running = false;
            setStatus('待机');
          }
        }
      } catch (e) { /* ignore */ }
    }, 3000);
  }

  /* ==================== 自动更新检测(仅在远端版本更高时刷新) ==================== */
  function verParts(v) {
    return String(v || '0').split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  }
  function verGreater(a, b) {
    const x = verParts(a), y = verParts(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const p = x[i] || 0, q = y[i] || 0;
      if (p > q) return true;
      if (p < q) return false;
    }
    return false;
  }
  function updateGuard() {
    try { return Number(GM_getValue('cxUpdateTryAt', 0)) || 0; } catch (e) { return 0; }
  }
  function markUpdateTry(t) {
    try { GM_setValue('cxUpdateTryAt', t); } catch (e) { /* ignore */ }
  }
  function startAutoUpdater() {
    setInterval(async () => {
      try {
        if (PAUSED || running) return; // 有任务进行中不打断
        const myV = (typeof GM_info !== 'undefined' && GM_info.script) ? GM_info.script.version : '0';
        const text = await cxFetch('https://cdn.jsdelivr.net/gh/DaRin1403/xuexitong-autostudy@main/version.json', { timeout: 10000 });
        const obj = JSON.parse(text);
        const remoteV = String(obj.v || '');
        if (!remoteV || !verGreater(remoteV, myV)) return;   // 同版本或更低:不动
        // 冷却 6 小时:上次刷新后仍是旧版本,说明更新没装成功,不再反复刷新
        if (Date.now() - updateGuard() < 6 * 3600 * 1000) return;
        log(`🔄 检测到新版本 v${remoteV}(当前 v${myV}),页面即将自动刷新以加载新版...`, 'warn');
        markUpdateTry(Date.now());
        await sleep(3);
        location.reload();
      } catch (e) { /* 服务器不在线则忽略 */ }
    }, 5 * 60 * 1000);
  }

  /* ==================== 路由 ==================== */
  (function main() {
    startReporterHeartbeat();
    const path = location.pathname;
    const chapterPages = ['/mycourse/studentstudy', '/mooc-ans/mycourse/studentstudy', '/mooc2-ans/mycourse/studentstudy'];
    const homeworkPages = [
      '/work/doHomeWorkNew', '/mooc-ans/work/doHomeWorkNew', '/mooc2-ans/work/doHomeWorkNew',
      '/mooc2/work/dowork', '/mooc-ans/mooc2/work/dowork', '/mooc2-ans/mooc2/work/dowork'
    ];
    if (chapterPages.includes(path)) {
      initPanel();
      if (!location.href.includes('mooc2=1')) {
        log('检测到旧版章节页,正在切换到新版(mooc2)...', 'warn');
        location.href += (location.href.includes('?') ? '&' : '?') + 'mooc2=1';
        return;
      }
      startWatch();
      startAutoUpdater();
    } else if (homeworkPages.includes(path)) {
      homeworkTask();
      startAutoUpdater();
    } else {
      console.log('[刷课助手] 当前页面不支持自动任务,请在课程章节学习页使用。');
    }
  })();
})();
