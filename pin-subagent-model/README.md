# dsh-plugin-pin-subagent-model

Pin every delegated child Agent to one LLM route, independent of the parent
Agent's current route and of any per-call model choice. The same package also
adds a read-only `provider/model` chip to the main conversation header of a
subagent session, so the route a child *actually requested* is visible without
opening the raw log.

It ships as a DSH plugin **bundle**: install it once, then enable or disable it
in the WebUI plugin manager like any other plugin. The bundle has a Host half
(route pinning) and a build-free Web Client half (the header chip); both live in
this one package.

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

> **Upgrading from the Host-only 0.2.x build:** the running dsh caches a
> package's client metadata (including a negative "not a client" verdict) per
> Loader specifier/baseURL until restart. This version adds `dsh.client` and
> `client.js`, so **restart the existing dsh process once, then refresh the
> existing page**. This installation has no frontend dev watcher; do not expect
> HMR or a live client update. The change that added the client half was not
> verified in a live browser session.

After installation the bundle shows up in **设置 → 插件** with its localized
title, description and icon, together with an enable/disable switch:

- **关闭**: the loader entry is disabled (written as `disabled: true` in the
  profile's `cordis.patch.yml`); `subagents.startActivation` is restored and
  children inherit routes again. The read-only header chip belongs to the same
  entry; if the running client has not reloaded the package's client metadata,
  the one-time restart above still applies.
- **开启**: the decoration is applied on the next reload; no DSH restart is
  needed when the profile uses `patchReload: live`. If the client half was never
  discovered by the running process, the one-time restart above still applies.

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

## Header display

The client half registers one action in
`conversation.session.header.actions`, which the main `ConversationHeader`
renders, and displays a small read-only chip such as
`cpa/cline-pass/deepseek-v4.1-flash · max`. It has no click target, no Host
RPC, and no way to change a model; it only reads the session that is already
open.

The display decision is deliberately narrow:

1. `SessionSnapshot.subagent` must be non-null. Ordinary root sessions render
   nothing, even if they have their own `request/header` events.
2. The durable `subagent` projection identity must exist. Its `seq` is the
   child's own descriptor position after the projection's fork-seed reset.
3. The client reads the current `SessionEventWindow` through
   `sessions.binding(sessionId).eventSource` and takes the **latest**
   `request/header` whose `seq` is greater than `identity.seq`. That
   `header.config` is the route the child actually sent.
4. Only then does it render `provider/model`, plus `reasoningEffort` when the
   request carried one. Missing identity, a missing window, or no own request
   header renders nothing.

`modelSelection.lastUsed` is intentionally **not** used for the chip. Its fold
also sees request headers inherited from a fork seed, and a `turn/end` event
alone does not prove that the child itself sent a request. `next` is a pending
selection, never an actual route. For the same reason the chip never falls back
to the parent's route, the global default, or this plugin's configured pin; an
unknown value is hidden rather than guessed.

Fork isolation follows the descriptor boundary: a fork seed's ancestor
`request/header` events have `seq < identity.seq` and are ignored. The child's
own descriptor is appended before the child is published to the subagent
catalog, so a visible child session has its own identity boundary. A completed
turn without an own request header stays hidden.

The slot is main-header-only. The subagent right-side panel renders
`conversation.content` with the `embedded` variant and does not render
`ConversationHeader`, so this chip does not appear there; no sidebar support is
claimed. The projections and event window are still durable: an ended or
read-only child shows the chip in the main header when its loaded window still
contains its own request header, and stays hidden if that header was truncated
away. Updates come from the event source subscription, so the chip follows a new
request in the open session without a page reload.

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

For the header chip, open a child session in the main conversation area (the
embedded right-hand chat does not render `ConversationHeader`). The chip appears
once that child's own `request/header` is in the loaded window; a root session
never shows it. The client half added in this version was exercised by the Node
unit tests only — no live browser verification was performed, because the
anonymous GUI request returns 401 and this task did not read credentials.
Restart/refresh as described in **Install** before judging the running page.

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
index.js            Host entry (apply / inject / name) — route pinning
client.js           build-free Web Client entry — read-only header chip
cordis.patch.yml    bundle layer: inserts entry `pin-subagent-model`
locale/{en,zh}.json plugin-manager card title and description
assets/icon.svg     plugin-manager icon (exported as ./icon)
test/               Host pinning, client display, and bundle-contract tests
```

## Test

```bash
node --test --test-concurrency=1
```

No build, install, typecheck, or lint step is involved: both halves are plain
JavaScript. The client bundle is loaded verbatim through
`window.__ModuleLoader__.load` and requires only `react`.
