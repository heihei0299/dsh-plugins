# dsh-memory

[English](README.md) | 中文

把 Codex 最新的 v2 记忆引擎（`openai/codex` 的 `codex-rs/memories` @ `fe2f1852`）复刻到 DSH：空闲根会话被提炼为有界摘要，摘要合并成 `memory_summary.md`，并在后续会话注入摘要与 Codex v2 读取指令。运行时只依赖 Node 内置模块；Node 22.13+ 是 `node:sqlite` 不再需要启动参数的第一个版本。

## 管线

```text
根会话启动
  -> 阶段 1：领取空闲会话、读 DSH 日志、分层证据 -> 模型
  -> SQLite stage1_outputs + rollout_summaries/*.md
  -> 阶段 2：选择、同步、与基线比较 -> 一次有界模型调用
  -> memory_summary.md + 提交基线
  -> 下一次会话：注入 read_path_v2 + memory_summary
```

- **阶段 1**：根 Agent 的 `agent/created`（`startup`/`resume`）；子代理、非根会话跳过。会话需空闲 ≥ `minRolloutIdleHours`、年龄 ≤ `maxRolloutAgeDays`，按新到旧领取（租约、三次重试、一小时退避），每次最多 `maxRolloutsPerStartup` 个。证据按 Codex v2 层级（human > final > other agent > commentary > context > tool），排除 AGENTS.md、skill 正文与系统提示，密钥脱敏，受 `maxInputBytes` 限制。模型返回 `{"rollout_summary","rollout_slug"}`，摘要再脱敏并截到 9,000 UTF-8 字节。
- **阶段 2**：单例任务（租约、6 小时成功冷却、90 秒心跳、一小时退避）。按使用率与新鲜度选最多 `maxRawMemoriesForConsolidation` 条，同步 `rollout_summaries/`，与 `.dsh-memory-baseline.json` 比较，仅在变化或摘要失效时做一次有界合并。结果须以 `v1` 开头、包含四个必需章节且小于 `summaryMaxBytes`，之后才推进基线。
- **读取路径**：动态系统提示词段注入 `memory_summary.md` 与 Codex v2 指令，合并后下一次请求即生效。`dedicatedTools: true` 注册 `memory_read`、`memory_search`、`memory_list`、`memory_note`；读取/搜索 rollout 摘要会增加对应会话的使用计数。
- `disableOnExternalContext: true` 跳过含 `web_search`、`web_fetch` 或 MCP 调用的会话，且不删除已有摘要。

## 安装

```bash
dsh plugin --profile web add "link:$PWD/dsh-memory"
```

无构建、无依赖。工作区在 `$DSH_HOME/memories_v2`：

```text
memories_v2_1.sqlite          # 阶段 1 输出、任务、合并进度
memory_summary.md             # 注入后续会话
rollout_summaries/*.md        # 每会话摘要
extensions/ad_hoc/notes/*.md  # 用户明确的笔记
phase2_workspace_diff.md      # 单次合并生成，成功后删除
.dsh-memory-baseline.json     # 上次成功合并的基线
```

## 配置

profile 覆盖会替换整份 config，需重述要保留的键。完整默认值见[英文 README](README.md#configuration)，常用键：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 是否挂载。 |
| `generateMemories` | `true` | 是否运行后台管线。 |
| `useMemories` | `true` | 是否注入摘要与读取指令。 |
| `dedicatedTools` | `false` | 是否注册四个记忆工具。 |
| `disableOnExternalContext` | `false` | 是否跳过含 web/MCP 调用的会话。 |
| `minRolloutIdleHours` | `6` | 会话最短空闲时间。 |
| `maxRolloutAgeDays` | `10` | 会话最大年龄。 |
| `maxRolloutsPerStartup` | `2` | 每次启动的领取上限。 |
| `maxRawMemoriesForConsolidation` | `256` | 合并输入上限。 |
| `maxUnusedDays` | `30` | 未使用记忆的保留窗口。 |
| `phase2CooldownSeconds` | `21600` | 成功合并冷却。 |
| `extractModel` / `consolidationModel` | 当前路由 | 可选的模型覆盖。 |
| `summaryMaxBytes` | `10000` | 摘要写盘上限。 |
| `log` | `false` | 每次运行输出一行信息。 |

## 隐私与清理

记忆工件是配置根目录下的纯文本文件与一份 SQLite 数据库，可能包含用户请求、路径与工具输出；脱敏是尽力而为，不是保证。请保护 `$DSH_HOME`；删除记忆根目录（或同时关闭 `generateMemories` 与 `useMemories`）即可停止并清除本地记忆。除通过当前路由发起的模型调用外，本插件不上传任何内容。

## 与 Codex 的差异

- **合并是一次有界模型调用**：不是带文件工具的合并子代理；选中的摘要仍在磁盘上，未变化的旧上下文由现有摘要承载。
- **内容哈希基线代替 git**：保留 `A`/`M`/`D` 语义，基线是 `.dsh-memory-baseline.json`。
- **没有 rate-limit headroom 闸门**：DSH 没有等价快照，该键仅为配置对齐而接受。
- **没有 thread-level `memory_mode`**：外部上下文在读取被领取会话时判断，已有输出保留。
- **用系统提示词段代替 developer message**：注入的上下文等价，是 host-only 插件的稳定缝。
- **会话活跃时间取工件 mtime**：无物化工件的后端回退到 `header.createdAt`。
- **笔记不自动清理**：只有相对上次成功基线变化过的笔记会进入合并。

## 验证

```bash
node --test --test-concurrency=1
node ../scripts/check-bundles.mjs .
```

测试使用伪 `ctx`、伪持久化与伪 LLM，覆盖选择、领取/重试、证据分层、脱敏、摘要校验、基线 diff、两个阶段、无变化路径与挂载。活体验收仍需装入 profile 并等待一个空闲超过 `minRolloutIdleHours` 的会话。

## 许可

MIT。
