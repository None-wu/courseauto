# dev/ · 端到端测试沙箱

把主脚本在**没有真实学习通账号**的条件下完整跑一遍：`local/` 里的模拟站点 + GM 垫片 + 无头 Chromium，验证挂机全流程是否还走得通。

## 快速开始

```bash
cd dev
npm install            # 只装 playwright-core（浏览器复用本机已下载的 Chromium）
npm test               # API 通道：11 项断言 + 截图 + 日志
npm run test:webai     # 网页 AI 通道：13 项断言（postMessage 桥链路）
npm run test:quiz      # 章节测验直嵌结构：8 项断言（加 --webai 走网页 AI，9 项）
npm run test:headed    # 开真实浏览器窗口看全过程
```

也可以从仓库根目录跑：`npm test` / `npm run test:quiz` / `npm run test:webai`（等价）。

手动观察：根目录 `npm run mock`，然后浏览器打开
`http://127.0.0.1:8790/mycourse/studentstudy?mooc2=1&demo=1`（`demo=1` 会自动注入垫片与脚本，直接看到黑白面板挂机）。

## 目录

| 文件 | 作用 |
|------|------|
| `run.mjs` | Playwright 驱动：拉起 `local/server.mjs`、注垫片、注被测脚本，轮询面板日志与各 iframe 状态，断言后截图落盘 |
| `out/run.png` `out/run.log` | 最近一次运行的截图与完整日志 |
| `out/check-*.mjs` | 临时截图脚本（配置面板、安装向导页） |

被测脚本路径固定为 `../userscripts/courseauto.user.js`；模拟站点、页面、GM 垫片都在 `../local/`，测试与安装器共用一份，避免两套 DOM 契约漂移。

## 覆盖的场景

- 视频任务：伪 `videojs` 播放器按倍速走完，中途注入视频弹题（单选），验证弹题作答与「继续学习」恢复播放
- 章节测验：单选/判断/多选/填空 4 题，自动作答并自动提交（`btnBlueSubmit`）
- 音频、PDF、图片任务
- 自动切章：第 1 章结束点 `.nextChapter` 进入第 2 章
- 状态上报链路：`/report/last` 可查最近收到的快照
- **网页 AI 通道**（`test:webai`）：主脚本把题目 postMessage 到模拟对话页 `/ai`，桥脚本填入输入框、点发送、抓回复回传（CX_HELLO 握手 + CX_ASK/CX_ANSWER），截图在 `out/run-ai.png`

## 已知边界（未覆盖）

- 字体加密解密（`decodeFont`）需要真实加密字体样本，未模拟
- UEditor 富文本简答题写入（`tryUE`）需要 UEditor 环境，未模拟
- 自动更新检测（jsDelivr）、题库站通道（useTiku 默认关闭）未模拟

## 常用调试入口

- 假 AI 应答表在 `../local/server.mjs` 的 `AI_TABLE`（按题面关键词返回固定答案）
- 改页面结构后重跑 `npm test`，断言失败先看 `out/run.log` 的面板日志
- `GM` 配置存在 localStorage（键前缀 `cxMock:`），清掉即恢复默认配置
