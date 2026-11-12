# DSH SmartUI

给现有 DSH 添加 **ChatGPT 风格外观 + 对话内声明式交互组件**。不是独立聊天网站，不替换模型、会话、编辑器或权限审批。包版本 `0.1.3`，文档协议 `schemaVersion: 1`。

本 README 与源码是可分发契约：v1 协议、交互边界和验证基线都在这里；仓库只跟踪源码、测试、配置、README 与独立视觉演示 `docs/visual-demo.html`（不加载插件、不参与构建、不在 `files`）。

## 能做什么

独立实现的 `render_smart_ui` 提供八类叶节点及一层分组：表格可本地筛选、排序和复制，图表可查看原始数据，表单会校验输入；布局随容器宽度适配，支持明暗主题与可访问性设置。设计参考 [dsh-genui](https://github.com/omdsh-dev/dsh-genui/tree/ad8dc166deaf4eee7dea758fc0a84a8728402b52)，但不是其协议兼容实现。

调用由模型决定；交互只能填入原生草稿，**由用户审阅并发送**，不执行 HTML、JavaScript、命令或 URL 动作。文档保存在工具结果 metadata 中，可重放为独立 Chat 行；未提交的输入、筛选和展开状态不承诺刷新恢复。

## v1 协议

工具只接受一个 `document` 参数：

```ts
interface SmartUIDocument {
  schemaVersion: 1;
  title?: string;
  summary: string;
  blocks: SmartUIBlock[];
}
```

`summary` 必需且非空白。未知版本、字段、区块类型或非法引用会让**整份文档**失败，没有局部修复或迁移。

- 文档与节点都是严格白名单结构：循环、访问器、Symbol/隐藏属性、非 JSON 值、自定义原型、稀疏数组以及 `__proto__`/`constructor`/`prototype` 键被拒绝。
- 根深度 0、深度 ≤10、遍历值总数 ≤15,000；ID 匹配 `^[A-Za-z][A-Za-z0-9_-]*$`、≤64 字符，区块 ID 全文唯一，字段/列/系列 ID 在所属集合内唯一。
- 文本长度按 `string.length`，文档与动作大小按 UTF-8 字节；除表格单元格外，描述性文本必须非空白。业务数值须有限且在 `[-1e12, 1e12]`，`progress` 另限 `[0, 100]`。
- 字符串里的 HTML、JavaScript、URL 只作普通文本；协议没有可执行代码或跳转字段。该约束依赖提示词、UI 提醒与白名单能力，不承诺自动识别用户误填的凭据。

### 资源预算

| 项目 | 限制 |
|---|---|
| 完整文档 | ≤65,536 UTF-8 字节 |
| `blocks` | 1–20（含 group） |
| `summary` | 1–1,000 字符 |
| 标题、标签、展示值、placeholder、选项 value | 通常 ≤160；ID ≤64；caption ≤500 |
| card / callout 正文 | ≤8,000 |
| 表格 | 1–12 列、0–200 行；单元格 ≤2,000 |
| 图表 / 微趋势 | 1–4 系列、每系列 ≥1 点、每图 ≤500 点；`spark` 2–60 点 |
| 表单 / 选项 | 每个 form 1–20 字段；每个 choices/select 1–30 项 |
| 内部动作 / 可见回复 | 各自 ≤16,384 UTF-8 字节 |

参数 schema 只描述字段；长度、数量、引用关系与 JSON 安全边界由运行时 `validateDocument` 落实。

### 节点

| 类型 | 必需字段（除 `id`、`type`） | 行为 |
|---|---|---|
| `card` | `body` | `value`、`caption`；可复制可读内容 |
| `table` | `columns`、`rows` | `Cell = string \| number \| boolean \| null`；本地筛选、排序、复制导出 |
| `chart` | `chartType: bar\|line`、`series` | 各系列标签数量/内容/顺序一致；SVG + 原始数据表 |
| `form` | `actionId`、`fields` | 只有显式操作才填草稿 |
| `choices` | `actionId`、`options` | `multiple` 默认单选；必须选中有效选项 |
| `stat` | `value` | `delta`、`caption`、`tone`、`spark`（2–60 点） |
| `progress` | `value` | `variant: bar\|ring`、`caption`、progressbar ARIA |
| `callout` | `body` | `tone`；图标 + 语义色 + 读屏文案 |
| `group` | `layout: row\|column\|tabs`、`blockIds` | 只能引用同文档叶节点，不是递归容器 |

`tone` 仅 `neutral`/`success`/`warning`/`error`；stat 的 tone 只表达变化量语义，不按正负推断好坏。

- group 的 `blockIds` 非空、组内去重、可引用后定义的叶节点；禁止未知 ID、自引用、group 嵌套，每个叶节点最多属于一个 group。分组节点只按 `blockIds` 顺序在组位置显示，未归组节点保持顶层相对顺序。
- `tabs` 默认第一项，tablist/tab/tabpanel + roving tabindex，左右键循环，Home/End 跳首尾；**所有面板保持挂载，仅切换 hidden**。

完整示例：[看板](<examples/dashboard.json>)、[方案对比](<examples/comparison.json>)、[图表](<examples/chart.json>)、[表单](<examples/form.json>)。

### 表单与草稿

`fields` 每项有 `id`、`label`、`type`（`text`/`textarea`/`number`/`select`/`checkbox`），可带 `required`、`placeholder`；只有 select 带 `options`，只有 number 带 min/max。text/textarea 最多 8,000，必填文本拒绝空白；`0` 与 `false` 不算缺失。

- 内部 `SmartUIAction` 为 `{schemaVersion, sourceCallId, blockId, actionId, values}`，只用于来源与数据校验，不是隐藏事件或 RPC。用户可见回复用当前语言与可见标签生成，不附加内部 ID。
- `insertReviewedText` 先用原生 `captureInsertion` 捕获选区与 draft revision，要求折叠选区与安全整数，再写入 `\n\n${text}\n`。**不调用 `setDraft`/`submit`，不自动发送**。
- 失败提示：`changed`（revision 过期）、`unavailable`（输入不可用）、`selection`（非空选区）、`tooLarge`（>16,384 字节），均不覆盖草稿。

### 表格与导出

- 搜索 ≤160 字符，trim 后做不区分大小写的跨列子串匹配；不是正则或远程搜索。
- 先筛选再排序；number 按数字比较，否则按展示文本；null 升序靠后。纯数值列右对齐，不做货币/百分比推断。
- 复制为 TSV（默认）、CSV、Markdown，内容为**当前筛选结果的当前顺序**，不下载文件；剪贴板不可用时提供可手动复制的文本。
- TSV/CSV 对文本做公式防护（`=`/`+`/`-`/`@` 前加单引号），真实数值不变；TSV 把制表符/换行替换为空格，CSV 用双引号包裹、行间 `\r\n`，Markdown 转义管道并折叠换行。

## 兼容基线与运行边界

以 DSH `0.2.1-rc.2` 的公开声明为结构基线并在 `0.2.2-rc.1` 上复验；`engines.dsh` 接受 `0.2.1-rc.2`、`0.2.1-rc.5`、`0.2.2-rc.1`、`0.2.2-rc.2`。Client 运行时不 import 任何 DSH Client 内部包，只用宿主 React 与下列公开对象：

- Host 用 `@deepseek-ai/dsh-tools`（含 `presentationMeta`）注册工具，用 `@deepseek-ai/dsh-system-prompt` 添加可撤销提示词。
- Client 绑定 `tool.call.toolview`（当前 matcher 不校验工具名）、`conversation.chat.node`（只注册 `smartui-document`），并使用原生 `captureInsertion`/`insertText`、locale、theme、ConfigForms 与 `settings.general.item`/`conversation.input.dock` 插槽。
- 样式表按 document 引用计数，最后一个持有者释放时移除；不能假定某次卸载一定是最后一个。

## 开发与安装

需要 Node ≥22、上述三个 DSH 版本之一与 pnpm，不做全局安装。

```bash
pnpm install
pnpm run typecheck
pnpm run build            # dist/host/index.js + dist/client.js
pnpm test                 # Node 测试串行，含读取真实 dist/client.js 的回归
DSH_TEST_RUNTIME_ROOT=/path/to/dsh node --test tests/runtime-integration.test.mjs
pnpm run verify:bundle
```

先构建再跑测试与 bundle 校验（部分用例读取实际 `dist/client.js`）。`node scripts/verify-plugins.mjs dsh-smartui` 依次执行这些门禁并覆盖 `dist/`。安装：

```bash
cd dsh-smartui
dsh plugin --profile web add "link:$PWD" --offline
```

`link:` 不会替你构建，加载的是当前 `dist/`；`pnpm pack` 的 `prepack` 会先构建再校验。

设置位于 **设置 → 通用 → SmartUI**：

| 字段 | 默认 | 作用 |
|---|---|---|
| `appearance` | `chatgpt` | `chatgpt` 主题层或 `native` 原生外观 |
| `enableComponents` | `true` | 是否接受新的 UI 文档并提供组件交互 |

主题只在配置 ready 且 `appearance: chatgpt` 时生效；关闭组件后工具仍注册但 Host 拒绝新文档，提示词要求改用普通文本，历史卡片隐藏、工具行降级为文本。

## 验证与限制

静态/单元、构建产物、隔离浏览器与已登录 DSH 验收是不同层次，前者通过不证明当前 GUI 已加载新组件；真实交互、重放、审批与设备兼容需单独验证。

不提供 Canvas、任意页面生成、自动提交、外部应用写操作、未提交表单持久化或独立 UI 数据库。

## License

[MIT](<LICENSE>)。插件图标为本项目原创，与 OpenAI 无关联。
