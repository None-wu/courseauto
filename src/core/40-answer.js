  /* ==================== 答案通道 ==================== */
  // 免费题库站(协议参考社区成熟脚本,无 token 时部分接口仍返回免费额度答案)
  async function channelTikuHai(q) {
    try {
      const res = JSON.parse(await cxFetch('http://api.tikuhai.com/search', {
        method: 'POST',
        data: JSON.stringify({ question: q.question, type: q.type }),
        headers: { 'Content-Type': 'application/json' }
      }));
      if (res.code === -1) return { form: '题库海', answer: String(res.msg || '').split('#') };
      const a = (res.data && res.data.answer) || res.msg || '';
      return { form: '题库海', answer: String(a).split('#') };
    } catch (e) { return { form: '题库海', answer: [] }; }
  }
  async function channelYizhi(q) {
    try {
      const ip = Array.from({ length: 4 }, () => Math.floor(255 * Math.random())).join('.');
      const res = JSON.parse(await cxFetch('http://cx.icodef.com/wyn-nb?v=4', {
        method: 'POST',
        data: JSON.stringify({ question: q.question }),
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, 'X-Real-IP': ip }
      }));
      if (res.code !== 1) return { form: '一之题库', answer: [] };
      let data = String(res.data || '').replace(/javascript:void\(0\);/g, '').replace(/\n/g, '').trim();
      if (/(叛逆|公众号|李恒雅|一之)/.test(data)) return { form: '一之题库', answer: [] };
      return { form: '一之题库', answer: data.split('#') };
    } catch (e) { return { form: '一之题库', answer: [] }; }
  }
  async function channelYanxi(q) {
    try {
      const res = JSON.parse(await cxFetch('https://tk.enncy.cn/query', {
        method: 'POST',
        data: JSON.stringify({ title: q.question }),
        headers: { 'Content-Type': 'application/json' }
      }));
      if (res.code !== 1) return { form: '言溪题库', answer: [] };
      return { form: '言溪题库', answer: String(res.data.answer || '').split('#') };
    } catch (e) { return { form: '言溪题库', answer: [] }; }
  }
  async function channelMuketool(q) {
    try {
      const res = JSON.parse(await cxFetch('https://api.muketool.com/cx/v2/query', {
        method: 'POST',
        data: JSON.stringify({ question: q.question, type: parseInt(q.type, 10) || 0 }),
        headers: { 'Content-Type': 'application/json' }
      }));
      if (res.code !== 1) return { form: '木课工具', answer: [] };
      return { form: '木课工具', answer: String(res.data || '').split('#') };
    } catch (e) { return { form: '木课工具', answer: [] }; }
  }

  // 图片题追加说明:①占位与附件一一对应 ②题干/选项本身全是图时明确要求"读图当题面"
  function imgTailOf(q) {
    const n = (q.images && q.images.length) || 0;
    if (!n) return '';
    const strip = (s) => String(s || '').replace(/\[图片\d+\]/g, '').replace(/[\s:：,，。.、;；()（）]/g, '');
    // 去掉 [图片N] 后没有实质文字 = 这块内容本身就是图,AI 必须自己看图
    const qBare = strip(q.question);
    const oBare = (q.options || []).map(strip).join('');
    const extra = [];
    if (!qBare) extra.push('题干内容全部在图里,图片就是题面本身,请直接从图中读取题目后再作答');
    if ((q.options || []).length && !oBare) extra.push('选项内容也都在图里,请先从图中读出各选项文字,再回答对应的选项字母');
    // 图文混排(文字 + 图都有):文字常常只是题面的一部分,表格/公式/图形细节只在图里。
    // 不点明这点时,AI 容易只按残缺文字硬答。
    if (qBare && qBare.length >= 2) {
      extra.push('本题既有文字也有图:文字与图片合起来才是完整题面,文字里缺的表格/公式/图形细节请以图片为准,不要只看文字作答');
      if (n > 1) extra.push(`共 ${n} 张图请按顺序逐张看完(可能是同一题的几个部分)`);
    }
    extra.push(`占位 [图片1]~[图片${n}] 与附件顺序一一对应`);
    return `\n(本题共 ${n} 张配图,已作为附件随本条消息发送,请先看图再作答;${extra.join(';')})`;
  }

  function buildAIPrompt(q) {
    const opts = (q.options || []).map((o, i) => `${String.fromCharCode(65 + i)}.${o}`).join(' ');
    const base = '你是一位专业的学习辅导老师,知识面广。规则:你的回复必须以最终答案开头(第一个字符就是答案),只输出答案本身,不要任何解释、思考或多余文字。';
    const tail = imgTailOf(q);
    switch (String(q.type)) {
      case '3': return `${base}\n判断题。题目:${q.question}\n只输出"正确"或"错误"。${tail}`;
      case '1': return `${base}\n多选题。题目:${q.question}\n选项:${opts}\n只输出所有正确选项的字母组合(如 ABD)。${tail}`;
      case '2': return `${base}\n填空题。题目:${q.question}\n直接输出答案,多个空用 | 分隔。${tail}`;
      case '0': return `${base}\n单选题。题目:${q.question}\n选项:${opts}\n只输出正确选项的字母(如 C)。${tail}`;
      default: return `${base}\n简答题。题目:${q.question}\n输出完整答案:若题目要求字数(例如"不少于800字""800字以上"),必须写够该字数;直接给正文,不要"以下是""简答如下"之类的开场白,也不要写提纲。${tail}`;
    }
  }

  function parseAIAnswer(type, content) {
    // 去 markdown 标记,全角字母转半角
    let text = String(content || '').trim()
      .replace(/[*_`#>]/g, '')
      .replace(/[Ａ-Ｈａ-ｈ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
    const firstLine = lines[0] || text;
    switch (String(type)) {
      case '3': {
        // 语义归一:正确/错误、对/错、√/×、T/F、true/false 都认(带句号、带解释也认)。
        // 注意不能"默认正确":AI 只回选项字母时,交给作答环节按选项映射,否则会 50% 蒙错
        const t = text.replace(/\s+/g, '');
        const isFalse = /错误|不对|不正确|×|✗|false|^否|^不是|^错/i.test(t);
        const isTrue = /正确|√|✓|true|^对|^是/i.test(t) && !/不(正确|对|是)|^不是/.test(t);
        if (isFalse && !isTrue) return ['错误'];
        if (isTrue && !isFalse) return ['正确'];
        return [firstLine];
      }
      case '1': {
        // 先认"整行只有字母与分隔符"的形式:ABD / A、B、D / A,B,D / A B D / (ABD) / ABD。
        // 不先处理这种写法的话,"A、B、D" 会被下面的"取最后一个字母"逻辑拆成只剩 D(多选只选一个的元凶)
        const only = firstLine.replace(/^答案\s*[:：]?/, '').trim();
        if (/^[（(]?\s*(?:[A-Ha-h]\s*[、,，;；/和]?\s*)+[)）]?\s*[。.]?$/.test(only)) {
          const uniq = [];
          for (const ch of only.toUpperCase().replace(/[^A-H]/g, '')) if (!uniq.includes(ch)) uniq.push(ch);
          if (uniq.length) return uniq;
        }
        // 独立字母组合(前后不紧挨其他英文字母,防止匹配到 AI/App 之类单词)。
        // AI 带思考过程时答案在末尾("...所以选 A"),取最后一个匹配而不是第一个。
        const all = String(firstLine + '\n' + text).match(/(?:^|[^A-Za-z])([A-Ha-h]{1,8})(?![A-Za-z])/g) || [];
        if (all.length) {
          const last = all[all.length - 1].replace(/[^A-Ha-h]/g, '');
          const uniq = [];
          for (const ch of last.toUpperCase()) if (!uniq.includes(ch)) uniq.push(ch);
          return uniq;
        }
        return [firstLine];
      }
      case '0': {
        const all = String(firstLine + '\n' + text).match(/(?:^|[^A-Za-z])([A-Ha-h])(?![A-Za-z])/g) || [];
        // 取最后一个独立字母(思考过程开头提到的选项不算,结论在末尾)
        return all.length ? [all[all.length - 1].replace(/[^A-Ha-h]/g, '').toUpperCase()] : [firstLine];
      }
      case '2': return text.split(/[|｜;；]/).map((s) => s.trim()).filter(Boolean);
      default: return [text];
    }
  }
  /* ==================== 网页 AI 通道(免 API Key) ==================== */
  // 同源策略挡住了跨域 DOM,所以不能"打开网页直接 querySelector 抓答案"。
  // 做法:window.open 打开 AI 网站 → postMessage 把题目发过去 → AI 侧的「网页AI桥」
  // 脚本负责填入输入框、点发送、等回答稳定,再把文本 postMessage 回来。
  let webAiWin = null;
  let webAiReady = false;
  let webAiSeq = 0;
  let webAiWaiters = [];

  function webAiOrigin() {
    try { return new URL(CONFIG.webAiUrl).origin; } catch (e) { return '*'; }
  }

  function openWebAI() {
    try {
      if (webAiWin && !webAiWin.closed) { webAiWin.focus(); return webAiWin; }
      webAiReady = false;
      webAiWin = window.open(CONFIG.webAiUrl, 'cx-web-ai', 'popup=yes,width=560,height=820');
      return webAiWin;
    } catch (e) { return null; }
  }

  // AI 页面加载完成后会主动发 CX_HELLO,这里据此判定"通道就绪"(也用于页面刷新后重新挂接)
  function onWebAiMessage(e) {
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.cxType === 'CX_HELLO') {
      webAiWin = e.source || webAiWin;
      if (!webAiReady) {
        webAiReady = true;
        log('🔗 网页 AI 已连接(可开始答题)', 'ok');
      }
      webAiWaiters.splice(0).forEach((fn) => fn());
    }
  }
  window.addEventListener('message', onWebAiMessage);

  function waitWebAiReady(timeoutMs = 15000) {
    if (webAiReady) return Promise.resolve(true);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), timeoutMs);
      webAiWaiters.push(() => { clearTimeout(t); resolve(true); });
    });
  }

  // hint:错题重问时追加的"上次这么答被判错了"提示,帮 AI 换思路而不是重复同一个错答案
  function buildAskText(q, hint) {
    const typeName = ({ '0': '单选题', '1': '多选题', '2': '填空题', '3': '判断题' })[String(q.type)] || '简答题';
    const opts = (q.options || []).map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n');
    return [
      `请回答下面这道${typeName}。要求:第一行只写答案,不要解释、不要复述题目。`,
      '',
      `题目:${q.question}`,
      opts ? `选项:\n${opts}` : '',
      '',
      '答案格式:单选题写字母(如 C);多选题写字母组合(如 ABD);判断题写「正确」或「错误」;填空题多个空用 | 分隔。',
      imgTailOf(q),
      hint ? `\n注意:${hint}` : ''
    ].filter(Boolean).join('\n');
  }

  // images:题目图片(dataURL 数组),由桥脚本负责把它们当附件塞进 AI 输入框
  // maxImages:本次最多送几张 —— 单题用默认 IMG_MAX_COUNT,多道图题合并提问时由调用方放宽
  async function askWebAI(text, timeoutMs, expect, images, maxImages) {
    const cap = Math.max(1, Number(maxImages) || IMG_MAX_COUNT);
    const imgs = Array.isArray(images) ? images.filter(Boolean).slice(0, cap) : [];
    // 先验桥:目标 AI 站的桥不在线时跳过 postMessage 直连(握手状态可能是旧窗口残留,会白等 60s),
    // 直接走中转通道的快速失败 + 指引
    let site = '';
    try { site = new URL(CONFIG.webAiUrl).host; } catch (e) { /* ignore */ }
    const bridgeUp = site ? await bridgeOnlineFor(site) : true;
    // 通道一:postMessage 直连(窗口引用在手且桥已握手)—— 延迟最低
    if (bridgeUp) {
      let win = webAiWin && !webAiWin.closed ? webAiWin : null;
      if (!win) {
        // 还没开过 AI 页:先尝试开窗(用户手势后的弹窗放行;自动答题时的 open 可能被拦截,拦了走中转)
        win = openWebAI();
        if (win) {
          await waitWebAiReady(8000);
          if (webAiReady) return postMessageAsk(win, text, timeoutMs, expect, imgs);
        }
      } else {
        await waitWebAiReady(8000);
        if (webAiReady) return postMessageAsk(win, text, timeoutMs, expect, imgs);
      }
    }
    // 通道二:经本地服务中转 —— 不依赖弹窗,用户手动打开的 AI 页也能接题(内含不在线快速失败)
    const relay = await relayAsk(text, timeoutMs, expect, imgs);
    if (relay.ok) return relay.result;
    return { text: '', error: '连不上网页 AI:请点 ⚙ →「打开并连接网页 AI」,或手动打开网页 AI 地址并保持页面开着' };
  }

  // postMessage 直连实现(原 askWebAI 主体)
  function postMessageAsk(win, text, timeoutMs, expect, imgs) {
    const cxId = 'cx' + Date.now().toString(36) + (++webAiSeq);
    const images = Array.isArray(imgs) ? imgs : [];
    const base = (CONFIG.webAiRelay || 'http://127.0.0.1:8790').replace(/\/$/, '');
    return new Promise((resolve) => {
      let done = false;
      const finish = (r) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearInterval(relayTimer);
        window.removeEventListener('message', onMsg);
        resolve(r);
      };
      const onMsg = (e) => {
        const d = e.data;
        if (!d || d.cxType !== 'CX_ANSWER' || d.cxId !== cxId) return;
        finish({ text: String(d.text || ''), error: d.error || '' });
      };
      // 回程双保险:postMessage 等待期间同时轮询本地中转(桥会把答案双写进中转),
      // postMessage 回程丢了也能兜回
      let relayBusy = false;
      const relayTimer = setInterval(() => {
        if (relayBusy) return;
        relayBusy = true;
        cxFetch(base + '/api/webai/answer/' + cxId, { timeout: 5000 })
          .then((raw) => {
            const o = JSON.parse(raw);
            if (o && o.done) finish({ text: String(o.text || ''), error: o.error || '' });
          })
          .catch(() => { /* 中转不在线,继续等 */ })
          .finally(() => { relayBusy = false; });
      }, 2500);
      const timer = setTimeout(() => finish({ text: '', error: `等待网页 AI 回复超时(${Math.round(timeoutMs / 1000)}s)` }), timeoutMs);
      window.addEventListener('message', onMsg);
      try { win.postMessage({ cxType: 'CX_ASK', cxId, text, expect: expect || 0, timeout: timeoutMs, images }, webAiOrigin()); }
      catch (e) { finish({ text: '', error: '消息发送失败: ' + (e.message || e) }); }
    });
  }

  // 本地中转实现:POST 放题 → 轮询取答案;中转服务不在线或桥脚本不在线都明确报错
  // 查询中转服务:目标 AI 站的桥是否在线(在线才有可能答題)
  const RELAY_DOWN_HINT = '本地中转服务没在运行:请双击「刷课助手」exe 启动(黑色窗口),答题期间保持它开着';

  async function bridgeOnlineFor(site) {
    const base = (CONFIG.webAiRelay || 'http://127.0.0.1:8790').replace(/\/$/, '');
    try {
      const raw = await cxFetch(base + '/api/webai/status', { timeout: 5000 });
      const o = JSON.parse(raw);
      return !!(o.ok && Array.isArray(o.sites) && o.sites.some((s) => s.host === site));
    } catch (e) { return false; }
  }

  // 中转服务本身是否可达(区分「服务没开」和「桥不在线」,指引完全不同)
  async function relayServerUp() {
    const base = (CONFIG.webAiRelay || 'http://127.0.0.1:8790').replace(/\/$/, '');
    try { await cxFetch(base + '/api/webai/status', { timeout: 5000 }); return true; }
    catch (e) { return false; }
  }

  async function relayAsk(text, timeoutMs, expect, imgs) {
    const base = (CONFIG.webAiRelay || 'http://127.0.0.1:8790').replace(/\/$/, '');
    const images = Array.isArray(imgs) ? imgs : [];
    let site = '';
    try { site = new URL(CONFIG.webAiUrl).host; } catch (e) { /* ignore */ }
    // 先验桥:AI 页的桥不在线就别把题扔进队列干等 60s,快速失败并给可执行指引
    if (site && !(await bridgeOnlineFor(site))) {
      // 服务都没开就不用等:开多少个 AI 页也没用
      if (!(await relayServerUp())) {
        log(`⚠ ${RELAY_DOWN_HINT}`, 'err');
        return { ok: true, result: { text: '', error: RELAY_DOWN_HINT } };
      }
      log(`⚠ ${site} 的网页 AI 桥不在线:请打开「网页 AI 地址」页面(保持登录、别关标签页)并确认装了最新版「网页AI桥」`, 'warn');
      openWebAI();   // 点开始/答题通常紧跟用户操作,顺手尝试弹窗
      // 弹窗被拦/窗口最小化时页面刚被节流,心跳要几秒才能恢复:轮询最多 15s 再放弃
      const deadline = Date.now() + 15000;
      let up = false;
      while (Date.now() < deadline) {
        await sleep(2);
        if (!(await relayServerUp())) break;   // 等待期间服务被关,直接停
        if (await bridgeOnlineFor(site)) { up = true; break; }
      }
      if (!up) {
        if (!(await relayServerUp())) {
          log(`⚠ ${RELAY_DOWN_HINT}`, 'err');
          return { ok: true, result: { text: '', error: RELAY_DOWN_HINT } };
        }
        return { ok: true, result: { text: '', error: `${site} 的网页 AI 桥不在线(元宝页没开或没装/没刷新桥脚本)` } };
      }
      log('🔗 网页 AI 桥已上线,继续答题', 'ok');
    }
    const cxId = 'cx' + Date.now().toString(36) + (++webAiSeq);
    try {
      await cxFetch(base + '/api/webai/ask', {
        method: 'POST',
        data: JSON.stringify({ cxId, text, href: location.href, site, expect: expect || 0, timeout: timeoutMs, images }),
        headers: { 'Content-Type': 'application/json' },
        timeout: 8000
      });
    } catch (e) {
      return { ok: false, result: null };   // 本地服务不在线 → 走下一通道
    }
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await sleep(1);   // 每秒轮询一次答案(sleep 单位是秒)
      try {
        const raw = await cxFetch(base + '/api/webai/answer/' + cxId, { timeout: 6000 });
        const o = JSON.parse(raw);
        if (o.done) return { ok: true, result: { text: String(o.text || ''), error: String(o.error || '') } };
      } catch (e) { /* 网络抖动,继续轮询 */ }
    }
    // 超时:查一次状态,把"谁没干活"说清楚
    // 注意 sites 是 [{host,ver,tick}] 对象数组,不能用 indexOf(字符串) 判在线(恒 -1,分支永远进不去)
    let hint = `请打开 ${site || '网页 AI 地址'} 并保持标签页开着`;
    try {
      const st = JSON.parse(await cxFetch(base + '/api/webai/status', { timeout: 6000 }));
      const sites = Array.isArray(st.sites) ? st.sites : [];
      const mine = sites.find((s) => s && s.host === site);
      if (mine) {
        hint = `网页 AI 页已连上(${site})但没回复 —— 到 AI 页看看是不是回答卡住/还在生成`;
      } else if (sites.length) {
        hint = `中转里在线的是 ${sites.map((s) => s.host).join(' / ')},不是当前配置的 ${site}` +
          ' —— 把面板里的「网页 AI 地址」改成在线的那个站点,或打开当前站点并登录';
      } else if (st.bridgeOnline) {
        hint = '检测到旧版桥在轮询 —— 请重装「网页 AI 桥」(v1.0.6+)并刷新 AI 页面';
      } else {
        hint = `没有任何在线桥 —— 请打开 ${site} 页面并登录,确认装了「网页 AI 桥」且标签页没关`;
      }
    } catch (e) { /* ignore */ }
    return { ok: true, result: { text: '', error: `等待网页 AI 回复超时(${Math.round(timeoutMs / 1000)}s):` + hint } };
  }

  async function channelWebAI(q, hint) {
    const timeout = (CONFIG.webAiTimeout || 60) * 1000;
    // 第 4 参把题目配图(dataURL)一起带过去:桥会把它当附件传进 AI 输入框
    const r = await askWebAI(buildAskText(q, hint), timeout, 0, q.images);
    if (r.error) { log('网页 AI: ' + r.error, 'warn'); return { form: '网页AI', answer: [] }; }
    const raw = String(r.text || '').trim();
    if (!raw) { log('网页 AI 返回内容为空', 'warn'); return { form: '网页AI', answer: [] }; }
    log('网页 AI 原始回复: ' + raw.replace(/\s+/g, ' ').slice(0, 80), 'info');
    return { form: '网页AI', answer: parseAIAnswer(q.type, raw) };
  }

  // 答案通道:AI 优先(准确率最高),免费题库并行兜底
  function filterAnswers(arr) {
    return (arr || []).map(String).map(clean)
      .filter((a) => a && a !== '暂无答案' && a !== '略' && !/(付费|购买|卡密|升级|公众号|扫码|微信)/.test(a));
  }
  /* ==================== 整卷模式(批量问答) ==================== */
  // 整页题目打包成一道大题发给网页 AI,按题号批量解析;缺漏的题由调用方回退逐题询问。
  function buildBatchPrompt(tasks) {
    const typeName = { '0': '单选题', '1': '多选题', '2': '填空题', '3': '判断题' };
    let out = `下面是 ${tasks.length} 道题。请按题号逐行给出答案,每行格式严格为「题号.答案」(如 1.A、2.正确、3.填空内容),不要解释、不要复述题目。单选题写一个字母;多选题写字母组合(如 ABD);判断题写「正确」或「错误」;填空题写答案,多个空用|分隔。\n\n`;
    tasks.forEach(({ q }, i) => {
      out += `${i + 1}. (${typeName[String(q.type)] || '题目'}) ${q.question}\n`;
      if (q.options && q.options.length) {
        // 选项带字母:AI 才知道 A/B 对应哪个选项(判断题也能回"B.错误"或字母)
        out += q.options.map((o, oi) => `${String.fromCharCode(65 + oi)}. ${o}`).join('\n') + '\n';
      }
      out += '\n';
    });
    return out;
  }

  // 把 AI 的整卷回复按「题号.答案」拆成与 tasks 等长的答案数组(没解析到的位置为 null)
  // 兼容两种形态:
  // ① 多行:1.A\n2.C\n...(正常);② 压平一行:1.A 2.C 3.B...(回复被压平或 AI 单行输出)。
  // 每个答案取到"下一个题号标记或结尾"为止,而不是行尾 —— 一行多题也能全部拆出
  function parseBatchAnswers(raw, tasks) {
    const rawMap = new Array(tasks.length).fill(null);
    const re = /(\d{1,3})\s*[\.、:：)\]]\s*([\s\S]*?)(?=(?:^|\s)\d{1,3}\s*[\.、:：)\]]|$)/g;
    // 元宝等站会把「展开/复制/收起」等 UI 按钮文字混进回复,逐行剥掉再入库
    const JUNK_LINE = /^(展开|收起|复制|重新生成|重新回答|停止|继续|点赞|点踩|分享|朗读|编辑|删除|已处理|已停止生成|思考中|正在思考|生成中|点击全选以下消息)$/;
    let m;
    while ((m = re.exec(raw)) !== null) {
      const idx = parseInt(m[1], 10) - 1;
      const ansText = String(m[2] || '').split('\n')
        .map((s) => s.trim()).filter((s) => s && !JUNK_LINE.test(s)).join('\n').trim();
      if (idx >= 0 && idx < tasks.length && ansText && !rawMap[idx]) rawMap[idx] = ansText;
    }
    return tasks.map(({ q }, i) => {
      if (!rawMap[i]) return null;
      const ans = filterAnswers(parseAIAnswer(String(q.type), rawMap[i]));
      return ans.length ? ans : null;
    });
  }

  // 把一批题打包问一次 AI,返回与 tasks 等长的答案数组(没解析到的位置为 null)
  async function askBatchOnce(tasks, tag) {
    const text = buildBatchPrompt(tasks);
    // 等待上限:每题 25s、最少 5 分钟、最多 15 分钟。整卷 AI 要连续输出几十行,
    // 之前按 15s/题(30 题=7.5 分钟)且桥内部只等 90s,所以经常"没答完就收货"
    const timeoutMs = Math.min(900, Math.max(300, tasks.length * 25)) * 1000;
    log(`📦 整卷模式${tag}:把 ${tasks.length} 道题一次性发给网页 AI(最长等 ${Math.round(timeoutMs / 1000)}s,期间别关 AI 页面)...`, 'info');
    const r = await askWebAI(text, timeoutMs, tasks.length);
    if (r.error) { log('网页 AI: ' + r.error, 'warn'); return null; }
    const raw = String(r.text || '').trim();
    if (!raw) { log('网页 AI 整卷回复为空', 'warn'); return null; }
    log('网页 AI 整卷原始回复: ' + raw.replace(/\s+/g, ' ').slice(0, 100), 'info');
    return parseBatchAnswers(raw, tasks);
  }

  /* ==================== 图文混排题合并提问 ==================== */
  // 背景:图片题原先在整卷模式里被逐题剔出去单独问,每题都要「上传图 → 等上传确认 → 发送 → 等回答」,
  // 一页十几道图题时往返次数太多,慢到课程超时。
  // 做法:把连续的几道图片题合成一次提问,配图按题序连续编号(第1题的图是[图片1]..),
  // 让 AI 一次读完全部图、按题号一次答完;只有合批没解析到的题才回退到单题通道。
  const IMG_BATCH_QUESTIONS = 3;   // 一次合批最多几道图片题
  const IMG_BATCH_IMAGES = 6;      // 一次合批最多几张图(再多 AI 容易看漏)

  function splitImageBatches(tasks) {
    const groups = [];
    let cur = [];
    let imgs = 0;
    tasks.forEach((t) => {
      const n = Math.max(1, ((t.q && t.q.images) || []).length);
      if (cur.length && (cur.length >= IMG_BATCH_QUESTIONS || imgs + n > IMG_BATCH_IMAGES)) {
        groups.push(cur); cur = []; imgs = 0;
      }
      cur.push(t); imgs += n;
    });
    if (cur.length) groups.push(cur);
    return groups;
  }

  function buildImageBatchPrompt(tasks) {
    const typeName = { '0': '单选题', '1': '多选题', '2': '填空题', '3': '判断题' };
    let total = 0;
    const plan = [];
    tasks.forEach((t, i) => {
      const n = ((t.q && t.q.images) || []).length;
      if (!n) return;
      const from = total + 1;
      total += n;
      const span = n === 1 ? `[图片${from}]` : `[图片${from}]~[图片${total}]`;
      plan.push(`第${i + 1}题的图=${span}`);
    });
    let out = `下面有 ${tasks.length} 道题,配图已作为附件按顺序发送,共 ${total} 张:${plan.join(';')}。\n`;
    out += '要求:先按编号顺序把每张图都看完(图里可能是表格、公式、代码或图形),再把「题目文字 + 图」合起来理解;\n';
    out += '题干里的 [图片N] 只是占位符,不是题目内容。\n';
    out += `然后按题号逐行给出答案,每行格式严格为「题号.答案」(如 1.A、2.正确、3.填空内容),不要解释、不要复述题目。单选题写一个字母;多选题写字母组合(如 ABD);判断题写「正确」或「错误」;填空题写答案,多个空用|分隔。\n\n`;
    tasks.forEach(({ q }, i) => {
      out += `${i + 1}. (${typeName[String(q.type)] || '题目'}) ${q.question}\n`;
      if (q.options && q.options.length) {
        out += q.options.map((o, oi) => `${String.fromCharCode(65 + oi)}. ${o}`).join('\n') + '\n';
      }
      out += '\n';
    });
    return out;
  }

  async function askImageBatchOnce(tasks, tag) {
    const imgs = [];
    tasks.forEach((t) => {
      (((t.q && t.q.images) || []).slice(0, IMG_MAX_COUNT)).forEach((u) => { if (u) imgs.push(u); });
    });
    if (!imgs.length) return null;
    const text = buildImageBatchPrompt(tasks);
    // 带图比纯文字慢得多:每题 90s、最少 4 分钟、最多 15 分钟
    const timeoutMs = Math.min(900, Math.max(240, tasks.length * 90)) * 1000;
    log(`🖼 图片题合并${tag}:${tasks.length} 道题 + ${imgs.length} 张图一次问(最长等 ${Math.round(timeoutMs / 1000)}s,AI 要先逐图看)...`, 'info');
    // 第 5 参放宽单次送图上限,否则会被 IMG_MAX_COUNT 砍到 3 张,后面的题就没图了
    const r = await askWebAI(text, timeoutMs, tasks.length, imgs, IMG_BATCH_IMAGES);
    if (r.error) { log('网页 AI(图题合并): ' + r.error, 'warn'); return null; }
    const raw = String(r.text || '').trim();
    if (!raw) { log('网页 AI 图题合并回复为空', 'warn'); return null; }
    log('网页 AI 图题合并原始回复: ' + raw.replace(/\s+/g, ' ').slice(0, 100), 'info');
    return parseBatchAnswers(raw, tasks);
  }

  // 返回与 tasks(图片题子集)等长的答案数组
  async function askImageBatches(tasks) {
    const out = new Array(tasks.length).fill(null);
    const groups = splitImageBatches(tasks);
    let base = 0;
    let seq = 0;
    for (const g of groups) {
      seq += 1;
      const res = await askImageBatchOnce(g, groups.length > 1 ? `(${seq}/${groups.length})` : '');
      if (res) res.forEach((v, k) => { if (v) out[base + k] = v; });
      base += g.length;
    }
    return out;
  }

  async function askBatchWebAI(tasks) {
    if (!tasks.length) return null;
    const out = new Array(tasks.length).fill(null);
    // 图片题不能混进纯文字整批:整批只是一段文字,AI 收到的题干里只有 [图片N] 占位。
    // 但也不必逐题问 —— 先把图片题几道一组合并提问(一次带多张图),只有合批漏掉的才逐题带图回退。
    const imgIdx = [];
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      if (!t || !t.q || !questionHasImage(t.q)) continue;
      // 合批时不经过 getAnswers,所以这里要自己把配图抓成 dataURL(有缓存,重复调用不重复下载);
      // 抓图失败(权限/跨域)的题退回去走纯文字整批,不占着图题名额空等
      try { await ensureQuestionImages(t.q); } catch (e) { /* ignore */ }
      if ((t.q.images || []).length) imgIdx.push(i);
    }
    if (imgIdx.length) {
      log(`🖼 整卷里有 ${imgIdx.length} 道图片题,先合并提问;其余 ${tasks.length - imgIdx.length} 道仍走整批`, 'info');
      const imgTasks = imgIdx.map((i) => tasks[i]);
      const gotImg = await askImageBatches(imgTasks);
      gotImg.forEach((v, k) => { if (v) out[imgIdx[k]] = v; });
      const missImg = imgIdx.filter((i) => !out[i]);
      if (missImg.length) {
        log(`🖼 合批没拿到答案的 ${missImg.length} 道图题,改为单题带图重问`, 'warn');
        for (const i of missImg) {
          const a = await getAnswers(tasks[i].q);
          if (a && a.length) out[i] = a;
        }
      }
    }
    const restIdx = tasks.map((t, i) => (imgIdx.indexOf(i) >= 0 ? -1 : i)).filter((i) => i >= 0);
    if (restIdx.length) {
      const first = await askBatchOnce(restIdx.map((i) => tasks[i]), '');
      if (first) first.forEach((v, k) => { if (v) out[restIdx[k]] = v; });
      let got = out.filter(Boolean).length;
      log(`📦 整卷回复解析: ${got}/${tasks.length} 题拿到答案`, got === tasks.length ? 'ok' : 'warn');
      if (got < tasks.length) {
        // 补问只补"文字题里还缺的":图片题已经在上面单独问过,再混进整批也看不到图
        const missIdx = out.map((v, i) => (v || imgIdx.indexOf(i) >= 0 ? -1 : i)).filter((i) => i >= 0);
        if (missIdx.length && missIdx.length < restIdx.length && CONFIG.webAiBatchRetry !== false) {
          log(`📦 补问:${missIdx.length} 道题没解析到,再整批问一次(不逐题)...`, 'warn');
          const sub = await askBatchOnce(missIdx.map((i) => tasks[i]), '(补问)');
          if (sub) sub.forEach((v, k) => { if (v && !out[missIdx[k]]) out[missIdx[k]] = v; });
          got = out.filter(Boolean).length;
          log(`📦 补问后: ${got}/${tasks.length} 题拿到答案`, got === tasks.length ? 'ok' : 'warn');
        }
        if (got < tasks.length) log(`⚠ 仍有 ${tasks.length - got} 道题没答案,只有这几道会逐题回退询问`, 'warn');
      }
    }
    return out.some(Boolean) ? out : null;
  }

  let webAiWarned = false;
  // hint:可选,错题重问时把"上次判错的答案"带进去让 AI 换思路
  async function getAnswers(q, hint) {
    // 图片题先把配图抓成 dataURL(带缓存):网页 AI 附件要用它
    if (q) await ensureQuestionImages(q);
    // 错题本优先:之前被判错、随后重问 AI 或从结果页取到正确答案的题,重做时直接用修正答案
    if (!hint) {
      const fixed = lookupFix(q.question);
      if (fixed && fixed.length) {
        STATS.answered++;
        log(`[错题本] 命中修正答案: ${fixed.join(' / ')}`, 'ok');
        return fixed;
      }
    }
    // 只有网页 AI 一条答题通道:拿到答案即返回,拿不到再查题库
    if (CONFIG.webAiEnabled) {
      const r = await channelWebAI(q, hint);
      const ans = filterAnswers(r.answer);
      if (ans.length) {
        STATS.answered++;
        log(`[${r.form}] 查到答案: ${ans.join(' / ')}`, 'ok');
        return ans;
      }
    } else if (!webAiWarned) {
      webAiWarned = true;
      log('⚠ 未启用 AI 答题:点面板 ⚙ → 勾选「网页 AI 答题」并保持 AI 网页已登录,否则无法自动做题', 'warn');
    }
    const results = CONFIG.useTiku
      ? await Promise.all([channelTikuHai(q), channelYizhi(q), channelYanxi(q), channelMuketool(q)])
      : [];
    for (const r of results) {
      const ans = filterAnswers(r.answer);
      if (ans.length) {
        STATS.answered++;
        log(`[${r.form}] 查到答案: ${ans.join(' / ')}`, 'ok');
        return ans;
      }
    }
    const reason = CONFIG.webAiEnabled
      ? '(原因:网页 AI 没返回答案 —— 检查 AI 页面是否打开、是否已登录、是否装了「网页AI桥」)'
      : '(原因:网页 AI 答题未启用,请点 ⚙ 勾选「网页 AI 答题」)';
    log('未查到答案' + reason, 'warn');
    return [];
  }
  /* ==================== 自动作答 ==================== */
  function matchAnswer(answerArr, options) {
    const idx = [];
    const opts = (options || []).map((o) => cl(clean(String(o))));
    for (const raw of answerArr) {
      const a = cl(clean(String(raw)));
      if (!a) continue;
      // 字母答案:纯组合(ABD)或带分隔符(A、B、D / A,B,D / A和B)都拆成单字母,否则多选会被拆错
      const onlyLetters = /^[（(]?\s*(?:[A-Ha-h]\s*[、,，;；/和]?\s*)+[)）]?\s*[。.]?$/;
      const letters = /^[A-Ha-h]+$/.test(a)
        ? a.toUpperCase().split('')
        : (onlyLetters.test(a) ? a.toUpperCase().replace(/[^A-H]/g, '').split('') : []);
      for (let i = 0; i < opts.length; i++) {
        if (idx.includes(i)) continue;
        const letter = String.fromCharCode(65 + i);
        const opt = opts[i];
        if (!opt) continue;
        if (letters.includes(letter)) { idx.push(i); continue; }
        if (a.startsWith(letter + '.') || a.startsWith(letter + '、') || a.startsWith(letter + ':') || a.startsWith(letter + ')')) { idx.push(i); continue; }
        if (a.length >= 2 && (opt.includes(a) || a.includes(opt))) { idx.push(i); continue; }
        if (opt === a) idx.push(i);
      }
    }
    return idx;
  }

  // 清空当前已勾选的选项(重做时避免旧答案残留叠加)
  // 必须连「答案隐藏域 + check_answer 选中标记」一起清:
  // 只清真控件时,重做场景里残留的 answer<qid>/check_answer 会让 choicePicked 误判
  // 「这题已经选好了」而跳过点击,旧式 checkbox 页面就一直是空勾状态。
  function clearCurrent(el) {
    // 真控件直接改 checked,不要 click:老式页面的 click 处理器是 toggle 语义
    // (inp.checked = !inp.checked),点一下会被它自己翻回去,清不干净。
    el.querySelectorAll('input[type=radio], input[type=checkbox]').forEach((inp) => {
      try { if (inp.checked) inp.checked = false; } catch (e) { /* ignore */ }
    });
    try {
      const doc = el.ownerDocument || document;
      const qids = new Set();
      el.querySelectorAll('li[qid]').forEach((n) => qids.add(n.getAttribute('qid')));
      qids.forEach((qid) => {
        if (!qid) return;
        const hid = doc.getElementById('answer' + qid);
        if (hid) hid.value = '';
      });
    } catch (e) { /* ignore */ }
    try {
      el.querySelectorAll('.check_answer').forEach((n) => { n.classList.remove('check_answer'); });
    } catch (e) { /* ignore */ }
  }

  /* ==================== 网页 AI 启动关卡 ==================== */
  // 启用网页 AI 时,答题任务开始前先把 AI 页拉起来、等桥在线,再放行答题。
  // 返回 true=可以答题;false=未就绪(调用方应跳过本轮答题,不要空跑超时)。
  async function webAiStartupGate() {
    if (!CONFIG.webAiEnabled) return true;
    const base = (CONFIG.webAiRelay || 'http://127.0.0.1:8790').replace(/\/$/, '');
    let site = '';
    try { site = new URL(CONFIG.webAiUrl).host; } catch (e) { return true; }
    // 一次探测同时区分「中转服务没开」和「桥不在线」—— 两者的解决动作完全不同
    const probe = async () => {
      try {
        const o = JSON.parse(await cxFetch(base + '/api/webai/status', { timeout: 5000 }));
        return { serverUp: true, bridgeUp: !!(o.ok && Array.isArray(o.sites) && o.sites.some((s) => s.host === site)) };
      } catch (e) { return { serverUp: false, bridgeUp: false }; }
    };
    let st = await probe();
    if (st.bridgeUp) { log(`🔗 网页 AI 桥已在线(${site}),直接开始答题`, 'ok'); return true; }
    if (!st.serverUp) {
      log(`⚠ ${RELAY_DOWN_HINT}`, 'err');
      return false;   // 服务没开,开 AI 页也没用,不空等 90s
    }
    log(`🚀 先打开网页 AI 页面(${site}),等它就绪后开始答题...`, 'info');
    try { openWebAI(); } catch (e) { /* 非手势弹窗可能被拦,用户手动打开也一样 */ }
    const deadline = Date.now() + 90000;
    let lastLog = 0;
    while (Date.now() < deadline) {
      await sleep(3);   // sleep 单位是秒
      if (PAUSED) return false;   // 等待期间用户点了暂停,放弃本轮
      st = await probe();
      if (st.bridgeUp) { log(`🔗 网页 AI 桥已就绪(${site}),开始答题`, 'ok'); return true; }
      if (!st.serverUp) {
        log(`⚠ 中转服务被关掉了(黑窗口没了)。${RELAY_DOWN_HINT},再点「开始」重试`, 'err');
        return false;
      }
      if (Date.now() - lastLog > 15000) {
        lastLog = Date.now();
        log(`⏳ 仍在等网页 AI 页面就绪(需已打开且登录、标签页保持开着,自动开窗被拦时请手动打开)...`, 'warn');
      }
    }
    log('⚠ 等了 90s 网页 AI 桥仍未上线,本轮不开始答题(确认页面已打开且登录后,点「开始」重试)', 'warn');
    return false;
  }
