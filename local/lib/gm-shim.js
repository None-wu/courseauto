// 最小 GM_* API 垫片：让油猴脚本能在普通页面里跑起来
// 注入时机：addInitScript（每次导航前、页面脚本之前）
(function () {
  if (window.__cxGmShimInstalled) return;
  window.__cxGmShimInstalled = true;

  var NS = 'cxMock:';
  function rawGet(key) {
    try {
      var v = localStorage.getItem(NS + key);
      return v === null ? undefined : JSON.parse(v);
    } catch (e) { return undefined; }
  }
  function rawSet(key, val) {
    try { localStorage.setItem(NS + key, JSON.stringify(val)); } catch (e) { /* ignore */ }
  }

  window.GM_getValue = function (key, def) {
    var v = rawGet(key);
    return v === undefined ? def : v;
  };
  window.GM_setValue = function (key, val) { rawSet(key, val); };
  window.GM_deleteValue = function (key) {
    try { localStorage.removeItem(NS + key); } catch (e) { /* ignore */ }
  };
  // 名称与版本由注入方(server.mjs / dev/*.mjs)从构建产物元数据替换,保证与真实安装一致
  window.GM_info = {
    script: { name: '__SCRIPT_NAME__', version: '__SCRIPT_VERSION__', namespace: 'cx-auto-study' },
    scriptHandler: 'Tampermonkey(shim)'
  };

  // 只在首次运行时写入默认配置，之后改配置会持久化
  if (rawGet('cxConfig') === undefined) {
    rawSet('cxConfig', {
      speed: 1,
      autoVideo: true,
      autoAudio: true,
      autoWork: true,
      autoSubmit: true,
      autoJump: true,
      answerIntervalMin: 0,
      answerIntervalMax: 0,
      submitDelayMin: 0,
      submitDelayMax: 0,
      minAccuracy: 0.9,          // 提交后准确率阈值(只对可重复提交的节点生效)
      accCheckEnabled: true,
      stopAtTime: '',            // 定时关闭(HH:MM),空 = 不关闭
      deliberateErrorRate: 0,
      aiEnabled: true,
      aiKey: 'sk-mock-1234',
      aiUrl: '/v1/chat/completions',      // 同源模拟接口
      aiModel: 'mock-model',
      useTiku: false,
      reportUrl: '/report'                // 模拟上报接收端
    });
  }

  window.GM_xmlhttpRequest = function (opts) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () {
      try { ctrl.abort(); } catch (e) { /* ignore */ }
      if (opts.ontimeout) opts.ontimeout();
    }, opts.timeout || 15000);

    fetch(opts.url, {
      method: opts.method || 'GET',
      headers: opts.headers || {},
      body: opts.data,
      signal: ctrl.signal
    }).then(function (r) {
      return r.text().then(function (text) {
        clearTimeout(timer);
        if (opts.onload) opts.onload({ status: r.status, responseText: text, readyState: 4 });
      });
    }).catch(function (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') return;
      if (opts.onerror) opts.onerror(err);
    });
  };
})();
