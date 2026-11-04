// ==UserScript==
// @name         学习通网页AI桥
// @namespace    cx-auto-study
// @version      1.0.0
// @description  配合「学习通刷课助手」使用:接收题目 → 自动填入网页版 AI 输入框 → 发送 → 抓取回答 → 回传。免 API Key。
// @author       cx-auto-study contributors
// @license      MIT
// @homepageURL  https://github.com/DaRin1403/xuexitong-autostudy
// @updateURL    https://cdn.jsdelivr.net/gh/DaRin1403/xuexitong-autostudy@main/userscripts/xuexitong-webai-bridge.user.js
// @downloadURL  https://cdn.jsdelivr.net/gh/DaRin1403/xuexitong-autostudy@main/userscripts/xuexitong-webai-bridge.user.js
// @match        *://chat.deepseek.com/*
// @match        *://chatgpt.com/*
// @match        *://chat.openai.com/*
// @match        *://www.kimi.com/*
// @match        *://kimi.moonshot.cn/*
// @match        *://www.doubao.com/*
// @match        *://yuanbao.tencent.com/*
// @match        *://tongyi.aliyun.com/*
// @match        *://127.0.0.1/*
// @match        *://localhost/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
//
// ⚠️ 说明
// 1. 必须与「学习通刷课助手」同时启用,并在本页面保持登录。
// 2. 同源策略下主页面读不到本页 DOM,一切都走 postMessage,所以两边缺一不可。
// 3. 各 AI 站点改版会导致选择器失效,失效表现是"答不上来",不会乱填。

(function () {
  'use strict';

  /* ==================== 站点适配配置 ==================== */
  // 输入框候选:textarea / 可编辑区(ProseMirror、Lexical 等富文本输入都落在这里)
  const INPUT_SELECTORS = [
    'textarea',
    '[contenteditable="true"]',
    '.ProseMirror',
    'div[role="textbox"]'
  ];
  // AI 回复容器候选(取最后一个)
  const REPLY_SELECTORS = [
    '[data-message-author-role="assistant"]',
    '[data-testid="receive_message"]',
    '.ds-markdown',
    '.markdown-body',
    '.chat-content-item-assistant',
    '[class*="assistant"] [class*="markdown"]',
    '[class*="message"] [class*="markdown"]'
  ];
  const SEND_TEXT = /发送|send|提交|问一问/i;
  const REPLY_STABLE_MS = 1500;   // 回复文本稳定这么久才算说完
  const REPLY_TIMEOUT_MS = 90000;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function findInput() {
    for (const sel of INPUT_SELECTORS) {
      const list = Array.from(document.querySelectorAll(sel)).filter(visible);
      if (list.length) {
        // 取面积最大的那个,避免命中隐藏的搜索框
        return list.sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return rb.width * rb.height - ra.width * ra.height;
        })[0];
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
    for (const scope of scopes) {
      if (!scope) continue;
      for (const b of scope.querySelectorAll('button, [role="button"]')) {
        const label = (b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '');
        if (SEND_TEXT.test(label) && visible(b) && !b.disabled) return b;
      }
    }
    for (const b of document.querySelectorAll('button, [role="button"]')) {
      const label = (b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '');
      if (SEND_TEXT.test(label) && visible(b) && !b.disabled) return b;
    }
    return null;
  }

  function fillInput(input, text) {
    input.focus();
    const tag = (input.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'input') {
      const proto = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    // 富文本输入框:先清空再插入,尽量走浏览器原生行为
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('delete', false, null);
      document.execCommand('insertText', false, text);
    } catch (e) { /* ignore */ }
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

  // 等一条新回复出现,并等到它的文本不再变化
  async function waitForAnswer(baselineCount) {
    const start = Date.now();
    let lastText = '';
    let stableSince = 0;
    while (Date.now() - start < REPLY_TIMEOUT_MS) {
      const nodes = replyNodes();
      if (nodes.length > baselineCount) {
        const text = String(nodes[nodes.length - 1].innerText || '').trim();
        if (text && text === lastText) {
          if (Date.now() - stableSince >= REPLY_STABLE_MS) return text;
        } else if (text) {
          lastText = text;
          stableSince = Date.now();
        }
      }
      await sleep(400);
    }
    return lastText;   // 超时也把已有内容返回,判空交给主脚本
  }

  async function handleAsk(msg) {
    const input = findInput();
    if (!input) throw new Error('没找到输入框(页面结构变了?请先手动点一下输入框)');

    const baseline = replyNodes().length;
    fillInput(input, msg.text);
    await sleep(120);
    if (!String(input.value || input.innerText || '').trim()) {
      throw new Error('题目没能填进输入框');
    }

    const btn = findSendButton(input);
    if (btn) btn.click();
    else pressEnter(input);

    await sleep(600);
    return waitForAnswer(baseline);
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
    } catch (err) {
      reply({ text: '', error: String(err && err.message || err) });
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
  announce();
  window.addEventListener('load', announce);
  window.addEventListener('focus', announce);
})();
