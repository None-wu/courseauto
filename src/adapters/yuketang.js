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
      // 关闭「进入页面自动开始」时:只挂面板,循环不启动,状态停在「已暂停」
      if (!autoStartEnabled()) { holdAtPausedStart(); return; }
      if (this.pageKind() === 'quiz') {
        log('雨课堂测验/习题页:实验阶段未实现自动作答,请手动完成', 'warn');
        return;
      }
      yuketangLoop();
    }
  });
