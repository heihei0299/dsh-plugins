/**
 * Minimal stand-in for the Cordis context the host adapter runs on.
 *
 * Only the surfaces `src/host.ts` touches are modelled, so a test can drive
 * the real adapter and the real upstream extension without booting a Harness.
 */

export interface FakeCommandDefinition {
  name: string
  description: string
  handler: (invocation: {
    agent?: unknown
    rawInput: string
    signal: AbortSignal
  }) => Promise<{ kind: string; text: string }>
}

export interface FakeProviderProfile {
  api?: string
  baseURL?: string
  compat?: Record<string, unknown>
  models?: { id: string; compat?: Record<string, unknown> }[]
  modelOverrides?: Record<string, { compat?: Record<string, unknown> }>
}

export interface FakeContext {
  listeners: Map<string, ((...args: any[]) => unknown)[]>
  commandDefinitions: Map<string, FakeCommandDefinition>
  providers: Record<string, FakeProviderProfile>
  notifications: string[]
  effects: (() => void)[]
  on(event: string, listener: (...args: any[]) => unknown): () => void
  emit(event: string, ...args: any[]): void
  effect(factory: () => (() => void) | void, label?: string): () => void
  logger: Record<string, (...args: unknown[]) => void>
  llm: {
    listProviders(): { id: string; name: string }[]
    listModels(provider: string): Promise<{ provider: string; id: string; name: string }[]>
  }
  commands: {
    register(definition: FakeCommandDefinition): () => void
  }
  settings: {
    writable: boolean
    describe(options?: { redactSecrets?: boolean }): { ns: string; revision: number; value: unknown }[]
    mutate(ns: string, ops: { op: 'set' | 'unset'; path: string[]; value?: unknown }[], revision?: number): Promise<void>
  }
  userQuestions?: {
    ask(request: unknown): Promise<{ answers: { id: string; selected: string[]; custom?: string }[] }>
  }
  /** Cordis service resolution; non-strict reads answer undefined when absent. */
  get(name: string, strict?: boolean): unknown
}

/**
 * Build a fake context with the supplied provider profiles.
 * @param providers - provider profiles returned by `settings.describe()`.
 * @returns the fake context.
 */
export function makeFakeContext(providers: Record<string, FakeProviderProfile>): FakeContext {
  const listeners = new Map<string, ((...args: any[]) => unknown)[]>()
  const commandDefinitions = new Map<string, FakeCommandDefinition>()
  const effects: (() => void)[] = []
  const notifications: string[] = []
  const noop = (): void => {}
  // The settings section root is the plugin config, so path ops start at
  // `providers`; keep one live object both `describe` and `mutate` share.
  const config = { providers: providers as Record<string, unknown> }
  const context: FakeContext = {
    listeners,
    commandDefinitions,
    providers,
    notifications,
    effects,
    on(event, listener) {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      return () => {
        listeners.set(event, (listeners.get(event) ?? []).filter((entry) => entry !== listener))
      }
    },
    emit(event, ...args) {
      for (const listener of listeners.get(event) ?? []) void listener(...args)
    },
    effect(factory) {
      const disposer = factory()
      if (typeof disposer === 'function') effects.push(disposer)
      return () => {}
    },
    logger: { debug: noop, info: noop, warn: noop, error: noop },
    llm: {
      listProviders: () => Object.keys(providers).map((id) => ({ id, name: id })),
      listModels: async (provider: string) => (providers[provider]?.models ?? []).map((model) => ({
        provider,
        id: model.id,
        name: model.id,
      })),
    },
    commands: {
      register(definition) {
        commandDefinitions.set(definition.name, definition)
        return () => commandDefinitions.delete(definition.name)
      },
    },
    settings: {
      writable: true,
      describe: () => [{ ns: 'llm-pi-ai', revision: 1, value: config }],
      async mutate(_ns, ops) {
        for (const op of ops) {
          const path = [...op.path]
          let cursor: Record<string, any> = config as unknown as Record<string, any>
          for (const key of path.slice(0, -1)) {
            if (cursor[key] === undefined || typeof cursor[key] !== 'object') cursor[key] = {}
            cursor = cursor[key] as Record<string, any>
          }
          const last = path[path.length - 1]!
          if (op.op === 'set') cursor[last] = op.value
          else delete cursor[last]
          mutateCalls.push(op)
        }
      },
    },
    get(name) {
      if (name === 'settings') return context.settings
      if (name === 'commands') return context.commands
      if (name === 'userQuestions') return context.userQuestions
      return undefined
    },
  }
  return context
}

/** Recorded settings edits; shared for assertions in tests. */
const mutateCalls: { op: 'set' | 'unset'; path: string[]; value?: unknown }[] = []

/** Read the recorded settings edits. */
export function settingsEdits(): { op: 'set' | 'unset'; path: string[]; value?: unknown }[] {
  return mutateCalls
}

/** One live-session event source with the fields the adapter reads. */
export function fakeSession(id: string): { id: string } {
  return { id }
}
