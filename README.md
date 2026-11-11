# dsh-plugins

DeepSeek Harness（DSH）插件集合。七个插件可独立装入 profile，不修改 DSH 核心或启动第二个 Web 服务。要求 Node.js ≥22；除 `dsh-mcp-skill-manager`、`dsh-memory` 外的五个插件，版本门禁接受 DSH `0.2.1-rc.2`、`0.2.1-rc.5` 和 `0.2.2-rc.1`；`dsh-mcp-skill-manager` 与 `dsh-memory` 只接受 `0.2.2-rc.1`。版本门禁和自动化测试不代替目标实例的活体验收。

## 插件

| 插件 | 版本 | 作用 | 构建 |
| --- | --- | --- | --- |
| [pin-subagent-model](<pin-subagent-model/README.md>) | 0.4.0 | 固定子代理路由和/或独立预设，并只读展示实际请求的模型 | 无需构建，需安装 Host 依赖 |
| [dsh-mobile](<dsh-mobile/README.md>) | 0.3.0 | 抽屉、触屏操作、状态徽标、下拉加载历史和软键盘适配 | Host + Client |
| [dsh-smartui](<dsh-smartui/README.md>) | 0.1.3 | 主题与安全声明式卡片、表格、图表、表单及分组 | Host + Client |
| [dsh-lan-connect](<dsh-lan-connect/README.md>) | 0.1.0 | 同端口 `/lan` 自动登录入口和本地二维码 | 仅 Client |
| [dsh-mcp-skill-manager](<dsh-mcp-skill-manager/README.md>) | 0.2.0 | 按项目目录启用/禁用宿主 MCP 服务器与 skill，含 Web 设置与 dsh-go 原生面板 | Host + Client + dsh-go |
| [dsh-history-budget](<dsh-history-budget/README.md>) | 0.2.1 | 按字节软预算裁剪会话首帧与历史页 | 纯 Host，无依赖 |
| [dsh-memory](<dsh-memory/README.md>) | 0.1.0 | 复刻 Codex v2 记忆引擎：后台会话摘要、全局 `memory_summary.md` 合并与注入 | 纯 Host，无依赖 |

前四者声明 `@deepseek-ai/cordis ~4.0.5 || ~4.1.0`；各插件的配置、兼容限制和验证命令见对应 README。

## 安装

从仓库根目录按需准备**要安装的插件**，然后链接现有 profile。安装会修改选定的 profile；确认目标和授权后再执行。离线安装不会补齐本地缺失的依赖。

| 插件 | 准备命令 |
| --- | --- |
| `pin-subagent-model` | `pnpm --dir pin-subagent-model install --offline` |
| `dsh-mobile` | `pnpm --dir dsh-mobile install`，然后 `pnpm --dir dsh-mobile run build` |
| `dsh-smartui` | `pnpm --dir dsh-smartui install`，然后 `pnpm --dir dsh-smartui run build` |
| `dsh-lan-connect` | `pnpm --dir dsh-lan-connect install --ignore-scripts`，然后 `pnpm --dir dsh-lan-connect run build` |
| `dsh-mcp-skill-manager` | `pnpm --dir dsh-mcp-skill-manager install`，然后 `pnpm --dir dsh-mcp-skill-manager run build` |
| `dsh-history-budget` | 无需准备 |
| `dsh-memory` | 无需准备 |

例如安装 mobile：

```bash
dsh plugin --profile web add "link:$PWD/dsh-mobile" --offline
```

安装后可在 WebUI **设置 → 插件**中启停。是否需要重启取决于 profile 和已加载的客户端元数据；按插件管理器提示操作并刷新现有页面。更换客户端包后不要仅凭构建成功断言当前页面已更新。

## 使用边界

- **项目策略**：`dsh-mcp-skill-manager` 只决定现有 MCP server 与 skill 在某目录的可用性，不停止 MCP 进程、不修改 profile 定义；没有项目策略的目录保持全部启用。宿主级 MCP 工具会被隐藏，preset/agent 作用域注册的工具可能仍对模型可见，但调用会被拒绝。Web 与 dsh-go 原生面板共用同一份策略；原生入口只在具备 dsh-go bridge 的本地引擎出现。详见[插件 README](<dsh-mcp-skill-manager/README.md>)。
- **LAN 安全**：网络可达且通过原生 Host/Origin 信任检查的设备可通过匿名 `/lan` 获得 operator 权限，只适用于可信网络。分享链接和二维码不含 token，但 303 登录跳转会携带可复用的进程 token；禁用插件不会撤销已签发的 Cookie。
- **移动端**：默认 `mode: auto` 在宽度 ≤720px 或粗指针时启用；`mode: on` 可强制应用于桌面。关闭移动层不取消已发起的历史分页。
- **历史预算**：记录、最少保留数及 turn 对齐可能使帧超出预算；被裁记录仍由原生分页取回。`dsh-mobile` 的下拉分页是独立功能。
- **子代理**：预设只适用于支持独立组合的后端；fork 仍继承父预设。固定路由/预设与工具白名单的优先级见插件 README。
- **记忆**：`dsh-memory` 在根会话启动后后台读取已持久化会话，默认只处理空闲 ≥6 小时且 ≤10 天的会话；子代理、当前会话和外部上下文会话按配置跳过。摘要在下一次请求注入，合并仍是一次有界模型调用；密钥在落盘/入模前脱敏。详见[插件 README](<dsh-memory/README.md>)。

## 开发与验证

依赖准备好后，从仓库根目录执行：

```bash
node scripts/check-bundles.mjs                 # 只检查 bundle 元数据，不评估目标版本
node scripts/check-compat.mjs --contracts-only --dsh /path/to/dsh  # 版本门禁与所列宿主契约
DSH_TEST_RUNTIME_ROOT=/path/to/dsh node --test scripts/compat-profile.test.mjs  # 隔离 profile 装载层
node scripts/verify-plugins.mjs dsh-mobile     # 可指定一个或多个插件；省略则检查全部
node scripts/verify-plugins.mjs dsh-memory
```

兼容性检查的退出码为 0（通过且与本地基线一致）、2（通过但基线缺失或版本不同）、1（失败）。默认会跑各插件单测；`--contracts-only` 跳过单测。默认单测或完整门禁可能触发构建并覆盖所选插件的 `dist/`；若 GUI 通过 `link:` 使用该工作区，后续刷新可能加载新产物。按各插件 README 可执行更窄的测试。版本门禁、静态契约与单测不能代替已登录 GUI、真实设备或 LAN 端到端验收。

`docs/*.md` 与 lockfile 按仓库约定保留在本地、不纳入 Git；可分发契约写在各插件 README。[SmartUI 视觉概念稿](<dsh-smartui/docs/visual-demo.html>)是已跟踪的独立演示，不随插件包分发，也不是运行时验收。构建或发布应保留所用 lockfile、版本和验证记录。

## 许可

各插件为 MIT；LAN 插件随包包含 `qrcode-generator` 的第三方 MIT 许可，详见[插件 README](<dsh-lan-connect/README.md>)。
