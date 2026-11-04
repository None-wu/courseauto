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
