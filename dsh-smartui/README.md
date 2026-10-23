# DSH SmartUI

给现有 DSH 添加 **ChatGPT 风格外观 + 对话内声明式交互组件**。不是独立聊天网站，不替换模型、会话、编辑器或权限审批。

**当前实现规格与完整 v1 协议见 [spec](<docs/spec.md>)。** 包版本为 `0.1.3`，协议为 `schemaVersion: 1`；历史交接记录不作为当前实现规范。

> `docs/`、`HANDOFF.md` 与 `pnpm-lock.yaml` 是本地设计与验证记录，按仓库策略不纳入 git；本 README 与源码是分发后的契约来源。

## 本轮改造：参考 GenUI 的本地交互看板

参考 [omdsh-dev/dsh-genui](https://github.com/omdsh-dev/dsh-genui/tree/ad8dc166deaf4eee7dea758fc0a84a8728402b52) 的声明式小组件、布局组合和本地优先交互理念，独立实现以下增量，无新增运行时依赖、未复制其引擎、图标或样式：

- `stat`：指标数字、明确语义的变化量和可选微趋势图；`progress`：0–100 的条形/环形进度；`callout`：信息、成功、注意、错误提示。
- `group`：一层 `row` / `column` / `tabs` 组合。用 `blockIds` 引用同一份扁平 `blocks` 中的叶节点，禁止嵌套、重复归属及悬空引用；被分组的节点只在组内显示。标签页支持左右键、Home/End，切换时保留已挂载表单、选项和表格筛选状态。
- 表格新增跨列本地搜索、匹配行数、TSV / CSV / Markdown 复制导出。导出包含表头和**筛选后当前顺序**的数据；CSV/TSV 防常见公式前缀，剪贴板不可用时仍可手动复制。
- 新会话提供“创建看板”建议，仍然只填草稿，不自动发送。

**有意保留的边界：**继续使用 `render_smart_ui` 与 `meta.smartui`、Turn 级对话行、v1 严格校验及 64 KiB / 20 区块预算（group 也计数），兼容原有五类文档。不是 GenUI 协议的兼容实现：不解析正文 `dsh-ui` 围栏，不接管聊天 DOM，不引入自动发送、常驻面板、Computed 表达式、外部图表引擎或本地持久化未发送输入。切页保留不等于刷新恢复。

完整示例：[虚构数据看板](<examples/dashboard.json>)。调用方式为 `render_smart_ui({document: …})`，其中 `document` 为示例 JSON 的完整内容。新字段速查：

| 类型 | 必需字段（除 `id`、`type`） | 可选字段（均可带 `title`） |
|---|---|---|
| `stat` | `value`: 字符串 | `delta`、`caption`、`tone`、`spark`: 2–60 个有限数值 |
| `progress` | `value`: 0–100 的有限数字 | `variant`: `bar` / `ring`，`caption` |
| `callout` | `body`: 纯文本 | `tone` |
| `group` | `layout`: `row` / `column` / `tabs`，`blockIds`: 非空叶节点 ID 数组 | — |

`tone` 只允许 `neutral` / `success` / `warning` / `error`；上涨不自动等于成功。新增文本继续遵守既有长度边界；数值与 spark 点仍限制在 ±1e12。分组按 group 在 `blocks` 中的位置展示，组内按 `blockIds` 排列；未归组的节点保留顶层顺序。

本轮验证：`pnpm run typecheck`、68 项串行测试、`pnpm run build`、`pnpm run verify:bundle` 均通过。另用真实组件和测试环境做了隔离 Chromium 验收：筛选、带表头的可见 CSV 复制、切页保留输入、左右/Home/End 焦点、显式填草稿、剪贴板手动回退；明暗主题 × 320/390/1000px 六组无页面级横向溢出；160 字符连续变化量与强制颜色下 bar/ring 可辨识检查也通过。隔离测试使用模拟宿主服务和主题值，不是在线 DSH 验收。

2026-10-24 后续操作已完成：通过官方 CLI 将当前工作区链接安装到 `web` profile，验证 Host 模块可加载，并重启既有 DSH 服务；确认进程替换且状态 running。原 GUI 地址仍返回 HTTP 401（认证门禁），未取得已登录页面的新组件验收证据。本会话另成功记录一份 11 区块测试文档，但**工具记录成功不等于用户已看见或验证卡片**。当前状态以 [spec 的验证基线](<docs/spec.md#10-验证基线与未验证项>)为准。

## 历史实现与验证记录

首版源码已完成并安装到当前 `web` profile。用户已确认设置和三个建议入口可见，真实会话工具已成功记录五类组件的验收文档。根据用户反馈，`0.1.1` 已将草稿中的内部 JSON 改成可读回复；类型检查、31 项测试、构建及产物契约检查通过，官方 CLI 移除和重新添加也均成功。浏览器是否已加载新版代码仍需刷新确认。**更新后的实际交互、主题切换和禁用恢复仍待验收**，不能仅凭工具返回宣称全部验证完成。详见 [验证记录](<docs/validation.md>)。

本轮显示优化已实现并完成本地构建：类型检查、44 项串行测试与产物契约检查通过；收尾修改后，11 项渲染测试复测通过。使用真实插件产物和已安装宿主主题 CSS，在 Chromium 检查了明暗主题 × 320/390/680/1000px 的 8 组布局，以及宽视口中的窄容器、键盘焦点、减少动态效果与系统强制颜色。**这些是隔离视觉预览，不等同于已登录 DSH 的实际交互验收**：独立浏览器访问当前 GUI 返回 HTTP 401，本轮未重新安装插件或重启服务，不能保证当前页面已经加载新版。

`0.1.3` 起，已记录文档不再只住在工具行里：`smartuiDocumentDefinition` 把它发布为该轮的一条 Turn 级 Chat 行（`groupTree: 'turn'`），回答结束后的「工作步骤」折叠不会把卡片一起收起；工具行只保留一行摘要。类型检查、49 项串行测试、构建和产物契约检查通过，并在运行中的页面上用真实历史重放确认卡片位于折叠之外。

首版针对 DSH `0.2.1-rc.2`。插件安装到一个 profile 后，影响该 profile 下所有会话；不会启动第二个 Web 服务或修改已安装 DSH 核心。

**当前实现和验证边界见 [spec](<docs/spec.md>)；早期交接与验收过程保留在 [HANDOFF.md](<HANDOFF.md>)。**

## 能做什么

- 原生 Chat 保持工作区、模型选择、流式回答、历史、附件、发送/停止及审批能力。
- 可撤销的明暗主题 token 层；这是 ChatGPT 风格增强，不是整页像素级复制。
- `render_smart_ui` 工具展示 `card`、`table`、`chart`、`form`、`choices`、`stat`、`progress`、`callout`，并可用 `group` 组合。
- 表格本地排序、筛选和多格式复制导出；柱状/折线图提供原始数据表，表单支持字段校验。
- 所有交互使用白名单数据，没有 HTML、JavaScript、shell、任意 URL 或远程脚本执行。
- 操作仅填入当前会话的原生草稿；**用户审阅并发送后才进入后续对话**。有文字选区、命令草稿、编辑器锁定或 revision 变化时拒绝写入，不退回覆盖草稿。
- UI 文档随标准工具结果 metadata 保存；未提交表单、排序及展开状态不承诺刷新恢复。
- 每份文档是该轮的一条独立 Chat 行，位于「工作步骤」折叠之外；工具行只保留摘要，不重复渲染卡片。

### 显示与可用性

- 文档底层与内容卡片分层，统一标题、摘要、指标数字和辅助信息的视觉层级；颜色沿用宿主主题 token，兼容明暗模式。
- 按 **组件容器宽度** 而不是浏览器宽度适配：宽容器的连续卡片并排，窄容器恢复单列；表格与图表在自身区域滚动，不挤压整页。
- 表格自动识别纯数字列并右对齐，表头固定、排序方向与下一步排序动作明确，空数据有独立样式。
- 图表使用包含零点的友好刻度；小数与极小数刻度可区分，末尾分类标签保留；单柱限制宽度，多系列折线用虚线辅助区分，完整标签与原始数据仍可查看。
- 表单校验失败时定位首个错误字段，编辑后清除该字段旧错误；选项的选中、键盘焦点和禁用状态更明确。支持减少动态效果和系统高对比度模式。

## 开发与安装

使用 pnpm，不做全局安装。常规构建、类型检查与测试遵循仓库 [AGENTS.md](<../AGENTS.md>) 的当前任务验证规则；依赖安装、写入 profile 与服务重启须有相应任务授权。

```bash
# 在插件目录执行；安装依赖须有相应任务授权
pnpm install
# 常规验证遵循仓库规则
pnpm run typecheck
pnpm test                 # Node 测试文件串行运行
pnpm run build            # 生成 dist/host/index.js 和 dist/client.js
pnpm run verify:bundle    # 检查惰性 factory、宿主 React、资源与清理契约
```

默认门禁是 typecheck、串行 Node 测试、build 和 bundle 校验，全部不依赖浏览器。可选活体检查不属于默认门禁：现有 DSH 页面里的样式单例、折叠外卡片、设置开关与禁用恢复，以及 `scripts/browser-probe.mjs`。未执行时在验证记录中写“未验证”，不要用 `renderToStaticMarkup` 的单元结果代替真实 DOM/GUI 验收。

构建产物是 DSH Host 模块和 `window.__ModuleLoader__` 惰性 Client factory。React 从宿主模块表获取，不能用 Vite 静态页或第二个 React 应用代替安装验证。运行时依赖在包清单中声明为 peer；离线环境需预先准备对应版本。

获安装授权后，可在现有 DSH 插件管理器选择本地 bundle，或使用同样经过版本检查与 profile 写锁的官方 CLI：

```bash
dsh plugin --profile web add link:/home/shial/Project/dsh-plugins/dsh-smartui --offline
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

关闭组件后，工具定义仍注册，但 Host 拒绝新的文档，提示词要求使用普通文本；历史 Turn 级卡片隐藏，工具行保留文本降级，已存 metadata 不删除。禁用整个 bundle 则撤销 Client 注册、主题层及 Host 工具。没有渲染器时，标准工具摘要仍可读。

## 使用

选中工作区后，新会话空草稿上方提供“创建看板 / 对比方案 / 分析数据 / 收集需求”入口。入口只填入请求，不自动发送。也可以正常发消息：

> 用交互表格比较这三个方案，再给我几个后续分析选项。

> 把这份真实数据展示为柱状图；没有数据就先向我索取。

> 用简短表单收集项目需求，不要询问任何凭据。

模型决定何时调用 `render_smart_ui`，普通回答继续使用 Markdown；不是把任意 Markdown 自动识别为组件。每份已记录的文档由 Conversation Definition 从工具结果的 `meta.smartui` 重放为该轮的一条 Chat 行：它位于过程折叠之外，回答结束后仍然可见；工具行只显示标题、区块数和「检查工具调用」。组件关闭或载荷无效时，工具行回退为原始文本。

工具参数为 `{ "document": { "schemaVersion": 1, "summary": "…", "blocks": [] } }`；实际 `blocks` 必须有 1–20 项。完整示例见 [看板](<examples/dashboard.json>)、[方案对比](<examples/comparison.json>)、[图表](<examples/chart.json>) 和 [表单](<examples/form.json>)，均显式标记为虚构示例数据。详细结构见 [当前 v1 协议与实现规格](<docs/spec.md>)。

表单或选项的“填入对话”使用可见标题、字段名称和选项标签，生成与当前语言一致的可读回复，例如“关于「五类组件是否显示正常？」，我选择：卡片、表格、图表、表单、选项都正常。”。内部 callId、actionId 与 JSON 协议不会直接填入草稿。**这不代表已经提交或执行**。不要输入密码、API key、token 或其他凭据；正常发送会将填写内容写入会话日志。

在不安全的 HTTP 页面中，浏览器可能禁止剪贴板 API。此时会展示可选择的文字供手动复制，不尝试绕过浏览器权限。表格复制会处理常见电子表格公式前缀，但不保证第三方表格应用的所有解释行为。

## 验证与限制

测试包括协议与大小限制、metadata 重放、状态/错误降级、动作校验、选区保护、主题清理、语言资源平衡，以及真实组件的静态 HTML 输出/XSS 检查。静态 HTML 测试只是单元测试，不是运行中 DSH 的视觉验收。

真实页面仍需检查明暗/窄屏、中文输入法、消息滚动、原生审批与附件、刷新重放及禁用恢复。参见 [兼容性与验收](<docs/compatibility.md>)。

首版不包括 Canvas、任意页面生成、自动提交动作、外部应用写操作、持久化未提交表单或独立 UI 数据库。

## English summary

DSH SmartUI adds a reversible ChatGPT-inspired appearance and safe declarative cards, locally filterable/exportable tables, bar/line charts, forms, choices, metrics, progress and callouts to native DSH conversations. One-level groups arrange leaves in rows, columns or tabs; mounted tab panels retain local input. It does not replace the conversation engine, editor, model connection or approvals. `render_smart_ui` stores its versioned document in tool-result metadata and keeps a text fallback. Actions only insert reviewable text into the scoped native draft; users send it themselves. No generated HTML, scripts or arbitrary commands execute. Draft selections are not overwritten. Installation/restart need task authorization; local verification follows repository guidance. The current workspace has been installed and the service restarted, but authenticated browser acceptance of the new dashboard remains unverified. See the [current implementation spec](<docs/spec.md>).

## License

[MIT](<LICENSE>)。插件图标为本项目原创，不使用 OpenAI 标志；本项目与 OpenAI 无关联。
