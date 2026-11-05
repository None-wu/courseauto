// ==UserScript==
// @name         刷课助手 · 网页AI桥
// @namespace    cx-auto-study
// @version      1.3.1
// @description  配合「刷课助手」使用:接收题目 → 自动填入网页版 AI 输入框 → 发送 → 抓取回答 → 回传。免 API Key。
// @author       courseauto contributors
// @license      MIT
// @homepageURL  https://github.com/None-wu/courseauto
// @updateURL    https://cdn.jsdelivr.net/gh/None-wu/courseauto@main/userscripts/courseauto-webai-bridge.user.js
// @downloadURL  https://cdn.jsdelivr.net/gh/None-wu/courseauto@main/userscripts/courseauto-webai-bridge.user.js
// @match        *://chat.deepseek.com/*
// @match        *://chatgpt.com/*
// @match        *://chat.openai.com/*
// @match        *://www.kimi.com/*
// @match        *://kimi.moonshot.cn/*
// @match        *://www.doubao.com/*
// @match        *://yuanbao.tencent.com/*
// @match        *://tongyi.aliyun.com/*
// @match        *://chat.qwen.ai/*
// @match        *://chatglm.cn/*
// @match        *://www.chatglm.cn/*
// @match        *://127.0.0.1/*
// @match        *://localhost/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// ==/UserScript==
//
// ⚠️ 说明
// 1. 必须与「刷课助手」同时启用,并在本页面保持登录。
// 2. 同源策略下主页面读不到本页 DOM,一切都走 postMessage,所以两边缺一不可。
// 3. 各 AI 站点改版会导致选择器失效,失效表现是"答不上来",不会乱填。

(function () {
  'use strict';

  // 桥版本:随每次轮询上报本地服务(服务端 /api/webai/status 可远程确认元宝页跑的是哪版桥)
  const BRIDGE_VER = (function () {
    try { return (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || 'unknown'; }
    catch (e) { return 'unknown'; }
  })();

  /* ==================== 站点适配配置 ==================== */
  // 输入框候选:textarea / 可编辑区(ProseMirror、Lexical 等富文本输入都落在这里)
  const INPUT_SELECTORS = [
    'textarea',
    '.ql-editor',                       // Quill(腾讯元宝/通义等常见)
    '.ProseMirror',
    '[contenteditable="true"]',
    'div[role="textbox"]'
  ];
  // AI 回复容器候选(取最后一个)
  const REPLY_SELECTORS = [
    '[data-message-author-role="assistant"]',   // ChatGPT
    '[data-testid="receive_message"]',          // 豆包
    '[data-testid="assistant_message"]',
    '.ds-markdown',                             // DeepSeek
    '.markdown-body',                           // Kimi 等通用 markdown 容器
    '.chat-content-item-assistant',
    '[class*="assistant"] [class*="markdown"]',
    '[class*="message"] [class*="markdown"]'
  ];
  const SEND_TEXT = /发送|send|submit|提交|问一问/i;
  // 元宝等站会把 UI 按钮文字(展开/复制/重新生成...)混进消息流,不能当回复
  const JUNK_REPLY = /^(展开|收起|复制|重新生成|重新回答|停止|继续|点赞|点踩|分享|朗读|编辑|删除|已处理|已停止生成|思考中|正在思考|生成中|点击全选以下消息)$/;
  const REPLY_STABLE_MS = 1500;   // 回复文本稳定这么久才算说完
  const REPLY_TIMEOUT_MS = 90000; // 单题默认等待上限(整卷会按题目数放大,见 waitForAnswer)

  /* ==================== 节流免疫时钟 ====================
   * Edge/Chrome 对后台标签页的 setTimeout/setInterval 强节流:页面退后台几分钟后,
   * 定时器被压到约 1 次/分钟 —— 桥的 2s 心跳断档 → 中转判离线 → 答题被"桥不在线"
   * 快速失败;waitForAnswer 的 0.4s 采样同样断档 → 等不到回复就超时。
   * 这就是"一开始能答,刷课久了再答题就不行"的根因。
   * 专用 Worker 里的定时器不受该节流(Worker 没有"后台"概念),用它发 tick
   * 驱动桥内所有等待;Worker 建不出来(个别站 CSP 限制)则退回原生定时器。 */
  const TICK_MS = 400;
  const ticker = (function () {
    try {
      const src = 'setInterval(function(){postMessage(1)},' + TICK_MS + ');';
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      const w = new Worker(url);
      URL.revokeObjectURL(url);
      return w;
    } catch (e) { return null; }
  })();
  const sleep = (ms) => {
    if (!ticker) return new Promise((r) => setTimeout(r, ms));
    const ticks = Math.max(1, Math.round(ms / TICK_MS));
    return new Promise((resolve) => {
      let left = ticks;
      const on = () => { if (--left <= 0) { ticker.removeEventListener('message', on); resolve(); } };
      ticker.addEventListener('message', on);
    });
  };
  // 调试输出:只在页面里设了 window.__cxBridgeDebug = true 时打印(排查"抓不到回复"用)
  const dbg = function () {
    try { if (window.__cxBridgeDebug) console.log.apply(console, ['[bridge]'].concat(Array.prototype.slice.call(arguments))); } catch (e) { /* ignore */ }
  };

  // 访问本地中转服务统一走 xfetch:
  // 优先 GM_xmlhttpRequest(油猴特权请求,不受页面 CSP 限制 —— DeepSeek/ChatGPT 等严格 CSP
  // 站点会把页内 fetch 到 http://127.0.0.1:8790 全部拦掉,桥会"静默死亡");没有油猴特权再退 fetch
  function xfetch(url, opts) {
    opts = opts || {};
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: opts.method || 'GET',
          url,
          data: opts.body != null ? opts.body : null,
          headers: opts.headers || {},
          timeout: 15000,
          onload: (r) => resolve({
            ok: r.status >= 200 && r.status < 300,
            status: r.status,
            text: () => Promise.resolve(r.responseText),
            json: () => Promise.resolve(JSON.parse(r.responseText))
          }),
          onerror: () => reject(new Error('GM_xhr network error')),
          ontimeout: () => reject(new Error('GM_xhr timeout'))
        });
      });
    }
    return fetch(url, opts);
  }

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function findInput() {
    // 两轮查找:先找可见的;全不可见(窗口最小化时 rect 全为 0)退而求其次取任意匹配
    for (const strictVis of [true, false]) {
      for (const sel of INPUT_SELECTORS) {
        const list = Array.from(document.querySelectorAll(sel)).filter((el) => !strictVis || visible(el));
        if (list.length) {
          // 取面积最大的那个,避免命中隐藏的搜索框(不可见时取第一个)
          if (!strictVis) return list[0];
          return list.sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return rb.width * rb.height - ra.width * ra.height;
          })[0];
        }
      }
    }
    return null;
  }

  function findSendButton(input) {
    const scopes = [];
    if (input) {
      scopes.push(input.closest('form'));
      scopes.push(input.parentElement);
      scopes.push(input.parentElement && input.parentElement.parentElement);
    }
    const labelOf = (b) => (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '') + ' ' + (b.textContent || '');
    for (const scope of scopes) {
      if (!scope) continue;
      for (const b of scope.querySelectorAll('button, [role="button"]')) {
        if (SEND_TEXT.test(labelOf(b)) && visible(b) && !b.disabled) return b;
      }
    }
    for (const b of document.querySelectorAll('button, [role="button"]')) {
      if (SEND_TEXT.test(labelOf(b)) && visible(b) && !b.disabled) return b;
    }
    // 兜底:有些站发送按钮是 class/id 带 send 的 div/icon(没有"发送"字样)
    for (const el of document.querySelectorAll('[class*="send" i], [id*="send" i]')) {
      if ((el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || el.tagName === 'DIV' || el.tagName === 'SPAN') &&
          visible(el) && !el.disabled && el.querySelectorAll('button').length === 0) return el;
    }
    return null;
  }

  // 输入条里的"疑似发送控件"候选(DeepSeek 等站的发送按钮是纯图标,类名是哈希值,
  // 没有任何 send/发送 字样可循)。策略:输入的父容器链里找含 svg 的小尺寸可点击元素,
  // 排除附件/语音/搜索类,取最靠右的(发送键通常在输入条右端);配合发送校验逐个试
  // 控件是否不可点(禁用态):框架在输入框为空时常把发送键置灰,
  // 点它等于没点 —— 必须先跳过,否则"已试候选=1个"却毫无效果
  function isDisabledEl(el) {
    if (!el) return true;
    if (el.disabled === true) return true;
    if (String(el.getAttribute('aria-disabled') || '') === 'true') return true;
    return /(^|[\s_-])disabled([\s_-]|$)/i.test(String(el.className || ''));
  }

  function sendCandidates(input) {
    const SKIP = /(附件|上传|文件|语音|麦克风|拍照|图片|摄像|attach|upload|file|mic|voice|image|photo|camera|插件|联网|搜索|search|深度思考|思考)/i;
    const out = [];
    const seen = new Set();
    const push = (el) => { if (el && !seen.has(el) && visible(el) && !isDisabledEl(el)) { seen.add(el); out.push(el); } };
    const btn = findSendButton(input);
    if (btn) push(btn);
    // 权重高的排前面:primary/filled/circle/send 这类类名基本就是主操作键(发送键都是主色圆钮);
    // DeepSeek 新输入条没有 aria/title,只能靠类名 + 位置(最靠右)两个信号
    const hint = (el) => /(primary|filled|circle|send|submit)/i.test(String(el.className || '')) ? 1 : 0;
    let p = input;
    for (let i = 0; i < 5 && p; i++) {
      p = p.parentElement;
      if (!p) break;
      const cands = Array.from(p.querySelectorAll('button, [role="button"], div, span')).filter((el) => {
        if (el.querySelector('button') || seen.has(el)) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 20 || r.width > 90 || r.height < 20 || r.height > 90) return false;
        const label = (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '');
        if (SKIP.test(label) || SKIP.test(String(el.className || ''))) return false;
        if (isDisabledEl(el)) return false;   // 置灰的发送键点了没用
        return !!el.querySelector('svg') || el.tagName === 'BUTTON';
      });
      if (cands.length) {
        cands.sort((a, b) => hint(b) - hint(a) || b.getBoundingClientRect().right - a.getBoundingClientRect().right);
        cands.slice(0, 3).forEach(push);   // 一个不准就试下一个
        break;   // 只取最近一层容器,越往上越容易误伤
      }
    }
    return out;
  }

  // 受控组件(值存在框架自己的 state 里)只改 DOM 的 value 不会更新框架状态:
  // 发送键一直 disabled、回车也被忽略 —— 表现是"题目填进去了却发不出去"
  // (DeepSeek 新输入条正是这种:textarea + 圆形图标发送键,aria/title 全空)。
  // execCommand('insertText') 走浏览器编辑管线,事件是可信的,框架能收到并更新状态。
  function fillByExecCommand(input, text) {
    try {
      input.focus();
      if (typeof input.select === 'function') input.select();
      else {
        const range = document.createRange();
        range.selectNodeContents(input);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      return document.execCommand('insertText', false, text);
    } catch (e) { return false; }
  }

  function fillInput(input, text) {
    input.focus();
    const tag = (input.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'input') {
      // ① 优先走编辑管线(受控组件唯一可靠的路);② 失败再退原生 setter(非受控/execCommand 被禁)
      const viaCmd = fillByExecCommand(input, text) && !!String(input.value || '').trim();
      if (!viaCmd) {
        const proto = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      input.dispatchEvent(new Event('change', { bubbles: true }));
      // 个别框架只监听 beforeinput:补一发(不能取消,只是通知)
      try { input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: false, data: text, inputType: 'insertText' })); } catch (e) { /* ignore */ }
      return !!String(input.value || '').trim();
    }
    // 富文本编辑器(Quill/ProseMirror/元宝等):
    // 先全选清空,再模拟「粘贴」事件 —— 编辑器对 paste 的多行支持最稳,
    // execCommand('insertText') 在部分站点只插入第一行,题干选项会丢
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('delete', false, null);
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      input.dispatchEvent(ev);
    } catch (e) { /* 粘贴失败走下面的兜底 */ }
    if (!String(input.innerText || '').trim()) {
      try { document.execCommand('insertText', false, text); } catch (e) { /* ignore */ }
    }
    if (!String(input.innerText || '').trim()) {
      input.textContent = text;
    }
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    return !!String(input.innerText || '').trim();
  }

  function pressEnter(input) {
    const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    input.dispatchEvent(new KeyboardEvent('keydown', opts));
    input.dispatchEvent(new KeyboardEvent('keypress', opts));
    input.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  function replyNodes() {
    for (const sel of REPLY_SELECTORS) {
      const list = Array.from(document.querySelectorAll(sel));
      if (list.length) return list;
    }
    return [];
  }

  // 免选择器的回复识别:找"消息列表容器"(对类名依赖极低,元宝 .agent-chat__list、
  // 各站的 chat-list / message-list / conversation 容器都能命中)
  function findChatContainer() {
    const cands = Array.from(document.querySelectorAll('div')).filter((el) => {
      const cls = String(el.className || '');
      return /agent-chat__list|chat[-_]?(list|messages?|history|scroll|container|content|window|area|session|box|main|body|view)?($|[\s_-])|messages?[-_]?(list|container|history|scroll|wrap)|conversation(list|container|content|wrap)?|session[-_]?(list|container)|history[-_]?list/i.test(cls);
    });
    if (!cands.length) {
      // 类名完全不合套路(例如只有一个 class="chat"):退化为整页文本,
      // 靠"题目末尾 40 字"锚点定位回复,总比抓不到强
      return document.body || null;
    }
    // 取文本最长的(真正装着全部对话的那个,而不是内层小指示器);新会话时可能都是空文本,没关系
    return cands.sort((a, b) => String(b.innerText || '').length - String(a.innerText || '').length)[0];
  }

  /* ==================== 页面结构回传(适配失效时自动采集) ==================== */
  // 找不到输入框/回复区时,把页面上可编辑元素与按钮的概况 POST 给本地服务,
  // 落盘到 extras/probe/,据此给该站点写精准选择器
  async function probeReport(reason) {
    try {
      const relay = (function () { try { return localStorage.getItem('cxRelay') || 'http://127.0.0.1:8790'; } catch (e) { return 'http://127.0.0.1:8790'; } })();
      const describe = (el) => ({
        tag: el.tagName, id: el.id || '', cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').slice(0, 120),
        editable: el.isContentEditable || el.getAttribute('contenteditable') === 'true',
        role: el.getAttribute('role') || '', aria: el.getAttribute('aria-label') || '', text: String(el.textContent || '').trim().slice(0, 30)
      });
      const inputs = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], .ql-editor, .ProseMirror, div[role="textbox"]')).slice(0, 8).map(describe);
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).filter((b) => /发送|send|提交/i.test((b.getAttribute('aria-label') || '') + (b.textContent || ''))).slice(0, 8).map(describe);
      const iframes = Array.from(document.querySelectorAll('iframe')).slice(0, 5).map((f) => ({ src: String(f.src || '').slice(0, 120), cls: String(f.className || '').slice(0, 80) }));
      // 输入条控件清单:发送失败时看这里有什么可点的(含 svg 图标控件)
      const sendBar = (function () {
        try {
          const inp = document.querySelector('textarea, [contenteditable="true"], .ql-editor, .ProseMirror');
          let p = inp; const scopes = [];
          for (let i = 0; i < 4 && p; i++) { p = p.parentElement; if (p) scopes.push(p); }
          const seen = new Set(); const out = [];
          for (const sc of scopes) {
            for (const el of sc.querySelectorAll('button, [role="button"], div, span')) {
              if (seen.has(el) || el.querySelector('button')) continue;
              const r = el.getBoundingClientRect();
              if (r.width < 15 || r.width > 100 || r.height < 15 || r.height > 100) continue;
              if (!el.querySelector('svg') && el.tagName !== 'BUTTON' && el.getAttribute('role') !== 'button') continue;
              seen.add(el);
              out.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 80), aria: el.getAttribute('aria-label') || '', title: el.getAttribute('title') || '', svg: !!el.querySelector('svg'), dis: isDisabledEl(el) });
              if (out.length >= 10) return out;
            }
          }
          return out;
        } catch (e) { return []; }
      })();
      // 疑似消息/回复容器:类名含聊天语义词的元素,带文本量(回复气泡一般文本较长)
      const replyArea = Array.from(document.querySelectorAll('div, section, article'))
        .filter((el) => /(chat|msg|message|bubble|markdown|reply|answer|session|conversation|dialog|content)/i.test(String(el.className || '')))
        .slice(0, 40)
        .map((el) => ({
          tag: el.tagName,
          cls: String(el.className || '').slice(0, 100),
          textLen: String(el.textContent || '').length,
          sample: String(el.textContent || '').trim().slice(0, 40)
        }));
      await xfetch(relay + '/api/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: location.host, path: location.pathname, reason, href: location.href, inputs, buttons, iframes, replyArea, sendBar })
      });
    } catch (e) { /* 本地服务不在线则跳过 */ }
  }

  // 等一条新回复出现,并等到它的文本不再变化
  // 生成中判定:生成时发送按钮会变成"停止"(元宝/豆包/Kimi/DeepSeek/ChatGPT 通用)。
  // 中英文 label 全覆盖 + data-testid/aria 兜底,避免把思考过程当成最终回复
  function isGenerating() {
    // 显式选择器兜底(ChatGPT 的 stop-button、各站 aria-label 停止/stop)
    const stopEls = document.querySelectorAll('[data-testid="stop-button"], [aria-label*="停止"], [aria-label*="stop" i]');
    for (const el of stopEls) {
      if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') { if (visible(el)) return true; }
    }
    for (const b of document.querySelectorAll('button, [role="button"]')) {
      if (!visible(b)) continue;
      const label = ((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '') + ' ' + (b.textContent || '')).replace(/\s+/g, '');
      if (/^(停止生成|停止回答|停止输出|停止|stopgenerating|stopstreaming|stop|■|◼|⏹)$/i.test(label)) return true;
    }
    return false;
  }

  // 长消息(整卷 30 行回复)会被元宝折叠成"展开"按钮,不点开 innerText 里根本没有全文。
  // 抓取前自动把折叠消息展开(限频:最多 1.5s 点一次,展开后按钮变"收起"不会重复点)
  let lastExpandAt = 0;
  function expandCollapsed(scope) {
    const now = Date.now();
    if (now - lastExpandAt < 1500) return;
    const root = scope || document;
    const cands = Array.from(root.querySelectorAll('button, [role="button"], div, span')).filter((el) =>
      el.childElementCount === 0 && /^(展开|显示更多|查看更多|more)$/i.test(String(el.textContent || '').trim())
    );
    if (cands.length) {
      lastExpandAt = now;
      try { cands[cands.length - 1].click(); } catch (e) { /* ignore */ }
    }
  }

  // 剥掉回复前缀里混入的 UI 标签(展开/已处理/复制...),剩下的才是真正的回复内容
  function stripUITokens(text) {
    let t = String(text || '').trim();
    let prev;
    do {
      prev = t;
      t = t.replace(/^(展开|收起|已处理|复制|重新生成|重新回答|停止|继续|点赞|点踩|分享|朗读|编辑|删除)\s*/, '').trim();
    } while (t !== prev);
    // 操作栏图标行(复制/点赞/点踩/朗读/重新生成按钮)常以纯符号行混在回复里;
    // 页面兜底抓取时还会把输入条按钮、桥角标等文字一起带进来 —— 逐行剔掉这些 UI 噪音,
    // 否则文本每轮都在"变"(按钮/角标状态),稳定判定永远不成立 → 一直抓不到答案
    const UI_LINE = /^(发送|停止|停止生成|桥\s*\S*|新对话|新聊天|新建对话|登录|注册|设置|帮助|展开|收起|复制|重新生成|重新回答|继续|点赞|点踩|分享|朗读|编辑|删除|已处理|已停止生成|思考中|正在思考|生成中|回到顶部|向下滚动|点击全选以下消息)$/;
    t = t.split('\n')
      .filter((line) => {
        const s = line.trim();
        return s && /[\p{L}\p{N}]/u.test(s) && !UI_LINE.test(s);
      })
      .join('\n').trim();
    return t;
  }

  // 归一化:压掉多余空白但【保留换行】—— 整卷回复是"1.A\n2.C\n..."逐行格式,
  // 以前 \s+→' ' 会把 30 行压成一行,主脚本按行解析就只剩第一个答案
  const normNL = (s) => String(s || '').replace(/[\t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

  // 回答完成信号:AI 回复下方出现操作栏(复制/点赞/点踩/朗读/分享/重新生成 等图标)。
  // ⚠ 只在「最后几条消息块」里找 —— 全页扫描会把输入条那排图标(附件/联网/发送)、
  // 以及历史回复的操作栏也算进来,导致流式输出中途就误判"已答完"
  const TOOLBAR_WORDS = /(复制|拷贝|copy|点赞|点踩|喜欢|like|dislike|thumb|朗读|read.?aloud|分享|share|转发|重新生成|重新回答|regenerate|retry)/i;
  function looksLikeToolbarRow(row) {
    const kids = Array.from(row.children || []);
    if (kids.length < 3 || kids.length > 12) return false;
    if (row.querySelector('textarea, [contenteditable="true"]')) return false;   // 输入条不是操作栏
    let icon = 0;
    for (const k of kids) {
      const r = k.getBoundingClientRect();
      if (r.width >= 16 && r.width <= 60 && r.height >= 16 && r.height <= 60 &&
          (k.querySelector('svg') || k.tagName === 'BUTTON' || k.getAttribute('role') === 'button')) icon++;
    }
    return icon === kids.length;
  }
  function actionToolbarSeen(container) {
    const box = container || findChatContainer();
    if (!box) return false;
    // 只看最后 3 个消息块(当前这轮回复及其操作栏都在里面)
    const blocks = Array.from(box.children).slice(-3);
    for (const blk of blocks) {
      if (looksLikeToolbarRow(blk)) return true;
      for (const row of blk.querySelectorAll('div')) if (looksLikeToolbarRow(row)) return true;
      for (const btn of blk.querySelectorAll('button, [role="button"]')) {
        if (!visible(btn)) continue;
        const label = (btn.getAttribute('aria-label') || '') + ' ' + (btn.getAttribute('title') || '');
        if (TOOLBAR_WORDS.test(label)) return true;
      }
    }
    return false;
  }

  async function waitForAnswer(baselineCount, diffCtx) {
    const start = Date.now();
    // 等待上限:整卷(expect=题数)由主脚本传入 timeout,按题数放大 —— 30 题默认 12 分钟。
    // 之前固定 90s 是"没答完就逐题补问"的主因:AI 还在答,桥已经放弃并把半截答案回传了
    const expectEarly = diffCtx && Number(diffCtx.expect) > 1 ? Number(diffCtx.expect) : 0;
    const wantTimeout = Number(diffCtx && diffCtx.timeout) || 0;
    const REPLY_LIMIT = Math.max(
      REPLY_TIMEOUT_MS,
      Math.min(15 * 60 * 1000, wantTimeout || (expectEarly ? Math.max(5 * 60 * 1000, expectEarly * 25 * 1000) : 0))
    );
    let lastText = '';
    let dbgTick = 0;
    let stableSince = 0;
    let confirmedText = '';
    let confirmedSince = 0;
    // 文本增量识别的锚点:题目末尾 40 字。双路径:
    // ① 保留换行匹配(整卷"1.A\n2.C"回复能保住行结构);② 匹配不上再压平匹配
    // (有的编辑器/气泡不保留换行,题目进聊天区会被渲染成一行)。
    const tailNL = diffCtx && diffCtx.question ? normNL(diffCtx.question).slice(-40) : '';
    const tailFlat = diffCtx && diffCtx.question ? String(diffCtx.question).replace(/\s+/g, ' ').trim().slice(-40) : '';
    // 题目回显判定:有些站(豆包/ChatGPT 等)用户消息与回复用同一套气泡类名,
    // 刚发出的题目会作为"最后一个气泡"出现 —— 开头 20 字与题目相同、且长度仍接近题目
    // 本身的(还没生成出答案)一律不算答案;AI 先复述题目再答的长回复不受影响
    const qHead = diffCtx && diffCtx.question ? String(diffCtx.question).replace(/\s+/g, '').slice(0, 20) : '';
    const qLen = diffCtx && diffCtx.question ? String(diffCtx.question).replace(/\s+/g, '').length : 0;
    // 整卷模式硬门槛:主脚本带 expect=题目数,回复里必须出现"最后一题的题号"(如 30.)才算答完。
    // 防止流式输出中途(只答到一半)被当成完整回复收走——那正是"没答完就开始逐题补问"的原因
    const expect = expectEarly;
    const expectRe = expect ? new RegExp('(?:^|[\\s\\n])' + expect + '\\s*[\\.、:：)\\]]') : null;
    // 回复里出现过的最大题号:AI 偶尔漏最后一两题时,用它做容差(不因为差一题死等十几分钟)
    const maxIdxIn = (t) => {
      let mx = 0;
      const re = /(?:^|[\s\n])(\d{1,3})\s*[\.、:：)\]]/g;
      let mm;
      while ((mm = re.exec(t)) !== null) {
        const v = parseInt(mm[1], 10);
        if (v > mx && v <= expect + 5) mx = v;
      }
      return mx;
    };
    // 统一的"够格当最终答案"判定:非噪音 + 稳定 + 不在生成中 + 二次确认。
    // toolbar=回复下方操作栏已出现(明确答完):稳定 800ms + 确认 1s 即收货;
    // 没有操作栏:沿用保守的 1.5s 稳定 + 2s 确认
    const tryAccept = (text, toolbar) => {
      text = stripUITokens(text);
      if (!text || JUNK_REPLY.test(text.replace(/\s+/g, ''))) return false;
      if (qHead) {
        const norm = text.replace(/\s+/g, '');
        if (norm.slice(0, qHead.length) === qHead && norm.length <= qLen + 30) return false;
      }
      if (text !== lastText) { dbg('新文本', text.length, JSON.stringify(text.slice(0, 50))); lastText = text; stableSince = Date.now(); confirmedText = ''; return false; }
      if (isGenerating()) { stableSince = Date.now(); confirmedText = ''; return false; }
      const stableFor = Date.now() - stableSince;
      if (expectRe && !expectRe.test(text)) {
        // 还没出现最后一题题号:只有"确实已经说完"的情形才放行,其余一律继续等
        // (流式输出中途停顿 6 秒、30 秒都很常见,以前 6 秒就收货是被提前截断的直接原因)
        // 题号覆盖:题量小(如 3 题)必须真出现最后一题;题量大时允许 AI 漏最后一道
        const covered = expect >= 8 && maxIdxIn(text) >= expect - 1;
        const longIdle = stableFor >= 120000;                 // 两分钟毫无变化:AI 真的不按题号格式答
        const toolbarIdle = toolbar && stableFor >= 15000;    // 操作栏出现且文本又稳了 15 秒
        const shortIdle = text.length < 200 && stableFor >= 20000; // 短回复(不是整卷格式)稳 20s 就收
        if (!covered && !longIdle && !toolbarIdle && !shortIdle) return false;
      }
      if (stableFor < (toolbar ? 800 : REPLY_STABLE_MS)) return false;
      if (confirmedText !== text) { confirmedText = text; confirmedSince = Date.now(); return false; }
      return Date.now() - confirmedSince >= (toolbar ? 1000 : 2000);
    };
    while (Date.now() - start < REPLY_LIMIT) {
      // 长消息被折叠时先点开"展开",否则整卷回复在 innerText 里是残缺的
      expandCollapsed(diffCtx && diffCtx.container);
      const toolbar = actionToolbarSeen(diffCtx && diffCtx.container);   // 最后一条回复下方的复制/点赞/分享图标栏 = 已答完信号
      // 路径一:已知回复选择器出现新节点(mock 页/常见 AI 站)
      const nodes = replyNodes();
      const nodeRep = nodes.length > baselineCount ? String(nodes[nodes.length - 1].innerText || '').trim() : '';
      if (nodeRep && tryAccept(nodeRep, toolbar)) return lastText;
      // 路径二:不认类名,直接看聊天容器里"题目之后新增的稳定文本"(元宝等私有结构通用)。
      // 注意:只有路径一没拿到明确回复时才用 —— 两路同时喂同一个"稳定"计时器,
      // 由于两边文本形态不同(一个保换行、一个压平且夹着页面 UI 字),会互相重置,永远判不出说完
      if (!nodeRep && diffCtx && (tailNL || tailFlat)) {
        if (!diffCtx.container) diffCtx.container = findChatContainer();   // 开题时聊天区可能为空,每轮重找
        const box = diffCtx.container;
        if (box) {
          let rep = '';
          const norm = normNL(box.innerText);
          const idxNL = tailNL ? norm.lastIndexOf(tailNL) : -1;
          if (idxNL >= 0) {
            rep = norm.slice(idxNL + tailNL.length);
          } else if (tailFlat) {
            const flat = String(box.innerText || '').replace(/\s+/g, ' ');
            const idxFlat = flat.lastIndexOf(tailFlat);
            if (idxFlat >= 0) rep = flat.slice(idxFlat + tailFlat.length);
          }
          if (dbgTick++ % 10 === 0) dbg('rep', JSON.stringify(String(rep).slice(-60)), 'idxNL', idxNL, 'toolbar', toolbar, 'container', (box.className || box.tagName || '').toString().slice(0, 40), 'gen', isGenerating());
          if (rep && tryAccept(rep, toolbar)) return lastText;
        } else if (dbgTick++ % 10 === 0) {
          dbg('没有聊天容器(tail 也无法定位),页面文本长度', String(document.body && document.body.innerText || '').length);
        }
      }
      await sleep(400);
    }
    if (!lastText) probeReport('回复未捕获(' + Math.round(REPLY_LIMIT / 1000) + 's内没有新回复气泡,回复区选择器需适配)');
    return lastText;   // 超时也把已有内容返回,判空交给主脚本
  }

  async function handleAsk(msg) {
    // SPA 页面可能还没挂载完输入框:最多等 8s 再报"没找到"
    let input = null;
    for (let i = 0; i < 20 && !(input = findInput()); i++) await sleep(400);
    if (!input) { probeReport('没找到输入框(8s 内页面无 textarea/contenteditable)'); throw new Error('没找到输入框(页面结构变了?请先手动点一下输入框)'); }

    const baseline = replyNodes().length;
    const chatBox = findChatContainer();
    fillInput(input, msg.text);
    await sleep(120);
    const filled = String(input.value || input.innerText || '').trim();
    if (!filled) throw new Error('题目没能填进输入框');
    // 多行文本被编辑器截断的静默失败(如只插入了第一行):检测长度,回传结构供适配
    if (msg.text.length > 60 && filled.length < msg.text.length * 0.6) {
      probeReport('填入不完整:期望 ' + msg.text.length + ' 字符,实际 ' + filled.length + ',输入框=' + (input.id || input.className || input.tagName));
      throw new Error('题目只填进去一部分(编辑器兼容问题,页面结构已回传)');
    }

    // 发送键可能因框架状态更新有延迟(填完字才 enable):等到出现可用候选为止,最多 2.5s
    let cands = sendCandidates(input);
    for (let i = 0; i < 12 && !cands.length; i++) { await sleep(200); cands = sendCandidates(input); }

    // 发送校验:发出后编辑器会被清空(如元宝的 ql-blank),或题目出现在聊天容器里。
    // 发送失败是"AI 一直不回复"的隐形原因(按钮没点中/回车被编辑器吞了),必须显式验证。
    const editorNowEmpty = () => !(String(input.value || '') + String(input.innerText || '')).trim();
    const checkSent = async () => {
      await sleep(1000);
      if (editorNowEmpty()) return true;
      const box = findChatContainer();
      if (box) {
        const tail = String(msg.text).replace(/\s+/g, ' ').trim().slice(-40);
        return String(box.innerText || '').replace(/\s+/g, ' ').includes(tail);
      }
      return false;
    };
    // 点击一个控件:先补 pointer/mouse 序列(有些框架只监听 pointerdown),
    // 再走原生 click —— 只 dispatch click 时部分新式 UI 完全无反应
    const clickEl = (c) => {
      try {
        const r = c.getBoundingClientRect();
        const o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
        if (typeof PointerEvent === 'function') {
          c.dispatchEvent(new PointerEvent('pointerdown', o));
          c.dispatchEvent(new PointerEvent('pointerup', o));
        }
        c.dispatchEvent(new MouseEvent('mousedown', o));
        c.dispatchEvent(new MouseEvent('mouseup', o));
      } catch (e) { /* 老浏览器忽略 */ }
      try { c.click(); } catch (e) { /* ignore */ }
    };
    // 逐个试候选控件(语义按钮 → 输入条右端的图标控件),每次点完都校验,谁有效用谁;
    // 全失败最后试回车。DeepSeek 的图标发送键没有"发送"字样,就靠这条兜底
    let sentBy = '未找到候选';
    let sent = false;
    for (const c of cands) {
      clickEl(c);
      sentBy = (c.getAttribute('aria-label') || c.getAttribute('title') || c.className || c.tagName).toString().slice(0, 60);
      if (await checkSent()) { sent = true; break; }
    }
    if (!sent) {
      try { input.focus(); } catch (e) { /* ignore */ }
      pressEnter(input);
      sentBy = '回车';
      sent = await checkSent();
    }
    // 仍发不出去:多半是填充没进框架的 state(发送键虽可点但拿到的仍是空值)。
    // 用"逐字符"再喂一遍(有些编辑器只认逐字输入),然后重试一次候选。
    if (!sent) {
      try {
        input.focus();
        if (typeof input.select === 'function') input.select();
        for (const ch of String(msg.text)) {
          input.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }));
          document.execCommand('insertText', false, ch);
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (e) { /* ignore */ }
      await sleep(400);
      const retry = sendCandidates(input);
      for (const c of retry) {
        clickEl(c);
        sentBy = '逐字重填+' + (c.getAttribute('aria-label') || c.className || c.tagName).toString().slice(0, 40);
        if (await checkSent()) { sent = true; break; }
      }
      if (!sent) {
        try { input.focus(); } catch (e) { /* ignore */ }
        pressEnter(input);
        sentBy = '逐字重填+回车';
        sent = await checkSent();
      }
    }
    if (!sent) {
      probeReport('发送失败:消息留在输入框里(已试候选=' + cands.length + '个,最后=' + sentBy + ')');
      throw new Error('消息没能发出去(候选控件与回车都无效,页面结构已回传)');
    }

    await sleep(600);
    return waitForAnswer(baseline, { container: chatBox, question: msg.text, expect: msg.expect, timeout: msg.timeout });
  }

  // 回程双保险:postMessage 来的题,答案也同步写进本地中转一份。
  // postMessage 回程可能丢(窗口刷新/跨域异常),主脚本超时前会从中转兜回。
  async function storeRelayAnswer(cxId, text, error) {
    try {
      await xfetch(RELAY + '/api/webai/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cxId, text, error, site: location.host, ver: BRIDGE_VER })
      });
    } catch (e) { /* 中转不在线,忽略 */ }
  }

  /* ==================== 消息通道 ==================== */
  window.addEventListener('message', async (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object' || d.cxType !== 'CX_ASK') return;

    const reply = (payload) => {
      try { e.source.postMessage(Object.assign({ cxType: 'CX_ANSWER', cxId: d.cxId }, payload), e.origin || '*'); }
      catch (err) { /* ignore */ }
    };

    try {
      const text = await handleAsk(d);
      reply({ text });
      storeRelayAnswer(d.cxId, text, '');
    } catch (err) {
      probeReport('postMessage通道: ' + String(err && err.message || err));
      reply({ text: '', error: String(err && err.message || err) });
      storeRelayAnswer(d.cxId, '', String(err && err.message || err));
    }
  });

  // 告诉主页面"桥已就绪"(也用于主页面刷新后重新挂接)
  function announce() {
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ cxType: 'CX_HELLO', href: location.href }, '*');
      }
    } catch (e) { /* 跨域时静默 */ }
  }

  /* ==================== 本地中转通道 ==================== */
  // 主页面刷新/弹窗拦截都会打断 postMessage;经本地服务中转则不依赖任何窗口关系:
  // 桥脚本每 2 秒问一次"有没有题",有就答,答完回传。用户手动打开本页即可。
  const RELAY = (function () {
    try { return localStorage.getItem('cxRelay') || 'http://127.0.0.1:8790'; } catch (e) { return 'http://127.0.0.1:8790'; }
  })().replace(/\/$/, '');

  let relayBusy = false;
  async function relayLoop() {
    if (relayBusy) return;
    relayBusy = true;
    try {
      // 本页有没有可用输入框:没有(安装引导页/首页/还没挂载)也照常轮询上报"在线",
      // 但带 cap=0,服务端就不会把题派给这种页面 —— 派了也答不了,题目白丢,
      // 主脚本只能干等到超时再逐题重问("没答完就一个一个发"的隐蔽原因之一)
      const cap = !!findInput();
      const r = await xfetch(RELAY + '/api/webai/next?site=' + encodeURIComponent(location.host) + '&v=' + encodeURIComponent(BRIDGE_VER) + '&cap=' + (cap ? 1 : 0) + '&tick=' + (ticker ? 1 : 0), { method: 'GET' });
      const o = await r.json();
      // 角标变绿:本站桥已成功连上中转服务
      try { if (window.__cxBridgeBadge) window.__cxBridgeBadge.style.background = 'rgba(40,150,80,.85)'; } catch (e) {}
      if (o && o.item && o.item.cxId) {
        const item = o.item;
        try {
          const text = await handleAsk({ text: item.text, expect: item.expect, timeout: item.timeout });
          await xfetch(RELAY + '/api/webai/answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cxId: item.cxId, text, site: location.host, ver: BRIDGE_VER })
          });
        } catch (err) {
          const emsg = String(err && err.message || err);
          // "本页答不了"类错误(输入框没了/发不出去):把题退回队列,让真正开着的 AI 页接手。
          // 直接回传 error 会让主脚本以为 AI 没答案,立刻转去逐题询问。
          let requeued = false;
          if (/没找到输入框|没能发出去|只填进去一部分|消息没能发出去/.test(emsg)) {
            try {
              const rr = await xfetch(RELAY + '/api/webai/requeue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ item })
              });
              const oo = await rr.json();
              requeued = !!(oo && oo.ok);
            } catch (e) { /* 退不回去就按失败处理 */ }
          }
          if (!requeued) {
            await probeReport('中转通道: ' + emsg);
            await xfetch(RELAY + '/api/webai/answer', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cxId: item.cxId, text: '', error: emsg, site: location.host, ver: BRIDGE_VER })
            });
          }
        }
      }
    } catch (e) { /* 本地服务不在线,静默等下一轮 */ }
    relayBusy = false;
  }
  // 心跳/派题循环改由 tick 驱动:顺序执行不重叠,后台也不停摆
  (async function relayDriver() {
    for (;;) {
      try { await relayLoop(); } catch (e) { /* 下一轮再试 */ }
      await sleep(2000);
    }
  })();

  announce();
  window.addEventListener('load', announce);
  window.addEventListener('focus', announce);
  // 主页面刷新后 opener 引用可能重建,周期性重新通告(同样走节流免疫时钟)
  (async function announceDriver() {
    for (;;) {
      announce();
      await sleep(5000);
    }
  })();

  // 注入角标:AI 页右下角显示「桥 v版本」,红色=还没连上中转,绿色=轮询正常。
  // 用来一眼分辨"桥没注入/桥连不上中转"这两类故障
  (function badge() {
    try {
      const make = () => {
        const el = document.createElement('div');
        el.textContent = '桥 ' + BRIDGE_VER;
        el.title = '网页AI桥(红=未连上中转,绿=正常)';
        el.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:2147483647;background:rgba(190,60,60,.85);color:#fff;font-size:11px;line-height:1;padding:4px 8px;border-radius:10px;opacity:.8;pointer-events:none';
        document.body.appendChild(el);
        window.__cxBridgeBadge = el;
      };
      if (document.body) make();
      else document.addEventListener('DOMContentLoaded', make);
    } catch (e) { /* ignore */ }
  })();
})();
