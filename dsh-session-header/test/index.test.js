/**
 * Tests for the tools/execute injection phase (issue #1) plus regression
 * coverage for the existing llm/stream behavior.
 *
 * Run with: node --test test/
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, Config } from '../index.js'

/** Record every fetch the plugin (and the code under test) performs. */
function installFetchRecorder() {
  const calls = []
  const original = globalThis.fetch
  const fn = async (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    if (init?.headers !== undefined) {
      for (const [key, value] of new Headers(init.headers)) headers.set(key, value)
    }
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url
    calls.push({ url, headers })
    return new Response('ok', { status: 200 })
  }
  globalThis.fetch = fn
  return {
    fn,
    original,
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

/** Cordis-like context stub: captures on() handlers, runs effect() setup. */
function makeContext() {
  const handlers = new Map()
  const disposers = []
  const ctx = {
    logger: { warn() {} },
    on(event, handler) {
      handlers.set(event, handler)
    },
    effect(fn) {
      disposers.push(fn())
    },
  }
  return { ctx, handlers, disposers }
}

/** Install recorder, apply plugin, and wire automatic cleanup. */
function boot(t, config = {}) {
  const recorder = installFetchRecorder()
  const { ctx, handlers, disposers } = makeContext()
  // Go through the Schema, the way the harness loads the plugin: defaults for
  // toolEndpoints/overwriteHeaders/header come from Config, not from apply().
  apply(ctx, Config(config))
  t.after(() => {
    for (const dispose of disposers) dispose?.()
    recorder.restore()
  })
  return { ctx, handlers, recorder }
}

test('tools/execute: injects header when URL matches a configured endpoint prefix', async (t) => {
  const { handlers, recorder } = boot(t, {
    header: 'x-opencode-session',
    toolEndpoints: ['https://gateway.example.com/'],
  })
  const exec = { agent: { id: 'session-uuid-123' } }
  const next = async () => {
    await fetch('https://gateway.example.com/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
  }
  await handlers.get('tools/execute')(exec, next)
  assert.equal(recorder.calls.length, 1)
  const headers = recorder.calls[0].headers
  assert.equal(headers.get('x-opencode-session'), 'uuid-123')
  assert.equal(headers.get('content-type'), 'application/json')
})

test('tools/execute: leaves third-party tool URLs untouched', async (t) => {
  const { handlers, recorder } = boot(t, {
    header: 'x-opencode-session',
    toolEndpoints: ['https://gateway.example.com/'],
  })
  const exec = { agent: { id: 'session-uuid-123' } }
  const next = async () => {
    await fetch('https://web.example.org/page', { headers: { a: 'b' } })
    await fetch('https://gateway.example.com/messages')
  }
  await handlers.get('tools/execute')(exec, next)
  assert.equal(recorder.calls.length, 2)
  assert.equal(recorder.calls[0].url, 'https://web.example.org/page')
  assert.equal(recorder.calls[0].headers.has('x-opencode-session'), false)
  assert.equal(recorder.calls[1].url, 'https://gateway.example.com/messages')
  assert.equal(recorder.calls[1].headers.get('x-opencode-session'), 'uuid-123')
})

test('tools/execute: default (no toolEndpoints) keeps upstream behavior — no injection', async (t) => {
  const { handlers, recorder } = boot(t, { header: 'x-opencode-session' })
  const exec = { agent: { id: 'session-uuid-123' } }
  let ran = false
  const next = async () => {
    ran = true
    await fetch('https://gateway.example.com/messages')
  }
  await handlers.get('tools/execute')(exec, next)
  assert.equal(ran, true)
  assert.equal(recorder.calls.length, 1)
  assert.equal(recorder.calls[0].headers.has('x-opencode-session'), false)
})

test('tools/execute: no agent session id means no injection even when matched', async (t) => {
  const { handlers, recorder } = boot(t, { toolEndpoints: ['https://gateway.example.com/'] })
  const exec = { agent: {} }
  const next = async () => {
    await fetch('https://gateway.example.com/messages')
  }
  await handlers.get('tools/execute')(exec, next)
  assert.equal(recorder.calls.length, 1)
  assert.equal(recorder.calls[0].headers.has('x-deepseek-harness-session-id'), false)
})

test('tools/execute: fixed config.value wins over the agent session id', async (t) => {
  const { handlers, recorder } = boot(t, {
    header: 'x-opencode-session',
    value: 'fixed-value',
    toolEndpoints: ['https://gateway.example.com/'],
  })
  const exec = { agent: { id: 'session-uuid-123' } }
  const next = async () => {
    await fetch('https://gateway.example.com/messages')
  }
  await handlers.get('tools/execute')(exec, next)
  assert.equal(recorder.calls.length, 1)
  assert.equal(recorder.calls[0].headers.get('x-opencode-session'), 'fixed-value')
})

test('tools/execute: URL object input is matched by prefix', async (t) => {
  const { handlers, recorder } = boot(t, {
    header: 'x-opencode-session',
    toolEndpoints: ['https://gateway.example.com/'],
  })
  const exec = { agent: { id: 'session-uuid-123' } }
  const next = async () => {
    await fetch(new URL('https://gateway.example.com/v1/messages'))
  }
  await handlers.get('tools/execute')(exec, next)
  assert.equal(recorder.calls.length, 1)
  assert.equal(recorder.calls[0].headers.get('x-opencode-session'), 'uuid-123')
})

// --- overwriteHeaders: replace placeholder values hard-coded by official plugins ---

test('tools/execute: overwriteHeaders replaces an existing placeholder header value', async (t) => {
  const { handlers, recorder } = boot(t, {
    header: 'x-opencode-session',
    overwriteHeaders: ['x-opencode-session'],
    toolEndpoints: ['https://gateway.example.com/'],
  })
  const exec = { agent: { id: 'session-uuid-123' } }
  const next = async () => {
    // Simulates dsh-web-search-deepseek's hard-coded placeholder header.
    await fetch('https://gateway.example.com/messages', {
      headers: { 'x-opencode-session': 'dsh-web-search' },
    })
  }
  await handlers.get('tools/execute')(exec, next)
  assert.equal(recorder.calls.length, 1)
  assert.equal(recorder.calls[0].headers.get('x-opencode-session'), 'uuid-123')
})

test('tools/execute: header NOT listed in overwriteHeaders stays untouched', async (t) => {
  const { handlers, recorder } = boot(t, {
    header: 'x-opencode-session',
    overwriteHeaders: ['another-header'],
    toolEndpoints: ['https://gateway.example.com/'],
  })
  const exec = { agent: { id: 'session-uuid-123' } }
  const next = async () => {
    await fetch('https://gateway.example.com/messages', {
      headers: { 'x-opencode-session': 'dsh-web-search' },
    })
  }
  await handlers.get('tools/execute')(exec, next)
  assert.equal(recorder.calls.length, 1)
  assert.equal(recorder.calls[0].headers.get('x-opencode-session'), 'dsh-web-search')
})

test('llm/stream: overwriteHeaders also applies in the LLM scope', async (t) => {
  const { handlers, recorder } = boot(t, {
    header: 'x-opencode-session',
    overwriteHeaders: ['x-opencode-session'],
  })
  async function* inner() {
    await fetch('https://llm.example.com/v1/messages', {
      headers: { 'x-opencode-session': 'placeholder' },
    })
    yield 'chunk-1'
  }
  const gen = handlers.get('llm/stream')({ sessionId: 'session-abc' }, () => inner())
  for await (const _ of gen) { /* drain */ }
  assert.equal(recorder.calls.length, 1)
  assert.equal(recorder.calls[0].headers.get('x-opencode-session'), 'abc')
})

// --- llm/stream regression (existing behavior must not change) ---

test('llm/stream: still injects unconditionally with the live session id', async (t) => {
  const { handlers, recorder } = boot(t, { header: 'x-deepseek-harness-session-id' })
  async function* inner() {
    await fetch('https://llm.example.com/v1/chat/completions')
    yield 'chunk-1'
    yield 'chunk-2'
  }
  const gen = handlers.get('llm/stream')({ sessionId: 'session-abc' }, () => inner())
  const chunks = []
  for await (const chunk of gen) chunks.push(chunk)
  assert.deepEqual(chunks, ['chunk-1', 'chunk-2'])
  assert.equal(recorder.calls.length, 1)
  // The native header mirrors dsh-llm-deepseek, which sends the harness id as
  // it is (branding prefix included).
  assert.equal(recorder.calls[0].headers.get('x-deepseek-harness-session-id'), 'session-abc')
})

test('llm/stream: never overwrites a header someone else already set', async (t) => {
  const { handlers, recorder } = boot(t, { header: 'x-deepseek-harness-session-id' })
  async function* inner() {
    await fetch('https://llm.example.com/v1/chat', { headers: { 'x-deepseek-harness-session-id': 'already-set' } })
    yield 'chunk-1'
  }
  const gen = handlers.get('llm/stream')({ sessionId: 'session-abc' }, () => inner())
  for await (const _ of gen) { /* drain */ }
  assert.equal(recorder.calls.length, 1)
  assert.equal(recorder.calls[0].headers.get('x-deepseek-harness-session-id'), 'already-set')
})

test('unloading restores the fetch that was installed before apply', async (t) => {
  const recorder = installFetchRecorder()
  const { ctx, disposers } = makeContext()
  apply(ctx, Config({}))
  const patched = globalThis.fetch
  assert.notEqual(patched, recorder.fn)
  for (const dispose of disposers) dispose?.()
  assert.equal(globalThis.fetch, recorder.fn)
  recorder.restore()
})

// --- review follow-ups: Request spelling, case-insensitive overwrite, boundary ---

test('tools/execute: Request input matching the whitelist is injected', async (t) => {
  const { handlers, recorder } = boot(t, {
    header: 'x-opencode-session',
    overwriteHeaders: ['x-opencode-session'],
    toolEndpoints: ['https://gateway.example.com/'],
  })
  const exec = { agent: { id: 'session-uuid-123' } }
  const next = async () => {
    const request = new Request('https://gateway.example.com/messages', {
      method: 'POST',
      headers: { 'x-opencode-session': 'dsh-web-search' },
    })
    await fetch(request)
  }
  await handlers.get('tools/execute')(exec, next)
  assert.equal(recorder.calls.length, 1)
  assert.equal(recorder.calls[0].headers.get('x-opencode-session'), 'uuid-123')
})

test('tools/execute: Request input NOT matching the whitelist passes through untouched', async (t) => {
  const { handlers, recorder } = boot(t, {
    header: 'x-opencode-session',
    toolEndpoints: ['https://gateway.example.com/'],
  })
  const exec = { agent: { id: 'session-uuid-123' } }
  const next = async () => {
    const request = new Request('https://other.example.org/messages', {
      method: 'POST',
      headers: { 'x-opencode-session': 'dsh-web-search' },
    })
    await fetch(request)
  }
  await handlers.get('tools/execute')(exec, next)
  assert.equal(recorder.calls.length, 1)
  assert.equal(recorder.calls[0].url, 'https://other.example.org/messages')
  assert.equal(recorder.calls[0].headers.get('x-opencode-session'), 'dsh-web-search')
})

test('tools/execute: sibling domain never matches (host boundary)', async (t) => {
  const { handlers, recorder } = boot(t, {
    header: 'x-opencode-session',
    toolEndpoints: ['https://gateway.example.com'], // no trailing slash on purpose
  })
  const exec = { agent: { id: 'session-uuid-123' } }
  const next = async () => {
    await fetch('https://gateway.example.com.evil.io/messages')
    await fetch('https://gateway.example.com/messages')
  }
  await handlers.get('tools/execute')(exec, next)
  assert.equal(recorder.calls.length, 2)
  assert.equal(recorder.calls[0].url, 'https://gateway.example.com.evil.io/messages')
  assert.equal(recorder.calls[0].headers.has('x-opencode-session'), false)
  assert.equal(recorder.calls[1].url, 'https://gateway.example.com/messages')
  assert.equal(recorder.calls[1].headers.get('x-opencode-session'), 'uuid-123')
})

test('tools/execute: path prefix respects boundaries (/v1 not /v10)', async (t) => {
  const { handlers, recorder } = boot(t, {
    header: 'x-opencode-session',
    toolEndpoints: ['https://gateway.example.com/zen/go/v1'],
  })
  const exec = { agent: { id: 'session-uuid-123' } }
  const next = async () => {
    await fetch('https://gateway.example.com/zen/go/v10/messages')
    await fetch('https://gateway.example.com/zen/go/v1/messages')
  }
  await handlers.get('tools/execute')(exec, next)
  assert.equal(recorder.calls.length, 2)
  assert.equal(recorder.calls[0].headers.has('x-opencode-session'), false)
  assert.equal(recorder.calls[1].headers.get('x-opencode-session'), 'uuid-123')
})

test('tools/execute: case-insensitive overwrite of a placeholder header', async (t) => {
  const { handlers, recorder } = boot(t, {
    header: 'x-opencode-session',
    overwriteHeaders: ['X-OPENCODE-SESSION'], // deliberately different case
    toolEndpoints: ['https://gateway.example.com/'],
  })
  const exec = { agent: { id: 'session-uuid-123' } }
  const next = async () => {
    await fetch('https://gateway.example.com/messages', {
      headers: { 'X-OPENCODE-SESSION': 'dsh-web-search' }, // different case on wire
    })
  }
  await handlers.get('tools/execute')(exec, next)
  assert.equal(recorder.calls.length, 1)
  assert.equal(recorder.calls[0].headers.get('x-opencode-session'), 'uuid-123')
})

// --- native replica of the headers dsh-llm-deepseek sends ---

/** Run one llm/stream call through the plugin and return the recorded headers. */
async function streamOnce(handlers, recorder, options) {
  async function* inner() {
    await fetch('https://llm.example.com/v1/chat/completions')
    yield 'chunk'
  }
  for await (const _ of handlers.get('llm/stream')(options, () => inner())) { /* drain */ }
  return recorder.calls[0].headers
}

/** Point DSH_HOME at a temp dir holding a specific anonymous user id. */
function withHarnessHome(t, contents) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-home-'))
  if (contents !== undefined) writeFileSync(join(home, '.anonymous-user-id'), contents)
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  })
  return home
}

test('native: sends the user id from the harness home file', async (t) => {
  withHarnessHome(t, '11111111-2222-3333-4444-555555555555\n')
  const { handlers, recorder } = boot(t, {})
  const headers = await streamOnce(handlers, recorder, { sessionId: 'session-abc' })
  assert.equal(headers.get('x-deepseek-harness-user-id'), '11111111-2222-3333-4444-555555555555')
  assert.equal(headers.get('x-deepseek-harness-session-id'), 'session-abc')
  assert.equal(headers.get('x-deepseek-harness-compact'), null)
})

test('native: marks compaction calls with x-deepseek-harness-compact', async (t) => {
  withHarnessHome(t, '11111111-2222-3333-4444-555555555555\n')
  const { handlers, recorder } = boot(t, {})
  const headers = await streamOnce(handlers, recorder, {
    sessionId: 'session-abc',
    purpose: 'compaction',
  })
  assert.equal(headers.get('x-deepseek-harness-compact'), '1')
})

test('native: leaves the compact marker off for other purposes', async (t) => {
  withHarnessHome(t, '11111111-2222-3333-4444-555555555555\n')
  const { handlers, recorder } = boot(t, {})
  const headers = await streamOnce(handlers, recorder, {
    sessionId: 'session-abc',
    purpose: 'session-title',
  })
  assert.equal(headers.get('x-deepseek-harness-compact'), null)
})

test('native: omits the user id when the harness home has none', async (t) => {
  withHarnessHome(t, undefined)
  const { handlers, recorder } = boot(t, {})
  const headers = await streamOnce(handlers, recorder, { sessionId: 'session-abc' })
  assert.equal(headers.get('x-deepseek-harness-user-id'), null)
  assert.equal(headers.get('x-deepseek-harness-session-id'), 'session-abc')
})

test('native: a configured userId wins over the harness home file', async (t) => {
  withHarnessHome(t, '11111111-2222-3333-4444-555555555555\n')
  const { handlers, recorder } = boot(t, { userId: 'configured-user' })
  const headers = await streamOnce(handlers, recorder, { sessionId: 'session-abc' })
  assert.equal(headers.get('x-deepseek-harness-user-id'), 'configured-user')
})

test('native: switched off leaves only the configured header', async (t) => {
  withHarnessHome(t, '11111111-2222-3333-4444-555555555555\n')
  const { handlers, recorder } = boot(t, { native: false, header: 'x-session-id' })
  const headers = await streamOnce(handlers, recorder, {
    sessionId: 'session-abc',
    purpose: 'compaction',
  })
  assert.equal(headers.get('x-session-id'), 'abc')
  assert.equal(headers.get('x-deepseek-harness-user-id'), null)
  assert.equal(headers.get('x-deepseek-harness-session-id'), null)
  assert.equal(headers.get('x-deepseek-harness-compact'), null)
})

test('native: tool-phase calls carry the session header only', async (t) => {
  withHarnessHome(t, '11111111-2222-3333-4444-555555555555\n')
  const { handlers, recorder } = boot(t, {
    toolEndpoints: ['https://gateway.example.com/'],
  })
  const exec = { agent: { id: 'session-uuid-123' } }
  const next = async () => {
    await fetch('https://gateway.example.com/messages')
  }
  await handlers.get('tools/execute')(exec, next)
  const headers = recorder.calls[0].headers
  assert.equal(headers.get('x-deepseek-harness-session-id'), 'uuid-123')
  assert.equal(headers.get('x-deepseek-harness-user-id'), null)
})

