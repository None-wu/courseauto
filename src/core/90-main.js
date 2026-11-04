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
