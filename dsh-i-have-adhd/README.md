# dsh-i-have-adhd

[English](README.md) | [中文](README.zh.md)

Shape every reply DeepSeek Harness writes for a reader with ADHD: the answer or next action comes first, multi-step work is numbered, state is restated across turns, and the reply ends without a recap or "let me know if...". The plugin is one system-prompt section plus a per-session `/adhd` switch; it does not touch DSH core, tools, or the Web client.

Inspired by [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd) (MIT). The ruleset is an original, shorter DSH-specific rewrite; see [Attribution](#attribution).

## What changes

| Before | After |
| --- | --- |
| "Great question! Let me look at your auth flow. There are a few moving pieces..." | "Edit `src/auth.ts:42`: replace `verifyToken` with the snippet below. 1. Save the file. 2. Run `npm test -- auth.spec.ts`. Next: paste the first failing line." |

The rules target working memory and starting friction, not just brevity:

- **Shape**: action or answer first - numbered bounded steps - one next move - tangents parked.
- **State**: progress restated each turn - concrete time estimates - completed work made visible.
- **Tone**: errors as facts - visible lists capped at five (analysis stays complete) - no preamble, recap, or closer.
- **Overrides**: "explain" gets full depth in the same shape; destructive actions still confirm; a three-turn debug spiral stops for one diagnostic question.

## How it works

- Registers one dynamic system-prompt section named `dsh-i-have-adhd` at order 50 - directly after the deployment persona (0), before plan policy (500) and tool guidance (900+).
- The text provider returns the rules only for the reader's own Agent. Subagent sessions and agentless prompt assemblies get an empty section, so delegated reports keep their structured form.
- `/adhd` reports status, `/adhd off` mutes the mode for that live session, `/adhd on` restores it. The switch is in-memory; a resumed or new session starts from the profile default.
- The durable switch is the profile entry: `enabled: false` keeps the plugin installed but inert.

## Install

~~~sh
dsh plugin --profile web add "link:$PWD/dsh-i-have-adhd" --offline
~~~

No build, no dependencies. Enable it in **Settings → Plugins**; the section applies from the next model step.

## Configuration

The bundle patch ships `enabled: true` and `subagents: false`. A profile override replaces the whole config, so restate any key you keep:

~~~yaml
- id: i-have-adhd
  config:
    enabled: true
    subagents: false
~~~

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Register the section and `/adhd`. `false` leaves the plugin installed but inert. |
| `subagents` | `false` | Apply the rules to delegated subagent sessions too. Off keeps their reports structured. |

## Ruleset

The full text is in [`src/rules.js`](src/rules.js). It is deliberately shorter than the upstream skill because it rides every model step; the current version is roughly 600 words (~900 tokens) per step.

## Limits

- Prompt steering, not enforcement: a model can still drift, especially on long turns. `/adhd status` reports the switch, not compliance.
- The section costs tokens on every step while enabled; disable it for work where the default style is preferred.
- `/adhd off` is scoped to the live Agent. It does not persist across resume or a new session; change the profile config for a durable change.
- This plugin shapes user-facing prose only. It does not change tool arguments, code, commit messages, or DSH's UI strings.
- It registers a fixed section name. Do not mount another `i-have-adhd` port that uses the same name; duplicate registration fails loud.
- No live-browser acceptance is implied by the unit and bundle checks; verify the card and a real reply after installing.

## Verification

~~~sh
node --test --test-concurrency=1
node ../scripts/check-bundles.mjs .
~~~

## Attribution

The concept and name derive from [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd), Copyright (c) 2026 Ayoub Ghriss, MIT. This implementation rewrites the ruleset for DSH and does not copy the upstream skill text. The plugin itself is MIT; see [LICENSE](LICENSE).
