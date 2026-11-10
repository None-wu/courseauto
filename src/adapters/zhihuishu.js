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
      // 关闭「进入页面自动开始」时:只挂面板,循环不启动,状态停在「已暂停」
      if (!autoStartEnabled()) { holdAtPausedStart(); return; }
      if (this.pageKind() === 'quiz') {
        log('智慧树测验页:实验阶段只支持视频页,测验请用学习通那套流程手动完成', 'warn');
        return;
      }
      zhihuishuLoop();
    }
  });
