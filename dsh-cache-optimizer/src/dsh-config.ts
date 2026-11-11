/**
 * Bridge between the ported optimizer's `models.json` view and the Harness
 * profile configuration that actually feeds `llm-pi-ai`.
 *
 * The upstream extension resolves provider compat from Pi's `models.json` and
 * `/cache-optimizer fix` edits that file. A Harness profile keeps the same
 * information in its plugin configuration (`llm-pi-ai` → `providers`), so the
 * host projects it into `models.json` for reading (see `src/host.ts`) and this
 * module translates a write back:
 *
 * 1. take the projection before a command and after it,
 * 2. diff provider/model compat and base URLs,
 * 3. write the difference into the live settings section through the
 *    schema-validated settings transport (or the configuration editor when the
 *    settings transport is unavailable),
 * 4. let the caller regenerate the projection from the result.
 *
 * A failed write leaves the settings untouched and reports why, so a fix never
 * claims an effect it did not have.
 *
 * @module dsh-cache-optimizer/dsh-config
 */

import type { Context } from '@deepseek-ai/cordis'

/** One provider profile as the projection carries it. */
export interface ProjectedProvider {
  api?: unknown
  baseUrl?: unknown
  compat?: Record<string, unknown>
  models?: { id?: unknown; compat?: Record<string, unknown>; baseUrl?: unknown }[]
  modelOverrides?: Record<string, { compat?: Record<string, unknown> }>
}

/** One path-addressed settings edit. */
export type ConfigOp =
  | { op: 'set'; path: string[]; value: unknown }
  | { op: 'unset'; path: string[] }

/** Outcome of applying projected changes to the profile. */
export interface ConfigSyncResult {
  applied: number
  error?: string
}

/** The live settings section that owns provider profiles. */
interface ProviderSection {
  ns: string
  revision: number | undefined
  providers: Record<string, ProjectedProvider>
}

/**
 * Locate the settings namespace that carries `providers`.
 * @param ctx - plugin context.
 * @returns the namespace id, revision and current providers, or undefined.
 */
function optionalService<T>(ctx: Context, name: string): T | undefined {
  try {
    return (ctx.get(name, false) as T | undefined) ?? undefined
  } catch {
    return undefined
  }
}

export function findProviderSection(ctx: Context): ProviderSection | undefined {
  try {
    const settings = optionalService<{ describe(options?: unknown): unknown }>(ctx, 'settings')
    const describe = settings?.describe?.bind(settings)
    if (describe === undefined) return undefined
    for (const descriptor of describe() as { ns?: unknown; revision?: unknown; value?: unknown }[]) {
      const providers = (descriptor.value as { providers?: unknown } | undefined)?.providers
      if (typeof providers !== 'object' || providers === null || Array.isArray(providers)) continue
      if (typeof descriptor.ns !== 'string') continue
      return {
        ns: descriptor.ns,
        revision: typeof descriptor.revision === 'number' ? descriptor.revision : undefined,
        providers: providers as Record<string, ProjectedProvider>,
      }
    }
  } catch {
    // no settings transport in this profile
  }
  return undefined
}

/** Whether the profile accepts programmatic configuration writes. */
export function profileIsWritable(ctx: Context): boolean {
  const settings = optionalService<{ writable?: boolean }>(ctx, 'settings')
  if (settings?.writable === true) return true
  return optionalService<unknown>(ctx, 'configEditor') !== undefined
}

function compatRecord(provider: ProjectedProvider | undefined): Record<string, unknown> {
  const compat = provider?.compat
  return typeof compat === 'object' && compat !== null && !Array.isArray(compat) ? compat : {}
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Compute the settings edits that reproduce `after` from `before`.
 *
 * Only the scalar compat keys and base URLs a fix may touch are considered;
 * anything else in the projection is derived and never written back.
 * @param before - projection providers before the command.
 * @param after - projection providers after the command.
 * @returns ordered settings edits.
 */
export function diffProjection(
  before: Record<string, ProjectedProvider>,
  after: Record<string, ProjectedProvider>,
): ConfigOp[] {
  const ops: ConfigOp[] = []
  for (const [providerId, next] of Object.entries(after)) {
    const previous = before[providerId]
    if (previous === undefined) continue

    const path = ['providers', providerId]
    if (!sameValue(previous.api, next.api) && typeof next.api === 'string') {
      ops.push({ op: 'set', path: [...path, 'api'], value: next.api })
    }
    if (!sameValue(previous.baseUrl, next.baseUrl) && typeof next.baseUrl === 'string') {
      ops.push({ op: 'set', path: [...path, 'baseURL'], value: next.baseUrl })
    }

    const previousCompat = compatRecord(previous)
    const nextCompat = compatRecord(next)
    for (const key of new Set([...Object.keys(previousCompat), ...Object.keys(nextCompat)])) {
      if (sameValue(previousCompat[key], nextCompat[key])) continue
      if (nextCompat[key] === undefined) {
        ops.push({ op: 'unset', path: [...path, 'compat', key] })
      } else {
        ops.push({ op: 'set', path: [...path, 'compat', key], value: nextCompat[key] })
      }
    }

    const previousModels = Array.isArray(previous.models) ? previous.models : []
    const nextModels = Array.isArray(next.models) ? next.models : []
    for (const model of nextModels) {
      if (typeof model.id !== 'string') continue
      const previousModel = previousModels.find((entry) => entry?.id === model.id)
      if (previousModel === undefined) continue
      const modelIndex = previousModels.indexOf(previousModel)
      if (!sameValue(previousModel.baseUrl, model.baseUrl) && typeof model.baseUrl === 'string') {
        ops.push({ op: 'set', path: [...path, 'models', String(modelIndex), 'baseURL'], value: model.baseUrl })
      }
      const previousModelCompat = compatRecord(previousModel as ProjectedProvider)
      const nextModelCompat = compatRecord(model as ProjectedProvider)
      for (const key of new Set([...Object.keys(previousModelCompat), ...Object.keys(nextModelCompat)])) {
        if (sameValue(previousModelCompat[key], nextModelCompat[key])) continue
        const target = [...path, 'models', String(modelIndex), 'compat', key]
        if (nextModelCompat[key] === undefined) ops.push({ op: 'unset', path: target })
        else ops.push({ op: 'set', path: target, value: nextModelCompat[key] })
      }
    }

    const previousOverrides = previous.modelOverrides ?? {}
    const nextOverrides = next.modelOverrides ?? {}
    for (const modelId of new Set([...Object.keys(previousOverrides), ...Object.keys(nextOverrides)])) {
      const previousOverrideCompat = compatRecord(previousOverrides[modelId] as ProjectedProvider)
      const nextOverrideCompat = compatRecord(nextOverrides[modelId] as ProjectedProvider)
      for (const key of new Set([...Object.keys(previousOverrideCompat), ...Object.keys(nextOverrideCompat)])) {
        if (sameValue(previousOverrideCompat[key], nextOverrideCompat[key])) continue
        const target = [...path, 'modelOverrides', modelId, 'compat', key]
        if (nextOverrideCompat[key] === undefined) ops.push({ op: 'unset', path: target })
        else ops.push({ op: 'set', path: target, value: nextOverrideCompat[key] })
      }
    }
  }
  return ops
}

/**
 * Write projection changes into the live profile.
 * @param ctx - plugin context.
 * @param section - settings section resolved before the command.
 * @param ops - edits computed by {@link diffProjection}.
 * @returns how many edits landed, or the refusal reason.
 */
export async function applyConfigOps(
  ctx: Context,
  section: ProviderSection,
  ops: readonly ConfigOp[],
): Promise<ConfigSyncResult> {
  if (ops.length === 0) return { applied: 0 }
  if (!profileIsWritable(ctx)) {
    return { applied: 0, error: 'this profile is read-only, so the compat change was not written' }
  }
  const settings = optionalService<{ mutate(ns: string, ops: unknown, revision?: number): Promise<void> }>(ctx, 'settings')
  if (settings === undefined) return { applied: 0, error: 'no settings transport is mounted in this profile' }
  try {
    await settings.mutate(section.ns, ops, section.revision)
    return { applied: ops.length }
  } catch (error) {
    return { applied: 0, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Read the current provider section of a projection document.
 * @param document - parsed projection.
 * @returns the provider map, or an empty map.
 */
export function providersOf(document: unknown): Record<string, ProjectedProvider> {
  const providers = (document as { providers?: unknown } | undefined)?.providers
  return typeof providers === 'object' && providers !== null && !Array.isArray(providers)
    ? providers as Record<string, ProjectedProvider>
    : {}
}
