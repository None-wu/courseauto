  /* ==================== 配置 ==================== */
  const DEFAULT_CONFIG = {
    speed: 2,              // 视频倍速(默认 2x 最快;1 = 原速最安全,2x 检测风险最高,自行权衡)
    autoVideo: true,       // 自动处理视频任务
    autoAudio: true,       // 自动处理音频任务
    autoWork: true,        // 自动做章节测验
    autoJump: true,        // 本章完成后自动切下一章
    answerIntervalMin: 0,  // 每题最小间隔(秒,0=最快)
    answerIntervalMax: 0,  // 每题最大间隔(秒,0=最快)
    submitDelayMin: 0,     // 提交前最小延迟(秒,0=最快)
    submitDelayMax: 0,     // 提交前最大延迟(秒,0=最快)
    stopAtTime: '',        // 定时关闭(HH:MM),到点自动停止挂机;留空 = 不关闭
    autoStart: true,       // 进入页面立即开始答题刷课;关掉 = 进页面先停在暂停态,手动点 ▶ 才开始
    minAccuracy: 1,        // 提交后要求的准确率(默认 100%),低于则重问错题
    accRedoMax: 2,          // 同一节点最多自动重做几次(防死循环)
    useTiku: false,         // 免费题库站(已停止免费,默认关闭,纯 AI 答题)
    webAiEnabled: false,    // 网页 AI 答题(免 Key,需配合「网页AI桥」脚本)
    webAiBatch: true,       // 整卷模式:整页题目一次性发给网页 AI,批量解析后逐题填写(更快、不易限流;缺漏的题自动回退逐题询问)
    webAiBatchRetry: true,  // 整卷缺题时再整批补问一次(关掉则直接逐题回退)
    webAiUrl: 'https://chat.deepseek.com/',  // 网页 AI 地址
    webAiRelay: 'http://127.0.0.1:8790',     // 本地中转服务(桥脚本经此收题,AI 页手动打开即可)
    webAiTimeout: 60,       // 等网页 AI 回复的超时(秒)
  };

  let HAD_SAVED_CONFIG = false;   // 首次安装 = false:老版本迁移只对老存档生效,不覆盖新装默认值
  function loadConfig() {
    try {
      const saved = (typeof GM_getValue !== 'undefined')
        ? GM_getValue('cxConfig', null)
        : JSON.parse(localStorage.getItem('cxConfig') || 'null');
      if (saved && typeof saved === 'object') { HAD_SAVED_CONFIG = true; return Object.assign({}, DEFAULT_CONFIG, saved); }
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
      if (HAD_SAVED_CONFIG) CONFIG.speed = 2;   // 全新安装本就是默认 2x,不属于需要升级的老存档
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
      // 老存档里的 minAccuracy 是「提交前正确率门槛」,语义已变才重置为 90%;
      // 全新安装没有这个历史包袱,保持默认 100%
      if (HAD_SAVED_CONFIG) CONFIG.minAccuracy = 0.9;
      saveConfig(CONFIG);
      if (typeof GM_setValue !== 'undefined') GM_setValue(MIG, true);
      else localStorage.setItem(MIG, '1');
    }
  } catch (e) { /* ignore */ }
  if (CONFIG.speed > 2) { CONFIG.speed = 2; }  // 倍速上限 2x

  /* 一次性迁移(v1.6.1):v1.6.0 面板精简掉的控件,其配置键现在也一并从代码里移除。
     行为已固定:看原图、卡住跳章、填充率 100% 才提交、有错题就修、不故意答错、不上报状态。
     这里清掉老版本存档里的残留键,免得旧值继续被存盘 */
  try {
    const MIG = 'cxMigV161';
    const done = (typeof GM_getValue !== 'undefined') ? GM_getValue(MIG, false) : localStorage.getItem(MIG);
    if (!done) {
      ['aiVision', 'skipStuckChapter', 'autoSubmit', 'accCheckEnabled', 'accFixAllWrong',
       'deliberateErrorRate', 'reportUrl'].forEach((k) => { delete CONFIG[k]; });
      // 注意:准确率阈值是面板保留的可调项,迁移不能覆盖用户设定,只清残留键
      saveConfig(CONFIG);
      if (typeof GM_setValue !== 'undefined') GM_setValue(MIG, true);
      else localStorage.setItem(MIG, '1');
    }
  } catch (e) { /* ignore */ }

  function showExportBox(data) {
    const ta = document.createElement('textarea');
    ta.value = data;
    ta.style.cssText = 'position:fixed;left:16px;bottom:16px;width:460px;height:220px;z-index:2147483647;background:rgba(255,255,255,0.95);color:#3b3b43;border:1px solid rgba(255,255,255,0.6);border-radius:8px;padding:8px;font:12px monospace;box-shadow:0 8px 32px rgba(160,60,120,0.22)';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    ta.addEventListener('blur', () => { try { ta.remove(); } catch (e) {} });
    log('📋 数据已生成在左下角文本框,全选(Ctrl+A)复制即可', 'ok');
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
