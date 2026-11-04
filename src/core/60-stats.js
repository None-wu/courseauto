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
