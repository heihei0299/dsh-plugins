# dsh-session-header

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：给 harness 发出的**每一个 LLM 请求**带上 dsh 自己的身份——与 `dsh-llm-deepseek` 发出的三个 header 一致：`x-deepseek-harness-session-id`（发起该次调用的 harness session id）、`x-deepseek-harness-user-id`（harness home 的匿名用户 id）、压缩调用额外带 `x-deepseek-harness-compact: 1`。

## 为什么需要它

harness 没有请求级 header 缝——`GenerateOptions` 没有 headers 字段，每个 adapter 都在自己内部构造线上 header。如果你的模型网关（或中间代理）按 session header 做路由、缓存或审计，harness 自身发不出这个 header。

本插件把两个官方拦截点组合起来补上这个缺口：

- **`llm/stream` waterfall** 标记出哪些调用是 LLM 调用，并携带 `options.sessionId`；
- **`globalThis.fetch` 补丁** 注入 header，所有基于 fetch 的 adapter（`llm-deepseek`、`llm-pi-ai`，以及任何传输层最终落在全局 fetch 上的 SDK）都被覆盖，无需改 adapter 代码。

上下文传播用 `AsyncLocalStorage`：只有发生在某次 LLM 调用流内部的 fetch 会被触碰，无关 fetch（web RPC、遥测、工具流量）原样通过。别人已设置的 header 绝不覆盖（按 HTTP 语义大小写不敏感）。插件卸载时还原原始 `fetch`。

标头语义：

- `x-deepseek-harness-session-id`：当前调用的 `GenerateOptions.sessionId`，**原样发送**——与 `dsh-llm-deepseek` 在线上放的字符串一致，`session-` 前缀保留。主会话各轮次、压缩/起标题辅助调用、in-process 子 agent 各自上报**自己的** session id（子 agent 拥有独立的 child session id）。
- `x-deepseek-harness-user-id`：`<harness home>/.anonymous-user-id`（`$DSH_HOME` > `~/.dsh`）里的裸 UUID，只读一次并记忆；`userId` 可覆盖；文件缺失或格式不对时不发该标头（本插件从不自行生成 id）。
- `x-deepseek-harness-compact: 1`：调用的 `GenerateOptions.purpose` 为 `compaction` 时发送。
- 工具阶段（见 `toolEndpoints`）的请求只带 session 标头——工具对网关的调用不是 LLM adapter 请求，不带 user id 与压缩标记。
- `header`/`value`：额外的自定义标头；`header` 有 `value` 时发 `value`，否则发剥掉 `session-` 前缀的实时 session id。设 `native: false` 时只发这一个。

## 安装

需要 `dsh` CLI（DSH `0.2.2-rc.1`）与 Node ≥ 22。

### 作为 bundle 安装（推荐）

从仓库根目录准备唯一的 Host 依赖，再把 bundle 链接进现有 profile：

```bash
cd dsh-session-header
pnpm install --offline   # 若能访问 registry 可省略 --offline
dsh plugin --profile web add "link:$PWD" --offline
```

本包是纯 JavaScript、无构建脚本，不需要 pnpm ≥ 10 的构建授权。其 `locale/` 与 `assets/icon.svg` 供 **设置 → 插件** 的插件卡片读取。验证层并启动：

```sh
dsh --profile <name> --dump-config   # 应能看到 "# == dsh-session-header" 层
dsh --profile <name>
```

### 本地 checkout 用 `--patch` 覆盖层加载

```yaml
# my-overlay.yml —— 此处插件行需要绝对模块路径
- insert:
    - id: session-header
      name: /absolute/path/to/dsh-session-header/index.js
      config:
        native: true
        header: x-deepseek-harness-session-id
        # userId: my-fixed-user-id
        # value: my-fixed-session-id
```

```sh
dsh --patch ./my-overlay.yml
```

## 配置

| 字段 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| `native` | boolean | `true` | 发送 `dsh-llm-deepseek` 的三个 header（session id、user id、压缩标记） |
| `userId` | string | — | `x-deepseek-harness-user-id` 覆盖值；不设 = harness home 的 `.anonymous-user-id` |
| `header` | string | `x-deepseek-harness-session-id` | 额外的自定义 header 名，值为 session id；线上大小写不敏感 |
| `value` | string | — | `header` 的固定值；不设 = 当前调用的 harness session id（剥掉前缀） |
| `toolEndpoints` | string[] | `[]` | 工具执行期匹配的 URL 前缀。非空时，`tools/execute` 瀑布内的 fetch（例如工具里调用的网关 web-search Messages API）仅当 URL 以某前缀开头才注入 header——第三方工具目标（web_fetch 抓任意网页、GitHub、MCP 服务器等）不受影响。默认空 = 保持原有仅 LLM 注入行为 |
| `overwriteHeaders` | string[] | `[]` | 允许本插件**覆盖**已有值的 header 名列表；未列出的头仍遵守"不覆盖"规则。某些官方 provider 会硬编码占位值（如 `dsh-web-search-deepseek` 发送 `x-opencode-session: dsh-web-search`），网关会当作缺失拒绝；把该头列入（`overwriteHeaders: [x-opencode-session]`）即可用真实的会话 id 替换占位值。大小写不敏感。 |

## 验证

把某个 provider 的 `baseURL` 指向会记录请求 header 的网关（或任何回显请求头的端点），开一个会话：

```
x-deepseek-harness-session-id: session-ba104306-a748-4052-a6e3-ab60be2e4c1f
x-deepseek-harness-user-id: 95b6af3e-cab9-4d84-8f02-d7c55f56ef65
```

同一会话的所有请求带同一 session id；spawn 出的子 agent 的请求带 child session id，压缩调用额外带 `x-deepseek-harness-compact: 1`。已自带这些标头的 provider（官方 `llm-deepseek` adapter）保留自己的值。

## 说明

- `llm-deepseek` adapter 自身已发送同一组三个标头，因此对它是零改动——“不覆盖”规则保留 adapter 自己的值；其他基于 fetch 的 adapter 则获得同样的身份标头，无需改 adapter 代码。
- 绝不触碰 `attributionHeaders()`（harness 的 User-Agent 归因契约）。
- 并发会话正确处理：header 值按调用经由 AsyncLocalStorage 解析，不经过共享可变状态。

## 许可

[MIT](LICENSE)
