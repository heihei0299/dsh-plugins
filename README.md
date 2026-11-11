# dsh-plugins

DeepSeek Harness（DSH）插件集合：八个插件可独立装入 profile，不改 DSH 核心、不另起 Web 服务。需 Node ≥22。`pin-subagent-model`、`dsh-mobile`、`dsh-smartui`、`dsh-lan-connect`、`dsh-history-budget` 的版本门禁接受 `0.2.1-rc.2`、`0.2.1-rc.5` 或 `0.2.2-rc.1`，其余三个只接受 `0.2.2-rc.1`。门禁与测试不代替活体验收。

## 插件

| 插件 | 版本 | 作用 | 构建 |
| --- | --- | --- | --- |
| [pin-subagent-model](<pin-subagent-model/README.md>) | 0.4.0 | 固定子代理路由和/或预设，只读展示实际请求的模型 | 无构建，需 Host 依赖 |
| [dsh-mobile](<dsh-mobile/README.md>) | 0.3.0 | 抽屉、触屏操作、状态徽标、下拉加载历史、软键盘适配 | Host + Client |
| [dsh-smartui](<dsh-smartui/README.md>) | 0.1.3 | 主题与安全声明式卡片、表格、图表、表单及分组 | Host + Client |
| [dsh-lan-connect](<dsh-lan-connect/README.md>) | 0.1.0 | 同端口 `/lan` 自动登录入口与本地二维码 | 仅 Client |
| [dsh-mcp-skill-manager](<dsh-mcp-skill-manager/README.md>) | 0.2.0 | 按项目目录启停宿主 MCP server 与 skill，含 Web 与 dsh-go 面板 | Host + Client + dsh-go |
| [dsh-history-budget](<dsh-history-budget/README.md>) | 0.2.1 | 按字节软预算裁剪会话首帧与历史页 | 纯 Host，无依赖 |
| [dsh-memory](<dsh-memory/README.md>) | 0.1.0 | Codex v2 记忆引擎：后台摘要、`memory_summary.md` 合并与注入 | 纯 Host，无依赖 |
| [dsh-session-header](<dsh-session-header/README.md>) | 0.2.1 | 复刻 `dsh-llm-deepseek` 的三个身份标头，可扩展到工具阶段白名单网关 | 纯 Host，无构建 |

前四者声明 `@deepseek-ai/cordis ~4.0.5 || ~4.1.0`；配置、限制与更窄的验证命令见各插件 README。

## 安装

从仓库根目录准备后链接到现有 profile（会修改 profile，先确认目标）：

```bash
pnpm --dir <插件> install --offline                       # 需 Host 依赖：pin-subagent-model、dsh-session-header
pnpm --dir <插件> install && pnpm --dir <插件> run build  # 需构建：dsh-mobile、dsh-smartui、dsh-lan-connect（--ignore-scripts）、dsh-mcp-skill-manager
dsh plugin --profile web add "link:$PWD/<插件>" --offline
```

`dsh-history-budget`、`dsh-memory` 无需准备；装后在 **设置 → 插件** 启停，重启与刷新以插件管理器提示为准。

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
- **进程内改动**：`dsh-session-header` 替换 `globalThis.fetch`（卸载还原），`dsh-history-budget` 包装 `sessionController`；两者都只在各自作用域内生效。
- **子代理**：预设只适用于支持独立组合的后端，fork 继承父预设。
- **记忆**：默认只处理空闲 ≥6 小时且 ≤10 天的会话；密钥在落盘/入模前脱敏。

## 验证

```bash
node scripts/check-bundles.mjs
node scripts/check-compat.mjs --contracts-only --dsh /path/to/dsh
DSH_TEST_RUNTIME_ROOT=/path/to/dsh node --test scripts/compat-profile.test.mjs
node scripts/verify-plugins.mjs [插件...]   # 构建 + 单测，会覆盖所选 dist/
```

退出码 0/2/1 = 通过且基线一致 / 通过但基线漂移 / 失败；默认模式会跑各插件单测。`docs/*.md` 与 lockfile 留在本地，可分发契约写在各插件 README。

## 许可

各插件 MIT；`dsh-lan-connect` 含 `qrcode-generator` 的 MIT 许可。
