/**
 * Structural stand-in for the `@earendil-works/pi-coding-agent` host types that
 * the ported optimizer core still names.
 *
 * The core modules in `src/core` are the upstream implementation, kept as close
 * to verbatim as the hosted project allows: they read a model description, an
 * assistant message, and a per-request payload, and they never call a Pi host
 * API at runtime. Only two host facts were runtime dependencies, and both are
 * resolved here for DeepSeek Harness:
 *
 * - `getAgentDir()` — the directory all local state lives under. Pi resolves
 *   `PI_CODING_AGENT_DIR` or `~/.pi/agent`; this port resolves
 *   `DSH_CACHE_OPTIMIZER_DIR`, then `$DSH_HOME/cache-optimizer`
 *   (`~/.dsh/cache-optimizer` when `DSH_HOME` is unset).
 * - the host context/message types — replaced by the structural shapes below,
 *   which the Harness objects are mapped onto in `src/dsh/`.
 *
 * @module dsh-cache-optimizer/pi-compat
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

/** Per-million-token price tier, as Pi models carry it. */
export interface PiModelCostTier {
  inputTokensAbove?: number
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
}

/** Structural description of one provider/model route. */
export interface PiModel {
  provider: string
  id: string
  name?: string
  api?: string
  baseUrl?: string
  compat?: Record<string, unknown>
  input?: readonly string[]
  reasoning?: boolean
  cost?: PiModelCostTier & { tiers?: readonly PiModelCostTier[] }
  contextWindow?: number
  maxTokens?: number
  thinkingLevelMap?: Record<string, string | null | undefined>
  samplingParams?: Record<string, unknown>
  headers?: Record<string, string>
}

/** One skill Pi would list in its prompt; kept for the prompt-rewrite core. */
export interface PiSkill {
  name: string
  description: string
  filePath: string
  disableModelInvocation?: boolean
}

/** Pi's system-prompt build options, reduced to the fields the core reads. */
export interface BuildSystemPromptOptions {
  skills?: PiSkill[]
  sections?: Record<string, string>
  selectedTools?: string[]
  hiddenTools?: string[]
  customPrompt?: string
  forceSystemPrompt?: string
}

/** Pi's session manager, reduced to the id the core hashes. */
export interface PiSessionManager {
  getSessionId(): string
}

/** Pi's model registry face, reduced to the lookups the core performs. */
export interface PiModelRegistryLike {
  find(provider: string, modelId: string): PiModel | undefined
  getAvailable(): PiModel[]
  getAll(): PiModel[]
}

/** Pi's UI face, reduced to the interactions the command handler performs. */
export interface PiUi {
  notify(message: string, level?: 'info' | 'warning' | 'error'): void
  /** Publish one keyed footer status; Pi renders it under its own status line. */
  setStatus(key: string, text: string | undefined): void
  confirm(title: string, message: string): Promise<boolean>
  select(title: string, options: string[]): Promise<string | undefined>
  input(title: string, placeholder?: string): Promise<string | undefined>
}

/** Pi's extension context, reduced to the fields the core reads. */
export interface ExtensionContext {
  model?: PiModel
  modelRegistry?: PiModelRegistryLike
  sessionManager: PiSessionManager
  ui: PiUi
  mode?: string
  cwd?: string
}

/**
 * Pi's command context adds the interactive-UI probe the command handler uses
 * to refuse a write when it cannot ask a human.
 */
export interface ExtensionCommandContext extends ExtensionContext {
  hasUI: boolean
}

/** Pi's extension API; only the surfaces this port uses are modelled. */
export interface ExtensionAPI {
  on(event: string, handler: (...args: any[]) => unknown): void
  registerCommand(name: string, options: Record<string, unknown>): void
  /**
   * Pi's settings reader. Declared because the ported entry probes it with
   * `typeof pi.getSettings === "function"`; the Harness adapter omits the
   * property, so the optimizer keeps its documented defaults.
   */
  getSettings(): unknown
}

/**
 * Root of every local file this optimizer owns: statistics shards and archive,
 * the persisted feature configuration, fix receipts, backups and the
 * generated provider projection.
 *
 * @returns absolute state directory, following `DSH_CACHE_OPTIMIZER_DIR`,
 *   `$DSH_HOME`, then `~/.dsh`.
 */
export function getAgentDir(): string {
  const explicit = process.env.DSH_CACHE_OPTIMIZER_DIR
  if (explicit !== undefined && explicit.trim() !== '') return explicit
  // The upstream contract is still honoured so a Pi-era directory (and the
  // ported test suite) keeps pointing at the same local counters.
  const legacy = process.env.PI_CODING_AGENT_DIR
  if (legacy !== undefined && legacy.trim() !== '') return legacy
  const home = process.env.DSH_HOME
  const base = home !== undefined && home.trim() !== '' ? home : join(homedir(), '.dsh')
  return join(base, 'cache-optimizer')
}

/**
 * Mirror the `DSH_CACHE_OPTIMIZER_*` spellings onto the upstream
 * `PI_CACHE_OPTIMIZER_*` variables the core reads, without ever overriding a
 * value the user set explicitly.
 *
 * @param env - process environment to update in place.
 */
export function mirrorDshEnv(env: NodeJS.ProcessEnv = process.env): void {
  for (const key of Object.keys(env)) {
    if (!key.startsWith('DSH_CACHE_OPTIMIZER_')) continue
    const legacy = 'PI_CACHE_' + key.slice('DSH_CACHE_'.length)
    if (env[legacy] === undefined) env[legacy] = env[key]
  }
}
