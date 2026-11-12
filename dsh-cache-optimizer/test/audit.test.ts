import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { PrefixAudit, firstDivergence, formatPrefixReport } from '../src/dsh-audit.ts'
import { Warmer, buildWarmingBody, readWarmingUsage, warmRequest } from '../src/dsh-warming.ts'

const tools = (names: string[]) => ({ tools: names.map((name) => ({ type: 'function', function: { name, parameters: {} } })) })

const body = (messages: string[], names: string[] = ['a', 'b']) => JSON.stringify({
  model: 'm',
  ...tools(names),
  messages: messages.map((text) => ({ role: 'user', content: text })),
})

describe('prefix audit', () => {
  test('a new trailing turn is reported as tail-only, not churn', () => {
    const audit = new PrefixAudit()
    audit.capture('s', body(['one']))
    audit.capture('s', body(['one', 'two']))
    const report = audit.reportFor('s')
    assert.equal(report?.verdict, 'tail-only')
    assert.equal(report?.toolOrder, 'stable')
    assert.equal(report?.divergence?.path, 'messages.length')
  })

  test('an earlier turn changing is churn', () => {
    const audit = new PrefixAudit()
    audit.capture('s', body(['one', 'two', 'three', 'four']))
    audit.capture('s', body(['ONE', 'two', 'three', 'four']))
    const report = audit.reportFor('s')
    assert.equal(report?.verdict, 'churn')
    assert.equal(report?.divergence?.path, 'messages[0].content')
  })

  test('reordered tools are named as a change even when the messages match', () => {
    const audit = new PrefixAudit()
    audit.capture('s', body(['one'], ['a', 'b']))
    audit.capture('s', body(['one'], ['b', 'a']))
    const report = audit.reportFor('s')
    assert.equal(report?.toolOrder, 'changed')
  })

  test('one sample is not enough for a verdict', () => {
    const audit = new PrefixAudit()
    audit.capture('s', body(['one']))
    assert.equal(audit.reportFor('s')?.verdict, 'insufficient')
    assert.match(formatPrefixReport(audit.reportFor('s')!), /not enough samples yet/)
  })

  test('firstDivergence reports a changed key order', () => {
    const found = firstDivergence({ a: 1, b: 2 }, { b: 2, a: 1 })
    assert.equal(found?.path, '#key0')
  })

  test('a missing key is reported at its path', () => {
    assert.equal(firstDivergence({ a: { b: 1 } }, { a: {} })?.path, 'a.b')
  })
})

describe('warming replay', () => {
  test('one-token cap, no streaming, no stream_options', () => {
    const built = buildWarmingBody(JSON.stringify({ messages: [], stream: true, stream_options: { include_usage: true }, max_tokens: 4096 }))
    const parsed = JSON.parse(built.body!)
    assert.equal(parsed.max_tokens, 1)
    assert.equal(parsed.stream, false)
    assert.equal('stream_options' in parsed, false)
    assert.deepEqual(parsed.messages, [])
  })

  test('a non-JSON body is refused instead of guessed at', () => {
    assert.match(buildWarmingBody('not json').error ?? '', /not JSON/)
  })

  test('usage exposes cached tokens when the provider reports them', () => {
    assert.equal(readWarmingUsage({ usage: { prompt_tokens: 900, prompt_tokens_details: { cached_tokens: 800 } } }), 'prompt tokens 900, cached 800')
    assert.equal(readWarmingUsage({}), undefined)
  })

  test('a replay sends the same prefix with one output token', async () => {
    const seen: Record<string, unknown>[] = []
    const fakeFetch = (async (_input: unknown, init: RequestInit) => {
      seen.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      return new Response(JSON.stringify({ usage: { prompt_tokens: 1200, prompt_tokens_details: { cached_tokens: 1100 } } }), { status: 200 })
    }) as unknown as typeof globalThis.fetch
    const request = { input: 'http://stub/v1/chat/completions', init: { method: 'POST' as const, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], stream: true, stream_options: { include_usage: true }, max_tokens: 4096 }) } }
    const result = await warmRequest(request, fakeFetch)
    assert.equal(result.ok, true)
    assert.equal(seen[0].max_tokens, 1)
    assert.equal(seen[0].stream, false)
    assert.equal('stream_options' in seen[0], false)
    assert.match(result.text, /cached 1100/)
  })

  test('a rejected replay is reported, not swallowed', async () => {
    const fakeFetch = (async () => new Response('nope', { status: 403 })) as unknown as typeof globalThis.fetch
    const result = await warmRequest({ input: 'http://stub', init: { body: JSON.stringify({ messages: [] }) } }, fakeFetch)
    assert.equal(result.ok, false)
    assert.match(result.text, /HTTP 403/)
  })

  test('a divergence inside the injected skill catalog is labelled', () => {
    const audit = new PrefixAudit()
    const body = (text: string) => JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'text', text }] }] })
    audit.capture('s', body('- `a`: one'))
    audit.capture('s', body('<available_skills>\n- `a`: one\n- `b`: two\n</available_skills>'))
    const report = audit.reportFor('s')
    assert.match(report?.divergence?.hint ?? '', /skill catalog/)
  })

  test('the warmer caps a session and retires after failures', () => {
    const warmer = new Warmer({ perSession: 2, failures: 2 })
    warmer.record('s', true)
    warmer.record('s', true)
    assert.equal(warmer.available('s'), false)
    warmer.record('t', false)
    assert.equal(warmer.available('t'), true)
    warmer.record('t', false)
    assert.equal(warmer.retired, true)
    assert.equal(warmer.available('t'), false)
  })
})
