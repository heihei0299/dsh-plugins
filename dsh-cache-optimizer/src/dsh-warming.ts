/**
 * On-demand cache warming for the Harness host.
 *
 * The upstream extension only votes on a warming request the Pi core issued
 * itself; the Harness has no such seam, so warming here is an explicit command
 * that replays the last provider request of one session with a one-token cap.
 * The replay keeps the original prompt, tool list and `prompt_cache_key`, so a
 * provider that caches by prefix refreshes the same entry the next real turn
 * will read. It is off unless the operator turns it on, capped per session, and
 * it disables itself after repeated failures.
 *
 * @module dsh-cache-optimizer/dsh-warming
 */

/** One replayable provider request captured at the fetch seam. */
export interface CapturedRequest {
  readonly input: unknown
  readonly init: RequestInit
}

/** Limits that keep a warming loop from spending tokens on its own. */
export interface WarmingLimits {
  /** Warmings allowed per session in one process. */
  readonly perSession: number
  /** Consecutive failures that disable warming for the process. */
  readonly failures: number
}

export const DEFAULT_WARMING_LIMITS: WarmingLimits = { perSession: 3, failures: 2 }

/** Process-wide warming bookkeeping. */
export class Warmer {
  private readonly used = new Map<string, number>()
  private failed = 0

  constructor(private readonly limits: WarmingLimits = DEFAULT_WARMING_LIMITS) {}

  /** Whether this session may be warmed again. */
  available(sessionId: string): boolean {
    return this.failed < this.limits.failures && (this.used.get(sessionId) ?? 0) < this.limits.perSession
  }

  /** Number of warmings already spent on a session. */
  spent(sessionId: string): number {
    return this.used.get(sessionId) ?? 0
  }

  /** Whether repeated failures retired warming for this process. */
  get retired(): boolean {
    return this.failed >= this.limits.failures
  }

  record(sessionId: string, ok: boolean): void {
    this.used.set(sessionId, (this.used.get(sessionId) ?? 0) + 1)
    this.failed = ok ? 0 : this.failed + 1
  }
}

/** Build the body a warming replay sends: same prefix, one output token. */
export function buildWarmingBody(body: string): { body?: string; error?: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return { error: 'the captured body is not JSON, so it cannot be replayed' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: 'the captured body is not an object' }
  }
  const record = parsed as Record<string, unknown>
  const next: Record<string, unknown> = { ...record, max_tokens: 1, max_completion_tokens: 1, stream: false }
  delete next.stream_options
  return { body: JSON.stringify(next) }
}

/** Read the cache accounting a warming response reports, when it reports any. */
export function readWarmingUsage(payload: unknown): string | undefined {
  const usage = (payload as { usage?: Record<string, unknown> } | undefined)?.usage
  if (usage === undefined || usage === null) return undefined
  const cached = (usage.prompt_tokens_details as { cached_tokens?: unknown } | undefined)?.cached_tokens
    ?? usage.prompt_cache_hit_tokens
    ?? usage.cached_tokens
  const prompt = usage.prompt_tokens ?? usage.input_tokens
  if (cached === undefined && prompt === undefined) return undefined
  const parts: string[] = []
  if (prompt !== undefined) parts.push(`prompt tokens ${String(prompt)}`)
  if (cached !== undefined) parts.push(`cached ${String(cached)}`)
  return parts.join(', ')
}

/**
 * Replay one captured request with a one-token cap.
 *
 * @param request - the captured request to replay.
 * @param fetchImpl - the fetch the host had before any patch, so the replay is
 *   neither rewritten nor counted as a turn.
 * @returns a human-readable outcome for the command transcript.
 */
export async function warmRequest(request: CapturedRequest, fetchImpl: typeof globalThis.fetch): Promise<{ ok: boolean; text: string }> {
  const body = typeof request.init.body === 'string' ? request.init.body : undefined
  if (body === undefined) return { ok: false, text: 'the captured request has no string body to replay' }
  const built = buildWarmingBody(body)
  if (built.body === undefined) return { ok: false, text: built.error ?? 'the captured request cannot be replayed' }
  const init: RequestInit = { ...request.init, body: built.body }
  try {
    const response = await fetchImpl(request.input as Parameters<typeof globalThis.fetch>[0], init)
    const text = await response.text()
    if (!response.ok) return { ok: false, text: `warming replay rejected: HTTP ${String(response.status)} ${text.slice(0, 200)}` }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return { ok: true, text: 'warming replay accepted (non-JSON response)' }
    }
    const usage = readWarmingUsage(parsed)
    return { ok: true, text: usage === undefined ? 'warming replay accepted' : `warming replay accepted: ${usage}` }
  } catch (error) {
    return { ok: false, text: `warming replay failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}
