  /* ==================== 题目图片(视觉题) ==================== */
  // 学习通/智慧树里不少题的题干、选项本身就是图片(公式、电路图、代码截图),
  // 页面里只有一个 <img src>。老逻辑只把题干当文字取,图片标签要么被 clean 掉、
  // 要么原样丢给 AI —— AI 看到的是一串地址,自然答不出。这里做三件事:
  //   ① 把 <img> 抽出来,用 [图片N] 占位留在题干里(文字链路不丢信息)
  //   ② 把图片本体转成 dataURL(带缓存、限张数、限体积)
  //   ③ 两条送图通道:API 通道走 OpenAI 兼容的 image_url 多模态;
  //      网页 AI 通道把图片当附件粘贴/上传到输入框(由「网页AI桥」执行)

  const IMG_MAX_COUNT = 3;              // 单题最多送几张(再多容易超时/AI 看花眼)
  const IMG_MAX_SIDE = 1400;            // 长边超过这个就先缩(视觉模型内部也会缩,提前缩省带宽)
  const IMG_MAX_CHARS = 700 * 1024;     // 单张 dataURL 字符上限(约 512KB 二进制)
  const IMG_HARD_CHARS = 1100 * 1024;   // 缩过还是超大就放弃,不让整个请求卡住
  const IMG_CACHE = new Map();          // src -> dataURL('' 表示抓取失败,不再重复试)
  let imgWarned = false;

  // 从一段 HTML 里抽图片地址(含懒加载 data-src / 背景图写法)
  function imgSrcsOfHtml(html) {
    const out = [];
    const s = String(html || '');
    if (!s) return out;
    let m;
    const re = /<img[^>]+(?:src|data-src|data-original)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
    while ((m = re.exec(s)) !== null) {
      const url = String(m[1] || m[2] || m[3] || '').trim();
      if (url && !/^about:blank$/i.test(url) && !/^data:image\/gif/i.test(url)) out.push(url);
    }
    const bg = /background(?:-image)?\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
    while ((m = bg.exec(s)) !== null) {
      const url = String(m[1] || '').trim();
      if (url && !/^about:blank$/i.test(url)) out.push(url);
    }
    return out;
  }

  // 容器内所有题面图片(题干区+选项区)。滤掉 1x1 跟踪图与小图标(勾/叉/播放键这类)
  function pickImagesIn(el) {
    const out = [];
    if (!el || !el.querySelectorAll) return out;
    try {
      el.querySelectorAll('img').forEach((im) => {
        const src = String(im.getAttribute('src') || im.getAttribute('data-src') ||
          im.getAttribute('data-original') || '').trim();
        if (!src || /^about:blank$/i.test(src) || /^data:image\/gif/i.test(src)) return;
        const w = im.naturalWidth || im.width || 0;
        const h = im.naturalHeight || im.height || 0;
        if (w && h && w <= 24 && h <= 24) return;
        if (!out.includes(src)) out.push(src);
      });
    } catch (e) { /* ignore */ }
    return out;
  }

  // 一行 HTML 里的 <img> 换成 [图片N],sink 按出现顺序收集 src(占位号 = sink 下标 + 1)
  function replaceImgTags(html, sink) {
    return String(html || '').replace(/<img\b[^>]*>/gi, (tag) => {
      const src = imgSrcsOfHtml(tag)[0] || '';
      if (!src) return '';
      if (!sink.includes(src)) sink.push(src);
      return `[图片${sink.indexOf(src) + 1}]`;
    });
  }

  // 题干/选项:抽图片 + 留占位。返回去重后的图片地址列表(q.imgSrc)
  function markQuestionImages(q) {
    if (!q) return 0;
    if (q.__imgMarked) return (q.imgSrc || []).length;
    const sink = [];
    q.question = clean(replaceImgTags(q.question, sink));
    if (Array.isArray(q.options)) q.options = q.options.map((o) => clean(replaceImgTags(o, sink)));
    // 适配器已经把容器内图片地址一并带过来(titleImg),合并去重后统一按顺序编号
    (q.titleImg || []).forEach((s) => { if (s && !sink.includes(s)) sink.push(s); });
    q.imgSrc = sink;
    q.__imgMarked = true;
    return sink.length;
  }

  // 题干是否含图片(整卷模式要把这些题剔出来单独带图问)
  function questionHasImage(q) {
    if (!q) return false;
    if (q.images && q.images.length) return true;
    if (q.imgSrc && q.imgSrc.length) return true;
    if (/<img\b/i.test(String(q.question || ''))) return true;
    if (Array.isArray(q.options) && q.options.some((o) => /<img\b/i.test(String(o || '')))) return true;
    if (q.titleImg && q.titleImg.length) return true;
    return false;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve) => {
      try {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result || ''));
        fr.onerror = () => resolve('');
        fr.readAsDataURL(blob);
      } catch (e) { resolve(''); }
    });
  }

  // 油猴跨域取二进制:GM_xmlhttpRequest 不受同源限制(@connect 需放行图片域名)
  function gmLoadBlob(url) {
    if (typeof GM_xmlhttpRequest === 'undefined') return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const fin = (v) => { if (!settled) { settled = true; resolve(v); } };
      try {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          responseType: 'blob',
          timeout: 15000,
          onload: (r) => fin(r && r.response instanceof Blob ? r.response : null),
          onerror: () => fin(null),
          ontimeout: () => fin(null)
        });
      } catch (e) { fin(null); }
    });
  }

  // 缩小重编码:长边超过 maxSide 才处理;透明 PNG 转 JPEG 前先铺白底(否则透明区变黑)
  function shrinkDataUrl(dataUrl, maxSide) {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.onload = () => {
          try {
            const w = img.naturalWidth || img.width;
            const h = img.naturalHeight || img.height;
            if (!w || !h) { resolve(dataUrl); return; }
            const scale = Math.min(1, maxSide / Math.max(w, h));
            if (scale >= 1 && dataUrl.length <= IMG_MAX_CHARS) { resolve(dataUrl); return; }
            const cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.round(w * scale));
            cv.height = Math.max(1, Math.round(h * scale));
            const ctx = cv.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, cv.width, cv.height);
            ctx.drawImage(img, 0, 0, cv.width, cv.height);
            resolve(cv.toDataURL('image/jpeg', 0.85));
          } catch (e) { resolve(dataUrl); }
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
      } catch (e) { resolve(dataUrl); }
    });
  }

  async function imgToDataUrl(src) {
    const s = String(src || '');
    if (!s) return '';
    if (IMG_CACHE.has(s)) return IMG_CACHE.get(s);
    let dataUrl = /^data:image\//i.test(s) ? s : '';
    if (!dataUrl) {
      const blob = await gmLoadBlob(s);
      if (blob) dataUrl = await blobToDataUrl(blob);
    }
    if (!dataUrl) {
      // 没有 GM 权限或 GM 被挡(普通 fetch + 同源 cookie)
      try {
        const r = await fetch(s, { credentials: 'include' });
        if (r && r.ok) dataUrl = await blobToDataUrl(await r.blob());
      } catch (e) { /* 跨域/防盗链,继续 canvas 兜底 */ }
    }
    if (!dataUrl) {
      // 页面里已经画出来的图:用 canvas 取像素(需要图片本身允许跨域,否则 taint 失败)
      dataUrl = await new Promise((resolve) => {
        try {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            try {
              const cv = document.createElement('canvas');
              cv.width = img.naturalWidth || img.width;
              cv.height = img.naturalHeight || img.height;
              cv.getContext('2d').drawImage(img, 0, 0);
              resolve(cv.toDataURL('image/png'));
            } catch (e) { resolve(''); }
          };
          img.onerror = () => resolve('');
          img.src = s;
        } catch (e) { resolve(''); }
      });
    }
    if (dataUrl && dataUrl.length > IMG_MAX_CHARS) dataUrl = await shrinkDataUrl(dataUrl, IMG_MAX_SIDE);
    if (dataUrl && dataUrl.length > IMG_HARD_CHARS) dataUrl = '';   // 太大宁可只发文字
    IMG_CACHE.set(s, dataUrl);
    return dataUrl;
  }

  // 收集题目图片并转 dataURL。结果写进 q.images(已处理过就直接返回,不重复下载)
  async function ensureQuestionImages(q) {
    if (!q) return [];
    if (Array.isArray(q.images)) return q.images;
    q.images = [];
    if (CONFIG.aiVision === false) return q.images;      // 用户关了「图片题看原图」
    const total = markQuestionImages(q);
    if (!total) return q.images;
    const list = (q.imgSrc || []).slice(0, IMG_MAX_COUNT);
    for (const src of list) {
      const d = await imgToDataUrl(src);
      if (d) q.images.push(d);
    }
    if (q.images.length) {
      log(`🖼 这道题含 ${total} 张图片,已随题发送给 AI(${q.images.length} 张)`, 'ok');
    } else if (!imgWarned) {
      imgWarned = true;
      log('🖼 题目图片抓取失败(需要登录态/防盗链/跨域):题干里保留 [图片N] 占位,AI 只能凭文字作答', 'warn');
    }
    return q.images;
  }
