# dsh-plugin-pin-subagent-model 0.4.0 规格说明

| 项 | 值 |
| --- | --- |
| 插件 | `dsh-plugin-pin-subagent-model` |
| 版本 | 0.4.0 |
| 状态 | 已实现；单元测试、静态门禁与 WebUI 活体验证通过 |
| 代码提交 | `0aa59cf` |
| 适用环境 | DSH `0.2.1-rc.2`、`@deepseek-ai/cordis ~4.0.5`、`@deepseek-ai/schemastery ~3.18.5` |
| 日期 | 2026-10-24 |

本文把 0.4.0 的计划整理为可执行、可验收的规格。规范用语：**必须**（MUST）、**应当**（SHOULD）、**可以**（MAY）。

---

## 1. 背景与问题

DSH 的委派链路里，父 Agent 的实时选择会隐式传给子 Agent：

1. 委派调用省略 `provider`/`model` 时，`resolveChildAgentOptions` 用父 Agent 的 `provider`、`model`、`reasoningEffort`、`maxTokens` 填充子 Agent 路由。
2. `assertAllowedModelSelection` 只在调用显式指定路由时校验模型白名单，因此“继承父路由”可以绕过白名单。
3. 委派调用省略 `agentPreset` 时，`applyChildComposition` 让子 Agent 加入父会话当前的 preset revision（工具、persona、skill 全部继承）。
4. 预设内的 `tool-subagent` 行 id 位于 `preset-standard.config.plugins` 内，profile patch 无法按 id 修改，所以既不能在那里固定 `agentOptions`，也不能加 `agentPreset`。

由此，一个希望“所有子 Agent 使用同一路由与同一组合”的 profile 无法只靠设置或预设工具配置表达。

## 2. 方案概要

插件装饰 `SubagentRuntime.startActivation(spec)`。该入口在 `manager.startLocal` 之前运行，而 `startLocal` 正是读取 `spec.request.agentOptions` 与 `spec.request.agentPreset` 的位置。装饰器把两者改写到配置值，不触碰任何预设定义。

四个路由/预设字段声明为 Host Config 的 volatile 字段，因此同一份值既可从 profile 的 `cordis.patch.yml` 写入，也可从 WebUI 的插件行配置页写入；volatile 写入由 loader 直接提交到运行中的配置引用，插件在每次委派时重新读取。

## 3. 范围

### 3.1 目标

- 允许 profile 固定子 Agent 的 LLM 路由（已有能力，保持兼容）。
- 允许 profile **直接指定子 Agent 的 Agent preset**；不再依赖继承父会话预设。
- 在 WebUI 提供修改入口，编辑路由与预设，无需手改 YAML。
- 配置改动对运行中的 dsh 在下一次委派生效，无需重启。
- 与官方 `tool-subagent` 的 preset 选择使用同一条官方请求字段，行为可预测。
- 失败面明确：未知 preset、不可用后端、写入冲突都有可诊断结果。

### 3.2 非目标

- 不做每次委派由模型选择 `agent_preset`（不新增委派工具、不注入 tool schema）。
- 不做按 preset 分别固定路由的映射。
- 不修改、不替换官方 `tool-subagent` 的配置或工具。
- 不改变 composer 中只读模型 chip 的行为与位置。
- 不新增 Host RPC、不新增网络访问、不新增构建步骤。
- 不在 WebUI 编辑 `providers` 与 `onConflict`。

## 4. 术语

| 术语 | 含义 |
| --- | --- |
| route | `provider` + `model`（可选 `reasoningEffort`）组成的子 Agent LLM 路由 |
| preset | Agent preset id，决定子 Agent 的工具、persona、prompt sections、skills |
| pin | 本插件注入的 route 和/或 preset |
| volatile 字段 | Schemastery 配置字段，可在不 remount 条目的情况下热更新 |
| ordinary 字段 | 普通配置字段，改动会 remount 条目 |
| ConfigForm | 官方设置服务的按条目表单，按 revision 校验写入 |
| roster | `agentPresets.list()` 返回的已声明预设列表 |

## 5. 配置接口

### 5.1 Config schema

Host 入口必须导出 Schemastery `Config`：

| 字段 | 类型 | 默认 | 类别 | 说明 |
| --- | --- | --- | --- | --- |
| `provider` | string | `""` | volatile | 子 Agent LLM provider id；空表示不固定路由 |
| `model` | string | `""` | volatile | 子 Agent model id；空表示不固定路由 |
| `reasoningEffort` | string | `""` | volatile | 子 Agent 的 adapter effort；空表示沿用继承/请求值 |
| `agentPreset` | string | `""` | volatile | 子 Agent 组合的 preset id；空表示继续继承父预设 |
| `providers` | string[] | `["spawn", "fork"]` | ordinary | 参与 pin 的后端名；空数组回落到默认值 |
| `onConflict` | `"override"` \| `"reject"` | `"override"` | ordinary | 显式请求与 pin 不一致时的处理 |

要求：

- **REQ-CFG-1**：`provider` 与 `model` 必须成对生效；只配置其中一个时视为未配置 route，不报错。
- **REQ-CFG-2**：route、preset、两者同时配置都必须有效；都不配置时插件保持加载。
- **REQ-CFG-3**：`onConflict` 只接受 `override` 与 `reject`；其他值在插件加载（以及每次委派读取时）必须抛出 `pin-subagent-model: `onConflict` must be 'override' or 'reject'`。
- **REQ-CFG-4**：所有字符串字段在读取时必须 trim；空串等价于未配置。
- **REQ-CFG-5**：volatile 字段在运行时是 `{ get(): T }` 引用；读取必须兼容裸值（测试与旧配置）与引用，且在**每次委派**重新读取，不得在 `apply` 时快照。
- **REQ-CFG-6**：字段可来自 profile patch、home patch 或 CLI overlay；实际生效值由 DSH 配置层决定。WebUI 写入通过 ConfigForm 持久化到当前 profile 的 Cordis patch。

### 5.2 配置示例

```yaml
- id: pin-subagent-model
  config:
    provider: cpa
    model: cline-pass/deepseek-v4.1-flash
    reasoningEffort: max
    agentPreset: standard
    providers: [spawn, fork]
    onConflict: override
```

### 5.3 未配置行为

- **REQ-CFG-7**：route 与 preset 都未配置时，插件必须保持启用、记一条警告、且不改写任何委派。
- **REQ-CFG-8**：即使启动时完全未配置，插件也**必须**装饰 `startActivation`；随后经 YAML 或 WebUI 写入的配置必须在下一次委派生效，无需 remount 或重启。
- 警告文本（启动时一次）：
  `pin-subagent-model: no `provider`/`model` or `agentPreset` configured, so no child route or preset is pinned. ...`

## 6. Host 行为

### 6.1 装饰生命周期

- **REQ-HOST-1**：插件必须在 `ctx.effect` 内替换 `subagents.startActivation`，并在 disposer 中恢复捕获的原方法；profile reload、插件禁用/启用不得叠加包装。
- **REQ-HOST-2**：装饰器必须保持同步函数形态；`onConflict: "reject"` 的抛出发生在 `startActivation` 调用栈内。
- **REQ-HOST-3**：委派规格 `spec.request` 缺失时原样返回；未命中 `providers` 的后端原样透传，且必须返回**同一个** spec 对象。
- **REQ-HOST-4**：需要改写时必须返回浅拷贝；不得修改调用方传入的 `spec` 或其 `request`、`agentOptions`。

### 6.2 注入规则

对每个 activation：

1. 重新执行配置归一化（见 REQ-CFG-5）。
2. 若 `spec.provider` 不在 `providers` 中 → 透传。
3. 目标后端是否接受独立 preset：
   - `capabilities.agentPreset === true` 且
   - `inheritsParentContext !== true`。
4. route：存在有效 route 时，把 `request.agentOptions` 覆盖为 pinned `provider`/`model`；配置了 `reasoningEffort` 时一并覆盖，否则保留原 effort。
5. preset：配置了 preset 且后端接受独立 preset 时，写 `request.agentPreset = <id>`。
6. 未命中后端注册表时：不注入 preset，并记一次告警（见 6.5）。

### 6.3 组合矩阵

| 配置 | spawn（支持 preset） | fork（不支持 preset） |
| --- | --- | --- |
| 仅 route | 改写路由 | 改写路由 |
| 仅 preset | 写 preset；路由保持继承/请求值 | **不写** preset；不改路由；一次性告警 |
| route + preset | 两者都写 | 改写路由；不写 preset；一次性告警 |
| 都没有 | 透传 | 透传 |

### 6.4 冲突处理

- **REQ-CONF-1**：显式请求的路由与 pin 不同（且请求带 `provider`）时：
  - `override`：告警并采用 pin；
  - `reject`：抛出 `... pins child Agents to <provider>/<model>`。
- **REQ-CONF-2**：显式请求的 preset 与 pin 不同、且本次可注入 preset 时：
  - `override`：告警并采用 pin；
  - `reject`：抛出 `... pins child Agents to preset "<id>"`。
- **REQ-CONF-3**：请求值与 pin 相同时不产生告警，仍写入同值。
- **REQ-CONF-4**：`onConflict` 同时约束 route 与 preset。

### 6.5 日志与告警

| 场景 | 级别 | 频率 | 文本要点 |
| --- | --- | --- | --- |
| 完全未配置 | warn | 启动一次 | `no provider/model or agentPreset configured ...` |
| 配置已生效 | info | 启动一次 | route、preset、providers 摘要 |
| 路由冲突覆盖 | warn | 每次冲突 | `overriding requested child route ...` |
| preset 冲突覆盖 | warn | 每次冲突 | `overriding requested child agent preset ...` |
| 后端不能选 preset | warn | 每个 provider 一次 | `provider "<name>" cannot select an independent agent preset; ...` |

### 6.6 生效范围

- **REQ-SCOPE-1**：所有走 `subagents.startActivation` 的 spawn activation 都受约束：`subagent`、`subagent_fork`（仅路由）、`workflow` 子代理。
- **REQ-SCOPE-2**：不在 `providers` 内的后端完全不受影响，原样透传。

### 6.7 失败面

| 条件 | 结果 |
| --- | --- |
| 未知/已删除 preset | 子会话创建失败，错误来自 registry（`agent-preset/not-found`，含可用 id） |
| preset 激活失败 | `agent-preset/invalid`，含失败原因 |
| profile 无 agent-presets 服务 | 子会话创建报 `PRESET_UNAVAILABLE` |
| provider 未注册 | 插件不注入 preset；`startActivation` 随后报 `NO_PROVIDER` |
| 插件被禁用 | 装饰还原，子会话恢复继承路由与预设 |

## 7. WebUI 配置页

### 7.1 入口与可见性

- **REQ-UI-1**：客户端必须注册官方 `plugins.row.config` 槽，key 为 `dsh-plugin-pin-subagent-model#pin-subagent-model`，`locale` 为 `pin-subagent-model`。
- **REQ-UI-2**：入口位于 WebUI 侧栏「插件」页：已安装插件 → `dsh-plugin-pin-subagent-model` → 组合包详情 → 行 `pin-subagent-model`。配置控件是**行标题本身**（带 chevron 的按钮，`aria-label` 为「配置 <行标题>」），不是单独的「配置」文字按钮；点击后打开该行的配置页。
- **REQ-UI-3**：注册只在 bundle 启用时存在；行禁用或设置服务未提供时，页面显示 unavailable，不写任何值。
- **REQ-UI-4**：行页面的标题、图标与描述由插件管理器根据 `locale/*.json` 绘制；本插件不自行绘制页面 chrome。

### 7.2 字段与控件

| 字段 | 控件 | 规则 |
| --- | --- | --- |
| `provider` | 文本输入 | 与 `model` 成对；空 = 不固定路由 |
| `model` | 文本输入 | 与 `provider` 成对 |
| `reasoningEffort` | 文本输入 | 空 = 沿用继承/请求 effort |
| `agentPreset` | 下拉 | 空 = 继承父预设；选项来自 roster；失效当前值保留并标记 |
| `providers` | 静态说明 | 仅 YAML；页面不显示当前值 |
| `onConflict` | 静态说明 | 仅 YAML；页面不显示当前值 |

- **REQ-UI-5**：页面必须订阅该命名空间自己的 ConfigForm（entry id = `pin-subagent-model`），保证保存后与外部改动都能刷新。
- **REQ-UI-6**：`view === "summary"` 时返回一行静态摘要；`view === "page"` 时返回表单。
- **REQ-UI-7**：页面样式必须内联，不得新增样式表或构建步骤；客户端 bundle 仍只 `require("react")`。

### 7.3 预设 roster

- **REQ-UI-8**：roster 必须来自 `ctx.remote.agentPresets.list()`。该 Remote 调用解析为信封 `{ ok: true, value: { presets: [...] } }` 或 `{ ok: false, error }`；页面必须解包 `value`，`ok: false` 必须视为**错误状态**而不是空 roster；同时兼容测试/旧 stub 的裸 `{ presets }`。
- **REQ-UI-9**：选项顺序为“继承父预设”+ roster + 当前值（若不在 roster 中，标记“未声明”）；重复 id 去重；空 id 忽略。
- **REQ-UI-10**：`broken` 预设必须显示标记并禁止选择；roster 加载中或失败时下拉禁用，失败显示提示，当前值仍保留。
- **REQ-UI-11**：roster 只在页面挂载时读取一次，不随每次输入重新请求。

### 7.4 保存语义

- **REQ-UI-12**：页面必须维护草稿；未保存的修改不写 Host。
- **REQ-UI-13**：保存只提交变更字段，生成 `{ op: "set", path: [field], value }`；清空的字段生成 `{ op: "unset", path: [field] }`，以恢复 schema 默认值。
- **REQ-UI-14**：保存必须携带保存前快照的 `state.revision`，并在同一次 `mutate` 中提交全部变更。
- **REQ-UI-15**：`provider`/`model` 只填一个时必须阻止保存并提示；preset 不在可选项中时必须阻止保存。
- **REQ-UI-16**：`state.status !== "ready"` 时不渲染表单；`writable !== true`、`revision === undefined` 或保存中时，所有输入与保存按钮必须禁用。
- **REQ-UI-17**：保存结果为 true 时清空 dirty 并提示已保存；false 时保留草稿并提示被拒绝/冲突；传输异常时保留草稿并提示失败。
- **REQ-UI-18**：`mutate` 成功后，Host 的新快照到达时，非 dirty 的草稿必须同步为新值；dirty 时不得覆盖用户草稿。

### 7.5 持久化与热更新

- **REQ-UI-19**：写入持久化到当前 profile 的 Cordis patch；同一份 profile 配置同时服务 YAML 与 WebUI。
- **REQ-UI-20**：四个 volatile 字段的接受值由 loader 直接提交到运行引用；插件下一次委派读取新值，**不需要重启或刷新页面**。
- **REQ-UI-21**：home patch / CLI overlay 优先级更高；被其覆盖时 ConfigForm 必须拒绝写入，页面按被拒绝处理。

## 8. 与官方实现的关系

- **REQ-INT-1**：官方 `tool-subagent` 的 `agentPreset` / `allowedAgentPresets` 与本插件写同一字段 `request.agentPreset`；不引入第二套组合机制。
- **REQ-INT-2**：同值无告警；异值由 `onConflict` 决定（覆盖或失败）。
- **REQ-INT-3**：插件在官方白名单校验之后写入，因此其配置值不受 `allowedAgentPresets` 约束；这与路由 pin 绕过模型白名单同类，属于显式优先级。部署时应二选一：要模型按白名单选，用官方配置；要全局固定，用本插件。
- **REQ-INT-4**：独立 preset 会被运行时记为 `agent-preset/selected`（在 `subagent/descriptor` 之前）；冷恢复通过 `hasIndependentPresetSelection` + projection 还原，插件不介入。
- **REQ-INT-5**：fork 与任何 `inheritsParentContext` 的后端不接受独立 preset；插件必须按能力位预判，避免触发官方 `UNSUPPORTED_CAPABILITY`。
- **REQ-INT-6**：当前安装没有其他插件装饰 `startActivation`；若未来出现，装饰顺序按 Cordis effect 顺序执行，本插件只调用捕获的原方法。

## 9. 安全与隐私

- **REQ-SEC-1**：配置与表单不包含 secret；不在日志中输出凭据。
- **REQ-SEC-2**：页面不新增 RPC、不读取会话内容、不写入草稿/编辑器；只通过既有 ConfigForm 写入四个字段。
- **REQ-SEC-3**：只在用户点击保存时写 profile；取消/离开页面丢弃草稿。
- **REQ-SEC-4**：composer chip 仍为只读展示，不提供模型选择入口。

## 10. 兼容性与升级

### 10.1 版本与依赖

- `version: 0.4.0`，`engines.dsh: 0.2.1-rc.2`。
- `peerDependencies`：`@deepseek-ai/cordis ~4.0.5`、`@deepseek-ai/schemastery ~3.18.5`。
- `dsh.client.inject` 必须包含：`@deepseek-ai/dsh-api-remotes`、`@deepseek-ai/dsh-api-session-controller`、`@deepseek-ai/dsh-client-locale`、`@deepseek-ai/dsh-client-ui-conversation`、`@deepseek-ai/dsh-client-ui-plugin-manager`、`@deepseek-ai/dsh-client-ui-session`、`@deepseek-ai/dsh-client-ui-settings`。

### 10.2 机械契约

本地 `.agents/skills/dsh-compat-check/scripts/check.mjs` 必须覆盖：

- `request.agentPreset` 类型字段
- `startLocal` 使用 `request.agentPreset`
- spawn `agentPreset: true`
- fork `agentPreset: false`
- preset registry `mount(ctx, id)`
- `plugins.row.config` 槽
- `configForms.get(entryId)`
- `agentPresets/list` remote
- Schemastery `volatile()`

### 10.3 升级步骤

1. 在插件目录执行 `pnpm install`（或 `--offline`，视本地 store 而定）。
2. 替换/链接新包。
3. **重启现有 dsh 一次**，让新的 client 依赖图与 `plugins.row.config` 页面被读取。
4. 刷新现有 WebUI 页面。
5. 打开插件页的行配置，按需设置 route/preset。

之后的 volatile 配置改动不需要重启。

### 10.4 回滚

- 禁用插件行：装饰还原，子会话恢复继承路由与父预设；已记录的 `agent-preset/selected` 保留在历史子会话中，冷恢复仍按记录还原。
- 回退包版本：配置字段为增量新增，旧版本忽略未知字段；无数据迁移。
- 不修改 profile 的既有配置（`providers`/`onConflict` 等）也能安全回退。

## 11. 验收标准

| ID | 验收条件 | 验证方式 | 状态 |
| --- | --- | --- | --- |
| AC-01 | spawn 子会话收到配置的 `agentPreset`，路由仍为 pin | 单测（Host） | 通过 |
| AC-02 | fork 不注入 preset，每个后端只警告一次 | 单测（Host） | 通过 |
| AC-03 | 完全未配置时保持启用、警告、透传，且仍可热配置 | 单测（Host） | 通过 |
| AC-04 | route-only / preset-only / route+preset 三种配置均正确 | 单测（Host） | 通过 |
| AC-05 | route/preset 冲突按 `override`/`reject` 处理 | 单测（Host） | 通过 |
| AC-06 | volatile 配置变化在下一次委派被采用 | 单测（Host） | 通过 |
| AC-07 | Config schema 四个字段 volatile、两个字段 ordinary、默认值正确 | 单测（Host） | 通过 |
| AC-08 | 客户端注册 composer chip 与 `plugins.row.config`（key/locale/inject） | 单测（Client） | 通过 |
| AC-09 | 页面字段、校验、ops、revision、拒绝/异常、summary 视图 | 单测（Client） | 通过 |
| AC-10 | manifest 版本、inject 依赖、schemastery peer | 单测（Bundle） | 通过 |
| AC-11 | bundle 门禁与兼容检查 | 命令 | 通过 |
| AC-12 | 真实 WebUI 保存后委派生效、清除预设后恢复继承 | 活体验证 | 通过（见 §12.1） |

## 12. 验证记录

本次已执行：

```bash
cd pin-subagent-model && node --test --test-concurrency=1
# 52 tests / 52 pass（Host 20、Client 23、Bundle 9）

node scripts/check-bundles.mjs
# 4/4 plugin(s) satisfy the bundle contract

node .agents/skills/dsh-compat-check/scripts/check.mjs
# 33 项契约 PASS；四个插件共 235 个测试通过
# （dsh-lan-connect 29、dsh-mobile 105、dsh-smartui 49、pin-subagent-model 52）
# 退出码 0，基线一致
```

### 12.1 活体验证（2026-10-24，重启后）

入口与表单：

- 重启 `dsh-web.service`（05:36:11）后，插件页 → 已安装插件 → `子 Agent 路由与预设固定` v0.4.0 → 行 `pin-subagent-model`，行标题是 `aria-label="配置 子 Agent 路由与预设固定"` 的按钮。
- 表单显示 `provider=cpa`、`model=cline-pass/deepseek-v4.1-flash`、`reasoningEffort=max`、预设下拉包含 `standard`、`ptc`、`minimal`、`cordis`；保存后状态为「已保存。下一次委派即使用新值。」

保存 `standard` 后委派：

```text
子会话 ac66620a-2d91-4aa2-95e2-373c5655e5a8：
{"type":"agent-preset/selected","seq":0,"data":{"agentPreset":"standard"}}
{"type":"subagent/descriptor","seq":1,"data":{"provider":"spawn",
 "agentProvider":"cpa","agentModel":"cline-pass/deepseek-v4.1-flash",
 "agentReasoningEffort":"max"}}
```

清除预设（选择「继承父会话预设」并保存）后委派：

```text
profile patch 中 agentPreset 被 unset；子会话 ec3ec28f-ce67-4435-b4ee-c2237a78558b：
agent-preset/selected 事件数 = 0；
{"type":"subagent/descriptor","seq":0,"data":{"provider":"spawn",
 "agentProvider":"cpa","agentModel":"cline-pass/deepseek-v4.1-flash",
 "agentReasoningEffort":"max"}}
```

两个子代理均回复 `OK`。验证结束后 profile 恢复为未固定预设（与原配置一致），用户可在同一页面按需选择。

### 12.2 活体发现并修复的问题

首次打开配置页时预设下拉只有「继承父会话预设」。原因是 `remote.agentPresets.list()` 返回 RemoteResult 信封 `{ ok, value }`，而页面按裸 `{ presets }` 读取，得到空列表。修复：新增 `rosterFromResult` 解包信封，`ok: false` 进入错误状态，兼容裸 roster；补充单测。该修复在无需重启的情况下由新页面加载生效（服务端按请求读取新的 `client.js`），随后重新执行了上述活体验证。

## 13. 已知限制与假设

1. **未知 preset 不预校验**：registry 的 `list()` 等待 Host 树沉降，在插件激活期调用会与 Host row 激活互相等待，因此未知 id 在子会话创建时由 registry 拒绝，而不是加载期报错。
2. **fork 不能独立 preset**：受官方能力位限制；插件只做路由 pin，并对该后端一次性告警。
3. **preset 改变子代理组合**：工具、persona、prompt sections、skills 全部随 preset 变化；`minimal` 不能读写文件，不适合实现类子任务。preset 只在新子会话创建时解析，定义更新不影响已创建的子会话。
4. **绕过官方白名单**：插件配置的 preset 不受 `allowedAgentPresets` 约束（见 REQ-INT-3）；同一部署建议只用一种策略。
5. **WebUI 只覆盖常用字段**：`providers` 与 `onConflict` 仍在 profile patch 中配置。
6. **生命周期**：配置页需要新的 client 依赖图，升级后必须重启一次 dsh；之后只有 volatile 热更新。
7. **依赖安装**：`--offline` 依赖本地 pnpm store 与缓存布局；本机 pnpm v12 读不了 v11 元数据缓存，因此本次实际通过 registry 安装 `@deepseek-ai/schemastery 3.18.5`。README 已注明离线不可用时的处理。

## 14. 附录

### 14.1 文件布局与关键常量

```
pin-subagent-model/
├── index.js          Host：Config schema、readPin、startActivation 装饰
├── client.js         Client：composer chip、plugins.row.config 页面、纯函数 seams
├── cordis.patch.yml  插入 entry `pin-subagent-model`
├── locale/{en,zh}.json 插件卡片标题/描述
├── package.json      0.4.0、peer 依赖、client inject
└── test/             Host / Client / Bundle 单测
```

| 常量 | 值 |
| --- | --- |
| 插件 entry id / 设置命名空间 | `pin-subagent-model` |
| 包名 | `dsh-plugin-pin-subagent-model` |
| 行配置 slot | `plugins.row.config` |
| 行配置 key | `dsh-plugin-pin-subagent-model#pin-subagent-model` |
| composer slot | `conversation.input.right` |
| 客户端 runtime inject | `slots`、`locale`、`sessions`、`configForms`、`remote`、`remote.agentPresets` |

### 14.2 依赖的官方实现

| 依赖点 | 包 | 作用 |
| --- | --- | --- |
| `startActivation` / `assertCapabilities` | `@deepseek-ai/dsh-subagent` | 装饰入口与能力闸门 |
| `request.agentOptions` / `request.agentPreset` | `@deepseek-ai/dsh-subagent` | 子 Agent 路由与组合请求字段 |
| `agentPresets.mount` / `coldResume` | `@deepseek-ai/dsh-agent-preset-registry` | preset 挂载与恢复 |
| `agentPreset` / `allowedAgentPresets` | `@deepseek-ai/dsh-tool-subagent` | 官方同通道选择 |
| `volatile()` / ConfigForm / `plugins.row.config` | `@deepseek-ai/schemastery`、`dsh-settings`、`dsh-client-ui-settings`、`dsh-client-ui-plugin-manager` | WebUI 表单与行配置入口 |

### 14.3 参考资料

- [插件 README](../README.md)
- [仓库 README](../../README.md)
- 代码提交：`0aa59cf`
