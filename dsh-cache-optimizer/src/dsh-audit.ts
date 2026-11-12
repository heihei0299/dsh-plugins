/**
 * Prefix-stability audit for the Harness host.
 *
 * Prompt caching pays off only while the serialized request prefix stays
 * byte-identical between turns. This module keeps the last request body per
 * session, diffs it against the next one, and names the first place the prefix
 * moves — the one fact that decides whether the plugin's ordering work is worth
 * anything on this host.
 *
 * @module dsh-cache-optimizer/dsh-audit
 */

/** One request body captured from the provider seam. */
interface Sample {
  readonly body: string
  readonly at: number
}

/** First place two JSON values disagree. */
export interface Divergence {
  /** JSON path such as `messages[41].content[0].text`. */
  readonly path: string
  /** Byte offset of the divergence in the previous body. */
  readonly offset: number
  /** Short rendering of both sides, truncated for the transcript. */
  readonly previous: string
  readonly current: string
}

/** Audit result for one session. */
export interface PrefixReport {
  readonly samples: number
  readonly bytes: number
  readonly stableBytes: number
  readonly divergence?: Divergence
  readonly toolOrder: 'stable' | 'changed' | 'absent'
  readonly verdict: 'steady' | 'tail-only' | 'churn' | 'insufficient'
}

const LIMIT = 400

function render(value: unknown): string {
  if (typeof value === 'string') return value.length > LIMIT ? `${value.slice(0, LIMIT)}…` : value
  try {
    const text = JSON.stringify(value)
    return text.length > LIMIT ? `${text.slice(0, LIMIT)}…` : text
  } catch {
    return String(value)
  }
}

function commonPrefixLength(left: string, right: string): number {
  const max = Math.min(left.length, right.length)
  let index = 0
  while (index < max && left.charCodeAt(index) === right.charCodeAt(index)) index += 1
  return index
}

/**
 * Find the first structural difference between two decoded bodies.
 *
 * @param previous - earlier request body.
 * @param current - later request body.
 * @param path - path prefix used for the report.
 * @returns the divergence, or undefined when both values are equal.
 */
export function firstDivergence(previous: unknown, current: unknown, path = ''): { path: string; previous: unknown; current: unknown } | undefined {
  if (previous === current) return undefined
  if (Array.isArray(previous) && Array.isArray(current)) {
    const max = Math.min(previous.length, current.length)
    for (let index = 0; index < max; index += 1) {
      const found = firstDivergence(previous[index], current[index], `${path}[${index}]`)
      if (found !== undefined) return found
    }
    if (previous.length !== current.length) return { path: `${path}.length`, previous: previous.length, current: current.length }
    return undefined
  }
  if (typeof previous === 'object' && previous !== null && typeof current === 'object' && current !== null) {
    const left = previous as Record<string, unknown>
    const right = current as Record<string, unknown>
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    for (let index = 0; index < Math.min(leftKeys.length, rightKeys.length); index += 1) {
      if (leftKeys[index] !== rightKeys[index]) {
        return { path: path === '' ? `#key${index}` : `${path}.#key${index}`, previous: leftKeys[index], current: rightKeys[index] }
      }
    }
    for (const key of leftKeys) {
      const found = firstDivergence(left[key], right[key], path === '' ? key : `${path}.${key}`)
      if (found !== undefined) return found
    }
    return undefined
  }
  return { path: path === '' ? '(root)' : path, previous, current }
}

/** Names in a `tools` array, in wire order. */
function toolNames(body: unknown): string[] {
  const tools = (body as { tools?: unknown } | undefined)?.tools
  if (!Array.isArray(tools)) return []
  return tools.map((tool) => {
    const record = tool as { name?: unknown; function?: { name?: unknown } }
    if (typeof record?.name === 'string') return record.name
    if (typeof record?.function?.name === 'string') return record.function.name
    return '?'
  })
}

/** Collect the request bodies of one session and diff consecutive ones. */
export class PrefixAudit {
  private readonly samples = new Map<string, Sample>()
  private readonly previous = new Map<string, Sample>()

  /** Remember one more body for a session, keeping the previous one for the diff. */
  capture(sessionId: string, body: string): void {
    const latest = this.samples.get(sessionId)
    if (latest !== undefined) this.previous.set(sessionId, latest)
    this.samples.set(sessionId, { body, at: Date.now() })
  }

  /** Diff the two most recent bodies of one session, when both exist. */
  reportFor(sessionId: string): PrefixReport | undefined {
    const current = this.samples.get(sessionId)
    const previous = this.previous.get(sessionId)
    if (current === undefined) return undefined
    if (previous === undefined) {
      return { samples: 1, bytes: current.body.length, stableBytes: 0, toolOrder: 'absent', verdict: 'insufficient' }
    }
    return this.report(current.body, previous.body)
  }

  /** Sessions that have at least one captured body. */
  sessions(): string[] {
    return [...this.samples.keys()]
  }

  /** Latest captured body for a session, for replay or inspection. */
  latest(sessionId: string): Sample | undefined {
    return this.samples.get(sessionId)
  }

  /**
   * Diff the two most recent bodies of one session.
   *
   * The host keeps one body per session, so the comparison runs against the
   * previous capture recorded through {@link remember} when a caller keeps it.
   */
  report(current: string, previous: string): PrefixReport {
    const offset = commonPrefixLength(previous, current)
    let parsedPrevious: unknown
    let parsedCurrent: unknown
    try {
      parsedPrevious = JSON.parse(previous)
      parsedCurrent = JSON.parse(current)
    } catch {
      return { samples: 1, bytes: current.length, stableBytes: offset, toolOrder: 'absent', verdict: 'insufficient' }
    }
    const divergence = firstDivergence(parsedPrevious, parsedCurrent)
    const before = toolNames(parsedPrevious)
    const after = toolNames(parsedCurrent)
    const toolOrder = before.length === 0 && after.length === 0
      ? 'absent'
      : before.join('\u0000') === after.join('\u0000') ? 'stable' : 'changed'
    if (divergence === undefined) {
      return { samples: 2, bytes: current.length, stableBytes: current.length, toolOrder, verdict: 'steady' }
    }
    const messages = (parsedCurrent as { messages?: unknown[] } | undefined)?.messages
    const tailStart = Array.isArray(messages) ? Math.max(0, messages.length - 2) : 0
    const match = /^messages\[(\d+)\]/.exec(divergence.path)
    const appended = divergence.path === 'messages.length'
    const verdict = appended || (match !== null && Number(match[1]) >= tailStart) ? 'tail-only' : 'churn'
    return {
      samples: 2,
      bytes: current.length,
      stableBytes: offset,
      divergence: {
        path: divergence.path,
        offset,
        previous: render(divergence.previous),
        current: render(divergence.current),
      },
      toolOrder,
      verdict,
    }
  }
}

/** Render a report for `/cache-optimizer-prefix`. */
export function formatPrefixReport(report: PrefixReport): string {
  const share = report.bytes === 0 ? 0 : Math.round((report.stableBytes / report.bytes) * 1000) / 10
  const lines = [
    'Prefix audit',
    `• captured bodies: ${report.samples}`,
    `• stable prefix: ${report.stableBytes} / ${report.bytes} bytes (${share}%)`,
    `• tool order: ${report.toolOrder}`,
  ]
  if (report.divergence !== undefined) {
    lines.push(
      `• first divergence: ${report.divergence.path} at byte ${report.divergence.offset}`,
      `  before: ${report.divergence.previous}`,
      `  after:  ${report.divergence.current}`,
    )
  }
  lines.push(`• verdict: ${report.verdict === 'steady' ? 'byte-identical prefix' : report.verdict === 'tail-only' ? 'only the newest turn differs (expected)' : report.verdict === 'churn' ? 'unexpected churn inside the cached prefix' : 'not enough samples yet'}`)
  return lines.join('\n')
}
