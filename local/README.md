# local/ · 本机服务(安装向导 + 网页 AI 中转)

这个目录承载「让脚本装进真实浏览器」和「网页 AI 中转」的全部本机能力，**没有任何第三方依赖**。

## 命令

```bash
npm run setup      # 检测浏览器 → 起服务 → 自动打开安装向导(默认 8790)
npm run app        # 客户版入口(不打包也能跑,行为与 exe 一致)
npm run detect     # 只检测并打印:本机有哪些浏览器、是否装了油猴
npm run mock       # 开发用:安装接口 + 中转 + 模拟学习通页面
npm run pack       # 打包成 dist/刷课助手-vX.exe(单文件,见 tools/pack.mjs)
```

也可以直接跑：`node local/setup.mjs 8800`（自定义端口）。

## 它做了什么

| 文件 | 作用 |
|------|------|
| `core.mjs` | **唯一一份**路由实现：安装向导、脚本分发、`/api/env`、`/api/webai/*` 中转、`/api/probe` 采集。客户版与开发版都复用它 |
| `app.mjs` | 客户版入口：起服务 + 自动开浏览器 + 中转日志；打包成 exe 时资源(两个脚本 + 安装页)已内联，不依赖磁盘 |
| `setup.mjs` | 开发机入口：检测 → 启动 `server.mjs` → 用默认浏览器打开 `/setup` |
| `detect.mjs` | 扫描 Chrome / Edge / Brave / Vivaldi 各 profile 的 `Extensions/*/manifest.json`，按扩展名识别 Tampermonkey、Violentmonkey、脚本猫（支持 `__MSG_` 本地化名称）；并从 `Secure Preferences` 读出「允许用户脚本」总开关状态 |
| `pages/setup.html` | 四步安装向导（黑白主题）：装管理器 → 开「允许用户脚本」→ 装脚本 → 直接点进三个刷课网站；未就绪 3 秒重检、就绪后 10 秒 |
| `server.mjs` | 开发用：`core.mjs` + 模拟学习通页面 + 假 AI 接口（模拟页面在 `extras/mock/`） |
| `lib/gm-shim.js` | 在无油猴环境里补 `GM_getValue / GM_setValue / GM_xmlhttpRequest / GM_info`，供演示模式与端到端测试使用 |

## 路由（core.mjs）

| 路径 | 说明 |
|------|------|
| `/setup`、`/` | 安装向导页 |
| `/api/ping` | 存活探针：客户版用它判断「是否已有本程序在跑」，避免重复启动 |
| `/api/env` | 返回本机浏览器与油猴检测结果（JSON） |
| `/install/courseauto.user.js` | 主脚本安装地址。以 `.user.js` 结尾且 `Content-Type: text/javascript`，油猴会拦截并弹出安装页 |
| `/install/courseauto-webai-bridge.user.js` | 网页 AI 桥安装地址 |
| `/install/xxx.user.js?download=1` | 强制下载（`Content-Disposition: attachment`） |
| `/api/webai/ask`、`/next`、`/answer`、`/requeue`、`/status` | 网页 AI 中转：主脚本放题 → 桥脚本取题 → 回传答案 |
| `/api/probe`、`/api/probe/list` | 适配器自检失败时回传真实页面结构（客户版落盘到 `%LOCALAPPDATA%\XueXiTongAssistant\probe`） |
| `/report`、`/report/last` | 状态上报接收端，供调试查看脚本推来的快照 |

开发版另有（客户版没有）：`/mycourse/studentstudy?demo=1` 等模拟页面、`/v1/chat/completions` 假 AI、`/gm-shim.js` 垫片。

## 说明

- 扩展**无法静默安装**：Chrome/Edge 只允许官方商店安装，这是浏览器安全策略。向导的做法是「检测状态 + 给直达商店入口」，装完自动变绿。
- 检测只覆盖本机 Chromium 系浏览器的默认配置目录。Firefox、360、QQ 浏览器等需手动安装，向导里会提示。
