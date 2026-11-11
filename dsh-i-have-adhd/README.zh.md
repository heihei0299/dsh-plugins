# dsh-i-have-adhd

[English](README.md) | 中文

把 DSH 面向用户的回复改造成 ADHD 友好：先给答案或下一步动作，多步工作编号，跨轮复述进度，结尾不 recap、不客套。插件只是一个系统提示词段加一个按会话生效的 `/adhd` 开关；不改 DSH 核心、工具或 Web 客户端。

灵感来自 [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd)（MIT）。规则集是针对 DSH 重写的更短版本，未逐字复制上游；见[署名](#署名)。

## 变化

| 之前 | 之后 |
| --- | --- |
| “好问题！我先看一下你的鉴权流程，这里有几个环节……” | “改 `src/auth.ts:42`：用下面的片段替换 `verifyToken`。1. 保存。2. 跑 `npm test -- auth.spec.ts`。下一步：把第一条失败行贴回来。” |

规则针对工作记忆和启动阻力，而不只是“短”：

- **形状**：动作或答案先行 - 有界步骤编号 - 只给一个下一步 - 支线留到结尾。
- **状态**：每轮回述进度 - 具体时间估计 - 完成结果可见。
- **语气**：错误只讲事实 - 可见列表最多五项（分析不截断） - 无开场白、不复述、无收尾客套。
- **例外**：明确“解释”时给足深度但保持形状；破坏性操作仍先确认；连续三轮调试失败就停下来问一个诊断问题。

## 工作方式

- 注册一个名为 `dsh-i-have-adhd` 的动态系统提示词段，order 50：紧跟部署 persona（0），在 plan policy（500）与工具指引（900+）之前。
- 文本提供器只对用户自己的 Agent 返回规则；子代理会话与无 Agent 的提示词组装得到空段，委派报告保持结构化。
- `/adhd` 查看状态，`/adhd off` 静音当前会话，`/adhd on` 恢复。开关在内存中；resume 或新会话回到 profile 默认。
- 持久开关是 profile 配置：`enabled: false` 表示保留安装但不生效。

## 安装

~~~sh
dsh plugin --profile web add "link:$PWD/dsh-i-have-adhd" --offline
~~~

无构建、无依赖。在 **设置 → 插件** 启用；下一个模型步生效。

## 配置

bundle patch 默认 `enabled: true`、`subagents: false`。profile 覆盖会替换整份 config，需重述要保留的键：

~~~yaml
- id: i-have-adhd
  config:
    enabled: true
    subagents: false
~~~

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 注册提示词段与 `/adhd`；`false` 保留安装但不生效。 |
| `subagents` | `false` | 是否也套用到委派子代理；关闭时其报告保持结构化。 |

## 规则集

完整文本在 [`src/rules.js`](src/rules.js)。它比上游 skill 短，因为每一步都要随提示词发送；当前约 600 词（约 900 tokens）/步。

## 限制

- 提示词引导而非强制：长回合仍可能漂移。`/adhd status` 只报告开关，不证明合规。
- 启用时每一步都付 token；不需要时在配置里关闭。
- `/adhd off` 只作用于当前 live Agent，不跨 resume 或新会话；持久变更请改 profile 配置。
- 只影响面向用户的散文，不改工具参数、代码、commit message 或 DSH UI 文案。
- 注册固定段名；不要与另一个同名 `i-have-adhd` 移植同时挂载，重复注册会直接报错。
- 单测与 bundle 检查不代表活体验收；安装后请确认插件卡片与一条真实回复。

## 验证

~~~sh
node --test --test-concurrency=1
node ../scripts/check-bundles.mjs .
~~~

## 署名

概念与名称来自 [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd)，Copyright (c) 2026 Ayoub Ghriss，MIT。本实现为 DSH 重写规则集，未逐字复制上游 skill 文本。插件本身 MIT；见 [LICENSE](LICENSE)。
