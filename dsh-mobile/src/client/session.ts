import type { ClientContext } from './contracts.js';

/**
 * The session the main view is showing, as the host itself projects it.
 *
 * Retain and release of a new main view publish separately, so reading the
 * settled projection is the only way to avoid a transient two-session answer;
 * callers that need consistency across an asynchronous step read it again
 * afterwards instead of caching the first result.
 * @param ctx - the client context; only the sessions list is read.
 * @returns the retained main-view session id, or undefined outside a conversation.
 */
export function mainSession(ctx: ClientContext): string | undefined {
  return Object.entries(ctx.sessions.list.getSnapshot().byId)
    .find(([, row]) => (row.retainedBy.mainView ?? 0) > 0)?.[0];
}
