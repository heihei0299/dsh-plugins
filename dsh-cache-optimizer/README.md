# dsh-cache-optimizer

English | [中文](README.zh.md)

A DeepSeek Harness (DSH) plugin bundle for provider-side prompt/KV cache hit rates, ported from
[pi-cache-optimizer](https://github.com/jiangge/pi-cache-optimizer) 2.10.5.

The upstream project is a Pi extension. This port keeps the upstream implementation as the
implementation: `src/extension.ts` is the upstream `index.ts` with its import paths rewritten,
`src/core/` is the upstream `src/` directory, and the upstream test suite runs against it. What
this repository adds is a Harness host (`src/host.ts`) that supplies the Pi hook vocabulary the
extension already speaks.

## What it does

- Applies the upstream prompt edits where the Harness exposes a system-prompt section: per-turn
  churn is stripped, and the skill-list rewrite stays dormant because the Harness already renders its
  catalog compactly (see [Differences from the Pi original](#differences-from-the-pi-original)).
- Requests long prompt-cache retention when the provider compat supports it, and withdraws the
  request when no explicit opt-in exists.
- Adds a conservative per-session `prompt_cache_key` fallback for OpenAI-compatible proxy payloads
  that carry none of their own (`pi-<32 hex>`, a one-way hash of the session id); an existing key is
  never overwritten, and a per-model opt-out can remove both spellings.
- Restores Anthropic-compatible session-affinity headers when the configured compat enables them but
  the adapter's runtime model lost them.
- Downgrades an invalid Anthropic `cache_control` TTL order (a `1h` breakpoint after a 5-minute one)
  in the final serialized payload, and keeps a process-local 5-minute fallback after a provider
  rejects the order.
- Warns once about third-party OpenAI-compatible proxies whose compat lacks cache/session-affinity
  flags, and diagnoses adaptive-thinking compat for Claude and Kimi Coding channels.
- Stores cache statistics in per-instance atomic shards with an archive under the DSH home, so
  parallel sessions, subagents and processes never overwrite each other.
- Shows current-session provider/model counters, `total` counters for the local day, and
  `process` counters from the last reset — through `/cache-optimizer`.
- Offers a confirmed auto-repair (`/cache-optimizer fix`) and rollback for compat problems, with a
  preview, an atomic backup and a privacy-safe receipt, written into the **DSH profile configuration**
  rather than a `models.json`.
- Optional deterministic tool ordering (`toolOrder: true`), off by default.

Caching is provider-side and best effort. Gateways and routers can still hide usage, reject unknown
fields, or route one session across several upstreams.

## How the port maps Pi to Harness

| Pi hook | Harness seam |
| --- | --- |
| `session_start` / `session_shutdown` | `session/created` / `session/disposed` + plugin disposal |
| `model_select` | `session/event` → `request/header` change |
| `before_agent_start` | `system-prompt/assemble` waterfall |
| `before_provider_headers`, `before_provider_request`, `after_provider_response` | `llm/stream` scope + a `globalThis.fetch` patch |
| `message_end` | `session/event` → `assistant/message` |
| `tool_execution_end` | `session/event` → `tool/result` |
| `agent_settled` | `session/event` → `turn/end` |
| `cache_warming_decision` | never fires: the Harness has no cache-warming seam |

A Pi request reaches an extension as a mutable payload before serialization; a Harness request is
deep-frozen. The optimizer's own contract is already "the final serialized payload" — its Anthropic
TTL repair reads wire order and its cache-key fallback inspects the body Pi is about to send — so the
adapter parses the serialized JSON body, runs the same handler chain, and serializes the result back.
`AsyncLocalStorage` scoped to each `llm/stream` iteration keeps the patch to provider calls: no tool,
RPC or telemetry fetch sees the store, and unloading the plugin restores the original `fetch`.

## Differences from the Pi original

| Area | Behaviour here |
| --- | --- |
| Footer stats | The upstream TUI footer has no Harness equivalent. `ui.setStatus` records and logs the same string per session at `info` when it changes; `/cache-optimizer stats` prints the same counters in full. Command output and logs call it the status line. |
| User-facing copy | Notices, diagnostics and log lines name this host: "Harness process", "reload the profile or restart the Harness", "status line", `DSH_CACHE_*` switch names. Upstream comments and on-disk formats (`pi-cache-optimizer-stats.d`, shard `kind`) keep their spelling so existing state keeps loading. |
| Skill list | The Harness renders its skill catalog as a compact durable message (`- \`name\`: description`), so Pi's XML-list compression has nothing to compress; the prompt path applies only the churn strip where a section exists. |
| Virtual models | Pi 0.99 native virtual models and the router registry protocol do not exist in the Harness; the code paths stay dormant. |
| Cache warming | No `cache_warming_decision` seam, so the upstream decision hook never fires and `fix prompt-cache` reports that the Harness consumes no Pi warming lifetimes. Warming is replaced by the explicit, opt-in `/cache-optimizer-warm` replay. |
| `models.json` | Provider compat lives in the profile (`llm-pi-ai` → `providers`). It is projected into `<state>/models.json` for reading; a fix writes through the schema-validated settings transport back into the profile. |
| Tab completion | The Harness command registry advertises no per-command completion hook; subcommands are documented instead. |
| Interactive prompts | `/cache-optimizer fix` and `rollback` ask through `ctx.userQuestions` when a UI is attached; without one they print manual guidance and never write. |

## Commands

| Command | Effect |
| --- | --- |
| `/cache-optimizer` | Interactive menu when a question UI is attached; otherwise help and current state. |
| `/cache-optimizer enable` / `disable` | Runtime switch for this process; resets local cache counters for a before/after comparison. |
| `/cache-optimizer doctor` | Active model/provider/API/base URL/compat, cache-warming eligibility, low-hit diagnosis. |
| `/cache-optimizer compat` | Copyable compat advice for the active model, when applicable. |
| `/cache-optimizer stats` / `stats all` / `stats contributors` | Current-session models / all local models today / contributing sessions (no session ids). |
| `/cache-optimizer reset` | Reset local counters for the active provider/model. Provider caches are untouched. |
| `/cache-optimizer config status-scope total\|session\|process` | Persist the counter scope (session / today / process) the status line reports. The upstream spelling `footer-mode` is still accepted. |
| `/cache-optimizer config <feature> on\|off`, `config reset` | Persist feature overrides; `reset` removes only feature overrides. |
| `/cache-optimizer fix` | Preview, confirm, then repair the active model's missing compat in the profile. |
| `/cache-optimizer fix prompt-cache` / `prompt-cache-key` / `kimi-base-url` | Targeted repairs with backup, receipt and self-check. |
| `/cache-optimizer rollback` | Restore the latest confirmed fix for the active model, after confirmation. |
| `/cache-optimizer-prefix` | Host-only: diff this session's last two provider request bodies and name the first byte where the cached prefix moves (path, offset, both values, tool order, verdict). |
| `/cache-optimizer-warm` | Host-only, needs `warming: true`: replay this session's last request with a one-token cap so the provider refreshes the same prompt-cache entry. Capped per session, retires after repeated failures. |
| `/cache-optimizer-prefix` | Host-only: diff this session's last two provider request bodies and name the first byte where the cached prefix moves (path, offset, both values, tool order, verdict). |
| `/cache-optimizer-warm` | Host-only, needs `warming: true`: replay this session's last request with a one-token cap so the provider refreshes the same prompt-cache entry. Capped per session, retires after repeated failures. |

## Configuration

Bundle options (`cordis.patch.yml`):

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Runtime optimization; `/cache-optimizer enable\|disable` overrides it per process. |
| `openaiCacheKey` | `true` | `prompt_cache_key` fallback for OpenAI-compatible proxies. |
| `cacheRetention` | `true` | Request long cache retention where supported. |
| `anthropicTtlRepair` | `true` | Repair invalid Anthropic `cache_control` TTL order. |
| `toolOrder` | `false` | Deterministic tool ordering for verified payload shapes. |
| `footerMode` | `session` | `session` / `total` / `process` counter scope (`/cache-optimizer config status-scope`). |
| `warming` | `false` | Allow `/cache-optimizer-warm` replays; the upstream warming decision hook never fires in the Harness. |
| `warming` | `false` | Allow `/cache-optimizer-warm` replays; the upstream warming decision hook never fires in the Harness. |

Environment variables keep the upstream names, and each one has a `DSH_CACHE_OPTIMIZER_*` alias that
is mirrored when the Pi name is unset:

| Variable | Effect |
| --- | --- |
| `PI_CACHE_OPTIMIZER_NO_PROMPT_REWRITE=1` | Disable prompt mutations; stats and cache keys stay active. |
| `PI_CACHE_OPTIMIZER_NO_SKILL_COMPRESSION=1` | Keep the native skill list. |
| `PI_CACHE_OPTIMIZER_NO_OPENAI_CACHE_KEY=1` | Disable the cache-key fallback. |
| `PI_CACHE_OPTIMIZER_OPENAI_CACHE_KEY=0` | Legacy inverse switch for the same fallback. |
| `PI_CACHE_OPTIMIZER_STATS_INCREMENTAL=0` | Kill switch for incremental cache-stats refresh. |
| `PI_CACHE_OPTIMIZER_STATS_TIMING=1` | Per-refresh timing log (JSON lines). |
| `PI_CACHE_OPTIMIZER_STATS_VERIFY=1` | Verify file identities after a background full scan. |
| `DSH_CACHE_OPTIMIZER_DEBUG=1` | Log each rewritten request (URL, size, top-level keys) and provider-config resolution. |

## Local state

Everything lives under `$DSH_CACHE_OPTIMIZER_DIR`, then `$DSH_HOME/cache-optimizer`
(`~/.dsh/cache-optimizer` by default), and `PI_CODING_AGENT_DIR` is still honoured for a Pi-era
directory:

```text
models.json                                  projection of the profile's llm-pi-ai providers (derived; do not edit)
pi-cache-optimizer-config.json               persisted feature overrides
pi-cache-optimizer-fix-receipt.json          latest fix receipt
pi-cache-optimizer-stats.d/shards/*.json     per-instance daily shards
pi-cache-optimizer-stats.d/archive/          compacted generations
pi-cache-optimizer-stats.d/epochs/           reset epochs
```

Shards contain only dates, opaque session hashes, provider/model counters and lifecycle metadata — no
API keys, prompts, payloads, headers, responses or model output.

## Install

Requires `dsh` 0.2.2-rc.1 or 0.2.2-rc.2 and Node ≥ 22. From the repository root:

```bash
pnpm --dir dsh-cache-optimizer install
pnpm --dir dsh-cache-optimizer run build
dsh plugin --profile web add "link:$PWD/dsh-cache-optimizer" --offline
```

Then enable it under **Settings → Plugins** (or keep the row in the profile patch) and refresh. A
profile that never mounts `llm-pi-ai` still loads; compat diagnostics then report an empty provider
configuration instead of guessing.

`/cache-optimizer fix` writes into the active profile through the settings transport, so that profile
must be writable (`settings.writable`); otherwise the command prints manual guidance and makes no
change.

## Verification

```bash
pnpm --dir dsh-cache-optimizer run typecheck
pnpm --dir dsh-cache-optimizer run build
pnpm --dir dsh-cache-optimizer test        # upstream suite + host-adapter tests
```

The suite is the upstream one (23 files, including the archive, review-findings and runtime-contract
suites) plus `test/host.test.ts`, which drives the real adapter against a fake Cordis context and a
stubbed `globalThis.fetch`: cache-key fallback, key preservation, Anthropic TTL repair, usage
recording, the fix-to-profile round trip, and `fetch` restoration on unload. `test/upstream/*`
compares against the installed `@earendil-works/pi-ai` and `pi-coding-agent` packages, which are
devDependencies only.

Live check used here: `dsh headless --patch ./patch.yml "Reply with OK"` with
`DSH_CACHE_OPTIMIZER_DEBUG=1` shows `prompt_cache_key` on the wire and a closed shard carrying the
request and token counters.

## Security and privacy

- Never stores credentials, prompts, payloads, headers, responses or model output in counters or
  receipts.
- Provider errors are reduced to a model-scoped category; the raw message never enters a fix, a log
  line or the session.
- The fetch patch is scoped to `llm/stream` iterations and restored on unload.
- Fixes require explicit confirmation and write only scalar compat keys (or a repaired official Kimi
  base URL) through the profile's validated settings transport, after a timestamped backup.

## License

MIT. `src/core/` and `src/extension.ts` are derived from
[pi-cache-optimizer](https://github.com/jiangge/pi-cache-optimizer) (MIT, © 2026 freescheme); the host
adapter and DSH integration are part of this repository.
