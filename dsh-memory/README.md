# dsh-memory

English | [中文](README.zh.md)

Host-only port of Codex's v2 memory engine (`openai/codex`, `codex-rs/memories` @ `fe2f1852`): idle root sessions become bounded rollout summaries, those consolidate into `memory_summary.md`, and the summary plus Codex's read-path instructions are injected into later sessions. Runtime is Node built-ins only; Node 22.13+ is required for `node:sqlite` without a flag.

## Pipeline

```text
root session starts
  -> phase 1: claim idle sessions, read the DSH log, render tiered evidence -> model
  -> SQLite stage1_outputs + rollout_summaries/*.md
  -> phase 2: select, sync, diff against baseline -> one bounded model call
  -> memory_summary.md + baseline commit
  -> next session: prompt section = read_path_v2 + memory_summary
```

- **Phase 1** runs on root `agent/created` (`startup`/`resume`); subagents, ephemeral work and non-root sessions are skipped. Sessions idle ≥ `minRolloutIdleHours` and younger than `maxRolloutAgeDays` are claimed newest first (lease, three retries, one-hour backoff) up to `maxRolloutsPerStartup` per run. Evidence follows Codex's tier order (human > final > other agent > commentary > context > tool), excludes AGENTS.md, skill bodies and system prompts, redacts secrets and is bounded by `maxInputBytes`. The model returns `{"rollout_summary","rollout_slug"}`; the summary is redacted and capped at 9,000 UTF-8 bytes.
- **Phase 2** is a singleton job (lease, six-hour success cooldown, 90-second heartbeat, one-hour backoff). It selects up to `maxRawMemoriesForConsolidation` summaries by usage then recency, syncs `rollout_summaries/`, diffs `.dsh-memory-baseline.json`, and makes one bounded consolidation call only when something changed or the existing summary is invalid. The result must start with `v1`, contain `## User Profile`, `## User preferences`, `## General Tips` and `## What's in Memory`, and stay under `summaryMaxBytes`; only then does the baseline advance.
- **Read path** is a dynamic system-prompt section, so a consolidation shows up on the next request without a restart. `dedicatedTools: true` adds `memory_read`, `memory_search`, `memory_list` and `memory_note`; reading or searching rollout summaries bumps that thread's usage counters.
- `disableOnExternalContext: true` skips sessions whose evidence contains `web_search`, `web_fetch` or MCP calls, without deleting an existing summary.

## Install

```bash
dsh plugin --profile web add "link:$PWD/dsh-memory"
```

No build step, no dependencies. The workspace is created on first use under `$DSH_HOME/memories_v2`:

```text
memories_v2_1.sqlite          # stage-1 outputs, jobs, consolidation progress
memory_summary.md             # injected into later sessions
rollout_summaries/*.md        # per-session summaries
extensions/ad_hoc/notes/*.md  # explicit user notes
phase2_workspace_diff.md      # one consolidation, then removed
.dsh-memory-baseline.json     # last successful workspace baseline
```

## Configuration

The bundle mounts one `memory` row; a profile override replaces the whole config, so restate every key you want to keep.

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Mount at all. |
| `version` | `v2` | Only v2 is implemented; other values fail the mount. |
| `generateMemories` | `true` | Run the background pipeline. |
| `useMemories` | `true` | Inject the summary and read-path instructions. |
| `dedicatedTools` | `false` | Register the four memory tools. |
| `disableOnExternalContext` | `false` | Skip sessions containing web/MCP tool calls. |
| `minRolloutIdleHours` | `6` | Minimum session idle time. |
| `maxRolloutAgeDays` | `10` | Ignore sessions older than this. |
| `maxRolloutsPerStartup` | `2` | Extraction claims per run. |
| `concurrency` | `8` | Parallel extraction calls. |
| `maxRawMemoriesForConsolidation` | `256` | Maximum summaries selected for phase 2. |
| `maxUnusedDays` | `30` | Drop/prune memories unused this long. |
| `jobLeaseSeconds` | `3600` | Stage-1/phase-2 lease. |
| `retryDelaySeconds` | `3600` | Failure backoff. |
| `phase2CooldownSeconds` | `21600` | Skip successful consolidation for this long. |
| `extractModel` / `consolidationModel` | route model | Optional model overrides. |
| `extractReasoningEffort` / `consolidationReasoningEffort` | `low` / `medium` | Reasoning effort for the two calls. |
| `maxInputBytes` | `400000` | Evidence budget for extraction. |
| `maxConsolidationBytes` | `240000` | Changed-evidence budget for consolidation. |
| `summaryMaxBytes` | `10000` | Reject/write cap for `memory_summary.md`. |
| `minRateLimitRemainingPercent` | `25` | Accepted for parity; DSH exposes no rate-limit headroom. |
| `log` | `false` | One info line per completed run. |

`home` and `memoryRoot` are accepted for tests and non-default layouts (`$DSH_HOME` or `~/.dsh`; `<home>/memories_v2`).

## Privacy and reset

Artifacts are plain UTF-8 files plus a SQLite database and can contain user requests, paths and tool output; redaction is best-effort, not a guarantee. Protect `$DSH_HOME`, and remove the memory root (or set `generateMemories: false` and `useMemories: false`) to stop and erase local memory. Nothing is uploaded beyond the model calls made through the configured route.

## Deviations from Codex

- **Consolidation is one bounded model call** instead of a subagent that opens every summary; selected summaries stay on disk and unchanged context rides along in the existing summary.
- **Content-hash baseline instead of git**: same `A`/`M`/`D` vocabulary, baseline in `.dsh-memory-baseline.json`.
- **No rate-limit headroom gate**: the key is accepted, DSH has no equivalent snapshot.
- **No thread-level `memory_mode`**: external context is judged when a claimed session is read; existing output is kept.
- **System-prompt section instead of a developer message**: equivalent context, the stable seam for a host-only plugin.
- **Session activity is artifact mtime** (JSONL: last log write); backends without a materialized file fall back to `header.createdAt`.
- **Ad hoc notes are not pruned**; only notes changed since the last successful baseline reach consolidation.

## Verification

```bash
node --test --test-concurrency=1          # unit/integration tests
node ../scripts/check-bundles.mjs .       # bundle metadata
```

Tests use fake `ctx`, persistence and LLM; they cover selection, claims/retries, tiering, redaction, schema validation, baseline diffs, both phases, the no-change path and mounting. Live acceptance still needs a profile install and an idle session older than `minRolloutIdleHours`.

## License

MIT.
