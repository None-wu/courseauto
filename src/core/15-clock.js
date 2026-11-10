  /* ==================== 定时关闭 ==================== */
  // 替代原来的「每日学习时长上限」:不统计时长,只按用户设定的时刻到点停止挂机。
  // 用轮询而不是一次性 setTimeout —— 标签页在后台会被浏览器节流,长定时器醒来可能晚很久;
  // 轮询时按"上次检查到本次检查之间是否跨过了今天的该时刻"判定,即使被节流也能在下次醒来时补触发。
  let stopClockTick = null;
  let stopClockLastTick = Date.now();
  let stopClockFiredDate = '';

  function parseHHMM(s) {
    const m = /^(\d{1,2})\s*[:：]\s*(\d{1,2})$/.exec(String(s || '').trim());
    if (!m) return null;
    const h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
    if (!(h >= 0 && h <= 23 && mi >= 0 && mi <= 59)) return null;
    return { h: h, mi: mi };
  }

  function stopClockText() {
    const hm = parseHHMM(CONFIG.stopAtTime);
    if (!hm) return '未启用';
    return `${String(hm.h).padStart(2, '0')}:${String(hm.mi).padStart(2, '0')}`;
  }

  function doScheduledStop() {
    const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    log(`⏰ 已到定时关闭时间(${stopClockText()},${now}),自动停止挂机`, 'warn');
    try { PAUSED = true; } catch (e) { /* ignore */ }
    try { if (typeof setStatus === 'function') setStatus('已暂停'); } catch (e) { /* ignore */ }
    try { if (typeof pausePageMedia === 'function') pausePageMedia(); } catch (e) { /* ignore */ }
    try { if (typeof stopWatching === 'function') stopWatching(); } catch (e) { /* ignore */ }
  }

  function applyStopClock() {
    if (stopClockTick) { clearInterval(stopClockTick); stopClockTick = null; }
    stopClockLastTick = Date.now();
    const hm = parseHHMM(CONFIG.stopAtTime);
    if (!hm) return;
    log(`⏰ 已启用定时关闭:每天 ${stopClockText()} 自动停止挂机(要改时间请点 ⚙)`, 'ok');
    stopClockTick = setInterval(() => {
      const cur = parseHHMM(CONFIG.stopAtTime);
      if (!cur) return;
      const now = Date.now();
      const from = stopClockLastTick;
      stopClockLastTick = now;
      // 检查 [上次检查, 本次检查] 区间内是否跨过了今天(或昨天,跨夜补判)的该时刻
      const hit = (function () {
        const d = new Date();
        const tToday = new Date(d.getFullYear(), d.getMonth(), d.getDate(), cur.h, cur.mi, 0, 0).getTime();
        const tYest = tToday - 86400000;
        if (from < tToday && tToday <= now) return tToday;
        if (from < tYest && tYest <= now) return tYest;
        return 0;
      })();
      if (!hit) return;
      const key = new Date(hit).toDateString();
      if (stopClockFiredDate === key) return;   // 同一天只停一次
      stopClockFiredDate = key;
      doScheduledStop();
    }, 20000);
  }
