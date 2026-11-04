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
