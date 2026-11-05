// ==UserScript==
// @name         刷课助手(学习通/智慧树/雨课堂)
// @namespace    cx-auto-study
// @version      1.4.4
// @description  多平台刷课助手:学习通/智慧树(知到)/雨课堂。视频静音连播、自动切任务点、弹题与章节测验自动答题(字体加密解密 + AI)、文档/图片任务、拟人化防检测
// @author       courseauto contributors
// @license      MIT
// @homepageURL  https://github.com/None-wu/courseauto
// @supportURL   https://github.com/None-wu/courseauto/issues
// @updateURL    https://cdn.jsdelivr.net/gh/None-wu/courseauto@main/userscripts/courseauto.user.js
// @downloadURL  https://cdn.jsdelivr.net/gh/None-wu/courseauto@main/userscripts/courseauto.user.js
// @match        *://*.chaoxing.com/*
// @match        *://*.zhihuishu.com/*
// @match        *://*.yuketang.cn/*
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
// ⚙️ 本文件由 tools/build.mjs 从 src/ 自动生成,请勿直接编辑;改源码后执行 npm run build
  /* ==================== 平台注册表 ====================
     每个平台适配器在文件末尾调用 registerAdapter({...}) 注册自己。
     适配器接口(最小集):
       id / name            标识与展示名
       match()              boolean,当前 URL 是否属于本平台
       pageKind()           'chapter' | 'quiz' | 'homework' | 'other'
       selfCheck()          {ok, detail},选择器自检,失配时提示"疑似改版"而不是静默无反应
       start()              启动本平台的主循环(内部调用内核的 log/getAnswers/initPanel 等)
       snapshotHints        可选,上报/诊断用的选择器提示
  ==================== */
  const ADAPTERS = [];
  let ACTIVE_ADAPTER = null;

  function registerAdapter(a) {
    ADAPTERS.push(a);
  }

  function activePlatformName() {
    return ACTIVE_ADAPTER ? ACTIVE_ADAPTER.name : '未知';
  }
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
    webAiEnabled: false,    // 网页 AI 答题(免 API Key,需配合「网页AI桥」脚本)
    webAiBatch: true,       // 整卷模式:整页题目一次性发给网页 AI,批量解析后逐题填写(更快、不易限流;缺漏的题自动回退逐题询问)
    webAiUrl: 'https://chat.deepseek.com/',  // 网页 AI 地址
    webAiRelay: 'http://127.0.0.1:8790',     // 本地中转服务(桥脚本经此收题,AI 页手动打开即可)
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

  // isAborted:可选回调。返回真表示本轮已被取消(用户点暂停 / 页面被切走),
  // 立刻 reject 而不是死等到超时 —— 否则暂停后仍要等几十秒才生效
  function waitElementLoaded(win, selector, timeoutMs = 60000, isAborted) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        try {
          if (win.document.querySelector(selector)) { clearInterval(timer); resolve(); return; }
        } catch (e) { /* iframe 未就绪 */ }
        if (isAborted && isAborted()) { clearInterval(timer); reject(new Error('已取消(暂停或页面已切换)')); return; }
        if (Date.now() - start > timeoutMs) { clearInterval(timer); reject(new Error('等待元素超时: ' + selector)); }
      }, 200);
    });
  }

  function waitIframeLoaded(iframe, timeoutMs = 60000, isAborted) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        try {
          if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') { clearInterval(timer); resolve(); return; }
        } catch (e) { /* ignore */ }
        if (isAborted && isAborted()) { clearInterval(timer); reject(new Error('已取消(暂停或页面已切换)')); return; }
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
  // 运行时长按"实际工作中"累计:暂停时把已跑时长结算进 elapsedMs,恢复后从新起点计,
  // startedAt 那套"上线时间戳"永远不减,暂停也在涨
  const STATS = { answered: 0, jobsDone: 0, jobsTotal: 0, elapsedMs: 0, runSince: null };

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtDur(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    const p = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(ss)}` : `${p(m)}:${p(ss)}`;
  }

  let lastStatusText = '';
  function setStatus(text) {
    const el = document.getElementById('cxStatus');
    if (el) {
      el.innerHTML = '<i></i>' + escHtml(text);
      el.className = 'cx-pill ' + (text === '工作中' ? 'run' : text === '已暂停' ? 'pause' : text === '出错' ? 'err' : 'idle');
    }
    // 计时钟:只在状态真正切换时启停,重复 setStatus('工作中') 不会把累计时长清零
    if (text !== lastStatusText) {
      if (text === '工作中') {
        if (!STATS.runSince) STATS.runSince = Date.now();
      } else if (STATS.runSince) {
        STATS.elapsedMs += Date.now() - STATS.runSince;
        STATS.runSince = null;
      }
      lastStatusText = text;
    }
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
    const _ver = scriptVersion();
    logPanel = document.createElement('div');
    logPanel.id = 'cx-panel';
    logPanel.innerHTML =
      '<div id="cxTitle" title="按住此处可拖动面板">' +
        '<span class="cx-brand">📚</span>' +
        '<span class="cx-name">刷课助手</span>' +
        '<span class="cx-ver" title="脚本版本(与油猴管理面板一致)">' + (_ver && _ver !== 'unknown' ? 'v' + escHtml(_ver) : 'v?') + '</span>' +
        '<span class="cx-plat">' + activePlatformName() + '</span>' +
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
      '#cxTitle{padding:9px 8px 9px 12px;font-weight:600;cursor:move;display:flex;gap:6px;align-items:center;color:#fafafa;background:linear-gradient(rgba(42,42,46,0.96),rgba(26,26,30,0.96));border-bottom:1px solid rgba(255,255,255,0.1);box-shadow:inset 0 1px 0 rgba(255,255,255,0.07);user-select:none}' +
      '#cxTitle .cx-brand{font-size:14px;filter:grayscale(1) brightness(1.6)}' +
      '#cxTitle .cx-name{font-size:13px;letter-spacing:0.6px;color:#fafafa;white-space:nowrap}' +
      '#cxTitle .cx-ver{font-size:10px;color:#8a8a93;letter-spacing:0.2px;font-variant-numeric:tabular-nums;border:1px solid rgba(255,255,255,0.12);border-radius:5px;padding:1px 5px;background:rgba(255,255,255,0.05);flex:none}' +
      '#cxTitle .cx-plat{font-size:10.5px;line-height:1;padding:3px 7px;border-radius:999px;color:#d4d4d8;border:1px solid rgba(255,255,255,0.22);background:rgba(255,255,255,0.06);white-space:nowrap;flex:none}' +
      '#cxTitle .cx-spacer{flex:1}' +
      '.cx-pill{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:400;padding:1px 9px 1px 7px;border-radius:999px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.16);color:#a1a1aa;transition:all .25s;white-space:nowrap;flex:none}' +
      '.cx-pill i{width:6px;height:6px;border-radius:50%;background:#6b6b73;flex:none}' +
      '.cx-pill.run i{background:#fff;box-shadow:0 0 0 0 rgba(255,255,255,0.55);animation:cxAura 1.7s infinite}' +
      '.cx-pill.run{color:#fff;border-color:rgba(255,255,255,0.4)}' +
      '.cx-pill.pause i{background:transparent;border:1.5px solid #a1a1aa;box-sizing:border-box}.cx-pill.pause{color:#d4d4d8}' +
      '.cx-pill.err i{background:#fff;border-radius:1px;transform:rotate(45deg)}.cx-pill.err{color:#fff;border-color:rgba(255,255,255,0.55)}' +
      '@keyframes cxAura{0%{box-shadow:0 0 0 0 rgba(255,255,255,0.5)}70%{box-shadow:0 0 0 5px rgba(255,255,255,0)}100%{box-shadow:0 0 0 0 rgba(255,255,255,0)}}' +
      '.cx-ic{cursor:pointer;font-size:12px;color:#d4d4d8;min-width:23px;height:22px;display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.16);border-radius:6px;padding:0 5px;line-height:1.4;transition:all .15s;user-select:none;flex:none}' +
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
      if (t) {
        const live = STATS.elapsedMs + (STATS.runSince ? Date.now() - STATS.runSince : 0);
        t.textContent = (STATS.runSince || STATS.elapsedMs) ? fmtDur(live) : '—';
      }
    }, 1000);
  }

  // 立即暂停:把当前页面(含同源 iframe)里正在播的视频/音频真正停住。
  // 只置 PAUSED 标志不够 —— 挂机循环要等下一轮才看到,视频会继续播、进度继续走、
  // 平台照记时长,手感上就是"点了暂停没反应"
  function pausePageMedia(win, depth) {
    win = win || window;
    depth = depth || 0;
    let n = 0;
    try {
      Array.from(win.document.querySelectorAll('video, audio')).forEach((m) => {
        try { if (!m.paused) { m.pause(); n++; } } catch (e) { /* ignore */ }
      });
      if (depth < 3) {
        Array.from(win.document.querySelectorAll('iframe')).forEach((f) => {
          try { if (f.contentDocument) n += pausePageMedia(f.contentWindow, depth + 1); } catch (e) { /* 跨域跳过 */ }
        });
      }
    } catch (e) { /* ignore */ }
    return n;
  }

  let PAUSED = false;
  function togglePause() {
    PAUSED = !PAUSED;
    if (PAUSED) {
      setStatus('已暂停');
      const n = pausePageMedia();
      log('⏸ 已暂停挂机' + (n ? `,已暂停 ${n} 个播放器` : '') + '(点 ▶ 恢复)', 'warn');
    } else {
      setStatus('工作中');
      log('▶ 已恢复挂机', 'ok');
      // 暂停会把挂机循环打断退出,而当前节/章的 iframe URL 没变,不会被当成"新页面"重扫;
      // 这里主动让适配器重跑一轮(从当前进度继续,不重头来)
      try { if (typeof resumeWatching === 'function') resumeWatching(); } catch (e) { /* ignore */ }
    }
    // 恢复挂机且启用网页 AI 时:借用户手势自动拉起 AI 页,并验证桥是否在线
    if (!PAUSED && CONFIG.webAiEnabled && typeof openWebAI === 'function') {
      try { openWebAI(); } catch (e) { /* 弹窗被拦也不影响挂机 */ }
      setTimeout(async () => {
        try {
          const site = new URL(CONFIG.webAiUrl).host;
          const raw = await cxFetch((CONFIG.webAiRelay || 'http://127.0.0.1:8790').replace(/\/$/, '') + '/api/webai/status', { timeout: 5000 });
          const o = JSON.parse(raw);
          const up = o.ok && Array.isArray(o.sites) && o.sites.some((s) => s.host === site);
          log(up
            ? `🔗 网页 AI 桥在线(${site}${o.sites.find((s) => s.host === site).ver && o.sites.find((s) => s.host === site).ver !== '?' ? ' v' + o.sites.find((s) => s.host === site).ver : ''}),可以自动答题`
            : `⚠ ${site} 的网页 AI 桥不在线:请切到网页 AI 标签页确认已打开且登录、桥脚本为最新版(别关标签页,可以最小化)`, up ? 'ok' : 'warn');
        } catch (e) { /* 中转服务不在线时静默 */ }
      }, 6000);
    }
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
        '<div class="hint">勾选后不再走 API:脚本打开 AI 网页、把题目发过去、自动填入并发送、再把回答抓回来。需要同时安装「网页AI桥」脚本(仓库同名文件),并已在该网站登录</div></div>' +
      '<div class="field"><div class="row"><div class="label">🔗 网页 AI 地址</div></div>' +
        '<input id="cfgWebAiUrl" type="text" value="' + CONFIG.webAiUrl + '">' +
        '<button id="cfgOpenWebAI" type="button" class="ghost" style="margin-top:6px">🔗 打开并连接网页 AI</button>' +
        '<div class="hint">支持 DeepSeek / 腾讯元宝 / Kimi / 豆包 / ChatGPT / 通义(qwen) / 智谱清言(chatglm) 的网页版。换站点改这里的地址即可(桥脚本 @match 已全部覆盖,无需重装桥);必须先在该网站登录,标签页保持打开</div></div>' +
      '<div class="field"><div class="row"><div class="label">📦 整卷模式(推荐)</div>' +
        '<input id="cfgWebAiBatch" type="checkbox" ' + (CONFIG.webAiBatch ? 'checked' : '') + '></div>' +
        '<div class="hint">开启后把整页题目一次性发给网页 AI、按题号批量回答再自动填写(1 次对话答完所有题,更快、不易触发限流);关闭则逐题询问。缺漏的题会自动回退逐题询问</div></div>' +
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
        '<div class="hint">到所选平台的官网注册并创建 API Key(sk- 开头)。只保存在你本机浏览器,不会上传;各平台注册地址见仓库 extras/docs/get-api-key.md</div></div>' +
      '<div class="field"><div class="row"><div class="label">🧠 AI 模型</div></div>' +
        '<input id="cfgAIModel" type="text" list="cxModelList" value="' + CONFIG.aiModel + '">' +
        '<datalist id="cxModelList"></datalist>' +
        '<button id="cfgFetchModels" type="button" class="ghost" style="margin-top:6px">📋 自动获取模型列表</button>' +
        '<div class="hint">先填好上方 Key 和接口地址,再点按钮:自动拉取该平台的可用模型,点输入框即可选择,无需手动抄模型名。拉取失败就手动填(各平台模型名见仓库 extras/docs/get-api-key.md)</div></div>' +
      '<div class="field"><div class="row"><div class="label">🌐 接口地址</div></div>' +
        '<input id="cfgAIUrl" type="text" value="' + CONFIG.aiUrl + '">' +
        '<div class="hint">OpenAI 兼容接口地址(以 /chat/completions 结尾)。默认 DeepSeek;MiniMax、智谱、硅基流动等平台的地址见仓库 extras/docs/get-api-key.md</div></div>' +
      '<div class="sec">🛡 安全与拟人</div>' +
      '<div class="field"><div class="row"><div class="label">🎭 故意答错率(%)</div></div>' +
        '<input id="cfgErrRate" type="number" step="1" min="0" max="20" value="' + Math.round(CONFIG.deliberateErrorRate * 100) + '">' +
        '<div class="hint">拟人化:真人不会全对。填 8 = 8% 概率故意答错(判断题反着点、单选题点错项);填 0 关闭;多选不受影响</div></div>' +
      '<div class="field"><div class="row"><div class="label">📤 自动提交测验</div>' +
        '<input id="cfgSubmit" type="checkbox" ' + (CONFIG.autoSubmit ? 'checked' : '') + '></div>' +
        '<div class="row" style="margin-top:8px"><div class="label" style="font-size:12px;font-weight:400">正确率达到多少才提交(%)</div></div>' +
        '<input id="cfgAccuracy" type="number" step="5" min="0" max="100" style="width:120px" value="' + Math.round(CONFIG.minAccuracy * 100) + '">' +
        '<div class="hint">默认 60:整卷答对率 ≥ 该值才自动交卷(当前 ' + Math.round(CONFIG.minAccuracy * 100) + '%);低于则暂存不交(不乱交卷),可回该章重做。填 0 = 不看正确率(答完就交),填 100 = 全对才交</div></div>' +
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
      CONFIG.webAiBatch = document.getElementById('cfgWebAiBatch').checked;
      CONFIG.webAiUrl = document.getElementById('cfgWebAiUrl').value.trim() || 'https://chat.deepseek.com/';
      CONFIG.deliberateErrorRate = (parseFloat(document.getElementById('cfgErrRate').value) || 0) / 100;
      CONFIG.dailyLimitMinutes = parseFloat(document.getElementById('cfgDaily').value) || 0;
      CONFIG.autoSubmit = document.getElementById('cfgSubmit').checked;
      // 提交阈值:0~100(%)→ 0~1,留空或非法值回落到 60%
      {
        const accEl = document.getElementById('cfgAccuracy');
        let pct = parseFloat(accEl && accEl.value);
        if (!isFinite(pct)) pct = 60;
        pct = Math.max(0, Math.min(100, pct));
        CONFIG.minAccuracy = pct / 100;
        if (accEl) accEl.value = pct;
      }
      CONFIG.autoJump = document.getElementById('cfgJump').checked;
      CONFIG.reportUrl = document.getElementById('cfgReport').value.trim();
      saveConfig(CONFIG);
      log('配置已保存(倍速 ' + CONFIG.speed + 'x, AI ' + (CONFIG.aiEnabled ? '开' : '关') +
        ', 自动提交 ' + (CONFIG.autoSubmit ? '正确率 ≥ ' + Math.round(CONFIG.minAccuracy * 100) + '%' : '关') + ')', 'ok');
      panel.remove();
    });
    document.getElementById('cfgClose').addEventListener('click', () => panel.remove());
    // 自动提交开关联动:关闭时正确率输入框置灰(表示不再参与判定)
    (function bindSubmitToggle() {
      const subEl = document.getElementById('cfgSubmit');
      const accEl = document.getElementById('cfgAccuracy');
      if (!subEl || !accEl) return;
      const sync = () => {
        accEl.disabled = !subEl.checked;
        accEl.style.opacity = subEl.checked ? '1' : '0.45';
      };
      subEl.addEventListener('change', sync);
      sync();
    })();
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
    // 去 markdown 标记,全角字母转半角
    let text = String(content || '').trim()
      .replace(/[*_`#>]/g, '')
      .replace(/[Ａ-Ｈａ-ｈ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
    const firstLine = lines[0] || text;
    switch (String(type)) {
      case '3': {
        // 语义归一:正确/错误、对/错、√/×、T/F、true/false 都认(带句号、带解释也认)。
        // 注意不能"默认正确":AI 只回选项字母时,交给作答环节按选项映射,否则会 50% 蒙错
        const t = text.replace(/\s+/g, '');
        const isFalse = /错误|不对|不正确|×|✗|false|^否|^不是|^错/i.test(t);
        const isTrue = /正确|√|✓|true|^对|^是/i.test(t) && !/不(正确|对|是)|^不是/.test(t);
        if (isFalse && !isTrue) return ['错误'];
        if (isTrue && !isFalse) return ['正确'];
        return [firstLine];
      }
      case '1': {
        // 先认"整行只有字母与分隔符"的形式:ABD / A、B、D / A,B,D / A B D / (ABD) / ABD。
        // 不先处理这种写法的话,"A、B、D" 会被下面的"取最后一个字母"逻辑拆成只剩 D(多选只选一个的元凶)
        const only = firstLine.replace(/^答案\s*[:：]?/, '').trim();
        if (/^[（(]?\s*(?:[A-Ha-h]\s*[、,，;；/和]?\s*)+[)）]?\s*[。.]?$/.test(only)) {
          const uniq = [];
          for (const ch of only.toUpperCase().replace(/[^A-H]/g, '')) if (!uniq.includes(ch)) uniq.push(ch);
          if (uniq.length) return uniq;
        }
        // 独立字母组合(前后不紧挨其他英文字母,防止匹配到 AI/App 之类单词)。
        // AI 带思考过程时答案在末尾("...所以选 A"),取最后一个匹配而不是第一个。
        const all = String(firstLine + '\n' + text).match(/(?:^|[^A-Za-z])([A-Ha-h]{1,8})(?![A-Za-z])/g) || [];
        if (all.length) {
          const last = all[all.length - 1].replace(/[^A-Ha-h]/g, '');
          const uniq = [];
          for (const ch of last.toUpperCase()) if (!uniq.includes(ch)) uniq.push(ch);
          return uniq;
        }
        return [firstLine];
      }
      case '0': {
        const all = String(firstLine + '\n' + text).match(/(?:^|[^A-Za-z])([A-Ha-h])(?![A-Za-z])/g) || [];
        // 取最后一个独立字母(思考过程开头提到的选项不算,结论在末尾)
        return all.length ? [all[all.length - 1].replace(/[^A-Ha-h]/g, '').toUpperCase()] : [firstLine];
      }
      case '2': return text.split(/[|｜;；]/).map((s) => s.trim()).filter(Boolean);
      default: return [text];
    }
  }
  /* ==================== 网页 AI 通道(免 API Key) ==================== */
  // 同源策略挡住了跨域 DOM,所以不能"打开网页直接 querySelector 抓答案"。
  // 做法:window.open 打开 AI 网站 → postMessage 把题目发过去 → AI 侧的「网页AI桥」
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

  async function askWebAI(text, timeoutMs, expect) {
    // 先验桥:目标 AI 站的桥不在线时跳过 postMessage 直连(握手状态可能是旧窗口残留,会白等 60s),
    // 直接走中转通道的快速失败 + 指引
    let site = '';
    try { site = new URL(CONFIG.webAiUrl).host; } catch (e) { /* ignore */ }
    const bridgeUp = site ? await bridgeOnlineFor(site) : true;
    // 通道一:postMessage 直连(窗口引用在手且桥已握手)—— 延迟最低
    if (bridgeUp) {
      let win = webAiWin && !webAiWin.closed ? webAiWin : null;
      if (!win) {
        // 还没开过 AI 页:先尝试开窗(用户手势后的弹窗放行;自动答题时的 open 可能被拦截,拦了走中转)
        win = openWebAI();
        if (win) {
          await waitWebAiReady(8000);
          if (webAiReady) return postMessageAsk(win, text, timeoutMs, expect);
        }
      } else {
        await waitWebAiReady(8000);
        if (webAiReady) return postMessageAsk(win, text, timeoutMs, expect);
      }
    }
    // 通道二:经本地服务中转 —— 不依赖弹窗,用户手动打开的 AI 页也能接题(内含不在线快速失败)
    const relay = await relayAsk(text, timeoutMs, expect);
    if (relay.ok) return relay.result;
    return { text: '', error: '连不上网页 AI:请点 ⚙ →「打开并连接网页 AI」,或手动打开网页 AI 地址并保持页面开着' };
  }

  // postMessage 直连实现(原 askWebAI 主体)
  function postMessageAsk(win, text, timeoutMs, expect) {
    const cxId = 'cx' + Date.now().toString(36) + (++webAiSeq);
    const base = (CONFIG.webAiRelay || 'http://127.0.0.1:8790').replace(/\/$/, '');
    return new Promise((resolve) => {
      let done = false;
      const finish = (r) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearInterval(relayTimer);
        window.removeEventListener('message', onMsg);
        resolve(r);
      };
      const onMsg = (e) => {
        const d = e.data;
        if (!d || d.cxType !== 'CX_ANSWER' || d.cxId !== cxId) return;
        finish({ text: String(d.text || ''), error: d.error || '' });
      };
      // 回程双保险:postMessage 等待期间同时轮询本地中转(桥会把答案双写进中转),
      // postMessage 回程丢了也能兜回
      let relayBusy = false;
      const relayTimer = setInterval(() => {
        if (relayBusy) return;
        relayBusy = true;
        cxFetch(base + '/api/webai/answer/' + cxId, { timeout: 5000 })
          .then((raw) => {
            const o = JSON.parse(raw);
            if (o && o.done) finish({ text: String(o.text || ''), error: o.error || '' });
          })
          .catch(() => { /* 中转不在线,继续等 */ })
          .finally(() => { relayBusy = false; });
      }, 2500);
      const timer = setTimeout(() => finish({ text: '', error: `等待网页 AI 回复超时(${Math.round(timeoutMs / 1000)}s)` }), timeoutMs);
      window.addEventListener('message', onMsg);
      try { win.postMessage({ cxType: 'CX_ASK', cxId, text, expect: expect || 0, timeout: timeoutMs }, webAiOrigin()); }
      catch (e) { finish({ text: '', error: '消息发送失败: ' + (e.message || e) }); }
    });
  }

  // 本地中转实现:POST 放题 → 轮询取答案;中转服务不在线或桥脚本不在线都明确报错
  // 查询中转服务:目标 AI 站的桥是否在线(在线才有可能答題)
  const RELAY_DOWN_HINT = '本地中转服务没在运行:请双击「刷课助手」exe 启动(黑色窗口),答题期间保持它开着';

  async function bridgeOnlineFor(site) {
    const base = (CONFIG.webAiRelay || 'http://127.0.0.1:8790').replace(/\/$/, '');
    try {
      const raw = await cxFetch(base + '/api/webai/status', { timeout: 5000 });
      const o = JSON.parse(raw);
      return !!(o.ok && Array.isArray(o.sites) && o.sites.some((s) => s.host === site));
    } catch (e) { return false; }
  }

  // 中转服务本身是否可达(区分「服务没开」和「桥不在线」,指引完全不同)
  async function relayServerUp() {
    const base = (CONFIG.webAiRelay || 'http://127.0.0.1:8790').replace(/\/$/, '');
    try { await cxFetch(base + '/api/webai/status', { timeout: 5000 }); return true; }
    catch (e) { return false; }
  }

  async function relayAsk(text, timeoutMs, expect) {
    const base = (CONFIG.webAiRelay || 'http://127.0.0.1:8790').replace(/\/$/, '');
    let site = '';
    try { site = new URL(CONFIG.webAiUrl).host; } catch (e) { /* ignore */ }
    // 先验桥:AI 页的桥不在线就别把题扔进队列干等 60s,快速失败并给可执行指引
    if (site && !(await bridgeOnlineFor(site))) {
      // 服务都没开就不用等:开多少个 AI 页也没用
      if (!(await relayServerUp())) {
        log(`⚠ ${RELAY_DOWN_HINT}`, 'err');
        return { ok: true, result: { text: '', error: RELAY_DOWN_HINT } };
      }
      log(`⚠ ${site} 的网页 AI 桥不在线:请打开「网页 AI 地址」页面(保持登录、别关标签页)并确认装了最新版「网页AI桥」`, 'warn');
      openWebAI();   // 点开始/答题通常紧跟用户操作,顺手尝试弹窗
      // 弹窗被拦/窗口最小化时页面刚被节流,心跳要几秒才能恢复:轮询最多 15s 再放弃
      const deadline = Date.now() + 15000;
      let up = false;
      while (Date.now() < deadline) {
        await sleep(2);
        if (!(await relayServerUp())) break;   // 等待期间服务被关,直接停
        if (await bridgeOnlineFor(site)) { up = true; break; }
      }
      if (!up) {
        if (!(await relayServerUp())) {
          log(`⚠ ${RELAY_DOWN_HINT}`, 'err');
          return { ok: true, result: { text: '', error: RELAY_DOWN_HINT } };
        }
        return { ok: true, result: { text: '', error: `${site} 的网页 AI 桥不在线(元宝页没开或没装/没刷新桥脚本)` } };
      }
      log('🔗 网页 AI 桥已上线,继续答题', 'ok');
    }
    const cxId = 'cx' + Date.now().toString(36) + (++webAiSeq);
    try {
      await cxFetch(base + '/api/webai/ask', {
        method: 'POST',
        data: JSON.stringify({ cxId, text, href: location.href, site, expect: expect || 0, timeout: timeoutMs }),
        headers: { 'Content-Type': 'application/json' },
        timeout: 8000
      });
    } catch (e) {
      return { ok: false, result: null };   // 本地服务不在线 → 走下一通道
    }
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await sleep(1);   // 每秒轮询一次答案(sleep 单位是秒)
      try {
        const raw = await cxFetch(base + '/api/webai/answer/' + cxId, { timeout: 6000 });
        const o = JSON.parse(raw);
        if (o.done) return { ok: true, result: { text: String(o.text || ''), error: String(o.error || '') } };
      } catch (e) { /* 网络抖动,继续轮询 */ }
    }
    // 超时:查一次状态,把"谁没干活"说清楚
    let hint = '请打开网页 AI 地址并保持开着';
    try {
      const st = JSON.parse(await cxFetch(base + '/api/webai/status', { timeout: 6000 }));
      if (st.sites && st.sites.indexOf(site) >= 0) {
        hint = '网页 AI 页已连上但没回复 —— 到 AI 页看看它是否回答卡住';
      } else if (st.bridgeOnline) {
        hint = '检测到旧版桥在轮询 —— 请重装「网页 AI 桥」(v1.0.6+)并刷新 AI 页面';
      }
    } catch (e) { /* ignore */ }
    return { ok: true, result: { text: '', error: `等待网页 AI 回复超时(${Math.round(timeoutMs / 1000)}s):` + hint } };
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
  /* ==================== 整卷模式(批量问答) ==================== */
  // 整页题目打包成一道大题发给网页 AI,按题号批量解析;缺漏的题由调用方回退逐题询问。
  function buildBatchPrompt(tasks) {
    const typeName = { '0': '单选题', '1': '多选题', '2': '填空题', '3': '判断题' };
    let out = `下面是 ${tasks.length} 道题。请按题号逐行给出答案,每行格式严格为「题号.答案」(如 1.A、2.正确、3.填空内容),不要解释、不要复述题目。单选题写一个字母;多选题写字母组合(如 ABD);判断题写「正确」或「错误」;填空题写答案,多个空用|分隔。\n\n`;
    tasks.forEach(({ q }, i) => {
      out += `${i + 1}. (${typeName[String(q.type)] || '题目'}) ${q.question}\n`;
      if (q.options && q.options.length) {
        // 选项带字母:AI 才知道 A/B 对应哪个选项(判断题也能回"B.错误"或字母)
        out += q.options.map((o, oi) => `${String.fromCharCode(65 + oi)}. ${o}`).join('\n') + '\n';
      }
      out += '\n';
    });
    return out;
  }

  // 把一批题打包问一次 AI,返回与 tasks 等长的答案数组(没解析到的位置为 null)
  async function askBatchOnce(tasks, tag) {
    const text = buildBatchPrompt(tasks);
    // 等待上限:每题 25s、最少 5 分钟、最多 15 分钟。整卷 AI 要连续输出几十行,
    // 之前按 15s/题(30 题=7.5 分钟)且桥内部只等 90s,所以经常"没答完就收货"
    const timeoutMs = Math.min(900, Math.max(300, tasks.length * 25)) * 1000;
    log(`📦 整卷模式${tag}:把 ${tasks.length} 道题一次性发给网页 AI(最长等 ${Math.round(timeoutMs / 1000)}s,期间别关 AI 页面)...`, 'info');
    const r = await askWebAI(text, timeoutMs, tasks.length);
    if (r.error) { log('网页 AI: ' + r.error, 'warn'); return null; }
    const raw = String(r.text || '').trim();
    if (!raw) { log('网页 AI 整卷回复为空', 'warn'); return null; }
    log('网页 AI 整卷原始回复: ' + raw.replace(/\s+/g, ' ').slice(0, 100), 'info');
    // 按「题号.答案」解析。兼容两种形态:
    // ① 多行:1.A\n2.C\n...(正常);② 压平一行:1.A 2.C 3.B...(回复被压平或 AI 单行输出)。
    // 每个答案取到"下一个题号标记或结尾"为止,而不是行尾 —— 一行多题也能全部拆出
    const rawMap = new Array(tasks.length).fill(null);
    const re = /(\d{1,3})\s*[\.、:：)\]]\s*([\s\S]*?)(?=(?:^|\s)\d{1,3}\s*[\.、:：)\]]|$)/g;
    // 元宝等站会把「展开/复制/收起」等 UI 按钮文字混进回复,逐行剥掉再入库
    const JUNK_LINE = /^(展开|收起|复制|重新生成|重新回答|停止|继续|点赞|点踩|分享|朗读|编辑|删除|已处理|已停止生成|思考中|正在思考|生成中|点击全选以下消息)$/;
    let m;
    while ((m = re.exec(raw)) !== null) {
      const idx = parseInt(m[1], 10) - 1;
      const ansText = String(m[2] || '').split('\n')
        .map((s) => s.trim()).filter((s) => s && !JUNK_LINE.test(s)).join('\n').trim();
      if (idx >= 0 && idx < tasks.length && ansText && !rawMap[idx]) rawMap[idx] = ansText;
    }
    return tasks.map(({ q }, i) => {
      if (!rawMap[i]) return null;
      const ans = filterAnswers(parseAIAnswer(String(q.type), rawMap[i]));
      return ans.length ? ans : null;
    });
  }

  async function askBatchWebAI(tasks) {
    if (!tasks.length) return null;
    const first = await askBatchOnce(tasks, '');
    const out = first ? first.slice() : new Array(tasks.length).fill(null);
    let got = out.filter(Boolean).length;
    log(`📦 整卷回复解析: ${got}/${tasks.length} 题拿到答案`, got === tasks.length ? 'ok' : 'warn');
    if (got === tasks.length) return out;
    // 缺题不立刻逐题问(那会变成"一个一个发"),先把缺的题再整批问一次
    const missIdx = out.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    if (missIdx.length && missIdx.length < tasks.length && CONFIG.webAiBatchRetry !== false) {
      log(`📦 补问:${missIdx.length} 道题没解析到,再整批问一次(不逐题)...`, 'warn');
      const sub = await askBatchOnce(missIdx.map((i) => tasks[i]), '(补问)');
      if (sub) sub.forEach((v, k) => { if (v && !out[missIdx[k]]) out[missIdx[k]] = v; });
      got = out.filter(Boolean).length;
      log(`📦 补问后: ${got}/${tasks.length} 题拿到答案`, got === tasks.length ? 'ok' : 'warn');
    }
    if (got < tasks.length) log(`⚠ 仍有 ${tasks.length - got} 道题没答案,只有这几道会逐题回退询问`, 'warn');
    return got ? out : null;
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
    const reason = CONFIG.webAiEnabled
      ? '(原因:网页 AI 没返回答案 —— 检查 AI 页面是否打开、是否装了「网页AI桥」)'
      : (!CONFIG.aiEnabled || !CONFIG.aiKey) ? '(原因:AI 答题未启用,请点 ⚙ 配置)' : '';
    log('未查到答案' + reason, 'warn');
    return [];
  }
  /* ==================== 自动作答 ==================== */
  function matchAnswer(answerArr, options) {
    const idx = [];
    const opts = (options || []).map((o) => cl(clean(String(o))));
    for (const raw of answerArr) {
      const a = cl(clean(String(raw)));
      if (!a) continue;
      // 字母答案:纯组合(ABD)或带分隔符(A、B、D / A,B,D / A和B)都拆成单字母,否则多选会被拆错
      const onlyLetters = /^[（(]?\s*(?:[A-Ha-h]\s*[、,，;；/和]?\s*)+[)）]?\s*[。.]?$/;
      const letters = /^[A-Ha-h]+$/.test(a)
        ? a.toUpperCase().split('')
        : (onlyLetters.test(a) ? a.toUpperCase().replace(/[^A-H]/g, '').split('') : []);
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

  /* ==================== 网页 AI 启动关卡 ==================== */
  // 启用网页 AI 时,答题任务开始前先把 AI 页拉起来、等桥在线,再放行答题。
  // 返回 true=可以答题;false=未就绪(调用方应跳过本轮答题,不要空跑超时)。
  async function webAiStartupGate() {
    if (!CONFIG.webAiEnabled) return true;
    const base = (CONFIG.webAiRelay || 'http://127.0.0.1:8790').replace(/\/$/, '');
    let site = '';
    try { site = new URL(CONFIG.webAiUrl).host; } catch (e) { return true; }
    // 一次探测同时区分「中转服务没开」和「桥不在线」—— 两者的解决动作完全不同
    const probe = async () => {
      try {
        const o = JSON.parse(await cxFetch(base + '/api/webai/status', { timeout: 5000 }));
        return { serverUp: true, bridgeUp: !!(o.ok && Array.isArray(o.sites) && o.sites.some((s) => s.host === site)) };
      } catch (e) { return { serverUp: false, bridgeUp: false }; }
    };
    let st = await probe();
    if (st.bridgeUp) { log(`🔗 网页 AI 桥已在线(${site}),直接开始答题`, 'ok'); return true; }
    if (!st.serverUp) {
      log(`⚠ ${RELAY_DOWN_HINT}`, 'err');
      return false;   // 服务没开,开 AI 页也没用,不空等 90s
    }
    log(`🚀 先打开网页 AI 页面(${site}),等它就绪后开始答题...`, 'info');
    try { openWebAI(); } catch (e) { /* 非手势弹窗可能被拦,用户手动打开也一样 */ }
    const deadline = Date.now() + 90000;
    let lastLog = 0;
    while (Date.now() < deadline) {
      await sleep(3);   // sleep 单位是秒
      if (PAUSED) return false;   // 等待期间用户点了暂停,放弃本轮
      st = await probe();
      if (st.bridgeUp) { log(`🔗 网页 AI 桥已就绪(${site}),开始答题`, 'ok'); return true; }
      if (!st.serverUp) {
        log(`⚠ 中转服务被关掉了(黑窗口没了)。${RELAY_DOWN_HINT},再点「开始」重试`, 'err');
        return false;
      }
      if (Date.now() - lastLog > 15000) {
        lastLog = Date.now();
        log(`⏳ 仍在等网页 AI 页面就绪(需已打开且登录、标签页保持开着,自动开窗被拦时请手动打开)...`, 'warn');
      }
    }
    log('⚠ 等了 90s 网页 AI 桥仍未上线,本轮不开始答题(确认页面已打开且登录后,点「开始」重试)', 'warn');
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

  // 用指定字体渲染一个字符,返回二值化的字形指纹
  function glyphBits(ch, fontName) {
    const ctx = getFontCtx();
    ctx.clearRect(0, 0, 32, 32);
    ctx.font = '28px ' + (fontName || FONT_NAME);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, 16, 17);
    const d = ctx.getImageData(0, 0, 32, 32).data;
    let s = '';
    for (let i = 3; i < d.length; i += 4) s += d[i] > 120 ? '1' : '0';
    return s;
  }

  function hamming(a, b) {
    let n = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
    return n;
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
  // 解密策略两级:①同字体精确字形匹配(字体版本一,最准) ②普通字体模糊最近匹配(字体版本二/候选字也被重映射时兜底)
  // 解出的映射存入全局 _fontMap,收题文本统一经 applyDecryptText 兜底还原。
  const _fontMap = new Map();   // 加密码点 -> 真实字符

  // 题目文本兜底还原:不管元素是否带 .font-cxsecret,只要字符在映射表里就还原
  function applyDecryptText(text) {
    let t = String(text || '');
    if (!_fontMap.size || !t) return t;
    let out = '';
    let changed = false;
    for (const ch of t) {
      const r = _fontMap.get(ch);
      if (r !== undefined && r !== ch) { out += r; changed = true; }
      else out += ch;
    }
    return changed ? out : t;
  }

  async function decodeFont(win, rootEl) {
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
    const targets = new Set();
    els.forEach((el) => { for (const ch of String(el.textContent || '')) targets.add(ch); });
    // 新版页面可能不给元素挂 .font-cxsecret 类,只注入加密字体:从容器文本收集生僻 CJK 字符当目标
    if (!targets.size) {
      const scope = rootEl || win.document.body;
      const txt = String(scope && (scope.innerText || scope.textContent) || '');
      for (const ch of txt) {
        const c = ch.codePointAt(0);
        if (c >= 0x3400 && c <= 0x9FFF && !COMMON_CHARS.includes(ch)) targets.add(ch);
        if (targets.size >= 600) break;
      }
    }
    if (!targets.size) return false;
    const tHashes = new Map();
    for (const ch of targets) {
      try { tHashes.set(ch, glyphBits(ch)); } catch (e) { /* ignore */ }
    }
    if (!tHashes.size) return false;
    log(`🔓 字体解密: ${tHashes.size} 个乱码字符,正在对比常用字字形...`, 'info');
    const resolved = new Map();
    const candBits = [];
    const start = Date.now();
    for (let ci = 0; ci < COMMON_CHARS.length; ci++) {
      const ch = COMMON_CHARS[ci];
      try {
        candBits.push([ch, glyphBits(ch), glyphBits(ch, 'sans-serif')]);
      } catch (e) { /* ignore */ }
      if (Date.now() - start > 12000) { log('字体解密:候选字渲染超时,用已渲染部分继续', 'warn'); break; }
    }
    // 第一级:同字体精确匹配
    for (const [target, thash] of tHashes) {
      for (const [ch, bits] of candBits) {
        if (bits === thash) { resolved.set(target, ch); break; }
      }
    }
    // 第二级:普通字体模糊最近匹配(仅对未解出的)
    for (const [target, thash] of tHashes) {
      if (resolved.has(target)) continue;
      let best = null, bestDist = Infinity;
      for (const [ch, , plainBits] of candBits) {
        const d = hamming(thash, plainBits);
        if (d < bestDist) { bestDist = d; best = ch; }
      }
      // 1024 位指纹,阈值 12%:字形足够接近才认(普通字体与加密字体字形有差异,不能太严也不能太松)
      if (best && bestDist < 123) resolved.set(target, best);
    }
    if (!resolved.size) { log('字体解密未能匹配(可能含非常用字),跳过自动作答', 'warn'); return false; }
    // 注意:绝不原地改写页面 DOM!页面靠加密字体本就能正常显示,改写反而会洗掉选项里的
    // 单选按钮等结构,导致用户无法在页面上手动答题。这里只把映射存进 _fontMap,
    // 发题给 AI / 填空写入时经 applyDecryptText() 还原。
    for (const [t, r] of resolved) _fontMap.set(t, r);
    log(`🔓 字体解密完成,还原 ${resolved.size}/${tHashes.size} 个字符(仅用于发题,页面显示不受影响)`, 'ok');
    return true;
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
        const text = await cxFetch('https://cdn.jsdelivr.net/gh/None-wu/courseauto@main/version.json', { timeout: 10000 });
        // 有些编辑器会在 UTF-8 文件头写 BOM,JSON.parse 会直接抛错 → 先剥掉再解析
        const obj = JSON.parse(String(text || '').replace(/^\uFEFF/, '').trim());
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
  /* ==================== 题目提取 ==================== */
  // 章节测验(.TiMu 容器)
  // 题干兜底链(不同版本/不同题型 DOM 不一样)
  function pickTitleHtml(el) {
    const sels = ['.mark_name', '.Zy_TItle .clearfix', '.Zy_TItle', '.clearfix .fontLabel', '.fontLabel',
      '.question-title', '.q-title', '.timu', 'h3', 'h2'];
    for (const s of sels) {
      const n = el.querySelector(s);
      if (n && clean(n.innerHTML)) return n.innerHTML;
    }
    // 最后兜底:去掉选项区后的整块文本
    const clone = el.cloneNode(true);
    clone.querySelectorAll('ul, ol, .answer_p, .answerBg, textarea, input, .btn, button').forEach((n) => n.remove());
    return clone.innerHTML;
  }

  // 选项兜底链(li 类容器要去掉序号前缀和隐藏 input,否则会把"A、"混进选项文本)
  function optText(node) {
    const c = node.cloneNode(true);
    c.querySelectorAll('input, textarea, .num_option, .check_answer, i').forEach((n) => n.remove());
    return clean(c.innerHTML);
  }
  function pickOptions(el) {
    const plain = ['ul li .after', '.answer_p .after', '.option-text', '.after'];
    for (const s of plain) {
      const arr = Array.from(el.querySelectorAll(s)).map((o) => clean(o.innerHTML)).filter(Boolean);
      if (arr.length >= 2) return arr;
    }
    const boxes = ['.answer_p', 'ul li', 'ol li', 'label.option', '.option-item', 'dd'];
    for (const s of boxes) {
      const arr = Array.from(el.querySelectorAll(s)).map(optText).filter(Boolean);
      if (arr.length >= 2) return arr;
    }
    return [];
  }

  // 学习通每题都会渲染题型标记([判断题]/【单选题】…),这是最可靠的题型来源:
  // 选项文字被字体加密时(拿不到"正确/错误"字样)只有它能判出题型
  function typeFromTag(el) {
    let t = '';
    try { t = String(el.textContent || '').slice(0, 90); } catch (e) { return null; }
    const m = t.match(/[\[【(（]\s*(判断题|单选题|多选题|填空题|简答题|论述题|名词解释|计算题)\s*[\]】)）]/);
    if (!m) return null;
    if (m[1] === '判断题') return '3';
    if (m[1] === '单选题') return '0';
    if (m[1] === '多选题') return '1';
    return '2';
  }
  // 题型推断:题型标记 → 选项语义(判断题)→ answertype 隐藏域 → 控件类型
  function inferType(el, options) {
    const tagged = typeFromTag(el);
    if (tagged) return tagged;
    const o = options || [];
    // 选项就是"正确/错误"(或双 radio 的 value 为 true/false、对/错)→ 判断题。
    // 置于隐藏域之前:不同版本 answertype 取值不一(有的判断题给 0/1),按选项语义判最稳。
    const s0 = o.length === 2 ? judgeSideOfText(o[0]) : null;
    const s1 = o.length === 2 ? judgeSideOfText(o[1]) : null;
    if (s0 !== null && s1 !== null && s0 !== s1) return '3';
    let radios = [];
    try { radios = Array.from(el.querySelectorAll('input[type=radio]')); } catch (e) { /* ignore */ }
    if (radios.length === 2) {
      const v0 = judgeSideOfValue(radios[0].value);
      const v1 = judgeSideOfValue(radios[1].value);
      if (v0 !== null && v1 !== null && v0 !== v1) return '3';
    }
    const t = el.querySelector('input[name^=answertype], input[name^=type]');
    if (t && String(t.value) !== '') return String(t.value);
    if (el.querySelector('textarea, .edui-editor, [contenteditable=true]')) return '2';
    if (el.querySelector('input[type=checkbox]')) return '1';
    return '0';
  }

  function extractQuizQuestion(el) {
    try {
      const text = applyDecryptText(cl(clean(pickTitleHtml(el))));
      if (!text) return null;
      const options = pickOptions(el).map(applyDecryptText);
      return { question: text, options, type: inferType(el, options) };
    } catch (e) { return null; }
  }
  // 作业页(.questionLi 容器)
  function extractWorkQuestion(el) {
    try {
      const mark = el.querySelector('.mark_name');
      let html = mark ? mark.innerHTML : '';
      const idx = html.indexOf('</span>');
      // .mark_name 里常把题型放在第一个 span 里,先剥掉;剥完为空则退回整块题干
      let text = cl(clean(idx >= 0 ? html.substring(idx + 7) : html));
      if (!text) text = cl(clean(pickTitleHtml(el)));
      text = applyDecryptText(text);
      if (!text) return null;
      const options = pickOptions(el).map(applyDecryptText);
      return { question: text, options, type: inferType(el, options) };
    } catch (e) { return null; }
  }

  /* ===== 判断题专用:语义归一 + 选项定位 + 点击校验 =====
     判断题是最容易"看起来答了其实没选中"的题型:
     ① 各版本 radio 的 value 不一致(true/false、对/错、A/B),老代码只认 true/false;
     ② 有些版本根本没有 input(div 式选项,靠 JS 加 class),老代码只点 ul li;
     ③ 点 li 不一定能选中 radio(部分版本把点击绑在 label/input 上),老代码点完不校验;
     ④ AI 的答案还可能是 正确/错误/对/错/√/×/T/F/true/false/选项字母/带句号。
     所以这里把"答案"和"选项"都归一成 true/false,再找目标控件点击并校验结果。 */
  function judgeNormText(s) {
    return String(s || '')
      .replace(/^[A-Ha-h][、.．:：)）\s]+/, '')            // 去掉 "A、" 这类序号前缀
      .replace(/[\s。.，,；;！!？?、:："'“”‘’()（）\[\]【】]/g, '')
      .trim();
  }
  function judgeSideOfText(text) {
    const t = judgeNormText(text);
    if (!t) return null;
    if (/^(不正确|不对|不是|错误|错|否|×|✗|false|f|no|n|0)$/i.test(t)) return false;
    if (/^(正确|对|是|√|✓|true|t|yes|y|1)$/i.test(t)) return true;
    if (/^(不正确|不对|不是)/.test(t)) return false;
    if (/^(正确|对|是)/.test(t)) return true;
    if (/错误|不对|不正确|×|✗|false/i.test(t)) return false;
    if (/正确|√|✓|true/i.test(t)) return true;
    // 字母与对错连写("A对"/"A错",序号后面没有分隔符):剥掉首字母再判一次
    const t2 = t.replace(/^[A-Ha-h][、.．:：)）\s]*/, '');
    if (t2 && t2 !== t && /[\u4e00-\u9fa5]/.test(t2)) return judgeSideOfText(t2);
    return null;
  }
  function judgeSideOfValue(v) {
    const s = String(v == null ? '' : v).trim().toLowerCase().replace(/[\s。.]/g, '');
    if (!s) return null;
    if (s === 'true' || s === 't' || s === '1' || s === '对' || s === '正确' || s === '是' || s === '√' || s === 'yes' || s === 'y') return true;
    if (s === 'false' || s === 'f' || s === '0' || s === '错' || s === '错误' || s === '否' || s === '×' || s === 'no' || s === 'n') return false;
    return null;
  }
  // 把 AI 的答案(含选项字母/选项原文/各种写法)归一成 true=正确 / false=错误 / null=判不出
  function judgeDesiredSide(answerArr, options) {
    const opts = options || [];
    for (const raw of answerArr || []) {
      const a = String(raw == null ? '' : raw).trim();
      if (!a) continue;
      const lm = a.match(/^([A-Ha-h])(?:[、.．:：)）]|$)/);
      if (lm) {
        const i = lm[1].toUpperCase().charCodeAt(0) - 65;
        if (opts[i]) { const s = judgeSideOfText(opts[i]); if (s !== null) return s; }
        // 选项文字读不出(字体加密没解开):判断题只有两项,按位置兜底 A=正确、B=错误
        if (i <= 1 && (opts.length === 0 || opts.length === 2)) return i === 0;
      }
      if (opts.length === 2) {   // 答案就是选项原文(对/错)
        const na = judgeNormText(a);
        for (let i = 0; i < 2; i++) {
          if (na && judgeNormText(opts[i]) === na) { const s = judgeSideOfText(opts[i]); if (s !== null) return s; }
        }
      }
      const s = judgeSideOfText(a);
      if (s !== null) return s;
    }
    return null;
  }
  // 取选项的可读文字:必须走字体解密(学习通测验大量使用 font-cxsecret 字体加密,
  // DOM 里的 textContent 是乱码,直接判"正确/错误"永远判不出——这是判断题失效的隐蔽原因)
  function judgeTextOf(node) {
    const raw = String((node && node.textContent) || '');
    let dec = raw;
    try { if (typeof applyDecryptText === 'function') dec = applyDecryptText(raw); } catch (e) { /* ignore */ }
    return dec || raw;
  }
  function judgeSlotSide(node) {
    try {
      const inp = node.querySelector && node.querySelector('input[type=radio], input[type=checkbox], input');
      if (inp) {
        const s = judgeSideOfValue(inp.value);
        if (s !== null) return s;
        const sv = judgeSideOfText(inp.value);     // value="对"/"错"
        if (sv !== null) return sv;
      }
      const s = judgeSideOfText(judgeTextOf(node));
      if (s !== null) return s;
      const lab = node.querySelector && node.querySelector('label');
      if (lab) return judgeSideOfText(judgeTextOf(lab));
    } catch (e) { /* ignore */ }
    return null;
  }
  // 选项容器:把命中节点向上归并到"可点容器",避免点到内层 span 而站点只监听 li/label
  function judgeBoxOf(n) {
    try { return n.closest('li, .answerBg, .answer_p, .option-item, .option, label, dd') || n; } catch (e) { return n; }
  }
  function judgeGroupInputs(scope) {
    try { return Array.from(scope.querySelectorAll('input[type=radio], input[type=checkbox]')); } catch (e) { return []; }
  }
  // 收集判断题的选项容器。
  // 不再依赖固定类名(各版本类名差异大):凡"文字(解密后)或取值能判出对错"的短文本节点都算,
  // 再向上归并成选项容器、去重、只留最内层,按文档顺序排列。li 式 / div 式 / label 式 / √× / true·false 全命中。
  function judgeSlots(el) {
    const boxes = [];
    const add = (n) => { if (n && boxes.indexOf(n) < 0) boxes.push(n); };
    let all = [];
    try { all = Array.from(el.querySelectorAll('*')); } catch (e) { all = []; }
    for (const n of all) {
      if (n.children && n.children.length > 3) continue;      // 深容器(整块题目)不算选项
      const t = judgeNormText(judgeTextOf(n));
      if (!t || t.length > 8) continue;
      if (!/^(正确|对|是|√|✓|错误|错|否|×|✗|true|false|t|f)$/i.test(t)) continue;
      add(judgeBoxOf(n));
    }
    // 控件取值能判出对错的也算(选项文字是图片/加密没解开时,value 仍可能是 true/false、对/错)
    judgeGroupInputs(el).forEach((inp) => {
      if (judgeSideOfValue(inp.value) !== null || judgeSideOfText(inp.value) !== null) add(judgeBoxOf(inp));
    });
    let uniq = boxes.filter((n, i) => boxes.indexOf(n) === i);
    uniq = uniq.filter((n) => !uniq.some((m) => m !== n && n.contains(m)));
    if (uniq.length) {
      uniq.sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1));
      return uniq.slice(0, 6);
    }
    // 兜底:老式 ul li 结构
    for (const s of ['ul li', '.Zy_ulTop li', 'li.answer_p', '.answerBg', 'dd', 'label']) {
      try { Array.from(el.querySelectorAll(s)).forEach(add); } catch (e) { /* ignore */ }
    }
    return boxes.filter((n) => judgeSlotSide(n) !== null).slice(0, 6);
  }
  // 校验是否真的选中了"想要的那一侧"(按整题的 radio 组判断,而不是只看被点容器内部)
  function judgePickedOk(node, scope, want) {
    const checked = judgeGroupInputs(scope).filter((i) => i.checked);
    if (!checked.length) return false;
    return checked.some((i) => {
      const side = judgeSideOfValue(i.value);
      if (side !== null) return side === want;
      const sv = judgeSideOfText(i.value);
      if (sv !== null) return sv === want;
      // value 是 A/B 这类:看被选中的控件是不是在我们点的那个容器里
      const box = judgeBoxOf(i);
      try { return box === node || box.contains(node) || node.contains(box); } catch (e) { return false; }
    });
  }
  // 点击并校验:input → label → 内部文字 → 容器 → 整题两个 radio 兜底
  // 完整鼠标事件序列:部分版本只监听 pointer 系事件,或要求完整按下-抬起流程才认
  function judgeFire(t) {
    // 必须用"元素自己所属 window"的构造器:脚本常运行在顶层页,而题目在内层 iframe,
    // 跨 realm 派发事件时内联处理器里的 window.event 等会取不到值(踩过)
    const w = (t && t.ownerDocument && t.ownerDocument.defaultView) || window;
    const PE = w.PointerEvent || w.MouseEvent || MouseEvent;
    const ME = w.MouseEvent || MouseEvent;
    const seq = [
      ['pointerdown', PE], ['mousedown', ME],
      ['pointerup', PE], ['mouseup', ME],
      ['click', ME]
    ];
    for (const [ty, Ev] of seq) {
      try { t.dispatchEvent(new Ev(ty, { bubbles: true, cancelable: true, view: w })); } catch (e) { /* ignore */ }
    }
  }
  // 状态快照:div 式选项(无 input)的"选中标记"可能以任意形式(类名/样式/隐藏域)加在本题任意元素上,
  // 用整题 DOM 前后对比来判定点击是否真的生效,而不是只看被点容器自己的 class
  function judgeSnap(scope) {
    try { return (scope.closest('.TiMu') || scope).innerHTML; } catch (e) { try { return scope.innerHTML; } catch (e2) { return ''; } }
  }
  // 点击并校验:input → label/内部子元素逐个试点 → 整题两个 radio 兜底。
  // 每次点击后都校验:radio 组选中了想要的一侧 / 整题 DOM 有变化 / 页面任意处有变化(答题卡"已答 N 题"计数)
  function judgeClick(node, scope, want) {
    // 先滚到可视区:部分版本对不可见选项的点击事件不响应/处理器懒绑定
    try { node.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ }
    // 1) 有 input 的版本:点真控件,radio.checked 可精确校验
    try { Array.from(node.querySelectorAll('input[type=radio], input[type=checkbox]')).forEach((inp) => { if (!inp.checked) inp.click(); }); } catch (e) { /* ignore */ }
    if (judgePickedOk(node, scope, want)) return true;

    // 2) 无 input 的 div 式选项:事件委托的处理器可能绑在任意一层/任意子元素上,
    //    把 label + 常见内层元素 + 容器本身逐个试点,每次点击后用快照对比判断是否生效
    const snap = judgeSnap(scope);
    const elDoc = (node.ownerDocument) || document;
    let bodySnap = null;
    try { bodySnap = elDoc.body ? elDoc.body.innerHTML : null; } catch (e) { /* ignore */ }
    const targets = [node];
    try {
      const lab = node.querySelector('label');
      if (lab) targets.push(lab);
      targets.push(...Array.from(node.querySelectorAll('a, span, i, b, em, p, .num_option, .before, .after')).slice(0, 10));
    } catch (e) { /* ignore */ }
    for (const t of targets) {
      judgeFire(t);
      if (judgePickedOk(node, scope, want)) return true;
      if (judgeSnap(scope) !== snap) return true;                     // 题面内任意状态变化
      if (bodySnap !== null && elDoc.body && elDoc.body.innerHTML !== bodySnap) return true;   // 标记在题面之外(答题卡计数等)
    }
    // 3) 硬兜底:整题只有两个 radio → 按"第一=正确、第二=错误"直接点
    const group = judgeGroupInputs(scope);
    if (group.length === 2 && want !== null) {
      try { group[want ? 0 : 1].click(); } catch (e) { /* ignore */ }
      if (judgePickedOk(node, scope, want) || judgeSnap(scope) !== snap) return true;
    }
    // 4) 直调页面自己的选项处理函数:onclick="addChoice(this)" 把函数名写在属性里。
    //    关键:① 优先调用元素自己的 onclick 函数对象(它天然绑定在元素所属 window 的作用域里,
    //    脚本在顶层运行时也能正确解析到 iframe 内的 addChoice/addMultipleChoice);
    //    ② 其次才去元素所属 window 上找同名全局函数(以前优先 unsafeWindow=顶层 window,跨 iframe 时永远找不到)
    try {
      let callee = node;
      for (let depth = 0; callee && depth < 3 && !(callee.getAttribute && callee.getAttribute('onclick')); depth++) callee = callee.parentElement;
      const inlineFn = callee && callee.onclick;
      if (typeof inlineFn === 'function') {
        try { inlineFn.call(callee); } catch (e) { /* 内联函数内部异常不影响后面的兜底 */ }
        if (judgePickedOk(node, scope, want) || judgeSnap(scope) !== snap) return true;
        if (choiceRecorded(scope) !== false) return true;   // 页面已记录答案(隐藏域/选中标记)
      }
      const pageWin = (node.ownerDocument && node.ownerDocument.defaultView)
        || (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
      const attr = callee && callee.getAttribute && callee.getAttribute('onclick');
      const fm = attr && attr.match(/([A-Za-z_$][\w$]*)\s*\(/);
      if (fm) {
        const fn = pageWin[fm[1]];
        if (typeof fn === 'function') {
          fn.call(callee || node, node);
          if (judgePickedOk(node, scope, want) || judgeSnap(scope) !== snap) return true;
          return true;   // 页面自己的处理器已被调用,选中与否由页面逻辑决定
        }
      }
    } catch (e) { /* ignore */ }
    // 5) 最后手段:页面用 jQuery 绑的事件(含事件委托绑在祖先上的),把处理器直接调起来。
    //    合成事件无法通过 isTrusted 校验,但直接调处理器和真实点击到达处理器是等效的
    try {
      const dv = (node.ownerDocument && node.ownerDocument.defaultView) || window;
      const jq = (dv && dv.jQuery) || window.jQuery;
      if (jq && jq.Event && jq._data) {
        const fakeEv = (type) => { const ev = new jq.Event(type, { bubbles: true, cancelable: true }); ev.target = node; return ev; };
        const runElem = (elem, types) => {
          let fired = false;
          for (const type of types) {
            const evs = (jq._data(elem, 'events') || {})[type];
            if (!evs) continue;
            Array.from(evs).forEach((h) => {
              try { h.handler.call(elem, fakeEv(type)); fired = true; } catch (e) { /* ignore */ }
            });
          }
          return fired;
        };
        let hit = runElem(node, ['click', 'pointerdown', 'mousedown', 'touchstart']);
        const root = (node.ownerDocument && node.ownerDocument.documentElement) || document.documentElement;
        for (let anc = node.parentElement; anc && anc !== root && !hit; anc = anc.parentElement) {
          hit = runElem(anc, ['click', 'pointerdown', 'mousedown']);
        }
        if (hit) {
          if (judgePickedOk(node, scope, want) || judgeSnap(scope) !== snap) return true;
          return true;   // 处理器已被真实调用,选中与否由页面自己的逻辑决定
        }
      }
    } catch (e) { /* ignore */ }
    return false;
  }
  // 失败时输出一行结构摘要,便于按各版本差异继续适配(直接看面板日志即可)
  // 失败时把判断题的真实 DOM 结构回传本地服务(探针记录),便于按真实结构精准适配,不再盲猜。
  // 必须走 cxFetch(GM 特权请求):页面原生 fetch 会被学习通的 CSP 拦截,静默失败(踩过)
  let judgeProbeCount = 0;
  // 失败时把本题真实 DOM 结构回传本地服务(探针记录),便于按真实结构精准适配,不再盲猜。
  // 必须走 cxFetch(GM 特权请求):页面原生 fetch 会被学习通的 CSP 拦截,静默失败(踩过)
  // tag: 'judge'(判断题,默认) / 'choice'(选择题)
  function judgeReportStructure(el, why, tag) {
    if (judgeProbeCount >= 6) return;
    judgeProbeCount++;
    try {
      const host = el.closest('.TiMu') || el.closest('.questionLi') || el;
      const html = String(host.outerHTML || '').slice(0, 5000);
      // 页面状态信息:隐藏域当前值 / 处理函数是否存在 / 是否已提交(选中标记、提示文字)
      const state = {};
      try {
        state.hiddens = Array.from(el.querySelectorAll('input[type=hidden]')).slice(0, 4)
          .map((h) => (h.name || h.id) + '=' + String(h.value || '').slice(0, 8)).join('|');
        const pageWin = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || el.ownerDocument.defaultView || window;
        state.addChoice = typeof (pageWin && pageWin.addChoice);
        const docText = String(el.ownerDocument.body.innerText || '');
        state.submittedHint = (docText.match(/已提交|不能重复|已用过|截止/) || [''])[0];
        state.checkCount = el.querySelectorAll('.check_answer').length;
        // 选项容器的 class 名与 onclick(新版结构常在这里露出绑定方式)
        state.liClasses = Array.from(el.querySelectorAll('ul li, li')).slice(0, 4)
          .map((n) => String(n.className || n.tagName) + (n.getAttribute('onclick') ? '@' + String(n.getAttribute('onclick')).slice(0, 30) : '')).join('|');
        state.jQuery = !!(function () { try { return (el.ownerDocument.defaultView || window).jQuery; } catch (e) { return false; } })();
      } catch (e) { /* ignore */ }
      cxFetch((CONFIG.webAiRelay || 'http://127.0.0.1:8790') + '/api/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ host: location.hostname, path: location.pathname, reason: (tag || 'judge') + '-' + why, html, state, href: location.href }),
        timeout: 6000
      }).catch(() => { /* ignore */ });
    } catch (e) { /* ignore */ }
  }
  function judgeDiag(el) {
    try {
      const radios = judgeGroupInputs(el);
      const vals = radios.map((r) => String(r.value) + (r.checked ? '✓' : '')).join(',');
      const texts = Array.from(el.querySelectorAll('li, .answerBg, .answer_p, label, dd'))
        .map((n) => judgeNormText(judgeTextOf(n)).slice(0, 6))
        .filter((t, i, a) => t && a.indexOf(t) === i).slice(0, 4).join('|');
      // 选项容器的 class 名(脱敏截断):再失配时能直接看出该版本的真实结构
      const boxes = Array.from(el.querySelectorAll('li, .answerBg, .answer_p, .option-item, label, dd'))
        .slice(0, 2)
        .map((n) => String(n.className || n.tagName).replace(/\s+/g, '.').slice(0, 26))
        .join('|');
      return ` 【诊断】radio=${radios.length}(${vals || '-'}) 选项=${texts || '无'} 容器=${boxes || '无'}`;
    } catch (e) { return ''; }
  }
  // 读取选项的答案值:新版作业页选项 li 带点击写隐藏域,答案值在 .num_option 的 data 属性里
  function choiceDataOf(li) {
    try {
      const sp = li.querySelector('.num_option');
      return sp ? String(sp.getAttribute('data') || sp.textContent || '').trim() : '';
    } catch (e) { return ''; }
  }
  // 页面是否已记录本题答案:answer<qid> 隐藏域有值,或出现选中标记
  function choiceRecorded(el) {
    try {
      if (el.querySelectorAll('.check_answer').length) return true;
      const hids = Array.from(el.querySelectorAll('input[type=hidden]')).filter((h) => /^answer\d+$/.test(h.id || h.name || ''));
      return hids.length ? hids.some((h) => String(h.value || '').length > 0) : null;
    } catch (e) { return null; }
  }
  // 兜底:直接把答案写进 answer<qid> 隐藏域——addChoice 的本质就是写它,提交时页面读的也是它
  function choiceWriteHidden(el, li) {
    try {
      const target = li.closest('li[qid]') || li;
      const qid = target.getAttribute('qid');
      if (!qid) return false;
      const data = choiceDataOf(target);
      const hid = el.ownerDocument.getElementById('answer' + qid) || el.querySelector('#answer' + qid);
      if (!hid || !data || String(hid.value || '')) return false;
      hid.value = data;
      try { target.classList.add('check_answer'); } catch (e) { /* ignore */ }
      return true;
    } catch (e) { return false; }
  }
  /* ===== 选择题(单选/多选)专用:选项容器定位 + 单次点击 + 逐项校验 =====
     多选最容易坏在"一次点击触发两次处理器"上:input.click() 再把 click 冒泡到 li,
     li 上的 addChoice 被调用两次,而多选的 addChoice 是 toggle —— 选上又被取消,看起来就是"多选选不了"。
     所以这里① 每个选项只点一次(点完用整题快照/隐藏域校验是否生效);② 以 answer<qid> 隐藏域为准纠偏。 */
  // 取一组与选项对齐的可点容器:各版本结构差异大(ul li / dd / .answerBg / div 式)
  function choiceBoxes(el) {
    const sels = ['ul li', '.Zy_ulTop li', '.answer_p li', 'li.answer_p', '.answerBg', '.option-item', 'dd'];
    for (const s of sels) {
      let arr = [];
      try { arr = Array.from(el.querySelectorAll(s)); } catch (e) { arr = []; }
      arr = arr.filter((n) => !arr.some((m) => m !== n && n.contains(m)));   // 只留最内层,避免同一选项算两次
      arr = arr.filter((n) => String(n.textContent || '').trim().length > 0);
      if (arr.length >= 2) return arr;
    }
    return [];
  }
  // 答案隐藏域 answer<qid>(学习通提交时读的就是它)
  function choiceHiddenOf(el, li) {
    try {
      const t = (li.closest && li.closest('li[qid]')) || li;
      const qid = t.getAttribute && t.getAttribute('qid');
      if (!qid) return null;
      return el.ownerDocument.getElementById('answer' + qid) || el.querySelector('#answer' + qid);
    } catch (e) { return null; }
  }
  // 该选项当前是否已选中:优先看答案隐藏域(提交时页面读的就是它,重做场景也不会被残留 class 骗),
  // 没有隐藏域的版本再看真控件 checked / 选中标记 class
  function choicePicked(el, li) {
    try {
      const hid = choiceHiddenOf(el, li);
      const data = choiceDataOf(li);
      if (hid && data) return String(hid.value || '').includes(data);
    } catch (e) { /* ignore */ }
    try {
      const inp = li.querySelector('input[type=radio], input[type=checkbox]');
      if (inp && inp.checked) return true;
    } catch (e) { /* ignore */ }
    try {
      if (li.classList.contains('check_answer') || li.querySelector('.check_answer')) return true;
    } catch (e) { /* ignore */ }
    return false;
  }
  // 选项点击前/后的状态指纹:真控件勾选 + 本题隐藏域取值 + 选中标记数量。
  // 只看 innerHTML 不够——页面写 answer<qid>.value 不会改变 innerHTML,会被误判"没生效"而重复点击(多选被 toggle 抵消)
  function choiceSig(el, li) {
    let s = '';
    try {
      const inp = li.querySelector('input[type=radio], input[type=checkbox]');
      s += inp && inp.checked ? '1' : '0';
    } catch (e) { /* ignore */ }
    try {
      const hs = Array.from(el.querySelectorAll('input[type=hidden]'));
      s += '|' + hs.map((h) => String(h.value || '')).join(',');
    } catch (e) { /* ignore */ }
    try { s += '|' + el.querySelectorAll('.check_answer').length; } catch (e) { /* ignore */ }
    return s;
  }
  // 只点一次。入口按"页面真实绑定位置"择优:li 自带 onclick(addChoice) → 点 li;
  // 否则 label / 内层 a·span·.num_option → 容器 → 真控件。
  // 点完用"隐藏域 + 题内 DOM + 整页 DOM"三层指纹校验是否生效;事件路径全失败时
  // 直调页面自己的处理函数(内联 onclick / jQuery 绑定),绕过合成事件 isTrusted 校验。
  function choiceClickOnce(el, li) {
    const before = judgeSnap(el);
    const beforeSig = choiceSig(el, li);
    const elDoc = (li.ownerDocument) || document;
    let bodyBefore = null;
    try { bodyBefore = elDoc.body ? String(elDoc.body.innerHTML) : null; } catch (e) { bodyBefore = null; }
    const changed = () => {
      try { if (choiceSig(el, li) !== beforeSig) return true; } catch (e) { /* ignore */ }
      try { if (judgeSnap(el) !== before) return true; } catch (e) { /* ignore */ }
      try { if (bodyBefore !== null && elDoc.body && String(elDoc.body.innerHTML) !== bodyBefore) return true; } catch (e) { /* ignore */ }
      return false;
    };
    const attr = (n) => { try { return (n.getAttribute && n.getAttribute('onclick')) || ''; } catch (e) { return ''; } };
    const fire = (t) => {
      try { t.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ }
      try { judgeFire(t); } catch (e) { try { t.click(); } catch (e2) { /* ignore */ } }
    };
    const tries = [];
    if (attr(li)) tries.push(li);
    for (const s of ['label', 'a', '.num_option', '.after', 'span', 'i']) {
      try { const t = li.querySelector(s); if (t) tries.push(t); } catch (e) { /* ignore */ }
    }
    if (!attr(li)) tries.push(li);
    try { const inp = li.querySelector('input[type=radio], input[type=checkbox]'); if (inp) tries.push(inp); } catch (e) { /* ignore */ }
    for (const t of tries) {
      fire(t);
      if (changed()) return true;
      if (choicePicked(el, li)) return true;
    }
    // 兜底1:直接调用元素自己的 onclick 函数对象(onclick="addMultipleChoice(this)")。
    // 它天然绑定在元素所属 window 的作用域里,脚本跑在顶层时也能解析到 iframe 内的函数
    // —— 这是"跨 iframe 取不到页面全局函数"的正解
    try {
      let callee = li;
      for (let d = 0; callee && d < 3 && !(callee.getAttribute && callee.getAttribute('onclick')); d++) callee = callee.parentElement;
      const inlineFn = callee && callee.onclick;
      if (typeof inlineFn === 'function') {
        try { inlineFn.call(callee); } catch (e) { /* 内联函数内部异常不影响后面的兜底 */ }
        if (changed() || choicePicked(el, li)) return true;
      }
      // 兜底2:元素所属 window 上的同名全局函数(注意不是 unsafeWindow=顶层 window)
      const pageWin = (li.ownerDocument && li.ownerDocument.defaultView)
        || (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
      const a2 = callee && callee.getAttribute && callee.getAttribute('onclick');
      const fm = a2 && a2.match(/([A-Za-z_$][\w$]*)\s*\(/);
      if (fm) {
        const fn = pageWin[fm[1]];
        if (typeof fn === 'function') {
          fn.call(callee || li, li);
          if (changed() || choicePicked(el, li)) return true;
          return true;   // 处理器已被调用,选中与否由页面逻辑决定
        }
      }
    } catch (e) { /* ignore */ }
    // 兜底3:页面用 jQuery 绑定(含委托绑在祖先)——把处理器直接调起来,绕过 isTrusted 检查
    try {
      const dv = li.ownerDocument && li.ownerDocument.defaultView;
      const jq = (dv && dv.jQuery) || window.jQuery || (typeof unsafeWindow !== 'undefined' && unsafeWindow && unsafeWindow.jQuery);
      if (jq && jq.Event && jq._data) {
        const fakeEv = (type) => { const ev = new jq.Event(type, { bubbles: true, cancelable: true }); ev.target = li; return ev; };
        const runElem = (elem, types) => {
          let fired = false;
          for (const type of types) {
            const evs = (jq._data(elem, 'events') || {})[type];
            if (!evs) continue;
            Array.from(evs).forEach((h) => { try { h.handler.call(elem, fakeEv(type)); fired = true; } catch (e) { /* ignore */ } });
          }
          return fired;
        };
        let hit = runElem(li, ['click', 'pointerdown', 'mousedown', 'touchstart']);
        const root = (li.ownerDocument && li.ownerDocument.documentElement) || document.documentElement;
        for (let anc = li.parentElement; anc && anc !== root && !hit; anc = anc.parentElement) {
          hit = runElem(anc, ['click', 'pointerdown', 'mousedown']);
        }
        if (hit) return true;   // 处理器已被真实调用
      }
    } catch (e) { /* ignore */ }
    return false;
  }
  // 以隐藏域为准纠偏:多选必须包含全部目标项(点击可能只记最后一个),单选必须等于目标项
  function choiceSyncHidden(el, lis, idx, isMulti) {
    try {
      const datas = idx.map((i) => (lis[i] ? choiceDataOf(lis[i]) : '')).filter(Boolean);
      if (!datas.length) return false;
      const hid = choiceHiddenOf(el, lis[idx[0]]);
      if (!hid) return false;
      const need = isMulti ? datas.join('') : datas[0];
      const cur = String(hid.value || '');
      if (cur === need) return false;
      if (isMulti && idx.every((i, k) => cur.includes(datas[k]))) return false;
      hid.value = need;
      // 同步选中标记,避免"答案已写但页面看着没选"
      try {
        lis.forEach((li, i) => {
          if (idx.includes(i)) li.classList.add('check_answer');
          else if (!isMulti) li.classList.remove('check_answer');
        });
      } catch (e) { /* ignore */ }
      return true;
    } catch (e) { return false; }
  }
  // 目标选项是否已被页面标记为选中:aria-checked/aria-pressed、check_answer 标记、真控件勾选。
  // 新版学习通无 input,选中态就写在 li 的 aria-* 和 span.check_answer 上,靠这些判定最直接
  function judgeTargetMarked(target) {
    try {
      const cands = [target];
      try { cands.push(...Array.from(target.querySelectorAll('*')).slice(0, 8)); } catch (e) { /* ignore */ }
      for (const n of cands) {
        const ac = n.getAttribute && (n.getAttribute('aria-checked') || n.getAttribute('aria-pressed'));
        if (ac === 'true') return true;
        if (n.classList && n.classList.contains('check_answer')) return true;
        const inp = n.querySelector && n.querySelector('input[type=radio], input[type=checkbox]');
        if (inp && inp.checked) return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }
  function fillJudgeAnswer(answerArr, q, el) {
    let want = judgeDesiredSide(answerArr, q.options || []);
    if (CONFIG.deliberateErrorRate > 0 && Math.random() < CONFIG.deliberateErrorRate) {
      if (want !== null) { want = !want; log('🎭 拟人模式:本题故意答错(配置概率)', 'info'); }
    }
    clearCurrent(el);
    if (want === null) {
      log(`⚠ 判断题:答案「${(answerArr || []).join('/') || '空'}」无法识别对错` + judgeDiag(el), 'warn');
      return false;
    }
    const slots = judgeSlots(el);
    let target = null;
    for (const s of slots) if (judgeSlotSide(s) === want) { target = s; break; }
    // 选项文字判不出(图片/加密未解开):按学习通固定顺序兜底 —— 第一个=正确、第二个=错误
    if (!target && slots.length === 2) target = slots[want ? 0 : 1];
    // 连选项容器都没识别到:整题只有两个 radio 时直接按顺序取
    if (!target) {
      const group = judgeGroupInputs(el);
      if (group.length === 2) target = judgeBoxOf(group[want ? 0 : 1]);
    }
    // 完全没有 input、选项文字也读不出(div 式 + 乱码):按通用选项容器顺序兜底
    if (!target) {
      const gen = Array.from(el.querySelectorAll('.answerBg, .answer_p, .option-item, .option, li, dd'))
        .filter((n, i, a) => a.indexOf(n) === i)
        .filter((n) => { const t = judgeNormText(judgeTextOf(n)); return t.length > 0 && t.length <= 30; });
      const leaves = gen.filter((n) => !gen.some((m) => m !== n && n.contains(m)));
      if (leaves.length === 2) target = leaves[want ? 0 : 1];
    }
    if (!target) {
      log('⚠ 判断题:没找到可点的选项' + judgeDiag(el), 'warn');
      judgeReportStructure(el, 'no-target');
      return false;
    }
    const ok = judgeClick(target, el, want);
    const rec = choiceRecorded(el);
    if (ok && rec !== false) return true;
    // 页面已经把目标选项标记成选中了(aria-checked / check_answer / 真控件):
    // 即使点击路径没捕捉到变化(跨 iframe 检测不到整页变化等),也应算成功,否则会白丢正确答案
    if (judgeTargetMarked(target)) {
      if (!ok) log('✓ 判断题:点击已生效(按页面选中标记确认)', 'info');
      return true;
    }
    if (ok && rec === false) log('⚠ 判断题:点击执行了但页面未记录答案,尝试直接写入', 'warn');
    // 终极兜底:直接写 answer<qid> 隐藏域(与 addChoice 等效,提交时页面读的就是它)
    if (choiceWriteHidden(el, target)) {
      log(`⚠ 判断题:点击未被页面记录,已直接写入答案隐藏域`, 'warn');
      return true;
    }
    log('⚠ 判断题:点击后未生效' + judgeDiag(el), 'warn');
    judgeReportStructure(el, 'no-effect');
    return false;
  }

  function setQuizAnswer(answerArr, q, el, win) {
    const $$ = (sel) => Array.from(el.querySelectorAll(sel));
    // 题型可能被判错(隐藏域版本差异):选项本身就只有"正确/错误"时,按判断题处理最可靠
    let qType = String(q.type);
    if (qType !== '3') {
      const opts = q.options || [];
      const s0 = opts.length === 2 ? judgeSideOfText(opts[0]) : null;
      const s1 = opts.length === 2 ? judgeSideOfText(opts[1]) : null;
      if (s0 !== null && s1 !== null && s0 !== s1) qType = '3';
    }
    switch (qType) {
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
        const lis = choiceBoxes(el);
        if (lis.length) {
          // 题型是单选但答案匹配到多个选项(题型判错/AI 给了组合答案):按多选处理,避免只选第一个
          const isMulti = qType === '1' || idx.length > 1;
          const want = idx.filter((i) => i < lis.length).sort((a, b) => a - b);
          if (!want.length) return false;
          let confirmed = 0;   // 确认选中(检测到勾选/选中标记/隐藏域)
          let acted = 0;       // 页面对点击有反应(可能已选中,只是选中标记的 class 名不标准)
          for (const i of want) {
            const li = lis[i];
            if (!li) continue;
            if (choicePicked(el, li)) { confirmed++; acted++; continue; }   // 已选中不要再点(多选 toggle 会取消)
            let ok = choiceClickOnce(el, li);
            if (!ok && !choicePicked(el, li)) ok = choiceClickOnce(el, li);   // 完全无反应才补一次,防止 toggle 抵消
            if (ok) acted++;
            if (choicePicked(el, li)) confirmed++;
          }
          // 兜底:点击没被页面记录(addChoice 没触发/合成事件被忽略)→ 直接写隐藏域,提交时页面读的就是它
          const wrote = choiceSyncHidden(el, lis, want, isMulti);
          if (wrote) log(`⚠ 选择题:选项点击未被页面记录,已直接写入答案隐藏域(${isMulti ? '多选' : '单选'})`, 'warn');
          const okChoice = wrote || confirmed > 0 || acted === want.length;
          if (!okChoice) {
            log(`⚠ 选择题:${want.length} 个选项点击均未生效,也没有答案隐藏域可写` + judgeDiag(el), 'warn');
            judgeReportStructure(el, 'no-effect', 'choice');   // 回传真实结构,便于按版本精准适配
          } else if (confirmed < want.length) {
            log(`⚠ 选择题:${want.length - confirmed}/${want.length} 个选项未确认选中(页面的选中标记不标准),如提交后发现没选上请反馈`, 'warn');
          }
          return okChoice;
        }
        // 兜底1:直接点第 idx 个选项控件
        const inputs = $$('input[type=radio], input[type=checkbox]');
        if (inputs.length) {
          idx.forEach((i) => { const inp = inputs[i]; if (inp && !inp.checked) { try { inp.click(); } catch (e) { /* ignore */ } } });
          return true;
        }
        // 兜底2:点第 idx 个常见选项容器(按元素在题内的顺序对齐选项)
        const optEls = $$('.answerBg, .after, .ans-opt');
        if (optEls.length) {
          const leaves = optEls.filter((n) => !optEls.some((m) => m !== n && n.contains(m)));
          idx.forEach((i) => { const o = leaves[i]; if (o) { try { o.click(); } catch (e) { /* ignore */ } } });
          return true;
        }
        return false;
      }
      case '3': {
        // 判断题统一走 fillJudgeAnswer:语义归一 + 控件定位 + 点击校验(见上方注释)
        return fillJudgeAnswer(answerArr, q, el);
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
  /* ==================== 题目容器统一识别(弹题/章节测验/学习检测通用) ==================== */
  // 题目容器:老版 .TiMu、新版 .questionLi、以及若干变体
  const QUIZ_ITEM_SEL = '.TiMu, .questionLi, .question-item, .q_item, .mark_item';
  // 测验类 iframe 的 src 特征:新版很多直接嵌 /mooc2/work/dowork,不再套 ananas/modules/work
  const WORK_SRC_RE = /(\/ananas\/modules\/work\/|\/work\/doHomeWorkNew|\/mooc2?\/work\/dowork|\/mooc-ans\/work\/|\/dowork\b)/;
  const isWorkSrc = (src) => WORK_SRC_RE.test(String(src || ''));
  // 音视频 frame 不参与"整页搜题目",避免把弹题抢走
  const AV_SRC_RE = /\/ananas\/modules\/(video|audio)\//;

  // 在 win 及其同源子 iframe 里递归找题目容器(最多 3 层),返回 { win, els }
  function findQuizTree(win, depth = 0, skipAv = true, seen = null) {
    if (!win || depth > 3) return null;
    seen = seen || [];
    if (seen.indexOf(win) >= 0) return null;
    seen.push(win);
    let els = [];
    try { els = Array.from(win.document.querySelectorAll(QUIZ_ITEM_SEL)); } catch (e) { return null; }
    if (els.length) return { win, els };
    let frames = [];
    try { frames = Array.from(win.document.querySelectorAll('iframe')); } catch (e) { return null; }
    for (const f of frames) {
      if (skipAv && AV_SRC_RE.test(String(f.src || ''))) continue;
      let w = null;
      try { w = f.contentWindow; } catch (e) { continue; }
      const r = findQuizTree(w, depth + 1, skipAv, seen);
      if (r) return r;
    }
    return null;
  }

  // 诊断:列出 win 内所有 iframe 的 src,结构改版时据此修选择器
  function dumpFrames(win, tag) {
    try {
      const frames = Array.from(win.document.querySelectorAll('iframe'));
      const srcs = frames.map((f) => String(f.src || f.getAttribute('data') || '(空)').slice(0, 110));
      log(`🔍 侦察(${tag}):${frames.length} 个 iframe → ${JSON.stringify(srcs)}`, 'info');
    } catch (e) { log('🔍 侦察失败(' + tag + '): ' + (e.message || e), 'warn'); }
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
        // 走统一实现:语义归一 + 控件定位 + 点击校验(覆盖 value=对/错、div 式选项等版本差异)
        return fillJudgeAnswer(answerArr, q, el);
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
      const boxes = choiceBoxes(el);
      const lis = boxes.length ? boxes : Array.from(el.querySelectorAll('li'));
      if (!lis.length) return false;
      lis.forEach((li, i) => {
        if (!idx.includes(i)) return;
        if (choicePicked(el, li)) return;      // 已选中不再点:多选的处理器是 toggle,点两次会被取消
        choiceClickOnce(el, li);
      });
      // 点击没被页面记录时以隐藏域为准补齐(多选必须包含全部目标项)
      const want = idx.filter((i) => i < lis.length).sort((a, b) => a - b);
      if (want.length) choiceSyncHidden(el, lis, want, want.length > 1);
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
    await waitIframeLoaded(iframe, 60000, runAborted);
    const win = iframe.contentWindow;
    const startHref = (function () { try { return win.location.href; } catch (e) { return ''; } })();
    await waitElementLoaded(win, '#video_html5_api', 90000, () => runAborted() || !iframe.isConnected);
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
      // 卡死看门狗:进度 3 分钟不动、或 iframe 已被切走(播放器对象失效)就收手,
      // 否则老轮次会一直空转,新页面永远等不到它结束
      let lastCur = -1;
      let lastProgressAt = Date.now();
      const frameAlive = () => {
        try { return iframe.isConnected && (!startHref || win.location.href === startHref); } catch (e) { return false; }
      };
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
          if (runAborted()) {
            try { player.pause(); } catch (e) { /* ignore */ }
            log(PAUSED ? '⏸ 已暂停,视频停在此处(点 ▶ 从当前进度继续)' : '🔀 页面已切换,结束本任务点', 'warn');
            finish();
            return;
          }
          if (!frameAlive()) {
            log('🔀 页面已切走,结束本任务点(等待按新页面重扫)', 'warn');
            finish();
            return;
          }
          const cur = (function () { try { return player.currentTime() || 0; } catch (e) { return 0; } })();
          if (cur > lastCur + 0.01) { lastCur = cur; lastProgressAt = Date.now(); }
          if (Date.now() - lastProgressAt > 180000) {
            log('⚠ 视频 3 分钟没有进度,结束本任务点(避免卡死;可刷新页面重试)', 'warn');
            finish();
            return;
          }
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
    await waitIframeLoaded(iframe, 60000, runAborted);
    const win = iframe.contentWindow;
    await waitElementLoaded(win, '#audio_html5_api', 90000, () => runAborted() || !iframe.isConnected);
    const audio = win.document.getElementById('audio_html5_api');
    audio.muted = true;
    audio.volume = 0;
    try { audio.play().catch(() => { /* 首次可能需要用户点击页面 */ }); } catch (e) { /* ignore */ }
    log('♪ 开始播放音频(静音)', 'ok');
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        if (runAborted()) { try { audio.pause(); } catch (e) { /* ignore */ } log('⏸ 已暂停,音频停在此处', 'warn'); clearInterval(timer); resolve(); return; }
        if (!iframe.isConnected) { clearInterval(timer); resolve(); return; }
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

  // 通用:对一组题目元素逐题作答(不提交),返回成功题数
  async function answerQuizElements(win, els, label) {
    let okCount = 0;
    for (let i = 0; i < els.length; i++) {
      if (runAborted()) { log(`⏸ 已暂停,第 ${i + 1}/${els.length} 题起停止`, 'warn'); break; }
      const el = els[i];
      await randomSleep(CONFIG.answerIntervalMin, CONFIG.answerIntervalMax);
      const isWorkEl = /questionLi|mark_item|question-item|q_item/.test(el.className || '');
      const q = (isWorkEl ? extractWorkQuestion(el) : extractQuizQuestion(el))
        || extractWorkQuestion(el) || extractQuizQuestion(el);
      if (!q) { log(`第 ${i + 1}/${els.length} 题:未解析到题干`, 'warn'); continue; }
      const answers = await getAnswers(q);
      const ok = setQuizAnswer(answers, q, el, win);
      if (ok) okCount++;
      log(`第 ${i + 1}/${els.length} 题(类型 ${q.type}) ${ok ? '✓ 已作答' : '✗ 无答案'}`, ok ? 'ok' : 'warn');
    }
    if (label) log(`${label}作答完成(${okCount}/${els.length})`, 'ok');
    return okCount;
  }

  async function workTask(iframe) {
    try { await waitIframeLoaded(iframe, 60000, () => runAborted() || !iframe.isConnected); } catch (e) {
      if (runAborted() || !iframe.isConnected) return;
    }   // 超时也继续尝试:内容可能已可读
    const outerWin = iframe.contentWindow;
    // 等题目出现:新版内层 iframe 常懒加载,最多等 20s。不再强依赖"必须存在内层 iframe"
    let quiz = null;
    for (let i = 0; i < 40 && !quiz; i++) {
      if (runAborted()) return;
      quiz = findQuizTree(outerWin);
      if (!quiz) await sleep(0.5);
    }
    // 兜底:题目挂在顶层弹窗/对话框的 iframe 里(学习检测、新版对话框)
    if (!quiz) quiz = findQuizTree(window);
    if (!quiz) {
      log('⚠ 未找到测验题目,跳过本任务点(不提交,不影响已有成绩)', 'warn');
      dumpFrames(outerWin, '测验');
      return;
    }
    const win = quiz.win;
    log(`🧩 题目容器已定位(共 ${quiz.els.length} 题,来源:${win === outerWin ? '模块页自身' : '内层 iframe'})`);

    // 网页 AI 模式:先把 AI 页拉起来、桥在线后才开始答题(未就绪不空跑)
    if (CONFIG.webAiEnabled && !(await webAiStartupGate())) {
      try { win.alert = () => {}; if (typeof win.noSubmit === 'function') win.noSubmit(); } catch (e) { /* ignore */ }
      return;
    }

    if (win.document.querySelector('.font-cxsecret') || extractFontBase64(win)) {
      log('🔐 测验检测到字体加密,正在自动解密...', 'warn');
      const decoded = await decodeFont(win, win.document.body);
      if (!decoded) {
        log('⚠ 字体解密未成功,跳过自动作答(不会乱提交)', 'warn');
        try { win.alert = () => {}; if (typeof win.noSubmit === 'function') win.noSubmit(); } catch (e) { /* ignore */ }
        return;
      }
    }
    // 逐题提取:同一页面可能混用 .TiMu 与 .questionLi,按元素类型各用各的解析器
    const els = quiz.els;
    const isWorkEl = (el) => /questionLi|mark_item|question-item|q_item/.test(el.className || '');
    const workStyle = els.every(isWorkEl);
    log(`📝 章节测验${workStyle ? '(作业结构)' : ''},共 ${els.length} 题`, 'ok');
    const tasks = [];
    for (const el of els) {
      const q = (isWorkEl(el) ? extractWorkQuestion(el) : extractQuizQuestion(el))
        || extractWorkQuestion(el) || extractQuizQuestion(el);
      if (q) tasks.push({ q, el });
      else log('⚠ 有 1 题题干未解析到,跳过该题', 'warn');
    }
    if (!tasks.length) {
      log('⚠ 题目容器存在但题干解析失败,跳过本任务点(不提交)', 'warn');
      dumpFrames(win, '题干解析');
      return;
    }
    let okCount = 0;
    STATS.jobsTotal = tasks.length;
    STATS.jobsDone = 0;
    let pausedMid = false;
    // 整卷模式:全部题目一次问网页 AI,按题号批量解析(缺漏的题在循环里回退逐题询问)
    let batchMap = null;
    if (CONFIG.webAiEnabled && CONFIG.webAiBatch) batchMap = await askBatchWebAI(tasks);
    for (let i = 0; i < tasks.length; i++) {
      const { q, el } = tasks[i];
      if (runAborted()) { pausedMid = true; log(`⏸ 已暂停,第 ${i + 1}/${tasks.length} 题起停止(点「开始」恢复后刷新重跑)`, 'warn'); break; }
      await randomSleep(CONFIG.answerIntervalMin, CONFIG.answerIntervalMax);
      if (runAborted()) { pausedMid = true; log(`⏸ 已暂停,第 ${i + 1}/${tasks.length} 题起停止`, 'warn'); break; }
      let answers = (batchMap && batchMap[i]) || [];
      if (answers.length) {
        STATS.answered++;
        log(`[网页AI·整卷] 查到答案: ${answers.join(' / ')}`, 'ok');
      } else {
        answers = await getAnswers(q);
      }
      let ok = false;
      let fail = '';
      if (!answers.length) fail = '未获取到答案';
      else {
        ok = setQuizAnswer(answers, q, el, win);
        if (!ok) fail = `答案「${answers.join('/')}」未匹配到选项(识别出 ${q.options ? q.options.length : 0} 个选项)`;
      }
      recordQuestion(q, answers);  // 收集测验题进题库
      if (ok) okCount++;
      STATS.jobsDone = okCount;
      log(`第 ${i + 1}/${tasks.length} 题(类型 ${q.type}) ${ok ? '✓ 已作答' : '✗ ' + fail}`, ok ? 'ok' : 'warn');
    }
    if (pausedMid) { log('⏸ 暂停中断:本题库不自动提交,已答内容保留在页面上', 'warn'); return; }
    const accuracy = tasks.length ? okCount / tasks.length : 0;
    // 阈值按"面板上显示的百分比"比较,避免 65.9% 显示成 66% 却因实际值不足 66% 而不交的困惑
    const accPct = Math.round(accuracy * 100);
    const needPct = Math.round((CONFIG.minAccuracy || 0) * 100);
    if (CONFIG.autoSubmit && accPct >= needPct) {
      await randomSleep(CONFIG.submitDelayMin, CONFIG.submitDelayMax);
      log(`正确率 ${accPct}% ≥ 阈值 ${needPct}%,正在提交...`, 'ok');
      let submitted = false;
      // 提交入口可能定义在题目窗口,也可能在它的父级页(旧版章节测验把 btnBlueSubmit 挂在父页)
      const chain = [win];
      try { if (win.parent && win.parent !== win) chain.push(win.parent); } catch (e) { /* 跨域忽略 */ }
      try {
        const p2 = chain[chain.length - 1].parent;
        if (p2 && p2 !== chain[chain.length - 1] && chain.indexOf(p2) < 0) chain.push(p2);
      } catch (e) { /* 跨域忽略 */ }
      for (const w of chain) {
        try {
          if (typeof w.btnBlueSubmit === 'function') { w.btnBlueSubmit(); submitted = true; break; }
          if (typeof w.submitWork === 'function') { w.submitWork(); submitted = true; break; }
        } catch (e) { /* ignore */ }
      }
      if (!submitted) {
        for (const w of chain) {
          if (clickButtonByText(w, ['交卷', '提交', '确认提交'])) { submitted = true; break; }
        }
      }
      if (submitted) {
        await sleep(3);
        for (const w of chain) {
          try { if (typeof w.submitCheckTimes === 'function') { w.submitCheckTimes(); break; } } catch (e) { /* ignore */ }
        }
        log('已触发提交', 'ok');
      } else {
        log('未找到提交入口,请手动提交', 'warn');
      }
    } else {
      log(CONFIG.autoSubmit
        ? `正确率 ${accPct}% 低于阈值 ${needPct}%,暂存不提交(可在设置里调整阈值)`
        : `正确率 ${accPct}%,自动提交已关闭,暂存不提交`, 'warn');
      try { win.alert = () => {}; if (typeof win.noSubmit === 'function') win.noSubmit(); } catch (e) { /* ignore */ }
    }
  }

  async function homeworkTask() {
    initPanel();
    await waitElementLoaded(window, '.questionLi', 30000, runAborted);
    // 网页 AI 模式:先把 AI 页拉起来、桥在线后才开始答题(未就绪不空跑)
    if (CONFIG.webAiEnabled && !(await webAiStartupGate())) return;
    if (window.document.querySelector('.font-cxsecret') || extractFontBase64(window)) {
      log('🔐 作业检测到字体加密,正在自动解密...', 'warn');
      await decodeFont(window, window.document.body);
    }
    const els = Array.from(document.querySelectorAll('.questionLi'));
    if (!els.length) { log('未找到作业题目', 'warn'); return; }
    log(`📝 作业页,共 ${els.length} 题(填写后不会自动交卷,请检查后手动提交)`, 'ok');
    // 先解析全部题干(整卷模式需要完整题目列表;解析失败的题保持原逻辑跳过)
    const qs = els.map((el) => extractWorkQuestion(el));
    // 整卷模式:全部题目一次问网页 AI,按题号批量解析(缺漏的题在循环里回退逐题询问)
    let batchMap = null;
    if (CONFIG.webAiEnabled && CONFIG.webAiBatch) {
      const tasks = els.map((el, i) => (qs[i] ? { q: qs[i], el } : null)).filter(Boolean);
      batchMap = tasks.length ? await askBatchWebAI(tasks) : null;
      // 把批量结果按原始下标摊回 batchMap
      if (batchMap) {
        const byOrig = new Array(els.length).fill(null);
        let t = 0;
        for (let i = 0; i < els.length; i++) {
          if (qs[i]) byOrig[i] = batchMap[t++];
        }
        batchMap = byOrig;
      }
    }
    let okCount = 0;
    for (let i = 0; i < els.length; i++) {
      if (runAborted()) { log(`⏸ 已暂停,第 ${i + 1}/${els.length} 题起停止(点「开始」恢复后刷新重跑)`, 'warn'); break; }
      await randomSleep(CONFIG.answerIntervalMin, CONFIG.answerIntervalMax);
      if (runAborted()) { log(`⏸ 已暂停,第 ${i + 1}/${els.length} 题起停止`, 'warn'); break; }
      const q = qs[i];
      if (!q) continue;
      let answers = (batchMap && batchMap[i]) || [];
      if (answers.length) {
        STATS.answered++;
        log(`[网页AI·整卷] 查到答案: ${answers.join(' / ')}`, 'ok');
      } else {
        answers = await getAnswers(q);
      }
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
  let pendingRun = false;   // 跑任务时页面被切走:收手后按新页面重扫,而不是把新 URL 记下来当"已完成"
  let runEpoch = 0;         // 页面切换时自增;正在跑的那轮发现令牌变了立刻收手(旧 DOM 已失效,继续干只会空转)
  let activeEpoch = 0;

  // 本轮是否该收手:用户点了暂停,或页面已被切走
  const runAborted = () => PAUSED || activeEpoch !== runEpoch;

  // 诊断用(排查"切页后不动了"):控制台执行 __cxRunState() 看轮次令牌与运行标志
  try {
    window.__cxRunState = () => ({ epoch: runEpoch, active: activeEpoch, running, pending: pendingRun, paused: PAUSED, url: lastIframeUrl });
  } catch (e) { /* ignore */ }

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
    const els = Array.from(document.querySelectorAll(QUIZ_ITEM_SEL));
    if (els.length) {
      log(`📝 检测到顶层题目(共 ${els.length} 题)`, 'ok');
      const ok = await answerQuizElements(window, els, '顶层测验');
      log(`顶层测验作答完成(${ok}/${els.length}),请留意提交按钮`, 'ok');
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
    if (runAborted()) return;
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
          workFrame = fs.find((f) => isWorkSrc(f.src)) || null;
          if (!workFrame) {
            // 检测弹窗有时挂在顶层 document 上
            try {
              workFrame = Array.from(document.querySelectorAll('iframe')).find((f) => isWorkSrc(f.src)) || null;
            } catch (e) { /* ignore */ }
          }
          if (!workFrame) await sleep(1);
        }
        if (workFrame) {
          await workTask(workFrame);
          log('✓ 学习检测完成', 'ok');
        } else {
          log('学习检测 tab 已点,但未找到测验 iframe,改为整页扫描题目', 'warn');
          await topLevelQuiz();
          const deep = findQuizTree(cardsWin);
          if (deep) {
            log(`🧩 卡片内找到 ${deep.els.length} 道题,直接作答`, 'ok');
            await answerQuizElements(deep.win, deep.els, '学习检测');
          } else {
            dumpFrames(cardsWin, '学习检测');
          }
        }
      }
    }
    // 2) 视频任务(平台未限流时)
    if (runAborted()) { log('⏸ 已暂停,跳过后续任务', 'warn'); return; }
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
    if (runAborted()) return;
    await sleep(0.3);
    if (CONFIG.autoJump && clickNextSection()) {
      log('→ 切换到下一节', 'ok');
    } else {
      log('未找到"下一节"按钮(可能已是最后一节)', 'warn');
    }
  }

  async function chapterLoop() {
    await waitElementLoaded(window, '#iframe', 30000, runAborted);
    const cardsIframe = document.querySelector('#iframe');
    if (!cardsIframe) return;
    await waitIframeLoaded(cardsIframe, 60000, runAborted);
    if (runAborted()) return;
    let cardsWin = null;
    try { cardsWin = cardsIframe.contentWindow; } catch (e) {
      log('章节 iframe 无法访问(跨域),请确认页面域名与脚本匹配', 'err');
      return;
    }
    try { if (typeof window.scroll2Job === 'function') window.scroll2Job(); } catch (e) { /* ignore */ }
    // 等卡片渲染完再判断结构:刚切章节时立刻数任务点容易数到 0,导致整章被跳成"新版结构"
    const cardsReady = () => {
      try {
        if (cardsWin.document.querySelector('.ans-job-icon')) return true;
        const fs = Array.from(cardsWin.document.querySelectorAll('iframe'));
        return fs.some((f) => /ananas\/modules\/|\/dowork|doHomeWorkNew/.test(String(f.src || '')));
      } catch (e) { return false; }
    };
    for (let i = 0; i < 24 && !cardsReady(); i++) await sleep(0.5);
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
      if (runAborted()) { if (PAUSED) log('⏸ 已暂停,本轮任务停止(点 ▶ 恢复)', 'warn'); return; }
      if (dailyLimitReached) { log('⏹ 今日刷课已到上限,停止任务处理', 'warn'); return; }
      const parent = icon.parentElement;
      if (parent && parent.classList.contains('ans-job-finished')) { finishedCount++; continue; }
      let iframe = parent ? parent.querySelector('iframe') : null;
      if (!iframe) {
        // 懒加载:任务点卡片有时会晚一点才插入 iframe,等 5s 再说"没有"
        for (let i = 0; i < 10 && !iframe; i++) {
          await sleep(0.5);
          iframe = parent ? parent.querySelector('iframe') : null;
        }
      }
      if (!iframe) { log('任务点无 iframe(等待 5s 仍未出现),跳过', 'warn'); continue; }
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
        } else if (isWorkSrc(src)) {
          if (CONFIG.autoWork) await workTask(iframe); else log('测验任务已跳过(配置关闭)');
        } else if (src.includes('/ananas/modules/pdf/index.html')) {
          await pdfTask(iframe);
        } else if (src.includes('/ananas/modules/img/') || src.includes('/ananas/modules/image/') || src.includes('/ananas/modules/picture/') || /img.*index\.html/.test(src)) {
          await imageTask(iframe);
        } else {
          // 未知包装:先看看里面是不是题目,是就按测验处理(新版各种嵌法都能兜住)
          let inner = null;
          try { inner = findQuizTree(iframe.contentWindow); } catch (e) { /* ignore */ }
          if (inner) {
            log('🕵 未知任务类型内含题目,按测验处理');
            if (CONFIG.autoWork) await workTask(iframe);
          } else {
            log('未知任务类型: ' + src, 'warn');
            log('🔍 未知模块 src 全文: ' + src, 'info');
          }
        }
      } catch (e) {
        if (runAborted()) return;   // 暂停/切页导致的取消,不当成异常刷屏
        log(`任务处理异常: ${e.message}`, 'err');
      }
      if (runAborted()) { if (PAUSED) log('⏸ 已暂停,本轮任务停止(点 ▶ 恢复)', 'warn'); return; }
      await sleep(0.3);
    }
    log(`本章扫描结束(共 ${icons.length} 个任务点)`, 'ok');
    if (runAborted()) return;
    if (CONFIG.autoJump) {
      const next = document.querySelector('.nextChapter');
      if (next) { log('→ 切换到下一章'); next.click(); }
      else log('未找到下一章按钮(可能已是最后一章)', 'warn');
    }
  }

  function startWatch() {
    initPanel();
    log('挂机引擎已启动,开始扫描任务点...', 'ok');
    let seenUrl = '';
    let seenSince = Date.now();
    setInterval(() => {
      try {
        const f = document.querySelector('#iframe');
        if (!f || !f.contentWindow) return;
        let url = '';
        try { url = f.contentWindow.location.href; } catch (e) { return; }
        const now = Date.now();
        // 页面切换有中间态(about:blank、加载中的旧地址)。先记下来,等它稳定 1.2s 再认,
        // 否则中间态会被当成"用户切了页面",把刚起来的那轮反复作废
        if (url !== seenUrl) { seenUrl = url; seenSince = now; return; }
        if (url === lastIframeUrl) return;
        if (now - seenSince < 1200) return;
        lastIframeUrl = url;
        runEpoch++;   // 旧轮手里的 iframe/DOM 已经是上一条页面了
        if (running) {
          // 用户手动切了章节/课程:老的一轮还在对着旧 iframe 干活。
          // 以前这里只更新 URL 就直接 return,等老的一轮(可能永远卡在失效播放器上)结束后,
          // 新 URL 已被"消费",再也不会触发扫描 —— 表现就是"切了页面脚本就不动了"
          pendingRun = true;
          log('🔀 检测到页面已切换,当前任务收手后按新页面重扫', 'warn');
          return;
        }
        runOnce();
      } catch (e) { /* ignore */ }
    }, 1000);
  }

  async function runOnce() {
    if (running) { pendingRun = true; return; }
    if (PAUSED) return;
    running = true;
    pendingRun = false;
    activeEpoch = ++runEpoch;
    setStatus('工作中');
    try {
      await chapterLoop();
    } catch (e) {
      if (!runAborted()) log('主循环异常: ' + e.message, 'err');
    } finally {
      running = false;
      setStatus(PAUSED ? '已暂停' : '待机');
      const again = pendingRun;
      pendingRun = false;
      if (again && !PAUSED) runOnce();
    }
  }

  // 面板点「恢复」时调用:重跑一轮(暂停时循环是中断退出的,URL 没变不会自动触发)
  function resumeWatching() {
    if (!ACTIVE_ADAPTER || ACTIVE_ADAPTER.id !== 'chaoxing') return;
    let kind = 'chapter';
    try { kind = ACTIVE_ADAPTER.pageKind ? ACTIVE_ADAPTER.pageKind() : 'chapter'; } catch (e) { /* ignore */ }
    if (kind !== 'chapter') return;
    if (running) { pendingRun = true; return; }
    // 先把"当前 URL"记为已处理,再重跑;否则下一轮扫描会把同一个 URL 当成"用户切了页面",
    // 立刻把刚起来的这轮又作废(表现为恢复后视频反复重开)
    try {
      const f = document.querySelector('#iframe');
      if (f && f.contentWindow) lastIframeUrl = f.contentWindow.location.href;
    } catch (e) { /* ignore */ }
    runOnce();
  }

  /* ==================== 适配器:学习通 ==================== */
  const CX_CHAPTER_PATHS = [
    '/mycourse/studentstudy', '/mooc-ans/mycourse/studentstudy', '/mooc2-ans/mycourse/studentstudy'
  ];
  const CX_HOMEWORK_PATHS = [
    '/work/doHomeWorkNew', '/mooc-ans/work/doHomeWorkNew', '/mooc2-ans/work/doHomeWorkNew',
    '/mooc2/work/dowork', '/mooc-ans/mooc2/work/dowork', '/mooc2-ans/mooc2/work/dowork'
  ];

  registerAdapter({
    id: 'chaoxing',
    name: '学习通',
    match() {
      const p = location.pathname;
      return CX_CHAPTER_PATHS.includes(p) || CX_HOMEWORK_PATHS.includes(p);
    },
    pageKind() {
      if (CX_HOMEWORK_PATHS.includes(location.pathname)) return 'homework';
      if (CX_CHAPTER_PATHS.includes(location.pathname)) return 'chapter';
      return 'other';
    },
    selfCheck() {
      if (this.pageKind() === 'homework') {
        const n = document.querySelectorAll('.questionLi, .TiMu').length;
        return { ok: n > 0, detail: n ? ('找到 ' + n + ' 道题目') : '未找到题目容器(.questionLi / .TiMu)' };
      }
      const marks = [
        ['#iframe', !!document.querySelector('#iframe')],
        ['.ans-job-icon', !!document.querySelector('.ans-job-icon')],
        ['.nextChapter', !!document.querySelector('.nextChapter')],
        ['mooc-ans', !!document.querySelector('mooc-ans, .knowledge-card')]
      ].filter((x) => x[1]).map((x) => x[0]);
      return {
        ok: marks.length > 0,
        detail: marks.length ? ('命中:' + marks.join('/')) : '未找到 #iframe / .ans-job-icon / .nextChapter 任一节点'
      };
    },
    snapshotHints: { jobIcon: '.ans-job-icon', quiz: '.TiMu' },
    start() {
      if (this.pageKind() === 'homework') {
        homeworkTask();
        return;
      }
      initPanel();
      if (!location.href.includes('mooc2=1')) {
        log('检测到旧版章节页,正在切换到新版(mooc2)...', 'warn');
        location.href += (location.href.includes('?') ? '&' : '?') + 'mooc2=1';
        return;
      }
      startWatch();
    }
  });
  /* ==================== 适配器:智慧树 / 知到 ====================
     页面形态:studyh5.zhihuishu.com/videoStudy.html#/studyVideo?...  (hash 路由 SPA)
     特点:切视频不刷新页面;任务点在侧边栏目录树;弹题以浮层出现;
          完成度按"累计观看时长"校验,倍速过高可能不计入 → 默认封顶 1.5x
     状态:实验。选择器集中在 ZHS_SEL,失配会明确报错并提示采集页面结构。
  ==================== */
  const ZHS_SEL = {
    video: '#vjs_container video, .videoArea video, video',
    // 目录树节点(多版本兜底:老版 .clearfix.video / 新版 el-tree 节点 / 通用 li)
    lesson: '.clearfix.video, .catalogue li, .chapterList li, .el-tree-node__content, .section-item, .video-item',
    active: /(^|\s)(active|current|playing|on)(\s|$)/,
    doneFlag: /已完成|完成|100%|finish|complete|done|icon-dui|已学完|isFinish/,
    nextBtn: ['下一节', '下一章', '下一个', '继续学习']
  };

  function zhsVideo() {
    try { return document.querySelector(ZHS_SEL.video); } catch (e) { return null; }
  }

  function zhsLessons() {
    try {
      return Array.from(document.querySelectorAll(ZHS_SEL.lesson)).filter((el) => isVisible(el));
    } catch (e) { return []; }
  }

  function zhsIsDone(el) {
    const cls = (el.className || '').toString();
    const t = (el.textContent || '').slice(0, 60);
    return ZHS_SEL.doneFlag.test(cls) || ZHS_SEL.doneFlag.test(t);
  }

  // 点亮一个视频:静音 + 限速 + 播放
  let zhsRateLogged = false;
  function zhsPlay(v) {
    try {
      if (!v.muted) v.muted = true;
      const rate = Math.min(Number(CONFIG.speed) || 1, 1.5);   // 智慧树按累计时长校验,超过 1.5x 容易白刷
      if (Math.abs(v.playbackRate - rate) > 0.01) v.playbackRate = rate;
      if (v.paused) {
        const p = v.play();
        if (p && p.catch) p.catch(() => { /* 等用户手势 */ });
      }
      if (!zhsRateLogged) {
        zhsRateLogged = true;
        log(`智慧树:静音 + ${rate}x 播放(高于 1.5x 可能不计入时长)`, 'info');
      }
    } catch (e) { /* ignore */ }
  }

  // 弹题:用内核的启发式定位 + 现有答案通道作答
  async function zhsHandlePopup() {
    let box = null;
    try { box = heuristicFindQuiz(window); } catch (e) { box = null; }
    if (!box) return false;
    if (wasHandledRecently(box)) return true;

    const q = extractHeuristicQuestion(box);
    if (!q) return false;
    const ans = await getAnswers(q);
    if (!ans || !ans.length) { log('智慧树弹题:未取到答案,先跳过', 'warn'); return false; }

    const ok = setHeuristicAnswer(ans, q, box);
    log(`智慧树弹题(${q.type === '3' ? '判断' : '选择'}): ${ans.join('/')} → ${ok ? '已作答' : '作答失败'}`, ok ? 'ok' : 'warn');
    await sleep(1);
    clickButtonByText(window, ZHS_SEL.nextBtn);
    return ok;
  }

  // 切到下一个未完成的视频节点
  function zhsGotoNextLesson() {
    const items = zhsLessons();
    if (!items.length) {
      // 没有目录树时,尝试页面上的"下一节"按钮
      return clickButtonByText(window, ZHS_SEL.nextBtn);
    }
    let cur = items.findIndex((el) => ZHS_SEL.active.test((el.className || '').toString()));
    if (cur < 0) cur = items.findIndex((el) => el.contains(zhsVideo()));
    for (let i = cur + 1; i < items.length; i++) {
      if (!zhsIsDone(items[i])) {
        log(`智慧树:切换到第 ${i + 1} 个节点`, 'info');
        const clickable = items[i].querySelector('a, span, div') || items[i];
        try { clickable.click(); } catch (e) { /* ignore */ }
        return true;
      }
    }
    return clickButtonByText(window, ZHS_SEL.nextBtn);
  }

  async function zhihuishuLoop() {
    setStatus('工作中');
    log('智慧树适配器(实验):自动播放 · 静音 · 限速 · 弹题 · 自动下一节', 'warn');
    let idleTicks = 0;
    while (!PAUSED) {
      const v = zhsVideo();
      if (!v) {
        if (zhsGotoNextLesson()) { await sleep(4); continue; }
        if (idleTicks === 0) {
          log('未找到视频,也没有可切换的节点;可点面板「结构采集」把页面结构发回以完善适配', 'warn');
        }
        idleTicks++;
        await sleep(5);
        continue;
      }
      idleTicks = 0;
      zhsPlay(v);

      // 弹题优先(弹题会暂停播放)
      const handled = await zhsHandlePopup();
      if (handled) { await sleep(2); continue; }

      const dur = Number(v.duration) || 0;
      const ratio = dur ? v.currentTime / dur : 0;
      if (v.ended || ratio >= 0.95) {
        log(`智慧树:本节播完(${Math.round(ratio * 100)}%)`, 'ok');
        STATS.jobsDone = (STATS.jobsDone || 0) + 1;
        if (!zhsGotoNextLesson()) {
          log('智慧树:没有后续视频,本轮结束', 'ok');
          return;
        }
        await sleep(4);
        continue;
      }
      await sleep(2);
    }
  }

  registerAdapter({
    id: 'zhihuishu',
    name: '智慧树',
    match() {
      if (window.__CX_FORCE_PLATFORM === 'zhihuishu') return true;   // 测试钩子
      const h = location.hostname;
      if (!/(^|\.)zhihuishu\.com$/.test(h)) return false;
      return /videoStudy|videoList|studyVideo|learning\//.test(location.href);
    },
    pageKind() {
      if (/exam/i.test(location.hostname)) return 'quiz';
      return 'chapter';
    },
    selfCheck() {
      if (this.pageKind() === 'quiz') {
        return { ok: true, detail: '测验页(实验阶段暂未实现自动交卷)' };
      }
      const v = zhsVideo();
      const n = zhsLessons().length;
      if (v) return { ok: true, detail: `找到视频 + ${n} 个目录节点` };
      if (n) return { ok: true, detail: `找到 ${n} 个目录节点,视频尚未加载` };
      return { ok: false, detail: '未找到 video / 目录树节点' };
    },
    start() {
      initPanel();
      if (this.pageKind() === 'quiz') {
        log('智慧树测验页:实验阶段只支持视频页,测验请用学习通那套流程手动完成', 'warn');
        return;
      }
      zhihuishuLoop();
    }
  });
  /* ==================== 适配器:雨课堂 ====================
     页面形态:一页一视频(新版 /ai-workspace/lms-graph,旧版 /pro/lms,/v2/web)
     特点:切到后台会主动暂停 → 需要"保活";完成度由服务端记录,进度条跑满也可能不算完成;
          习题/讨论是独立单元,含图片题
     状态:实验。视频播放/保活/连播已实现;习题与讨论留待接入多模态。
  ==================== */
  const YKT_SEL = {
    video: 'video',
    lesson: '.el-tree-node__content, .chapter-item, .lesson-item, .section-item, [class*=catalog] li, [class*=chapter] li',
    nextBtn: ['下一节', '下一个', '下一章', '下一课'],
    risk: /请完成验证|拖动滑块|安全验证|captcha|人机验证/i
  };

  function yktVideo() {
    try {
      return Array.from(document.querySelectorAll(YKT_SEL.video)).find((v) => {
        const d = Number(v.duration) || 0;
        return v.offsetParent !== null || d > 0;
      }) || null;
    } catch (e) { return null; }
  }

  // 保活:拦截 play/pause 与 visibility 事件,防止平台在切标签页时暂停
  let yktGuardInstalled = false;
  function yktInstallGuard() {
    if (yktGuardInstalled) return;
    yktGuardInstalled = true;
    const resume = (v) => {
      try {
        if (!v || PAUSED) return;
        if (v.paused && !v.ended) {
          const p = v.play();
          if (p && p.catch) p.catch(() => { /* 需要用户手势 */ });
        }
      } catch (e) { /* ignore */ }
    };
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) resume(yktVideo());
    }, true);
    // 平台脚本会在失焦时 pause(),这里延迟纠正
    setInterval(() => { if (!PAUSED) resume(yktVideo()); }, 1500);
    log('雨课堂:已安装后台保活(切标签页不再暂停)', 'info');
  }

  function yktRiskDetected() {
    try {
      return YKT_SEL.risk.test((document.body && document.body.innerText || '').slice(0, 4000));
    } catch (e) { return false; }
  }

  let yktRateLogged = false;
  function yktPlay(v) {
    try {
      if (!v.muted) v.muted = true;
      const rate = Math.min(Number(CONFIG.speed) || 1, 2);
      if (Math.abs(v.playbackRate - rate) > 0.01) v.playbackRate = rate;
      if (v.paused) {
        const p = v.play();
        if (p && p.catch) p.catch(() => { /* ignore */ });
      }
      if (!yktRateLogged) {
        yktRateLogged = true;
        log(`雨课堂:静音 + ${rate}x 播放`, 'info');
      }
    } catch (e) { /* ignore */ }
  }

  async function yktHandlePopup() {
    let box = null;
    try { box = heuristicFindQuiz(window); } catch (e) { box = null; }
    if (!box) return false;
    if (wasHandledRecently(box)) return true;
    const q = extractHeuristicQuestion(box);
    if (!q) return false;
    const ans = await getAnswers(q);
    if (!ans || !ans.length) { log('雨课堂弹题:未取到答案', 'warn'); return false; }
    const ok = setHeuristicAnswer(ans, q, box);
    log(`雨课堂弹题:${ans.join('/')} → ${ok ? '已作答' : '作答失败'}`, ok ? 'ok' : 'warn');
    await sleep(1);
    clickButtonByText(window, ['提交', '确定', '继续学习']);
    return ok;
  }

  function yktNext() {
    if (clickButtonByText(window, YKT_SEL.nextBtn)) return true;
    try {
      const items = Array.from(document.querySelectorAll(YKT_SEL.lesson)).filter(isVisible);
      let cur = items.findIndex((el) => /active|current|playing/.test((el.className || '').toString()));
      if (cur < 0) cur = items.findIndex((el) => el.contains(yktVideo()));
      for (let i = cur + 1; i < items.length; i++) {
        const t = (items[i].textContent || '');
        if (!/已完成|100%/.test(t)) {
          log(`雨课堂:切换到第 ${i + 1} 个节点`, 'info');
          try { (items[i].querySelector('a,span,div') || items[i]).click(); } catch (e) { /* ignore */ }
          return true;
        }
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  async function yuketangLoop() {
    setStatus('工作中');
    log('雨课堂适配器(实验):保活播放 · 静音倍速 · 弹题 · 自动连播', 'warn');
    yktInstallGuard();
    let idle = 0;
    while (!PAUSED) {
      if (yktRiskDetected()) {
        log('⚠ 检测到验证码/安全验证:立即停手,请手动通过后再继续', 'err');
        setStatus('待机');
        return;
      }
      const v = yktVideo();
      if (!v) {
        if (yktNext()) { await sleep(4); continue; }
        if (idle === 0) log('未找到视频节点;若页面确为视频页,请点「结构采集」反馈页面结构', 'warn');
        idle++;
        await sleep(5);
        continue;
      }
      idle = 0;
      yktPlay(v);
      if (await yktHandlePopup()) { await sleep(2); continue; }

      const dur = Number(v.duration) || 0;
      const ratio = dur ? v.currentTime / dur : 0;
      if (v.ended || ratio >= 0.96) {
        log(`雨课堂:本节播完(${Math.round(ratio * 100)}%),等待服务端记录进度`, 'ok');
        STATS.jobsDone = (STATS.jobsDone || 0) + 1;
        await sleep(4);
        if (!yktNext()) { log('雨课堂:没有后续节点,本轮结束', 'ok'); return; }
        await sleep(3);
        continue;
      }
      await sleep(2);
    }
  }

  registerAdapter({
    id: 'yuketang',
    name: '雨课堂',
    match() {
      if (window.__CX_FORCE_PLATFORM === 'yuketang') return true;   // 测试钩子
      const h = location.hostname;
      if (!/(^|\.)yuketang\.cn$/.test(h)) return false;
      return /\/v2\/web|\/pro\/lms|ai-workspace|lms-graph|study|lesson|video/.test(location.href) ||
        location.pathname === '/';
    },
    pageKind() {
      if (/\/exam|exam\//.test(location.href)) return 'quiz';
      return 'chapter';
    },
    selfCheck() {
      const v = yktVideo();
      if (v) return { ok: true, detail: '找到视频元素' };
      const n = document.querySelectorAll(YKT_SEL.lesson).length;
      return {
        ok: n > 0,
        detail: n ? `找到 ${n} 个课程节点,视频未加载` : '未找到 video / 课程节点'
      };
    },
    start() {
      initPanel();
      if (this.pageKind() === 'quiz') {
        log('雨课堂测验/习题页:实验阶段未实现自动作答,请手动完成', 'warn');
        return;
      }
      yuketangLoop();
    }
  });
  /* ==================== 页面结构采集(用于适配新平台) ==================== */
  const PROBE_URL = 'http://127.0.0.1:8790/api/probe';

  function probeClip(s, n = 3000) {
    if (!s) return '';
    const t = String(s).replace(/\s+/g, ' ');
    return t.length > n ? t.slice(0, n) + '…' : t;
  }

  // 采集页面结构:不猜选择器,把"看起来像任务点/题目"的节点原样带回去分析
  function collectProbe() {
    const pick = (sel, limit = 8) => {
      try {
        return Array.from(document.querySelectorAll(sel)).slice(0, limit).map((e) => ({
          cls: (e.className || '').toString().slice(0, 160),
          id: e.id || null,
          tag: e.tagName,
          text: probeClip(e.textContent, 400),
          html: probeClip(e.outerHTML, 1500)
        }));
      } catch (e) { return []; }
    };
    const candidates = [];
    try {
      const all = Array.from(document.querySelectorAll('div,li,section')).slice(0, 4000);
      for (const el of all) {
        // 只收"文字像题目、且带可点选项"的容器
        const t = el.textContent || '';
        if (t.length < 8 || t.length > 1600) continue;
        const optCount = el.querySelectorAll('li,label,[class*=option],[class*=item],input[type=radio],input[type=checkbox]').length;
        if (optCount < 2) continue;
        if (!/题|选择|判断|填空|正确|错误|下列|以下/.test(t)) continue;
        candidates.push({
          tag: el.tagName,
          cls: (el.className || '').toString().slice(0, 160),
          text: probeClip(t, 300),
          html: probeClip(el.outerHTML, 1200)
        });
        if (candidates.length >= 6) break;
      }
    } catch (e) { /* ignore */ }

    const v = document.querySelector('video');
    return {
      at: new Date().toISOString(),
      version: scriptVersion(),
      url: location.href,
      hash: location.hash,
      host: location.hostname,
      path: location.pathname,
      title: document.title,
      adapter: ACTIVE_ADAPTER ? ACTIVE_ADAPTER.id : null,
      selfCheck: ACTIVE_ADAPTER && ACTIVE_ADAPTER.selfCheck ? ACTIVE_ADAPTER.selfCheck() : null,
      video: v ? {
        src: (v.currentSrc || v.src || '').slice(0, 200),
        cur: Math.round(v.currentTime), dur: Math.round(v.duration) || null,
        rate: v.playbackRate, paused: v.paused, muted: v.muted
      } : null,
      iframes: Array.from(document.querySelectorAll('iframe')).slice(0, 12).map((f) => ({
        src: (f.src || '').slice(0, 200),
        id: f.id || null,
        cls: (f.className || '').toString().slice(0, 80),
        sameOrigin: (function () { try { return !!f.contentDocument; } catch (e) { return false; } })()
      })),
      containers: pick('[class*=catalog],[class*=catalogue],[class*=chapter],[class*=lesson],[class*=menu],[class*=catalog],[class*=task],[class*=job]'),
      questionCandidates: candidates,
      buttons: Array.from(document.querySelectorAll('button,a,div[class*=btn],[class*=button]')).slice(0, 40)
        .map((b) => ({ text: probeClip(b.textContent, 20), cls: (b.className || '').toString().slice(0, 80), tag: b.tagName }))
        .filter((b) => b.text)
    };
  }

  function sendProbe(reason) {
    try {
      const data = JSON.stringify(collectProbe());
      cxFetch(PROBE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data,
        timeout: 6000
      }).then(() => {
        log('📤 页面结构已发送到本地采集端(127.0.0.1:8790)', 'ok');
      }).catch(() => {
        log('💡 想反馈页面结构?先在本机跑 npm run mock,再刷新本页会自动上传', 'warn');
      });
    } catch (e) { /* ignore */ }
    console.log('[刷课助手] 页面结构采集(' + (reason || '') + '):', collectProbe());
    return collectProbe();
  }

  /* ==================== 启动:按适配器分发 ==================== */
  function bootAdapter() {
    startReporterHeartbeat();

    for (const a of ADAPTERS) {
      let hit = false;
      try { hit = a.match(); } catch (e) { hit = false; }
      if (!hit) continue;

      ACTIVE_ADAPTER = a;
      let ok = true;
      let detail = '';
      if (a.selfCheck) {
        try {
          const sc = a.selfCheck();
          ok = !sc || sc.ok !== false;
          detail = (sc && sc.detail) || '';
        } catch (e) {
          ok = false;
          detail = e.message;
        }
      }
      if (!ok) {
        // 选择器失配:明确报错(而不是静默没反应),并把页面结构带回去便于修适配器
        try { initPanel(); } catch (e) { /* ignore */ }
        log(`⚠ ${a.name} 页面结构自检未通过:${detail || '未找到预期节点'}`, 'err');
        log('  可能是平台改版,或页面还没加载完;已尝试采集页面结构', 'warn');
        sendProbe('selfCheck-failed');
        if (a.hardFail) return;
      }

      try {
        a.start();
        startAutoUpdater();
      } catch (e) {
        log(`${a.name} 启动失败:${e.message}`, 'err');
      }
      return;
    }

    console.log('[刷课助手] 当前页面不属于已支持的平台(学习通 / 智慧树 / 雨课堂),脚本待机');
  }

  bootAdapter();
})();
