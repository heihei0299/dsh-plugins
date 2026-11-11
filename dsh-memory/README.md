# dsh-memory

English | [中文](README.zh.md)

A host-only DSH plugin that ports Codex's latest memory engine — the v2 pipeline
in `openai/codex` (`codex-rs/memories`, commit `fe2f1852`) — to DeepSeek
Harness. It turns idle root sessions into bounded per-session rollout summaries,
consolidates those summaries into `memory_summary.md`, injects the summary plus
Codex's v2 read-path instructions into later sessions, and can expose four
progressive-disclosure memory tools.

The plugin is intentionally dependency-free at runtime (Node built-ins only), so
it can be installed into a profile with `dsh plugin add link:...` without
resolving DSH's nested peer graph. It requires Node 22.13+ because that is the
first Node 22 release where `node:sqlite` no longer needs a flag.

## What it does

```text
root session starts
        |
        v
phase 1: claim idle sessions (age/idle/lease/retry rules)
        |  read durable DSH session log
        |  render tiered evidence (human > final > other agent > commentary > context > tool)
        |  model -> {rollout_summary, rollout_slug}
        v
  SQLite stage1_outputs + rollout_summaries/*.md
        |
        v
phase 2: select by usage/recency, sync summaries, diff against baseline
        |  no change + valid summary -> done
        |  changed evidence -> model -> validated memory_summary.md
        v
  memory_summary.md + baseline commit + selected_for_phase2 flags
        |
        v
next session: prompt section = read_path_v2 + memory_summary
```

### Phase 1 — rollout extraction

- Runs asynchronously when a root agent starts (`agent/created`, source
  `startup` or `resume`). Subagents, ephemeral work, and non-root sessions are
  skipped.
- Selects persisted root sessions that are idle for `minRolloutIdleHours` and
  younger than `maxRolloutAgeDays`, newest first, up to
  `maxRolloutsPerStartup` claims per run and `concurrency` in flight.
- Claims use a per-session lease, three retries, and a one-hour retry backoff;
  the claim/watermark rules mirror Codex's `memory_stage1` jobs.
- Evidence rendering follows Codex's v2 tier order and byte budget: user
  messages, assistant finals, other-agent messages, assistant commentary,
  harness context, and tool output, newest-first within a tier, then restored to
  source order with an omitted-evidence marker. AGENTS.md, skill bodies, and
  system prompts are excluded; images/audio become placeholders; secrets are
  redacted before the model call.
- The extractor returns JSON `{"rollout_summary": "...", "rollout_slug": "..."}`.
  The summary is redacted and capped at 9,000 UTF-8 bytes (the Codex v2 cap).
  An empty summary advances the job without writing a memory.
- With `disableOnExternalContext: true`, sessions whose evidence includes
  `web_search`, `web_fetch`, or MCP tool calls are skipped without deleting an
  existing summary (Codex calls this "polluted").
- Optional: set `extractModel` to override the model; the provider always comes
  from the triggering session's route.

### Phase 2 — global consolidation

- One singleton job with a lease, six-hour success cooldown, 90-second
  heartbeat, and one-hour retry backoff.
- Selects up to `maxRawMemoriesForConsolidation` summaries: only entries whose
  `last_usage` (or, when never used, `source_updated_at`) is within
  `maxUnusedDays`; ranked by usage, then recency, then thread id; written back in
  stable thread-id order.
- Syncs `rollout_summaries/<timestamp>-<hash>-<slug>.md` and prunes summaries no
  longer selected. `rollout_summaries/` is the v2 workspace; there is no
  `MEMORY.md` or `raw_memories.md` in v2.
- Compares the workspace against `.dsh-memory-baseline.json` (a content-hash
  baseline, the dependency-free equivalent of Codex's git baseline), writes
  `phase2_workspace_diff.md` with added/modified/deleted paths, and runs
  consolidation only when something changed or the existing summary is invalid.
- The consolidation call receives the diff status, the existing
  `memory_summary.md`, changed summaries, and changed ad hoc notes. It returns
  JSON `{"memory_summary": "..."}`; the result must start with `v1`, contain
  `## User Profile`, `## User preferences`, `## General Tips`, and
  `## What's in Memory`, and stay under 10,000 UTF-8 bytes. Only then is the
  baseline advanced and the job marked successful.
- If no evidence remains and no summary exists, a minimal valid summary is
  written without a model call.

### Read path

- `memory_summary.md` (when present and starting with `v1`) plus Codex's v2
  read-path instructions are injected as a system-prompt section for every
  session. The section is dynamic: it reads the summary at assembly time, so a
  consolidation becomes visible on the next request without a restart.
- The instructions tell the model to treat memory as historical context, verify
  drift-prone claims, cite only rollout summaries actually used, never cite
  memory in pull requests, and record explicit remember/forget/correction
  requests as notes under `extensions/ad_hoc/notes/`.
- `dedicatedTools: true` adds:
  - `memory_read` — read a relative memory file by line range.
  - `memory_search` — literal substring search with context and match modes.
  - `memory_list` — list memory files/directories.
  - `memory_note` — write a user-requested addition/correction/deletion note.
  Reads/searches of `rollout_summaries/*` and `<oai-mem-citation>` blocks in
  assistant messages bump that thread's `usage_count` and `last_usage`, so
  frequently useful memories survive consolidation selection.

## Install

Requires Node 22.13+ and DSH `0.2.2-rc.1` (`engines.dsh`; the plugin relies on that release's agent, session-persistence, system-prompt, LLM and tools seams). From the repository root:

```bash
dsh plugin --profile web add "link:$PWD/dsh-memory"
```

The bundle patch is `cordis.patch.yml`; no build step and no dependencies are
required. Restart or reload the profile according to the plugin manager prompt.
The memory workspace is created on first use under `$DSH_HOME/memories_v2`
(`~/.dsh/memories_v2` by default):

```text
memories_v2/
  memories_v2_1.sqlite          # stage-1 outputs, jobs, consolidation progress
  memory_summary.md             # injected into later sessions
  rollout_summaries/*.md        # per-session summaries
  extensions/ad_hoc/notes/*.md  # explicit user notes
  phase2_workspace_diff.md      # generated for one consolidation, then removed
  .dsh-memory-baseline.json     # last successful workspace baseline
```

## Configuration

The bundle patch mounts one `memory` row. A profile override replaces the whole
config, so restate every key you want to keep.

```yaml
- id: memory
  config:
    enabled: true
    version: v2
    generateMemories: true
    useMemories: true
    dedicatedTools: false
    disableOnExternalContext: false
    minRolloutIdleHours: 6
    maxRolloutAgeDays: 10
    maxRolloutsPerStartup: 2
    concurrency: 8
    maxRawMemoriesForConsolidation: 256
    maxUnusedDays: 30
    jobLeaseSeconds: 3600
    retryDelaySeconds: 3600
    phase2CooldownSeconds: 21600
    extractModel: undefined
    consolidationModel: undefined
    extractReasoningEffort: low
    consolidationReasoningEffort: medium
    maxInputBytes: 400000
    maxConsolidationBytes: 240000
    summaryMaxBytes: 10000
    log: false
```

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Mount at all. |
| `version` | `v2` | The latest Codex memory schema. Other values fail the mount; this port implements v2 only. |
| `generateMemories` | `true` | Run the background pipeline. |
| `useMemories` | `true` | Inject the summary and read-path instructions. |
| `dedicatedTools` | `false` | Register the four memory tools. |
| `disableOnExternalContext` | `false` | Skip sessions containing web/MCP tool calls. |
| `minRolloutIdleHours` | `6` | A session must be idle this long. |
| `maxRolloutAgeDays` | `10` | Ignore sessions older than this. |
| `maxRolloutsPerStartup` | `2` | Extraction claims per run; also the live stage-1 job cap. |
| `concurrency` | `8` | Parallel extraction calls. |
| `maxRawMemoriesForConsolidation` | `256` | Maximum summaries selected for phase 2. |
| `maxUnusedDays` | `30` | Drop/prune memories unused this long. |
| `jobLeaseSeconds` | `3600` | Stage-1/phase-2 lease. |
| `retryDelaySeconds` | `3600` | Failure backoff. |
| `phase2CooldownSeconds` | `21600` | Skip successful consolidation for this long. |
| `extractModel` / `consolidationModel` | route model | Optional model overrides. |
| `extractReasoningEffort` / `consolidationReasoningEffort` | `low` / `medium` | Adapter reasoning effort. |
| `maxInputBytes` | `400000` | Evidence budget sent to the extractor. |
| `maxConsolidationBytes` | `240000` | Changed evidence budget sent to consolidation. |
| `summaryMaxBytes` | `10000` | Reject/write cap for `memory_summary.md`. |
| `minRateLimitRemainingPercent` | `25` | Accepted for config parity; DSH exposes no rate-limit headroom, so it does not gate a run. |
| `log` | `false` | One info line per completed run. |

`home` and `memoryRoot` are also accepted for tests and non-default layouts.
`home` defaults to `$DSH_HOME` or `~/.dsh`; `memoryRoot` defaults to
`<home>/memories_v2`.

## Privacy and reset

Memory artifacts are plain UTF-8 files under the configured memory root, plus a
SQLite database. They can contain user requests, paths, and tool output; secret
redaction is best-effort, not a guarantee. Protect `$DSH_HOME`, and remove the
memory root (or set `generateMemories: false` and `useMemories: false`) to stop
and erase local memory. Nothing is uploaded by this plugin beyond the model
calls made through the configured DSH route.

## Intentional deviations from Codex

These are deliberate, documented limits rather than hidden behavior:

- **Consolidation is one bounded model call.** Codex spawns an internal
  consolidation agent with filesystem tools that can open every selected
  rollout summary. This port sends the diff status, existing summary, changed
  summaries, and changed notes in one request, bounded by
  `maxConsolidationBytes`. Every selected summary is still on disk, and
  unchanged older context is carried by the existing summary. Increase the
  budget for very large memory sets.
- **Content-hash baseline instead of git.** The diff artifact uses the same
  status vocabulary (`A`/`M`/`D`) and is generated/removed at the same points,
  but the baseline is `.dsh-memory-baseline.json`, not a repository.
- **No rate-limit headroom gate.** The config key is accepted; DSH has no
  equivalent `codex` rate-limit snapshot to inspect.
- **No thread-level `memory_mode` table.** `disableOnExternalContext` is applied
  when a claimed session's evidence is read; previously generated output is
  preserved rather than marked polluted.
- **System-prompt section, not a developer message.** The injected text is
  equivalent model context; DSH's system-prompt registry is the stable seam for
  a host-only plugin.
- **Session activity is artifact mtime.** For the JSONL persistence backend this
  is the durable log's last write. A backend without a materialized file falls
  back to `header.createdAt`, which may make a session look older than it is.
- **Ad hoc notes are not pruned automatically.** They remain in
  `extensions/ad_hoc/notes/`; only notes added or modified since the last
  successful baseline are sent to consolidation.

## Verification

```bash
node --test --test-concurrency=1          # 39 unit/integration tests
node ../scripts/check-bundles.mjs .       # bundle metadata
```

The tests use fake `ctx` services, fake session persistence, and a fake LLM;
they cover selection, claims/retries, transcript tiering, redaction, summary
schema validation, baseline diffs, phase-1 extraction, phase-2 consolidation,
the no-change path, and plugin mounting. A logged-in GUI or a real model call is
not exercised by the tests; live acceptance still requires a profile install and
an idle session older than `minRolloutIdleHours`.

## License

MIT.
