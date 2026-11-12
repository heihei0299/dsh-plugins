/**
 * The native panel is the App-side twin of /adhd. These tests pin the parts a
 * bridge regression would break: the manifest grammar the App reads, the
 * guarded registration, and the switch acting on the same live Agent.
 *
 * Run with: node --test test/
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { apply } from '../index.js'
import { RULES } from '../src/rules.js'
import { registerDshGo } from '../src/dsh-go/register.js'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/
const chars = (value) => [...String(value)].length

/**
 * Build a Cordis-like context that runs effects eagerly, answers both injects,
 * and records the panel the plugin registers.
 */
function makeContext({ agent, sessionId = 'session-root' } = {}) {
  const state = { sections: [], commands: [], disposers: [], panel: undefined, panelId: undefined }
  const agents = new Map()
  if (agent !== undefined) agents.set(sessionId, agent)
  const ctx = {
    agents: { get: (id) => agents.get(id) },
    systemPrompt: {
      getSectionOrder: (name) => (name === 'DEPLOYMENT_PERSONA_PREFIX' ? 0 : 500),
      section(section) {
        state.sections.push(section)
        return () => {}
      },
    },
    effect(fn) {
      state.disposers.push(fn())
    },
    inject(names, callback) {
      if (names.includes('commands')) {
        callback({
          commands: {
            register(definition) {
              state.commands.push(definition)
              return () => {}
            },
          },
        })
      }
      if (names.includes('dshGo')) {
        callback({
          dshGo: {
            panel(id, panel) {
              state.panelId = id
              state.panel = panel
              return () => {
                state.panel = undefined
              }
            },
          },
        })
      }
    },
  }
  return { ctx, state }
}

const root = { session: { meta: { id: 'session-root' } } }
const child = { session: { meta: { origin: 'subagent', delegationDepth: 1 } } }
const caps = { locale: 'zh-CN' }

test('manifest stays inside the v1 bridge grammar', () => {
  const manifest = pkg.dshGo
  assert.equal(manifest.v, 1)
  assert.equal(manifest.icon, 'plugin')
  assert.ok(chars(manifest.title.zh) <= 24)
  assert.ok(chars(manifest.title.en) <= 24)

  const ids = []
  for (const rows of Object.values(manifest.contributes)) {
    for (const row of rows) ids.push(row.id)
  }
  assert.equal(new Set(ids).size, ids.length, 'contribution ids must be unique')
  for (const id of ids) assert.match(id, ID)

  const panels = manifest.contributes.panels
  assert.ok(panels.length <= 4)
  assert.equal(panels[0].id, 'adhd')
  assert.ok(chars(panels[0].title.zh) <= 16)
  assert.deepEqual(panels[0].placement, ['session.tab', 'features'])

  const action = manifest.contributes['composer.actions'][0]
  assert.equal(action.effect.type, 'open')
  assert.equal(action.effect.page, 'panel:adhd')

  assert.ok(Buffer.byteLength(JSON.stringify(manifest), 'utf8') < 16 * 1024)
})

test('the package ships the panel modules and declares the bridge wait', async () => {
  assert.ok(pkg.files.includes('src/dsh-go/'))
  const entry = await readFile(new URL('../index.js', import.meta.url), 'utf8')
  assert.match(entry, /ctx\.inject\(\['dshGo'\]/)
  assert.match(entry, /registerDshGo\(bridgeCtx/)
})

test('registration is a no-op without the dsh-go bridge', () => {
  assert.equal(registerDshGo({}, {}), undefined)
  assert.equal(registerDshGo(undefined, {}), undefined)
})

test('the panel reports and toggles the same live Agent as /adhd', () => {
  const { ctx, state } = makeContext({ agent: root })
  apply(ctx, {})
  assert.equal(state.panelId, 'adhd')
  const panel = state.panel
  assert.equal(panel.view({}, caps).v, 1)

  const first = panel.data({ sessionId: 'session-root' }, () => {}, caps)
  assert.equal(typeof first, 'function')

  const on = panel.actions.refresh({ sessionId: 'session-root' }, { locale: 'zh-CN' })
  assert.equal(on.patch.state, 'on')

  const off = panel.actions.off({ sessionId: 'session-root' }, { locale: 'zh-CN' })
  assert.equal(off.patch.state, 'off')
  assert.match(off.toast, /关闭/)
  assert.equal(state.sections[0].text({ agent: root }), '')

  const back = panel.actions.on({ sessionId: 'session-root' }, { locale: 'zh-CN' })
  assert.equal(back.patch.state, 'on')
  assert.equal(state.sections[0].text({ agent: root }), RULES)

  // The /adhd command reads the same WeakSet.
  state.commands[0].handler({ agent: root, rawInput: 'off' })
  assert.equal(panel.actions.refresh({ sessionId: 'session-root' }, { locale: 'zh-CN' }).patch.state, 'off')
})

test('a session without a live Agent reports it instead of pretending', () => {
  const { ctx, state } = makeContext({ agent: root })
  apply(ctx, {})
  const panel = state.panel
  const data = panel.actions.refresh({ sessionId: 'session-missing' }, { locale: 'zh-CN' })
  assert.equal(data.patch.state, 'unknown')
  const off = panel.actions.off({ sessionId: 'session-missing' }, { locale: 'zh-CN' })
  assert.match(off.toast, /live Agent/)
})

test('subagent sessions are not toggled while subagents:false', () => {
  const { ctx, state } = makeContext({ agent: child, sessionId: 'session-child' })
  apply(ctx, {})
  const panel = state.panel
  assert.equal(panel.actions.refresh({ sessionId: 'session-child' }, { locale: 'zh-CN' }).patch.state, 'child')
  const off = panel.actions.off({ sessionId: 'session-child' }, { locale: 'zh-CN' })
  assert.match(off.toast, /子代理/)
})

test('enabled:false mounts no section but the panel still explains why', () => {
  const { ctx, state } = makeContext({ agent: root })
  apply(ctx, { enabled: false })
  assert.equal(state.sections.length, 0)
  assert.equal(state.commands.length, 0)
  const panel = state.panel
  const data = panel.actions.refresh({ sessionId: 'session-root' }, { locale: 'zh-CN' })
  assert.equal(data.patch.state, 'disabled')
  const on = panel.actions.on({ sessionId: 'session-root' }, { locale: 'zh-CN' })
  assert.match(on.toast, /已关闭/)
})

test('the panel registration is disposed with the plugin', () => {
  const { ctx, state } = makeContext({ agent: root })
  apply(ctx, {})
  assert.equal(typeof state.panel, 'object')
  for (const dispose of state.disposers) dispose()
  assert.equal(state.panel, undefined)
})
