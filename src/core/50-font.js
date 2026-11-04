  /* ==================== 字体加密解密(Canvas 字形对比法) ==================== */
  // 候选字符集:常用汉字 + 数字字母 + 常见符号(课程题目用字基本都在内)
  const COMMON_CHARS =
    '的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物实现加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处队南给色光门即保治北造百规热领七海口东导器压志世金增争济阶油思术极交受联什认六共权收证改清己美再采转更单风切打白教速花带安场身车例真务具万每目至达走积示议声报斗完类八离华名确才科张信马节话米整空元况今集温传土许步群广石记需段研界拉林律叫且究观越织装影算低持音众书布复容儿须际商非验连断深难近千周委素技备半办青省列习响约支般史感劳便团往酸历市克何除消构府称太准精值号率族维划选标写存候毛亲快效斯院查江型眼王按格养易置派层片始却专状育厂京识适属圆包火住调满县局照参红细引听该铁价严龙飞' +
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' +
    '，。、；：？！“”‘’（）《》〈〉【】[]{}·—…%＋－×÷＝√（）+-×÷=%/\\.,;:!?_*&#@' +
    '一二三四五六七八九十百千万亿年月日时分秒甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥';
  const FONT_NAME = 'cxfontdec';
  let _fontCanvas = null;
  let _fontCtx = null;

  function getFontCtx() {
    if (!_fontCanvas) {
      _fontCanvas = document.createElement('canvas');
      _fontCanvas.width = 32;
      _fontCanvas.height = 32;
      _fontCtx = _fontCanvas.getContext('2d');
    }
    return _fontCtx;
  }

  // 用指定字体渲染一个字符,返回二值化的字形指纹
  function glyphBits(ch, fontName) {
    const ctx = getFontCtx();
    ctx.clearRect(0, 0, 32, 32);
    ctx.font = '28px ' + (fontName || FONT_NAME);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, 16, 17);
    const d = ctx.getImageData(0, 0, 32, 32).data;
    let s = '';
    for (let i = 3; i < d.length; i += 4) s += d[i] > 120 ? '1' : '0';
    return s;
  }

  function hamming(a, b) {
    let n = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
    return n;
  }

  function extractFontBase64(win) {
    const styles = win.document.querySelectorAll('style');
    for (const st of styles) {
      const t = st.textContent || '';
      if (t.includes('font-cxsecret') || t.includes('cxsecret')) {
        const m = t.match(/base64,([\w\W]+?)'/);
        if (m) return m[1];
        const m2 = t.match(/base64,([\w\W]+?)"/);
        if (m2) return m2[1];
      }
    }
    return null;
  }

  // 核心:学习通的加密字体内,把"真实字符"的字形映射到了错误码点。
  // 解密策略两级:①同字体精确字形匹配(字体版本一,最准) ②普通字体模糊最近匹配(字体版本二/候选字也被重映射时兜底)
  // 解出的映射存入全局 _fontMap,收题文本统一经 applyDecryptText 兜底还原。
  const _fontMap = new Map();   // 加密码点 -> 真实字符

  // 题目文本兜底还原:不管元素是否带 .font-cxsecret,只要字符在映射表里就还原
  function applyDecryptText(text) {
    let t = String(text || '');
    if (!_fontMap.size || !t) return t;
    let out = '';
    let changed = false;
    for (const ch of t) {
      const r = _fontMap.get(ch);
      if (r !== undefined && r !== ch) { out += r; changed = true; }
      else out += ch;
    }
    return changed ? out : t;
  }

  async function decodeFont(win, rootEl) {
    const b64 = extractFontBase64(win);
    if (!b64) {
      if (win.document.querySelector('.font-cxsecret')) log('未找到字体定义(可能为其他加密方式)', 'warn');
      return false;
    }
    try {
      const ff = new FontFace(FONT_NAME, 'url(data:font/ttf;base64,' + b64 + ')');
      document.fonts.add(ff);
      await ff.load();
    } catch (e) { log('加密字体加载失败: ' + (e.message || e), 'warn'); return false; }
    const els = Array.from(win.document.querySelectorAll('.font-cxsecret'));
    const targets = new Set();
    els.forEach((el) => { for (const ch of String(el.textContent || '')) targets.add(ch); });
    // 新版页面可能不给元素挂 .font-cxsecret 类,只注入加密字体:从容器文本收集生僻 CJK 字符当目标
    if (!targets.size) {
      const scope = rootEl || win.document.body;
      const txt = String(scope && (scope.innerText || scope.textContent) || '');
      for (const ch of txt) {
        const c = ch.codePointAt(0);
        if (c >= 0x3400 && c <= 0x9FFF && !COMMON_CHARS.includes(ch)) targets.add(ch);
        if (targets.size >= 600) break;
      }
    }
    if (!targets.size) return false;
    const tHashes = new Map();
    for (const ch of targets) {
      try { tHashes.set(ch, glyphBits(ch)); } catch (e) { /* ignore */ }
    }
    if (!tHashes.size) return false;
    log(`🔓 字体解密: ${tHashes.size} 个乱码字符,正在对比常用字字形...`, 'info');
    const resolved = new Map();
    const candBits = [];
    const start = Date.now();
    for (let ci = 0; ci < COMMON_CHARS.length; ci++) {
      const ch = COMMON_CHARS[ci];
      try {
        candBits.push([ch, glyphBits(ch), glyphBits(ch, 'sans-serif')]);
      } catch (e) { /* ignore */ }
      if (Date.now() - start > 12000) { log('字体解密:候选字渲染超时,用已渲染部分继续', 'warn'); break; }
    }
    // 第一级:同字体精确匹配
    for (const [target, thash] of tHashes) {
      for (const [ch, bits] of candBits) {
        if (bits === thash) { resolved.set(target, ch); break; }
      }
    }
    // 第二级:普通字体模糊最近匹配(仅对未解出的)
    for (const [target, thash] of tHashes) {
      if (resolved.has(target)) continue;
      let best = null, bestDist = Infinity;
      for (const [ch, , plainBits] of candBits) {
        const d = hamming(thash, plainBits);
        if (d < bestDist) { bestDist = d; best = ch; }
      }
      // 1024 位指纹,阈值 12%:字形足够接近才认(普通字体与加密字体字形有差异,不能太严也不能太松)
      if (best && bestDist < 123) resolved.set(target, best);
    }
    if (!resolved.size) { log('字体解密未能匹配(可能含非常用字),跳过自动作答', 'warn'); return false; }
    // 注意:绝不原地改写页面 DOM!页面靠加密字体本就能正常显示,改写反而会洗掉选项里的
    // 单选按钮等结构,导致用户无法在页面上手动答题。这里只把映射存进 _fontMap,
    // 发题给 AI / 填空写入时经 applyDecryptText() 还原。
    for (const [t, r] of resolved) _fontMap.set(t, r);
    log(`🔓 字体解密完成,还原 ${resolved.size}/${tHashes.size} 个字符(仅用于发题,页面显示不受影响)`, 'ok');
    return true;
  }
