# dsh-plugin-pin-subagent-model

Pin every delegated child Agent to one LLM route, independent of the parent
Agent's current route and of any per-call model choice. The same package also
adds a read-only model chip to the composer's model row in a subagent session,
so the route a child *actually requested* is visible without opening the raw
log. The chip sits where the native model selector appears for a parent
session; it does not replace that selector or register any header action.

It ships as a DSH plugin **bundle**: install it once, then enable or disable it
in the WebUI plugin manager like any other plugin. The bundle has a Host half
(route pinning) and a build-free Web Client half (the composer chip); both live
in this one package.

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
> Loader specifier/baseURL until restart. 0.3.0 added `dsh.client` and
> `client.js`, so upgrading from 0.2.x requires one restart of the existing
> dsh process, then a refresh of the existing page.
>
> **Upgrading from 0.3.0:** 0.3.1 moves the read-only chip from
> `conversation.session.header.actions` to the composer's additive
> `conversation.input.right` list. Replace the package and reload the existing
> page; if the running dsh still serves the cached client bundle, restart it
> once. This installation has no frontend dev watcher, so do not expect HMR or
> a live client update.

After installation the bundle shows up in **设置 → 插件** with its localized
title, description and icon, together with an enable/disable switch:

- **关闭**: the loader entry is disabled (written as `disabled: true` in the
  profile's `cordis.patch.yml`); `subagents.startActivation` is restored and
  children inherit routes again. The read-only composer chip belongs to the
  same entry; if the running client has not reloaded the package's client
  metadata, the one-time reload above still applies.
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

## Composer display

The client half registers one entry in the additive
`conversation.input.right` list. The composer renders that list immediately
before the native `conversation.input.model` single seat, so on a subagent
session the chip sits in the input box's model row, next to where the native
model selector appears for a parent session. The parent-session entry returns
nothing, and because this is an additive list the native selector is neither
replaced nor hidden. The plugin does not register any header slot and never
occupies the single model seat.

The visible chip is intentionally compact: the last `/` segment of the route's
model id plus the reasoning effort in a lighter separate span, for example
`deepseek-v4.1-flash max`. The full route, such as
`cpa/cline-pass/deepseek-v4.1-flash · max`, remains in `title`, the accessible
label, and data attributes. Width is capped and the model text ellipsizes on a
narrow screen. It has no click target, no chevron, no Host RPC, no navigation,
and no draft/editor writes; it only reads the session that is already open.

The display decision is deliberately narrow:

1. `SessionSnapshot.subagent` must be non-null. Ordinary root sessions render
   nothing, do not look up a child binding, and do not subscribe to its event
   window; they even keep their own `request/header` events invisible.
2. The durable `subagent` projection identity must exist. Its `seq` is the
   child's own descriptor position after the projection's fork-seed reset.
3. The client reads the current `SessionEventWindow` through
   `sessions.binding(sessionId).eventSource` and takes the **latest**
   `request/header` whose `seq` is greater than `identity.seq`. That
   `header.config` is the route the child actually sent.
4. Only then does it render the compact model name and, when the request
   carried one, the effort. Missing identity, a missing window, or no own
   request header renders nothing.

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

The entry rides the native composer's tool row, not a header. Any occurrence
that renders that native composer, including an embedded `conversation.content`
host, gets the same `input.right` entry. If the native UI hides or replaces the
input area (for example, a one-shot record or an unavailable continuation
owner), the chip is hidden with it; the plugin does not take over the native
read-only explanation. An ended continuable child shows the chip while its
composer is visible and its loaded window contains its own request header;
it stays hidden if that header was truncated away. Updates come from the event
source subscription, so the chip follows a new request in the open session
without a page reload.

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

For the chip, open a child session and look at the composer's model row. The
chip appears beside the model seat once that child's own `request/header` is in
the loaded window; a root session never shows it and keeps the native model
selector unchanged. Verification covers the pure-JS Node unit suite and the
existing local Chrome CDP session at a 390x844 viewport (not a physical phone):
the chip appeared in the composer, no chip appeared in the header, the parent
breadcrumb was activated by touch, and the test child was reopened from the
native catalog. The parent session retained its native model picker; neither
session had horizontal page overflow or slot errors. The main conversation was
verified; the embedded panel was not separately exercised. The original LAN GUI
URL returns 401 anonymously, and authentication was not bypassed. Reload or
restart as described in **Install** before judging the running page.

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
client.js           build-free Web Client entry — read-only composer chip
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
