# dsh-plugin-pin-subagent-model

Pin every delegated child Agent to one LLM route and, optionally, one Agent
preset, independent of the parent Agent's current route and composition.
`provider`, `model`, `reasoningEffort`, and `agentPreset` are editable from the
plugin manager page in the WebUI as well as from the profile patch. The same
package also adds a read-only model chip to the composer's model row in a
subagent session, so the route a child *actually requested* is visible without
opening the raw log.

It ships as a DSH plugin **bundle**: install it once, then enable or disable it
in the WebUI plugin manager like any other plugin. The bundle has a Host half
(route and preset pinning) and a build-free Web Client half (the composer chip
and the row configuration page); both live in this one package.

## Why

In DeepSeek Harness a delegation call that omits `provider` / `model` makes the
child inherit the parent's live route, and a call that omits `agentPreset` makes
the child join the parent's current preset:

- `parentAgentOptionsForDelegation` / `resolveChildAgentOptions` in
  `@deepseek-ai/dsh-subagent` seed the child with the parent's
  `provider`, `model`, `reasoningEffort`, and `maxTokens`.
- `applyChildComposition` joins the child to the parent's current preset
  revision when `request.agentPreset` is absent.
- `assertAllowedModelSelection` in `@deepseek-ai/dsh-tool-subagent` returns
  early when the call names no route, so the settings allowlist
  ("允许 Agent 为子智能体选择模型") only constrains *explicit* selections.
- The preset-owned `tool-subagent` rows cannot be patched by id from the
  profile layer (their ids live inside `preset-standard.config.plugins`), so
  neither `agentOptions` nor `agentPreset` can be configured that way without
  restating the whole preset.

Result: a profile whose allowlist excludes a model can still end up running
children on it whenever the parent itself runs that model, and every child
inherits the parent's tools and persona.

This plugin closes both holes without touching any preset: it decorates
`SubagentRuntime.startActivation`, which runs before `startLocal` — the code
that resolves child Agent options and composition — and rewrites
`request.agentOptions` and `request.agentPreset` to the configured values.

## Install

```bash
# Link the checkout into the profile (offline: pnpm must not reach a registry)
dsh plugin --profile web add link:/home/shial/Project/dsh-plugins/pin-subagent-model --offline
```

The bundle now depends on `@deepseek-ai/schemastery` for its Host `Config`
schema, so the checkout needs its dependency tree before the Host half can
load:

```bash
cd /home/shial/Project/dsh-plugins/pin-subagent-model
pnpm install --offline   # omit --offline if the local store lacks the package
```

The same local path can be chosen from the WebUI plugin manager. Installation
and every local build/test require explicit authorization.

> **Upgrading from the Host-only 0.2.x build:** the running dsh caches a
> package's client metadata (including a negative "not a client" verdict) per
> Loader specifier/baseURL until restart. 0.3.0 added `dsh.client` and
> `client.js`, so upgrading from 0.2.x requires one restart of the existing
> dsh process, then a refresh of the existing page.
>
> **Upgrading from 0.3.x:** 0.4.0 adds the Host `Config` schema, the
> `plugins.row.config` page, and two client module dependencies
> (`@deepseek-ai/dsh-client-ui-plugin-manager`, `@deepseek-ai/dsh-api-remotes`).
> Run `pnpm install` in this directory, replace the package, restart the
> existing dsh once so the client module graph is re-read, then refresh the
> page. The composer chip itself did not change; the 0.3.1 placement in
> `conversation.input.right` still stands.

After installation the bundle shows up in **设置 → 插件** with its localized
title, description and icon, together with an enable/disable switch:

- **关闭**: the loader entry is disabled (written as `disabled: true` in the
  profile's `cordis.patch.yml`); `subagents.startActivation` is restored and
  children inherit routes and presets again. The composer chip and the row
  configuration page belong to the same entry; if the running client has not
  reloaded the package's client metadata, the one-time reload above still
  applies.
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
    agentPreset: standard
    providers: [spawn, fork]
    onConflict: override
```

| Key | Field | Required | Default | Meaning |
| --- | --- | --- | --- | --- |
| `provider` | volatile | pair with `model` | `""` | LLM provider id for children; both empty leaves the route inherited |
| `model` | volatile | pair with `provider` | `""` | model id for children; both empty leaves the route inherited |
| `reasoningEffort` | volatile | no | inherit / adapter default | pin the adapter effort as well |
| `agentPreset` | volatile | no | `""` (inherit) | Agent preset every independent child mounts; empty keeps joining the parent's preset |
| `providers` | ordinary | no | `['spawn', 'fork']` | subagent backends to pin |
| `onConflict` | ordinary | no | `'override'` | `'override'` rewrites a differing explicit route or preset request and logs a warning; `'reject'` throws instead |

`provider` and `model` must be set together; setting only one leaves the route
unpinned. Route-only, preset-only, and both are all valid. Without any route or
preset the plugin stays loaded, logs one warning
(`pin-subagent-model: no provider/model or agentPreset configured …`) and pins
nothing, so enabling it before configuring it cannot break the profile. It
still decorates `startActivation`, so a later configuration write — from YAML
or the WebUI — takes effect on the next delegation.

`agentPreset` is written only for providers whose `capabilities.agentPreset` is
`true` and that do not inherit parent context. The in-process `spawn` backend
supports it; `fork` (`agentPreset: false`, `inheritsParentContext: true`) keeps
inheriting the parent preset and logs one warning per backend. Route pinning
still applies to fork. Any activation that reaches `startActivation` — the
`subagent` tool, `subagent_fork`, and `workflow` children — is subject to the
same pin, exactly like the route.

## WebUI configuration page

The Web Client registers a `plugins.row.config` page keyed by the bundle and row
id (`dsh-plugin-pin-subagent-model#pin-subagent-model`). Open it from the
sidebar's **插件** page:

> 已安装插件 → `dsh-plugin-pin-subagent-model` → 行 `pin-subagent-model` → 配置

The page edits the four volatile fields (`provider`, `model`,
`reasoningEffort`, `agentPreset`). The preset dropdown lists the Host's declared
presets from `agentPresets.list()`, plus “inherit the parent preset”; a
configured id that is no longer declared stays visible and marked. The two
ordinary fields (`providers`, `onConflict`) stay in the profile patch and are
not writable from the page.

Save stages the draft and submits only changed fields as one revision-fenced
ConfigForm mutation. Clearing a field unsets it, restoring the schema default
(empty string = inherit). A refused write keeps the draft and reports the
conflict; `provider` and `model` must be filled or cleared together. Writes
persist through the profile's Cordis patch, so the YAML file and the page edit
the same values; a home patch or command-line overlay that takes precedence
makes the form refuse the write.

Because the fields are volatile, the loader commits an accepted write into the
running references without remounting the entry. The plugin reads the live
references on every activation, so a saved preset or route is used by the next
delegation without a dsh restart or page reload. The page is unavailable while
the row is disabled or the profile does not accept settings writes.

### Relationship to the official preset selection

The built-in `@deepseek-ai/dsh-tool-subagent` can also write `agentPreset` when
its instance is configured with `agentPreset` / `allowedAgentPresets`. Both
mechanisms use the same official request field; there is no second composition
path. If the tool already selected the same id, this plugin writes the same
value without a warning. If it selected a different id, `onConflict` decides:
`override` warns and pins this entry's value, `reject` fails the delegation.
The plugin writes below the tool's allowlist check, so its configured id is not
constrained by `allowedAgentPresets` — the same class of precedence as the
route pin bypassing the model-selection allowlist. Use one policy per
deployment: the official fields when the model should choose from a list, this
entry when every child must be fixed.

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

Spawn a child, then read its own events — the descriptor records the resolved
route, and an independent composition appends `agent-preset/selected`:

```bash
zstd -dc ~/.dsh/sessions/<project>/<child-id>/session.v4.jsonl.zstd | grep -m1 '"subagent/descriptor"'
# {"type":"subagent/descriptor", ..., "agentProvider":"cpa",
#  "agentModel":"cline-pass/deepseek-v4.1-flash","agentReasoningEffort":"max"}
zstd -dc ~/.dsh/sessions/<project>/<child-id>/session.v4.jsonl.zstd | grep -m1 'agent-preset/selected'
# {"type":"agent-preset/selected", ..., "data":{"agentPreset":"standard"}}
```

A decisive route check: explicitly request a different allowed route in the
delegation call. With the plugin mounted the descriptor still shows the pin,
and the warning `pin-subagent-model: overriding requested child route ...` is
logged. Disable the plugin in the plugin manager, repeat the call, and the
requested route is honoured again. The preset follows the same rule: a
different requested preset logs
`pin-subagent-model: overriding requested child agent preset ...`, and with
`onConflict: reject` the delegation fails instead.

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

For the configuration page, after the one-time client restart: open the
Plugins page, open this bundle, open the `pin-subagent-model` row, click 配置,
change the preset (and route if needed), save, and delegate once. The next
child's `agent-preset/selected` and descriptor must reflect the saved values
without a dsh restart. Clearing the preset and saving must restore inheritance
on the next child.

## Tradeoffs

- Pinning `fork` children changes the forked route, which can prevent
  provider-side reuse of the inherited conversation prefix (KV cache). Drop
  `fork` from `providers` to keep fork on the parent route. Fork never takes
  the independent preset.
- Selecting a preset changes the child's tools, persona, prompt sections, and
  skills. A preset such as `minimal` cannot read or write files, so choose a
  coding-capable preset for implementation children. The preset's current
  revision is mounted for each new child; a definition edit affects new
  children only.
- The plugin decorates an instance method of the shared `subagents` service.
  That is the only seam that both runs before child-option and composition
  resolution and needs no preset edit. The decorator carries a non-enumerable
  marker: a second mount throws instead of stacking wrappers, and dispose
  restores the original property only while this decorator is still on top.
  If another plugin has replaced it, dispose warns and leaves that chain alone.
- The settings allowlist still advertises selectable models to the Agent.
  Combine with a single-entry allowlist (or `enabled: false`) if explicit
  choices should disappear from the tool schema entirely.
- `engines.dsh` pins the manifest to the DSH version it was verified against
  (`0.2.1-rc.2`). A runtime upgrade refuses the bundle until the version is
  bumped or an exact-version exemption is granted, because the decorated
  method and the `plugins.row.config` contract are internal seams.

## Layout

```
index.js            Host entry (Config / apply / inject / name) — route and preset pinning
client.js           build-free Web Client entry — composer chip and row configuration page
cordis.patch.yml    bundle layer: inserts entry `pin-subagent-model`
locale/{en,zh}.json plugin-manager card title and description
assets/icon.svg     plugin-manager icon (exported as ./icon)
test/               Host pinning, client display/configuration, and bundle-contract tests
```

## Test

The default suite is pure Node; the native contract test is opt-in and skipped
unless `DSH_TEST_RUNTIME_ROOT` points at the installed dsh:

```bash
pnpm install --offline
node --test --test-concurrency=1

DSH_TEST_RUNTIME_ROOT=<installed-dsh-root> GOMAXPROCS=2 \
  node --test --test-concurrency=1 test/native.test.js
```

The native test decorates a Cordis `Service` through the live proxy and checks
the installed `SubagentRuntime.prototype.startActivation` shape; it does not
start a real child. A full delegation (plugin row save, child descriptor,
composer chip, fork behaviour) remains a manual live check that needs the WebUI
session; record it separately rather than treating the unit suite as proof.

Both halves are plain JavaScript; there is no build, typecheck, or lint step.
The client bundle is loaded verbatim through `window.__ModuleLoader__.load` and
requires only `react`.
