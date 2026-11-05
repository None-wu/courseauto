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

  function extractQuizQuestion(el) {
    try {
      const text = applyDecryptText(cl(clean(pickTitleHtml(el))));
      if (!text) return null;
      const options = pickOptions(el).map(applyDecryptText);
      return { question: text, options, type: inferType(el, options) };
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
      return { question: text, options, type: inferType(el, options) };
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
      return { question: text, options: opts, type };
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
    // 每日时长上限检查
    if (CONFIG.dailyLimitMinutes > 0) {
      const st = getTodayStats();
      if (st.minutes >= CONFIG.dailyLimitMinutes) {
        dailyLimitReached = true;
        log(`⏹ 今日刷课已达上限 ${CONFIG.dailyLimitMinutes} 分钟,自动停止(明天自动恢复)`, 'warn');
        return;
      }
      log(`⏱ 今日已刷约 ${st.minutes} 分钟 / 上限 ${CONFIG.dailyLimitMinutes} 分钟`);
    }
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
    // 累加今日刷课时长(按视频实际时长折算)
    try {
      const dur = typeof player.duration === 'function' ? player.duration() : 0;
      if (dur > 0) {
        const st = getTodayStats();
        st.minutes += Math.round(dur / 60);
        saveTodayStats(st);
        log(`⏱ 今日累计刷课约 ${st.minutes} 分钟`, 'info');
      }
    } catch (e) { /* ignore */ }
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
    const accuracy = tasks.length ? okCount / tasks.length : 0;
    // 阈值按"面板上显示的百分比"比较,避免 65.9% 显示成 66% 却因实际值不足 66% 而不交的困惑
    const accPct = Math.round(accuracy * 100);
    const needPct = Math.round((CONFIG.minAccuracy || 0) * 100);
    if (CONFIG.autoSubmit && accPct >= needPct) {
      await randomSleep(CONFIG.submitDelayMin, CONFIG.submitDelayMax);
      log(`正确率 ${accPct}% ≥ 阈值 ${needPct}%,正在提交...`, 'ok');
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
      } else {
        log('未找到提交入口,请手动提交', 'warn');
      }
    } else {
      log(CONFIG.autoSubmit
        ? `正确率 ${accPct}% 低于阈值 ${needPct}%,暂存不提交(可在设置里调整阈值)`
        : `正确率 ${accPct}%,自动提交已关闭,暂存不提交`, 'warn');
      try { win.alert = () => {}; if (typeof win.noSubmit === 'function') win.noSubmit(); } catch (e) { /* ignore */ }
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

  // 切下一节:优先老版 .nextChapter,兜底新版"下一节"按钮
  function clickNextSection() {
    const next = document.querySelector('.nextChapter');
    if (next) { try { next.click(); } catch (e) { /* ignore */ } return true; }
    const nodes = Array.from(document.querySelectorAll('button, a, div, span'));
    for (const n of nodes) {
      if ((n.textContent || '').trim() === '下一节') {
        try { n.click(); } catch (e) { /* ignore */ }
        return true;
      }
    }
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
    if (CONFIG.autoJump && clickNextSection()) {
      log('→ 切换到下一节', 'ok');
    } else {
      log('未找到"下一节"按钮(可能已是最后一节)', 'warn');
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
    // 等卡片渲染完再判断结构:刚切章节时立刻数任务点容易数到 0,导致整章被跳成"新版结构"
    const cardsReady = () => {
      try {
        if (cardsWin.document.querySelector('.ans-job-icon')) return true;
        const fs = Array.from(cardsWin.document.querySelectorAll('iframe'));
        return fs.some((f) => /ananas\/modules\/|\/dowork|doHomeWorkNew/.test(String(f.src || '')));
      } catch (e) { return false; }
    };
    for (let i = 0; i < 24 && !cardsReady(); i++) await sleep(0.5);
    const icons = cardsWin.document.querySelectorAll('.ans-job-icon');
    if (!icons.length) {
      log('未找到任务点图标,尝试新版知识卡片模式处理...', 'warn');
      // 结构侦察:输出卡片 iframe 信息,帮助定位新版页面结构
      try {
        const frames = Array.from(cardsWin.document.querySelectorAll('iframe'));
        const srcs = frames.map((f) => String(f.src || f.getAttribute('data') || '').slice(0, 120));
        log('🔍 侦察:卡片 iframe 共 ' + frames.length + ' 个,src 列表: ' + JSON.stringify(srcs), 'info');
      } catch (e) {
        log('🔍 侦察失败: ' + e.message, 'err');
      }
      // 降级:按新版知识卡片模式直接处理(纯 PDF/视频/图片单模块卡片也能过)
      await newChapterLoop(cardsWin);
      return;
    }
    let finishedCount = 0;
    for (const icon of Array.from(icons)) {
      if (runAborted()) { if (PAUSED) log('⏸ 已暂停,本轮任务停止(点 ▶ 恢复)', 'warn'); return; }
      if (dailyLimitReached) { log('⏹ 今日刷课已到上限,停止任务处理', 'warn'); return; }
      const parent = icon.parentElement;
      if (parent && parent.classList.contains('ans-job-finished')) { finishedCount++; continue; }
      let iframe = parent ? parent.querySelector('iframe') : null;
      if (!iframe) {
        // 懒加载:任务点卡片有时会晚一点才插入 iframe,等 5s 再说"没有"
        for (let i = 0; i < 10 && !iframe; i++) {
          await sleep(0.5);
          iframe = parent ? parent.querySelector('iframe') : null;
        }
      }
      if (!iframe) { log('任务点无 iframe(等待 5s 仍未出现),跳过', 'warn'); continue; }
      let info = {};
      try { info = JSON.parse(iframe.getAttribute('data') || '{}'); } catch (e) { /* ignore */ }
      const name = info.name || info.title || '';
      const src = iframe.src || '';
      log(`开始任务点: ${name || src.slice(-40)}`);
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
    log(`本章扫描结束(共 ${icons.length} 个任务点)`, 'ok');
    if (runAborted()) return;
    if (CONFIG.autoJump) {
      const next = document.querySelector('.nextChapter');
      if (next) { log('→ 切换到下一章'); next.click(); }
      else log('未找到下一章按钮(可能已是最后一章)', 'warn');
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
