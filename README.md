# 刷课助手 courseauto(学习通 / 智慧树 / 雨课堂)

[![License: Personal Use Only](https://img.shields.io/badge/License-Personal%20Use%20Only%20(No%20Commercial)-red.svg)](LICENSE)
[![Userscript](https://img.shields.io/badge/userscript-Tampermonkey-blue.svg)](userscripts/courseauto.user.js)
[![Release](https://img.shields.io/github/v/release/None-wu/courseauto?label=release)](https://github.com/None-wu/courseauto/releases/latest)
[![CI](https://github.com/None-wu/courseauto/actions/workflows/ci.yml/badge.svg)](https://github.com/None-wu/courseauto/actions/workflows/ci.yml)

一个跑在浏览器里的油猴(Tampermonkey)脚本,自动完成网课任务点:视频静音连播、文档/图片任务、弹题作答、章节测验自动答题、自动切章。
支持**学习通(超星)、智慧树(知到)、雨课堂**三个平台。

- **零基础可用**:装油猴 → 装脚本 → 打开课程页,全程不用写代码
- **答题可选两种通道**:网页 AI(免 Key,需装桥脚本)或 API Key(最稳,推荐 DeepSeek)
- **面板全中文**,每个设置项都带说明,默认值偏"快",要稳就按 [安全与合规建议](#-安全与合规建议) 调保守

> **来源**:本项目基于 [DaRin1403/xuexitong-autostudy](https://github.com/DaRin1403/xuexitong-autostudy)(MIT)二次开发,
> 上游代码部分沿用其 MIT 许可与原始版权声明(完整保留于 [`LICENSE-MIT-upstream`](LICENSE-MIT-upstream));
> `.git` 历史保留了原作者全部提交记录。在此基础上重构了内核/适配器分层,补齐网页 AI 免 Key 答题、
> 判断题与新版页面结构适配、本机安装向导与客户版打包。
>
> **许可**:新增与重构部分采用**个人非商业使用许可**,仅限个人学习自用,**禁止任何商业使用**,详见 [LICENSE](LICENSE)。

---

## 🚀 快速开始

四条路,按你的情况选一条。

| 方式 | 适合谁 | 操作 | 
|------|--------|------|
| **A. 本机一键安装** | 有 Node,想全自动 | `npm run setup` → 浏览器自动打开向导,跟着点 |
| **B. 线上直装** | 只要脚本本体 | 装油猴 → 点[安装链接](https://cdn.jsdelivr.net/gh/None-wu/courseauto@main/userscripts/courseauto.user.js) |
| **C. 免安装 exe** | 没装 Node / 要发给同学 | 下 [exe](https://github.com/None-wu/courseauto/releases/latest) → 双击 → 跟向导走 |
| **D. 手动粘贴** | 想自己掌控 | 油猴面板新建脚本 → 粘 `userscripts/courseauto.user.js` → `Ctrl+S` |

<details>
<summary><b>方式 A：本机一键安装</b></summary>

```bash
cd courseauto
npm run setup
```

脚本检测本机浏览器是否装了油猴,并打开安装向导 `http://127.0.0.1:8790/setup`:
装扩展 → 一键装脚本 → 点站点入口直接开刷。**不用复制任何代码**。
(扩展只能从官方商店装,这是浏览器安全策略,向导会给你直达入口。)
</details>

<details>
<summary><b>方式 B：线上直装</b></summary>

先在浏览器装好 Tampermonkey,然后点:

👉 **[一键安装脚本](https://cdn.jsdelivr.net/gh/None-wu/courseauto@main/userscripts/courseauto.user.js)**

> 首次推送后 CDN 需几分钟同步,打不开就稍等重试。
</details>

<details>
<summary><b>方式 C：免安装 exe(Windows)</b></summary>

👉 **[下载 courseauto-v1.5.6.exe](https://github.com/None-wu/courseauto/releases/latest)**(单文件,含网页 AI 中转;
压缩包与使用说明在同一个 Release 里)

双击 → 浏览器自动打开向导 → 装油猴 → 点一下装脚本。**窗口保持开着**,脚本答题时靠它转发 AI 请求
(关掉只是退出中转,不影响已装的脚本)。

exe 约 94 MB,压缩包约 36 MB。首次运行若遇 SmartScreen「已保护你的电脑」,点「更多信息 → 仍要运行」。
</details>

<details>
<summary><b>方式 D：手动粘贴</b></summary>

油猴管理面板 → 左上角「**+**」新建脚本 → 清空编辑器 → 粘贴 `userscripts/courseauto.user.js` 全文 → `Ctrl+S`。
</details>

> **从 v1.3.x 升级过来?** v1.4.0 起项目改名为 **courseauto / 刷课助手**,脚本 `@name` 与安装地址都变了,
> 油猴会当成新脚本。**先在油猴面板删掉旧的「网课助手」再装新的**,否则两个面板会同时跑;
> 配置(AI Key、倍速等)需在新面板 ⚙ 里重填一次。

### 装油猴(Tampermonkey)

<details>
<summary>🔵 Microsoft Edge(Windows 自带,推荐)</summary>

1. Edge 应用商店搜「**Tampermonkey**」(中文名"篡改猴")→ 安装
2. `edge://extensions` → 找到 Tampermonkey → 「详细信息」→ 打开「**允许用户脚本**」(不开脚本不会运行)
</details>

<details>
<summary>🟢 Google Chrome(Windows / Mac)</summary>

1. Chrome 网上应用店(需能访问 Google)搜「**Tampermonkey**」→ 安装
2. `chrome://extensions` → Tampermonkey → 「详细信息」→ 打开「**允许用户脚本**」
</details>

<details>
<summary>🧭 Safari(仅 Mac)</summary>

1. App Store 搜「**Tampermonkey**」安装
2. Safari「设置 → 扩展」里勾选启用
3. 脚本安装流程同 Chrome / Edge
</details>

> 不确定装好没有?随便打开一个网页,点浏览器右上角油猴图标,能弹出菜单就是装好了。

### 配置答题通道(做题必需)

章节测验的自动答题靠大模型完成,**两种方式任选其一**:

| 通道 | 特点 | 怎么配 |
|------|------|--------|
| **网页 AI(免 Key)** | 不用花钱,借用已登录的 AI 网页;需多装一个桥脚本 | 装 `userscripts/courseauto-webai-bridge.user.js` → 面板 ⚙ → 勾「🌐 网页 AI 答题」→ 点「🔗 打开并连接网页 AI」→ 在弹出的 AI 网页里登录 |
| **API Key(最稳)** | 快、稳、可换模型;按量付费(DeepSeek 很便宜) | 面板 ⚙ → 勾「🤖 启用 AI 答题」→ 选平台 → 填 `sk-` 开头的 Key → 保存 |

推荐 **DeepSeek**;各平台注册地址、接口地址、模型名见 [docs/get-api-key.md](extras/docs/get-api-key.md)。
Key 只保存在你本机浏览器,不会上传到任何地方。

---

## ✨ 功能一览

| 功能 | 说明 |
|------|------|
| 📺 视频挂机 | 静音连播,播完自动下一个,自动切章;中途弹题答完继续 |
| 🎵 音频任务 | 静音自动播到结束 |
| 📄 文档 / 图片任务 | 自动滚动停留,看完即完成 |
| 📝 章节测验自动答题 | 提取题目 → **字体加密自动解密** → AI 作答 → **填充率 100% 才提交** → 可选提交后准确率检测与自动重做 |
| 🖼 图片题看图作答 | 题干/选项里的图片抓成 dataURL 随题发送(API 走多模态,网页 AI 走附件上传);纯图片题干会明确提示 AI「图片就是题面」 |
| ❓ 视频弹题自动作答 | 判断 / 单选 / 多选自动勾选,答完继续播放 |
| ⚡ 极速模式(默认) | 倍速上限 2x、答题与提交零延迟、零故意答错,均可在 ⚙ 调回保守值 |
| ⏰ 定时关闭 | 填 `HH:MM`,到点自动停止挂机(轮询判定,标签页被节流也不漏触发) |
| 🚀 进入页面自动开始 | 默认开:进课程/作业页直接开刷。关掉则停在「已暂停」,确认是这一节再点 ▶ |
| 🎯 提交后准确率检测 | 只对「可重复提交」节点生效:无错题直接过;有错题单独重问 AI → 写错题本 → 点重做 |
| 📤 未提交栏 | 填充率不足 / 找不到提交入口 / 复检未完成的节点统一记入,点开即看原因,可一键导出 |

---

## 🌐 平台支持

| 平台 | 已实现 | 状态 |
|------|--------|------|
| 学习通(超星) | 视频/音频/文档/图片任务、弹题、章节测验自动答题、提交后准确率检测、自动切章、作业页 | ✅ 完整 |
| 智慧树(知到) | 视频静音限速连播(≤1.5x,防时长不计)、目录树自动切节点、弹题作答 | ⚠ 实验版,测验/考试未实现 |
| 雨课堂 | 视频静音播放、**后台保活**(失焦不暂停)、弹题作答、自动连播、验证码熔断 | ⚠ 实验版,习题/讨论未实现 |

架构为**平台无关内核 + 每平台一个适配器**(`src/core` + `src/adapters`),`npm run build` 拼成单个 `.user.js`。
每个适配器带**自检**:平台改版导致选择器失配时面板会明确报错(而不是静默无反应),并把页面结构回传到本机采集端,
便于快速修复。智慧树/雨课堂的选择器按社区公开资料编写,可能与你遇到的真实页面有出入 —— 自检失败时把
`extras/probe/*.json` 发出来即可适配。

---

## 📖 使用说明

### 学习通入口(重要)

> ⚠️ 百度搜"学习通"出来的多是 App 下载页。**直接用这个链接:**

👉 **网页版登录:https://i.chaoxing.com**

登录(手机号 + 密码)→「个人空间」→「我学的课」→ 点开课程即进入章节学习页。
脚本只在**网页版**运行,App 与 Windows 客户端不支持。

### 挂机步骤

1. 打开上面的链接登录
2. 进入任意课程 → 打开章节学习页
3. 右下角出现黑白「📚 刷课助手」面板 = 已开始自动挂机
4. 挂着即可,浏览器可最小化(视频已静音,不吵,不影响你用电脑)

### 面板按钮

| 按钮 | 功能 |
|------|------|
| ▶ / ⏸ | 开始 / 停止挂机(待机显示 ▶,工作中显示 ⏸) |
| ▼ / ▲ | 展开 / 收起日志 |
| ⚙ | 设置面板(每项都带说明,改完点「💾 保存」) |
| 表头空白处 | 按住可拖动面板 |

### 设置项

**🎬 播放与节奏**

| 设置 | 默认 | 说明 |
|------|------|------|
| 🚀 进入页面自动开始 | 开 | 关掉后进页面停在「已暂停」,确认是这一节再点 ▶;下次进页面生效,不打断当前一轮 |
| 🎬 视频倍速 | 2 | 上限 2x。1 = 原速最安全,2x 被检测风险最高 |
| ⏰ 定时关闭 | 空 | 填 `23:30` = 每天到点自动停止;留空不关闭 |

**🤖 AI 答题 · 网页版(免 Key)**

| 设置 | 默认 | 说明 |
|------|------|------|
| 🌐 网页 AI 答题 | 关 | 勾选后不走 API,改由脚本驱动 AI 网页;需装「网页 AI 桥」并已登录 |
| 🔗 网页 AI 地址 | chat.deepseek.com | 支持 DeepSeek / 元宝 / Kimi / 豆包 / ChatGPT / 通义 / 智谱清言 |
| 📦 整卷模式 | 开 | 整页题目一次性发给 AI 批量回答(更快、不易限流);缺漏自动回退逐题 |
| 🖼 图片题看原图 | 开 | 把图片本体发给 AI,而非只发图片地址 |

**🤖 AI 答题 · API 方式**

| 设置 | 默认 | 说明 |
|------|------|------|
| 🤖 启用 AI 答题 | 关 | 开启后网页 AI 与题库都查不到的题交给大模型 |
| 🏢 AI 平台 | DeepSeek | 选平台后模型名与接口地址自动填好(共 8 个平台可选,含自定义) |
| 🔑 API Key | 空 | 只存本机浏览器 |
| 🧠 AI 模型 | deepseek-reasoner | 可点「📋 自动获取模型列表」拉取 |
| 🌐 接口地址 | DeepSeek 官址 | OpenAI 兼容,以 `/chat/completions` 结尾 |

**🛡 安全与拟人 / 🎯 准确率**

| 设置 | 默认 | 说明 |
|------|------|------|
| 🎭 故意答错率 | 0% | 拟人化:真人不会全对。填 8 = 8% 概率故意答错(多选不受影响) |
| 📤 自动提交测验 | 开 | 填充率**固定 100%**(不可改):有一题没填上就不交卷 |
| 📊 检测准确率 | 关 | 仅对可重复提交的节点:无错题直接过,有错题重问 AI 后点重做 |
| 📕 有错题就修 | 开 | 只要结果页有错题就修,哪怕整体准确率已达标 |
| 🎯 准确率阈值 | 90% | 关掉「有错题就修」时才生效 |
| 🔁 最多自动重做 | 2 次 | 到上限记入「未提交」栏,避免死循环 |

**🔧 其他**

| 设置 | 默认 | 说明 |
|------|------|------|
| 📖 自动切章 | 开 | 本章完成自动进下一章;切章后复核章节指纹,找不到下一章即判定到头 |
| 📡 状态上报 | 空 | 调试用:填本机地址(如 `http://127.0.0.1:8790/report`),脚本会定时推送页面状态。**只发往你自己填的地址** |
| 📋 导出已收集题目 | — | 把做过的题复制到剪贴板 |

---

## ❓ 常见问题

**Q:打开课程页没有面板?**
依次查:① 油猴已装且脚本开关开启;② 扩展设置里「允许用户脚本」已打开(Edge/Chrome 新版默认关闭);③ F5 刷新;④ 跑 `npm run detect` 看本机是否真装上了油猴。

**Q:视频不自动播放?**
浏览器禁止网页自动放声音。在页面上随便点一下鼠标,之后全程自动(脚本已静音)。

**Q:测验显示"未查到答案"?**
查 AI 通道是否配好(网页 AI 是否已连接 / API Key 是否填写并勾选)。冷门题也可能答不上,脚本会自动暂存不提交。

**Q:字体加密是什么?**
学习通把题目文字用自定义字体打乱防抄题。脚本已内置自动解密(Canvas 字形对比),无需理会。

**Q:开着梯子(全局代理)AI 答题全失败?**
DeepSeek / MiniMax / 智谱都是**境内服务**,全局代理会把 API 请求劫持到境外节点从而失败(学习通有直连白名单所以正常)。解决:① 刷课期间退出梯子;② 或切**规则模式**,把 `api.deepseek.com`、`api.minimaxi.com`、`open.bigmodel.cn` 等加入直连。

**Q:考试能用吗?**
**不建议,风险极高。** 本脚本不含考试页功能,也不要考试时使用。

## ❓ exe文件安装后使用网页ai答题的常见问题

**Q:一直显示“仍在等网页AI页面就绪”**
**检测exe文件打开后的命令行窗口是否被关闭。网页ai答题需要中转答案。连接成功网页ai页右下角会显示绿色，否则为红色**

**exe程序会默认打开默认浏览器，如果你是使用别的浏览器需要重新打开安装向导网址**

---

## 🔒 安全与合规建议

1. **倍速保持 1x**:挂机就是挂机,让视频真实走完
2. **每天刷课 ≤ 4 小时**,一门课分几天完成
3. **正常时段**刷课,不要整夜挂机
4. 刷课时**手机 App 退出登录**(平台会做"多终端"检测)
5. 测验偶尔留错题(把「🎭 故意答错率」设 5~8%),不要门门满分
6. **考试不碰脚本**

---

## 📁 项目结构

```
courseauto/
├── userscripts/                  # 发布物(构建生成,勿手改)
│   ├── courseauto.user.js               # 主脚本(刷课/答题/面板)
│   └── courseauto-webai-bridge.user.js  # 网页 AI 桥(免 Key 答题)
├── src/                          # 源码:平台无关内核 + 三平台适配器
│   ├── 00-meta.txt                      # 元数据(@version 是版本号唯一源头)
│   ├── core/                            # 05-registry 平台注册 / 10-config 配置 / 15-clock 定时关闭
│   │                                    # 20-util 工具 / 25-image 图片处理 / 30-panel 面板
│   │                                    # 40-answer 答题 / 50-font 字体解密 / 70-update 自动更新 / 90-main 主流程
│   └── adapters/                        # chaoxing.js / zhihuishu.js / yuketang.js
├── local/                        # 本机服务:安装向导 + 网页 AI 中转
│   ├── core.mjs                         # 安装/中转/采集/环境检测(客户版与开发版共用)
│   ├── app.mjs                          # 【客户版入口】被 pack 打进 exe
│   ├── setup.mjs                        # npm run setup:检测 → 起服务 → 打开向导
│   ├── server.mjs                       # 开发用:core + 模拟学习通页面 + 假 AI
│   ├── detect.mjs                       # 扫描浏览器扩展,判断油猴是否已装
│   ├── pages/setup.html                 # 四步安装向导
│   └── lib/gm-shim.js                   # GM API 垫片(无油猴时跑脚本用)
├── tools/                        # build.mjs(拼脚本) / pack.mjs(打 exe)
├── extras/                       # 非程序文件
│   ├── tests/                           # 端到端沙箱(无头浏览器 + 断言)
│   ├── mock/                            # 模拟页:章节/视频/测验/新老结构
│   ├── docs/                            # 模块文档 + API Key + 部署指南
│   ├── README.md                        # 模拟站点与测试沙箱说明
│   └── 自检-答题记录检查.js              # 浏览器控制台粘贴即用的答题记录自检工具
├── .github/workflows/ci.yml      # CI:构建 + 语法 + 版本一致性校验
├── version.json                  # 自动更新标记(构建自动同步,勿手改)
├── LICENSE / LICENSE-MIT-upstream# 本项目许可 / 上游 MIT 保留
└── package.json                  # 命令:setup / mock / build / pack / test
```

不入库,由命令生成:`dist/`(exe 与 zip)、`build/`(打包中间产物)、`extras/probe/`(真实页面结构采集)、
`extras/tests/out/`(测试截图与日志)、`node_modules/`。

---

## 🧩 模块文档

| 模块 | 文档 | 内容 |
|------|------|------|
| 📝 自动答题 | [模块-自动答题.md](extras/docs/模块-自动答题.md) | 题面提取三容器、字体解密、答案通道、提示词三道保险、填选与提交策略、排错速查 |
| 🎯 练题自测 | [模块-练题自测.md](extras/docs/模块-练题自测.md) | 双屏答疑布置、省 token 的读题法、人机分工红线、答题记录自检、错题复盘 |
| 🔑 API Key 申请 | [get-api-key.md](extras/docs/get-api-key.md) | 6 家平台开通与充值步骤、常见坑 |
| 🚀 真实环境部署 | [部署-真实环境.md](extras/docs/部署-真实环境.md) | 一键向导、线上直装、版本发布、真实站点验证清单、故障排查表 |
| 🌐 多平台规划 | [规划-多平台适配.md](extras/docs/规划-多平台适配.md) | 适配器接口约定与扩展思路 |

---

## 🛠 开发与构建

```bash
git clone https://github.com/None-wu/courseauto.git
cd courseauto

npm run build       # src/ → userscripts/*.user.js,同时同步 version.json 与 package.json 版本号
npm run mock        # 本地模拟站点(章节/视频/测验)+ 假 AI:http://127.0.0.1:8790
npm run setup       # 安装向导:http://127.0.0.1:8790/setup
npm run detect      # 检测本机浏览器是否已装油猴
npm run pack        # 打包客户版 exe + zip 到 dist/(需要 bun)
```

端到端测试(无头浏览器,首次需 `cd extras/tests && npm install`):

```bash
npm run test        # 学习通主流程(13 项断言)
npm run test:all    # 全量 16 个套件
npm run test:headed # 有头模式,肉眼看流程
```

`test:all` 覆盖:主流程 / 网页 AI / 测验 / 新版结构 / 判断题 / 多选题 / 设置持久化 / 准确率与重做 /
暂停恢复 / 自动开始开关 / 智慧树 / 雨课堂 / 中转诊断 / DeepSeek 输入条 / 图片题 / 图片卷。

**改动约定**

- **只改 `src/`**,`userscripts/*.user.js` 是构建产物,CI 会校验"构建后仓库无改动"
- 升版本只改 `src/00-meta.txt` 的 `@version`,构建时自动写进 `version.json`(自动更新靠它)与 `package.json`
- 平台改版导致选择器失配时,先用 `npm run mock` 复现,改完补一条 `extras/tests/check-*.mjs` 断言再合入
- 模块细节见 [extras/docs](extras/docs)

---

## 📝 更新日志

### v1.5.6 — 文档/PPT 任务重做 + 自动切章修复

- 文档类任务(PPT / PDF / Word)统一走逐段滚动:滚到底 → 找「下一页」 → 轮询进度图标变绿,单节点最长 90s、最多 3 遍,不再"只滚一次干等 1 秒"
- `.pptx` 并入文档分支,不再漏做
- 切下一章优先点页尾 `#prevNextFocusNext`,隐藏按钮跳过;没有页尾按钮时回目录点下一章
- 完成态按节点 iframe `src` 匹配,列表重绘后仍能正确识别已完成节点,避免重复做
- 未完成原因按类型分别提示(文档 / 视频 / 作业 / 测验)
- 新增 ⚙ 开关「➡️ 本章做不掉就跳下一章」,默认开启;关闭后停在本章等人工处理

### v1.5.5 — 可选「进入页面自动开始」

- 新增 ⚙ 开关「🚀 进入页面自动开始」,默认开启(与旧行为一致);关掉后进页面停在「已暂停」,点 ▶ 才开始,保存后下次进页面生效
- 三平台启动入口统一走 `autoStartEnabled()` 判定,无平台漏判;暂停态点 ▶ 按页面类型分发恢复(章节轮询 / 作业整卷 / 智慧树 / 雨课堂),旧版章节页切 mooc2 的整页跳转放行一次,避免"点了开始、跳回来又被停住"
- 新增 `test:autostart`(13/13),全量回归全绿

### v1.5.2 — 弹窗式判分识别 + 假重做入口过滤

- 识别「未达及格线,请重做」这类**无分数无对错图标**的弹窗判分:先点掉弹窗再重读判分,读不到就按未达线处理,照常修错题
- 弹窗提示文字不再被误当重做按钮;隐藏(`display:none`)的重做按钮不再误点,避免白耗重做额度

### v1.5.1 — 提交回执校验 + 错题判定补强 + 切章收尾

- 提交后回读页面确认已进结果页/出现重做入口,仍停在作答态则重试一次并点确认,两次失败记入「未提交」栏
- 只有「我的答案/正确答案」两行文字的判分页改为文本比对判对错;错题为 0 直接短路进下一节点
- 找不到「下一章」即判定课程到头,不再空转重试;切章后复核章节指纹

### v1.5.0 — 提交语义重构

- 「正确率阈值」实为填充率,改名并**固定 100%**;新增提交后**准确率检测**与错题单独重问 + 自动重做
- 新增「未提交」栏;删除每日时长上限,改为**定时关闭**(`HH:MM`)
- 修复中转站点诊断、旧式 checkbox 重做残留、章节循环死锁;清理废弃代码

### v1.4.4 — DeepSeek 新输入条发送失败

- DeepSeek 换成受控输入条后只改 DOM 值不更新框架状态,发送键置灰。改用 `execCommand('insertText')` 走编辑管线,发送优先主色圆钮并补 pointer 序列,全失败再逐字符重填 + 回车兜底

### v1.4.0 — 更名为 courseauto / 刷课助手

- 项目改名,脚本 `@name`、安装地址、仓库地址同步更新(油猴视为新脚本,需先删旧版)
- 新增单文件 exe 分发、一键安装向导、网页 AI 中转

> 更早版本(v1.0.x ~ v1.4.3)见 [Releases](https://github.com/None-wu/courseauto/releases) 与 `.git` 提交记录。

---

## 🙏 致谢

- **[DaRin1403/xuexitong-autostudy](https://github.com/DaRin1403/xuexitong-autostudy)** — 上游项目,本仓库在其基础上二次开发(上游部分仍为 MIT,见 [`LICENSE-MIT-upstream`](LICENSE-MIT-upstream))
- [ocsjs(OCS 网课助手)](https://greasyfork.org/cs/scripts/457151)
- [chaoxing-toolkit](https://github.com/pang-qin/chaoxing-toolkit)
- [fuckCourse](https://github.com/sheshuyu/fuckCourse) / [Samueli924/chaoxing](https://github.com/Samueli924/chaoxing)

---

## 📄 License

**个人非商业使用许可(Personal Use Only, No Commercial Use)** © courseauto contributors

- **允许**:个人学习、研究、自用;为自用修改源码;向其他个人无偿分享未修改的原始副本。
- **禁止**:任何商业使用 —— 出售、出租、收费下载/代刷/代挂、付费服务或 SaaS、捆绑进商业产品、企业或机构内部批量使用、以本项目为主要内容变现、去名后分发等。
- **上游部分**:继续适用原始 MIT 许可,不可撤销,见 [`LICENSE-MIT-upstream`](LICENSE-MIT-upstream)。

完整条款见 [LICENSE](LICENSE)。如需商业授权,请通过仓库 Issue 联系作者取得书面许可。

---

## ⚠️ 免责声明

本脚本仅供个人学习辅助与技术研究使用,严禁用于商业用途或任何违反平台服务条款、学校管理规定的行为。
使用本工具产生的一切后果由使用者自行承担,开发者不承担任何责任。平台可能更新反作弊机制导致部分功能失效,
不保证持续可用。

 **有问题或者有优化和功能的建议可以发送邮件到None-wu@outlook.com**
