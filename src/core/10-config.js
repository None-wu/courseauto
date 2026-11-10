  /* ==================== 配置 ==================== */
  const DEFAULT_CONFIG = {
    speed: 2,              // 视频倍速(默认 2x 最快;1 = 原速最安全,2x 检测风险最高,自行权衡)
    autoVideo: true,       // 自动处理视频任务
    autoAudio: true,       // 自动处理音频任务
    autoWork: true,        // 自动做章节测验
    autoSubmit: true,      // 填充率 100%(所有题都作答成功)才自动提交测验
    autoJump: true,        // 本章完成后自动切下一章
    answerIntervalMin: 0,  // 每题最小间隔(秒,0=最快)
    answerIntervalMax: 0,  // 每题最大间隔(秒,0=最快)
    submitDelayMin: 0,     // 提交前最小延迟(秒,0=最快)
    submitDelayMax: 0,     // 提交前最大延迟(秒,0=最快)
    stopAtTime: '',        // 定时关闭(HH:MM),到点自动停止挂机;留空 = 不关闭
    accCheckEnabled: false, // 提交后检测准确率(仅对「可重复提交」的任务点生效)
    minAccuracy: 0.9,      // 提交后要求的准确率,低于则重问错题(需 accCheckEnabled)
    accFixAllWrong: true,  // 只要有错题就去修(不看整体准确率);关掉则仅在低于 minAccuracy 时才修
    accRedoMax: 2,          // 同一节点最多自动重做几次(防死循环)
    deliberateErrorRate: 0, // 故意答错率 0~0.2(0=不故意错)
    aiEnabled: false,      // 启用 DeepSeek AI 答题(需填 key)
    aiKey: '',              // 个人 API Key:点面板 ⚙ 填写(platform.deepseek.com 创建,只存本机)
    aiUrl: 'https://api.deepseek.com/v1/chat/completions',
    aiModel: 'deepseek-reasoner',
    useTiku: false,         // 免费题库站(已停止免费,默认关闭,纯 AI 答题)
    reportUrl: '',          // 状态上报地址(调试用,留空=关闭);如 http://127.0.0.1:8790/report
    webAiEnabled: false,    // 网页 AI 答题(免 API Key,需配合「网页AI桥」脚本)
    webAiBatch: true,       // 整卷模式:整页题目一次性发给网页 AI,批量解析后逐题填写(更快、不易限流;缺漏的题自动回退逐题询问)
    webAiBatchRetry: true,  // 整卷缺题时再整批补问一次(关掉则直接逐题回退)
    webAiUrl: 'https://chat.deepseek.com/',  // 网页 AI 地址
    webAiRelay: 'http://127.0.0.1:8790',     // 本地中转服务(桥脚本经此收题,AI 页手动打开即可)
    webAiTimeout: 60,       // 等网页 AI 回复的超时(秒)
    aiVision: true,         // 图片题:把题干里的图片抽出来随题发送(AI 才能"看图作答")
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
  // 一次性迁移(v1.0.6):旧存储的 1x 倍速 强制升级为新默认 2x
  try {
    const MIG = 'cxMigV105';
    const done = (typeof GM_getValue !== 'undefined') ? GM_getValue(MIG, false) : localStorage.getItem(MIG);
    if (!done) {
      CONFIG.speed = 2;
      saveConfig(CONFIG);
      if (typeof GM_setValue !== 'undefined') GM_setValue(MIG, true);
      else localStorage.setItem(MIG, '1');
    }
  } catch (e) { /* ignore */ }
  // 一次性迁移(v1.5.0):清掉已废弃的配置键(每日时长上限/弹题延迟),
  // 并把 minAccuracy 从"提交前正确率门槛"重置为"提交后准确率阈值"
  try {
    const MIG = 'cxMigV150';
    const done = (typeof GM_getValue !== 'undefined') ? GM_getValue(MIG, false) : localStorage.getItem(MIG);
    if (!done) {
      delete CONFIG.dailyLimitMinutes;
      delete CONFIG.quizDelayMin;
      delete CONFIG.quizDelayMax;
      CONFIG.minAccuracy = 0.9;
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

  /* ==================== 错题本 ==================== */
  // 提交后准确率不达标时,把判错的题单独重问 AI,结果按题干存本地;
  // 下次重做同一任务点优先命中,避免同一道题再做错一次。
  let FIX_BANK = [];
  try {
    const raw = (typeof GM_getValue !== 'undefined') ? GM_getValue('cxFixBank', []) : JSON.parse(localStorage.getItem('cxFixBank') || '[]');
    if (Array.isArray(raw)) FIX_BANK = raw;
  } catch (e) { FIX_BANK = []; }
  function fixKey(s) {
    return String(s || '').replace(/[\s\u3000]/g, '').replace(/[，。、；：？！,.;:?!"'“”‘’（）()《》<>【】\[\]]/g, '').slice(0, 80);
  }
  function recordFix(q, answer) {
    try {
      const key = fixKey(q.question);
      if (!key || !answer || !answer.length) return;
      const idx = FIX_BANK.findIndex((it) => it.k === key);
      const entry = { k: key, q: String(q.question).slice(0, 200), t: String(q.type), a: answer.join('|'), n: Date.now() };
      if (idx >= 0) FIX_BANK[idx] = entry; else FIX_BANK.push(entry);
      if (FIX_BANK.length > 2000) FIX_BANK = FIX_BANK.slice(-2000);
      if (typeof GM_setValue !== 'undefined') GM_setValue('cxFixBank', FIX_BANK);
      else localStorage.setItem('cxFixBank', JSON.stringify(FIX_BANK));
    } catch (e) { /* ignore */ }
  }
  function lookupFix(question) {
    try {
      const key = fixKey(question);
      if (!key) return null;
      const hit = FIX_BANK.find((it) => it.k === key);
      return hit ? String(hit.a || '').split('|').filter(Boolean) : null;
    } catch (e) { return null; }
  }

  /* ==================== 未成功提交的任务点记录 ==================== */
  // 交不上去(填充率不足/提交按钮没找到/提交异常)的任务点单独留档,
  // 面板单列一栏展示,方便用户直接定位到哪个章节的哪个节点需要手动补交。
  let SUBMIT_FAILS = [];
  try {
    const raw = (typeof GM_getValue !== 'undefined') ? GM_getValue('cxSubmitFails', []) : JSON.parse(localStorage.getItem('cxSubmitFails') || '[]');
    if (Array.isArray(raw)) SUBMIT_FAILS = raw;
  } catch (e) { SUBMIT_FAILS = []; }
  function recordSubmitFail(entry) {
    try {
      const item = {
        t: Date.now(),
        chapter: String(entry.chapter || ''),
        node: String(entry.node || ''),
        reason: String(entry.reason || ''),
        href: String(entry.href || location.href).slice(0, 300)
      };
      // 同一节点重复失败只保留最后一次(按 chapter+node 去重)
      const idx = SUBMIT_FAILS.findIndex((it) => it.chapter === item.chapter && it.node === item.node);
      if (idx >= 0) SUBMIT_FAILS[idx] = item; else SUBMIT_FAILS.push(item);
      if (SUBMIT_FAILS.length > 300) SUBMIT_FAILS = SUBMIT_FAILS.slice(-300);
      if (typeof GM_setValue !== 'undefined') GM_setValue('cxSubmitFails', SUBMIT_FAILS);
      else localStorage.setItem('cxSubmitFails', JSON.stringify(SUBMIT_FAILS));
      log(`📕 未提交任务点已记入「未提交」栏:${item.chapter} / ${item.node}(${item.reason})`, 'err');
    } catch (e) { /* ignore */ }
  }
  function clearSubmitFails() {
    SUBMIT_FAILS = [];
    try {
      if (typeof GM_setValue !== 'undefined') GM_setValue('cxSubmitFails', []);
      else localStorage.setItem('cxSubmitFails', '[]');
    } catch (e) { /* ignore */ }
  }
  function submitFailCount() { return SUBMIT_FAILS.length; }
