# 本轮验证记录

## 已执行且通过

| 项目 | 结果 |
|---|---|
| `pnpm install` | 退出码 0，生成 pnpm 锁文件；安装脚本只允许已授权的 esbuild |
| `pnpm run typecheck` | 退出码 0 |
| `pnpm test` | 29 项通过、0 失败；文件级并发为 1 |
| 组件警告修正后的定向测试 | `pnpm exec tsx --test --test-concurrency=1 tests/render.test.tsx`，4 项通过、0 失败、无此前图表 title 警告 |
| `pnpm run build` | 退出码 0；生成 Host ESM 和惰性 Client factory |
| `pnpm run verify:bundle` | 退出码 0；验证包 ID、仅依赖宿主 React、导出资源、注册和清理契约 |
| DSH CLI 版本 | `0.2.1-rc.2` |
| 官方 CLI 安装 | `dsh plugin --profile web add link:/home/shial/Project/dsh-smartui --offline`，退出码 0 |
| 保存的 profile 状态 | `web` 的依赖与 bundles 列表包含 `@local/dsh-smartui`，patchReload 为 live |
| 真实页面基础入口 | 用户刷新后确认 SmartUI 设置及空草稿上方三个建议入口均已出现 |
| 真实会话工具调用 | `render_smart_ui` 成功返回并记录包含卡片、表格、柱状图、表单、选项的 5-block 验收文档；尚不能据此确认浏览器实际显示 |
| Chrome 调试实测（`http://127.0.0.1:50020/`） | `__DSH_BOOT__` 存在、`.smartui-root` = 1、`.smartui-launcher` = 1 且三个建议按钮可见 |
| 点击建议的行为 | 草稿由空变为 71 字提示语，launcher 消失，消息数 0，发送按钮仍在 —— **只填草稿、不自动发送** |
| 草稿清空 | `Ctrl+A` + `Backspace` 后草稿为空、launcher 恢复 |
| 设置页 | 「设置 → 通用设置」中 `.smartui-settings` 存在，两个 `select`（`chatgpt` / `on`）均可用 |

类型检查首次发现的数值字面量推断及 descriptor 窄化问题已修正。首轮 29 项测试通过时发现 SVG title 的 React 警告，已将 title 合并为单字符串，并定向复测。产物检查首次将多次读取同一个 React 模块误判为重复 React，已改为检查导入名称集合；之后构建及产物检查通过。

本地 link 安装提示 peer 依赖不会从 profile 的 node_modules 自动解析；本仓库已完成依赖准备，Host 工具测试与构建使用本仓库解析的同版本依赖。此提示不等于实际运行故障，也不应据此声称 Host 激活成功。

## 0.1.1：修复内部协议直接暴露在草稿的问题

用户实际点击选项后发现，草稿显示了完整 `SmartUI action` JSON 和长 callId。这是首版格式设计问题，不是执行报错。现已将内部动作校验与对话回复格式化分离：草稿只包含当前语言的标题、字段名和选项标签，不再展示调用 ID、actionId 或机器选项值；仍然需要用户正常发送。

新增中文选择回复和英文表单回复回归测试，验证不泄漏内部封装、正确翻译选项及布尔值。修复后执行 `pnpm run typecheck && pnpm test && pnpm run build && pnpm run verify:bundle`，全部退出码 0，31 项测试通过。用户已另行授权通过官方 CLI 短暂移除并重新添加本插件以加载更新；移除和重新添加均退出码 0，未重启 DSH、未删除仓库或会话。更新后真实页面是否已加载新代码仍需刷新确认；不把 CLI 成功等同于前端缓存已刷新。

后续核对实际安装链接仍指向本仓库，当前 Client 产物为 62331 字节；产物中的表单和选项事件处理均调用 `formatActionReply`，包含中英文可读回复模板，不再包含旧版 `SmartUI action (user-reviewed data...)` 草稿前缀。这证明修复已进入构建产物，但仍不证明已登录浏览器已取到新产物。

## 2026-10-20 23:00–23:35 第二轮浏览器验收（CDP）

**前置修复**：本轮开始时，`web` profile 的 `dsh.profile.bundles` 中已没有 `@local/dsh-smartui`，插件管理器显示 `data-plugin-status=disabled`，页面请求 `plugins/??@local/dsh-smartui/client.js&rev=aef37fd7ebfa` 返回 404，DOM 中 `.smartui-root` 为 0。经插件管理页面重新启用（状态 running，bundles 恢复该条目）并刷新后，`client.js` 返回 200，`.smartui-root` = 1。

测试手段：`/opt/google/chrome` 调试实例（CDP `127.0.0.1:9222`）+ 页面 `http://127.0.0.1:50020/`，视口 1440×900（`Emulation.setDeviceMetricsOverride`）与 320×800；仅做只读检查、点击与表单输入，未发送工具产生的动作内容。

| 项目 | 方法与证据 | 结论 |
|---|---|---|
| 五类组件渲染 | 打开历史会话「初始化当前仓库」，展开工具步骤后 `.smartui-document` = 1；`card/table/chart/form/choices` 各 = 1；标题「SmartUI 功能验收」 | 通过 |
| 表格排序 | 点击「按"通过"排序」：`aria-sort` 由 `none` → `ascending` 且行序变为 4/29，再点回到 `none`；点「按"测试批次"排序」同理 | 通过 |
| 表格复制 | 授权剪贴板后 hook `navigator.clipboard.writeText`：卡片复制得到卡片纯文本，表格复制得到含表头 TSV；未出现手动复制回退 | 通过 |
| 图表数据表 | 展开「查看图表原始数据」后出现 1 个原始数据表（类别/通过用例） | 通过 |
| 表单必填校验 | 空提交后出现 2 条「请填写此项。」且 2 个字段 `aria-invalid=true`，草稿仍为空 | 通过 |
| 表单/选项填充 | 选「浅色」+ 勾选确认后提交，草稿为中文句子（含字段名与可见 label），长度 78；选项提交追加「关于「…」，我选择：…。」；全程消息数 0、不自动发送 | 通过（0.1.1 可读回复生效） |
| 非空选区拒绝 | 在编辑器中全选 118 字后点「填入对话」，草稿长度与内容完全不变 | 通过 |
| 命令草稿 | 草稿为 `/` 且命令列表打开时点「填入对话」，草稿不变；观察到表单按钮处于 `disabled` | 通过（未逐字校验提示文案） |
| 组件开关（在线） | 设置中把「交互组件」置 off：已展开的文档立即变为 `.smartui-fallback`（doc 0 / fallback 1）；置回 on：doc 1 / fallback 0 | 通过 |
| 外观切换 | `chatgpt → native` 后 body 文本色由 `rgb(23,23,23)` 变为 `rgb(15,17,21)`，切回后还原；深色模式 body 背景 `rgb(33,33,33)`、文档文字 `rgb(236,236,236)`，切回浅色还原 | 通过 |
| 窄屏 | 320×800 下 `document.scrollingElement.scrollWidth` = 320，无页面级横向滚动；文档宽 188，表格容器自身可横向滚动（本次内容未溢出） | 通过 |
| 禁用/重启用清理 | 插件管理页把 SmartUI 关闭（bundles 移除）后刷新：`.smartui-root`/`.smartui-launcher`/`.smartui-document` 均为 0，含 `--dsw-alias` 的 style 标签回落到宿主基线（141）；重新启用并刷新：roots 恢复、doc 1、五种 block 各 1，无 `slot entry crashed` | 通过 |
| metadata 重放 | 页面刷新、插件禁用/重启用、重新打开会话后，文档仍从已记录 metadata 还原（多次重复验证） | 通过 |
| 草稿按会话隔离 | 会话 A 草稿 `/`，切到会话 B 为空，切回 A 仍为 `/` | 通过 |
| 原生发送/停止 | 新建会话发送一条短消息，「停止」可用并点击，页面显示「已停止」「1 轮 1 步」，无异常 | 部分（未捕获逐字流式增量） |
| 剪贴板复制内容 | 先 `Browser.grantPermissions` 授权剪贴板，再用 hook 记录 `navigator.clipboard.writeText` 的实参：卡片复制得到卡片纯文本；表格复制得到 TSV（含表头 `测试批次\t通过\t失败`）；未出现手动复制回退 | 通过 |
| 英文界面 | 语言切到 English 后：设置项「Chat appearance / Interactive components」、launcher「Create with SmartUI」、文档按钮「Copy / Fill into conversation / Inspect tool call」均为英文；数据内容保持原语言。已切回中文 | 通过 |
| 原生代码块与发送 | 会话「测试仅回复收到指令」发送代码类提问，回答渲染出 `pre code`（Python 二分查找示例），用量 `3 轮 3 步 · 73 tok/s`，无异常 | 通过 |
| 动作草稿端到端发送 | 新建会话「生成极简验收文档界面」：模型生成 1 卡片 + 1 选项文档；选「停止」后草稿为「关于「继续吗？」，我选择：停止。」；直接发送后对话记录中该用户消息就是这句自然语言，模型回复「收到，已按「停止」处理…」；页面内无 `sourceCallId/actionId/blockId/user-reviewed data` | 通过 |
| 附件 | 通过隐藏 `input[type=file]` 附加 `package.json`，输入区显示「package.json · JSON 1.6KB」卡片；「移除文件 package.json」后恢复 | 通过 |
| 排队发送 | 生成中（`停止` 按钮在场）在输入框键入并按 Enter：出现排队语义，草稿清空；该轮结束后「关于「继续吗？」，我选择：停止。补充：请只用一句话总结。」作为下一条用户消息被投递，用量 `5 轮 6 步` | 通过 |
| 逐字流式 | 发送前在会话滚动容器上装 MutationObserver，记录文本长度时间线：71 次变更、22 个不同长度、跨度约 12.5 秒（1010→1129 逐段增长） | 通过 |
| 流式期间点击动作 | 生成中点「填入对话」：动作被接受并写入草稿（DSH 在运行中仍可编辑输入），随后随 Enter 一起排队发送；本 profile 未出现「锁定输入」态 | 通过（无锁定态可测） |

**本轮无法构造的项**：计划模式与权限审批在本环境不存在（Agent 预设只有「标准模式 / PTC 模式」，访问模式只有「完全权限」，记为 N/A）；旧版/非法 metadata 的页面降级摘要与设置保存被拒提示未构造（前者由 `tests/protocol.test.ts` 的 `validateDocument` 拒绝用例覆盖，页面侧走 ToolView 的降级分支）。

**关于「模型能看到结构化动作数据」**：`0.1.1` 起动作只以本地化自然语言写入草稿（见 HANDOFF §7.5），发送后进入对话的是可读句子而非 `actionId`/`blockId` 结构。本轮已真实发送一次（见上表「动作草稿端到端发送」），确认对话内容是自然语言且模型能据此回应。

**本轮副作用**：新增测试会话「测试仅回复收到指令」「生成极简验收文档界面」（各含真实模型回复）；「初始化当前仓库」保持打开且部分步骤已展开；曾附加并移除一个 `package.json` 附件；主题曾切深色并还原；语言曾切英文并还原；组件开关最终 on、外观 chatgpt、插件为启用状态。

## 0.1.2 缺陷修复（2026-10-21 00:00 后）

用户反馈：手机端每次进会话，输入框上方一直挂着「✦ 用 SmartUI 继续 / 对比方案 / 分析数据 / 收集需求」这一行。

- 根因：`Launcher` 只判断「草稿为空」，未判断会话是否已有消息；`conversation.input.dock` 是每个会话都渲染的常驻槽位，于是历史会话里也永久显示。
- 修复：`SessionProps` 增加可选 `session`（`SessionSnapshotLike.blank`），`Launcher` 在 `session.blank === false` 时返回 `null`；建议入口只在尚无已接受回合的会话里出现。版本号 `0.1.1 → 0.1.2`。
- 验证（CDP，插件 bundle `rev=9320642cce82`）：历史会话「初始化当前仓库」`.smartui-launcher` = 0（桌面 1408 宽与 390×844 移动视口均如此，移动端输入框上方只剩原生控件）；新建会话 = 1；启动页 hero = 1。
- 附带修复：`scripts/browser-probe.mjs` 的 `APP_ORIGIN` 不再硬编码 `arch.local:50020`，改为默认 `http://127.0.0.1:50020`，可用第三个参数或 `DSH_APP_ORIGIN` 覆盖；实测 `node scripts/browser-probe.mjs http://127.0.0.1:9222` 能返回页面计数（此前永远匹配不到 DSH 标签页）。`pnpm test` glob 补上 `tests/*.test.mjs`，探针自测纳入常规测试（37 项全通过）。

## 仍待真实环境确认

- CLI 输出没有 `application: applied` 的运行时确认；用户确认基础入口可见、真实工具调用成功，Chrome 调试实测确认了 launcher、建议填入、设置页，以及后来的五类组件与交互验收。
- 地址实测：`http://127.0.0.1:50020/` **可用且已认证**（推荐）；`http://arch.local:50020/` 在调试 Chrome 中报 `ERR_EMPTY_RESPONSE`；`http://127.0.0.1:3080/` 返回 HTTP 401。
- 未读取登录 token、cookie、个人浏览器 profile、密码或密钥，也未尝试绕过认证。
- 第一轮 CDP 检查时 `.smartui-document` 与五类 block 均为 0，原因是该页没有产生工具调用；第二轮改用「初始化当前仓库」会话中真实工具调用留下的 metadata，五类组件与交互均已实测（见上节）。
- 为触发端到端渲染曾发送一条消息，模型回了一轮并弹出「提问」卡片，随后按用户要求停止（`11.1K tok`、上下文 3%）；该测试会话仍留在 DSH 中，未删除。
- 第二轮开始时发现插件在 `web` profile 中被关闭（`data-plugin-status=disabled`），客户端产物 404；已在插件管理页重新启用并刷新验证。
- 没有启动第二个 Web 服务器，没有修改 DSH 核心，没有全局安装，没有发布或创建 Git 提交。

## 下一步

A. 旧版/非法 metadata 页面降级与 B. 设置保存失败提示已由下方「Codex 补测」完成真实页面验证。C. 计划模式与权限审批仍为 N/A，需具备对应能力的独立测试环境，不计为通过。

完整检查表见 [兼容性与验收](<compatibility.md>)。若插件没有出现，应先看插件管理页的启用开关与 bundles 列表，再考虑重启；不要反复 `add/remove`。

## Codex 补测

日期：2026-10-21（Asia/Shanghai）。**本节覆盖上一轮错误接入路径导致的阻塞记录：A/B 已完成真实页面补测，C 维持 N/A。** 本机不需要、也未使用内置 Browser / Chrome / computer-use 工具；无需安装扩展。

### 接入与观察范围

- 按用户指定首先执行 `NODE_USE_ENV_PROXY=0 node -e "fetch(\"http://127.0.0.1:9222/json/list\").then(r=>r.json()).then(l=>console.log(l.filter(t=>t.type===\"page\").map(t=>t.id+\" \"+t.url).join(\"\\n\")))"`，得到：

  ```text
  A3A23CD7135B097574E0B04C737FE31C http://127.0.0.1:50020/
  ```

- Node `v24.16.0` 内置 `WebSocket` 直连 `ws://127.0.0.1:9222/devtools/page/A3A23CD7135B097574E0B04C737FE31C`；通过 `Runtime.evaluate`（`returnByValue: true`、`awaitPromise: true`）检查与操作原有已认证页面。所有 Node 接入命令均带 `NODE_USE_ENV_PROXY=0`。
- CDP 开启 `Runtime.enable` / `Log.enable`，观察 `Runtime.exceptionThrown`、日志中的 `slot entry crashed` 及页面同名错误文本；A 两个实际渲染用例和 B 两个失败分支均未出现上述错误，累计未捕获异常事件 **0**。通过 `Page.captureScreenshot` 截图并目视核对兜底文本与两条设置提示；辅助脚本、截图均在 `/tmp`，未写入仓库。

### A. 无效 / 旧版 metadata 页面降级：通过

- 原会话：`~/.dsh/sessions/--home-shial-Project-dsh-smartui--/session-33b80831-3777-4066-99f9-ee120682d132/`（「生成极简验收文档界面」，有实际 `render_smart_ui` 工具结果）。使用 `cp -a` 复制两份，仅移除副本的 `session.lock`；将副本首行会话 `id` 改为新目录名以免身份冲突，仅在第 21 行 `tool/result` 的 `data.meta.smartui` 中改动目标字段，原工具文本和其余事件保留。
- 使用 `/usr/bin/zstd` 解压 / 重压缩。**仍是单个 `session.v4.jsonl.zstd` 文件，但首个 frame 必须恰好是一行会话头**，后续事件另成 frame。首次整文件单帧压缩导致副本不入宿主列表，对未知 ID 的直接打开探针被宿主拒绝；按已安装持久层的首帧约束改为 header / events 两帧后，解压往返一致，刷新即出现两个副本。这是实验制备问题，不计为 metadata 降级用例失败或通过。
- 刷新原页面后，通过侧栏选择各实验会话，依次展开首轮「已完成，用时 5秒」和「已调用工具」，滚动到兜底区域；不是 mock 页面，也未在内存替换工具结果。

| 副本 / 变体 | 页面证据 | 结论 |
|---|---|---|
| `session-bd93fa07-1fdc-47ee-b42c-9ec3011cadaa`：`schemaVersion=2` | `.smartui-fallback` = 1，`.smartui-document` = 0；可见「无法显示交互组件，已记录的回答保留如下。」及「验收：卡片「结果」ok；选项「继续吗？」：继续/停止。」；诊断为 `$.schemaVersion: only version 1 is supported` | 通过；无 slot 崩溃、无未捕获异常 |
| `session-59e8a593-d99f-49c5-bd1b-65908409262a`：删除 `blocks` | 同样显示完整可读兜底，`.smartui-fallback` = 1，`.smartui-document` = 0；诊断为 `$.blocks: expected 1..20 items` | 通过；无 slot 崩溃、无未捕获异常 |

两种变体均确认兜底没有 `hidden` 祖先且位于视口内，并已目视核对截图；没有把折叠区中已挂载但不可见的 DOM 当作显示通过。

### B. 设置保存被拒 / 抛错的提示与回弹：通过

- 在真实「设置 → 通用设置」中从 `.smartui-settings` 的 React fiber 定位 `Settings`，向上到 Environment provider 的 `memoizedProps.value.form`。实际 `Settings` 自身 props 为空，`form` 位于 provider；已验证它与 `ctx.configForms.get('dsh-smartui')` 返回值为同一对象。
- 初值为 `status=ready`、`writable=true`、`appearance=chatgpt`、`enableComponents=true`、`revision=10`。仅临时遮蔽该对象的 `set`，不调用原方法，不改 Host 设置或权限策略。
- 使用 CDP 原生鼠标点击「交互组件」下拉框，发送 `ArrowDown` / `Enter` 尝试关闭；不是直接调用 React 的 `onChange`。两次拦截记录均为 `set('enableComponents', false)`。

| 注入分支 | 实际可见提示（`role=status`） | 开关与状态 | 结论 |
|---|---|---|---|
| `set` 返回 `false` | `settings.refused`：「Host 未接受此次修改，当前显示最近一次已接受的设置。」 | 下拉回到 `on`（开启），恢复可操作；整个配置 snapshot（含 revision）与初值一致 | 通过，非静默失败 |
| `set` 抛错（async rejection） | `settings.error`：「设置保存失败，请检查连接后重试。」 | 下拉回到 `on`（开启），恢复可操作；整个配置 snapshot 与初值一致；异常由组件处理 | 通过，非静默失败 |

两分支均做条件断言并通过。最后移除临时 own `set` 属性以恢复继承的原方法，确认函数引用、属性形态和 snapshot 全部恢复，关闭设置并刷新，探针全局变量已不存在。此项验证的是真页前端失败处理，不声称已构造真实 Host 写入拒绝或网络断开。

### C. 计划模式与权限审批

#### C1. 计划模式：已实测（此前 N/A 为误判）

之前把 C 判成 N/A 的依据是只看了两处下拉：Agent 预设只有「标准模式 / PTC 模式」，「访问模式」只有「完全权限」。遗漏了命令面板里的 `/plan` 斜杠命令——`@deepseek-ai/dsh-plan-mode` 本就随 `dsh-base` / `dsh-web-app` 安装，`@deepseek-ai/dsh-client-ui-plan/client.js` 也确实在页面加载的 bundle 里。

实测（2026-10-21，CDP，会话「初始化当前仓库」）：

1. 输入 `/plan`，命令面板出现「计划plan 进入或退出计划模式」；回车执行后草稿清空，页面出现 `aria-label="计划模式已开启，按下关闭"` 的计划控件。
2. 计划模式开启期间：`.smartui-root` 仍为 1，无 `slot entry crashed`、无未捕获异常，草稿为空。
3. 点击该控件退出：计划相关文本消失，草稿仍为空，`.smartui-root` = 1。
4. `/plan` 空输入只切换模式（handler 不产生用户消息、不触发模型回合），因此本轮没有为它花钱。

#### C2. 权限审批：N/A（非通过）

profile 的 `cordis.patch.yml` 里 `@deepseek-ai/dsh-permission-presets` 定义了三个预设（`read-only`/`approval: ask`、`workspace-write`/`approval: ask`、`danger-full-access`/`approval: never`，默认 `danger-full-access`），但页面「访问模式」选择器实际只列出「完全权限」，切不到 `approval: ask` 的预设，也就没有会弹审批卡片的场景。未改 profile 或权限策略来强行构造。


依据仍为本文 2026-10-20 第二轮记录：Agent 预设仅「标准模式 / PTC 模式」，访问模式仅「完全权限」，没有可触发的计划 / 审批场景。本轮不复验 C、不新建 profile、不修改权限策略，也不把 SmartUI 组件或设置故障注入当作原生审批通过；需有相应能力的独立测试环境后另测。

### 清理、范围与卡点

- 已回到原先「初始化当前仓库」会话。两个副本删除前分别 `echo` 确认完整路径，校验目录与文件白名单后逐文件 `unlink`、`rmdir`，未使用 `rm -rf`；两个实验目录均已不存在。源会话压缩文件在复制前、实验后及清理后 SHA-256 校验均一致，未修改任何用户既有会话目录。
- **清理限制**：删除目录后刷新，宿主仍在侧栏列出这两个已打开过的副本（残留侧栏项）；磁盘目录已删除，不应再打开这些实验 ID；侧栏菜单没有删除入口，仅有归档等操作。未为清除它们重启服务、归档会话或修改工作区配置；残留项的进一步清理未验证。A/B 本身无接入或功能阻塞，C 仍受环境能力限制。
- 最终页面正常，`.smartui-root` = 1，设置面板已关闭，草稿长度 0；没有发送消息或触发新模型回合。
- 仓库仅修改 `docs/validation.md`、`docs/compatibility.md`，以及任务明确要求的根目录 `HANDOFF.md` §5（作为「只改 docs/」的明确例外）。未改 `src/`、依赖、配置、现有设置或权限策略；未读 token/cookie/密钥，未启动第二个 Web server，未使用 mock 页面，未全局安装，未编译、运行项目测试或创建 Git 提交。
