  /* ==================== 自动更新检测(仅在远端版本更高时刷新) ==================== */
  function verParts(v) {
    return String(v || '0').split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  }
  function verGreater(a, b) {
    const x = verParts(a), y = verParts(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const p = x[i] || 0, q = y[i] || 0;
      if (p > q) return true;
      if (p < q) return false;
    }
    return false;
  }
  function updateGuard() {
    try { return Number(GM_getValue('cxUpdateTryAt', 0)) || 0; } catch (e) { return 0; }
  }
  function markUpdateTry(t) {
    try { GM_setValue('cxUpdateTryAt', t); } catch (e) { /* ignore */ }
  }
  function startAutoUpdater() {
    setInterval(async () => {
      try {
        if (PAUSED || running) return; // 有任务进行中不打断
        const myV = (typeof GM_info !== 'undefined' && GM_info.script) ? GM_info.script.version : '0';
        const text = await cxFetch('https://cdn.jsdelivr.net/gh/DaRin1403/xuexitong-autostudy@main/version.json', { timeout: 10000 });
        // 有些编辑器会在 UTF-8 文件头写 BOM,JSON.parse 会直接抛错 → 先剥掉再解析
        const obj = JSON.parse(String(text || '').replace(/^\uFEFF/, '').trim());
        const remoteV = String(obj.v || '');
        if (!remoteV || !verGreater(remoteV, myV)) return;   // 同版本或更低:不动
        // 冷却 6 小时:上次刷新后仍是旧版本,说明更新没装成功,不再反复刷新
        if (Date.now() - updateGuard() < 6 * 3600 * 1000) return;
        log(`🔄 检测到新版本 v${remoteV}(当前 v${myV}),页面即将自动刷新以加载新版...`, 'warn');
        markUpdateTry(Date.now());
        await sleep(3);
        location.reload();
      } catch (e) { /* 服务器不在线则忽略 */ }
    }, 5 * 60 * 1000);
  }

