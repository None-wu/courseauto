  /* ==================== 题目提取 ==================== */
  // 章节测验(.TiMu 容器)
  // 题干兜底链(不同版本/不同题型 DOM 不一样)
  function pickTitleHtml(el) {
    const sels = ['.mark_name', '.Zy_TItle .clearfix', '.Zy_TItle', '.clearfix .fontLabel', '.fontLabel',
      '.question-title', '.q-title', '.timu', 'h3', 'h2'];
    for (const s of sels) {
      const n = el.querySelector(s);
      if (n && clean(n.innerHTML)) return n.innerHTML;
    }
    // 最后兜底:去掉选项区后的整块文本
    const clone = el.cloneNode(true);
    clone.querySelectorAll('ul, ol, .answer_p, .answerBg, textarea, input, .btn, button').forEach((n) => n.remove());
    return clone.innerHTML;
  }

  // 选项兜底链(li 类容器要去掉序号前缀和隐藏 input,否则会把"A、"混进选项文本)
  function optText(node) {
    const c = node.cloneNode(true);
    c.querySelectorAll('input, textarea, .num_option, .check_answer, i').forEach((n) => n.remove());
    return clean(c.innerHTML);
  }
  function pickOptions(el) {
    const plain = ['ul li .after', '.answer_p .after', '.option-text', '.after'];
    for (const s of plain) {
      const arr = Array.from(el.querySelectorAll(s)).map((o) => clean(o.innerHTML)).filter(Boolean);
      if (arr.length >= 2) return arr;
    }
    const boxes = ['.answer_p', 'ul li', 'ol li', 'label.option', '.option-item', 'dd'];
    for (const s of boxes) {
      const arr = Array.from(el.querySelectorAll(s)).map(optText).filter(Boolean);
      if (arr.length >= 2) return arr;
    }
    return [];
  }

  // 学习通每题都会渲染题型标记([判断题]/【单选题】…),这是最可靠的题型来源:
  // 选项文字被字体加密时(拿不到"正确/错误"字样)只有它能判出题型
  function typeFromTag(el) {
    let t = '';
    try { t = String(el.textContent || '').slice(0, 90); } catch (e) { return null; }
    const m = t.match(/[\[【(（]\s*(判断题|单选题|多选题|填空题|简答题|论述题|名词解释|计算题)\s*[\]】)）]/);
    if (!m) return null;
    if (m[1] === '判断题') return '3';
    if (m[1] === '单选题') return '0';
    if (m[1] === '多选题') return '1';
    return '2';
  }
  // 题型推断:题型标记 → 选项语义(判断题)→ answertype 隐藏域 → 控件类型
  function inferType(el, options) {
    const tagged = typeFromTag(el);
    if (tagged) return tagged;
    const o = options || [];
    // 选项就是"正确/错误"(或双 radio 的 value 为 true/false、对/错)→ 判断题。
    // 置于隐藏域之前:不同版本 answertype 取值不一(有的判断题给 0/1),按选项语义判最稳。
    const s0 = o.length === 2 ? judgeSideOfText(o[0]) : null;
    const s1 = o.length === 2 ? judgeSideOfText(o[1]) : null;
    if (s0 !== null && s1 !== null && s0 !== s1) return '3';
    let radios = [];
    try { radios = Array.from(el.querySelectorAll('input[type=radio]')); } catch (e) { /* ignore */ }
    if (radios.length === 2) {
      const v0 = judgeSideOfValue(radios[0].value);
      const v1 = judgeSideOfValue(radios[1].value);
      if (v0 !== null && v1 !== null && v0 !== v1) return '3';
    }
    const t = el.querySelector('input[name^=answertype], input[name^=type]');
    if (t && String(t.value) !== '') return String(t.value);
    if (el.querySelector('textarea, .edui-editor, [contenteditable=true]')) return '2';
    if (el.querySelector('input[type=checkbox]')) return '1';
    return '0';
  }

  // 题干/选项里的图片地址单独带一份:题干一旦被 clean 成文本,懒加载图或
  // 不在题干容器里的配图就找不回来了(图片题全靠它送图给 AI)
  function withImgs(el, q) {
    if (!q) return q;
    try {
      const imgs = pickImagesIn(el);
      if (imgs.length) q.titleImg = imgs;
    } catch (e) { /* ignore */ }
    return q;
  }

  function extractQuizQuestion(el) {
    try {
      const text = applyDecryptText(cl(clean(pickTitleHtml(el))));
      if (!text) return null;
      const options = pickOptions(el).map(applyDecryptText);
      return withImgs(el, { question: text, options, type: inferType(el, options) });
    } catch (e) { return null; }
  }
  // 作业页(.questionLi 容器)
  function extractWorkQuestion(el) {
    try {
      const mark = el.querySelector('.mark_name');
      let html = mark ? mark.innerHTML : '';
      const idx = html.indexOf('</span>');
      // .mark_name 里常把题型放在第一个 span 里,先剥掉;剥完为空则退回整块题干
      let text = cl(clean(idx >= 0 ? html.substring(idx + 7) : html));
      if (!text) text = cl(clean(pickTitleHtml(el)));
      text = applyDecryptText(text);
      if (!text) return null;
      const options = pickOptions(el).map(applyDecryptText);
      return withImgs(el, { question: text, options, type: inferType(el, options) });
    } catch (e) { return null; }
  }

  /* ===== 判断题专用:语义归一 + 选项定位 + 点击校验 =====
     判断题是最容易"看起来答了其实没选中"的题型:
     ① 各版本 radio 的 value 不一致(true/false、对/错、A/B),老代码只认 true/false;
     ② 有些版本根本没有 input(div 式选项,靠 JS 加 class),老代码只点 ul li;
     ③ 点 li 不一定能选中 radio(部分版本把点击绑在 label/input 上),老代码点完不校验;
     ④ AI 的答案还可能是 正确/错误/对/错/√/×/T/F/true/false/选项字母/带句号。
     所以这里把"答案"和"选项"都归一成 true/false,再找目标控件点击并校验结果。 */
  function judgeNormText(s) {
    return String(s || '')
      .replace(/^[A-Ha-h][、.．:：)）\s]+/, '')            // 去掉 "A、" 这类序号前缀
      .replace(/[\s。.，,；;！!？?、:："'“”‘’()（）\[\]【】]/g, '')
      .trim();
  }
  function judgeSideOfText(text) {
    const t = judgeNormText(text);
    if (!t) return null;
    if (/^(不正确|不对|不是|错误|错|否|×|✗|false|f|no|n|0)$/i.test(t)) return false;
    if (/^(正确|对|是|√|✓|true|t|yes|y|1)$/i.test(t)) return true;
    if (/^(不正确|不对|不是)/.test(t)) return false;
    if (/^(正确|对|是)/.test(t)) return true;
    if (/错误|不对|不正确|×|✗|false/i.test(t)) return false;
    if (/正确|√|✓|true/i.test(t)) return true;
    // 字母与对错连写("A对"/"A错",序号后面没有分隔符):剥掉首字母再判一次
    const t2 = t.replace(/^[A-Ha-h][、.．:：)）\s]*/, '');
    if (t2 && t2 !== t && /[\u4e00-\u9fa5]/.test(t2)) return judgeSideOfText(t2);
    return null;
  }
  function judgeSideOfValue(v) {
    const s = String(v == null ? '' : v).trim().toLowerCase().replace(/[\s。.]/g, '');
    if (!s) return null;
    if (s === 'true' || s === 't' || s === '1' || s === '对' || s === '正确' || s === '是' || s === '√' || s === 'yes' || s === 'y') return true;
    if (s === 'false' || s === 'f' || s === '0' || s === '错' || s === '错误' || s === '否' || s === '×' || s === 'no' || s === 'n') return false;
    return null;
  }
  // 把 AI 的答案(含选项字母/选项原文/各种写法)归一成 true=正确 / false=错误 / null=判不出
  function judgeDesiredSide(answerArr, options) {
    const opts = options || [];
    for (const raw of answerArr || []) {
      const a = String(raw == null ? '' : raw).trim();
      if (!a) continue;
      const lm = a.match(/^([A-Ha-h])(?:[、.．:：)）]|$)/);
      if (lm) {
        const i = lm[1].toUpperCase().charCodeAt(0) - 65;
        if (opts[i]) { const s = judgeSideOfText(opts[i]); if (s !== null) return s; }
        // 选项文字读不出(字体加密没解开):判断题只有两项,按位置兜底 A=正确、B=错误
        if (i <= 1 && (opts.length === 0 || opts.length === 2)) return i === 0;
      }
      if (opts.length === 2) {   // 答案就是选项原文(对/错)
        const na = judgeNormText(a);
        for (let i = 0; i < 2; i++) {
          if (na && judgeNormText(opts[i]) === na) { const s = judgeSideOfText(opts[i]); if (s !== null) return s; }
        }
      }
      const s = judgeSideOfText(a);
      if (s !== null) return s;
    }
    return null;
  }
  // 取选项的可读文字:必须走字体解密(学习通测验大量使用 font-cxsecret 字体加密,
  // DOM 里的 textContent 是乱码,直接判"正确/错误"永远判不出——这是判断题失效的隐蔽原因)
  function judgeTextOf(node) {
    const raw = String((node && node.textContent) || '');
    let dec = raw;
    try { if (typeof applyDecryptText === 'function') dec = applyDecryptText(raw); } catch (e) { /* ignore */ }
    return dec || raw;
  }
  function judgeSlotSide(node) {
    try {
      const inp = node.querySelector && node.querySelector('input[type=radio], input[type=checkbox], input');
      if (inp) {
        const s = judgeSideOfValue(inp.value);
        if (s !== null) return s;
        const sv = judgeSideOfText(inp.value);     // value="对"/"错"
        if (sv !== null) return sv;
      }
      const s = judgeSideOfText(judgeTextOf(node));
      if (s !== null) return s;
      const lab = node.querySelector && node.querySelector('label');
      if (lab) return judgeSideOfText(judgeTextOf(lab));
    } catch (e) { /* ignore */ }
    return null;
  }
  // 选项容器:把命中节点向上归并到"可点容器",避免点到内层 span 而站点只监听 li/label
  function judgeBoxOf(n) {
    try { return n.closest('li, .answerBg, .answer_p, .option-item, .option, label, dd') || n; } catch (e) { return n; }
  }
  function judgeGroupInputs(scope) {
    try { return Array.from(scope.querySelectorAll('input[type=radio], input[type=checkbox]')); } catch (e) { return []; }
  }
  // 收集判断题的选项容器。
  // 不再依赖固定类名(各版本类名差异大):凡"文字(解密后)或取值能判出对错"的短文本节点都算,
  // 再向上归并成选项容器、去重、只留最内层,按文档顺序排列。li 式 / div 式 / label 式 / √× / true·false 全命中。
  function judgeSlots(el) {
    const boxes = [];
    const add = (n) => { if (n && boxes.indexOf(n) < 0) boxes.push(n); };
    let all = [];
    try { all = Array.from(el.querySelectorAll('*')); } catch (e) { all = []; }
    for (const n of all) {
      if (n.children && n.children.length > 3) continue;      // 深容器(整块题目)不算选项
      const t = judgeNormText(judgeTextOf(n));
      if (!t || t.length > 8) continue;
      if (!/^(正确|对|是|√|✓|错误|错|否|×|✗|true|false|t|f)$/i.test(t)) continue;
      add(judgeBoxOf(n));
    }
    // 控件取值能判出对错的也算(选项文字是图片/加密没解开时,value 仍可能是 true/false、对/错)
    judgeGroupInputs(el).forEach((inp) => {
      if (judgeSideOfValue(inp.value) !== null || judgeSideOfText(inp.value) !== null) add(judgeBoxOf(inp));
    });
    let uniq = boxes.filter((n, i) => boxes.indexOf(n) === i);
    uniq = uniq.filter((n) => !uniq.some((m) => m !== n && n.contains(m)));
    if (uniq.length) {
      uniq.sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1));
      return uniq.slice(0, 6);
    }
    // 兜底:老式 ul li 结构
    for (const s of ['ul li', '.Zy_ulTop li', 'li.answer_p', '.answerBg', 'dd', 'label']) {
      try { Array.from(el.querySelectorAll(s)).forEach(add); } catch (e) { /* ignore */ }
    }
    return boxes.filter((n) => judgeSlotSide(n) !== null).slice(0, 6);
  }
  // 校验是否真的选中了"想要的那一侧"(按整题的 radio 组判断,而不是只看被点容器内部)
  function judgePickedOk(node, scope, want) {
    const checked = judgeGroupInputs(scope).filter((i) => i.checked);
    if (!checked.length) return false;
    return checked.some((i) => {
      const side = judgeSideOfValue(i.value);
      if (side !== null) return side === want;
      const sv = judgeSideOfText(i.value);
      if (sv !== null) return sv === want;
      // value 是 A/B 这类:看被选中的控件是不是在我们点的那个容器里
      const box = judgeBoxOf(i);
      try { return box === node || box.contains(node) || node.contains(box); } catch (e) { return false; }
    });
  }
  // 点击并校验:input → label → 内部文字 → 容器 → 整题两个 radio 兜底
  // 完整鼠标事件序列:部分版本只监听 pointer 系事件,或要求完整按下-抬起流程才认
  function judgeFire(t) {
    // 必须用"元素自己所属 window"的构造器:脚本常运行在顶层页,而题目在内层 iframe,
    // 跨 realm 派发事件时内联处理器里的 window.event 等会取不到值(踩过)
    const w = (t && t.ownerDocument && t.ownerDocument.defaultView) || window;
    const PE = w.PointerEvent || w.MouseEvent || MouseEvent;
    const ME = w.MouseEvent || MouseEvent;
    const seq = [
      ['pointerdown', PE], ['mousedown', ME],
      ['pointerup', PE], ['mouseup', ME],
      ['click', ME]
    ];
    for (const [ty, Ev] of seq) {
      try { t.dispatchEvent(new Ev(ty, { bubbles: true, cancelable: true, view: w })); } catch (e) { /* ignore */ }
    }
  }
  // 状态快照:div 式选项(无 input)的"选中标记"可能以任意形式(类名/样式/隐藏域)加在本题任意元素上,
  // 用整题 DOM 前后对比来判定点击是否真的生效,而不是只看被点容器自己的 class
  function judgeSnap(scope) {
    try { return (scope.closest('.TiMu') || scope).innerHTML; } catch (e) { try { return scope.innerHTML; } catch (e2) { return ''; } }
  }
  // 点击并校验:input → label/内部子元素逐个试点 → 整题两个 radio 兜底。
  // 每次点击后都校验:radio 组选中了想要的一侧 / 整题 DOM 有变化 / 页面任意处有变化(答题卡"已答 N 题"计数)
  function judgeClick(node, scope, want) {
    // 先滚到可视区:部分版本对不可见选项的点击事件不响应/处理器懒绑定
    try { node.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ }
    // 1) 有 input 的版本:点真控件,radio.checked 可精确校验
    try { Array.from(node.querySelectorAll('input[type=radio], input[type=checkbox]')).forEach((inp) => { if (!inp.checked) inp.click(); }); } catch (e) { /* ignore */ }
    if (judgePickedOk(node, scope, want)) return true;

    // 2) 无 input 的 div 式选项:事件委托的处理器可能绑在任意一层/任意子元素上,
    //    把 label + 常见内层元素 + 容器本身逐个试点,每次点击后用快照对比判断是否生效
    const snap = judgeSnap(scope);
    const elDoc = (node.ownerDocument) || document;
    let bodySnap = null;
    try { bodySnap = elDoc.body ? elDoc.body.innerHTML : null; } catch (e) { /* ignore */ }
    const targets = [node];
    try {
      const lab = node.querySelector('label');
      if (lab) targets.push(lab);
      targets.push(...Array.from(node.querySelectorAll('a, span, i, b, em, p, .num_option, .before, .after')).slice(0, 10));
    } catch (e) { /* ignore */ }
    for (const t of targets) {
      judgeFire(t);
      if (judgePickedOk(node, scope, want)) return true;
      if (judgeSnap(scope) !== snap) return true;                     // 题面内任意状态变化
      if (bodySnap !== null && elDoc.body && elDoc.body.innerHTML !== bodySnap) return true;   // 标记在题面之外(答题卡计数等)
    }
    // 3) 硬兜底:整题只有两个 radio → 按"第一=正确、第二=错误"直接点
    const group = judgeGroupInputs(scope);
    if (group.length === 2 && want !== null) {
      try { group[want ? 0 : 1].click(); } catch (e) { /* ignore */ }
      if (judgePickedOk(node, scope, want) || judgeSnap(scope) !== snap) return true;
    }
    // 4) 直调页面自己的选项处理函数:onclick="addChoice(this)" 把函数名写在属性里。
    //    关键:① 优先调用元素自己的 onclick 函数对象(它天然绑定在元素所属 window 的作用域里,
    //    脚本在顶层运行时也能正确解析到 iframe 内的 addChoice/addMultipleChoice);
    //    ② 其次才去元素所属 window 上找同名全局函数(以前优先 unsafeWindow=顶层 window,跨 iframe 时永远找不到)
    try {
      let callee = node;
      for (let depth = 0; callee && depth < 3 && !(callee.getAttribute && callee.getAttribute('onclick')); depth++) callee = callee.parentElement;
      const inlineFn = callee && callee.onclick;
      if (typeof inlineFn === 'function') {
        try { inlineFn.call(callee); } catch (e) { /* 内联函数内部异常不影响后面的兜底 */ }
        if (judgePickedOk(node, scope, want) || judgeSnap(scope) !== snap) return true;
        if (choiceRecorded(scope) !== false) return true;   // 页面已记录答案(隐藏域/选中标记)
      }
      const pageWin = (node.ownerDocument && node.ownerDocument.defaultView)
        || (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
      const attr = callee && callee.getAttribute && callee.getAttribute('onclick');
      const fm = attr && attr.match(/([A-Za-z_$][\w$]*)\s*\(/);
      if (fm) {
        const fn = pageWin[fm[1]];
        if (typeof fn === 'function') {
          fn.call(callee || node, node);
          if (judgePickedOk(node, scope, want) || judgeSnap(scope) !== snap) return true;
          return true;   // 页面自己的处理器已被调用,选中与否由页面逻辑决定
        }
      }
    } catch (e) { /* ignore */ }
    // 5) 最后手段:页面用 jQuery 绑的事件(含事件委托绑在祖先上的),把处理器直接调起来。
    //    合成事件无法通过 isTrusted 校验,但直接调处理器和真实点击到达处理器是等效的
    try {
      const dv = (node.ownerDocument && node.ownerDocument.defaultView) || window;
      const jq = (dv && dv.jQuery) || window.jQuery;
      if (jq && jq.Event && jq._data) {
        const fakeEv = (type) => { const ev = new jq.Event(type, { bubbles: true, cancelable: true }); ev.target = node; return ev; };
        const runElem = (elem, types) => {
          let fired = false;
          for (const type of types) {
            const evs = (jq._data(elem, 'events') || {})[type];
            if (!evs) continue;
            Array.from(evs).forEach((h) => {
              try { h.handler.call(elem, fakeEv(type)); fired = true; } catch (e) { /* ignore */ }
            });
          }
          return fired;
        };
        let hit = runElem(node, ['click', 'pointerdown', 'mousedown', 'touchstart']);
        const root = (node.ownerDocument && node.ownerDocument.documentElement) || document.documentElement;
        for (let anc = node.parentElement; anc && anc !== root && !hit; anc = anc.parentElement) {
          hit = runElem(anc, ['click', 'pointerdown', 'mousedown']);
        }
        if (hit) {
          if (judgePickedOk(node, scope, want) || judgeSnap(scope) !== snap) return true;
          return true;   // 处理器已被真实调用,选中与否由页面自己的逻辑决定
        }
      }
    } catch (e) { /* ignore */ }
    return false;
  }
  // 失败时输出一行结构摘要,便于按各版本差异继续适配(直接看面板日志即可)
  // 失败时把判断题的真实 DOM 结构回传本地服务(探针记录),便于按真实结构精准适配,不再盲猜。
  // 必须走 cxFetch(GM 特权请求):页面原生 fetch 会被学习通的 CSP 拦截,静默失败(踩过)
  let judgeProbeCount = 0;
  // 失败时把本题真实 DOM 结构回传本地服务(探针记录),便于按真实结构精准适配,不再盲猜。
  // 必须走 cxFetch(GM 特权请求):页面原生 fetch 会被学习通的 CSP 拦截,静默失败(踩过)
  // tag: 'judge'(判断题,默认) / 'choice'(选择题)
  function judgeReportStructure(el, why, tag) {
    if (judgeProbeCount >= 6) return;
    judgeProbeCount++;
    try {
      const host = el.closest('.TiMu') || el.closest('.questionLi') || el;
      const html = String(host.outerHTML || '').slice(0, 5000);
      // 页面状态信息:隐藏域当前值 / 处理函数是否存在 / 是否已提交(选中标记、提示文字)
      const state = {};
      try {
        state.hiddens = Array.from(el.querySelectorAll('input[type=hidden]')).slice(0, 4)
          .map((h) => (h.name || h.id) + '=' + String(h.value || '').slice(0, 8)).join('|');
        const pageWin = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || el.ownerDocument.defaultView || window;
        state.addChoice = typeof (pageWin && pageWin.addChoice);
        const docText = String(el.ownerDocument.body.innerText || '');
        state.submittedHint = (docText.match(/已提交|不能重复|已用过|截止/) || [''])[0];
        state.checkCount = el.querySelectorAll('.check_answer').length;
        // 选项容器的 class 名与 onclick(新版结构常在这里露出绑定方式)
        state.liClasses = Array.from(el.querySelectorAll('ul li, li')).slice(0, 4)
          .map((n) => String(n.className || n.tagName) + (n.getAttribute('onclick') ? '@' + String(n.getAttribute('onclick')).slice(0, 30) : '')).join('|');
        state.jQuery = !!(function () { try { return (el.ownerDocument.defaultView || window).jQuery; } catch (e) { return false; } })();
      } catch (e) { /* ignore */ }
      cxFetch((CONFIG.webAiRelay || 'http://127.0.0.1:8790') + '/api/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ host: location.hostname, path: location.pathname, reason: (tag || 'judge') + '-' + why, html, state, href: location.href }),
        timeout: 6000
      }).catch(() => { /* ignore */ });
    } catch (e) { /* ignore */ }
  }
  function judgeDiag(el) {
    try {
      const radios = judgeGroupInputs(el);
      const vals = radios.map((r) => String(r.value) + (r.checked ? '✓' : '')).join(',');
      const texts = Array.from(el.querySelectorAll('li, .answerBg, .answer_p, label, dd'))
        .map((n) => judgeNormText(judgeTextOf(n)).slice(0, 6))
        .filter((t, i, a) => t && a.indexOf(t) === i).slice(0, 4).join('|');
      // 选项容器的 class 名(脱敏截断):再失配时能直接看出该版本的真实结构
      const boxes = Array.from(el.querySelectorAll('li, .answerBg, .answer_p, .option-item, label, dd'))
        .slice(0, 2)
        .map((n) => String(n.className || n.tagName).replace(/\s+/g, '.').slice(0, 26))
        .join('|');
      return ` 【诊断】radio=${radios.length}(${vals || '-'}) 选项=${texts || '无'} 容器=${boxes || '无'}`;
    } catch (e) { return ''; }
  }
  // 读取选项的答案值:新版作业页选项 li 带点击写隐藏域,答案值在 .num_option 的 data 属性里
  function choiceDataOf(li) {
    try {
      const sp = li.querySelector('.num_option');
      return sp ? String(sp.getAttribute('data') || sp.textContent || '').trim() : '';
    } catch (e) { return ''; }
  }
  // 页面是否已记录本题答案:answer<qid> 隐藏域有值,或出现选中标记
  function choiceRecorded(el) {
    try {
      if (el.querySelectorAll('.check_answer').length) return true;
      const hids = Array.from(el.querySelectorAll('input[type=hidden]')).filter((h) => /^answer\d+$/.test(h.id || h.name || ''));
      return hids.length ? hids.some((h) => String(h.value || '').length > 0) : null;
    } catch (e) { return null; }
  }
  // 兜底:直接把答案写进 answer<qid> 隐藏域——addChoice 的本质就是写它,提交时页面读的也是它
  function choiceWriteHidden(el, li) {
    try {
      const target = li.closest('li[qid]') || li;
      const qid = target.getAttribute('qid');
      if (!qid) return false;
      const data = choiceDataOf(target);
      const hid = el.ownerDocument.getElementById('answer' + qid) || el.querySelector('#answer' + qid);
      if (!hid || !data || String(hid.value || '')) return false;
      hid.value = data;
      try { target.classList.add('check_answer'); } catch (e) { /* ignore */ }
      return true;
    } catch (e) { return false; }
  }
  /* ===== 选择题(单选/多选)专用:选项容器定位 + 单次点击 + 逐项校验 =====
     多选最容易坏在"一次点击触发两次处理器"上:input.click() 再把 click 冒泡到 li,
     li 上的 addChoice 被调用两次,而多选的 addChoice 是 toggle —— 选上又被取消,看起来就是"多选选不了"。
     所以这里① 每个选项只点一次(点完用整题快照/隐藏域校验是否生效);② 以 answer<qid> 隐藏域为准纠偏。 */
  // 取一组与选项对齐的可点容器:各版本结构差异大(ul li / dd / .answerBg / div 式)
  function choiceBoxes(el) {
    const sels = ['ul li', '.Zy_ulTop li', '.answer_p li', 'li.answer_p', '.answerBg', '.option-item', 'dd'];
    for (const s of sels) {
      let arr = [];
      try { arr = Array.from(el.querySelectorAll(s)); } catch (e) { arr = []; }
      arr = arr.filter((n) => !arr.some((m) => m !== n && n.contains(m)));   // 只留最内层,避免同一选项算两次
      arr = arr.filter((n) => String(n.textContent || '').trim().length > 0);
      if (arr.length >= 2) return arr;
    }
    return [];
  }
  // 答案隐藏域 answer<qid>(学习通提交时读的就是它)
  function choiceHiddenOf(el, li) {
    try {
      const t = (li.closest && li.closest('li[qid]')) || li;
      const qid = t.getAttribute && t.getAttribute('qid');
      if (!qid) return null;
      return el.ownerDocument.getElementById('answer' + qid) || el.querySelector('#answer' + qid);
    } catch (e) { return null; }
  }
  // 该选项当前是否已选中:优先看答案隐藏域(提交时页面读的就是它,重做场景也不会被残留 class 骗),
  // 没有隐藏域的版本再看真控件 checked / 选中标记 class
  function choicePicked(el, li) {
    try {
      const hid = choiceHiddenOf(el, li);
      const data = choiceDataOf(li);
      if (hid && data) return String(hid.value || '').includes(data);
    } catch (e) { /* ignore */ }
    try {
      const inp = li.querySelector('input[type=radio], input[type=checkbox]');
      if (inp && inp.checked) return true;
    } catch (e) { /* ignore */ }
    try {
      if (li.classList.contains('check_answer') || li.querySelector('.check_answer')) return true;
    } catch (e) { /* ignore */ }
    return false;
  }
  // 选项点击前/后的状态指纹:真控件勾选 + 本题隐藏域取值 + 选中标记数量。
  // 只看 innerHTML 不够——页面写 answer<qid>.value 不会改变 innerHTML,会被误判"没生效"而重复点击(多选被 toggle 抵消)
  function choiceSig(el, li) {
    let s = '';
    try {
      const inp = li.querySelector('input[type=radio], input[type=checkbox]');
      s += inp && inp.checked ? '1' : '0';
    } catch (e) { /* ignore */ }
    try {
      const hs = Array.from(el.querySelectorAll('input[type=hidden]'));
      s += '|' + hs.map((h) => String(h.value || '')).join(',');
    } catch (e) { /* ignore */ }
    try { s += '|' + el.querySelectorAll('.check_answer').length; } catch (e) { /* ignore */ }
    return s;
  }
  // 只点一次。入口按"页面真实绑定位置"择优:li 自带 onclick(addChoice) → 点 li;
  // 否则 label / 内层 a·span·.num_option → 容器 → 真控件。
  // 点完用"隐藏域 + 题内 DOM + 整页 DOM"三层指纹校验是否生效;事件路径全失败时
  // 直调页面自己的处理函数(内联 onclick / jQuery 绑定),绕过合成事件 isTrusted 校验。
  function choiceClickOnce(el, li) {
    const before = judgeSnap(el);
    const beforeSig = choiceSig(el, li);
    const elDoc = (li.ownerDocument) || document;
    let bodyBefore = null;
    try { bodyBefore = elDoc.body ? String(elDoc.body.innerHTML) : null; } catch (e) { bodyBefore = null; }
    const changed = () => {
      try { if (choiceSig(el, li) !== beforeSig) return true; } catch (e) { /* ignore */ }
      try { if (judgeSnap(el) !== before) return true; } catch (e) { /* ignore */ }
      try { if (bodyBefore !== null && elDoc.body && String(elDoc.body.innerHTML) !== bodyBefore) return true; } catch (e) { /* ignore */ }
      return false;
    };
    const attr = (n) => { try { return (n.getAttribute && n.getAttribute('onclick')) || ''; } catch (e) { return ''; } };
    const fire = (t) => {
      try { t.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ }
      try { judgeFire(t); } catch (e) { try { t.click(); } catch (e2) { /* ignore */ } }
    };
    const tries = [];
    if (attr(li)) tries.push(li);
    for (const s of ['label', 'a', '.num_option', '.after', 'span', 'i']) {
      try { const t = li.querySelector(s); if (t) tries.push(t); } catch (e) { /* ignore */ }
    }
    if (!attr(li)) tries.push(li);
    try { const inp = li.querySelector('input[type=radio], input[type=checkbox]'); if (inp) tries.push(inp); } catch (e) { /* ignore */ }
    for (const t of tries) {
      fire(t);
      if (changed()) return true;
      if (choicePicked(el, li)) return true;
    }
    // 兜底1:直接调用元素自己的 onclick 函数对象(onclick="addMultipleChoice(this)")。
    // 它天然绑定在元素所属 window 的作用域里,脚本跑在顶层时也能解析到 iframe 内的函数
    // —— 这是"跨 iframe 取不到页面全局函数"的正解
    try {
      let callee = li;
      for (let d = 0; callee && d < 3 && !(callee.getAttribute && callee.getAttribute('onclick')); d++) callee = callee.parentElement;
      const inlineFn = callee && callee.onclick;
      if (typeof inlineFn === 'function') {
        try { inlineFn.call(callee); } catch (e) { /* 内联函数内部异常不影响后面的兜底 */ }
        if (changed() || choicePicked(el, li)) return true;
      }
      // 兜底2:元素所属 window 上的同名全局函数(注意不是 unsafeWindow=顶层 window)
      const pageWin = (li.ownerDocument && li.ownerDocument.defaultView)
        || (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
      const a2 = callee && callee.getAttribute && callee.getAttribute('onclick');
      const fm = a2 && a2.match(/([A-Za-z_$][\w$]*)\s*\(/);
      if (fm) {
        const fn = pageWin[fm[1]];
        if (typeof fn === 'function') {
          fn.call(callee || li, li);
          if (changed() || choicePicked(el, li)) return true;
          return true;   // 处理器已被调用,选中与否由页面逻辑决定
        }
      }
    } catch (e) { /* ignore */ }
    // 兜底3:页面用 jQuery 绑定(含委托绑在祖先)——把处理器直接调起来,绕过 isTrusted 检查
    try {
      const dv = li.ownerDocument && li.ownerDocument.defaultView;
      const jq = (dv && dv.jQuery) || window.jQuery || (typeof unsafeWindow !== 'undefined' && unsafeWindow && unsafeWindow.jQuery);
      if (jq && jq.Event && jq._data) {
        const fakeEv = (type) => { const ev = new jq.Event(type, { bubbles: true, cancelable: true }); ev.target = li; return ev; };
        const runElem = (elem, types) => {
          let fired = false;
          for (const type of types) {
            const evs = (jq._data(elem, 'events') || {})[type];
            if (!evs) continue;
            Array.from(evs).forEach((h) => { try { h.handler.call(elem, fakeEv(type)); fired = true; } catch (e) { /* ignore */ } });
          }
          return fired;
        };
        let hit = runElem(li, ['click', 'pointerdown', 'mousedown', 'touchstart']);
        const root = (li.ownerDocument && li.ownerDocument.documentElement) || document.documentElement;
        for (let anc = li.parentElement; anc && anc !== root && !hit; anc = anc.parentElement) {
          hit = runElem(anc, ['click', 'pointerdown', 'mousedown']);
        }
        if (hit) return true;   // 处理器已被真实调用
      }
    } catch (e) { /* ignore */ }
    return false;
  }
  // 以隐藏域为准纠偏:多选必须包含全部目标项(点击可能只记最后一个),单选必须等于目标项
  function choiceSyncHidden(el, lis, idx, isMulti) {
    try {
      const datas = idx.map((i) => (lis[i] ? choiceDataOf(lis[i]) : '')).filter(Boolean);
      if (!datas.length) return false;
      const hid = choiceHiddenOf(el, lis[idx[0]]);
      if (!hid) return false;
      const need = isMulti ? datas.join('') : datas[0];
      const cur = String(hid.value || '');
      if (cur === need) return false;
      if (isMulti && idx.every((i, k) => cur.includes(datas[k]))) return false;
      hid.value = need;
      // 同步选中标记,避免"答案已写但页面看着没选"
      try {
        lis.forEach((li, i) => {
          if (idx.includes(i)) li.classList.add('check_answer');
          else if (!isMulti) li.classList.remove('check_answer');
        });
      } catch (e) { /* ignore */ }
      return true;
    } catch (e) { return false; }
  }
  // 目标选项是否已被页面标记为选中:aria-checked/aria-pressed、check_answer 标记、真控件勾选。
  // 新版学习通无 input,选中态就写在 li 的 aria-* 和 span.check_answer 上,靠这些判定最直接
  function judgeTargetMarked(target) {
    try {
      const cands = [target];
      try { cands.push(...Array.from(target.querySelectorAll('*')).slice(0, 8)); } catch (e) { /* ignore */ }
      for (const n of cands) {
        const ac = n.getAttribute && (n.getAttribute('aria-checked') || n.getAttribute('aria-pressed'));
        if (ac === 'true') return true;
        if (n.classList && n.classList.contains('check_answer')) return true;
        const inp = n.querySelector && n.querySelector('input[type=radio], input[type=checkbox]');
        if (inp && inp.checked) return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }
  function fillJudgeAnswer(answerArr, q, el) {
    let want = judgeDesiredSide(answerArr, q.options || []);
    if (CONFIG.deliberateErrorRate > 0 && Math.random() < CONFIG.deliberateErrorRate) {
      if (want !== null) { want = !want; log('🎭 拟人模式:本题故意答错(配置概率)', 'info'); }
    }
    clearCurrent(el);
    if (want === null) {
      log(`⚠ 判断题:答案「${(answerArr || []).join('/') || '空'}」无法识别对错` + judgeDiag(el), 'warn');
      return false;
    }
    const slots = judgeSlots(el);
    let target = null;
    for (const s of slots) if (judgeSlotSide(s) === want) { target = s; break; }
    // 选项文字判不出(图片/加密未解开):按学习通固定顺序兜底 —— 第一个=正确、第二个=错误
    if (!target && slots.length === 2) target = slots[want ? 0 : 1];
    // 连选项容器都没识别到:整题只有两个 radio 时直接按顺序取
    if (!target) {
      const group = judgeGroupInputs(el);
      if (group.length === 2) target = judgeBoxOf(group[want ? 0 : 1]);
    }
    // 完全没有 input、选项文字也读不出(div 式 + 乱码):按通用选项容器顺序兜底
    if (!target) {
      const gen = Array.from(el.querySelectorAll('.answerBg, .answer_p, .option-item, .option, li, dd'))
        .filter((n, i, a) => a.indexOf(n) === i)
        .filter((n) => { const t = judgeNormText(judgeTextOf(n)); return t.length > 0 && t.length <= 30; });
      const leaves = gen.filter((n) => !gen.some((m) => m !== n && n.contains(m)));
      if (leaves.length === 2) target = leaves[want ? 0 : 1];
    }
    if (!target) {
      log('⚠ 判断题:没找到可点的选项' + judgeDiag(el), 'warn');
      judgeReportStructure(el, 'no-target');
      return false;
    }
    const ok = judgeClick(target, el, want);
    const rec = choiceRecorded(el);
    if (ok && rec !== false) return true;
    // 页面已经把目标选项标记成选中了(aria-checked / check_answer / 真控件):
    // 即使点击路径没捕捉到变化(跨 iframe 检测不到整页变化等),也应算成功,否则会白丢正确答案
    if (judgeTargetMarked(target)) {
      if (!ok) log('✓ 判断题:点击已生效(按页面选中标记确认)', 'info');
      return true;
    }
    if (ok && rec === false) log('⚠ 判断题:点击执行了但页面未记录答案,尝试直接写入', 'warn');
    // 终极兜底:直接写 answer<qid> 隐藏域(与 addChoice 等效,提交时页面读的就是它)
    if (choiceWriteHidden(el, target)) {
      log(`⚠ 判断题:点击未被页面记录,已直接写入答案隐藏域`, 'warn');
      return true;
    }
    log('⚠ 判断题:点击后未生效' + judgeDiag(el), 'warn');
    judgeReportStructure(el, 'no-effect');
    return false;
  }

  function setQuizAnswer(answerArr, q, el, win) {
    const $$ = (sel) => Array.from(el.querySelectorAll(sel));
    // 题型可能被判错(隐藏域版本差异):选项本身就只有"正确/错误"时,按判断题处理最可靠
    let qType = String(q.type);
    if (qType !== '3') {
      const opts = q.options || [];
      const s0 = opts.length === 2 ? judgeSideOfText(opts[0]) : null;
      const s1 = opts.length === 2 ? judgeSideOfText(opts[1]) : null;
      if (s0 !== null && s1 !== null && s0 !== s1) qType = '3';
    }
    switch (qType) {
      case '0':
      case '1': {
        let idx = matchAnswer(answerArr, q.options);
        if (!idx.length) return false;
        // 拟人:单选题按配置概率故意点错(多选不故意错)
        if (String(q.type) === '0' && CONFIG.deliberateErrorRate > 0 && Math.random() < CONFIG.deliberateErrorRate && q.options && q.options.length > 1) {
          const wrongIdx = [];
          for (let i = 0; i < q.options.length; i++) if (!idx.includes(i)) wrongIdx.push(i);
          if (wrongIdx.length) {
            idx = [wrongIdx[Math.floor(Math.random() * wrongIdx.length)]];
            log('🎭 拟人模式:本题故意答错(配置概率)', 'info');
          }
        }
        clearCurrent(el);
        const lis = choiceBoxes(el);
        if (lis.length) {
          // 题型是单选但答案匹配到多个选项(题型判错/AI 给了组合答案):按多选处理,避免只选第一个
          const isMulti = qType === '1' || idx.length > 1;
          const want = idx.filter((i) => i < lis.length).sort((a, b) => a - b);
          if (!want.length) return false;
          let confirmed = 0;   // 确认选中(检测到勾选/选中标记/隐藏域)
          let acted = 0;       // 页面对点击有反应(可能已选中,只是选中标记的 class 名不标准)
          for (const i of want) {
            const li = lis[i];
            if (!li) continue;
            if (choicePicked(el, li)) { confirmed++; acted++; continue; }   // 已选中不要再点(多选 toggle 会取消)
            let ok = choiceClickOnce(el, li);
            if (!ok && !choicePicked(el, li)) ok = choiceClickOnce(el, li);   // 完全无反应才补一次,防止 toggle 抵消
            if (ok) acted++;
            if (choicePicked(el, li)) confirmed++;
          }
          // 兜底:点击没被页面记录(addChoice 没触发/合成事件被忽略)→ 直接写隐藏域,提交时页面读的就是它
          const wrote = choiceSyncHidden(el, lis, want, isMulti);
          if (wrote) log(`⚠ 选择题:选项点击未被页面记录,已直接写入答案隐藏域(${isMulti ? '多选' : '单选'})`, 'warn');
          const okChoice = wrote || confirmed > 0 || acted === want.length;
          if (!okChoice) {
            log(`⚠ 选择题:${want.length} 个选项点击均未生效,也没有答案隐藏域可写` + judgeDiag(el), 'warn');
            judgeReportStructure(el, 'no-effect', 'choice');   // 回传真实结构,便于按版本精准适配
          } else if (confirmed < want.length) {
            log(`⚠ 选择题:${want.length - confirmed}/${want.length} 个选项未确认选中(页面的选中标记不标准),如提交后发现没选上请反馈`, 'warn');
          }
          return okChoice;
        }
        // 兜底1:直接点第 idx 个选项控件
        const inputs = $$('input[type=radio], input[type=checkbox]');
        if (inputs.length) {
          idx.forEach((i) => { const inp = inputs[i]; if (inp && !inp.checked) { try { inp.click(); } catch (e) { /* ignore */ } } });
          return true;
        }
        // 兜底2:点第 idx 个常见选项容器(按元素在题内的顺序对齐选项)
        const optEls = $$('.answerBg, .after, .ans-opt');
        if (optEls.length) {
          const leaves = optEls.filter((n) => !optEls.some((m) => m !== n && n.contains(m)));
          idx.forEach((i) => { const o = leaves[i]; if (o) { try { o.click(); } catch (e) { /* ignore */ } } });
          return true;
        }
        return false;
      }
      case '3': {
        // 判断题统一走 fillJudgeAnswer:语义归一 + 控件定位 + 点击校验(见上方注释)
        return fillJudgeAnswer(answerArr, q, el);
      }
      case '2':
      case '4':
      case '5':
      case '6':
      case '7':
      case '9': {
        return fillTextAnswer(el, answerArr, win);
      }
      default:
        return false;
    }
  }

  // ===== 文本类(填空/简答)填写:兼容 UEditor 等富文本编辑器(正文在 iframe 里) =====
  // 关键:UEditor 的正文是 iframe 内的 contenteditable body,顶层只有隐藏 textarea,
  // 直接给顶层 textarea 赋值用户看不到任何东西。这里必须逐层找、写完回读校验。
  function textValueOf(node) {
    try {
      if (!node) return '';
      if (typeof node.value === 'string' && node.value) return node.value;
      return (node.innerText || node.textContent || '').replace(/\s+/g, '');
    } catch (e) { return ''; }
  }
  function isRichHost(node, frame) {
    try {
      if (node && node.isContentEditable) return true;
      const tag = frame ? (frame.className || '') + ' ' + (frame.id || '') : '';
      return /edui|ueditor|cke|ql-editor|w-e-text/i.test(tag);
    } catch (e) { return false; }
  }
  function collectTextTargets(el) {
    const rich = [];   // 富文本(iframe body / contenteditable)
    const plain = [];  // textarea / 单行 input
    const seen = new Set();
    const pushRich = (doc, node) => {
      if (!node || seen.has(node)) return;
      seen.add(node);
      rich.push({ kind: 'rich', doc, node });
    };
    const scanFrames = (root) => Array.from(root.querySelectorAll('iframe')).forEach((f) => {
      try {
        const doc = f.contentDocument;
        if (!doc || !doc.body) return;
        if (isRichHost(doc.body, f)) pushRich(doc, doc.body);
      } catch (e) { /* 跨域跳过 */ }
    });
    scanFrames(el);
    Array.from(el.querySelectorAll('[contenteditable="true"], [contenteditable=""]')).forEach((n) => pushRich(n.ownerDocument, n));
    // 有的页面把编辑器渲染在题目容器之外 → 扩大到整页再找一次
    if (!rich.length) {
      scanFrames(document);
      Array.from(document.querySelectorAll('[contenteditable="true"], .edui-body, .ql-editor, .w-e-text, .cke_editable')).forEach((n) => pushRich(n.ownerDocument, n));
    }
    const pushPlain = (n) => plain.push({
      kind: (n.tagName || '').toLowerCase() === 'textarea' ? 'textarea' : 'input',
      doc: n.ownerDocument,
      node: n,
      hidden: n.offsetParent === null
    });
    Array.from(el.querySelectorAll('textarea')).forEach(pushPlain);
    Array.from(el.querySelectorAll('input[type=text], input:not([type])')).forEach(pushPlain);
    if (!plain.length) {
      Array.from(document.querySelectorAll('textarea')).forEach(pushPlain);
      Array.from(document.querySelectorAll('.questionLi input[type=text], .TiMu input[type=text]')).forEach(pushPlain);
    }
    return { rich, plain };
  }
  function writeRich(t, text) {
    const { doc, node } = t;
    try { if (node.focus) node.focus(); } catch (e) { /* ignore */ }
    try {
      if (doc && doc.execCommand) {
        const sel = doc.getSelection ? doc.getSelection() : doc.defaultView.getSelection();
        const range = doc.createRange();
        range.selectNodeContents(node);
        sel.removeAllRanges();
        sel.addRange(range);
        doc.execCommand('delete', false, null);
        doc.execCommand('insertText', false, text);
      }
    } catch (e) { /* ignore */ }
    if (textValueOf(node).length < Math.min(6, text.length)) {
      try { node.textContent = text; } catch (e) { /* ignore */ }
    }
    try {
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
      node.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    } catch (e) { /* ignore */ }
  }
  function stripTags(s) { return String(s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ''); }
  // UEditor 官方 API:能同步编辑器内部状态(提交时才带得走)
  function tryUE(win, text, need) {
    try {
      const UE = win && win.UE;
      if (!UE || !UE.instants) return false;
      return Object.keys(UE.instants).some((k) => {
        const ed = UE.instants[k];
        if (!ed || typeof ed.setContent !== 'function') return false;
        if (typeof ed.getContent === 'function') {
          const cur = stripTags(ed.getContent());
          if (cur.length >= need(text) && cur.indexOf(text.slice(0, 6)) >= 0) return true;  // 已经写好了
        }
        ed.setContent(text);
        return typeof ed.getContent === 'function' && stripTags(ed.getContent()).length >= need(text);
      });
    } catch (e) { return false; }
  }
  function setPlain(t, val) {
    try {
      t.node.value = val;
      t.node.dispatchEvent(new Event('input', { bubbles: true }));
      t.node.dispatchEvent(new Event('change', { bubbles: true }));
      t.node.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    } catch (e) { /* ignore */ }
    return textValueOf(t.node).length >= Math.min(6, val.length);
  }
  function fillTextAnswer(el, answerArr, win) {
    const texts = (answerArr || []).map((a) => cl(clean(String(a == null ? '' : a)).replace(/^第.空[:：]?/, ''))).filter(Boolean);
    if (!texts.length) return false;
    const need = (t) => Math.min(6, t.length);

    // ① UEditor 官方 API 最优先(能同步编辑器内部状态,提交时带得走)
    if (tryUE(win, texts[0], need)) return true;

    const { rich, plain } = collectTextTargets(el);

    // ② 富文本容器注入(iframe body / contenteditable)
    for (const t of rich) {
      writeRich(t, texts[0]);
      if (textValueOf(t.node).length >= need(texts[0])) return true;
    }

    // ③ 可见文本框:多空填空逐框填,单框填整段
    const vis = plain.filter((t) => !t.hidden);
    if (vis.length > 1 && texts.length > 1) {
      let filled = 0;
      vis.forEach((t, i) => { if (setPlain(t, texts[i] != null ? texts[i] : texts[0])) filled++; });
      if (filled) return true;
    }
    for (const t of vis) {
      if (setPlain(t, texts[0])) return true;
    }

    // ④ 隐藏 textarea 兜底:只写值不算成功,必须 UE API 能回读确认
    for (const t of plain.filter((x) => x.hidden)) {
      setPlain(t, texts[0]);
      try {
        const name = t.node.getAttribute && t.node.getAttribute('name');
        if (name && win && win.UE && typeof win.UE.getEditor === 'function') {
          const ed = win.UE.getEditor(name);
          if (ed && typeof ed.setContent === 'function') {
            ed.setContent(texts[0]);
            if (stripTags(ed.getContent && ed.getContent()).length >= need(texts[0])) return true;
          }
        }
      } catch (e) { /* ignore */ }
    }
    return false;
  }

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = el.ownerDocument.defaultView.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function clickButtonByText(win, texts) {
    const nodes = win.document.querySelectorAll('button, .btn, a, .el-button, .jb_btn, input[type=button], input[type=submit]');
    for (const n of nodes) {
      const t = (n.textContent || n.value || '').trim();
      for (const kw of texts) {
        if (t && (t === kw || t.includes(kw))) {
          try { n.click(); } catch (e) { /* ignore */ }
          return true;
        }
      }
    }
    return false;
  }
  /* ==================== 题目容器统一识别(弹题/章节测验/学习检测通用) ==================== */
  // 题目容器:老版 .TiMu、新版 .questionLi、以及若干变体
  const QUIZ_ITEM_SEL = '.TiMu, .questionLi, .question-item, .q_item, .mark_item';
  // 测验类 iframe 的 src 特征:新版很多直接嵌 /mooc2/work/dowork,不再套 ananas/modules/work
  const WORK_SRC_RE = /(\/ananas\/modules\/work\/|\/work\/doHomeWorkNew|\/mooc2?\/work\/dowork|\/mooc-ans\/work\/|\/dowork\b)/;
  const isWorkSrc = (src) => WORK_SRC_RE.test(String(src || ''));
  // 音视频 frame 不参与"整页搜题目",避免把弹题抢走
  const AV_SRC_RE = /\/ananas\/modules\/(video|audio)\//;

  // 在 win 及其同源子 iframe 里递归找题目容器(最多 3 层),返回 { win, els }
  function findQuizTree(win, depth = 0, skipAv = true, seen = null) {
    if (!win || depth > 3) return null;
    seen = seen || [];
    if (seen.indexOf(win) >= 0) return null;
    seen.push(win);
    let els = [];
    try { els = Array.from(win.document.querySelectorAll(QUIZ_ITEM_SEL)); } catch (e) { return null; }
    if (els.length) return { win, els };
    let frames = [];
    try { frames = Array.from(win.document.querySelectorAll('iframe')); } catch (e) { return null; }
    for (const f of frames) {
      if (skipAv && AV_SRC_RE.test(String(f.src || ''))) continue;
      let w = null;
      try { w = f.contentWindow; } catch (e) { continue; }
      const r = findQuizTree(w, depth + 1, skipAv, seen);
      if (r) return r;
    }
    return null;
  }

  // 诊断:列出 win 内所有 iframe 的 src,结构改版时据此修选择器
  function dumpFrames(win, tag) {
    try {
      const frames = Array.from(win.document.querySelectorAll('iframe'));
      const srcs = frames.map((f) => String(f.src || f.getAttribute('data') || '(空)').slice(0, 110));
      log(`🔍 侦察(${tag}):${frames.length} 个 iframe → ${JSON.stringify(srcs)}`, 'info');
    } catch (e) { log('🔍 侦察失败(' + tag + '): ' + (e.message || e), 'warn'); }
  }

  /* ==================== 视频弹题处理 ==================== */
  const QUIZ_SELECTORS = ['.TiMu', '.topic-item', '.ans-videoquiz', '.ans-topic', '#subtitle .TiMu', '.el-dialog .TiMu', '.popContent .TiMu', '.maskDiv .TiMu'];

  // 启发式:找"题干特征 + 2~8 个选项控件"的可见容器
  function heuristicFindQuiz(win) {
    let best = null;
    let bestLen = Infinity;
    let nodes;
    try { nodes = win.document.querySelectorAll('div, section, form, fieldset, ul'); } catch (e) { return null; }
    for (const el of nodes) {
      if (!isVisible(el)) continue;
      const t = String(el.textContent || '').trim();
      if (t.length < 8 || t.length > 900) continue;
      const nInputs = el.querySelectorAll('input[type=radio], input[type=checkbox]').length;
      const nLis = el.querySelectorAll('li').length;
      const optCount = nInputs || nLis;
      if (optCount < 2 || optCount > 8) continue;
      if (!/[?？]|（\s*）|\(\s*\)|__+/.test(t)) continue;
      if (t.length < bestLen) { bestLen = t.length; best = el; }
    }
    return best;
  }

  // 启发式提取:判断题(对/错双选项)与单选
  function extractHeuristicQuestion(el) {
    try {
      const optNodes = Array.from(el.querySelectorAll('li'));
      const opts = optNodes.map((li) => clean(li.textContent))
        .filter((t) => t && t.length < 80 && !/(提交|继续学习|回看|确定|下一题|上一题|提交中)/.test(t));
      let type = '0';
      // 判断题:两个选项,去掉"A、"这类前缀后是 对/错
      const norm = (t) => String(t).replace(/^[A-Ha-h][、.．:)\s]+/, '').trim();
      if (opts.length === 2 && /^(正确|对|√|错误|错|×)$/.test(norm(opts[0])) && /^(正确|对|√|错误|错|×)$/.test(norm(opts[1]))) type = '3';
      let text = String(el.textContent || '');
      for (const o of opts) text = text.split(o).join('');
      text = cl(clean(text)).replace(/[（(]\s*[)）]\s*$/, '').slice(0, 300);
      if (!text) return null;
      return withImgs(el, { question: text, options: opts, type });
    } catch (e) { return null; }
  }

  // 启发式作答:判断题按语义点击,选择题按索引点击
  function setHeuristicAnswer(answerArr, q, el) {
    try {
      if (String(q.type) === '3') {
        // 走统一实现:语义归一 + 控件定位 + 点击校验(覆盖 value=对/错、div 式选项等版本差异)
        return fillJudgeAnswer(answerArr, q, el);
      }
      let idx = matchAnswer(answerArr, q.options || []);
      if (!idx.length) return false;
      // 拟人:单选按配置概率故意点一个错误选项
      if (CONFIG.deliberateErrorRate > 0 && Math.random() < CONFIG.deliberateErrorRate && (q.options || []).length > 1) {
        const wrongIdx = [];
        for (let i = 0; i < q.options.length; i++) if (!idx.includes(i)) wrongIdx.push(i);
        if (wrongIdx.length) {
          idx = [wrongIdx[Math.floor(Math.random() * wrongIdx.length)]];
          log('🎭 拟人模式:本题故意答错(配置概率)', 'info');
        }
      }
      const boxes = choiceBoxes(el);
      const lis = boxes.length ? boxes : Array.from(el.querySelectorAll('li'));
      if (!lis.length) return false;
      lis.forEach((li, i) => {
        if (!idx.includes(i)) return;
        if (choicePicked(el, li)) return;      // 已选中不再点:多选的处理器是 toggle,点两次会被取消
        choiceClickOnce(el, li);
      });
      // 点击没被页面记录时以隐藏域为准补齐(多选必须包含全部目标项)
      const want = idx.filter((i) => i < lis.length).sort((a, b) => a - b);
      if (want.length) choiceSyncHidden(el, lis, want, want.length > 1);
      return true;
    } catch (e) { return false; }
  }

  // 弹题"已处理"标记有效期:60 秒后过期,支持"答错→回看→重弹"场景的重新作答
  function wasHandledRecently(el) {
    return !!el.__cxHandledAt && (Date.now() - el.__cxHandledAt < 60000);
  }

  async function tryPopupQuiz(wins, player) {
    for (const win of wins) {
      if (!win || !win.document) continue;
      let container = null;
      for (const sel of QUIZ_SELECTORS) {
        let els;
        try { els = win.document.querySelectorAll(sel); } catch (e) { continue; }
        for (const el of els) {
          if (wasHandledRecently(el)) continue;
          if (isVisible(el)) { container = el; break; }
        }
        if (container) break;
      }
      if (!container) container = heuristicFindQuiz(win);
      if (!container || wasHandledRecently(container)) continue;
      container.__cxHandledAt = Date.now();
      let q = extractQuizQuestion(container);
      const fromHeuristic = !q || !q.question;
      if (fromHeuristic) q = extractHeuristicQuestion(container);
      if (!q || !q.question) {
        log('⚠ 发现疑似弹题但无法解析题目,已记录 DOM', 'warn');
        log('DOM: ' + String(container.outerHTML).slice(0, 1500), 'info');
        continue;
      }
      if (!container.__cxDomLogged) {
        container.__cxDomLogged = true;
        log('DOM侦察: ' + String(container.outerHTML).slice(0, 1500), 'info');
      }
      log(`❓ 检测到视频弹题${fromHeuristic ? '(启发式)' : ''}: ${q.question.slice(0, 40)}...`, 'warn');
      await sleep(0.2); // 极速:不等待
      const answers = await getAnswers(q);
      const ok = setHeuristicAnswer(answers, q, container);
      recordQuestion(q, answers);  // 收集弹题进题库
      log(ok ? '弹题已作答,继续播放' : '弹题未能作答,尝试直接继续', ok ? 'ok' : 'warn');
      await sleep(0.3); // 极速:答完立即继续
      // 精确优先:先点"继续学习"(视频弹题专用),再兜底其他常见按钮
      if (!clickButtonByText(win, ['继续学习'])) {
        clickButtonByText(win, ['确定', '提交', '下一题', '关闭', '继续', '我知道了']);
      }
      try { if (player) player.play(); } catch (e) { /* ignore */ }
      return true;
    }
    return false;
  }
  /* ==================== 任务点处理 ==================== */
  async function videoTask(iframe, outerWin) {
    await waitIframeLoaded(iframe, 60000, runAborted);
    const win = iframe.contentWindow;
    const startHref = (function () { try { return win.location.href; } catch (e) { return ''; } })();
    await waitElementLoaded(win, '#video_html5_api', 90000, () => runAborted() || !iframe.isConnected);
    let player = null;
    try { player = win.videojs('video_html5_api'); } catch (e) { /* ignore */ }
    if (!player) { log('无法获取播放器对象,跳过', 'err'); return; }
    try { player.muted(true); } catch (e) { /* ignore */ }
    try { player.playbackRate(CONFIG.speed); } catch (e) { /* ignore */ }
    try { player.play(); } catch (e) { /* ignore */ }
    log(`▶ 开始播放视频(静音, ${CONFIG.speed}x 原速)`, 'ok');
    await new Promise((resolve) => {
      let finished = false;
      let timer = null;
      let quizBusy = false;
      // 卡死看门狗:进度 3 分钟不动、或 iframe 已被切走(播放器对象失效)就收手,
      // 否则老轮次会一直空转,新页面永远等不到它结束
      let lastCur = -1;
      let lastProgressAt = Date.now();
      const frameAlive = () => {
        try { return iframe.isConnected && (!startHref || win.location.href === startHref); } catch (e) { return false; }
      };
      const finish = () => {
        if (finished) return;
        finished = true;
        clearInterval(timer);
        resolve();
      };
      timer = setInterval(async () => {
        if (quizBusy) return;
        quizBusy = true;
        try {
          if (runAborted()) {
            try { player.pause(); } catch (e) { /* ignore */ }
            log(PAUSED ? '⏸ 已暂停,视频停在此处(点 ▶ 从当前进度继续)' : '🔀 页面已切换,结束本任务点', 'warn');
            finish();
            return;
          }
          if (!frameAlive()) {
            log('🔀 页面已切走,结束本任务点(等待按新页面重扫)', 'warn');
            finish();
            return;
          }
          const cur = (function () { try { return player.currentTime() || 0; } catch (e) { return 0; } })();
          if (cur > lastCur + 0.01) { lastCur = cur; lastProgressAt = Date.now(); }
          if (Date.now() - lastProgressAt > 180000) {
            log('⚠ 视频 3 分钟没有进度,结束本任务点(避免卡死;可刷新页面重试)', 'warn');
            finish();
            return;
          }
          if (player.paused()) {
            // 暂停 = 大概率是弹题,先在三个窗口里找题目(播放器iframe/章节iframe/顶层)
            await tryPopupQuiz([win, outerWin, window], player);
          }
          if (typeof win.isUnFinishJob === 'function' && !win.isUnFinishJob()) {
            log('学习通报告本任务点已完成', 'ok');
            finish();
            return;
          }
          if (player.paused()) {
            try { player.play(); } catch (e) { /* ignore */ }
          }
        } catch (e) { /* ignore */ }
        quizBusy = false;
      }, 2000);
      try { player.on('ended', () => { log('视频播放结束', 'ok'); finish(); }); } catch (e) { /* ignore */ }
    });
    log('✓ 视频任务完成');
  }

  async function audioTask(iframe) {
    await waitIframeLoaded(iframe, 60000, runAborted);
    const win = iframe.contentWindow;
    await waitElementLoaded(win, '#audio_html5_api', 90000, () => runAborted() || !iframe.isConnected);
    const audio = win.document.getElementById('audio_html5_api');
    audio.muted = true;
    audio.volume = 0;
    try { audio.play().catch(() => { /* 首次可能需要用户点击页面 */ }); } catch (e) { /* ignore */ }
    log('♪ 开始播放音频(静音)', 'ok');
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        if (runAborted()) { try { audio.pause(); } catch (e) { /* ignore */ } log('⏸ 已暂停,音频停在此处', 'warn'); clearInterval(timer); resolve(); return; }
        if (!iframe.isConnected) { clearInterval(timer); resolve(); return; }
        if (audio.ended) { clearInterval(timer); resolve(); return; }
        if (audio.paused) { try { audio.play().catch(() => { /* ignore */ }); } catch (e) { /* ignore */ } }
      }, 2000);
      audio.addEventListener('ended', () => { clearInterval(timer); resolve(); });
    });
    log('✓ 音频任务完成');
  }

  async function pdfTask(iframe) {
    await waitIframeLoaded(iframe);
    const win = iframe.contentWindow;
    try {
      const pan = win.document.querySelector('#panView');
      if (pan && pan.contentWindow) {
        const pw = pan.contentWindow;
        pw.scrollTo(0, pw.document.body.scrollHeight);
        await sleep(1);
        pw.scrollTo(0, pw.document.body.scrollHeight);
      } else {
        win.scrollTo(0, win.document.body.scrollHeight);
      }
    } catch (e) { /* ignore */ }
    await sleep(1);
    log('✓ 文档任务处理完成');
  }

  // 图片任务点:没有视频,打开后"看完"图片即完成(停留 + 轻微滚动模拟查看)
  async function imageTask(iframe) {
    await waitIframeLoaded(iframe);
    const win = iframe.contentWindow;
    try {
      win.scrollTo(0, win.document.body.scrollHeight);
      await sleep(0.5);
      win.scrollTo(0, 0);
    } catch (e) { /* ignore */ }
    log('🖼 图片任务:已打开并停留查看...', 'ok');
    await randomSleep(5, 8);
    log('✓ 图片任务处理完成');
  }

  // 通用:对一组题目元素逐题作答(不提交),返回成功题数
  async function answerQuizElements(win, els, label) {
    let okCount = 0;
    for (let i = 0; i < els.length; i++) {
      if (runAborted()) { log(`⏸ 已暂停,第 ${i + 1}/${els.length} 题起停止`, 'warn'); break; }
      const el = els[i];
      await randomSleep(CONFIG.answerIntervalMin, CONFIG.answerIntervalMax);
      const isWorkEl = /questionLi|mark_item|question-item|q_item/.test(el.className || '');
      const q = (isWorkEl ? extractWorkQuestion(el) : extractQuizQuestion(el))
        || extractWorkQuestion(el) || extractQuizQuestion(el);
      if (!q) { log(`第 ${i + 1}/${els.length} 题:未解析到题干`, 'warn'); continue; }
      const answers = await getAnswers(q);
      const ok = setQuizAnswer(answers, q, el, win);
      if (ok) okCount++;
      log(`第 ${i + 1}/${els.length} 题(类型 ${q.type}) ${ok ? '✓ 已作答' : '✗ 无答案'}`, ok ? 'ok' : 'warn');
    }
    if (label) log(`${label}作答完成(${okCount}/${els.length})`, 'ok');
    return okCount;
  }

  async function workTask(iframe) {
    try { await waitIframeLoaded(iframe, 60000, () => runAborted() || !iframe.isConnected); } catch (e) {
      if (runAborted() || !iframe.isConnected) return;
    }   // 超时也继续尝试:内容可能已可读
    const outerWin = iframe.contentWindow;
    // 等题目出现:新版内层 iframe 常懒加载,最多等 20s。不再强依赖"必须存在内层 iframe"
    let quiz = null;
    for (let i = 0; i < 40 && !quiz; i++) {
      if (runAborted()) return;
      quiz = findQuizTree(outerWin);
      if (!quiz) await sleep(0.5);
    }
    // 兜底:题目挂在顶层弹窗/对话框的 iframe 里(学习检测、新版对话框)
    if (!quiz) quiz = findQuizTree(window);
    if (!quiz) {
      log('⚠ 未找到测验题目,跳过本任务点(不提交,不影响已有成绩)', 'warn');
      dumpFrames(outerWin, '测验');
      return;
    }
    const win = quiz.win;
    log(`🧩 题目容器已定位(共 ${quiz.els.length} 题,来源:${win === outerWin ? '模块页自身' : '内层 iframe'})`);

    // 网页 AI 模式:先把 AI 页拉起来、桥在线后才开始答题(未就绪不空跑)
    if (CONFIG.webAiEnabled && !(await webAiStartupGate())) {
      try { win.alert = () => {}; if (typeof win.noSubmit === 'function') win.noSubmit(); } catch (e) { /* ignore */ }
      return;
    }

    if (win.document.querySelector('.font-cxsecret') || extractFontBase64(win)) {
      log('🔐 测验检测到字体加密,正在自动解密...', 'warn');
      const decoded = await decodeFont(win, win.document.body);
      if (!decoded) {
        log('⚠ 字体解密未成功,跳过自动作答(不会乱提交)', 'warn');
        try { win.alert = () => {}; if (typeof win.noSubmit === 'function') win.noSubmit(); } catch (e) { /* ignore */ }
        return;
      }
    }
    // 逐题提取:同一页面可能混用 .TiMu 与 .questionLi,按元素类型各用各的解析器
    const els = quiz.els;
    const isWorkEl = (el) => /questionLi|mark_item|question-item|q_item/.test(el.className || '');
    const workStyle = els.every(isWorkEl);
    log(`📝 章节测验${workStyle ? '(作业结构)' : ''},共 ${els.length} 题`, 'ok');
    const tasks = [];
    for (const el of els) {
      const q = (isWorkEl(el) ? extractWorkQuestion(el) : extractQuizQuestion(el))
        || extractWorkQuestion(el) || extractQuizQuestion(el);
      if (q) tasks.push({ q, el });
      else log('⚠ 有 1 题题干未解析到,跳过该题', 'warn');
    }
    if (!tasks.length) {
      log('⚠ 题目容器存在但题干解析失败,跳过本任务点(不提交)', 'warn');
      dumpFrames(win, '题干解析');
      return;
    }
    let okCount = 0;
    STATS.jobsTotal = tasks.length;
    STATS.jobsDone = 0;
    let pausedMid = false;
    // 整卷模式:全部题目一次问网页 AI,按题号批量解析(缺漏的题在循环里回退逐题询问)
    let batchMap = null;
    if (CONFIG.webAiEnabled && CONFIG.webAiBatch) batchMap = await askBatchWebAI(tasks);
    for (let i = 0; i < tasks.length; i++) {
      const { q, el } = tasks[i];
      if (runAborted()) { pausedMid = true; log(`⏸ 已暂停,第 ${i + 1}/${tasks.length} 题起停止(点「开始」恢复后刷新重跑)`, 'warn'); break; }
      await randomSleep(CONFIG.answerIntervalMin, CONFIG.answerIntervalMax);
      if (runAborted()) { pausedMid = true; log(`⏸ 已暂停,第 ${i + 1}/${tasks.length} 题起停止`, 'warn'); break; }
      let answers = (batchMap && batchMap[i]) || [];
      if (answers.length) {
        STATS.answered++;
        log(`[网页AI·整卷] 查到答案: ${answers.join(' / ')}`, 'ok');
      } else {
        answers = await getAnswers(q);
      }
      let ok = false;
      let fail = '';
      if (!answers.length) fail = '未获取到答案';
      else {
        ok = setQuizAnswer(answers, q, el, win);
        if (!ok) fail = `答案「${answers.join('/')}」未匹配到选项(识别出 ${q.options ? q.options.length : 0} 个选项)`;
      }
      recordQuestion(q, answers);  // 收集测验题进题库
      if (ok) okCount++;
      STATS.jobsDone = okCount;
      log(`第 ${i + 1}/${tasks.length} 题(类型 ${q.type}) ${ok ? '✓ 已作答' : '✗ ' + fail}`, ok ? 'ok' : 'warn');
    }
    if (pausedMid) { log('⏸ 暂停中断:本题库不自动提交,已答内容保留在页面上', 'warn'); return; }
    // 填充率 = 成功填上答案的题数 / 总题数(不是准确率:对错要等平台判分才知道)
    // 固定要求 100%:只要有一题没填上答案就不交卷,避免交半张卷被判错
    const fillPct = tasks.length ? Math.round((okCount / tasks.length) * 100) : 0;
    const missing = tasks.length - okCount;
    if (!CONFIG.autoSubmit) {
      log(`填充率 ${fillPct}%(${okCount}/${tasks.length}),自动提交已关闭,暂存不提交`, 'warn');
      try { win.alert = () => {}; if (typeof win.noSubmit === 'function') win.noSubmit(); } catch (e) { /* ignore */ }
      return;
    }
    if (missing > 0) {
      const reason = `填充率 ${fillPct}%(还有 ${missing}/${tasks.length} 题没填上答案)`;
      log(`⛔ ${reason},按规则不提交(填充率必须 100%)`, 'warn');
      recordSubmitFail({ chapter: curChapterName, node: curNodeName, reason });
      try { win.alert = () => {}; if (typeof win.noSubmit === 'function') win.noSubmit(); } catch (e) { /* ignore */ }
      return;
    }
    // 提交前回读:okCount 只统计"调用作答成功",不代表页面真的记录上了答案。
    // 这里再按页面当前状态逐题确认一遍,漏的补答一次;补完仍漏才放弃提交(避免交半张卷)
    let replied = countReplied(tasks);
    if (replied === 0) {
      log('🔍 提交前回读:页面结构不标准,读不到已作答标记,跳过回读校验直接提交', 'warn');
    } else if (replied < tasks.length) {
      log(`🔍 提交前回读:${replied}/${tasks.length} 题确实已填入作答,补答 ${tasks.length - replied} 题...`, 'warn');
      for (const t of tasks) {
        if (runAborted()) { log('⏸ 已暂停,本题库不自动提交', 'warn'); return; }
        if (isAnsweredEl(t.el)) continue;
        let ans = [];
        try { ans = await getAnswers(t.q); } catch (e) { ans = []; }
        if (ans.length && setQuizAnswer(ans, t.q, t.el, win)) log('  补答成功', 'ok');
        await sleep(0.2);
      }
      replied = countReplied(tasks);
      if (replied < tasks.length) {
        const reason = `回读校验只确认 ${replied}/${tasks.length} 题已作答(其余题页面没记录选择)`;
        log(`⛔ ${reason},按规则不提交`, 'warn');
        recordSubmitFail({ chapter: curChapterName, node: curNodeName, reason });
        try { win.alert = () => {}; if (typeof win.noSubmit === 'function') win.noSubmit(); } catch (e) { /* ignore */ }
        return;
      }
      log(`✓ 回读校验通过:${replied}/${tasks.length} 题页面均已记录作答`, 'ok');
    }
    {
      await randomSleep(CONFIG.submitDelayMin, CONFIG.submitDelayMax);
      log(`填充率 100%(${tasks.length}/${tasks.length} 题已作答),正在提交...`, 'ok');
      let submitted = false;
      // 提交入口可能定义在题目窗口,也可能在它的父级页(旧版章节测验把 btnBlueSubmit 挂在父页)
      const chain = [win];
      try { if (win.parent && win.parent !== win) chain.push(win.parent); } catch (e) { /* 跨域忽略 */ }
      try {
        const p2 = chain[chain.length - 1].parent;
        if (p2 && p2 !== chain[chain.length - 1] && chain.indexOf(p2) < 0) chain.push(p2);
      } catch (e) { /* 跨域忽略 */ }
      for (const w of chain) {
        try {
          if (typeof w.btnBlueSubmit === 'function') { w.btnBlueSubmit(); submitted = true; break; }
          if (typeof w.submitWork === 'function') { w.submitWork(); submitted = true; break; }
        } catch (e) { /* ignore */ }
      }
      if (!submitted) {
        for (const w of chain) {
          if (clickButtonByText(w, ['交卷', '提交', '确认提交'])) { submitted = true; break; }
        }
      }
      if (submitted) {
        await sleep(3);
        for (const w of chain) {
          try { if (typeof w.submitCheckTimes === 'function') { w.submitCheckTimes(); break; } } catch (e) { /* ignore */ }
        }
        log('已触发提交', 'ok');
        // 校验这一步是不是真的交上去了:没交上去的话,等判分会一直等不到,
        // 白等 25 秒还会被当成"此节点不支持重复提交",最后错题也没机会修
        let ack = readSubmitAck(chain);
        if (ack === 'fail') {
          log('⚠ 提交后仍停在作答状态(可能弹了确认框没点或按钮无响应),再点一次提交', 'warn');
          for (const w of chain) {
            try { if (typeof w.btnBlueSubmit === 'function') { w.btnBlueSubmit(); break; } } catch (e) { /* ignore */ }
            try { if (typeof w.submitWork === 'function') { w.submitWork(); break; } } catch (e) { /* ignore */ }
          }
          if (readSubmitAck(chain) === 'fail') {
            for (const w of chain) { if (clickButtonByText(w, ['确认提交', '确定', '交卷'])) break; }
          }
          await sleep(3);
          ack = readSubmitAck(chain);
        }
        if (ack === 'ok') {
          log('✓ 提交已确认(页面已进入已提交/结果状态)', 'ok');
        } else if (ack === 'fail') {
          log('⛔ 两次提交后页面仍停在作答状态,判定本次没交上去', 'warn');
          recordSubmitFail({ chapter: curChapterName, node: curNodeName, reason: '点提交后仍停在作答状态(可能需手动点确认弹窗)' });
          return;
        } else {
          log('🔎 没读到明确提交回执,按后续判分结果判断', 'info');
        }
        // 提交后准确率检测:只对「可重复提交」的节点生效
        // 先查有没有错题:没有 = 全对直接过;有 = 只把错题单独重问后点重做
        await afterSubmitAccuracy(chain, { node: curNodeName || '', tasks });
      } else {
        log('未找到提交入口,请手动提交', 'warn');
        recordSubmitFail({ chapter: curChapterName, node: curNodeName, reason: '已作答但没找到提交入口(需手动点提交)' });
      }
    }
  }

  async function homeworkTask() {
    initPanel();
    await waitElementLoaded(window, '.questionLi', 30000, runAborted);
    // 网页 AI 模式:先把 AI 页拉起来、桥在线后才开始答题(未就绪不空跑)
    if (CONFIG.webAiEnabled && !(await webAiStartupGate())) return;
    if (window.document.querySelector('.font-cxsecret') || extractFontBase64(window)) {
      log('🔐 作业检测到字体加密,正在自动解密...', 'warn');
      await decodeFont(window, window.document.body);
    }
    const els = Array.from(document.querySelectorAll('.questionLi'));
    if (!els.length) { log('未找到作业题目', 'warn'); return; }
    log(`📝 作业页,共 ${els.length} 题(填写后不会自动交卷,请检查后手动提交)`, 'ok');
    // 先解析全部题干(整卷模式需要完整题目列表;解析失败的题保持原逻辑跳过)
    const qs = els.map((el) => extractWorkQuestion(el));
    // 整卷模式:全部题目一次问网页 AI,按题号批量解析(缺漏的题在循环里回退逐题询问)
    let batchMap = null;
    if (CONFIG.webAiEnabled && CONFIG.webAiBatch) {
      const tasks = els.map((el, i) => (qs[i] ? { q: qs[i], el } : null)).filter(Boolean);
      batchMap = tasks.length ? await askBatchWebAI(tasks) : null;
      // 把批量结果按原始下标摊回 batchMap
      if (batchMap) {
        const byOrig = new Array(els.length).fill(null);
        let t = 0;
        for (let i = 0; i < els.length; i++) {
          if (qs[i]) byOrig[i] = batchMap[t++];
        }
        batchMap = byOrig;
      }
    }
    let okCount = 0;
    for (let i = 0; i < els.length; i++) {
      if (runAborted()) { log(`⏸ 已暂停,第 ${i + 1}/${els.length} 题起停止(点「开始」恢复后刷新重跑)`, 'warn'); break; }
      await randomSleep(CONFIG.answerIntervalMin, CONFIG.answerIntervalMax);
      if (runAborted()) { log(`⏸ 已暂停,第 ${i + 1}/${els.length} 题起停止`, 'warn'); break; }
      const q = qs[i];
      if (!q) continue;
      let answers = (batchMap && batchMap[i]) || [];
      if (answers.length) {
        STATS.answered++;
        log(`[网页AI·整卷] 查到答案: ${answers.join(' / ')}`, 'ok');
      } else {
        answers = await getAnswers(q);
      }
      const ok = setQuizAnswer(answers, q, els[i], window);
      if (ok) okCount++;
      const size = (answers || []).join('').length;
      log(`第 ${i + 1}/${els.length} 题 ${ok ? `✓ 已作答(回读校验通过, ${size} 字)` : `✗ 写入失败或无可匹配答案(收到 ${size} 字)`}`, ok ? 'ok' : 'warn');
    }
    log(`作业填写完成(${okCount}/${els.length}),请人工检查后手动提交`);
  }
  /* ==================== 节点定位(记「未提交」用) ==================== */
  // 当前章节名与任务点名:让「未提交」栏直接告诉用户是哪一章的哪个节点,不用自己翻
  let curChapterName = '';
  let curNodeName = '';
  function readChapterName() {
    const sels = ['.posCatalog_select .posCatalog_name', '.posCatalog_select', '#curChapterName',
      '.prev_white .prev_white_name', '.prev_white', '.chapterName', '.catalog_name'];
    for (const s of sels) {
      try {
        const el = document.querySelector(s);
        const t = el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
        if (t && t.length <= 60) return t;
      } catch (e) { /* ignore */ }
    }
    try { return String(document.title || '').split(/[-_|]/)[0].trim().slice(0, 60); } catch (e) { return ''; }
  }

  /* ==================== 提交后准确率检测(仅「可重复提交」节点) ==================== */
  // 对错标记:超星结果页给每题标 dui/cuo(各版本类名有差异),用类名正则一并兜住
  const RIGHT_CLS = /(^|\s)(dui|right|correct|answerRight|icon-dui|icon-right|is-right)(\s|$)/i;
  const WRONG_CLS = /(^|\s)(cuo|wrong|error|answerWrong|icon-cuo|icon-wrong|is-wrong)(\s|$)/i;

  // 取文档正文(去掉脚本自己的面板,否则面板日志里的"准确率 xx%"会被当成判分结果)
  function docPlainText(doc) {
    try {
      const clone = doc.body.cloneNode(true);
      clone.querySelectorAll('#cx-panel, #cxCfgPanel').forEach((n) => n.remove());
      return String(clone.textContent || '');
    } catch (e) { return ''; }
  }

  // 判断单题在结果页被判对还是判错:类名标记 → 分数标签 → 是否展示"正确答案"(只在错题上展示)
  function judgeItemSide(el) {
    const all = [el].concat(Array.from(el.querySelectorAll('*')));
    const clsOf = (n) => {
      const c = n.className;
      return String(c && c.baseVal !== undefined ? c.baseVal : (c || ''));
    };
    const has = (re) => all.some((n) => re.test(clsOf(n)));
    if (has(WRONG_CLS)) return 'wrong';
    if (has(RIGHT_CLS)) return 'right';
    // 图标字体 / 文字标记(√ ✗ 对 错):有些版本不靠 class 区分,只放一个对勾叉号字符
    // 同一题可能既标了"我的答案 ✗"又标了"正确答案 √",这时以 ✗ 为准(错题才需要修)
    try {
      const cand = Array.from(el.querySelectorAll('i, em, font, b, span, .icon, .mark_answer, .ansIcon'));
      let sawRight = false;
      for (const n of cand.slice(0, 14)) {
        const tx = String(n.textContent || n.getAttribute('title') || n.getAttribute('alt') || '').replace(/\s+/g, '');
        if (!tx || tx.length > 4) continue;
        if (/^(×|✗|✘|✕|╳|错|错误|答错)$/.test(tx)) return 'wrong';
        if (/^(√|✓|✔|对|正确|答对)$/.test(tx)) sawRight = true;
      }
      if (sawRight) return 'right';
    } catch (e) { /* ignore */ }
    // 分数标签:0 分 = 错,>0 分 = 对(超星结果页 .mark_score / .score 常见)
    try {
      const sEl = el.querySelector('.mark_score, .score, .getScore, .questionScore, .question_score, .my_score');
      if (sEl) {
        const mm = String(sEl.textContent || '').replace(/\s+/g, '').match(/(\d+(?:\.\d+)?)\s*分/);
        if (mm) return parseFloat(mm[1]) > 0 ? 'right' : 'wrong';
      }
    } catch (e) { /* ignore */ }
    // 「我的答案 / 你的答案」与「正确答案」都能读到 → 直接比对:一致就对、不一致就错。
    // 有些版本不给对错图标也不给分数,只把两个答案并排贴出来,只看图标会漏判成"无标记"
    try {
      const t = String(el.textContent || '');
      const mine = (t.match(/(?:我的答案|你的答案|学生答案|所选答案)\s*[:：]\s*([^\n]{1,60})/) || [])[1];
      const right = (t.match(/(?:正确答案|参考答案)\s*[:：]\s*([^\n]{1,60})/) || [])[1];
      if (mine && right) {
        const norm = (s) => String(s).replace(/[\s，,、;；]/g, '').toUpperCase();
        return norm(mine) === norm(right) ? 'right' : 'wrong';
      }
    } catch (e) { /* ignore */ }
    // "正确答案/参考答案"只在被判错时才展示 → 出现即判错
    try {
      const t = String(el.textContent || '');
      if (/正确答案\s*[:：]/.test(t) || /参考答案\s*[:：]/.test(t)) return 'wrong';
    } catch (e) { /* ignore */ }
    return '';
  }

  // 逐题扫对错标记:total 题数 / right 判对 / wrong 判错
  // 注意:若每道题都被判成"错"(多半是结果页每题都展示了正确答案),说明标记不可靠,按"无标记"处理
  function scanQuizMarks(wins) {
    // 判分页常在多层 iframe 里,而各窗口能匹配到的 DOM 质量差很多(有的窗口会命中一堆 .mark_item
    // 之类的无关节点却完全判不出对错)。所以不认"第一个有题目的窗口",而是每个窗口都扫,
    // 挑能判出对错最多的那个 —— 否则可能因为外层窗口的假命中,把整卷错误地读成"读不到判分"
    let best = { total: 0, right: 0, wrong: 0, unreliable: false };
    let bestJudged = -1;
    for (const w of wins) {
      let doc;
      try { doc = w.document; } catch (e) { continue; }
      if (!doc || !doc.body) continue;
      let items = [];
      try { items = Array.from(doc.querySelectorAll(QUIZ_ITEM_SEL)); } catch (e) { items = []; }
      if (!items.length) continue;
      let right = 0;
      let wrong = 0;
      for (const el of items) {
        const side = judgeItemSide(el);
        if (side === 'right') right++;
        else if (side === 'wrong') wrong++;
      }
      const judged = right + wrong;
      if (judged > bestJudged) {
        bestJudged = judged;
        best = { total: items.length, right, wrong, unreliable: right === 0 && wrong === items.length };
      }
      if (judged === items.length) break;   // 这个窗口整卷都判出来了,不用再看别的
    }
    return best;
  }

  // 读判分结果,第一优先"看有没有错题":
  // ① 无错题 → 全对(100%),不再纠结百分比
  // ② 有错题 → 只关心错了几道,准确率按对/错计数算
  // ③ 页面没给逐题标记 → 回退"正确率 xx%" / 得分÷总分 / 类名计数
  function readQuizResult(wins) {
    const marks = scanQuizMarks(wins);
    // 整卷每道都判成"错":多半是结果页给每道题都贴了正确答案,标记不可靠 → 退回总量/文本判断
    if (!marks.unreliable && marks.total > 0 && marks.wrong === 0 && marks.right > 0) {
      return { pct: 100, basis: '无错题(' + marks.right + '/' + marks.total + ' 题判对)', allRight: true, total: marks.total, right: marks.right, wrong: 0 };
    }
    if (marks.wrong > 0 && marks.right > 0) {
      return { pct: Math.round((marks.right / (marks.right + marks.wrong)) * 100), basis: '错 ' + marks.wrong + ' 道/共 ' + marks.total + ' 题', allRight: false, total: marks.total, right: marks.right, wrong: marks.wrong };
    }
    if (marks.wrong > 0 && marks.total > 0) {
      // 只标错、没标对(部分版本只给错题加红标)
      const rightN = Math.max(0, marks.total - marks.wrong);
      return { pct: Math.round((rightN / marks.total) * 100), basis: '只标出 ' + marks.wrong + ' 道错题', allRight: false, total: marks.total, right: rightN, wrong: marks.wrong };
    }
    for (const w of wins) {
      let doc;
      try { doc = w.document; } catch (e) { continue; }
      if (!doc || !doc.body) continue;
      const text = docPlainText(doc);
      let m = text.match(/正确率\s*[:：]?\s*(\d{1,3}(?:\.\d+)?)\s*%/);
      if (m) return { pct: Math.round(parseFloat(m[1])), basis: '正确率', allRight: false, wrong: -1 };
      m = text.match(/得分\s*[:：]?\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
      if (m && parseFloat(m[2]) > 0) return { pct: Math.round(parseFloat(m[1]) / parseFloat(m[2]) * 100), basis: '得分/总分', allRight: false, wrong: -1 };
      m = text.match(/(\d+(?:\.\d+)?)\s*分\s*\/\s*(\d+(?:\.\d+)?)\s*分/);
      if (m && parseFloat(m[2]) > 0) return { pct: Math.round(parseFloat(m[1]) / parseFloat(m[2]) * 100), basis: '得分/总分', allRight: false, wrong: -1 };
      let right = 0;
      let wrong = 0;
      doc.querySelectorAll(QUIZ_ITEM_SEL).forEach((el) => {
        const side = judgeItemSide(el);
        if (side === 'wrong') wrong++;
        else if (side === 'right') right++;
      });
      if (right + wrong > 0) {
        return { pct: Math.round((right / (right + wrong)) * 100), basis: `对错标记 ${right}/${right + wrong}`, allRight: wrong === 0, right, wrong };
      }
    }
    return null;
  }

  // 收集判错的题:题干 + 正确答案(结果页有就直接用,比再问一次 AI 更准)
  function collectWrongQuestions(wins) {
    const out = [];
    const seen = {};
    for (const w of wins) {
      let doc;
      try { doc = w.document; } catch (e) { continue; }
      if (!doc) continue;
      doc.querySelectorAll(QUIZ_ITEM_SEL).forEach((el) => {
        if (judgeItemSide(el) !== 'wrong') return;
        const q = extractWorkQuestion(el) || extractQuizQuestion(el);
        if (!q || !q.question) return;
        // 结果页没解析到选项时,错题本仍可用(重做时按题干命中答案),这里不拦
        const key = fixKey(q.question);
        if (!key || seen[key]) return;
        seen[key] = 1;
        let right = '';
        try {
          const rEl = el.querySelector('.rightAnswer, .correctAnswer, .right_answer, .answerRight');
          if (rEl) right = clean(rEl.textContent || '');
          if (!right) {
            const t = String(el.innerText || '');
            const mm = t.match(/正确答案\s*[:：]?\s*([^\n]{1,60})/) || t.match(/参考答案\s*[:：]?\s*([^\n]{1,60})/);
            if (mm) right = mm[1].replace(/\s+/g, ' ').trim();
          }
        } catch (e) { /* ignore */ }
        out.push({ q, right });
      });
    }
    return out;
  }

  // 提交前回读:这题在页面上到底有没有"已作答"的痕迹(计数成功 ≠ 页面真的记录上了)
  // 判不准时宁可宽松(返回 true),避免因选择器不适配把整卷卡成永不提交
  function isAnsweredEl(el) {
    try {
      if (el.querySelector('input[type=radio]:checked, input[type=checkbox]:checked')) return true;
      // 选中标记(各版本 class 名不同)
      if (el.querySelector('.check_answer, .checkAnswer, .cur, .selected, .choiceCheck, .on, .active')) return true;
      // 填空/简答:输入框里有内容
      const inputs = Array.from(el.querySelectorAll('textarea, input[type=text], input:not([type])'));
      if (inputs.length) return inputs.some((n) => String(n.value || '').trim().length > 0);
      // 页面自带的答案隐藏域(提交时页面读的就是它)
      const hid = Array.from(el.querySelectorAll('input[name^=answer], input[id^=answer], .answerStr, .answer_str, .answerContent'));
      if (hid.length) return hid.some((n) => String(n.value !== undefined && n.value !== null ? n.value : n.textContent || '').trim().length > 0);
    } catch (e) { /* ignore */ }
    return false;
  }

  // 数一下"页面上确实已填入作答"的题数
  function countReplied(tasks) {
    let n = 0;
    for (const t of tasks) {
      try { if (isAnsweredEl(t.el)) n++; } catch (e) { /* ignore */ }
    }
    return n;
  }

  const REDO_TEXTS = ['重做', '再做一次', '重新做', '再次测验', '重考', '再考一次', '重新测验'];
  // 能否重复提交:结果页/测验页有「重做/再做一次/重考」入口 → 可重复提交;没有 → 不可重复提交
  function findRedoEntry(wins) {
    for (const w of wins) {
      try {
        const nodes = w.document.querySelectorAll('button, a, .btn, .el-button, .jb_btn, input[type=button], span');
        for (const n of nodes) {
          const t = String(n.textContent || n.value || '').replace(/\s+/g, '');
          if (!t || t.length > 12) continue;
          if (!REDO_TEXTS.some((k) => t === k || t.includes(k))) continue;
          // 隐藏的按钮点不动:既有页面会把「重做」先藏着等判分出来再显示,
          // 也有弹窗里的"请重做"提示文字,点下去只会白跑一轮重做计数
          try {
            const cs = w.getComputedStyle(n);
            if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) continue;
          } catch (e) { /* ignore */ }
          // 弹窗里的"未达及格线,请重做"是提示文字不是按钮:弹窗内只认真正的按钮/链接
          let inPop = false;
          try { inPop = !!(n.closest && n.closest('.layui-layer, .pop, .popup, .dialog, .modal, .mask_box, .tipBox, .maskDiv, .cu-tip, .ui-dialog')); } catch (e) { inPop = false; }
          if (inPop && !/^(BUTTON|A|INPUT)$/.test(String(n.tagName || '').toUpperCase())) continue;
          return { w, el: n };
        }
      } catch (e) { /* ignore */ }
    }
    return null;
  }

  // 同一节点自动重做的次数(防死循环:重做→又没过→再重做…)
  const redoCounts = {};

  // 「未达及格线,请重做」这类判分弹窗:平台用弹窗替代分数页,页面上既没有分数也没有「重做」按钮,
  // 弹窗还挡着题目区 —— 旧逻辑读不到判分,直接当成"此节点不支持重复提交"放弃,错题永远没机会修。
  // 另外这句提示本身就是平台在明说"有错题、需要重做",不必再等一个百分比才敢动手。
  const GATE_RE = /未达|不及格|不达标|未通过|没通过|请重做|需要重做|重新做一遍|再答一次|再次作答|继续努力/;
  function findGatePopup(wins) {
    for (const w of wins) {
      let doc;
      try { doc = w.document; } catch (e) { continue; }
      if (!doc || !doc.body) continue;
      let boxes = [];
      try {
        boxes = Array.from(doc.querySelectorAll('.layui-layer, .layui-layer-content, .pop, .popup, .dialog, .modal, .mask_box, .tipBox, .ans-job-pop, .maskDiv, .cu-tip, .ui-dialog'));
      } catch (e) { boxes = []; }
      for (const box of boxes) {
        const t = String(box.textContent || '').replace(/\s+/g, '');
        if (!t || t.length > 200 || !GATE_RE.test(t)) continue;
        // 弹窗里的确认键:点掉它,题目区/判分详情才露出来,重做入口也才点得到
        let okBtn = null;
        try {
          const btns = Array.from(box.querySelectorAll('button, a, .btn, .layui-layer-btn0, input[type=button], span'));
          okBtn = btns.find((n) => /^(确定|确认|知道了|知道了。|关闭|好的|OK)$/i.test(String(n.textContent || n.value || '').replace(/\s+/g, '')));
        } catch (e) { okBtn = null; }
        return { w, box, text: t, okBtn: okBtn || null };
      }
    }
    return null;
  }

  // 关掉弹窗后页面是否直接恢复成"可以再交一次"的状态:
  // 有些节点的重做不是按钮,而是把题目解锁让人改完再交 —— 此时改完错题重新提交即可
  function canRetake(wins) {
    for (const w of wins) {
      let doc;
      try { doc = w.document; } catch (e) { continue; }
      if (!doc || !doc.body) continue;
      try {
        const bar = doc.querySelector('.mark_table, .mark_item, .TiMu, .questionLi');
        if (!bar) continue;
        const btns = Array.from(doc.querySelectorAll('button, a, .btn, .el-button, .jb_btn, input[type=button]'));
        const sub = btns.find((b) => /^(提交|交卷|提交作业|提交答案|重新提交)$/.test(String(b.textContent || b.value || '').replace(/\s+/g, '')));
        if (!sub) continue;
        const locked = Array.from(doc.querySelectorAll('.TiMu input, .questionLi input, .mark_item input'))
          .some((n) => n.disabled === false || n.type === 'radio' || n.type === 'checkbox');
        if (locked) return { w, el: sub };
      } catch (e) { /* ignore */ }
    }
    return null;
  }

  // 提交回执:点了提交按钮 ≠ 交卷成功(确认弹窗没点、按钮无响应都会静默失败,
  // 页面还停在作答状态,脚本却以为交上去了,后面就再也等不到判分)
  // 返回 'ok' 明确已交 / 'fail' 还停在作答状态 / 'unknown' 读不到(交给判分流程兜底)
  function readSubmitAck(chain) {
    let sawSubmitBtn = false;
    let sawAnswerState = false;
    for (const w of chain) {
      let doc;
      try { doc = w.document; } catch (e) { continue; }
      if (!doc || !doc.body) continue;
      try {
        const t = docPlainText(doc).replace(/\s+/g, '');
        if (/重做|再做一次|重新做|查看结果|查看详情|查看答卷|我的成绩|提交成功|已提交|已交卷|已完成/.test(t)) return 'ok';
        const btns = Array.from(doc.querySelectorAll('button, a, .btn, .el-button, .jb_btn, input[type=button]'));
        if (btns.some((b) => /交卷|提交/.test(String(b.textContent || b.value || '')))) sawSubmitBtn = true;
        if (doc.querySelector(QUIZ_ITEM_SEL)) sawAnswerState = true;
      } catch (e) { /* ignore */ }
    }
    return (sawSubmitBtn && sawAnswerState) ? 'fail' : 'unknown';
  }
  // 提交后主流程:等判分 → 先看有没有错题
  //   · 没有错题 = 全对 → 直接进下一个节点
  //   · 有错题   → 只把判错的题单独重问(其余题不动),写入错题本后点「重做」
  async function afterSubmitAccuracy(wins, ctx) {
    if (!CONFIG.accCheckEnabled) return;
    const needPct = Math.round((CONFIG.minAccuracy || 0.9) * 100);
    const fixAllWrong = CONFIG.accFixAllWrong !== false;            // 默认:只要有错题就修,不看整体准确率
    const redoMax = Math.max(1, Math.min(5, CONFIG.accRedoMax || 2)); // 同一节点最多自动重做几次
    const node = (ctx && ctx.node) || curNodeName || '当前节点';
    const nodeKey = curChapterName + '#' + node;
    let res = null;
    let redo = null;
    let gate = null;
    let waited = 0;
    for (let i = 0; i < 25; i++) {
      await sleep(1);
      waited++;
      if (runAborted()) return;
      res = res || readQuizResult(wins);
      redo = redo || findRedoEntry(wins);
      gate = gate || findGatePopup(wins);
      // 弹窗型判分:文案一到就够判断了,不用等它给出百分比(它根本不给)
      if (gate && i >= 2) break;
      if (res && redo) break;   // 判分 + 重做入口都拿到,不必再等
      if (res && i >= 3) break;
    }
    // 弹窗说"未达及格线/请重做" → 这就是平台明确告知"有错题、要重做":
    // 先点掉弹窗(它挡着题目区和重做入口),再读判分,读不到也照样按"有错题"往下走
    if (gate && !(res && res.allRight)) {
      log('📋 平台弹窗提示「' + gate.text.slice(0, 40) + '」,按"有错题需重做"处理', 'warn');
      try {
        if (gate.okBtn) gate.okBtn.click();
        else { for (const w of wins) { if (clickButtonByText(w, ['确定', '确认', '知道了', '关闭'])) break; } }
      } catch (e) { /* ignore */ }
      await sleep(2);
      res = readQuizResult(wins) || res;
      redo = findRedoEntry(wins) || redo;
      if (!res) res = { pct: 0, basis: '弹窗提示未达及格线(未给分数)', allRight: false, wrong: -1 };
    }
    if (!res) {
      if (redo) {
        log('📊 等了 ' + waited + 's 仍没读到判分结果,无法判断准确率(不自动重做)', 'warn');
        recordSubmitFail({ chapter: curChapterName, node: node, reason: '提交后没读到判分结果(可能没提交成功),需人工确认' });
      } else {
        log('📊 未读到判分结果(此节点多半不支持重复提交),不做准确率后续处理', 'info');
      }
      return;
    }
    // ① 先查有没有错题:没有错题就是全对,直接进下一个节点,不折腾重做
    if (res.allRight) {
      log('✅ 无错题(全对):' + res.basis + ',进入下一个节点', 'ok');
      return;
    }
    // wrong = -1 表示只读到总百分比、没读到逐题明细
    const wrongCnt = res.wrong > 0 ? res.wrong : 0;
    const detailKnown = res.wrong >= 0;
    log('📊 提交后准确率 ' + res.pct + '%(依据:' + res.basis + (detailKnown ? ';错题 ' + wrongCnt + ' 道' : '') + '),阈值 ' + needPct + '%', res.pct >= needPct ? 'ok' : 'warn');
    // ② 有错题:开启「有错必修」就修(不管整体准确率),否则按阈值判;
    //    只读到总百分比时(不知错题明细)只能按阈值判
    const needFix = (detailKnown && wrongCnt > 0) ? (fixAllWrong ? true : res.pct < needPct) : res.pct < needPct;
    if (!needFix) { log('🎯 准确率达标,进入下一个节点', 'ok'); return; }
    const wrongs = collectWrongQuestions(wins);
    // 没有「重做」按钮但有错题:先看关掉弹窗后题目是否已经解锁(可改可交),
    // 能再交一次就修完错题重新提交 —— 别因为少一个按钮就把整个节点丢掉
    const retake = redo ? null : canRetake(wins);
    if (!redo && !retake) {
      log(wrongCnt > 0 ? '⚠ 有 ' + wrongCnt + ' 道错题,但该节点没有「重做」入口(不可重复提交),只记录结果'
        : '⚠ 准确率不达标,但该节点没有「重做」入口(不可重复提交),不再处理', 'warn');
      if (wrongCnt > 0) {
        recordSubmitFail({ chapter: curChapterName, node: node, reason: '有 ' + wrongCnt + ' 道错题,但该节点不可重复提交(无重做入口)' });
        if (wrongs.length) {
          // 修不了也先把正确答案写进错题本:下次遇到同题直接答对,不算白跑
          wrongs.forEach((it) => { if (it.right) recordFix(it.q, [it.right]); });
          log('📕 已把 ' + wrongs.filter((x) => x.right).length + ' 道错题的正确答案写入错题本(供下次自动答对)', 'ok');
        }
      }
      return;
    }
    if ((redoCounts[nodeKey] || 0) >= redoMax) {
      log('⛔ 该节点已自动重做 ' + redoCounts[nodeKey] + ' 次仍未通过,停止重做,记入「未提交」栏人工处理', 'warn');
      recordSubmitFail({ chapter: curChapterName, node: node, reason: '自动重做 ' + redoCounts[nodeKey] + ' 次仍未达到准确率要求' });
      return;
    }
    // ③ 只重问判错的题(不全卷重来):结果页给了正确答案就直接用,比再问一次 AI 更准
    if (!wrongs.length) {
      log('⚠ 有错题但结果页没暴露错题明细(定位不到具体哪几题错),不做整卷重问,记入「未提交」栏人工核对', 'warn');
      recordSubmitFail({ chapter: curChapterName, node: node, reason: '准确率 ' + res.pct + '%(错 ' + wrongCnt + ' 道),但结果页未暴露错题明细,无法只修正错题' });
      return;
    }
    log('📕 开始单独处理错题(共 ' + wrongs.length + ' 题,其余题不动)', 'warn');
    let fixed = 0;
    for (let i = 0; i < wrongs.length; i++) {
      if (runAborted()) return;
      const item = wrongs[i];
      if (item.right) {
        recordFix(item.q, [item.right]);
        fixed++;
        log('  [' + (i + 1) + '/' + wrongs.length + '] 结果页已给正确答案: ' + item.right, 'ok');
        continue;
      }
      const ans = await getAnswers(item.q, '这道题上次已被判为错误,请重新审题后给出答案,不要重复上次的答案。');
      if (ans.length) {
        recordFix(item.q, ans);
        fixed++;
        log('  [' + (i + 1) + '/' + wrongs.length + '] 重问 AI 得到新答案: ' + ans.join(' / '), 'ok');
      } else {
        log('  [' + (i + 1) + '/' + wrongs.length + '] 重问 AI 未取得答案,该题留待手动处理', 'warn');
      }
    }
    log('📕 错题处理完成(' + fixed + '/' + wrongs.length + ' 题已写入错题本)', fixed ? 'ok' : 'warn');
    redoCounts[nodeKey] = (redoCounts[nodeKey] || 0) + 1;
    if (redo) {
      try {
        redo.el.click();
        log('🔁 已点击「重做」(第 ' + redoCounts[nodeKey] + '/' + redoMax + ' 次),该节点会用新答案重做', 'ok');
        await sleep(3);
      } catch (e) {
        log('自动点击「重做」失败,请手动点重做(错题本已更新,重做时自动用新答案): ' + (e.message || e), 'warn');
      }
      return;
    }
    // 无重做按钮但题目已解锁:改完错题直接重新提交一次
    try {
      retake.el.click();
      log('🔁 该节点无「重做」按钮,但题目已解锁:已重新提交(第 ' + redoCounts[nodeKey] + '/' + redoMax + ' 次)', 'ok');
      await sleep(3);
      const ack = readSubmitAck(wins);
      if (ack === 'fail') {
        for (const w of wins) { if (clickButtonByText(w, ['确定', '确认', '提交'])) break; }
        await sleep(2);
      }
    } catch (e) {
      log('重新提交失败,请手动操作(错题本已更新): ' + (e.message || e), 'warn');
    }
  }

  /* ==================== 章节主循环 ==================== */
  let running = false;
  let lastIframeUrl = '';
  let pendingRun = false;   // 跑任务时页面被切走:收手后按新页面重扫,而不是把新 URL 记下来当"已完成"
  let runEpoch = 0;         // 页面切换时自增;正在跑的那轮发现令牌变了立刻收手(旧 DOM 已失效,继续干只会空转)
  let activeEpoch = 0;

  // 本轮是否该收手:用户点了暂停,或页面已被切走
  const runAborted = () => PAUSED || activeEpoch !== runEpoch;

  // 诊断用(排查"切页后不动了"):控制台执行 __cxRunState() 看轮次令牌与运行标志
  try {
    window.__cxRunState = () => ({ epoch: runEpoch, active: activeEpoch, running, pending: pendingRun, paused: PAUSED, url: lastIframeUrl });
  } catch (e) { /* ignore */ }

  // 通用:按可见文本点击元素(tab/按钮)
  function clickByText(win, texts) {
    const nodes = win.document.querySelectorAll('button, a, div, span, li');
    for (const n of nodes) {
      const t = (n.textContent || '').trim();
      if (!t || t.length > 20) continue;
      for (const kw of texts) {
        if (t === kw || (t.includes(kw) && !n.querySelector('input'))) {
          try { n.click(); } catch (e) { /* ignore */ }
          return true;
        }
      }
    }
    return false;
  }

  // 点"下一节/下一章":多入口兜底(老版 .nextChapter、onclick 带 nextChapter、文本按钮)
  function clickNextChapterBtn() {
    const sels = ['.nextChapter', '.nextChapterBtn', '.nextChapterBtnA', '#nextChapter',
      'a[onclick*="nextChapter"]', '.prev_next .next', '.jb_btn.next'];
    for (const s of sels) {
      let el = null;
      try { el = document.querySelector(s); } catch (e) { el = null; }
      if (el) { try { el.click(); return true; } catch (e) { /* ignore */ } }
    }
    let nodes = [];
    try { nodes = Array.from(document.querySelectorAll('button, a, div, span, li')); } catch (e) { nodes = []; }
    for (const n of nodes) {
      const t = String(n.textContent || '').replace(/\s+/g, '');
      if (!t || t.length > 10) continue;
      if (t === '下一节' || t === '下一章' || t === '下一节>' || t === '下一章>' || t === '下一节»') {
        try { n.click(); return true; } catch (e) { /* ignore */ }
      }
    }
    return false;
  }

  // 兼容旧名
  const clickNextSection = clickNextChapterBtn;

  // 当前章节指纹(章节名 + 卡片 iframe 地址 + 前几个任务点标识)
  // 只看章节名和 iframe 地址不够:很多课程每章都叫「章节测验」,切章时 iframe 地址也可能沿用,
  // 于是"没切过去"被当成"切过去了",脚本对着旧章空转。
  function chapterSignature() {
    let href = '';
    let body = '';
    try {
      const f = document.querySelector('#iframe');
      if (f && f.contentWindow) {
        const CW = f.contentWindow;
        href = String(CW.location.href || '');
        const icons = Array.from(CW.document.querySelectorAll('.ans-job-icon')).slice(0, 3);
        body = icons.map((ic) => {
          const fr = ic.parentElement ? ic.parentElement.querySelector('iframe') : null;
          return fr ? String(fr.getAttribute('src') || '').slice(-50) : '-';
        }).join(';');
        if (!icons.length) {
          body = String((CW.document.body && CW.document.body.textContent) || '').replace(/\s+/g, '').slice(0, 60);
        }
      } else if (f) {
        href = String(f.getAttribute('src') || '');
      }
    } catch (e) { href = ''; }
    return (readChapterName() || '') + '|' + href + '|' + body;
  }

  // 切下一节/下一章:点完必须确认页面真的换了章节,没换就重试。
  // 旧实现点了就当成功 —— 按钮无效时同一章会被反复扫描,日志刷屏还以为是"切过去了"
  async function switchNextChapter(tag) {
    const label = tag || '下一章';
    const before = chapterSignature();
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (runAborted()) return false;
      if (!clickNextChapterBtn()) {
        // 没有按钮就是到头了(最后一节/最后一章)。以前这里还要重试 3 次、每次等 1s,
        // 白等 3 秒只是把"没得切"重复说三遍,对结果没有任何帮助
        log(`🏁 没有「${label}」入口,已到课程最后一个章节,自动切换到此结束`, 'warn');
        log('👉 若还有其它章节要刷,请在课程目录里手动点开,脚本会自动接着处理', 'info');
        return false;
      }
      for (let i = 0; i < 16; i++) {
        await sleep(0.5);
        if (runAborted()) return false;
        if (chapterSignature() !== before) {
          // 刚变过去可能只是加载中间态,再等一会儿复核一次,确认不是"闪一下又回到原章节"
          const sig = chapterSignature();
          await sleep(1.2);
          if (chapterSignature() !== before && chapterSignature() === sig) {
            // 页面确实换了章:清掉旧的 iframe 记录,让 startWatch 立刻按新页面接手续扫,
            // 不用等下一次 URL 变化(有些课程切章后地址栏/iframe 地址并不变)
            lastIframeUrl = '';
            log(`→ 已切换到${label}`, 'ok');
            return true;
          }
          break;   // 只是中间态,退回重试
        }
      }
      log(`点了「${label}」但页面没变化(第 ${attempt}/3 次),稍后重试`, 'warn');
      await sleep(1.5);
    }
    log(`⛔ 连续 3 次都没切到${label}(按钮点了没反应),停止自动切换,避免同一章反复扫描`, 'warn');
    log('👉 如需继续,请手动点一下课程目录里的下一章,脚本会自动接着处理新章节', 'info');
    return false;
  }

  // 顶层弹题处理(2026 新版弹题直接渲染在顶层 document,选项是 radio)
  async function topLevelQuiz() {
    const els = Array.from(document.querySelectorAll(QUIZ_ITEM_SEL));
    if (els.length) {
      log(`📝 检测到顶层题目(共 ${els.length} 题)`, 'ok');
      const ok = await answerQuizElements(window, els, '顶层测验');
      log(`顶层测验作答完成(${ok}/${els.length}),请留意提交按钮`, 'ok');
      return;
    }
    const container = heuristicFindQuiz(window);
    if (container) {
      const q = extractHeuristicQuestion(container);
      if (q && q.question) {
        log(`❓ 检测到顶层弹题: ${q.question.slice(0, 40)}...`, 'warn');
        const answers = await getAnswers(q);
        const ok = setHeuristicAnswer(answers, q, container);
        log(ok ? '弹题已作答' : '弹题未能作答', ok ? 'ok' : 'warn');
        await sleep(0.3);
        clickButtonByText(window, ['继续学习', '确定', '提交', '下一题', '关闭', '继续', '我知道了']);
      }
    }
  }

  // 新版知识卡片循环(2025-2026 knowledge/cards 结构:卡片内嵌视频/图片/检测模块,顶层切节)
  async function newChapterLoop(cardsWin) {
    log('🧭 检测到新版知识卡片结构,启用新适配', 'ok');
    if (runAborted()) return;
    const limitHit = () => {
      try {
        const txt = String(document.body ? document.body.textContent : '') + ' ' + String(cardsWin.document.body ? cardsWin.document.body.textContent : '');
        return txt.includes('今日视频任务点完成数已达上限');
      } catch (e) { return false; }
    };
    if (limitHit()) {
      log('⏹ 平台提示:今日视频任务点已达上限,跳过视频任务(明天恢复),只处理学习检测', 'warn');
    }
    // 0) 顶层题目(新版弹题/判断题直接渲染在顶层 document)
    await topLevelQuiz();
    // 1) 学习检测:点击 tab → 等 work iframe → 做题;若无 work iframe 则尝试顶层题目
    if (CONFIG.autoWork) {
      const tabClicked = clickByText(cardsWin, ['学习检测', '学习测验']);
      if (tabClicked) {
        await sleep(2);
        let workFrame = null;
        for (let i = 0; i < 20 && !workFrame; i++) {
          const fs = Array.from(cardsWin.document.querySelectorAll('iframe'));
          workFrame = fs.find((f) => isWorkSrc(f.src)) || null;
          if (!workFrame) {
            // 检测弹窗有时挂在顶层 document 上
            try {
              workFrame = Array.from(document.querySelectorAll('iframe')).find((f) => isWorkSrc(f.src)) || null;
            } catch (e) { /* ignore */ }
          }
          if (!workFrame) await sleep(1);
        }
        if (workFrame) {
          await workTask(workFrame);
          log('✓ 学习检测完成', 'ok');
        } else {
          log('学习检测 tab 已点,但未找到测验 iframe,改为整页扫描题目', 'warn');
          await topLevelQuiz();
          const deep = findQuizTree(cardsWin);
          if (deep) {
            log(`🧩 卡片内找到 ${deep.els.length} 道题,直接作答`, 'ok');
            await answerQuizElements(deep.win, deep.els, '学习检测');
          } else {
            dumpFrames(cardsWin, '学习检测');
          }
        }
      }
    }
    // 2) 视频任务(平台未限流时)
    if (runAborted()) { log('⏸ 已暂停,跳过后续任务', 'warn'); return; }
    if (!limitHit()) {
      let videoFrame = null;
      for (let i = 0; i < 20 && !videoFrame; i++) {
        const fs = Array.from(cardsWin.document.querySelectorAll('iframe'));
        videoFrame = fs.find((f) => /\/ananas\/modules\/video\//.test(String(f.src || ''))) || null;
        if (!videoFrame) await sleep(1);
      }
      if (videoFrame && CONFIG.autoVideo) {
        await videoTask(videoFrame, cardsWin);
      }
    }
    // 3) 图片任务
    {
      const fs = Array.from(cardsWin.document.querySelectorAll('iframe'));
      const imgFrame = fs.find((f) => /\/ananas\/modules\/(img|image|picture)\//.test(String(f.src || '')));
      if (imgFrame) await imageTask(imgFrame);
    }
    // 3.5) PDF/文档任务(纯 PDF 单模块卡片,如 3.8 节)
    {
      const fs = Array.from(cardsWin.document.querySelectorAll('iframe'));
      const pdfFrame = fs.find((f) => /\/ananas\/modules\/pdf\//.test(String(f.src || '')));
      if (pdfFrame) await pdfTask(pdfFrame);
    }
    // 4) 切下一节
    if (runAborted()) return;
    await sleep(0.3);
    if (CONFIG.autoJump) await switchNextChapter('下一节');
    else log('自动切节已关闭,停在当前节', 'info');
  }

  // 任务点是否已完成:老版把 ans-job-finished 挂在卡片外层,新版挂在自己身上或内部图标上
  function jobFinished(icon) {
    try {
      if (!icon) return false;
      if (icon.classList && icon.classList.contains('ans-job-finished')) return true;
      const p = icon.parentElement;
      if (p && p.classList && p.classList.contains('ans-job-finished')) return true;
      if (p && p.querySelector && p.querySelector('.ans-job-finished')) return true;
      const t = String(((p || icon).textContent) || '').slice(0, 80);
      if (/已完成/.test(t)) return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  // 一轮处理完后等平台把"已完成"标记刷回来(最少 3s、最多 15s),避免刚做完就复检导致重复跑
  async function waitIconsSettled(cardsWin, maxMs = 15000) {
    const start = Date.now();
    let prev = -1;
    while (Date.now() - start < maxMs) {
      await sleep(1);
      let remain = -1;
      try {
        remain = Array.from(cardsWin.document.querySelectorAll('.ans-job-icon')).filter((ic) => !jobFinished(ic)).length;
      } catch (e) { return; }
      if (remain === prev && Date.now() - start >= 3000) return;
      prev = remain;
    }
  }

  async function chapterLoop() {
    await waitElementLoaded(window, '#iframe', 30000, runAborted);
    const cardsIframe = document.querySelector('#iframe');
    if (!cardsIframe) return;
    await waitIframeLoaded(cardsIframe, 60000, runAborted);
    if (runAborted()) return;
    let cardsWin = null;
    try { cardsWin = cardsIframe.contentWindow; } catch (e) {
      log('章节 iframe 无法访问(跨域),请确认页面域名与脚本匹配', 'err');
      return;
    }
    try { if (typeof window.scroll2Job === 'function') window.scroll2Job(); } catch (e) { /* ignore */ }
    curChapterName = readChapterName();
    // 等卡片渲染完再判断结构:刚切章节时立刻数任务点容易数到 0,导致整章被跳成"新版结构"
    const cardsReady = () => {
      try {
        if (cardsWin.document.querySelector('.ans-job-icon')) return true;
        const fs = Array.from(cardsWin.document.querySelectorAll('iframe'));
        return fs.some((f) => /ananas\/modules\/|\/dowork|doHomeWorkNew/.test(String(f.src || '')));
      } catch (e) { return false; }
    };
    for (let i = 0; i < 24 && !cardsReady(); i++) await sleep(0.5);
    const listIcons = () => Array.from(cardsWin.document.querySelectorAll('.ans-job-icon'));
    const total = listIcons().length;
    if (!total) {
      log('未找到任务点图标,尝试新版知识卡片模式处理...', 'warn');
      try {
        const frames = Array.from(cardsWin.document.querySelectorAll('iframe'));
        const srcs = frames.map((f) => String(f.src || f.getAttribute('data') || '').slice(0, 120));
        log('🔍 侦察:卡片 iframe 共 ' + frames.length + ' 个,src 列表: ' + JSON.stringify(srcs), 'info');
      } catch (e) {
        log('🔍 侦察失败: ' + e.message, 'err');
      }
      await newChapterLoop(cardsWin);
      return;
    }
    log(`📚 当前章节:${curChapterName || '未识别'},共 ${total} 个任务点`, 'ok');

    // 复检:一轮跑完重新数"还没完成"的任务点,最多 3 轮。
    // 原实现只扫一遍就切下一章 —— 卡在懒加载/超时/临时失败上的节点会被永久跳过,
    // 用户看到的就是"整章刷完却还有红的任务点"。
    const MAX_ROUNDS = 3;
    const attempts = {};   // 同一节点最多尝试 2 次(跨轮累计),防止某个坏节点把整章拖进死循环
    let left = -1;
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      if (runAborted()) return;
      const icons = listIcons();
      const todo = icons.filter((ic) => !jobFinished(ic));
      if (!todo.length) { left = 0; log(`✓ 本章任务点全部完成(${icons.length} 个)`, 'ok'); break; }
      log(`第 ${round}/${MAX_ROUNDS} 轮扫描:共 ${icons.length} 个任务点,待处理 ${todo.length} 个`);
      for (let idx = 0; idx < icons.length; idx++) {
        const icon = icons[idx];
        if (jobFinished(icon)) continue;
        if (runAborted()) { if (PAUSED) log('⏸ 已暂停,本轮任务停止(点 ▶ 恢复)', 'warn'); return; }
        const parent = icon.parentElement;
        let iframe = parent ? parent.querySelector('iframe') : null;
        if (!iframe) {
          // 懒加载:任务点卡片有时会晚一点才插入 iframe,等 5s 再说"没有"
          for (let k = 0; k < 10 && !iframe; k++) {
            await sleep(0.5);
            iframe = parent ? parent.querySelector('iframe') : null;
          }
        }
        if (!iframe) { log('任务点无 iframe(等待 5s 仍未出现),本轮跳过', 'warn'); continue; }
        let info = {};
        try { info = JSON.parse(iframe.getAttribute('data') || '{}'); } catch (e) { /* ignore */ }
        const name = info.name || info.title || '';
        const src = iframe.src || '';
        const key = idx + '|' + src.slice(-60);
        if ((attempts[key] || 0) >= 2) {
          log(`↷ 跳过(该任务点已尝试 2 次仍未完成):${name || src.slice(-40)}`, 'warn');
          continue;
        }
        attempts[key] = (attempts[key] || 0) + 1;
        curNodeName = name || src.slice(-40);
        log(`开始任务点: ${curNodeName}`);
        try {
          if (src.includes('/ananas/modules/video/index.html')) {
            if (CONFIG.autoVideo) await videoTask(iframe, cardsWin); else log('视频任务已跳过(配置关闭)');
          } else if (src.includes('/ananas/modules/audio/index.html')) {
            if (CONFIG.autoAudio) await audioTask(iframe); else log('音频任务已跳过(配置关闭)');
          } else if (isWorkSrc(src)) {
            if (CONFIG.autoWork) await workTask(iframe); else log('测验任务已跳过(配置关闭)');
          } else if (src.includes('/ananas/modules/pdf/index.html')) {
            await pdfTask(iframe);
          } else if (src.includes('/ananas/modules/img/') || src.includes('/ananas/modules/image/') || src.includes('/ananas/modules/picture/') || /img.*index\.html/.test(src)) {
            await imageTask(iframe);
          } else {
            // 未知包装:先看看里面是不是题目,是就按测验处理(新版各种嵌法都能兜住)
            let inner = null;
            try { inner = findQuizTree(iframe.contentWindow); } catch (e) { /* ignore */ }
            if (inner) {
              log('🕵 未知任务类型内含题目,按测验处理');
              if (CONFIG.autoWork) await workTask(iframe);
            } else {
              log('未知任务类型: ' + src, 'warn');
              log('🔍 未知模块 src 全文: ' + src, 'info');
            }
          }
        } catch (e) {
          if (runAborted()) return;   // 暂停/切页导致的取消,不当成异常刷屏
          log(`任务处理异常: ${e.message}`, 'err');
        }
        if (runAborted()) { if (PAUSED) log('⏸ 已暂停,本轮任务停止(点 ▶ 恢复)', 'warn'); return; }
        await sleep(0.3);
      }
      // 复检前等状态刷新,否则刚做完的节点还会被当成未完成
      await waitIconsSettled(cardsWin);
      if (runAborted()) return;
      const nowIcons = listIcons();
      left = nowIcons.filter((ic) => !jobFinished(ic)).length;
      log(`第 ${round} 轮结束:${nowIcons.length - left}/${nowIcons.length} 个任务点已完成`, left ? 'warn' : 'ok');
      if (!left) break;
      if (round < MAX_ROUNDS) log(`🔁 还有 ${left} 个任务点未完成,开始复检第 ${round + 1} 轮`, 'warn');
    }
    if (runAborted()) return;
    if (left > 0) {
      // 没做完就不切章:切走了这些节点下一轮不会自动回来,只会一直空着
      log(`⛔ 复检 ${MAX_ROUNDS} 轮后仍有 ${left} 个任务点未完成,本章先不切换下一章`, 'warn');
      const unfin = listIcons().filter((ic) => !jobFinished(ic));
      for (const ic of unfin) {
        let n = '';
        try {
          const f = ic.parentElement ? ic.parentElement.querySelector('iframe') : null;
          const d = f ? JSON.parse(f.getAttribute('data') || '{}') : {};
          n = d.name || d.title || (f ? String(f.src).slice(-40) : '');
        } catch (e) { /* ignore */ }
        recordSubmitFail({ chapter: curChapterName, node: n || '未知任务点', reason: '多轮复检仍未完成(视频/音频可能卡住或被平台判定异常)' });
      }
      return;
    }
    log(`本章扫描结束(共 ${total} 个任务点)`, 'ok');
    if (CONFIG.autoJump) {
      await switchNextChapter('下一章');
    } else {
      log('自动切章已关闭,本章完成后停在当前页', 'info');
    }
  }

  function startWatch() {
    initPanel();
    log('挂机引擎已启动,开始扫描任务点...', 'ok');
    let seenUrl = '';
    let seenSince = Date.now();
    setInterval(() => {
      try {
        const f = document.querySelector('#iframe');
        if (!f || !f.contentWindow) return;
        let url = '';
        try { url = f.contentWindow.location.href; } catch (e) { return; }
        const now = Date.now();
        // 页面切换有中间态(about:blank、加载中的旧地址)。先记下来,等它稳定 1.2s 再认,
        // 否则中间态会被当成"用户切了页面",把刚起来的那轮反复作废
        if (url !== seenUrl) { seenUrl = url; seenSince = now; return; }
        if (url === lastIframeUrl) return;
        if (now - seenSince < 1200) return;
        lastIframeUrl = url;
        runEpoch++;   // 旧轮手里的 iframe/DOM 已经是上一条页面了
        if (running) {
          // 用户手动切了章节/课程:老的一轮还在对着旧 iframe 干活。
          // 以前这里只更新 URL 就直接 return,等老的一轮(可能永远卡在失效播放器上)结束后,
          // 新 URL 已被"消费",再也不会触发扫描 —— 表现就是"切了页面脚本就不动了"
          pendingRun = true;
          log('🔀 检测到页面已切换,当前任务收手后按新页面重扫', 'warn');
          return;
        }
        runOnce();
      } catch (e) { /* ignore */ }
    }, 1000);
  }

  async function runOnce() {
    if (running) { pendingRun = true; return; }
    if (PAUSED) return;
    running = true;
    pendingRun = false;
    activeEpoch = ++runEpoch;
    setStatus('工作中');
    try {
      await chapterLoop();
    } catch (e) {
      if (!runAborted()) log('主循环异常: ' + e.message, 'err');
    } finally {
      running = false;
      setStatus(PAUSED ? '已暂停' : '待机');
      const again = pendingRun;
      pendingRun = false;
      if (again && !PAUSED) runOnce();
    }
  }

  // 面板点「恢复」时调用:重跑一轮(暂停时循环是中断退出的,URL 没变不会自动触发)
  function resumeWatching() {
    if (!ACTIVE_ADAPTER || ACTIVE_ADAPTER.id !== 'chaoxing') return;
    let kind = 'chapter';
    try { kind = ACTIVE_ADAPTER.pageKind ? ACTIVE_ADAPTER.pageKind() : 'chapter'; } catch (e) { /* ignore */ }
    if (kind !== 'chapter') return;
    if (running) { pendingRun = true; return; }
    // 先把"当前 URL"记为已处理,再重跑;否则下一轮扫描会把同一个 URL 当成"用户切了页面",
    // 立刻把刚起来的这轮又作废(表现为恢复后视频反复重开)
    try {
      const f = document.querySelector('#iframe');
      if (f && f.contentWindow) lastIframeUrl = f.contentWindow.location.href;
    } catch (e) { /* ignore */ }
    runOnce();
  }

  /* ==================== 适配器:学习通 ==================== */
  const CX_CHAPTER_PATHS = [
    '/mycourse/studentstudy', '/mooc-ans/mycourse/studentstudy', '/mooc2-ans/mycourse/studentstudy'
  ];
  const CX_HOMEWORK_PATHS = [
    '/work/doHomeWorkNew', '/mooc-ans/work/doHomeWorkNew', '/mooc2-ans/work/doHomeWorkNew',
    '/mooc2/work/dowork', '/mooc-ans/mooc2/work/dowork', '/mooc2-ans/mooc2/work/dowork'
  ];

  registerAdapter({
    id: 'chaoxing',
    name: '学习通',
    match() {
      const p = location.pathname;
      return CX_CHAPTER_PATHS.includes(p) || CX_HOMEWORK_PATHS.includes(p);
    },
    pageKind() {
      if (CX_HOMEWORK_PATHS.includes(location.pathname)) return 'homework';
      if (CX_CHAPTER_PATHS.includes(location.pathname)) return 'chapter';
      return 'other';
    },
    selfCheck() {
      if (this.pageKind() === 'homework') {
        const n = document.querySelectorAll('.questionLi, .TiMu').length;
        return { ok: n > 0, detail: n ? ('找到 ' + n + ' 道题目') : '未找到题目容器(.questionLi / .TiMu)' };
      }
      const marks = [
        ['#iframe', !!document.querySelector('#iframe')],
        ['.ans-job-icon', !!document.querySelector('.ans-job-icon')],
        ['.nextChapter', !!document.querySelector('.nextChapter')],
        ['mooc-ans', !!document.querySelector('mooc-ans, .knowledge-card')]
      ].filter((x) => x[1]).map((x) => x[0]);
      return {
        ok: marks.length > 0,
        detail: marks.length ? ('命中:' + marks.join('/')) : '未找到 #iframe / .ans-job-icon / .nextChapter 任一节点'
      };
    },
    snapshotHints: { jobIcon: '.ans-job-icon', quiz: '.TiMu' },
    start() {
      if (this.pageKind() === 'homework') {
        homeworkTask();
        return;
      }
      initPanel();
      if (!location.href.includes('mooc2=1')) {
        log('检测到旧版章节页,正在切换到新版(mooc2)...', 'warn');
        location.href += (location.href.includes('?') ? '&' : '?') + 'mooc2=1';
        return;
      }
      startWatch();
    }
  });
