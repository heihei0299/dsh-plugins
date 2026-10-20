# DSH SmartUI

给现有 DSH 添加 **ChatGPT 风格外观 + 对话内声明式交互组件**。不是独立聊天网站，不替换模型、会话、编辑器或权限审批。

## 当前状态

首版源码已完成并安装到当前 `web` profile。用户已确认设置和三个建议入口可见，真实会话工具已成功记录五类组件的验收文档。根据用户反馈，`0.1.1` 已将草稿中的内部 JSON 改成可读回复；类型检查、31 项测试、构建及产物契约检查通过，官方 CLI 移除和重新添加也均成功。浏览器是否已加载新版代码仍需刷新确认。**更新后的实际交互、主题切换和禁用恢复仍待验收**，不能仅凭工具返回宣称全部验证完成。详见 [验证记录](<docs/validation.md>)。

首版针对 DSH `0.2.1-rc.2`。插件安装到一个 profile 后，影响该 profile 下所有会话；不会启动第二个 Web 服务或修改已安装 DSH 核心。

**交接状态、已验证项、未验证项与接手步骤见 [HANDOFF.md](<HANDOFF.md>)。**

## 能做什么

- 原生 Chat 保持工作区、模型选择、流式回答、历史、附件、发送/停止及审批能力。
- 可撤销的明暗主题 token 层；这是 ChatGPT 风格增强，不是整页像素级复制。
- `render_smart_ui` 工具展示 `card`、`table`、`chart`、`form`、`choices`。
- 表格本地排序和复制，柱状/折线图提供原始数据表，表单支持字段校验。
- 所有交互使用白名单数据，没有 HTML、JavaScript、shell、任意 URL 或远程脚本执行。
- 操作仅填入当前会话的原生草稿；**用户审阅并发送后才进入后续对话**。有文字选区、命令草稿、编辑器锁定或 revision 变化时拒绝写入，不退回覆盖草稿。
- UI 文档随标准工具结果 metadata 保存；未提交表单、排序及展开状态不承诺刷新恢复。

## 开发与安装

使用 pnpm，不做全局安装。依赖安装、构建、类型检查、测试及安装进 profile 必须针对当前任务与环境另行授权。

```bash
# 仅在明确授权后执行
pnpm install
pnpm run typecheck
pnpm test                 # Node 测试文件串行运行
pnpm run build            # 生成 dist/host/index.js 和 dist/client.js
pnpm run verify:bundle    # 检查惰性 factory、宿主 React、资源与清理契约
```

构建产物是 DSH Host 模块和 `window.__ModuleLoader__` 惰性 Client factory。React 从宿主模块表获取，不能用 Vite 静态页或第二个 React 应用代替安装验证。运行时依赖在包清单中声明为 peer；离线环境需预先准备对应版本。

获安装授权后，可在现有 DSH 插件管理器选择本地 bundle，或使用同样经过版本检查与 profile 写锁的官方 CLI：

```bash
dsh plugin --profile web add link:/home/shial/Project/dsh-smartui --offline
```

`link:` 使用已准备好的工作区与依赖；离线安装不从注册表补齐缺失包。不手改 profile 的依赖清单或 patch，也不启动另一个服务器。

检查安装返回的实际应用状态及诊断；需要重启时按提示操作，然后刷新现有 DSH 页面。新增插件可能由 DSH 同步，但本项目没有保证自动重建或 HMR。更换包代码可能需要 Host 重启。

### 设置

设置 → 通用 → **SmartUI**：

| 字段 | 默认 | 作用 |
|---|---|---|
| `appearance` | `chatgpt` | `chatgpt` 主题层或 `native` 原生外观 |
| `enableComponents` | `true` | 是否接受新的 UI 文档并提供组件交互 |

设置由 Host 的 `dsh-smartui` entry 持久化，经现有 ConfigForms 传输，不另建 Remote 或浏览器存储。加载期间不抢先应用主题；Host 拒绝保存时保留最后接受的配置。

关闭组件后，工具定义仍注册，但 Host 拒绝新的文档，提示词要求使用普通文本；历史卡片只保留文本展示。禁用整个 bundle 则撤销 Client 注册、主题层及 Host 工具。没有渲染器时，标准工具摘要仍可读。

## 使用

选中工作区后，空草稿上方提供“对比方案 / 分析数据 / 收集需求”入口。入口只填入请求，不自动发送。也可以正常发消息：

> 用交互表格比较这三个方案，再给我几个后续分析选项。

> 把这份真实数据展示为柱状图；没有数据就先向我索取。

> 用简短表单收集项目需求，不要询问任何凭据。

模型决定何时调用 `render_smart_ui`，普通回答继续使用 Markdown；不是把任意 Markdown 自动识别为组件。首版卡片使用原生工具调用展示位置，受 DSH 的过程折叠设置影响；若完成回答后过程被折叠，需要展开对应工具记录查看卡片。尚未另做独立常驻的回答附件区域。

工具参数为 `{ "document": { "schemaVersion": 1, "summary": "…", "blocks": [] } }`；实际 `blocks` 必须有 1–20 项。完整示例见 [方案对比](<examples/comparison.json>)、[图表](<examples/chart.json>) 和 [表单](<examples/form.json>)，均显式标记为虚构示例数据。详细结构见 [协议](<docs/protocol.md>)。

表单或选项的“填入对话”使用可见标题、字段名称和选项标签，生成与当前语言一致的可读回复，例如“关于「五类组件是否显示正常？」，我选择：卡片、表格、图表、表单、选项都正常。”。内部 callId、actionId 与 JSON 协议不会直接填入草稿。**这不代表已经提交或执行**。不要输入密码、API key、token 或其他凭据；正常发送会将填写内容写入会话日志。

在不安全的 HTTP 页面中，浏览器可能禁止剪贴板 API。此时会展示可选择的文字供手动复制，不尝试绕过浏览器权限。表格复制会处理常见电子表格公式前缀，但不保证第三方表格应用的所有解释行为。

## 验证与限制

测试包括协议与大小限制、metadata 重放、状态/错误降级、动作校验、选区保护、主题清理、语言资源平衡，以及真实组件的静态 HTML 输出/XSS 检查。静态 HTML 测试只是单元测试，不是运行中 DSH 的视觉验收。

真实页面仍需检查明暗/窄屏、中文输入法、消息滚动、原生审批与附件、刷新重放及禁用恢复。参见 [兼容性与验收](<docs/compatibility.md>)。

首版不包括 Canvas、任意页面生成、自动提交动作、外部应用写操作、持久化未提交表单或独立 UI 数据库。

## English summary

DSH SmartUI adds a reversible ChatGPT-inspired appearance and safe declarative cards, tables, bar/line charts, forms and choices to native DSH conversations. It does not replace the conversation engine, editor, model connection or approvals. `render_smart_ui` stores its versioned document in tool-result metadata and keeps a text fallback. Actions only insert reviewable text into the scoped native draft; users send it themselves. No generated HTML, scripts or arbitrary commands execute. Draft selections are not overwritten. Installation and all local builds/tests require explicit authorization. Browser acceptance is still required.

## License

[MIT](<LICENSE>)。插件图标为本项目原创，不使用 OpenAI 标志；本项目与 OpenAI 无关联。
