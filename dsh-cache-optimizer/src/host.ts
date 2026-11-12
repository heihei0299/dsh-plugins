/**
 * DeepSeek Harness host adapter for the ported pi-cache-optimizer extension.
 *
 * The upstream project is a Pi extension: one default-exported function that
 * subscribes to twelve Pi hooks and reads a small `ExtensionContext` facade.
 * `src/extension.ts` is that function, kept verbatim apart from its import
 * paths and the user-facing copy, which names this host (a "Harness process",
 * a profile reload, the status line, `DSH_CACHE_*` switches) instead of Pi.
 * Every cache decision, counter, receipt and diagnostic is the upstream
 * implementation rather than a re-description of it.
 *
 * This module supplies the two things a Pi host would otherwise provide:
 *
 * 1. the hook bus and the `ExtensionContext` facade (`model`,
 *    `modelRegistry`, `sessionManager`, `ui`, `mode`), and
 * 2. the event translation from Harness seams to Pi hook names:
 *
 *    | Pi hook                   | Harness source                                   |
 *    | ------------------------- | ------------------------------------------------ |
 *    | `session_start`           | `session/created`                                |
 *    | `session_shutdown`        | `session/disposed` + plugin disposal             |
 *    | `model_select`            | `session/event` → `request/header` change        |
 *    | `before_agent_start`      | `system-prompt/assemble` waterfall                |
 *    | `before_provider_headers` | `llm/stream` scope + `globalThis.fetch` patch    |
 *    | `before_provider_request` | same fetch patch, on the serialized JSON body     |
 *    | `after_provider_response` | same fetch patch, on the returned `Response`      |
 *    | `message_end`             | `session/event` → `assistant/message`            |
 *    | `tool_execution_end`      | `session/event` → `tool/result`                  |
 *    | `agent_settled`           | `session/event` → `turn/end`                     |
 *    | `cache_warming_decision`  | never fires: the Harness has no warming seam      |
 *
 * The fetch patch is the one place the port changes mechanism: Pi hands its
 * extension a mutable payload before serialization, while a Harness request is
 * deep-frozen. The optimizer's own contract is already "the final serialized
 * payload" (`before_provider_request` documents it that way and the Anthropic
 * TTL repair reads wire order), so the adapter parses the serialized body,
 * runs the same handlers, and serializes the result back. `AsyncLocalStorage`
 * scoped to each `llm/stream` iteration keeps the patch to provider calls: no
 * tool, RPC or telemetry fetch ever sees the store.
 *
 * @module dsh-cache-optimizer/host
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
// Type-only: these augment the Cordis `Context`/`Events` surfaces the adapter
// subscribes to. Nothing is imported at runtime.
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-user-questions'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import extensionEntry from './extension.ts'
import type {
  ExtensionCommandContext,
  ExtensionContext,
  PiModel,
  PiModelRegistryLike,
  PiUi,
} from './pi-compat.ts'
import { mirrorDshEnv } from './pi-compat.ts'
import { MODELS_JSON_PATH } from './core/paths.ts'
import { invalidateModelsConfigCache } from './core/model-identity.ts'
import { hashSessionId } from './core/routing.ts'
import { applyConfigOps, diffProjection, findProviderSection, providersOf, type ProjectedProvider } from './dsh-config.ts'

/** Plugin configuration contributed by `cordis.patch.yml`. */
export interface HostOptions {
  /** Runtime optimization switch; `/cache-optimizer enable|disable` overrides it per process. */
  enabled?: boolean
  /** OpenAI-compatible `prompt_cache_key` fallback. */
  openaiCacheKey?: boolean
  /** Request long cache retention where the provider supports it. */
  cacheRetention?: boolean
  /** Repair invalid Anthropic cache-control TTL ordering in the final payload. */
  anthropicTtlRepair?: boolean
  /** Deterministic tool ordering for verified payload shapes (off by default). */
  toolOrder?: boolean
  /** Footer aggregation scope. */
  footerMode?: 'session' | 'total' | 'process'
  /** Extra time to wait for a background flush when the plugin unloads. */
  flushTimeoutMs?: number
}

/** One provider profile as the `llm-pi-ai` adapter configures it. */
interface ProviderProfile {
  displayName?: string
  api?: string
  baseURL?: string
  compat?: Record<string, unknown>
  models?: { id?: unknown; compat?: Record<string, unknown> }[]
  modelOverrides?: Record<string, { compat?: Record<string, unknown> }>
}

type ProviderConfig = Record<string, ProviderProfile>

/** Per-request identity captured at the `llm/stream` waterfall. */
interface RequestScope {
  provider: string
  modelId: string
  sessionId?: string
  model?: PiModel
}

/** One live Harness session as the adapter tracks it. */
interface HostSession {
  id: string
  sessionIdHash: string
  agent?: unknown
  model?: PiModel
  status?: string
  notifications: string[]
}

type HookHandler = (event: any, context: ExtensionContext) => unknown

/** Chain a handler's returned value into the next handler, as Pi does for payload hooks. */
function chainValue<T>(handlers: readonly HookHandler[], event: T, context: ExtensionContext): T {
  let current = event
  for (const handler of handlers) {
    const next = handler(current, context) as T | undefined
    if (next !== undefined) current = next
  }
  return current
}

/**
 * Install the optimizer on one Harness context.
 *
 * @param ctx - plugin context (the adapter's own fiber).
 * @param options - bundle configuration.
 * @returns a disposer that flushes local counters and restores `fetch`.
 */
export function installCacheOptimizerHost(ctx: Context, options: HostOptions): () => Promise<void> {
  mirrorDshEnv()
  applyEnvironment(options)
  nameConfigurationDocument(ctx)

  const handlers = new Map<string, HookHandler[]>()
  const sessions = new Map<string, HostSession>()
  const requestScope = new AsyncLocalStorage<RequestScope>()
  const modelsByKey = new Map<string, PiModel>()
  let providerConfig: ProviderConfig = readProviderConfig(ctx)
  const refreshProviderConfig = (force = false): void => {
    const next = readProviderConfig(ctx)
    if (!force && JSON.stringify(next) === JSON.stringify(providerConfig)) return
    providerConfig = next
    modelsByKey.clear()
    writeProviderProjection(providerConfig)
  }
  let sessionStarts = 0
  let disposed = false

  writeProviderProjection(providerConfig)

  const log = (level: 'debug' | 'info' | 'warn', message: string): void => {
    try {
      ctx.logger[level] ? ctx.logger[level](message) : undefined
    } catch {
      // logging must never break a request
    }
  }

  // ── model resolution ────────────────────────────────────────────

  const buildModel = (provider: string, id: string, apiHint?: string, nameHint?: string): PiModel => {
    const profile = providerConfig[provider]
    const cached = modelsByKey.get(`${provider}/${id}`)
    if (cached !== undefined) {
      return apiHint === undefined || apiHint === cached.api ? cached : { ...cached, api: apiHint }
    }
    const model: PiModel = {
      provider,
      id,
      name: nameHint ?? id,
      api: apiHint ?? profile?.api ?? '',
      baseUrl: profile?.baseURL ?? '',
      input: ['text'],
      reasoning: false,
      contextWindow: 0,
      maxTokens: 0,
    }
    modelsByKey.set(`${provider}/${id}`, model)
    return model
  }

  const registry: PiModelRegistryLike = {
    find: (provider, id) => modelsByKey.get(`${provider}/${id}`) ?? buildModel(provider, id),
    getAvailable: () => [...modelsByKey.values()],
    getAll: () => [...modelsByKey.values()],
  }

  const primeModels = async (): Promise<void> => {
    try {
      const providers = ctx.llm?.listProviders?.() ?? []
      for (const provider of providers) {
        try {
          const list = await ctx.llm.listModels(provider.id)
          for (const model of list) {
            const existing = buildModel(provider.id, model.id, undefined, model.name)
            modelsByKey.set(`${provider.id}/${model.id}`, {
              ...existing,
              name: model.name || existing.name,
            })
          }
        } catch {
          // A provider whose catalog is unavailable still resolves on demand.
        }
      }
    } catch {
      // The registry is an optional convenience; requests still resolve lazily.
    }
  }

  // ── session bookkeeping ─────────────────────────────────────────

  /**
   * Carry a fix/rollback the upstream code wrote into the projection back into
   * the profile configuration that actually drives `llm-pi-ai`.
   *
   * The upstream code owns the transaction (preview, backup, receipt, atomic
   * write, self-check); this adapter only translates the resulting scalar
   * compat/base-URL difference into schema-validated settings edits, and
   * regenerates the projection afterwards so the file never disagrees with the
   * profile.
   */
  const syncProjectionWrite = async (
    section: ReturnType<typeof findProviderSection>,
    before: Record<string, ProjectedProvider>,
    notifications: string[],
  ): Promise<void> => {
    const after = readProjection()
    if (JSON.stringify(before) === JSON.stringify(after)) return
    if (section === undefined) {
      refreshProviderConfig(true)
      notifications.push('⚠️ Provider configuration is not editable in this profile; the change was not applied.')
      return
    }
    const ops = diffProjection(before, after)
    if (ops.length === 0) {
      // Upstream repairs that only touch Pi-only fields (prompt-cache
      // lifetimes, for example) have no Harness counterpart; say so instead of
      // reporting a write that never happened.
      refreshProviderConfig(true)
      notifications.push('⚠️ This repair only touches settings the Harness does not consume (for example prompt-cache warming lifetimes); nothing was written.')
      return
    }
    const result = await applyConfigOps(ctx, section, ops)
    if (result.error !== undefined) {
      refreshProviderConfig(true)
      notifications.push(`⚠️ Could not write the provider configuration: ${result.error}. The change was not applied.`)
      return
    }
    refreshProviderConfig(true)
    if (result.applied > 0) {
      notifications.push(`✅ Applied ${String(result.applied)} configuration change(s) to this profile. Restart the affected session for them to take effect.`)
    }
  }

  const hostSession = (sessionId: string): HostSession => {
    let state = sessions.get(sessionId)
    if (state === undefined) {
      state = { id: sessionId, sessionIdHash: hashSessionId(sessionId), notifications: [] }
      sessions.set(sessionId, state)
    }
    return state
  }

  const agentSessionId = (agent: unknown): string | undefined => {
    const sessionId = (agent as { sessionId?: unknown } | undefined)?.sessionId
    return typeof sessionId === 'string' ? sessionId : undefined
  }

  const agentModel = (agent: unknown): PiModel | undefined => {
    try {
      const selection = (agent as { model?: { current?: () => { provider?: string; model?: string } | undefined } } | undefined)
        ?.model?.current?.()
      if (selection?.provider !== undefined && selection.model !== undefined) {
        return registry.find(selection.provider, selection.model)
      }
    } catch {
      // a command context without a live model still reports what it can
    }
    return undefined
  }

  // ── the Harness-side UI face ────────────────────────────────────

  // Optional services are read through `ctx.get(name, false)`: the Cordis proxy
  // throws on a service this plugin did not declare, while the non-strict get
  // simply answers undefined, which is the degradation every optional seam wants.
  const optionalService = <T>(name: string): T | undefined => {
    try {
      return (ctx.get(name, false) as T | undefined) ?? undefined
    } catch {
      return undefined
    }
  }

  const ask = async (
    agent: unknown,
    title: string,
    message: string,
    choices?: readonly string[],
  ): Promise<string | undefined> => {
    const questions = optionalService<{ ask(request: unknown): Promise<{ answers: { selected: string[]; custom?: string }[] }> }>('userQuestions')
    if (questions === undefined || agent === undefined) return undefined
    try {
      const answer = await questions.ask({
        agent: agent as never,
        questions: [{
          id: 'cache-optimizer',
          header: title,
          question: message,
          options: choices?.map((label) => ({ label })),
        }],
      })
      const item = answer.answers[0]
      if (item === undefined) return undefined
      return item.custom !== undefined && item.custom.trim() !== '' ? item.custom : item.selected[0]
    } catch (error) {
      log('debug', `cache-optimizer: interactive prompt unavailable: ${String(error)}`)
      return undefined
    }
  }

  const makeUi = (session: HostSession | undefined, agent: unknown, interactive: boolean): PiUi => {
    const collected = session?.notifications
    const notify: PiUi['notify'] = (message, level) => {
      if (collected !== undefined) collected.push(message)
      log(level === 'error' ? 'warn' : 'debug', message)
    }
    return {
      notify,
      setStatus(key, text) {
        const previous = session?.status
        if (session !== undefined) {
          if (text === undefined) delete session.status
          else session.status = text
        }
        // The Harness has no footer line: publish the same string once per
        // change so it is visible in the runtime log, and keep it on the
        // session for diagnostics. Full counters come from /cache-optimizer.
        if (text !== undefined && text !== previous) log('info', `${key}: ${text}`)
      },
      async confirm(title, message) {
        if (!interactive) return false
        const answer = await ask(agent, title, message, ['Yes', 'No'])
        return answer === 'Yes'
      },
      async select(title, choices) {
        if (!interactive) return undefined
        return ask(agent, title, 'Choose one:', choices)
      },
      async input(title, placeholder) {
        if (!interactive) return undefined
        return ask(agent, title, placeholder ?? '', undefined)
      },
    }
  }

  const makeContext = (input: {
    session?: HostSession
    model?: PiModel
    agent?: unknown
    mode?: string
    interactive?: boolean
    notifications?: string[]
  }): ExtensionCommandContext => {
    const session = input.session
    const owner = session === undefined ? undefined : { ...session, notifications: input.notifications ?? session.notifications }
    return {
      model: input.model ?? session?.model,
      modelRegistry: registry,
      sessionManager: {
        getSessionId: () => session?.id ?? '',
      },
      ui: makeUi(owner, input.agent ?? session?.agent, input.interactive === true),
      mode: input.mode ?? 'web',
      hasUI: input.interactive === true,
    }
  }

  // ── hook dispatch ───────────────────────────────────────────────

  const listeners = (name: string): HookHandler[] => handlers.get(name) ?? []

  const dispatch = async (name: string, event: unknown, context: ExtensionContext): Promise<void> => {
    for (const handler of listeners(name)) {
      try {
        await handler(event, context)
      } catch (error) {
        log('warn', `cache-optimizer: ${name} handler failed: ${String(error)}`)
      }
    }
  }

  // Pi awaits a hook before the next lifecycle step; a Harness emit is
  // fire-and-forget. Chaining per session keeps the upstream ordering (a
  // message is accounted before the turn settles) without blocking the loop.
  const sessionQueues = new Map<string, Promise<void>>()
  const enqueue = (sessionId: string, task: () => Promise<void>): void => {
    const previous = sessionQueues.get(sessionId) ?? Promise.resolve()
    const next = previous.then(task, task)
    sessionQueues.set(sessionId, next.finally(() => {
      if (sessionQueues.get(sessionId) === next) sessionQueues.delete(sessionId)
    }))
  }

  const piApi = {
    on(name: string, handler: HookHandler): void {
      const list = handlers.get(name) ?? []
      list.push(handler)
      handlers.set(name, list)
    },
    registerCommand(name: string, definition: Record<string, unknown>): void {
      const commands = optionalService<{
        register(definition: {
          name: string
          description: string
          handler: (invocation: { agent?: unknown; rawInput: string; signal: AbortSignal }) => Promise<{ kind: 'success' | 'error'; text: string }>
        }): unknown
      }>('commands')
      if (commands === undefined) {
        log('warn', 'cache-optimizer: no command registry; /cache-optimizer is unavailable in this profile')
        return
      }
      const handler = definition.handler as (args: string, context: ExtensionCommandContext) => Promise<void>
      commands.register({
        name,
        description: typeof definition.description === 'string' ? definition.description : 'Configure cache behavior',
        handler: async (invocation) => {
          const sessionId = agentSessionId(invocation.agent) ?? 'command'
          const session = hostSession(sessionId)
          session.agent = invocation.agent
          const notifications: string[] = []
          const context = makeContext({
            session,
            agent: invocation.agent,
            model: agentModel(invocation.agent) ?? session.model,
            // A question answerer is the Harness equivalent of Pi's interactive
            // UI. Without one the command must take the non-interactive path and
            // print guidance instead of pretending the user declined.
            interactive: optionalService('userQuestions') !== undefined && invocation.agent !== undefined,
            notifications,
          })
          refreshProviderConfig()
          const section = findProviderSection(ctx)
          const before = readProjection()
          try {
            await handler(invocation.rawInput.trim(), context)
          } catch (error) {
            notifications.push(`❌ ${error instanceof Error ? error.message : String(error)}`)
          }
          await syncProjectionWrite(section, before, notifications)
          const text = notifications.join('\n\n').trim()
          const failed = notifications.some((line) => line.startsWith('❌'))
          return text === ''
            ? { kind: 'success' as const, text: 'No output.' }
            : { kind: failed ? 'error' as const : 'success' as const, text }
        },
      })
    },
  }

  extensionEntry(piApi as never)

  // ── fetch interception ─────────────────────────────────────────

  const originalFetch = globalThis.fetch
  type FetchInput = Parameters<typeof globalThis.fetch>[0]
  const patchedFetch = async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const scope = requestScope.getStore()
    if (scope === undefined) return originalFetch(input, init)
    let nextInit = init
    try {
      nextInit = applyHeaders(scope, init)
      nextInit = applyBody(scope, nextInit)
    } catch (error) {
      log('warn', `cache-optimizer: request rewrite skipped: ${String(error)}`)
      nextInit = init
    }
    if (process.env.DSH_CACHE_OPTIMIZER_DEBUG === '1') {
      const body = typeof nextInit?.body === 'string' ? nextInit.body : undefined
      let keys: string[] = []
      if (body !== undefined) {
        try {
          keys = Object.keys(JSON.parse(body) as object)
        } catch {
          keys = ['<unparseable>']
        }
      }
      console.error('[cache-optimizer] fetch', String(input), body === undefined ? '(no body)' : `${String(body.length)} bytes`, keys.join(','))
    }
    const response = await originalFetch(input, nextInit)
    void observeResponse(scope, response)
    return response
  }
  globalThis.fetch = patchedFetch as typeof globalThis.fetch

  const modelForScope = (scope: RequestScope): PiModel => {
    if (scope.model !== undefined) return scope.model
    const model = buildModel(scope.provider, scope.modelId)
    scope.model = model
    return model
  }

  const scopeContext = (scope: RequestScope, sessionId?: string): ExtensionCommandContext => {
    const id = sessionId ?? scope.sessionId
    const session = id === undefined ? undefined : hostSession(id)
    if (session !== undefined) session.model = scope.model ?? session.model
    return makeContext({ session, model: modelForScope(scope) })
  }

  const applyHeaders = (scope: RequestScope, init?: RequestInit): RequestInit | undefined => {
    if (init === undefined) return init
    const context = scopeContext(scope)
    // Pi hands this hook a mutable `headers` record and expects in-place edits.
    const event = { headers: headersToRecord(init.headers ?? {}) }
    for (const handler of listeners('before_provider_headers')) {
      try {
        handler(event, context)
      } catch (error) {
        log('warn', `cache-optimizer: before_provider_headers handler failed: ${String(error)}`)
      }
    }
    return { ...init, headers: event.headers }
  }

  const applyBody = (scope: RequestScope, init?: RequestInit): RequestInit | undefined => {
    if (init === undefined || typeof init.body !== 'string' || init.body.length === 0) return init
    if (!init.body.trimStart().startsWith('{')) return init
    let payload: unknown
    try {
      payload = JSON.parse(init.body)
    } catch {
      return init
    }
    const wireModel = (payload as { model?: unknown }).model
    if (typeof wireModel === 'string' && wireModel !== '' && wireModel !== scope.modelId) {
      scope.model = buildModel(scope.provider, wireModel)
    }
    const context = scopeContext(scope)
    // Pi's contract for this hook is "return the replacement payload", so the
    // chained value is the payload itself rather than an event envelope.
    let next = payload
    for (const handler of listeners('before_provider_request')) {
      try {
        const replacement = handler({ payload: next }, context)
        if (replacement !== undefined) next = replacement
      } catch (error) {
        log('warn', `cache-optimizer: before_provider_request handler failed: ${String(error)}`)
      }
    }
    if (next === payload) return init
    return { ...init, body: JSON.stringify(next) }
  }

  const observeResponse = async (scope: RequestScope, response: Response): Promise<void> => {
    const headers = headersToRecord(response.headers)
    if (!response.ok) {
      try {
        const text = await response.clone().text()
        if (text !== '') headers['x-provider-error-body'] = text.slice(0, 16_384)
      } catch {
        // a body that cannot be cloned still reports its status
      }
    }
    const context = scopeContext(scope)
    await dispatch('after_provider_response', { status: response.status, headers }, context)
  }

  // ── Harness event → Pi hook translation ────────────────────────

  ctx.on('session/created', (session) => {
    const id = String(session.id)
    const state = hostSession(id)
    const reason = sessionStarts === 0 ? 'startup' : 'new'
    sessionStarts += 1
    enqueue(id, async () => {
      refreshProviderConfig()
      await dispatch('session_start', { reason }, makeContext({ session: state }))
    })
  })

  ctx.on('session/disposed', (session) => {
    const id = String(session.id)
    const state = sessions.get(id)
    enqueue(id, async () => {
      await dispatch('session_shutdown', {}, makeContext({ session: state }))
    })
    sessions.delete(id)
  })

  ctx.on('session/event', (session, event) => {
    const id = String(session.id)
    const state = hostSession(id)
    const type = (event as { type?: string }).type
    const data = (event as { data?: Record<string, unknown> }).data ?? {}
    switch (type) {
      case 'request/header': {
        const header = data.header as { config?: { provider?: unknown; model?: unknown } } | undefined
        const provider = header?.config?.provider
        const modelId = header?.config?.model
        if (typeof provider === 'string' && typeof modelId === 'string') {
          const model = buildModel(provider, modelId)
          const previous = state.model
          state.model = model
          if (previous === undefined || previous.provider !== provider || previous.id !== modelId) {
            enqueue(id, () => dispatch('model_select', { model }, makeContext({ session: state, model })))
          }
        }
        break
      }
      case 'assistant/message': {
        const message = piAssistantMessage(data)
        if (message === undefined) break
        const model = modelFromEventSource(data, buildModel)
        if (model !== undefined) state.model = model
        enqueue(id, () => dispatch('message_end', { message }, makeContext({ session: state, model })))
        break
      }
      case 'tool/result': {
        const parent = (data as { parentToolCallId?: unknown }).parentToolCallId
        enqueue(id, () => dispatch('tool_execution_end', { parentToolCallId: parent }, makeContext({ session: state })))
        break
      }
      case 'turn/end': {
        enqueue(id, () => dispatch('agent_settled', {}, makeContext({ session: state })))
        break
      }
      default:
        break
    }
  })

  ctx.on('system-prompt/assemble', async (_assembly, assembleContext, next) => {
    const result = await next()
    if (listeners('before_agent_start').length === 0) return result
    try {
      const selection = (assembleContext as { modelSelection?: { provider?: string; model?: string } }).modelSelection
      const model = selection?.provider !== undefined && selection.model !== undefined
        ? buildModel(selection.provider, selection.model)
        : undefined
      const agent = (assembleContext as { agent?: unknown }).agent
      const sessionId = agentSessionId(agent)
      const state = sessionId === undefined ? undefined : hostSession(sessionId)
      if (state !== undefined && model !== undefined) state.model = model
      const joined = result.sections.map((section) => section.text).join('\n\n')
      const context = makeContext({ session: state, model, agent })
      const event = { systemPrompt: joined, systemPromptOptions: {} }
      const outcome = chainValue(listeners('before_agent_start'), event, context) as { systemPrompt?: string }
      if (typeof outcome.systemPrompt === 'string' && outcome.systemPrompt !== joined) {
        applyPromptDiff(result.sections, joined, outcome.systemPrompt)
      }
    } catch (error) {
      log('warn', `cache-optimizer: prompt rewrite skipped: ${String(error)}`)
    }
    return result
  })

  ctx.on('llm/stream', (request, next): AsyncIterable<any> => {
    const scope: RequestScope = {
      provider: request.provider,
      modelId: request.model,
      sessionId: request.sessionId === undefined ? undefined : String(request.sessionId),
      model: buildModel(request.provider, request.model),
    }
    const iterator = next()[Symbol.asyncIterator]()
    return {
      [Symbol.asyncIterator](): AsyncIterator<any> {
        return {
          next: () => requestScope.run(scope, () => iterator.next()),
          return: (value?: unknown) => requestScope.run(scope, () => iterator.return?.(value) ?? Promise.resolve({ done: true as const, value })) as never,
          throw: (error?: unknown) => requestScope.run(scope, () => iterator.throw?.(error) ?? Promise.reject(error)) as never,
        }
      },
    }
  })

  void primeModels()

  return async (): Promise<void> => {
    if (disposed) return
    disposed = true
    try {
      globalThis.fetch = originalFetch
    } finally {
      for (const [id, state] of sessions) {
        await dispatch('session_shutdown', {}, makeContext({ session: state }))
        sessions.delete(id)
      }
    }
  }
}

/**
 * Point the ported user-facing advice at the document a Harness user edits:
 * the profile patch that owns the `llm-pi-ai` provider section.
 */
function nameConfigurationDocument(ctx: Context): void {
  if (process.env.DSH_CACHE_OPTIMIZER_MODELS_DISPLAY !== undefined) return
  try {
    const configEditor = ctx.get('configEditor', false) as { documentPath?: unknown } | undefined
    const documentPath = configEditor?.documentPath
    if (typeof documentPath === 'string' && documentPath !== '') {
      process.env.DSH_CACHE_OPTIMIZER_MODELS_DISPLAY = documentPath
    }
  } catch {
    // no configuration editor: keep the projection path as the documented location
  }
}

/** Apply bundle options as the environment variables the upstream core reads. */
function applyEnvironment(options: HostOptions): void {
  const setIfUnset = (key: string, value: string): void => {
    if (process.env[key] === undefined) process.env[key] = value
  }
  if (options.enabled === false) setIfUnset('DSH_CACHE_OPTIMIZER_DISABLED', '1')
  if (options.openaiCacheKey === false) setIfUnset('PI_CACHE_OPTIMIZER_NO_OPENAI_CACHE_KEY', '1')
  if (options.toolOrder === true) setIfUnset('PI_CACHE_OPTIMIZER_TOOL_ORDER', '1')
  if (options.toolOrder === false) setIfUnset('PI_CACHE_OPTIMIZER_TOOL_ORDER', '0')
  if (options.footerMode !== undefined) setIfUnset('PI_CACHE_OPTIMIZER_FOOTER_MODE', options.footerMode)
  if (options.cacheRetention === false) setIfUnset('PI_CACHE_OPTIMIZER_NO_CACHE_RETENTION', '1')
  if (options.anthropicTtlRepair === false) setIfUnset('PI_CACHE_OPTIMIZER_NO_ANTHROPIC_TTL_REPAIR', '1')
}

/**
 * Read the active `llm-pi-ai` provider profiles.
 *
 * Settings forms carry the live (redacted) values; the configuration editor
 * carries the profile patch rows. Either is enough for compat resolution, and
 * a profile without either degrades to an empty config (diagnostics say so)
 * rather than guessing.
 */
function readProviderConfig(ctx: Context): ProviderConfig {
  const candidates: unknown[] = []
  // Non-strict service reads: neither service is a declared dependency, and the
  // Cordis proxy would otherwise throw for one this profile does not mount.
  const service = (name: string): any => {
    try {
      return ctx.get(name, false)
    } catch {
      return undefined
    }
  }
  try {
    const settings = service('settings')
    const describe = settings?.describe?.bind(settings)
    if (describe !== undefined) {
      for (const descriptor of describe({ redactSecrets: true }) as { ns?: unknown; value?: unknown }[]) {
        candidates.push(descriptor.value)
      }
    }
  } catch {
    // settings unavailable: fall through to the config editor
  }
  try {
    const configEditor = service('configEditor')
    const configuration = configEditor?.configuration?.bind(configEditor)
    if (configuration !== undefined) {
      for (const row of configuration() as { entry?: { name?: unknown }; inherited?: unknown; override?: unknown }[]) {
        const name = String(row.entry?.name ?? '')
        if (!name.includes('llm-pi-ai')) continue
        candidates.push(row.inherited, row.override)
      }
    }
  } catch {
    // config editor unavailable: keep whatever settings produced
  }
  if (process.env.DSH_CACHE_OPTIMIZER_DEBUG === '1') {
    console.error('[cache-optimizer] provider config candidates', candidates.length, candidates.map((candidate) => Object.keys((candidate ?? {}) as object).slice(0, 6)))
  }
  for (const candidate of candidates) {
    const providers = (candidate as { providers?: unknown } | undefined)?.providers
    if (typeof providers === 'object' && providers !== null && !Array.isArray(providers)) {
      return providers as ProviderConfig
    }
  }
  return {}
}

/**
 * Project the Harness provider profiles into the Pi `models.json` shape the
 * ported compat resolver reads, so one compat implementation serves both hosts.
 */
function writeProviderProjection(providers: ProviderConfig): void {
  const projected: Record<string, unknown> = {}
  for (const [id, profile] of Object.entries(providers)) {
    const entry: Record<string, unknown> = {}
    if (typeof profile.api === 'string') entry.api = profile.api
    if (typeof profile.baseURL === 'string') entry.baseUrl = profile.baseURL
    if (profile.compat !== undefined) entry.compat = profile.compat
    const models = Array.isArray(profile.models)
      ? profile.models
        .filter((model) => typeof model?.id === 'string')
        .map((model) => ({ id: model.id, ...(model.compat === undefined ? {} : { compat: model.compat }) }))
      : []
    if (models.length > 0) entry.models = models
    if (profile.modelOverrides !== undefined) entry.modelOverrides = profile.modelOverrides
    projected[id] = entry
  }
  const document = { providers: projected }
  try {
    mkdirSync(dirname(MODELS_JSON_PATH), { recursive: true })
    const temporary = `${MODELS_JSON_PATH}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(document, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    renameSync(temporary, MODELS_JSON_PATH)
  } catch {
    // A read-only state directory leaves compat resolution empty, not broken.
  } finally {
    invalidateModelsConfigCache()
  }
}

/** Read the provider map of the projection file, tolerating absence or damage. */
function readProjection(): Record<string, ProjectedProvider> {
  try {
    return providersOf(JSON.parse(readFileSync(MODELS_JSON_PATH, 'utf8')))
  } catch {
    return {}
  }
}

/** Convert any fetch header representation into a plain mutable record. */
function headersToRecord(headers: NonNullable<RequestInit['headers']>): Record<string, string> {
  const record: Record<string, string> = {}
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    headers.forEach((value, key) => {
      record[key] = value
    })
    return record
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) record[key] = value
    return record
  }
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) record[key] = String(value)
  }
  return record
}

/** Build the Pi-shaped assistant message one Harness `assistant/message` event describes. */
function piAssistantMessage(data: Record<string, unknown>): Record<string, unknown> | undefined {
  const message = data.message as { role?: unknown; source?: unknown } | undefined
  if (message?.role !== 'assistant') return undefined
  const source = (message.source ?? {}) as {
    provider?: unknown
    model?: unknown
    replayState?: { response?: { api?: unknown; stopReason?: unknown } }
  }
  const usage = data.usage as {
    inputTokens?: unknown
    outputTokens?: unknown
    totalTokens?: unknown
    cacheReadTokens?: unknown
    cacheWriteTokens?: unknown
  } | undefined
  const normalized = usage === undefined
    ? undefined
    : {
      input: typeof usage.inputTokens === 'number' ? usage.inputTokens : 0,
      cacheRead: typeof usage.cacheReadTokens === 'number' ? usage.cacheReadTokens : 0,
      cacheWrite: typeof usage.cacheWriteTokens === 'number' ? usage.cacheWriteTokens : 0,
      ...(typeof usage.outputTokens === 'number' ? { output: usage.outputTokens } : {}),
      ...(typeof usage.totalTokens === 'number' ? { totalTokens: usage.totalTokens } : {}),
    }
  const response = source.replayState?.response ?? {}
  return {
    role: 'assistant',
    ...(typeof source.provider === 'string' ? { provider: source.provider } : {}),
    ...(typeof source.model === 'string' ? { model: source.model } : {}),
    ...(typeof response.api === 'string' ? { api: response.api } : {}),
    ...(typeof response.stopReason === 'string' ? { stopReason: response.stopReason } : {}),
    ...(normalized === undefined ? {} : { usage: normalized }),
  }
}

/** Resolve the model one finalized assistant message names. */
function modelFromEventSource(
  data: Record<string, unknown>,
  build: (provider: string, id: string, apiHint?: string) => PiModel,
): PiModel | undefined {
  const message = data.message as { source?: { provider?: unknown; model?: unknown; replayState?: { response?: { api?: unknown } } } } | undefined
  const provider = message?.source?.provider
  const id = message?.source?.model
  if (typeof provider !== 'string' || typeof id !== 'string') return undefined
  const api = message?.source?.replayState?.response?.api
  return build(provider, id, typeof api === 'string' ? api : undefined)
}

/**
 * Write a prompt-level change back into the section it came from.
 *
 * `system-prompt/assemble` exposes sections, while the ported Pi hook returns a
 * whole prompt. The only transformation reachable without Pi's skill list is a
 * pure deletion inside one section (`stripSessionOverviewChurn`), so the
 * changed region is located by common prefix/suffix and applied only when both
 * boundaries fall inside the same section; anything else is dropped rather
 * than corrupting an assembly the hook never described.
 */
function applyPromptDiff(
  sections: { name: string; text: string }[],
  before: string,
  after: string,
): void {
  if (after.length === 0) return
  let prefix = 0
  const maxPrefix = Math.min(before.length, after.length)
  while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  const maxSuffix = Math.min(before.length, after.length) - prefix
  while (suffix < maxSuffix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1

  const changedStart = prefix
  const changedEnd = before.length - suffix
  let offset = 0
  for (const section of sections) {
    const start = offset
    const end = start + section.text.length
    if (changedStart >= start && changedEnd <= end) {
      const localStart = changedStart - start
      const localEnd = changedEnd - start
      const replacement = after.slice(prefix, after.length - suffix)
      section.text = section.text.slice(0, localStart) + replacement + section.text.slice(localEnd)
      return
    }
    offset = end + 2
  }
}
