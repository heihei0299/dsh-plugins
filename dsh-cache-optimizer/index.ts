/**
 * dsh-cache-optimizer — prompt/KV cache optimization for DeepSeek Harness.
 *
 * A DSH plugin bundle around the upstream `pi-cache-optimizer` extension: the
 * upstream implementation (stats shards and archive, cache-key fallback,
 * session affinity, retention gating, Anthropic TTL repair, deterministic tool
 * ordering, compat diagnostics and the `/cache-optimizer` command surface) runs
 * unchanged, on a host adapter that maps Harness seams onto the Pi hooks it
 * expects. See `src/host.ts` for the seam table.
 *
 * @module dsh-cache-optimizer
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { installCacheOptimizerHost, type HostOptions } from './src/host.ts'

export const name = 'dsh-cache-optimizer'

/**
 * Hard dependencies: the LLM runtime owns requests (the fetch seam is scoped to
 * `llm/stream`) and the command registry owns `/cache-optimizer`. Settings,
 * the configuration editor and the user-question answerer are optional and
 * probed at use, so a headless profile keeps every non-interactive path.
 */
export const inject = ['llm', 'commands']

/** Bundle configuration; every default is the upstream behaviour. */
export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('Optimize requests at runtime; /cache-optimizer enable|disable switches this process'),
  openaiCacheKey: Schema.boolean().default(true).description('Add the conservative per-session prompt_cache_key fallback to OpenAI-compatible proxy payloads that carry none'),
  cacheRetention: Schema.boolean().default(true).description('Request long prompt-cache retention where the provider declares support'),
  anthropicTtlRepair: Schema.boolean().default(true).description('Downgrade an invalid 1h-after-5m Anthropic cache-control ordering in the final payload'),
  toolOrder: Schema.boolean().default(false).description('Sort verified tool declarations deterministically (opt-in, off by default)'),
  footerMode: Schema.union(['session', 'total', 'process']).default('session').description('Footer aggregation scope: this conversation, every local session today, or this process'),
  warming: Schema.boolean().default(false).description('Allow /cache-optimizer-warm to replay this session\'s last provider request with a one-token cap (capped per session; retires after repeated failures)'),
})

/**
 * Mount the optimizer.
 *
 * @param ctx - Harness plugin context.
 * @param config - validated bundle configuration.
 */
export function apply(ctx: Context, config: HostOptions): void {
  const dispose = installCacheOptimizerHost(ctx, config)
  // The disposer flushes local counters and restores the original fetch; Cordis
  // awaits an async disposer, so a reload never leaves a half-patched fetch.
  ctx.effect(() => dispose, 'dsh-cache-optimizer lifecycle')
}
