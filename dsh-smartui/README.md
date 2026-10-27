# DSH SmartUI

给现有 DSH 添加 **ChatGPT 风格外观 + 对话内声明式交互组件**。不是独立聊天网站，不替换模型、会话、编辑器或权限审批。

包版本为 `0.1.3`，文档协议为 `schemaVersion: 1`，两者不是同一个版本标识。**本 README 与源码是分发后的契约来源**：v1 协议、交互边界和验证基线都收敛在下方章节，不依赖仓库外的本地笔记。

> 仓库策略只提交源码和 README。本地工作副本中的 `docs/`、`HANDOFF.md`、`pnpm-lock.yaml` 等设计/验证笔记与安装产物不进入 git，也不随包分发，因此不作为契约或验收依据；需要长期保留的结论已并入本 README。

## 本轮改造：参考 GenUI 的本地交互看板

参考 [omdsh-dev/dsh-genui](https://github.com/omdsh-dev/dsh-genui/tree/ad8dc166deaf4eee7dea758fc0a84a8728402b52) 的声明式小组件、布局组合和本地优先交互理念，独立实现以下增量，无新增运行时依赖、未复制其引擎、图标或样式：

- `stat`：指标数字、明确语义的变化量和可选微趋势图；`progress`：0–100 的条形/环形进度；`callout`：信息、成功、注意、错误提示。
- `group`：一层 `row` / `column` / `tabs` 组合。用 `blockIds` 引用同一份扁平 `blocks` 中的叶节点，禁止嵌套、重复归属及悬空引用；被分组的节点只在组内显示。标签页支持左右键、Home/End，切换时保留已挂载表单、选项和表格筛选状态。
- 表格新增跨列本地搜索、匹配行数、TSV / CSV / Markdown 复制导出。导出包含表头和**筛选后当前顺序**的数据；CSV/TSV 对文本（含列头）中和常见公式前缀，真实数值保持原值；剪贴板不可用时仍可手动复制。
- 新会话提供“创建看板”建议，仍然只填草稿，不自动发送。

**有意保留的边界：**继续使用 `render_smart_ui` 与 `meta.smartui`、Turn 级对话行、v1 严格校验及 64 KiB / 20 区块预算（group 也计数），兼容原有五类文档。不是 GenUI 协议的兼容实现：不解析正文 `dsh-ui` 围栏，不接管聊天 DOM，不引入自动发送、常驻面板、Computed 表达式、外部图表引擎或本地持久化未发送输入。切页保留不等于刷新恢复。

完整示例：[虚构数据看板](<examples/dashboard.json>)。调用方式为 `render_smart_ui({document: …})`，其中 `document` 为示例 JSON 的完整内容。

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

## v1 协议与实现契约

以下内容按现有代码整理，是实现事实而不是待实现方案。实现事实以 `src/shared/types.ts`（类型与限制）、`src/shared/schema.ts`（工具参数声明）、`src/shared/validation.ts`（运行时校验）、`src/client/index.tsx`（客户端注册）及 `tests/` 为准；这些路径属于仓库源码，不在 `package.json` 的 `files` 中，因此不以链接形式引用。

### 文档结构与严格校验

工具只接受一个 `document` 参数，文档结构为：

```ts
interface SmartUIDocument {
  schemaVersion: 1;
  title?: string;
  summary: string;
  blocks: SmartUIBlock[];
}
```

`summary` 必需且非空白。未知版本、未知字段、未知区块类型或非法引用会使**整份文档校验失败**；没有坏节点自动删除、局部修复、自动重发或跨版本迁移。

- 文档及每类节点都是严格白名单结构。普通对象（含 null 原型对象）与标准数组可进入校验；循环、访问器、隐藏或 Symbol 属性、非 JSON 值、自定义原型、稀疏/装饰数组以及 `__proto__` / `constructor` / `prototype` 键被拒绝。
- JSON 边界先于序列化检查：根深度为 0，深度不得超过 10，遍历值总数不得超过 15,000；随后按完整 JSON 的 UTF-8 编码计算文档预算。
- 区块、字段、列、系列、`actionId` 及 group 引用的 ID 匹配 `^[A-Za-z][A-Za-z0-9_-]*$`，最多 64 字符；`constructor`、`prototype` 不能作为 ID。区块 ID 全文唯一，字段/列/系列 ID 在所属集合内唯一。`actionId` 是数据标识，不是命令或 RPC 地址，不要求全文唯一。宿主来源调用 ID 不受此格式限制，另见“表单与草稿动作”。
- 文本长度按 JavaScript `string.length`（UTF-16 码元）计；文档与动作大小按 UTF-8 字节计，两者不能互换。表格单元格外，已提供的描述性文本必须非空白。
- 所有业务数值必须是有限 number 且在 `[-1e12, 1e12]` 内；`progress` 另限 `[0, 100]`，表单数值另受声明的 min/max 限制。不把数字字符串强制转换为协议数值。
- 写在字符串里的 HTML、JavaScript、URL 只作为普通文本显示；协议没有可执行代码、事件处理器或 URL 跳转字段。
- 不请求或填写密码、API key、token 等凭据。该约束依赖提示词、UI 提醒与白名单能力，**不承诺自动识别、打码或清除用户在普通文本框误填的秘密**。

### 资源预算

| 项目 | 限制 |
|---|---|
| 完整文档 | ≤65,536 UTF-8 字节 |
| `blocks` | 1–20，包含 group；不只计算顶层可见数量 |
| `summary` | 1–1,000 字符，非空白 |
| 标题、标签、展示值、变化量、placeholder、选项 value | 通常 ≤160；ID 另限 64 |
| card / callout 正文 | ≤8,000 |
| caption | ≤500 |
| 表格 | 每表 1–12 列、0–200 行；单元格文本 ≤2,000，可为空 |
| 图表 | 每图 1–4 系列，每系列至少 1 点，每图合计 ≤500 点 |
| 微趋势 `spark` | 每个 stat 为 2–60 点 |
| 表单 | 每个 form 为 1–20 字段 |
| 选项 | 每个 choices 或 select 为 1–30 项，value 唯一 |
| 内部动作 / 可见回复 | 各自 ≤16,384 UTF-8 字节；草稿插入另有独立检查 |

工具参数 schema 描述允许的字段；部分长度、数量、引用关系及 JSON 安全边界由运行时校验落实，不应只检查参数声明而跳过 `validateDocument`。

### 九类区块

全部节点都有必需的 `id`、`type` 及可选 `title`；未声明字段一律拒绝。

| 类型 | 必需字段（除 `id`、`type`） | 可选字段与行为 |
|---|---|---|
| `card` | `body: string` | `value`、`caption`；支持复制卡片可读内容 |
| `table` | `columns: {id,label}[]`、`rows: Cell[][]` | `Cell = string \| number \| boolean \| null`，每行长度等于列数；本地筛选、排序与复制导出 |
| `chart` | `chartType: 'bar' \| 'line'`、`series: {id,label,points:{label,value}[]}[]` | 每系列类别标签唯一，各系列的标签数量、内容、顺序相同；SVG 图及可展开原始数据表 |
| `form` | `actionId`、`fields` | 见“表单与草稿动作”；只有显式操作才填草稿 |
| `choices` | `actionId`、`options: {value,label}[]` | `multiple?: boolean`，默认单选；必须选中有效选项才能填草稿 |
| `stat` | `value: string` | `delta`、`caption`、`tone`、`spark: number[]`（2–60 个有限数值）；微趋势支持负数和常量序列 |
| `progress` | `value: number` | `variant: 'bar' \| 'ring'`（默认 bar）、`caption`；显示百分比并提供 progressbar ARIA |
| `callout` | `body: string` | `tone`；图标、语义色和读屏文案，不依赖颜色单独传达级别 |
| `group` | `layout: 'row' \| 'column' \| 'tabs'`、`blockIds: string[]` | 只能引用同文档叶节点，见“分组、顺序与标签”；不是递归容器 |

`tone` 只允许 `neutral` / `success` / `warning` / `error`，未提供时展示为 neutral。stat 的 tone 表示变化量语义，不能根据 delta 正负自动推断好坏；progress 不支持 tone。card 的 `value` 与 stat 的 `value` 是展示字符串，不是数值计算字段。

### 分组、顺序与标签

- 文档保持**扁平 blocks 数组**。group 的 `blockIds` 非空、组内去重，允许引用定义在 group 后面的叶节点。
- 禁止未知 ID、自引用、group 引用 group；每个叶节点最多属于一个 group。group 与叶节点共同计入 20 区块预算。
- group 在其自身所在的 blocks 位置展示，组内按 `blockIds` 顺序排列。被归组的叶节点不再重复显示在顶层；未归组的叶节点保持顶层相对顺序。
- `row` 使用可自动换行的网格，窄容器允许单列；`column` 纵向排列；两者都不保证固定像素列宽。
- `tabs` 默认选中第一项，使用 tablist/tab/tabpanel、roving tabindex；左右键循环切换，Home/End 跳到首/尾，普通 Tab 键保持浏览器行为。
- **所有标签面板保持挂载，仅切换 hidden。** 同一文档未卸载时，切页保留表单、选项、表格筛选和排序等局部状态；这不等于刷新、关闭组件、卸载或重开会话后恢复。

最小有效组合（完整 document；不是 GenUI 的 items/children 语法）：

```json
{
  "schemaVersion": 1,
  "summary": "虚构示例：一张指标卡的行布局。",
  "blocks": [
    { "id": "overview", "type": "group", "title": "概览", "layout": "row", "blockIds": ["metric"] },
    { "id": "metric", "type": "stat", "title": "示例数量", "value": "42" }
  ]
}
```

更多完整示例：[看板](<examples/dashboard.json>)、[方案对比](<examples/comparison.json>)、[图表](<examples/chart.json>)、[表单](<examples/form.json>)。示例数据均为虚构，不是真实业务结论。

### 表单与草稿动作

`fields` 中每项有 `id`、`label`、`type`，可带 `required`、`placeholder`；类型仅为 `text` / `textarea` / `number` / `select` / `checkbox`。

- 只有 select 能带且必须带 `options`；只有 number 能带 min/max，且 min ≤ max。
- text/textarea 用户文本最多 8,000；必填文本拒绝空白。数值 0 与布尔 false 不被当作缺失；必填 checkbox 必须为 true。
- 提交时校验字段和选项，失败聚焦首个错误字段；编辑字段后清除该字段的旧错误。
- 内部 `SmartUIAction` 为 `{schemaVersion:1, sourceCallId, blockId, actionId, values}`。来源调用 ID 非空且最多 512；表单只接受声明字段，缺失值归为 null；选择值必须来自声明选项，不允许空、重复或多选冒充单选。
- 内部动作只用于来源和数据校验，不作为隐藏事件、RPC、命令或直接写入草稿的 JSON 协议。
- 用户可见回复使用当前语言、区块标题、字段名称、可见选项标签及本地化的是/否生成自然语言，不附加内部 callId、actionId 或 schemaVersion。用户发送后，回复只是标准 user message，不承诺精确机器关联、自动幂等或执行回执。
- 表单和选项的“填入对话”及建议入口点击会尝试插入；渲染、排序、筛选及切页不会触发插入或模型调用。`insertReviewedText` 先检查 actions/可编辑状态及原文本 ≤16,384 UTF-8 字节，再用原生 `captureInsertion` 捕获当前会话选区与 draft revision，要求 start/end/draftRev 为有效安全整数、起点和 revision 非负且选区折叠；实际写入 `\n\n${text}\n`，插件不会对包装后的文本再做一次字节预算检查。
- 客户端不自行比较 revision 是否仍为最新，也不解析 `/` 命令前缀：命令/编辑状态由宿主输入快照及写入契约决定，过期 revision 由宿主拒绝。`insertText` 返回 false 时提示 `changed`，抛错或输入不可用提示 `unavailable`；非空选区提示 `selection`，文本过大提示 `tooLarge`，均不退回覆盖草稿。
- **不调用 `setDraft` 或 `submit`，不自动发送。** 是否允许编辑由输入状态决定，不是简单以“Session 是否正在生成”判断；生成中若原生输入框仍接受草稿，插入内容仍需用户自行发送或排队。未发送表单内容不会自动成为模型输入。

### 本地表格与导出

- 搜索框最多输入 160，查询先 trim，再做不区分大小写的跨列子串匹配；不是正则、远程搜索或跨组件数据绑定。null 的展示文本为 `—`。
- 先筛选再排序；表头在升序 / 降序 / 未排序的筛选结果顺序间循环。不修改原始记录。比较双方都是 number 时按数字比较，否则按展示文本比较；null 在升序时靠后，降序会随方向翻转。纯数值列右对齐，但没有货币、百分比、千分位文本的数值推断。
- 匹配数量与总行数可见，原始空表与筛选零匹配使用不同提示。
- 复制格式为 TSV（默认）、CSV、Markdown；都包含表头及**当前筛选结果的当前顺序**，不是隐藏的全部原始行，也不下载文件。
- TSV 和 CSV 的公式防护共享同一判定：只有文本（字符串单元格与列头）在含前导空白的 `=` / `+` / `-` / `@` 前缀前加单引号，真实 number / boolean / null 保持原值，负数和 `-1.5` 这类数值不会被当成公式转义。TSV 另将单元格内的制表符与换行替换为空格；CSV 正确引用引号和换行；Markdown 转义反斜杠、管道和 HTML 字符并把换行折叠为 `<br>`。防护不保证第三方表格软件的全部解释行为。
- 剪贴板 API 缺失或拒绝时提供可选择的文本供手动复制，不绕过 HTTP 环境或浏览器权限。
- 图表仅支持 SVG bar/line，坐标轴含零点；多系列折线用虚线辅助区分，完整数据仍能在表格中查看。不异步加载 ECharts 或远程资源。

### 兼容基线与运行边界

以 DSH `0.2.1-rc.2` 的已安装公开声明为基线，`engines.dsh` 精确声明该版本，不承诺其他版本。Client 不在运行时 import 任何 DSH Client 内部包，只用宿主 React 和下列公开对象；这些边界保留为本插件的最小结构类型，不是一份完整的宿主 SDK，升级时须重新对照实际声明和集成测试。

| 接口 | 使用方式 |
|---|---|
| `@deepseek-ai/dsh-tools` | `defineTool`、canonical output、`presentationMeta`、effect-owned register |
| `@deepseek-ai/dsh-system-prompt` | 新增可撤销 section；不替换 assembly |
| `tool.call.toolview` | 仅注册 `render_smart_ui` key；只显示摘要与文本回退 |
| `uiConversation.events.register` | 注册 `smartui-document` Conversation Definition，只读成功结果里的 `meta.smartui` |
| `conversation.chat.node` | 仅新增 `smartui-document` key；`groupTree: 'turn'` 使其留在过程折叠之外 |
| Session 标准 props | `sessionId`、`useInput`、`inputActions.captureInsertion/insertText` |
| `ctx.locale` / `ctx.theme` | 双语 namespace 注册及订阅；`overrideTokens` 只覆盖 alias token，明暗配对并可还原 |
| `ctx.configForms` / `settings.general.item` | 读写 Host `dsh-smartui` entry 的 volatile 配置；本插件自有设置行 |
| `conversation.input.dock` | 仅空会话（`session.blank`）且草稿为空时的快捷建议 |

默认保留原生聊天布局、消息流、Lexical 编辑器、权限审批、工作区和工具轨迹。不替换 root、sidebar、conversation.chat.flow 或其他工具的 renderer，只新增自己的 Chat 行 kind；不依赖宿主 DOM、私有类名、全局样式选择器或组件源码。

| 数据 | 谁负责 | 当前承诺 |
|---|---|---|
| 已记录的文档 | DSH 标准工具结果 metadata | Client 重新验证后重放；不依赖 DOM 快照 |
| 未提交输入、选择、排序、筛选、标签和展开态 | 已挂载的 React 组件 | 只在本地；切 tabs 保留，卸载/刷新可重置；没有 localStorage/LRU 恢复 |
| 已填入的原生草稿 | DSH 原生输入管理 | 继续由宿主管理，SmartUI 不另建草稿库或承诺其恢复行为 |
| 用户明确发送的回复 | DSH 原生用户消息 | 正常进入会话，表单数据可能因此写入会话日志 |
| 已接受的设置 | DSH profile / ConfigForms | 对该 profile 生效，不是每个会话独立配置 |

## 开发与安装

使用 pnpm，不做全局安装。常规构建、类型检查与测试遵循仓库本地工作流规则（工作副本根目录的规则文件不随仓库或包分发）的当前任务验证规则；依赖安装、写入 profile 与服务重启须有相应任务授权。

```bash
# 在插件目录执行；安装依赖须有相应任务授权
pnpm install
# 常规验证遵循仓库规则
pnpm run typecheck
pnpm run build            # 生成 dist/host/index.js 和 dist/client.js
pnpm test                 # Node 测试文件串行运行
pnpm run verify:bundle    # 检查惰性 factory、宿主 React、资源与清理契约
```

默认门禁是 typecheck、串行 Node 测试、build 和 bundle 校验，全部不依赖浏览器。可选活体检查不属于默认门禁：现有 DSH 页面里的样式单例、折叠外卡片、设置开关与禁用恢复，以及 `scripts/browser-probe.mjs`。未执行时在验证记录中写“未验证”，不要用 `renderToStaticMarkup` 的单元结果代替真实 DOM/GUI 验收。

构建产物是 DSH Host 模块和 `window.__ModuleLoader__` 惰性 Client factory。React 从宿主模块表获取，不能用 Vite 静态页或第二个 React 应用代替安装验证。运行时依赖在包清单中声明为 peer；离线环境需预先准备对应版本。

`package.json` 的 `files` 覆盖 `dist/`、`cordis.patch.yml`、`locale/*.json`、`assets/icon.svg`、`examples/*.json`、README 与 LICENSE，因此 README 链接的示例会随包分发；未列出的本地笔记（`docs/`、`HANDOFF.md`、`pnpm-lock.yaml`）不进入包内容。

获安装授权后，可在现有 DSH 插件管理器选择本地 bundle，或使用同样经过版本检查与 profile 写锁的官方 CLI：

```bash
dsh plugin --profile web add link:/home/shial/Project/dsh-plugins/dsh-smartui --offline
```

`link:` 使用已准备好的工作区与依赖；离线安装不从注册表补齐缺失包。不手改 profile 的依赖清单或 patch，也不启动另一个服务器。

检查安装返回的实际应用状态及诊断；需要重启时按提示操作，然后刷新现有 DSH 页面。新增插件可能由 DSH 同步，但本项目没有保证自动重建或 HMR。更换包代码可能需要 Host 重启。插件安装到一个 profile 后影响该 profile 下的所有会话；本项目不会启动第二个 Web 服务，也不修改已安装的 DSH 核心。

### 设置

设置 → 通用 → **SmartUI**：

| 字段 | 默认 | 作用 |
|---|---|---|
| `appearance` | `chatgpt` | `chatgpt` 主题层或 `native` 原生外观 |
| `enableComponents` | `true` | 是否接受新的 UI 文档并提供组件交互 |

设置由 Host 的 `dsh-smartui` entry 持久化，经现有 ConfigForms 传输，不另建 Remote 或浏览器存储。加载期间不抢先应用主题；Host 拒绝保存时保留最后接受的配置。设置只能在 ready、可写且非保存中状态编辑；`set` 返回 false 提示 refused，抛错提示 error。主题只在配置 ready 且 appearance 为 chatgpt 时生效，native、loading、unavailable 都会清理已有主题层。

关闭组件后，工具定义仍注册，但 Host 拒绝新的文档，提示词要求使用普通文本；历史 Turn 级卡片隐藏，工具行保留文本降级，已存 metadata 不删除。禁用整个 bundle 则撤销 Client 注册、主题层及 Host 工具。没有渲染器时，标准工具摘要仍可读。

## 使用

选中工作区后，新会话空草稿上方提供“创建看板 / 对比方案 / 分析数据 / 收集需求”入口。入口只填入请求，不自动发送。也可以正常发消息：

> 用交互表格比较这三个方案，再给我几个后续分析选项。

> 把这份真实数据展示为柱状图；没有数据就先向我索取。

> 用简短表单收集项目需求，不要询问任何凭据。

模型决定何时调用 `render_smart_ui`，普通回答继续使用 Markdown；不是把任意 Markdown 自动识别为组件。每份已记录的文档由 Conversation Definition 从工具结果的 `meta.smartui` 重放为该轮的一条 Chat 行：它位于过程折叠之外，回答结束后仍然可见；工具行只显示标题、区块数和「检查工具调用」。组件关闭或载荷无效时，工具行回退为原始文本。

工具参数为 `{ "document": { "schemaVersion": 1, "summary": "…", "blocks": [] } }`；实际 `blocks` 必须有 1–20 项。完整示例见 [看板](<examples/dashboard.json>)、[方案对比](<examples/comparison.json>)、[图表](<examples/chart.json>) 和 [表单](<examples/form.json>)，均显式标记为虚构示例数据。字段与预算见上文“v1 协议与实现契约”。

表单或选项的“填入对话”使用可见标题、字段名称和选项标签，生成与当前语言一致的可读回复，例如“关于「五类组件是否显示正常？」，我选择：卡片、表格、图表、表单、选项都正常。”。内部 callId、actionId 与 JSON 协议不会直接填入草稿。**这不代表已经提交或执行**。不要输入密码、API key、token 或其他凭据；正常发送会将填写内容写入会话日志。

在不安全的 HTTP 页面中，浏览器可能禁止剪贴板 API。此时会展示可选择的文字供手动复制，不尝试绕过浏览器权限。表格复制会处理常见电子表格公式前缀，但不保证第三方表格应用的所有解释行为。

## 验证与限制

测试包括协议与大小限制、metadata 重放、状态/错误降级、动作校验、选区保护、主题清理、语言资源平衡、表格导出（含 TSV/CSV 公式防护一致性与数值保留）和真实组件的静态 HTML 输出/XSS 检查。静态 HTML 测试只是单元测试，不是运行中 DSH 的视觉验收。

验证分为四层，结论不能跨层推断：

| 层级 | 已有结果 | 不能据此断言 |
|---|---|---|
| 静态/单元测试 | 协议、动作、草稿门禁、metadata 恢复、Host 工具、主题 disposer、表格导出、语言资源与组件静态输出 | 当前浏览器已加载并显示插件 |
| 构建/bundle 契约 | `pnpm run build` 与 `pnpm run verify:bundle`；产物为 Host ESM 和带正确包 ID 的惰性 Client factory，外部模块仅为宿主 React，资源路径存在，注册与清理成对 | 已登录 DSH 中的真实交互 |
| 隔离 Chromium | 使用真实组件配模拟宿主服务与主题值：筛选、带表头的可见 CSV 复制、切页保留输入、键盘焦点、显式填草稿、手动复制回退；明暗 × 320/390/1000px 六组无页面级横向溢出；长 delta 与强制颜色下 bar/ring 可辨识 | 在线 DSH 页面或全部原生交互兼容性 |
| 安装与服务 | 2026-10-24 曾用官方 CLI 把当前工作区链接安装到 `web` profile 并重启既有服务；确认新进程 running、Host 模块可导入 | 已登录浏览器已刷新；同日的原 GUI 地址仍返回 HTTP 401（认证门禁） |

历史运行记录只说明各自记录时点的结果，不能直接沿用为当前源码的验证结论；应以当前执行的 typecheck、串行测试、build 与 bundle 校验日志为准。

**明确未验证项：**

- 已登录的当前 DSH 页面中新看板的实际显示、点击，以及与原生输入、附件、审批的共存情况；工具返回“document recorded”不是可见性证明。
- 系统权限审批卡片：本机 profile 的“访问模式”选择器只提供“完全权限”，缺少触发审批卡片的场景，历史清单中始终为 N/A。
- 刷新后 metadata 重放、禁用/重启用、中文输入法、消息滚动、窄屏与主题切换在最新构建上的复测。

首版不包括 Canvas、任意页面生成、自动提交动作、外部应用写操作、持久化未提交表单或独立 UI 数据库。

## English summary

DSH SmartUI adds a reversible ChatGPT-inspired appearance and safe declarative cards, locally filterable/exportable tables, bar/line charts, forms, choices, metrics, progress and callouts to native DSH conversations. One-level groups arrange leaves in rows, columns or tabs; mounted tab panels retain local input. The v1 document shape, strict validation, resource budgets, block fields, grouping rules, draft-insertion gates, export semantics, host-interface baseline and verification baseline are specified in the sections above. It does not replace the conversation engine, editor, model connection or approvals. `render_smart_ui` stores its versioned document in tool-result metadata and keeps a text fallback. Actions only insert reviewable text into the scoped native draft; users send it themselves. No generated HTML, scripts or arbitrary commands execute. Draft selections are not overwritten. Installation/restart need task authorization; local verification follows repository guidance. Record authenticated browser acceptance separately from unit and bundle checks. Only source, README and the listed packaged resources are tracked or shipped; untracked local notes under `docs/` and `HANDOFF.md` are not part of the contract.

## License

[MIT](<LICENSE>)。插件图标为本项目原创，不使用 OpenAI 标志；本项目与 OpenAI 无关联。
