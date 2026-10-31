# DSH SmartUI

给现有 DSH 添加 **ChatGPT 风格外观 + 对话内声明式交互组件**。不是独立聊天网站，不替换模型、会话、编辑器或权限审批。包版本 `0.1.3`，文档协议 `schemaVersion: 1`，两者不是同一个版本标识。

**本 README 与源码是分发后的契约来源**：v1 协议、交互边界和验证基线都收敛在以下章节。仓库跟踪源码、测试、配置、README 与独立视觉演示 `docs/visual-demo.html`（不加载插件 bundle、不参与构建、不在 `files`，不是实装或验收依据）；`docs/` 下其余说明与截图、`HANDOFF.md`、`pnpm-lock.yaml` 不进入 git 也不随包分发，本 README 因此不链接它们。

## 能做什么

独立实现的 `render_smart_ui` 提供八类叶节点及一层分组：表格可本地筛选、排序和复制，图表可查看原始数据，表单会校验输入。布局随容器宽度适配，并支持明暗主题及可访问性设置。设计参考 [dsh-genui](https://github.com/omdsh-dev/dsh-genui/tree/ad8dc166deaf4eee7dea758fc0a84a8728402b52)，但不是其协议兼容实现。

可以请求“用交互表格比较这些方案”，或使用新会话的快捷建议；是否调用工具由模型决定。交互只能填入原生草稿，**由用户审阅并发送**；不执行 HTML、JavaScript、命令或 URL 动作。文档保存在工具结果 metadata 中，可重放为独立 Chat 行；未提交输入、筛选和展开状态不承诺刷新恢复。普通回答仍使用 Markdown。

## v1 协议与实现契约

以下为实现事实，不是待实现方案。事实来源为 `src/shared/types.ts`（类型与限制）、`src/shared/schema.ts`（工具参数声明）、`src/shared/validation.ts`（运行时校验）、`src/client/index.tsx`（客户端注册）及 `tests/`；这些路径属仓库源码、不在 `files` 中，因此不以链接引用。

### 文档结构与严格校验

工具只接受一个 `document` 参数：

```ts
interface SmartUIDocument {
  schemaVersion: 1;
  title?: string;
  summary: string;
  blocks: SmartUIBlock[];
}
```

`summary` 必需且非空白。未知版本、未知字段、未知区块类型或非法引用会使**整份文档校验失败**，没有坏节点删除、局部修复、自动重发或跨版本迁移。

- 文档及每类节点都是严格白名单结构。普通对象（含 null 原型对象）与标准数组可进入校验；循环、访问器、隐藏或 Symbol 属性、非 JSON 值、自定义原型、稀疏/装饰数组以及 `__proto__` / `constructor` / `prototype` 键被拒绝。
- JSON 边界先于序列化检查：根深度 0、深度 ≤10、遍历值总数 ≤15,000，随后按完整 JSON 的 UTF-8 编码计算文档预算。区块、字段、列、系列、`actionId` 及 group 引用的 ID 匹配 `^[A-Za-z][A-Za-z0-9_-]*$`、≤64 字符；`constructor` / `prototype` 不能作 ID。区块 ID 全文唯一，字段/列/系列 ID 在所属集合内唯一；`actionId` 是数据标识而非命令或 RPC 地址，不要求全文唯一，宿主来源调用 ID 不受此格式限制。
- 文本长度按 JavaScript `string.length`（UTF-16 码元）计，文档与动作大小按 UTF-8 字节计，两者不能互换；除表格单元格外，已提供的描述性文本必须非空白。所有业务数值必须是有限 number 且落在 `[-1e12, 1e12]`，`progress` 另限 `[0, 100]`，表单数值另受声明 min/max 限制，不把数字字符串强制转换为协议数值。
- 写在字符串里的 HTML、JavaScript、URL 只作为普通文本显示，协议没有可执行代码、事件处理器或 URL 跳转字段。不请求或填写密码、API key、token 等凭据；该约束依赖提示词、UI 提醒与白名单能力，**不承诺自动识别、打码或清除用户在普通文本框误填的秘密**。

### 资源预算

| 项目 | 限制 |
|---|---|
| 完整文档 | ≤65,536 UTF-8 字节 |
| `blocks` | 1–20，包含 group；不只计算顶层可见数量 |
| `summary` | 1–1,000 字符，非空白 |
| 标题、标签、展示值、变化量、placeholder、选项 value | 通常 ≤160；ID 另限 64；caption ≤500 |
| card / callout 正文 | ≤8,000 |
| 表格 | 每表 1–12 列、0–200 行；单元格文本 ≤2,000，可为空 |
| 图表 / 微趋势 | 每图 1–4 系列、每系列至少 1 点、每图合计 ≤500 点；每个 stat 的 `spark` 为 2–60 点 |
| 表单 / 选项 | 每个 form 1–20 字段；每个 choices 或 select 1–30 项，value 唯一 |
| 内部动作 / 可见回复 | 各自 ≤16,384 UTF-8 字节；草稿插入另有独立检查 |

工具参数 schema 描述允许的字段；部分长度、数量、引用关系及 JSON 安全边界由运行时校验落实，不应只检查参数声明而跳过 `validateDocument`。

### 八类叶节点与 group

全部节点都有必需的 `id`、`type` 及可选 `title`；未声明字段一律拒绝。

| 类型 | 必需字段（除 `id`、`type`） | 可选字段与行为 |
|---|---|---|
| `card` | `body: string` | `value`、`caption`；支持复制卡片可读内容 |
| `table` | `columns: {id,label}[]`、`rows: Cell[][]` | `Cell = string \| number \| boolean \| null`，每行长度等于列数；本地筛选、排序与复制导出 |
| `chart` | `chartType: 'bar' \| 'line'`、`series: {id,label,points:{label,value}[]}[]` | 每系列类别标签唯一，各系列标签数量、内容、顺序相同；SVG 图及可展开原始数据表 |
| `form` | `actionId`、`fields` | 见“表单与草稿动作”；只有显式操作才填草稿 |
| `choices` | `actionId`、`options: {value,label}[]` | `multiple?: boolean`，默认单选；必须选中有效选项才能填草稿 |
| `stat` | `value: string` | `delta`、`caption`、`tone`、`spark: number[]`（2–60 个有限数值，支持负数与常量序列） |
| `progress` | `value: number` | `variant: 'bar' \| 'ring'`（默认 bar）、`caption`；显示百分比并提供 progressbar ARIA |
| `callout` | `body: string` | `tone`；图标、语义色和读屏文案，不依赖颜色单独传达级别 |
| `group` | `layout: 'row' \| 'column' \| 'tabs'`、`blockIds: string[]` | 只能引用同文档叶节点，见“分组、顺序与标签”；不是递归容器 |

`tone` 只允许 `neutral` / `success` / `warning` / `error`，未提供时展示为 neutral。stat 的 tone 表示变化量语义，不能根据 delta 正负自动推断好坏；progress 不支持 tone。card 的 `value` 与 stat 的 `value` 是展示字符串，不是数值计算字段。

### 分组、顺序与标签

- 文档保持**扁平 blocks 数组**。group 的 `blockIds` 非空、组内去重，允许引用定义在 group 后面的叶节点；禁止未知 ID、自引用、group 引用 group，每个叶节点最多属于一个 group。group 与叶节点共同计入 20 区块预算，被分组的节点只在组内显示、按其 `blockIds` 顺序在该 group 位置排列；未归组叶节点保持顶层相对顺序。
- `row` 使用可自动换行的网格（窄容器允许单列），`column` 纵向排列，两者都不保证固定像素列宽。`tabs` 默认选中第一项，使用 tablist/tab/tabpanel、roving tabindex，左右键循环切换，Home/End 跳到首/尾，普通 Tab 保持浏览器行为；**所有标签面板保持挂载，仅切换 hidden**，同一文档未卸载时切页保留表单、选项、表格筛选和排序等局部状态，但这不等于刷新、关闭组件、卸载或重开会话后恢复。

完整示例：[看板](<examples/dashboard.json>)、[方案对比](<examples/comparison.json>)、[图表](<examples/chart.json>)、[表单](<examples/form.json>)，数据均为虚构，不是真实业务结论。调用方式为 `render_smart_ui({document: …})`，`document` 为示例 JSON 的完整内容。

### 表单与草稿动作

`fields` 中每项有 `id`、`label`、`type`，可带 `required`、`placeholder`；类型仅为 `text` / `textarea` / `number` / `select` / `checkbox`。只有 select 能带且必须带 `options`；只有 number 能带 min/max 且 min ≤ max。text/textarea 用户文本最多 8,000，必填文本拒绝空白；数值 0 与布尔 false 不被当作缺失，必填 checkbox 必须为 true。提交时校验字段和选项，失败聚焦首个错误字段，编辑字段后清除该字段的旧错误。
- 内部 `SmartUIAction` 为 `{schemaVersion:1, sourceCallId, blockId, actionId, values}`。来源调用 ID 非空且 ≤512；表单只接受声明字段，缺失值归为 null；选择值必须来自声明选项，不允许空、重复或多选冒充单选。内部动作只用于来源和数据校验，不是隐藏事件、RPC、命令或直接写入草稿的 JSON 协议。
- 用户可见回复使用当前语言、区块标题、字段名称、可见选项标签及本地化的是/否生成自然语言，不附加内部 callId、actionId 或 schemaVersion；用户发送后它只是标准 user message，不承诺精确机器关联、自动幂等或执行回执。
- 表单和选项的“填入对话”及建议入口点击会尝试插入；渲染、排序、筛选及切页不会触发插入或模型调用。`insertReviewedText` 先检查 actions/可编辑状态及原文本 ≤16,384 UTF-8 字节，再用原生 `captureInsertion` 捕获选区与 draft revision，要求 start/end/draftRev 为有效安全整数、起点和 revision 非负且选区折叠；实际写入 `\n\n${text}\n`，插件不会对包装后的文本再做一次字节预算检查。
- 客户端不自行比较 revision 是否仍为最新，也不解析 `/` 命令前缀：命令/编辑状态由宿主输入快照及写入契约决定，过期 revision 由宿主拒绝。`insertText` 返回 false 提示 `changed`，抛错或输入不可用提示 `unavailable`，非空选区提示 `selection`，文本过大提示 `tooLarge`，均不退回覆盖草稿。
- **不调用 `setDraft` 或 `submit`，不自动发送。** 是否允许编辑由输入状态决定，不是简单以“Session 是否正在生成”判断；生成中若原生输入框仍接受草稿，插入内容仍需用户自行发送或排队。未发送表单内容不会自动成为模型输入。

### 本地表格与导出

- 搜索框最多输入 160，查询先 trim，再做不区分大小写的跨列子串匹配；不是正则、远程搜索或跨组件数据绑定。null 的展示文本为 `—`。
- 先筛选再排序；表头在升序 / 降序 / 未排序的筛选结果顺序间循环，不修改原始记录。双方都是 number 时按数字比较，否则按展示文本比较；null 在升序时靠后，降序随方向翻转。纯数值列右对齐，但不做货币、百分比、千分位的数值推断。匹配数量与总行数可见，原始空表与筛选零匹配使用不同提示。
- 复制格式为 TSV（默认）、CSV、Markdown，均包含表头及**当前筛选结果的当前顺序**，不是隐藏的全部原始行，也不下载文件；剪贴板 API 缺失或拒绝时提供可选择的文本供手动复制，不绕过 HTTP 环境或浏览器权限。图表仅支持 SVG bar/line，坐标轴含零点，不异步加载 ECharts 或远程资源。
- TSV 和 CSV 的公式防护共享同一判定：只有文本（字符串单元格与列头）在可带前导空白的 `=` / `+` / `-` / `@` 前缀前加单引号，真实 number / boolean / null 保持原值，负数和 `-1.5` 这类数值不会被当成公式转义。TSV 另将单元格内制表符与换行替换为空格；CSV 用双引号包裹每个单元格（含列头）、内部引号加倍、行间用 `\r\n`，数值仍按数字字面量输出（例如 `"-1.5"`，不加前缀）；两者中的 null 显示为 `—`。Markdown 转义反斜杠、管道和 HTML 字符并把换行折叠为 `<br>`，面向渲染，不做公式防护。防护不保证第三方表格软件的全部解释行为。

### 兼容基线与运行边界

以 DSH `0.2.1-rc.2` 的公开声明为结构基线，`engines.dsh` 仅接受 `0.2.1-rc.2` 和 `0.2.1-rc.5`。版本门禁与自动化检查不代替目标实例的 GUI 活体验收。Client 不在运行时 import 任何 DSH Client 内部包，只用宿主 React 和下列公开对象；这些边界是本插件的最小结构类型，不是完整宿主 SDK，升级时须重新对照实际声明与集成测试。

- Host 使用 `@deepseek-ai/dsh-tools` 注册工具及 `presentationMeta`，通过 `@deepseek-ai/dsh-system-prompt` 添加可撤销提示词。
- Client 的 `tool.call.toolview` 仅绑定 `render_smart_ui`；`uiConversation.events.register` 从成功结果的 `meta.smartui` 投影 Chat 行。当前 matcher **不校验工具名**，`conversation.chat.node` 只注册自己的 `smartui-document`。
- Client 使用原生 `captureInsertion` / `insertText`、locale、theme、ConfigForms，以及 `settings.general.item` / `conversation.input.dock` 插槽，不替换宿主编辑器。样式表按 document 引用计数，最后一个持有者释放时移除；不能假定某个卸载一定是最后一个。
- metadata 由 DSH 保存，未提交的组件状态只存在已挂载组件中；草稿和发送后的消息由宿主管理，设置由 profile / ConfigForms 持有。

## 开发与安装

需要 Node ≥22、DSH `0.2.1-rc.2` 或 `0.2.1-rc.5`（`engines` 仅声明这两个版本）与 pnpm，不做全局安装。依赖安装、写入 profile 与服务重启须有相应任务授权。

```bash
# 在插件目录执行
pnpm install
pnpm run typecheck
pnpm run build            # 生成 dist/host/index.js 和 dist/client.js
pnpm test                 # Node 测试串行运行，含读取真实 dist/client.js 的导出回归
DSH_TEST_RUNTIME_ROOT=/path/to/dsh node --test tests/runtime-integration.test.mjs  # 原生 Host 集成
pnpm run verify:bundle    # 惰性 factory、宿主 React、资源与清理契约
```

先构建再运行测试和 bundle 校验：`tests/bundle-table-export.test.mjs` 读取实际 `dist/client.js`，源码单测不能证明交付产物已更新。原生 Host 集成测试需设置 `DSH_TEST_RUNTIME_ROOT`，在内存中使用目标 DSH 的 Cordis、工具注册表和 system-prompt；没有该变量时跳过，不等于 GUI 验收。仓库根目录的 `node scripts/verify-plugins.mjs dsh-smartui` 依次执行这些门禁并覆盖 `dist/`；运行时 peer 依赖须预先准备。浏览器和实际 DSH 验收是单独的可选检查。

示例与构建产物随包分发；本地笔记和独立视觉 Demo 不在包的 `files` 内。确认安装授权后，可在现有插件管理器选择本地 bundle，或运行：

```bash
# 从已构建的 dsh-smartui 目录执行
dsh plugin --profile web add "link:$PWD" --offline
```

`link:` 不会替你构建，加载的是当前工作区的 `dist/`；离线安装也不补齐依赖。`pnpm pack` 正常执行 `prepack` 时会先构建，再测试交付产物和校验 bundle；跳过 lifecycle（如 `--ignore-scripts`）则没有此保证。需要重启时按安装提示操作并刷新现有 DSH 页面；本项目不保证自动重建或 HMR。

设置位于 **设置 → 通用 → SmartUI**：

| 字段 | 默认 | 作用 |
|---|---|---|
| `appearance` | `chatgpt` | `chatgpt` 主题层或 `native` 原生外观 |
| `enableComponents` | `true` | 是否接受新的 UI 文档并提供组件交互 |

设置由 Host 的 `dsh-smartui` entry 持久化，经现有 ConfigForms 传输，不另建 Remote 或浏览器存储；加载期间不抢先应用主题，Host 拒绝保存时保留最后接受的配置。设置只能在 ready、可写且非保存中状态编辑；`set` 返回 false 提示 refused，抛错提示 error。主题只在配置 ready 且 appearance 为 chatgpt 时生效，native、loading、unavailable 都会清理已有主题层。关闭组件后，工具定义仍注册，但 Host 拒绝新的文档，提示词要求使用普通文本；历史 Turn 级卡片隐藏，工具行保留文本降级，已存 metadata 不删除。禁用整个 bundle 则撤销 Client 注册、主题层及 Host 工具；没有渲染器时，标准工具摘要仍可读。

## 验证与限制

测试覆盖协议、草稿门禁、metadata、主题、表格导出、样式生命周期和分发链接。静态/单元测试、构建产物测试、隔离浏览器与已登录 DSH 验收是不同层次：前者通过不证明当前 GUI 已加载或显示新组件。真实交互、重放、审批与设备兼容需单独验证，未执行时应记录。

不提供 Canvas、任意页面生成、自动提交、外部应用写操作、未提交表单持久化或独立 UI 数据库。

## License

[MIT](<LICENSE>)。插件图标为本项目原创，不使用 OpenAI 标志；本项目与 OpenAI 无关联。
