# dsh-plugin-pin-subagent-model

Pin delegated children on selected backends to an LLM route and/or an Agent preset. Build-free bundle with a WebUI configuration page and a read-only chip showing the child's requested model. Gate: DSH `0.2.1-rc.2` / `0.2.1-rc.5` / `0.2.2-rc.1` / `0.2.2-rc.2`, Node ≥22, peers `@deepseek-ai/cordis ~4.0.5 || ~4.1.0` and `@deepseek-ai/schemastery ~3.18.5 || ~3.19.0`.

## Install

From the repository root:

```bash
cd pin-subagent-model
pnpm install --offline   # omit --offline if registry access is allowed and needed
dsh plugin --profile web add "link:$PWD" --offline
```

Enable or disable the bundle in **设置 → 插件**. Restart and refresh the page when the plugin manager asks for it; accepted volatile edits apply to the next delegation without a restart.

## Configuration

The bundle inserts the `pin-subagent-model` entry without a pin. Configure it in the row's configuration page or with an id-targeted profile patch:

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

| Field | Default | Meaning |
| --- | --- | --- |
| `provider`, `model` | `""` | Volatile; both must be nonempty to pin a route. |
| `reasoningEffort` | `""` | Volatile; applies with a pinned route, empty keeps the requested/inherited effort. |
| `agentPreset` | `""` | Volatile; empty keeps the original preset selection or inheritance. |
| `providers` | `[spawn, fork]` | Backends to pin; an empty array falls back to this default. |
| `onConflict` | `override` | `override` warns and replaces a different explicit route/preset, `reject` throws. |

A route, a preset, or both are valid; with neither the plugin stays loaded, warns once and leaves delegations unchanged. The WebUI edits the four volatile fields, submits only changed fields against the draft's revision, and keeps the draft when a save is rejected. `providers` and `onConflict` stay YAML-only.

## Behaviour and limits

- Decorates `subagents.startActivation` before child options and composition resolve; only configured backends are affected. A preset is injected only where the backend declares support and does not inherit parent context — `fork` keeps the parent's. Pinning the fork route can reduce prefix-cache reuse.
- The pin sits below the official tool's allowlist checks, so those allowlists do not constrain the configured values; an unknown preset is rejected when used, not at load.
- Startup and conflict logs can include provider, model, effort, preset and backend names. No credentials there; no redaction is promised.
- The composer chip appears only when the child's retained window holds a valid own `request/header`; it shows the requested route, not the configured pin.
- Duplicate direct mounts or an unwritable method fail visibly; disposal restores the original only while this plugin's marker is still on top.

## Test

```bash
node --test --test-concurrency=1
DSH_TEST_RUNTIME_ROOT=/path/to/installed/dsh GOMAXPROCS=2 \
  node --test --test-concurrency=1 test/native.test.js test/preset-native.test.js
```

Native tests skip without `DSH_TEST_RUNTIME_ROOT`; child creation uses a recording fixture. Live delegation, the configuration page and the composer chip still need an authenticated GUI.

## License

MIT.
