/**
 * Host-adapter tests: drive the real adapter and the real upstream extension
 * against a fake Cordis context and a stubbed `globalThis.fetch`.
 *
 * They assert the two seams that cannot be observed from the upstream unit
 * suite: the event translation (Harness event → Pi hook) and the wire rewrite
 * (parsed request body → optimizer mutation → serialized body).
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const stateDir = mkdtempSync(join(tmpdir(), 'dsh-cache-optimizer-'))
process.env.DSH_CACHE_OPTIMIZER_DIR = stateDir

const { makeFakeContext, fakeSession, settingsEdits } = await import('./helpers/fake-host.ts')
const { installCacheOptimizerHost } = await import('../src/host.ts')

const originalFetch = globalThis.fetch

/** Capture every rewritten request and answer with a JSON 200. */
function stubFetch(): { bodies: Record<string, unknown>[]; headers: Record<string, string>[]; restore(): void } {
  const bodies: Record<string, unknown>[] = []
  const headers: Record<string, string>[] = []
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    if (typeof init?.body === 'string') bodies.push(JSON.parse(init.body) as Record<string, unknown>)
    headers.push({ ...(init?.headers as Record<string, string>) })
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof globalThis.fetch
  return {
    bodies,
    headers,
    restore() {
      globalThis.fetch = originalFetch
    },
  }
}

/**
 * Run one provider call through the `llm/stream` scope so the fetch patch sees
 * it; the fake adapter performs the fetch while the scope is active.
 */
async function providerCall(
  ctx: ReturnType<typeof makeFakeContext>,
  options: { provider: string; model: string; sessionId?: string },
  init: { body: Record<string, unknown>; headers?: Record<string, string> },
): Promise<void> {
  const handlers = ctx.listeners.get('llm/stream') ?? []
  const next = () => (async function* () {
    await globalThis.fetch('http://127.0.0.1:3425/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
      body: JSON.stringify(init.body),
    } as RequestInit)
  })()
  const stream = handlers[0]!(options, next) as AsyncIterable<unknown>
  for await (const _chunk of stream) {
    // drain
  }
}

test('adds the conservative prompt_cache_key fallback to an OpenAI-compatible proxy payload', async () => {
  const ctx = makeFakeContext({
    magpie: {
      api: 'openai-completions',
      baseURL: 'http://127.0.0.1:3425/v1',
      models: [{ id: 'deepseek-v4.1-flash' }],
    },
  })
  const stub = stubFetch()
  const dispose = installCacheOptimizerHost(ctx as never, {})
  try {
    ctx.emit('session/created', fakeSession('session-abc'))
    await providerCall(ctx, { provider: 'magpie', model: 'deepseek-v4.1-flash', sessionId: 'session-abc' }, {
      body: { model: 'deepseek-v4.1-flash', messages: [{ role: 'user', content: 'hi' }] },
    })
    assert.equal(stub.bodies.length, 1)
    const body = stub.bodies[0]!
    assert.match(String(body.prompt_cache_key), /^pi-[0-9a-f]{32}$/)
  } finally {
    await dispose()
    stub.restore()
    ctx.emit('session/disposed', fakeSession('session-abc'))
  }
})

test('never overwrites a prompt_cache_key the adapter already set', async () => {
  const ctx = makeFakeContext({
    proxy: { api: 'openai-completions', baseURL: 'https://proxy.example.test/v1', models: [{ id: 'gpt-5.5' }] },
  })
  const stub = stubFetch()
  const dispose = installCacheOptimizerHost(ctx as never, {})
  try {
    ctx.emit('session/created', fakeSession('session-keep'))
    await providerCall(ctx, { provider: 'proxy', model: 'gpt-5.5', sessionId: 'session-keep' }, {
      body: { model: 'gpt-5.5', messages: [], prompt_cache_key: 'caller-owned' },
    })
    assert.equal(stub.bodies[0]!.prompt_cache_key, 'caller-owned')
  } finally {
    await dispose()
    stub.restore()
    ctx.emit('session/disposed', fakeSession('session-keep'))
  }
})

test('downgrades an invalid Anthropic 5m → 1h cache_control order', async () => {
  const ctx = makeFakeContext({
    anthropic: { api: 'anthropic-messages', baseURL: 'https://api.anthropic.com', models: [{ id: 'claude-sonnet-5' }] },
  })
  const stub = stubFetch()
  const dispose = installCacheOptimizerHost(ctx as never, {})
  try {
    ctx.emit('session/created', fakeSession('session-ttl'))
    await providerCall(ctx, { provider: 'anthropic', model: 'claude-sonnet-5', sessionId: 'session-ttl' }, {
      body: {
        model: 'claude-sonnet-5',
        system: [
          { type: 'text', text: 'a', cache_control: { type: 'ephemeral' } },
          { type: 'text', text: 'b', cache_control: { type: 'ephemeral', ttl: '1h' } },
        ],
        messages: [],
      },
    })
    const body = stub.bodies[0]!
    const system = body.system as { cache_control: { ttl?: string } }[]
    const longBlocks = system.filter((block) => block.cache_control.ttl === '1h')
    assert.equal(longBlocks.length, 0, 'the impossible long breakpoint is downgraded')
  } finally {
    await dispose()
    stub.restore()
    ctx.emit('session/disposed', fakeSession('session-ttl'))
  }
})

test('records usage from a session assistant message and reports it from the command', async () => {
  const ctx = makeFakeContext({
    magpie: { api: 'openai-completions', baseURL: 'http://127.0.0.1:3425/v1', models: [{ id: 'deepseek-v4.1-flash' }] },
  })
  const dispose = installCacheOptimizerHost(ctx as never, {})
  try {
    const session = fakeSession('session-usage')
    ctx.emit('session/created', session)
    ctx.emit('session/event', session, {
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 1,
        usage: { inputTokens: 1000, outputTokens: 10, totalTokens: 2010, cacheReadTokens: 1000 },
        message: {
          role: 'assistant',
          source: {
            kind: 'model',
            provider: 'magpie',
            model: 'deepseek-v4.1-flash',
            replayState: { response: { api: 'openai-completions', stopReason: 'stop' } },
          },
        },
      },
    })
    // The stats path is asynchronous (debounced persist, refresh).
    await new Promise((resolve) => setTimeout(resolve, 300))
    const command = ctx.commandDefinitions.get('cache-optimizer')
    assert.ok(command, 'the command is registered')
    const result = await command.handler({ rawInput: 'stats', signal: new AbortController().signal })
    assert.equal(result.kind, 'success', result.text)
    assert.match(result.text, /1\/1/, 'one request with one cache hit')
    assert.match(result.text, /50\.0%/, 'half of the prompt tokens were cached')
  } finally {
    await dispose()
    ctx.emit('session/disposed', fakeSession('session-usage'))
  }
})

test('/cache-optimizer fix writes the repaired compat into the profile settings', async () => {
  const ctx = makeFakeContext({
    proxy: { api: 'openai-completions', baseURL: 'https://third-party.example/v1', models: [{ id: 'gpt-5.5' }] },
  })
  const answers = ['Yes']
  ;(ctx as unknown as Record<string, unknown>).userQuestions = {
    ask: async () => ({ answers: [{ id: 'cache-optimizer', selected: answers.splice(0, 1) }] }),
  }
  const dispose = installCacheOptimizerHost(ctx as never, {})
  try {
    const agent = {
      sessionId: 'session-fix',
      model: { current: () => ({ provider: 'proxy', model: 'gpt-5.5' }) },
    }
    const command = ctx.commandDefinitions.get('cache-optimizer')
    assert.ok(command)
    const result = await command.handler({ agent, rawInput: 'fix', signal: new AbortController().signal })
    assert.match(result.text, /Applied \d+ configuration change/)
    const edits = settingsEdits()
    assert.ok(edits.length > 0, 'the profile received edits')
    const affinity = edits.find((edit) => edit.path.includes('sendSessionAffinityHeaders'))
    assert.ok(affinity, JSON.stringify(edits))
    assert.equal(affinity!.path[0], 'providers')
    assert.equal(affinity!.path[1], 'proxy')
    assert.equal(affinity!.value, true)
    // The projection is regenerated from the profile, so it now reports the fix.
    const projection = JSON.parse(readFileSync(join(stateDir, 'models.json'), 'utf8')) as {
      providers: Record<string, {
        compat?: Record<string, unknown>
        models?: { id: string; compat?: Record<string, unknown> }[]
        modelOverrides?: Record<string, { compat?: Record<string, unknown> }>
      }>
    }
    const provider = projection.providers.proxy!
    const effective = provider.compat
      ?? provider.models?.find((model) => model.id === 'gpt-5.5')?.compat
      ?? provider.modelOverrides?.['gpt-5.5']?.compat
    assert.equal(effective?.sendSessionAffinityHeaders, true, JSON.stringify({ edits, provider }))
  } finally {
    await dispose()
  }
})

test('unloading restores the original fetch', async () => {
  const ctx = makeFakeContext({ proxy: { api: 'openai-completions', baseURL: 'https://p.example.test/v1', models: [{ id: 'x' }] } })
  const before = globalThis.fetch
  const dispose = installCacheOptimizerHost(ctx as never, {})
  assert.notEqual(globalThis.fetch, before)
  await dispose()
  assert.equal(globalThis.fetch, before)
})

test('writes a provider projection into the state directory', async () => {
  const ctx = makeFakeContext({ proxy: { api: 'openai-completions', baseURL: 'https://p.example.test/v1', compat: { supportsLongCacheRetention: true }, models: [{ id: 'x' }] } })
  const dispose = installCacheOptimizerHost(ctx as never, {})
  try {
    const projectionPath = join(stateDir, 'models.json')
    assert.ok(existsSync(projectionPath), 'projection exists')
    const projection = JSON.parse(readFileSync(projectionPath, 'utf8')) as { providers: Record<string, unknown> }
    assert.deepEqual(projection.providers.proxy, {
      api: 'openai-completions',
      baseUrl: 'https://p.example.test/v1',
      compat: { supportsLongCacheRetention: true },
      models: [{ id: 'x' }],
    })
  } finally {
    await dispose()
  }
})

test.after(() => {
  globalThis.fetch = originalFetch
  rmSync(stateDir, { recursive: true, force: true })
})
