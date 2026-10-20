/**
 * Pure count helpers for the collapsed header status badges.
 *
 * Stage 1 keeps every rule outside React so the numbers can be tested without a
 * DOM: which subagents count, which jobs count as live, and how a badge renders
 * a count that would otherwise widen the header.
 */

/** Terminal job states: nothing is running any more. */
const TERMINAL_JOB_STATUS = new Set(['completed', 'killed', 'failed']);

/** A count plus whether anything inside it is still running. */
export interface BadgeCount {
  /** Rows the badge reports. */
  readonly total: number;
  /** Whether at least one row is currently running. */
  readonly live: boolean;
}

export const NO_ROWS: BadgeCount = Object.freeze({ total: 0, live: false });

/** Numbers at or above this collapse to a `9+` style label. */
export const COUNT_CAP = 9;

/** One projected subagent catalog row, as the host client materializes it. */
export interface SubagentRow {
  readonly id: string;
  readonly label?: string;
  /** Runtime state resolved from the session list by the caller. */
  readonly running?: boolean;
}

/** One background job roster row. */
export interface JobRow {
  readonly id: string;
  readonly label?: string;
  readonly status: string;
}

/** The parts of a session list snapshot the badges read. */
export interface SessionFacts {
  readonly byId?: Readonly<Record<string, { readonly running?: boolean; readonly origin?: string } | undefined>>;
  readonly projectionsBySession?: Readonly<Record<string, {
    readonly values: { readonly subagentCatalog?: readonly { readonly id: string; readonly label?: string }[] };
  } | undefined>>;
}

/**
 * Count a root session's direct subagent children.
 *
 * A subagent's own session shows no badge, matching the host's own header
 * action, which returns nothing for `origin === 'subagent'`.
 * @param snapshot - the session list snapshot.
 * @param sessionId - the session the header belongs to.
 * @returns total children and whether any of them is running.
 */
export function subagentCounts(snapshot: SessionFacts, sessionId: string | undefined): BadgeCount {
  if (sessionId === undefined) return NO_ROWS;
  if (snapshot.byId?.[sessionId]?.origin === 'subagent') return NO_ROWS;
  const rows = snapshot.projectionsBySession?.[sessionId]?.values.subagentCatalog;
  if (!Array.isArray(rows) || rows.length === 0) return NO_ROWS;
  return { total: rows.length, live: rows.some(row => snapshot.byId?.[row.id]?.running === true) };
}

/**
 * Count one session's visible background jobs.
 * @param rows - the roster rows for that session, or undefined when unwatched.
 * @returns total jobs and whether any is still running or stopping.
 */
export function jobCounts(rows: readonly JobRow[] | undefined): BadgeCount {
  if (!Array.isArray(rows) || rows.length === 0) return NO_ROWS;
  return { total: rows.length, live: rows.some(row => !TERMINAL_JOB_STATUS.has(row.status)) };
}

/**
 * Render a count inside a fixed-width badge: `9+` from ten items upward, so the
 * header never reflows because a session accumulated one more child.
 * @param total - the counted rows.
 * @returns the label text.
 */
export function formatCount(total: number): string {
  if (!Number.isFinite(total) || total <= 0) return '0';
  return total > COUNT_CAP ? `${COUNT_CAP}+` : String(Math.trunc(total));
}
