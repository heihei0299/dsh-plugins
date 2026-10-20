# dsh-plugin-pin-subagent-model

Pin every delegated child Agent to one LLM route, independent of the parent
Agent's current route and of any per-call model choice.

It ships as a DSH plugin **bundle**: install it once, then enable or disable it
in the WebUI plugin manager like any other plugin.

## Why

In DeepSeek Harness a delegation call that omits `provider` / `model` makes the
child inherit the parent's live route:

- `parentAgentOptionsForDelegation` / `resolveChildAgentOptions` in
  `@deepseek-ai/dsh-subagent` seed the child with the parent's
  `provider`, `model`, `reasoningEffort`, and `maxTokens`.
- `assertAllowedModelSelection` in `@deepseek-ai/dsh-tool-subagent` returns
  early when the call names no route, so the settings allowlist
  ("允许 Agent 为子智能体选择模型") only constrains *explicit* selections.
- The preset-owned `tool-subagent` rows cannot be patched by id from the
  profile layer (their ids live inside `preset-standard.config.plugins`), so
  `agentOptions` cannot be pinned that way without restating the whole preset.

Result: a profile whose allowlist excludes a model can still end up running
children on it whenever the parent itself runs that model.

This plugin closes that hole without touching any preset: it decorates
`SubagentRuntime.startActivation`, which runs before `startLocal` — the code
that resolves child Agent options — and rewrites `request.agentOptions` to the
pinned route.

## Install

```bash
# Link the checkout into the profile (offline: pnpm must not reach a registry)
dsh plugin --profile web add link:/home/shial/Project/dsh-plugins/pin-subagent-model --offline
```

The same local path can be chosen from the WebUI plugin manager. Installation
and every local build/test require explicit authorization.

After installation the bundle shows up in **设置 → 插件** with its localized
title, description and icon, together with an enable/disable switch:

- **关闭**: the loader entry is disabled (written as `disabled: true` in the
  profile's `cordis.patch.yml`); `subagents.startActivation` is restored and
  children inherit routes again.
- **开启**: the decoration is applied on the next reload; no DSH restart is
  needed when the profile uses `patchReload: live`.

## Config

The bundle layer registers only the entry id. The pin itself is profile
configuration, so the same package serves any route — add an id-targeted
override to the profile's `cordis.patch.yml` (`~/.dsh/profiles/web/`):

```yaml
- id: pin-subagent-model
  config:
    provider: cpa
    model: cline-pass/deepseek-v4.1-flash
    reasoningEffort: max
    providers: [spawn, fork]
    onConflict: override
```

| Key | Required | Default | Meaning |
| --- | --- | --- | --- |
| `provider` | yes | — | LLM provider id for children |
| `model` | yes | — | model id for children |
| `reasoningEffort` | no | inherit / adapter default | pin the adapter effort as well |
| `providers` | no | `['spawn', 'fork']` | subagent backends to pin |
| `onConflict` | no | `'override'` | `'override'` rewrites a differing explicit request and logs a warning; `'reject'` throws instead |

Without `provider` and `model` the plugin stays loaded, logs one warning
(`pin-subagent-model: no provider/model configured …`) and pins nothing, so
enabling it before configuring it cannot break the profile. Profile patches
reload live (`patchReload: live`), so a config edit reaches the next delegation
in a running session.

## Verify

Spawn a child, then read its descriptor — it records the resolved route:

```bash
zstd -dc ~/.dsh/sessions/<project>/<child-id>/session.v4.jsonl.zstd | sed -n 2p
# {"type":"subagent/descriptor", ..., "agentProvider":"cpa",
#  "agentModel":"cline-pass/deepseek-v4.1-flash","agentReasoningEffort":"max"}
```

A decisive check: explicitly request a different allowed route in the
delegation call. With the plugin mounted the descriptor still shows the pin,
and the warning `pin-subagent-model: overriding requested child route ...` is
logged. Disable the plugin in the plugin manager, repeat the call, and the
requested route is honoured again.

## Tradeoffs

- Pinning `fork` children changes the forked route, which can prevent
  provider-side reuse of the inherited conversation prefix (KV cache). Drop
  `fork` from `providers` to keep fork on the parent route.
- The plugin decorates an instance method of the shared `subagents` service.
  That is the only seam that both runs before child-option resolution and needs
  no preset edit; it is restored on dispose, so profile reloads and
  enable/disable cycles do not stack wrappers.
- The settings allowlist still advertises selectable models to the Agent.
  Combine with a single-entry allowlist (or `enabled: false`) if explicit
  choices should disappear from the tool schema entirely.
- `engines.dsh` pins the manifest to the DSH version it was verified against
  (`0.2.1-rc.2`). A runtime upgrade refuses the bundle until the version is
  bumped or an exact-version exemption is granted, because the decorated
  method is an internal contract.

## Layout

```
index.js            entry (apply / inject / name) — the only runtime code
cordis.patch.yml    bundle layer: inserts entry `pin-subagent-model`
locale/{en,zh}.json plugin-manager card title and description
assets/icon.svg     plugin-manager icon (exported as ./icon)
test/               unit tests for the decoration and the bundle contract
```

## Test

```bash
node --test
```
