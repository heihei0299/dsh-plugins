# dsh-session-header

English | [中文](README.zh.md)

把 dsh 自己的身份放到**每个 LLM 供应商请求**上——与 `dsh-llm-deepseek` 发出的三个 header 一致：`x-deepseek-harness-session-id`（该次调用的会话 id）、`x-deepseek-harness-user-id`（harness home 的匿名用户 id），压缩调用再加 `x-deepseek-harness-compact: 1`。

harness 没有请求级 header 缝，插件把两个官方拦截点组合起来：`llm/stream` 瀑布标记 LLM 调用并携带 `options.sessionId`，`globalThis.fetch` 补丁负责注入。`AsyncLocalStorage` 只标记某次 LLM 调用流内部的 fetch，无关 fetch 原样通过；别人已设置的 header 不覆盖；卸载时还原原始 `fetch`。

## Header 语义

- `x-deepseek-harness-session-id`：该次调用的 `GenerateOptions.sessionId`，**原样**发送（含 `session-` 前缀）；主会话、辅助调用与 in-process 子 agent 各自上报自己的 id。
- `x-deepseek-harness-user-id`：`<harness home>/.anonymous-user-id` 里的 UUID（`$DSH_HOME` > `~/.dsh`），读一次后缓存；`userId` 可覆盖；文件缺失或格式非法时不发（插件从不自己生成 id）。
- `x-deepseek-harness-compact: 1`：`GenerateOptions.purpose` 为 `compaction` 时发送。
- 工具阶段（`toolEndpoints`）只带会话 header——工具的网关调用不是 adapter 请求，不带 user-id/compact 标记。
- `header`/`value`：额外的自定义 header；`header` 有 `value` 时发该值，否则发剥掉 `session-` 的会话 id；`native: false` 时只发这一个。

## 安装

需要 `dsh`（DSH `0.2.2-rc.1` 或 `0.2.2-rc.2`）与 Node ≥ 22。从仓库根目录：

```bash
cd dsh-session-header
pnpm install --offline
dsh plugin --profile web add "link:$PWD" --offline
```

纯 JavaScript、无构建脚本；`locale/` 与 `assets/icon.svg` 供 **设置 → 插件** 的卡片读取。用 `dsh --profile <name> --dump-config` 确认出现 `dsh-session-header` 层。

也可作为 `--patch` 覆盖层加载（插件行需要绝对模块路径）：

```yaml
- insert:
    - id: session-header
      name: /absolute/path/to/dsh-session-header/index.js
      config: { native: true }
```

## 配置

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `native` | `true` | 发送 `dsh-llm-deepseek` 的三个 header |
| `userId` | — | `x-deepseek-harness-user-id` 覆盖值 |
| `header` | `x-deepseek-harness-session-id` | 额外的自定义 header 名，值为会话 id |
| `value` | — | `header` 的固定值；不设 = 当前会话 id（剥前缀） |
| `toolEndpoints` | `[]` | 允许在 `tools/execute` 瀑布内接收会话 header 的 URL 前缀；空 = 只覆盖 LLM 调用 |
| `overwriteHeaders` | `[]` | 允许覆盖已有值的 header 名（例如 provider 硬编码的占位值） |

## 说明

- `llm-deepseek` 本身已发送这三个 header；“不覆盖”规则让它保持原样，同时把同样的身份补齐给其他 adapter。
- 绝不触碰 `attributionHeaders()`；header 值按调用解析，并发会话不共享状态。

## License

[MIT](LICENSE)
