# dsh-memory

[English](README.md) | 中文

纯 Host 的 DSH 插件，把 Codex 最新的 v2 记忆引擎（`openai/codex` 的
`codex-rs/memories`，提交 `fe2f1852`）复刻到 DeepSeek Harness：后台把空闲根会话
提炼为有界摘要，合并成 `memory_summary.md`，在下一次会话注入摘要与 Codex v2
读取指令，并可选提供四个渐进式记忆工具。运行时只依赖 Node 内置模块，安装时无需
解析 DSH 的嵌套 peer 依赖。要求 Node 22.13+，这是 Node 22 系列中
`node:sqlite` 不再需要启动参数的第一个版本。

## 两阶段流程

```text
根会话启动
  -> 阶段 1：按空闲/年龄/租约/重试规则领取持久化会话
       读取 DSH 会话日志 -> 分层证据（human > final > other agent > commentary > context > tool）
       模型返回 {rollout_summary, rollout_slug}
       -> SQLite stage1_outputs + rollout_summaries/*.md
  -> 阶段 2：按使用率/新鲜度选择摘要，同步工作区并与基线比较
       无变化且摘要有效 -> 直接成功
       有新增/修改/删除 -> 一次有界模型调用 -> 校验 memory_summary.md
       -> 提交基线、记录 selected_for_phase2
  -> 下一次会话：注入 read_path_v2 + memory_summary
```

## 主要行为

- **触发**：根 Agent 的 `agent/created`（`startup` 或 `resume`）。子代理、当前
  会话、非根会话不生成。后台任务不阻塞触发回合。
- **阶段 1**：默认只处理空闲 ≥6 小时、≤10 天的会话；每次最多领取
  `maxRolloutsPerStartup` 个，最多 `concurrency` 个并行。每个会话有租约、三次重试
  与一小时退避。证据按 Codex v2 的层级和字节预算裁剪；排除 AGENTS.md、skill 正文
  和系统提示，图片/音频替换为占位符，密钥在入模前脱敏。摘要落盘前再脱敏并截到
  9,000 UTF-8 字节。
- **外部上下文**：`disableOnExternalContext: true` 时，含 `web_search`、
  `web_fetch` 或 MCP 工具调用的会话跳过，且不删除已有摘要。
- **阶段 2**：单例任务，带租约、6 小时成功冷却、90 秒心跳与一小时失败退避。按
  `usage_count`、`last_usage`/更新时间选择最多 256 条摘要；同步
  `rollout_summaries/` 并删除不再选中的文件；与
  `.dsh-memory-baseline.json` 比较后只在有变化或摘要失效时调用模型。
- **摘要契约**：首行必须是 `v1`，包含 `## User Profile`、`## User preferences`、
  `## General Tips`、`## What's in Memory`，且小于 10,000 UTF-8 字节；否则不写盘、
  不推进基线，任务进入退避重试。
- **读取路径**：`memory_summary.md` 与 Codex v2 指令作为系统提示词段注入；摘要在
  每次组装时读取，因此合并后下一次请求即可见。指令要求模型把记忆当作历史上下文、
  对易漂移事实做验证、只引用实际使用的 rollout 摘要、不要在 PR 中引用记忆，并把
  用户明确的“记住/忘记/更正”写成 `extensions/ad_hoc/notes/` 下的简短笔记。
- **可选工具**：`dedicatedTools: true` 时注册 `memory_read`、`memory_search`、
  `memory_list`、`memory_note`。读取/搜索 `rollout_summaries/*` 以及 assistant 消息里的
  `<oai-mem-citation>` 引用都会增加对应会话的 `usage_count` 与 `last_usage`，影响后续
  合并选择。

## 安装

要求 Node 22.13+ 与 DSH `0.2.2-rc.1`（`engines.dsh`；插件依赖该版本的 agent、会话持久化、系统提示词、LLM 与 tools 接口）。在仓库根目录：

```bash
dsh plugin --profile web add "link:$PWD/dsh-memory"
```

无构建步骤、无依赖。首次运行后工作区位于 `$DSH_HOME/memories_v2`（默认
`~/.dsh/memories_v2`）：

```text
memories_v2_1.sqlite          # 阶段 1 输出、任务、合并进度
memory_summary.md             # 注入后续会话
rollout_summaries/*.md        # 每会话摘要
extensions/ad_hoc/notes/*.md  # 用户明确的记忆笔记
phase2_workspace_diff.md      # 单次合并生成，成功后删除
.dsh-memory-baseline.json     # 上次成功合并的工作区基线
```

## 配置

bundle patch 已插入一条 `memory` 行；profile 覆盖会替换整份 config，需重述要保留
的键。完整默认值与逐项说明见[英文 README](README.md#configuration)，常用键：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 是否挂载。 |
| `generateMemories` | `true` | 是否运行后台管线。 |
| `useMemories` | `true` | 是否注入摘要与读取指令。 |
| `dedicatedTools` | `false` | 是否注册四个记忆工具。 |
| `disableOnExternalContext` | `false` | 是否跳过含 web/MCP 调用的会话。 |
| `minRolloutIdleHours` | `6` | 会话最短空闲时间。 |
| `maxRolloutAgeDays` | `10` | 会话最大年龄。 |
| `maxRolloutsPerStartup` | `2` | 每次启动的领取/并发上限。 |
| `maxRawMemoriesForConsolidation` | `256` | 合并输入上限。 |
| `maxUnusedDays` | `30` | 未使用记忆的保留/选择窗口。 |
| `phase2CooldownSeconds` | `21600` | 成功合并冷却。 |
| `extractModel` / `consolidationModel` | 当前路由 | 可选的模型覆盖。 |
| `summaryMaxBytes` | `10000` | 摘要写盘上限。 |
| `log` | `false` | 每次运行输出一行信息。 |

## 隐私与清理

记忆工件是配置根目录下的纯文本文件和一份 SQLite 数据库，可能包含用户请求、路径
与工具输出；密钥脱敏是尽力而为，不是保证。请保护 `$DSH_HOME`；删除记忆根目录
（或同时关闭 `generateMemories` 与 `useMemories`）即可停止并清除本地记忆。除通过
当前 DSH 路由发起的模型调用外，本插件不上传任何内容。

## 与 Codex 的差异

- **合并是一次有界模型调用**：Codex 会启动带文件工具的合并子代理，逐个读取磁盘上
  的摘要；本插件把 diff 状态、现有摘要、变化摘要与变化笔记一次性发送，受
  `maxConsolidationBytes` 限制。所有选中的摘要仍在磁盘上，未变化的旧上下文由现有
  摘要承载。
- **用内容哈希基线代替 git**：diff 工件保留 `A`/`M`/`D` 状态语义，并在相同阶段
  生成/删除，但基线是 `.dsh-memory-baseline.json`。
- **没有 rate-limit headroom 闸门**：DSH 没有等价的 Codex 速率限制快照；
  `minRateLimitRemainingPercent` 仅为配置对齐而接受。
- **没有 thread-level `memory_mode`**：外部上下文在读取被领取会话的证据时判断，
  已有输出保留而不是标记为 polluted。
- **提示词段代替 developer message**：注入的模型上下文等价，系统提示词注册表是
  host-only 插件的稳定缝。
- **会话活跃时间取工件 mtime**：JSONL 后端即持久化日志最后写入时间；没有物化工件
  的后端回退到 `header.createdAt`，可能把会话看得比实际更旧。
- **笔记不自动清理**：只有相对上次成功基线新增/修改的笔记会进入合并。

## 验证

```bash
node --test --test-concurrency=1
node ../scripts/check-bundles.mjs .
```

测试使用伪 `ctx`、伪会话持久化与伪 LLM，覆盖选择、领取/重试、证据分层、脱敏、
摘要校验、基线 diff、阶段 1、阶段 2、无变化路径与插件挂载。真实登录 GUI 或真实
模型调用不在单测范围内；活体验收仍需把插件装入 profile，并等待一个空闲超过
`minRolloutIdleHours` 的会话。

## 许可

MIT。
