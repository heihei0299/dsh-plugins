/**
 * The section is the plugin; these tests pin the three things it must do:
 * register one dynamic section, skip delegated subagent sessions by default,
 * and let /adhd mute or restore the text for one live Agent.
 *
 * Run with: node --test test/
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'
import { RULES } from '../src/rules.js'

/** Cordis-like context: runs effect() immediately and records registrations. */
function makeContext() {
  const state = { sections: [], commands: [], disposers: [] }
  const ctx = {
    systemPrompt: {
      getSectionOrder(name) {
        const orders = { DEPLOYMENT_PERSONA_PREFIX: 0, PLAN_POLICY: 500 }
        return orders[name]
      },
      section(section) {
        state.sections.push(section)
        return () => {}
      },
    },
    effect(fn) {
      state.disposers.push(fn())
    },
    inject(names, callback) {
      if (!names.includes('commands')) return
      callback({
        commands: {
          register(definition) {
            state.commands.push(definition)
            return () => {}
          },
        },
      })
    },
  }
  return { ctx, state }
}

const root = { session: { meta: { id: 'session-root' } } }
const child = { session: { meta: { origin: 'subagent', delegationDepth: 1 } } }

test('registers one dynamic section after the persona', () => {
  const { ctx, state } = makeContext()
  apply(ctx, {})
  assert.equal(state.sections.length, 1)
  const [section] = state.sections
  assert.equal(section.name, 'dsh-i-have-adhd')
  assert.equal(section.order, 50)
  assert.equal(section.text({ agent: root }), RULES)
  assert.equal(section.text({}), '')
  assert.equal(section.text(undefined), '')
})

test('leaves subagent sessions empty by default', () => {
  const { ctx, state } = makeContext()
  apply(ctx, {})
  const [section] = state.sections
  assert.equal(section.text({ agent: child }), '')
})

test('subagents: true applies the rules to delegated sessions', () => {
  const { ctx, state } = makeContext()
  apply(ctx, { subagents: true })
  const [section] = state.sections
  assert.equal(section.text({ agent: child }), RULES)
})

test('enabled: false registers nothing', () => {
  const { ctx, state } = makeContext()
  apply(ctx, { enabled: false })
  assert.equal(state.sections.length, 0)
  assert.equal(state.commands.length, 0)
})

test('/adhd reports, mutes, and restores the section for one agent', async () => {
  const { ctx, state } = makeContext()
  apply(ctx, {})
  const [section] = state.sections
  const [command] = state.commands
  assert.equal(command.name, 'adhd')

  const status = await command.handler({ agent: root, rawInput: '' })
  assert.equal(status.kind, 'success')
  assert.match(status.text, /is on/)

  const off = await command.handler({ agent: root, rawInput: ' off' })
  assert.equal(off.kind, 'success')
  assert.match(off.text, /off for this session/)
  assert.equal(section.text({ agent: root }), '')

  // A different live agent is unaffected by the mute.
  const other = { session: { meta: { id: 'session-other' } } }
  assert.equal(section.text({ agent: other }), RULES)

  const on = await command.handler({ agent: root, rawInput: 'on' })
  assert.equal(on.kind, 'success')
  assert.equal(section.text({ agent: root }), RULES)
})

test('/adhd rejects unknown arguments', async () => {
  const { ctx, state } = makeContext()
  apply(ctx, {})
  const [command] = state.commands
  const result = await command.handler({ agent: root, rawInput: 'maybe' })
  assert.equal(result.kind, 'error')
  assert.match(result.text, /Usage/)
})

test('the ruleset contains no prompt variables and keeps the core rules', () => {
  assert.doesNotMatch(RULES, /\{\{/)
  assert.match(RULES, /First line is the action or the answer/)
  assert.match(RULES, /Number multi-step work/)
  assert.match(RULES, /No preamble, recap, or closer/)
  assert.match(RULES, /the harness wins/)
})
