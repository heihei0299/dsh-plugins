# 兼容性与验收

## 支持基线

当前以 DSH `0.2.1-rc.2` 的已安装公开声明、README 及官方插件模板为依据。不承诺其他版本的兼容性。`engines.dsh` 精确声明此版本，不绕过 DSH 的版本检查。

| 接口 | 使用方式 |
|---|---|
| `@deepseek-ai/dsh-tools` | `defineTool`、canonical output、`presentationMeta`、effect-owned register |
| `@deepseek-ai/dsh-system-prompt` | 新增可撤销 section；不替换 assembly |
| `tool.call.toolview` | 仅注册 `render_smart_ui` key，遵循 preparing/start/result；只显示摘要与文本回退 |
| `uiConversation.events.register` | 注册 `smartui-document` Conversation Definition，只读取成功结果里的 `meta.smartui` |
| `conversation.chat.node` | 仅新增 `smartui-document` key；`groupTree: 'turn'` 让它留在过程折叠之外 |
| Session 标准 props | `sessionId`、`useInput`、`inputActions.captureInsertion/insertText` |
| `ctx.locale` | 双语 namespace 注册及订阅 |
| `ctx.theme` | `overrideTokens`，只覆盖 alias token，明暗配对，清理还原 |
| `ctx.configForms` | 读取/编辑 Host `dsh-smartui` entry 的 volatile 配置 |
| `settings.general.item` | 本插件自有设置行 |
| `conversation.input.dock` | 仅空会话（`session.blank`）且草稿为空时的快捷建议；已有消息的会话不渲染（`0.1.2` 修复） |

Client 不在运行时 import 任何 DSH Client 内部包，只依赖宿主 React 和上表公开对象。相关边界保留为本插件的最小结构类型，而不是伪装提供一份完整的宿主 SDK；升级时须重新对照 DSH 实际声明和集成测试。

默认保留原生聊天布局、消息流、Lexical 编辑器、权限审批、工作区和工具轨迹。不替换 root、sidebar、conversation.chat.flow 或其他工具的 renderer，只新增自己的 Chat 行 kind；不依赖宿主 DOM、私有类名、全局样式选择器或组件源码。

## 验证分层

1. **静态/单元测试**：协议、动作、元数据恢复、Host 工具、主题 disposer、资源平衡、组件输出。可以验证代码约束，不能证明当前浏览器已经显示插件。
2. **构建**：检查输出为 Host ESM 与带正确包 ID 的惰性 Client factory，外部模块仅为宿主 React，资源路径存在。
3. **安装/加载**：通过 DSH 插件管理入口安装，读取实际 application 状态及诊断；单纯安装成功不等于视觉验收完成。
4. **真实页面**：在原有 DSH URL 验证下面的场景，不以 mock 页面、静态渲染或新服务器代替。

## 真实页面验收清单

> 2026-10-20 第二轮 CDP 实测（`http://127.0.0.1:50020/`，1440×900 与 320×800 视口）。勾选表示已完成；括号内注明未覆盖的细节。
> 2026-10-21 Codex 补测：使用 Node 内置 WebSocket 直连现有 CDP `127.0.0.1:9222`，A/B 真实页面验证通过；不需要内置浏览器工具或 Chrome 扩展。C1 计划模式已用 `/plan` 命令实测（此前 N/A 为误判），C2 权限审批仍 N/A（选择器只提供「完全权限」）。方法、清理限制及边界见 `validation.md`「Codex 补测」。

- [x] 插件管理器显示正确名称、描述及图标，无回退诊断；中文与英文界面文案均已验证（数据内容保持原语言）。
- [x] 设置 → 通用显示 SmartUI（用户确认）。
- [x] 外观和组件开关独立（在线切换 components 立即在文档/降级摘要间切换；外观切换只改主题 token）。
- [x] B. 在真实设置页临时替换 SmartUI `form.set`，分别返回 `false` / 抛错；原生点击交互组件下拉框尝试关闭后，出现 `settings.refused` / `settings.error` 中文提示，均回弹为开启且恢复可操作。配置 snapshot（含 revision）不变，原函数已恢复；此项为前端故障注入，不是实际 Host 拒写或断网测试。
- [x] 明暗主题可读，切回 native 或禁用插件后还原（深色 `rgb(33,33,33)`/文字 `rgb(236,236,236)`，切回浅色还原；native 后 body 文本色还原）。
- [x] 320px 窄屏和 1440px 桌面宽度均无页面级横向溢出；表格容器自身横向滚动（本次内容未溢出）。
- [x] 空会话草稿上方可见三个建议入口（用户确认；草稿填入 65 字后 launcher 消失、消息数 0）；已有消息的会话不再显示该行（`0.1.2`，桌面与 390×844 移动视口实测 launcher=0，新会话=1）。
- [x] 点击建议只填草稿，不自动发送。
- [x] 真实模型产生的对比表、柱状图和表单可显示（历史 metadata 重放后五类 block 各 1）；组件关闭时显示降级摘要而非空白。
- [x] 表格可排序（`aria-sort` 与行序联动）；复制成功路径已验证（卡片得到纯文本、表格得到含表头 TSV），无手动复制回退。
- [x] 表单必填校验生效（2 条错误提示 + `aria-invalid`），图表有完整原始数据表。
- [x] 填入动作不覆盖非空选区（全选 118 字后草稿不变）；命令草稿（`/`）下插入被拒绝；生成中点击动作会被接受并随排队消息发出（DSH 运行中保持输入可编辑，无锁定态）。
- [x] 用户审阅并使用原生 Send 后，对话内容是可读自然语言且模型能据此回应（实测发送「关于「继续吗？」，我选择：停止。」，模型回复「已按「停止」处理」；`0.1.1` 起不再携带 `actionId`/`blockId`）。
- [x] 切换会话不会把一个会话的动作写入另一个会话（草稿 `/` 仅存在于原会话）；未提交表单只是局部状态。
- [x] 刷新后从已记录 metadata 恢复组件（刷新、禁用/重启用、重开会话均复现）。
- [x] A. 两个独立会话副本分别构造 `schemaVersion=2` / 缺失 `blocks`，刷新真实页、打开副本并展开工具步骤，均显示可见可读文本兜底（`.smartui-fallback` = 1），无 `slot entry crashed` 或未捕获异常。源文件 SHA-256 不变，实验目录已删除；宿主仍保留两个副本的残留侧栏项，未重启服务清理，不应再打开它们。
- [x] 原生命令发送与代码块：短消息可发送、可停止（「已停止」「1 轮 1 步」）；代码类回答渲染 `pre code`，无异常。
- [x] 原生附件：附加 `package.json` 后输入区显示文件卡片，可移除。
- [x] 逐字流式（MutationObserver 记录 71 次 DOM 变更、22 个不同长度、跨度约 12.5 秒）与排队发送（生成中按 Enter → 本轮结束后作为下一条用户消息投递）。
- [x] C1. 计划模式：此前记为 N/A 是误判。`/plan` 斜杠命令（`@deepseek-ai/dsh-plan-mode` 随 base/web-app 安装，客户端 bundle 已加载）可进入/退出计划模式；进入后输入区出现「计划模式已开启，按下关闭」控件，`.smartui-root` 仍为 1、无报错；点控件退出后状态复原。
- [ ] C2. 权限审批：仍为 N/A。profile 配置定义了 `read-only` / `workspace-write` / `danger-full-access` 三个预设，但「访问模式」选择器实际只提供「完全权限」，无法切到 `approval: ask` 的预设，缺少会触发审批卡片的场景。
- [x] 禁用/重新启用无重复卡片、主题层或注册，无 `slot entry crashed`（重置后 roots 恢复、doc 1、五类 block 各 1）。

第一轮 CDP 检查覆盖 launcher、建议填入、草稿清空与设置页；第二轮补齐组件渲染、表格/图表/表单交互、主题、窄屏、禁用恢复、metadata 重放、剪贴板内容、英文界面、端到端发送、附件、逐字流式与排队发送。`http://127.0.0.1:50020/` 为可用地址（`arch.local:50020` 在调试 Chrome 中报 `ERR_EMPTY_RESPONSE`，`127.0.0.1:3080` 返回 401）。当前未发现 `dev:web` watcher；包替换按 DSH 安装反馈决定是否需重启，然后刷新原有页面。
