# dsh-plugins

DeepSeek Harness（DSH）插件集合：十个插件可独立装入 profile，不改 DSH 核心、不另起 Web 服务。需 Node ≥22。`pin-subagent-model`、`dsh-mobile`、`dsh-smartui`、`dsh-lan-connect`、`dsh-history-budget` 的版本门禁接受 `0.2.1-rc.2`、`0.2.1-rc.5`、`0.2.2-rc.1` 或 `0.2.2-rc.2`，其余五个接受 `0.2.2-rc.1` 或 `0.2.2-rc.2`。门禁与测试不代替活体验收。

## 插件

| 插件 | 版本 | 作用 | 构建 |
| --- | --- | --- | --- |
| [pin-subagent-model](<pin-subagent-model/README.md>) | 0.5.0 | 固定子代理路由和/或预设，只读展示实际请求的模型 | 无构建，需 Host 依赖 + dsh-go |
| [dsh-mobile](<dsh-mobile/README.md>) | 0.3.0 | 抽屉、触屏操作、状态徽标、下拉加载历史、软键盘适配 | Host + Client |
| [dsh-smartui](<dsh-smartui/README.md>) | 0.1.3 | 主题与安全声明式卡片、表格、图表、表单及分组 | Host + Client |
| [dsh-lan-connect](<dsh-lan-connect/README.md>) | 0.1.0 | 同端口 `/lan` 自动登录入口与本地二维码 | 仅 Client |
| [dsh-mcp-skill-manager](<dsh-mcp-skill-manager/README.md>) | 0.2.0 | 按项目目录启停宿主 MCP server 与 skill，含 Web 与 dsh-go 面板 | Host + Client + dsh-go |
| [dsh-history-budget](<dsh-history-budget/README.md>) | 0.3.0 | 按字节软预算裁剪会话首帧与历史页 | 纯 Host，无依赖 + dsh-go |
| [dsh-memory](<dsh-memory/README.md>) | 0.1.0 | Codex v2 记忆引擎：后台摘要、`memory_summary.md` 合并与注入 | 纯 Host，无依赖 |
| [dsh-session-header](<dsh-session-header/README.md>) | 0.2.1 | 复刻 `dsh-llm-deepseek` 的三个身份标头，可扩展到工具阶段白名单网关 | 纯 Host，无构建 |
| [dsh-i-have-adhd](<dsh-i-have-adhd/README.md>) | 0.2.0 | ADHD 友好输出：行动优先、步骤编号、状态复述、无客套；`/adhd on/off` 按会话切换，子代理默认不套用 | 纯 Host，无依赖 + dsh-go |
| [dsh-cache-optimizer](<dsh-cache-optimizer/README.md>) | 0.1.0 | 移植 `pi-cache-optimizer`：缓存键兜底、长保留、Anthropic TTL 修复、本地命中统计、compat 诊断与 `fix`/`rollback` | Host，TS 构建 |

`pin-subagent-model`、`dsh-mobile`、`dsh-smartui`、`dsh-lan-connect` 声明 `@deepseek-ai/cordis ~4.0.5 || ~4.1.0`，`dsh-cache-optimizer` 声明 `~4.1.0`；配置、限制与更窄的验证命令见各插件 README。

## 安装

从仓库根目录准备后链接到现有 profile（会修改 profile，先确认目标）：

```bash
pnpm --dir <插件> install --offline                       # 需 Host 依赖：pin-subagent-model、dsh-session-header
pnpm --dir <插件> install && pnpm --dir <插件> run build  # 需构建：dsh-mobile、dsh-smartui、dsh-lan-connect（--ignore-scripts）、dsh-mcp-skill-manager、dsh-cache-optimizer
dsh plugin --profile web add "link:$PWD/<插件>" --offline
```

`dsh-history-budget`、`dsh-memory`、`dsh-i-have-adhd` 无需准备；装后在 **设置 → 插件** 启停，重启与刷新以插件管理器提示为准。

## dsh-go 原生界面

`dsh-i-have-adhd`、`dsh-history-budget`、`pin-subagent-model`、`dsh-mcp-skill-manager` 提供 dsh-go 原生面板：声明式视图（`v: 1` 的 stack / text / keyValue / list / callout / actions）、面板数据与原生动作；Host 侧在 `ctx.inject(['dshGo'])` 里注册。面板位置只有 `session.tab` 与 `features` 经过验证；输入框胶囊与加号工具用 `composer.actions` / `composer.tools` 指向同一个面板。App 指南里的状态条、消息菜单、回合尾注、对话操作没有可验证的 manifest 键，本仓库不声明。

约束：

- 面板只放有界数据；超出预算或引用不存在面板的 manifest 会被 `scripts/check-dsh-go.mjs` 拦下。
- 面板不改变插件本身的生效路径：没有 dsh-go 桥接（远程主机、DSH Remote）时不注册，Web 侧行为不变。
- 所有面板都**未**在真实 dsh-go App 上做端到端验收；单测只覆盖 manifest、视图与控制器状态机。

```bash
node scripts/check-dsh-go.mjs
```

## 第三方插件

不由本仓库维护、已装在本机 profile；上游都在 GitHub，只给链接、不复制源码，安装与升级以上游为准：

| 插件 | 版本 | 上游 | 作用 |
| --- | --- | --- | --- |
| `dshmarket` | 1.73.16 | [dsh-market/dsh-market](https://github.com/dsh-market/dsh-market) | WebUI 插件市场 |
| `dsh-context` | 0.83.1 | [bowenliang123/dsh-context](https://github.com/bowenliang123/dsh-context) | 上下文仪表盘与 `/context` 命令 |
| `dsh-live-compact` | 1.1.5 | [Tranquillitatis-Lab/dsh-live-compact](https://github.com/Tranquillitatis-Lab/dsh-live-compact) | 运行中压缩最新 turn |
| `dsh-purge-community` | 1.6.86 | [kingcharleslzy-ai/dsh-purge](https://github.com/kingcharleslzy-ai/dsh-purge) | 状态自检、提示词与规则管理、备份回滚 |
| `ds-harness-remote` | 0.6.0 | [liguobao/ds-harness-remote](https://github.com/liguobao/ds-harness-remote) | P2P 加密远程访问 |
| `@deepseek-harness-tui/dsh-tui` | 0.16.1 | [ccch1mneyyy/dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) | 终端界面（`dsh-tui` profile） |

`dsh-live-compact@1.1.5` 在 `0.2.2-rc.1` 上需 profile 的精确版本豁免；启用状态以本机 profile 为准。

## 边界

- **LAN**：`/lan` 是匿名入口，通过原生信任检查即获得 operator 权限，仅限可信网络；禁用插件不撤销已签发的 Cookie。
- **项目策略**：只决定 MCP server 与 skill 在某目录是否可用，不停进程、不改 profile。
- **进程内改动**：`dsh-session-header` 替换 `globalThis.fetch`（卸载还原），`dsh-history-budget` 包装 `sessionController`，`dsh-cache-optimizer` 在 `llm/stream` 作用域内改写序列化后的请求体并替换 `globalThis.fetch`（卸载还原）；都只在各自作用域内生效。
- **缓存优化**：只改请求形状与本地计数，不改 provider 缓存；`fix`/`rollback` 写当前 profile 的 `llm-pi-ai` provider compat，需 profile 可写并显式确认。
- **子代理**：预设只适用于支持独立组合的后端，fork 继承父预设。
- **记忆**：默认只处理空闲 ≥6 小时且 ≤10 天的会话；密钥在落盘/入模前脱敏。

## 验证

```bash
node scripts/check-bundles.mjs
node scripts/check-dsh-go.mjs
node scripts/check-compat.mjs --contracts-only --dsh /path/to/dsh
DSH_TEST_RUNTIME_ROOT=/path/to/dsh node --test scripts/compat-profile.test.mjs
node scripts/verify-plugins.mjs [插件...]   # 构建 + 单测，会覆盖所选 dist/
```

退出码 0/2/1 = 通过且基线一致 / 通过但基线漂移 / 失败；默认模式会跑各插件单测。`docs/*.md` 与 lockfile 留在本地，可分发契约写在各插件 README。

## 许可

各插件 MIT；`dsh-lan-connect` 含 `qrcode-generator` 的 MIT 许可。
