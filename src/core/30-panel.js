  /* ==================== 日志面板 ==================== */
  let logPanel = null;
  let logLines = [];
  // 统计只保留任务点进度与已答题数(运行时长统计已移除)
  const STATS = { answered: 0, jobsDone: 0, jobsTotal: 0 };

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function setStatus(text) {
    const el = document.getElementById('cxStatus');
    if (el) {
      el.innerHTML = '<i></i>' + escHtml(text);
      el.className = 'cx-pill ' + (text === '工作中' ? 'run' : text === '已暂停' ? 'pause' : text === '出错' ? 'err' : 'idle');
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
        useTiku: CONFIG.useTiku, stopAtTime: CONFIG.stopAtTime,
        autoSubmit: CONFIG.autoSubmit, autoJump: CONFIG.autoJump,
        accCheckEnabled: CONFIG.accCheckEnabled,
        minAccuracy: CONFIG.minAccuracy, deliberateErrorRate: CONFIG.deliberateErrorRate,
        answerIntervalMin: CONFIG.answerIntervalMin, submitDelayMin: CONFIG.submitDelayMin
      },
      submitFails: SUBMIT_FAILS.slice(-20).map((it) => ({ chapter: it.chapter, node: it.node, reason: it.reason })),
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
        '<div class="cell cxClick" id="cxFailCell" title="点击查看未成功提交的任务点(章节/节点/原因)"><b id="cxStatFail">0</b><span>未提交 ›</span></div>' +
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
      '#cxStats .cell.cxClick{cursor:pointer;transition:all .15s}' +
      '#cxStats .cell.cxClick:hover{background:rgba(255,255,255,0.1);border-color:rgba(255,255,255,0.3)}' +
      '#cxStats .cell.has{border-color:rgba(255,255,255,0.45);background:rgba(255,255,255,0.09)}' +
      '#cxStats .cell.has b{color:#fff}' +
      '#cxStats .cell.has span{color:#d4d4d8}' +
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
    applyStopClock();   // 启用「定时关闭」(未设置则什么都不做)
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
    // 统计栏每秒刷新(任务点进度 / 已答题数 / 未提交任务点数)
    setInterval(() => {
      const j = document.getElementById('cxStatJobs');
      const a = document.getElementById('cxStatAns');
      const f = document.getElementById('cxStatFail');
      const fc = document.getElementById('cxFailCell');
      if (j) j.textContent = STATS.jobsTotal ? (STATS.jobsDone + '/' + STATS.jobsTotal) : '—';
      if (a) a.textContent = String(STATS.answered);
      if (f) f.textContent = String(submitFailCount());
      if (fc) fc.classList.toggle('has', submitFailCount() > 0);
    }, 1000);
    // 点「未提交」格:把未成功提交的任务点列到日志区(单列一栏,便于直接定位章节/节点)
    document.getElementById('cxFailCell').addEventListener('click', showSubmitFails);
    // 启动时若已有未提交记录,提醒一次
    if (submitFailCount() > 0) {
      log(`📕 有 ${submitFailCount()} 个任务点未成功提交(点统计栏「未提交」查看章节与原因)`, 'warn');
    }
  }

  // 未成功提交的任务点清单:不塞进普通日志(会被后续日志冲走),单独渲染
  function showSubmitFails() {
    initPanel();
    const logsEl = document.getElementById('cxLogs');
    if (!logsEl) return;
    const list = SUBMIT_FAILS.slice(-30);
    if (!list.length) {
      logsEl.innerHTML = '<div class="ok"><span class="m">✅ 没有未成功提交的任务点</span></div>';
      return;
    }
    const fmtTime = (t) => {
      try { return new Date(t).toLocaleString('zh-CN', { hour12: false }); } catch (e) { return String(t); }
    };
    logsEl.innerHTML =
      '<div class="warn"><span class="m">📕 未成功提交的任务点(共 ' + submitFailCount() + ' 条,最新在前)</span></div>' +
      list.slice().reverse().map((it) =>
        '<div class="err"><span class="m">' + escHtml(fmtTime(it.t)) + ' · ' +
        escHtml(it.chapter || '(未知章节)') + ' / ' + escHtml(it.node || '(未知节点)') +
        '<br>原因:' + escHtml(it.reason || '未知') + '</span></div>'
      ).join('') +
      '<div class="ok"><span class="m">点日志区右上「▼」返回运行日志;清空请点下方按钮</span></div>' +
      '<div style="display:flex;gap:8px;margin:6px 0"><button id="cxFailCopy" type="button" style="flex:1;cursor:pointer;background:rgba(255,255,255,0.1);color:#fafafa;border:1px solid rgba(255,255,255,0.25);border-radius:6px;padding:5px 8px;font:12px inherit">复制清单</button>' +
      '<button id="cxFailClear" type="button" style="flex:1;cursor:pointer;background:rgba(255,255,255,0.1);color:#fafafa;border:1px solid rgba(255,255,255,0.25);border-radius:6px;padding:5px 8px;font:12px inherit">清空记录</button></div>';
    const copyBtn = document.getElementById('cxFailCopy');
    if (copyBtn) copyBtn.addEventListener('click', () => {
      const txt = SUBMIT_FAILS.map((it) => `${fmtTime(it.t)} | ${it.chapter} | ${it.node} | ${it.reason} | ${it.href || ''}`).join('\n');
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(() => log('📕 未提交清单已复制', 'ok')).catch(() => showExportBox(txt));
        } else showExportBox(txt);
      } catch (e) { showExportBox(txt); }
    });
    const clearBtn = document.getElementById('cxFailClear');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      clearSubmitFails();
      log('📕 未提交记录已清空', 'ok');
      renderLogs();
    });
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

  // 「进入页面自动开始」开关:默认开启;关掉时进页面只挂面板,不跑业务循环
  // 例外:用户在暂停态点 ▶ 且触发了整页跳转(如旧版章节页切 mooc2),跳转后要放行一次,
  // 否则重载后又被自动停在暂停,表现成"点了开始还是不动"
  const FORCE_RUN_KEY = 'cxForceRunOnce';
  function setForceRunOnce() {
    try {
      if (typeof GM_setValue !== 'undefined') GM_setValue(FORCE_RUN_KEY, true);
      else sessionStorage.setItem(FORCE_RUN_KEY, '1');
    } catch (e) { /* ignore */ }
  }
  function consumeForceRunOnce() {
    try {
      if (typeof GM_getValue !== 'undefined') {
        if (!GM_getValue(FORCE_RUN_KEY, false)) return false;
        GM_setValue(FORCE_RUN_KEY, false);
        return true;
      }
      if (sessionStorage.getItem(FORCE_RUN_KEY) !== '1') return false;
      sessionStorage.removeItem(FORCE_RUN_KEY);
      return true;
    } catch (e) { return false; }
  }

  function autoStartEnabled() {
    if (CONFIG.autoStart !== false) { consumeForceRunOnce(); return true; }
    return consumeForceRunOnce();
  }

  // 关掉自动开始时的启动态:停在暂停、状态显示「已暂停」,等用户点 ▶
  function holdAtPausedStart() {
    PAUSED = true;
    setStatus('已暂停');
    log('⏸ 已按设置停在暂停状态(设置里「进入页面自动开始」为关闭),点 ▶ 开始刷课', 'warn');
  }

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
      '<div class="field"><div class="row"><div class="label">🚀 进入页面自动开始</div>' +
        '<input id="cfgAutoStart" type="checkbox" ' + (CONFIG.autoStart !== false ? 'checked' : '') + '></div>' +
        '<div class="hint">开(默认):一进课程/作业页就自动答题刷课。关:进页面先停在「已暂停」,看完页面确认是这一节再点 ▶ 开始;保存后下次进入页面生效</div></div>' +
      '<div class="field"><div class="row"><div class="label">🎬 视频倍速</div></div>' +
        '<input id="cfgSpeed" type="number" step="0.25" min="1" max="2" value="' + CONFIG.speed + '">' +
        '<div class="hint">默认 2x(最快);1 = 原速最安全,2x 被检测风险最高,自行权衡</div></div>' +
      '<div class="field"><div class="row"><div class="label">⏰ 定时关闭</div></div>' +
        '<input id="cfgStopAt" type="text" placeholder="23:30" value="' + escHtml(CONFIG.stopAtTime || '') + '">' +
        '<div class="hint">填 HH:MM(如 23:30)= 每天到点自动停止挂机;留空 = 不关闭。比"每天刷够多少分钟"更可控:不影响白天效率,也不怕半夜跑飞</div></div>' +
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
        '<div class="hint">开启后把整页题目一次性发给网页 AI、按题号批量回答再自动填写(1 次对话答完所有题,更快、不易触发限流);关闭则逐题询问。缺漏的题会自动回退逐题询问。含图片的题会单独带图逐题问(整批发文字时 AI 看不到图)</div></div>' +
      '<div class="field"><div class="row"><div class="label">🖼 图片题看原图</div>' +
        '<input id="cfgVision" type="checkbox" ' + (CONFIG.aiVision === false ? '' : 'checked') + '></div>' +
        '<div class="hint">题干/选项是图片(公式、电路图、代码截图)时,把图片本体一起发给 AI,而不是只发一串图片地址。网页 AI 走附件上传(需桥 1.3.2+),API 走多模态。抓图失败会在题干里保留 [图片N] 占位</div></div>' +
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
        '<div class="row" style="margin-top:8px"><div class="label" style="font-size:12px;font-weight:400">填充率需达到(固定 100%,不可改)</div></div>' +
        '<input id="cfgAccuracy" type="text" value="100%" readonly disabled style="width:120px;opacity:0.6;cursor:not-allowed">' +
        '<div class="hint">填充率 = 已填上答案的题数 / 总题数。固定 100%:只要有一题没填上答案就不交卷(空题必错,交白卷最亏);把漏填的任务点记进「未提交」栏,手动补完再交</div></div>' +
      '<div class="sec">🎯 提交后准确率检测</div>' +
      '<div class="field"><div class="row"><div class="label">📊 检测准确率</div>' +
        '<input id="cfgAccCheck" type="checkbox" ' + (CONFIG.accCheckEnabled ? 'checked' : '') + '></div>' +
        '<div class="hint">只对「可重复提交」的任务点生效(有重做/再考一次入口的节点)。提交后先查有没有错题:没有 = 全对,直接进下一个节点;有 → 只把判错的题单独重问 AI(其余题不动),写入错题本后点「重做」。不可重复提交的节点提交后不再检测(改了也交不上去)</div></div>' +
      '<div class="field"><div class="row"><div class="label">📕 有错题就修</div>' +
        '<input id="cfgAccFixAll" type="checkbox" ' + (CONFIG.accFixAllWrong !== false ? 'checked' : '') + '></div>' +
        '<div class="hint">开(默认):只要结果页有错题就重问并重做,哪怕整体准确率已经达标(追求全对)。关:只按下面的阈值判,准确率达标就算过,剩余错题不处理</div></div>' +
      '<div class="field"><div class="row"><div class="label">🎯 准确率阈值(%)</div></div>' +
        '<input id="cfgMinAcc" type="number" step="5" min="0" max="100" style="width:120px" value="' + Math.round((CONFIG.minAccuracy || 0) * 100) + '">' +
        '<div class="hint">当前 ' + Math.round((CONFIG.minAccuracy || 0) * 100) + '%:关掉「有错题就修」时才生效 —— 准确率 ≥ 该值直接进下一节点;低于则把错题单独再问一遍 AI 并点「重做」。仅对可重复提交的节点生效。默认 90</div></div>' +
      '<div class="field"><div class="row"><div class="label">🔁 最多自动重做(次)</div></div>' +
        '<input id="cfgAccRedoMax" type="number" step="1" min="1" max="5" style="width:120px" value="' + (CONFIG.accRedoMax || 2) + '">' +
        '<div class="hint">同一节点最多自动重做几次(默认 2)。到上限就不再重做,记进「未提交」栏等人工处理,避免"重做→又没过→再重做"死循环</div></div>' +
      '<div class="sec">🔧 其他</div>' +
      '<div class="field"><div class="row"><div class="label">📖 自动切章</div>' +
        '<input id="cfgJump" type="checkbox" ' + (CONFIG.autoJump ? 'checked' : '') + '></div>' +
        '<div class="hint">本章任务点全部完成后,自动进入下一章继续刷。切换时会确认页面真的换了章节(章节名或卡片地址变化),没换就重试最多 3 次;3 次都失败说明按钮无效或已是最后一章,会停下来而不是在原地反复扫描</div></div>' +
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
      {
        const vEl = document.getElementById('cfgVision');
        if (vEl) CONFIG.aiVision = vEl.checked;
      }
      CONFIG.webAiUrl = document.getElementById('cfgWebAiUrl').value.trim() || 'https://chat.deepseek.com/';
      CONFIG.deliberateErrorRate = (parseFloat(document.getElementById('cfgErrRate').value) || 0) / 100;
      CONFIG.autoSubmit = document.getElementById('cfgSubmit').checked;
      // 进入页面是否自动开始(下次进入页面生效,不打断当前这一轮)
      {
        const asEl = document.getElementById('cfgAutoStart');
        const prevAuto = CONFIG.autoStart !== false;
        CONFIG.autoStart = asEl ? asEl.checked : true;
        if (prevAuto !== CONFIG.autoStart) {
          log(CONFIG.autoStart
            ? '🚀 已开启「进入页面自动开始」:下次进页面直接开始刷课'
            : '🚀 已关闭「进入页面自动开始」:下次进页面会停在暂停状态,点 ▶ 才开始', 'ok');
        }
      }
      // 定时关闭:HH:MM,填空 = 不关闭;格式非法则回滚到旧值并提示
      {
        const stopEl = document.getElementById('cfgStopAt');
        const raw = stopEl ? stopEl.value.trim() : '';
        if (!raw) {
          CONFIG.stopAtTime = '';
        } else if (parseHHMM(raw)) {
          const hm = parseHHMM(raw);
          CONFIG.stopAtTime = String(hm.h).padStart(2, '0') + ':' + String(hm.mi).padStart(2, '0');
          if (stopEl) stopEl.value = CONFIG.stopAtTime;
        } else {
          log('⏰ 定时关闭时间格式不对(要 HH:MM,如 23:30),本次未修改该设置', 'warn');
          if (stopEl) stopEl.value = CONFIG.stopAtTime || '';
        }
      }
      // 填充率固定 100%(面板输入框只读),这里不需要读取
      // 提交后准确率检测
      CONFIG.accCheckEnabled = document.getElementById('cfgAccCheck').checked;
      {
        const fixEl = document.getElementById('cfgAccFixAll');
        CONFIG.accFixAllWrong = fixEl ? fixEl.checked : true;
        const redoEl = document.getElementById('cfgAccRedoMax');
        let rd = parseInt(redoEl && redoEl.value, 10);
        if (!isFinite(rd)) rd = 2;
        rd = Math.max(1, Math.min(5, rd));
        CONFIG.accRedoMax = rd;
        if (redoEl) redoEl.value = rd;
        const minEl = document.getElementById('cfgMinAcc');
        let pct = parseFloat(minEl && minEl.value);
        if (!isFinite(pct)) pct = 90;
        pct = Math.max(0, Math.min(100, pct));
        CONFIG.minAccuracy = pct / 100;
        if (minEl) minEl.value = pct;
      }
      CONFIG.autoJump = document.getElementById('cfgJump').checked;
      CONFIG.reportUrl = document.getElementById('cfgReport').value.trim();
      saveConfig(CONFIG);
      applyStopClock();   // 定时关闭改动立即生效(不用刷新页面)
      log('配置已保存(倍速 ' + CONFIG.speed + 'x, AI ' + (CONFIG.aiEnabled ? '开' : '关') +
        ', 自动提交 ' + (CONFIG.autoSubmit ? '填充率 100%' : '关') +
        ', 准确率检测 ' + (!CONFIG.accCheckEnabled ? '关'
          : (CONFIG.accFixAllWrong !== false ? '有错题就修' : '≥ ' + Math.round(CONFIG.minAccuracy * 100) + '%') +
            ',最多重做 ' + (CONFIG.accRedoMax || 2) + ' 次') +
        ', 定时关闭 ' + stopClockText() + ')', 'ok');
      panel.remove();
    });
    document.getElementById('cfgClose').addEventListener('click', () => panel.remove());
    // 自动提交开关联动:关闭时填充率说明置灰(表示不再参与判定)
    (function bindSubmitToggle() {
      const subEl = document.getElementById('cfgSubmit');
      const accEl = document.getElementById('cfgAccuracy');
      if (!subEl || !accEl) return;
      const sync = () => {
        accEl.style.opacity = subEl.checked ? '1' : '0.4';
      };
      subEl.addEventListener('change', sync);
      sync();
    })();
    // 准确率检测开关联动:关闭时阈值输入置灰
    (function bindAccToggle() {
      const chk = document.getElementById('cfgAccCheck');
      const minEl = document.getElementById('cfgMinAcc');
      if (!chk || !minEl) return;
      const sync = () => {
        minEl.disabled = !chk.checked;
        minEl.style.opacity = chk.checked ? '1' : '0.45';
      };
      chk.addEventListener('change', sync);
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
