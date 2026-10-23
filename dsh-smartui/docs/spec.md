# DSH SmartUI 当前实现规格

> 更新日期：2026-10-24（Asia/Shanghai）。这是按现有代码整理的 **as-built spec**，不是待实现方案。
> 实现基线：SmartUI 最近代码提交 `848702f`；包版本仍为 `0.1.3`，文档协议仍为 `schemaVersion: 1`。三者不是同一个版本标识。
> 实现事实以[类型与限制](<../src/shared/types.ts>)、[工具参数声明](<../src/shared/schema.ts>)、[运行时校验](<../src/shared/validation.ts>)、客户端及测试为准；[历史交接记录](<../HANDOFF.md>)中的旧路径、组件数量、注册方式和测试数量不代表当前状态。

## 1. 目标与范围

SmartUI 是原生 DSH 会话的增强插件，包名为 `@local/dsh-smartui`。它提供可撤销的 ChatGPT 风格主题层，以及通过 `render_smart_ui` 记录和展示的声明式交互文档，不替换模型、会话引擎、原生输入框、附件、发送/停止或权限审批。

当前支持 **八类叶节点 + 一类分组节点**，借鉴 [dsh-genui 的声明式组件与本地优先理念](https://github.com/omdsh-dev/dsh-genui/tree/ad8dc166deaf4eee7dea758fc0a84a8728402b52)，但不是其协议兼容实现，没有复制其运行时、图标或样式，也没有新增图表引擎依赖。

**明确不包含：**正文 `dsh-ui` 围栏解析或流式 UI、聊天 DOM 扫描与接管、任意 HTML/JavaScript 执行、任意 URL 动作、Computed/数学表达式、递归布局、常驻面板、自动发送、外部应用写操作、独立 HTML/文件下载导出、未提交输入持久化及独立动作数据库。普通回答仍使用 Markdown，模型按需调用工具，不强制把所有回答转成 UI。

## 2. 架构与文档生命周期

依据：[Host 工具](<../src/host/index.ts>)、[模型提示词](<../src/host/prompt.ts>)、[Conversation Definition](<../src/client/definition.ts>)、[Client 注册](<../src/client/index.tsx>)。

1. 模型调用 `render_smart_ui({ document })`。Host 先检查取消信号及组件开关，再用 `validateDocument` 严格验证并返回脱离调用方对象的 JSON 副本。
2. `output.render` 生成标题、可读摘要及区块数量等文本；`output.presentationMeta` 返回 `{ smartui: document }`。**完整文档的历史重放依赖工具结果 metadata，不依赖把 canonical 返回值另存成完整文本或独立数据库。**
3. Client 的工具展示模型和 Conversation Definition 都通过 `readPresentationMeta` 校验 metadata。Definition 识别成功的 `tool/result` 或 PTC `tool/ptc-dispatch`；分别取 `message.toolCallId` / `subCallId` 为调用身份，拒绝错误结果、缺失身份及非法载荷，不解析模型正文或流式参数。**当前 matcher 不检查工具名**：满足这些条件并带合法 `meta.smartui` 的工具结果都可投影；只有工具展示 slot 按 `render_smart_ui` key 绑定。DocumentNode 消费已投影状态时只做基本形状检查，不再次完整校验 schema。
4. 每份成功文档投影为 `smartui-document` 节点，`target: 'chat'`、`groupTree: 'turn'`，锚定结果事件的序号。它是该轮独立 Chat 行，位于可折叠「工作步骤」之外，不是新增 assistant 消息或自建 Session 事件。
5. 成功结果的原工具行只显示标题、区块数量和可选的 inspect 操作，不展示 document.summary 正文，也不再次渲染完整卡片；刷新或重新加载历史时，从 metadata 重建文档。

客户端有四个 slot，均随插件生命周期注册和清理：

| Slot | key / id | 职责 |
|---|---|---|
| `tool.call.toolview` | `render_smart_ui` | 工具状态、结果摘要和文本降级 |
| `conversation.chat.node` | `smartui-document` | Turn 级文档展示 |
| `settings.general.item` | `dsh-smartui` | 当前 profile 设置 |
| `conversation.input.dock` | `dsh-smartui-suggestions` | 新会话建议入口 |

## 3. v1 文档与安全边界

工具只接受 `document` 参数。文档结构为：

```ts
interface SmartUIDocument {
  schemaVersion: 1;
  title?: string;
  summary: string;
  blocks: SmartUIBlock[];
}
```

`summary` 必需且非空白，没有插件时仍应足以理解回答。未知版本、字段、区块类型或非法引用会使**整份文档校验失败**；当前没有坏节点自动删除、局部修复、自动重发或跨版本迁移。

### 3.1 通用约束

- 文档及每类节点均为严格白名单结构。普通对象（含 null 原型对象）与标准数组可进入校验；循环、访问器、隐藏或 Symbol 属性、非 JSON 值、自定义原型、稀疏/装饰数组以及 `__proto__` / `constructor` / `prototype` 属性被拒绝。
- JSON 边界先于序列化检查；根深度为 0，深度不得超过 10，遍历值总数不得超过 15,000。随后按完整 JSON 的 UTF-8 编码计算文档预算。
- 文档中声明的区块、字段、列、系列、actionId 及 group 引用 ID 均匹配 `^[A-Za-z][A-Za-z0-9_-]*$`，最多 64；`constructor`、`prototype` 不能作为 ID。宿主来源调用 ID 不受此格式限制，另见 §6。区块 ID 在全文唯一；字段、列、系列 ID 分别在所属集合内唯一。`actionId` 是数据标识，不是命令或 RPC 地址，不要求在全文唯一。
- 文档描述中的文本字段除表格单元格外，已提供时要求非空白；这不要求用户填满表单的所有可选字段。文本长度按 JavaScript `string.length`（UTF-16 码元）计；文档及动作大小按 UTF-8 字节计，两者不能互换。
- 所有业务数值必须为有限 number，并处于 `[-1e12, 1e12]`。进度另限制为 `[0, 100]`，字段数值另受声明的 min/max 限制。不将数字字符串强制转换为协议数值。
- HTML、JavaScript、URL 等写在字符串里只作为普通文本显示，**不是由字符串内容检测器拒绝**；协议没有可执行代码、事件处理器或 URL 跳转字段。
- 不应请求或填写密码、API key、token 等凭据。当前约束依赖提示词、UI 提醒与白名单能力，**不承诺自动识别、打码或清除用户在普通文本框误填的秘密**。

### 3.2 资源预算

| 项目 | 当前限制 |
|---|---|
| 完整文档 | ≤65,536 UTF-8 字节 |
| `blocks` | 1–20，包含 group；不是只计算顶层可见数量 |
| `summary` | 1–1,000；非空白 |
| 标题、标签、展示值、变化量、placeholder、选项 value | 通常 ≤160；ID 另限 64 |
| card / callout 正文 | ≤8,000 |
| caption | ≤500 |
| 表格 | 每表 1–12 列、0–200 行；单元格文本 ≤2,000，可为空 |
| 图表 | 每图 1–4 系列，每系列至少 1 点，**每图合计 ≤500 点** |
| 微趋势 `spark` | 每个 stat 为 2–60 点 |
| 表单 | 每个 form 为 1–20 字段 |
| 选项 | 每个 choices 或 select 为 1–30 项，value 唯一 |
| 内部动作 / 可见回复 | 各自 ≤16,384 UTF-8 字节；草稿插入还有独立检查 |

工具参数 schema 描述允许的字段；部分长度、数量、引用关系及 JSON 安全边界由运行时校验落实，不应只检查参数声明而跳过 `validateDocument`。

## 4. 九类区块

全部节点有必需的 `id`、`type` 及可选 `title`；没有声明的字段一律拒绝。依据：[区块类型](<../src/shared/types.ts>)、[校验器](<../src/shared/validation.ts>)、[叶节点渲染器](<../src/client/components.tsx>)。

| type | 必需字段（除 id/type） | 可选字段与行为 |
|---|---|---|
| `card` | `body: string` | `value: string`、`caption: string`；支持复制卡片可读内容 |
| `table` | `columns: {id,label}[]`、`rows: Cell[][]` | `Cell = string \| number \| boolean \| null`，每行长度严格匹配列数；本地筛选、排序与复制导出 |
| `chart` | `chartType: 'bar' \| 'line'`、`series: {id,label,points:{label,value}[]}[]` | 每系列类别标签唯一，各系列的标签数量、内容、顺序相同；SVG 图及可展开原始数据表 |
| `form` | `actionId`、`fields` | 详见 §6；只有显式操作才填草稿 |
| `choices` | `actionId`、`options: {value,label}[]` | `multiple?: boolean`，默认单选；必须选中有效选项才能填草稿 |
| `stat` | `value: string` | `delta: string`、`caption: string`、`tone`、`spark: number[]`；微趋势线支持负数和常量序列 |
| `progress` | `value: number` | `variant: 'bar' \| 'ring'`（默认 bar）、`caption`；显示百分比并提供 progressbar ARIA |
| `callout` | `body: string` | `tone`；图标、语义色和读屏文案，不依赖颜色单独传达级别 |
| `group` | `layout: 'row' \| 'column' \| 'tabs'`、`blockIds: string[]` | 只能引用同文档叶节点，详见 §5；不是递归容器 |

`tone` 仅允许 `neutral` / `success` / `warning` / `error`，未提供时展示为 neutral。stat 的 tone 用于变化量语义，不能根据 delta 正负自动推断好坏；progress 不支持 tone。card 的 `value`、stat 的 `value` 是展示字符串，不是数值计算字段。

## 5. 分组、顺序与标签状态

依据：[引用校验](<../src/shared/validation.ts#L199-L221>)、[文档展示](<../src/client/DocumentView.tsx>)、[分组展示](<../src/client/GroupView.tsx>)。

- 文档保持**扁平 blocks 数组**。group 的 `blockIds` 非空、组内去重，允许引用定义在 group 后面的叶节点。
- 禁止未知 ID、自引用、group 引用 group；每个叶节点最多属于一个 group。group 与叶节点共同计入 20 区块预算。
- group 在其自身所在的 blocks 位置展示，组内按 `blockIds` 顺序排列。被归组的叶节点不再重复显示在顶层；未归组的叶节点保持顶层相对顺序。
- `row` 使用可自动换行的网格，窄容器允许单列；`column` 纵向排列；两者都不保证固定像素列宽。
- `tabs` 默认选中第一项，使用 tablist/tab/tabpanel、roving tabindex；左右键循环切换，Home/End 跳到首/尾，普通 Tab 键保持浏览器行为。
- **所有标签面板保持挂载，仅切换 hidden。** 因此同一文档未卸载时，切页保留表单、选项、表格筛选和排序等局部状态；这不等于刷新、关闭组件、卸载或重开会话后恢复。

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

完整示例：[看板](<../examples/dashboard.json>)、[方案对比](<../examples/comparison.json>)、[图表](<../examples/chart.json>)、[表单](<../examples/form.json>)。这些示例数据均非真实业务结论。

## 6. 表单、选项与草稿动作

依据：[字段及动作校验](<../src/shared/actions.ts>)、[组件](<../src/client/components.tsx>)、[草稿插入](<../src/client/draft.ts>)。

### 6.1 字段及内部动作

`fields` 中每项有 `id`、`label`、`type`，可带 `required`、`placeholder`；类型仅为 `text` / `textarea` / `number` / `select` / `checkbox`。

- 只有 select 能带且必须带 `options`；只有 number 能带 min/max，且 min ≤ max。
- text/textarea 用户文本最多 8,000；必填文本拒绝空白。数值 0 和布尔 false 不被当作缺失；必填 checkbox 必须为 true。
- 提交时校验字段和选项，失败聚焦首个错误字段；编辑字段后清除该字段的旧错误。
- 内部 `SmartUIAction` 为 `{schemaVersion:1, sourceCallId, blockId, actionId, values}`。来源调用 ID 非空且最多 512；表单只接受声明字段，缺失值归为 null；选择值必须来自声明选项，不允许空、重复或多选冒充单选。
- 内部动作只用于来源和数据校验，不作为隐藏事件、RPC、命令或直接写入草稿的 JSON 协议。

### 6.2 用户可见回复与插入门禁

`formatActionReply` 使用当前语言、区块标题、字段名称、可见选项标签及本地化的是/否生成自然语言；不主动附加内部 callId、actionId 或 schemaVersion。普通用户发送后，回复只是标准 user message，不承诺精确机器关联、自动幂等或执行回执。

表单和选项的“填入对话”、以及建议入口的点击会尝试插入；渲染、排序、筛选及切页都不会触发插入或模型调用。`insertReviewedText` 先检查 actions/可编辑状态及原文本 ≤16,384 UTF-8 字节，再用原生 `captureInsertion` 捕获当前会话选区和 draft revision，要求 start/end/draftRev 为有效安全整数，起点和 revision 非负，且选区折叠。实际调用 `insertText` 写入 `\n\n${text}\n`，比原文本多 3 个 ASCII 字节；插件没有对包装后的文本再做一次字节预算检查。

客户端不自行比较 revision 是否仍为最新，也不解析 `/` 命令前缀：命令/编辑状态由宿主输入快照及写入契约决定，过期 revision 由宿主拒绝。`insertText` 返回 false 时提示 `changed`，抛错或输入不可用时提示 `unavailable`；非空选区提示 `selection`，文本过大提示 `tooLarge`，均不退回覆盖草稿。

**不调用 `setDraft` 或 `submit`，不自动发送。** 允许编辑由输入状态决定，不是简单以“Session 是否正在生成”判断；生成中若原生输入框仍接受草稿，插入内容仍需用户自行发送或排队。未发送表单内容不会自动成为模型输入。

## 7. 本地表格与图表

依据：[本地表格数据处理](<../src/shared/table.ts>)、[基础排序与 TSV](<../src/shared/actions.ts#L60-L74>)、[渲染器](<../src/client/components.tsx>)。

- 搜索框最多输入 160，查询先 trim，再做不区分大小写的跨列子串匹配；不是正则、远程搜索或跨组件数据绑定。null 的展示文本为 `—`。
- 先筛选再排序；表头在升序 / 降序 / 未排序的筛选结果顺序间循环。不修改原始记录。比较双方都是 number 时按数字比较，否则按展示文本比较；null 在升序时靠后，降序会随方向翻转。纯数值列右对齐，但没有货币、百分比、千分位文本的数值推断。
- 匹配数量与总行数可见，原始空表与筛选零匹配使用不同提示。
- 复制格式为 TSV（默认）、CSV、Markdown；都包含表头及**当前筛选结果的当前顺序**，不是导出隐藏的全部原始行，也不下载文件。
- TSV 替换单元格中的制表符/换行，并中和常见公式前缀；CSV 正确引用引号和换行，对含前导空白的 `= + - @` 文本前缀加单引号，真实 number 保留数值；Markdown 处理反斜杠、管道、HTML 字符及换行。防护不是对第三方表格软件全部解释行为的保证。
- 剪贴板 API 缺失或拒绝时提供可选择的文本供手动复制，不绕过 HTTP 环境或浏览器权限。
- 图表仅支持 SVG bar/line，坐标轴含零点；多系列折线用虚线辅助区分，完整数据仍能在表格中查看。不异步加载 ECharts 或远程资源。

## 8. 配置、主题与可见性

依据：[配置和 Host 注册](<../src/host/index.ts>)、[配置环境](<../src/client/environment.tsx>)、[设置 UI](<../src/client/Settings.tsx>)、[主题](<../src/client/theme.ts>)、[建议入口](<../src/client/Launcher.tsx>)、[ToolView](<../src/client/ToolView.tsx>)、[DocumentNode](<../src/client/DocumentNode.tsx>)。

设置属于当前 profile 的 `dsh-smartui` entry，复用 ConfigForms，不另建浏览器配置存储：

| 字段 | 默认 | 行为 |
|---|---|---|
| `appearance` | `chatgpt` | `chatgpt` 叠加主题 token；`native` 撤销覆盖，不等于禁用组件 |
| `enableComponents` | `true` | 控制新文档接收及组件展示/交互，不注销工具定义 |

- 主题只在配置 ready 且 appearance 为 chatgpt 时生效；native、loading、unavailable 都清理已有主题层。订阅和 token 覆盖随 disposer 清理。
- 设置在加载中、不可用、不可写或保存中禁用控件；没有配置值时显示 native/off 占位，不应把占位当作已保存配置。`set` 返回 false 提示 refused，抛错提示 error；控件受已接受的 snapshot 控制，没有独立乐观保存值。
- 组件关闭时，Host 工具与 Turn definition 仍注册，但 Host 拒绝新文档、动态提示词要求普通回答；Turn 行不显示，历史 metadata 不删除。输入非 editable 时只禁用表单/选项，表格筛选/排序/复制、卡片复制和标签切换不因此禁用。
- 工具 preparing/start 只显示准备/校验状态，这一分支优先于配置开关；result 阶段配置 loading 显示加载提示，配置 unavailable 或开关关闭显示 disabled 提示，均可保留工具文本。
- 工具失败显示 failed 提示与文本；metadata 非法显示 fallback 与文本，可展开 diagnostic。工具文本只拼接 text 内容并截取前 8,000 个 UTF-16 码元；它不是另一份完整文档。若宿主提供 inspect，降级时仍可检查工具调用。
- DocumentNode 在配置非 ready、开关关闭或 node data 基本形状无效时直接隐藏，不额外创建文本行。文档渲染异常由覆盖整份文档的错误边界显示 crashed 提示与原始 summary；不是逐坏节点修复。
- 禁用整个 bundle 时清理工具、提示词、Conversation Definition、slot、语言注册及主题覆盖。仅切换原生外观不会清理会话或 metadata。
- 新会话建议为“创建看板 / 对比方案 / 分析数据 / 收集需求”；配置 ready 且组件开启、`draft.trim()` 为空、`session?.blank !== false` 时才显示。按钮还受输入 editable 门禁限制，只填请求草稿。
- 样式限定于 SmartUI 容器并复用宿主 `--dsw-alias-*` token；主题支持明暗，布局按容器宽度适配。表格/图表内部滚动，支持减少动态效果和强制颜色，进度轨道与完成量在强制颜色下使用可区分系统色。

## 9. 持久化与运行边界

| 数据 | 谁负责 | 当前承诺 |
|---|---|---|
| 已记录的文档 | DSH 标准工具结果 metadata | Client 重新验证后重放；不依赖 DOM 快照 |
| 未提交输入、选择、排序、筛选、标签和展开态 | 已挂载的 React 组件 | 只在本地；切 tabs 保留，卸载/刷新可重置；没有 localStorage/LRU 恢复 |
| 已填入的原生草稿 | DSH 原生输入管理 | 继续由宿主管理，SmartUI 不另建草稿库或承诺其恢复行为 |
| 用户明确发送的回复 | DSH 原生用户消息 | 正常进入会话，表单数据可能因此写入会话日志 |
| 已接受的设置 | DSH profile / ConfigForms | 对该 profile 生效，不是每个会话独立配置 |

构建方式见[构建脚本](<../scripts/build.mjs>)及[包清单](<../package.json>)：Node ≥22，声明的 DSH 目标为 `0.2.1-rc.2`；Host 为 Node ESM，Client 为 `window.__ModuleLoader__` 惰性 factory，只从宿主取 React。它不是独立 Vite 站点或第二个 React 应用。依赖安装、profile 写入和服务重启须遵循当前任务授权；不手改 profile 的依赖/patch，不从另一个 Web 服务替代当前 GUI。

在仓库根目录进行已获授权的验证与安装：

```bash
pnpm --dir dsh-smartui run typecheck
pnpm --dir dsh-smartui test
pnpm --dir dsh-smartui run build
pnpm --dir dsh-smartui run verify:bundle
dsh plugin --profile web add "link:$PWD/dsh-smartui" --offline
```

`link:` 指向已经准备好依赖的工作区，离线安装不补齐缺失 peer。安装后须检查实际链接和模块加载；Host 代码更新可能需要重启**既有服务**，然后刷新已登录页面。不保证自动重建或 HMR，也不能只凭构建成功宣布在线页面生效。若重启承载当前对话的服务，应从独立终端或托管任务执行，并在重启后确认恢复。

## 10. 验证基线与未验证项

以下是截至本次文档更新前已经执行的结果，**本次是文档同步，不把历史验证描述成重新执行**：

| 层级 | 已有结果 | 不能据此断言 |
|---|---|---|
| 本地验证 | 类型检查、68 项串行测试、构建和 bundle 契约检查通过 | 运行中页面已下载新版 Client |
| 隔离 Chromium | 真实组件配测试宿主服务和主题值；筛选、可见 CSV 复制、切页保留输入、键盘、显式填草稿、手动复制回退通过；明暗 × 320/390/1000px 六组无页面级横向溢出，长 delta 与强制颜色 bar/ring 通过 | 已登录 DSH 中的全部原生交互兼容性 |
| 安装与服务 | 2026-10-24 已用官方 CLI 安装当前工作区链接并重启既有服务；确认新进程 running，原 GUI 地址响应 401（认证门禁），Host 模块可导入 | 已登录浏览器已刷新，或 401 已被绕过 |
| 实际工具调用 | 本会话已成功记录一份含 11 区块的功能测试文档 | 用户已看见卡片或已逐项完成点击测试 |

测试对应实现契约：[协议](<../tests/protocol.test.ts>)、[动作/草稿](<../tests/actions.test.ts>)、[表格/标签键盘](<../tests/table.test.ts>)、[渲染](<../tests/render.test.tsx>)、[Conversation 投影](<../tests/definition.test.ts>)、[Host](<../tests/host.test.ts>)、[生命周期](<../tests/lifecycle.test.ts>)、[浏览器探针](<../tests/browser-probe.test.mjs>)；[bundle 契约检查](<../scripts/verify-bundle.mjs>)验证惰性 factory、宿主 React 与注册清理，不是浏览器验收。

新看板在**已登录的当前 DSH 页面**中的显示、点击及与原生输入/附件/审批等共存情况，仍需用户确认或可用的已认证浏览器验收。历史交接中的早期组件验收不能自动升级成新组件全部通过；工具返回“document recorded”也不是可见性证明。
