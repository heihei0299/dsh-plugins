# dsh-plugin-pin-subagent-model

Pin delegated children on selected backends to an LLM route and/or independent Agent preset. The build-free bundle also provides a WebUI configuration page and a read-only chip showing the child's actual model request. Its DSH version gate accepts only `0.2.1-rc.2` and `0.2.1-rc.5`, with Node ≥22; Host peers are `@deepseek-ai/cordis ~4.0.5` and `@deepseek-ai/schemastery ~3.18.5`.

## Install

From the repository root, prepare the Host dependency and link the bundle to an existing profile:

```bash
cd pin-subagent-model
pnpm install --offline   # omit --offline if registry access is allowed and needed
dsh plugin --profile web add "link:$PWD" --offline
```

Offline installation requires the dependencies to be available locally. Enable or disable the bundle in **设置 → 插件**. If upgrading from 0.2.x or 0.3.x, restart the existing dsh and refresh its page so the new client metadata and dependencies are loaded; accepted volatile edits thereafter apply to the next delegation without a restart.

## Configuration

The bundle inserts the `pin-subagent-model` entry without a pin. Configure it in the plugin manager's row configuration page or with an id-targeted profile patch:

```yaml
- id: pin-subagent-model
  config:
    provider: my-provider
    model: my-model
    reasoningEffort: max
    agentPreset: standard
    providers: [spawn, fork]
    onConflict: override
```

Replace the example route with an available provider/model. All fields are optional:

| Field | Default | Meaning |
| --- | --- | --- |
| `provider`, `model` | `""`, `""` | Volatile; both must be nonempty to pin a route. The UI requires both or neither. |
| `reasoningEffort` | `""` | Volatile; applies with a pinned route. Empty preserves the requested/inherited effort. |
| `agentPreset` | `""` | Volatile; empty retains the original preset selection or inheritance. |
| `providers` | `[spawn, fork]` | Ordinary field; backends to pin. An empty array falls back to this default. |
| `onConflict` | `override` | Ordinary field; `override` warns and replaces a different explicit route/preset, `reject` throws. |

A route alone, preset alone, or both are valid. With neither, the plugin stays loaded, warns once and leaves delegations unchanged. The four volatile fields are read on each activation; `providers` and `onConflict` are edited in the profile patch. A different effort alone is not a conflict, but a configured effort still replaces it.

The WebUI edits the four volatile fields. It submits only changed fields against the revision on which the draft was based; rejected or failed saves retain the draft. Discard it to adopt a newer snapshot. A currently configured but undeclared preset remains visible; it may still fail when a child is created. Higher-priority home/CLI overlays can make profile writes read-only.

## Behaviour and limits

- The Host decorates `subagents.startActivation` before child options and composition are resolved. Only configured backends are affected. A preset is injected only when the backend declares support and does not inherit parent context; `fork` keeps the parent's preset. The chosen preset controls the child's tools, persona and skills. Pinning the fork route can reduce prefix-cache reuse; remove `fork` from `providers` to retain it.
- The pin is applied below the official tool's model/preset allowlist checks, so those allowlists do **not** constrain the plugin's configured values. Choose the official allowlist or this fixed policy deliberately. An unknown preset is rejected by the Host when used, not prevalidated at plugin load.
- Startup/conflict logs can include provider, model, effort, preset and backend names. Do not put credentials in these fields; no automatic secret redaction is promised.
- The additive composer chip appears only for a child whose retained event window contains a valid own `request/header` after its descriptor. It uses the latest valid route, not a fork seed, parent route or configured pin; otherwise it stays hidden. It does not replace the native model selector or write drafts.
- Duplicate direct mounts or an unwritable activation method fail visibly. On disposal, the old wrapper is deactivated even if a later wrapper captured it; the original property is restored only while the top-level method still carries this plugin's marker. A later unmarked decorator is not overwritten.

## Test

From the plugin directory:

```bash
node --test --test-concurrency=1
# Optional: replace with the actual installed DSH root
DSH_TEST_RUNTIME_ROOT=/path/to/installed/dsh GOMAXPROCS=2 \
  node --test --test-concurrency=1 test/native.test.js test/preset-native.test.js
```

The native tests skip without `DSH_TEST_RUNTIME_ROOT`. They exercise the installed Cordis proxy and real subagent runtime/provider capability gates, including spawn preset injection and fork inheritance; child creation itself uses a recording fixture, not a real child. Verify live delegation, the configuration page and the composer separately in an authenticated GUI. Both halves are plain JavaScript; no build step is required.

## License

MIT.
