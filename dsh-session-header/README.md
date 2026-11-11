# dsh-session-header

English | [中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that puts dsh's own identity on **every LLM provider request** the harness sends — the same three headers `dsh-llm-deepseek` sends: `x-deepseek-harness-session-id` (the harness session id of that exact call), `x-deepseek-harness-user-id` (the harness home's anonymous user id) and `x-deepseek-harness-compact: 1` on compaction calls.

## Why

The harness has no per-request header seam — `GenerateOptions` has no headers field and every adapter builds its own wire headers internally. If your model gateway (or an intermediary proxy) keys routing, caching, or auditing on a session header, the harness cannot send one by itself.

This plugin closes that gap with the two official interception points composed together:

- the **`llm/stream` waterfall** names the calls that are LLM calls and carries `options.sessionId`;
- a **`globalThis.fetch` patch** adds the header, so every fetch-based adapter (`llm-deepseek`, `llm-pi-ai`, and any SDK whose transport bottoms out in global fetch) is covered without touching adapter code.

Context propagation uses `AsyncLocalStorage`: only fetches that happen inside an LLM call's stream are touched; unrelated fetches (web RPC, telemetry, tool traffic) pass through untouched. A header anyone else already set is never overwritten (case-insensitive, per HTTP semantics). Unloading the plugin restores the original `fetch`.

Semantics of the headers:

- `x-deepseek-harness-session-id`: `GenerateOptions.sessionId` of the call in flight, **verbatim** — the same string `dsh-llm-deepseek` puts on the wire, `session-` branding included. Main-session turns, compaction/title helper calls and in-process subagent children each report **their own** session id (subagents get their own child session ids).
- `x-deepseek-harness-user-id`: the bare UUID in `<harness home>/.anonymous-user-id` (`$DSH_HOME` > `~/.dsh`), read once and memoized. `userId` overrides it; if the file is missing or malformed the header is simply not sent (this plugin never mints an id).
- `x-deepseek-harness-compact: 1`: sent when the call's `GenerateOptions.purpose` is `compaction`.
- Tool-phase fetches (see `toolEndpoints`) carry only the session header — a tool's gateway call is not an LLM adapter request, so it gets no user-id/compact marker.
- `header`/`value`: an extra custom header. `header` carries `value` when configured, else the live session id with `session-` stripped. Set `native: false` to send only this one.

## Install

Requires the `dsh` CLI (DSH `0.2.2-rc.1`) and Node ≥ 22.

### As a bundle (recommended)

From the repository root, prepare the single Host dependency and link the bundle to an existing profile:

```bash
cd dsh-session-header
pnpm install --offline   # omit --offline if registry access is allowed and needed
dsh plugin --profile web add "link:$PWD" --offline
```

This package is plain JavaScript with no build scripts, so the pnpm ≥ 10 build allowance is not needed. Its `locale/` and `assets/icon.svg` feed the plugin card in **设置 → 插件**. Verify the layer and boot:

```sh
dsh --profile <name> --dump-config   # look for the "# == dsh-session-header" layer
dsh --profile <name>
```

### As a `--patch` overlay from a local checkout

```yaml
# my-overlay.yml — plugin rows need an absolute module path here
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

## Configuration

| field | type | default | meaning |
| --- | --- | --- | --- |
| `native` | boolean | `true` | send the `dsh-llm-deepseek` trio (session id, user id, compaction marker) |
| `userId` | string | — | `x-deepseek-harness-user-id` override; unset = the harness home's `.anonymous-user-id` |
| `header` | string | `x-deepseek-harness-session-id` | extra/custom header name for the session id; case-insensitive on the wire |
| `value` | string | — | fixed value for `header`; unset = the harness session id of the call in flight (prefix stripped) |
| `toolEndpoints` | string[] | `[]` | URL prefixes matched during tool execution. When non-empty, fetches inside a `tools/execute` waterfall — e.g. a gateway web-search Messages API called from a tool — get the header only when their URL starts with one of these prefixes; third-party tool targets (web_fetch of arbitrary pages, GitHub, MCP servers) stay untouched. Empty (default) keeps the upstream LLM-only injection. |
| `overwriteHeaders` | string[] | `[]` | Header names this plugin may overwrite when they already carry a value. Everything else keeps the "never overwrite" rule. Some official providers hard-code placeholder values (e.g. `dsh-web-search-deepseek` sends `x-opencode-session: dsh-web-search`), which gateways reject as missing; list the header here (`overwriteHeaders: [x-opencode-session]`) so the live session id replaces that placeholder. Case-insensitive. |

## Verify it

Point a provider's `baseURL` at a logging gateway (or any endpoint that echoes request headers) and start a session:

```
x-deepseek-harness-session-id: session-ba104306-a748-4052-a6e3-ab60be2e4c1f
x-deepseek-harness-user-id: 95b6af3e-cab9-4d84-8f02-d7c55f56ef65
```

Every request of the same conversation carries the same session id; a spawned subagent's requests carry the child session id, and a compaction call adds `x-deepseek-harness-compact: 1`. A provider that already sets these headers (the official `llm-deepseek` adapter) keeps its own values.

## Notes

- The `llm-deepseek` adapter already sends the same trio itself, so for that provider this plugin changes nothing — the "never overwrite" rule leaves the adapter's own values in place. Other fetch-based adapters gain the identical identity headers without patching adapter code.
- `attributionHeaders()` (the harness User-Agent attribution contract) is never touched.
- Concurrent sessions are handled correctly: the header value is resolved per call through AsyncLocalStorage, not through shared mutable state.

## License

[MIT](LICENSE)
