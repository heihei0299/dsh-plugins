# dsh-cache-optimizer

[English](README.md) | 中文

把 [pi-cache-optimizer](https://github.com/jiangge/pi-cache-optimizer) 2.10.5 移植为 DeepSeek Harness（DSH）插件包。

上游是 Pi 扩展。本移植保留上游实现本身：`src/extension.ts` 就是上游 `index.ts`（只改 import 路径），
`src/core/` 就是上游 `src/` 目录，上游测试套件直接跑在它上面。本仓库新增的是 Harness 宿主
（`src/host.ts`），它提供扩展本来就会说的 Pi hook 词汇。

## 作用

- 在 Harness 提供 system-prompt section 的位置沿用上游提示词编辑：剥离逐轮抖动；技能清单改写保持休眠，因为 Harness 的技能目录本身已经紧凑（见「与 Pi 原版的差异」）。
- provider compat 支持时请求长缓存保留；没有显式 opt-in 时撤回该字段。
- 给没有自带 key 的 OpenAI 兼容代理载荷补一个保守的按会话 `prompt_cache_key`（`pi-<32 hex>`，
  会话 id 的单向哈希）；已有 key 永不覆盖；可按模型opt-out 同时移除两种拼写。
- 配置里的 compat 打开了会话亲和、但适配器运行时模型丢失时，补回 Anthropic 兼容的亲和头。
- 修复最终载荷里非法的 Anthropic `cache_control` TTL 顺序（5 分钟断点之后的 `1h`），并在 provider
  明确拒绝后保留进程内的 5 分钟回退。
- 对缺缓存/亲和 compat 的第三方 OpenAI 兼容代理提示一次；诊断 Claude 与 Kimi Coding 的自适应思考 compat。
- 缓存统计写入每实例原子分片与归档，父会话、子代理、并行进程互不覆盖。
- `/cache-optimizer` 展示当前会话、当日 `total`、本进程 `process` 计数。
- `/cache-optimizer fix` 预览、确认后修复当前模型的 compat，并写入 **DSH profile 配置**（不是 `models.json`），
  带时间戳备份、收据与自检；`rollback` 对称还原。
- 可选确定性工具排序（`toolOrder: true`），默认关闭。

缓存由 provider 侧决定、尽力而为；网关与路由仍可能隐藏用量、拒绝未知字段或把同一会话拆到多个上游。

## Pi → Harness 缝映射

| Pi hook | Harness 缝 |
| --- | --- |
| `session_start` / `session_shutdown` | `session/created` / `session/disposed` + 插件卸载 |
| `model_select` | `session/event` → `request/header` 变化 |
| `before_agent_start` | `system-prompt/assemble` 瀑布 |
| `before_provider_headers`、`before_provider_request`、`after_provider_response` | `llm/stream` 作用域 + `globalThis.fetch` 补丁 |
| `message_end` | `session/event` → `assistant/message` |
| `tool_execution_end` | `session/event` → `tool/result` |
| `agent_settled` | `session/event` → `turn/end` |
| `cache_warming_decision` | 永不触发：Harness 没有缓存预热缝 |

Pi 把可变 payload 交给扩展；Harness 请求是深冻结的。优化器自己的契约本来就是「最终序列化载荷」
（TTL 修复按线上顺序读、cache key 兜底看的就是即将发出的 body），所以适配器解析序列化后的 JSON body，
跑同一组处理链，再序列化回去。`AsyncLocalStorage` 只覆盖每次 `llm/stream` 迭代：工具、RPC、遥测
fetch 都看不到作用域；卸载插件会还原原始 `fetch`。

## 与 Pi 原版的差异

| 方面 | 这里的行为 |
| --- | --- |
| Footer 统计 | Harness 没有 TUI footer 对应物。`ui.setStatus` 把同一字符串按会话记录，并在变化时以 `info` 记日志；完整计数用 `/cache-optimizer stats`。命令输出与日志里称它为状态行（status line）。 |
| 用户可见文案 | 通知、诊断与日志都按本宿主措辞：「Harness 进程」「重新加载 profile 或重启 Harness」「状态行」、`DSH_CACHE_*` 环境变量名。上游注释与磁盘格式（`pi-cache-optimizer-stats.d`、分片 `kind`）保持原拼写，已有状态照常加载。 |
| 技能清单 | Harness 用紧凑的持久消息渲染技能目录（`- \`name\`: description`），Pi 的 XML 列表压缩无事可做；提示词路径只保留有 section 时的抖动剥离。 |
| 虚拟模型 | Harness 没有 Pi 0.99 原生虚拟模型与路由协议；相关路径保持休眠。 |
| 缓存预热 | 没有 `cache_warming_decision` 缝，零价预热报告为不可用，`fix prompt-cache` 会说明 Harness 不消费 Pi 的预热生命期。 |
| `models.json` | provider compat 在 profile（`llm-pi-ai` → `providers`）。读取时投影到 `<state>/models.json`；修复经 schema 校验的 settings 通道写回 profile。 |
| Tab 补全 | Harness 命令注册没有逐命令补全钩子；以文档列出子命令。 |
| 交互确认 | 有 UI 时 `fix`/`rollback` 走 `ctx.userQuestions`；没有则打印手工指导并且绝不写入。 |

## 命令

| 命令 | 作用 |
| --- | --- |
| `/cache-optimizer` | 有问答 UI 时给交互菜单，否则给出帮助与当前状态。 |
| `/cache-optimizer enable` / `disable` | 本进程运行时开关；重置本地缓存计数以便对比。 |
| `/cache-optimizer doctor` | 当前模型/provider/API/base URL/compat、预热资格、低命中诊断。 |
| `/cache-optimizer compat` | 适用时给出可复制的 compat 建议。 |
| `/cache-optimizer stats` / `stats all` / `stats contributors` | 当前会话模型 / 当日全部本地模型 / 贡献会话（不含会话 id）。 |
| `/cache-optimizer reset` | 重置当前 provider/model 的本地计数；不动 provider 缓存。 |
| `/cache-optimizer config footer-mode total\|session\|process` | 持久化状态行报告的计数范围（会话 / 当日 / 本进程）。 |
| `/cache-optimizer config <feature> on\|off`、`config reset` | 持久化功能开关；`reset` 只清功能覆盖。 |
| `/cache-optimizer fix` | 预览、确认后修复当前模型缺失的 compat。 |
| `/cache-optimizer fix prompt-cache` / `prompt-cache-key` / `kimi-base-url` | 定向修复，带备份、收据与自检。 |
| `/cache-optimizer rollback` | 确认后还原该模型最近一次已确认修复。 |

## 配置

Bundle 选项（`cordis.patch.yml`）：`enabled`（默认 `true`）、`openaiCacheKey`（`true`）、
`cacheRetention`（`true`）、`anthropicTtlRepair`（`true`）、`toolOrder`（`false`）、
`footerMode`（`session`）。

环境变量沿用上游名字，并提供 `DSH_CACHE_OPTIMIZER_*` 别名（Pi 名字未设置时镜像）：
`PI_CACHE_OPTIMIZER_NO_PROMPT_REWRITE`、`NO_SKILL_COMPRESSION`、`NO_OPENAI_CACHE_KEY`、
`OPENAI_CACHE_KEY=0`、`STATS_INCREMENTAL=0`、`STATS_TIMING=1`、`STATS_VERIFY=1`。
`DSH_CACHE_OPTIMIZER_DEBUG=1` 会打印每次被改写的请求（URL、大小、顶层字段）与 provider 配置解析结果。

## 本地状态

按 `DSH_CACHE_OPTIMIZER_DIR` → `$DSH_HOME/cache-optimizer`（默认 `~/.dsh/cache-optimizer`）解析；
仍兼容 `PI_CODING_AGENT_DIR`：

```text
models.json                                  profile 中 llm-pi-ai providers 的投影（派生文件，不要手改）
pi-cache-optimizer-config.json               持久化功能覆盖
pi-cache-optimizer-fix-receipt.json          最近一次修复收据
pi-cache-optimizer-stats.d/shards/*.json     每实例每日分片
pi-cache-optimizer-stats.d/archive/          归档代
pi-cache-optimizer-stats.d/epochs/           重置纪元
```

分片只含日期、不透明会话哈希、provider/model 计数与生命周期元数据——不含密钥、提示词、载荷、头、
响应或模型输出。

## 安装

需要 `dsh` 0.2.2-rc.1 与 Node ≥ 22。仓库根目录：

```bash
pnpm --dir dsh-cache-optimizer install
pnpm --dir dsh-cache-optimizer run build
dsh plugin --profile web add "link:$PWD/dsh-cache-optimizer" --offline
```

之后在 **设置 → 插件** 启用（或保留 profile patch 中的行）并刷新。没有挂载 `llm-pi-ai` 的 profile 也能加载，
此时 compat 诊断报告空 provider 配置而不是猜测。

`fix` 经 settings 通道写回当前 profile，因此该 profile 必须可写（`settings.writable`）；否则命令只打印
手工指导、不做任何修改。

## 验证

```bash
pnpm --dir dsh-cache-optimizer run typecheck
pnpm --dir dsh-cache-optimizer run build
pnpm --dir dsh-cache-optimizer test        # 上游套件 + 宿主适配器测试
```

测试套件是上游那套（23 个文件，含归档、review-findings、runtime-contracts），加上 `test/host.test.ts`：
用假 Cordis context 与桩 `globalThis.fetch` 驱动真实适配器，覆盖 cache key 兜底、已有 key 保护、Anthropic
TTL 修复、用量记账、fix→profile 往返、卸载还原 `fetch`。`test/upstream/*` 与已安装的
`@earendil-works/pi-ai`、`pi-coding-agent` 对比（仅 devDependencies）。

本机活体验证：`dsh headless --patch ./patch.yml "Reply with OK"` 配合 `DSH_CACHE_OPTIMIZER_DEBUG=1`，
可见请求带 `prompt_cache_key`，并写出一份含请求/Token 计数的已关闭分片。

## 安全与隐私

- 计数与收据从不写入密钥、提示词、载荷、头、响应或模型输出。
- provider 错误只保留模型范围内的类别，原始文本不进修复、日志或会话。
- fetch 补丁只作用于 `llm/stream` 迭代，卸载即还原。
- 修复需显式确认，只在时间戳备份之后、通过 profile 的校验通道写标量 compat 键（或修复官方 Kimi base URL）。

## 许可

MIT。`src/core/` 与 `src/extension.ts` 派生自
[pi-cache-optimizer](https://github.com/jiangge/pi-cache-optimizer)（MIT，© 2026 freescheme）；宿主适配器与
DSH 集成属于本仓库。
