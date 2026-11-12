/**
 * dsh-go panel controller for the per-session ADHD switch.
 *
 * The live Agent is the switch's key: /adhd toggles a WeakSet entry, and the
 * panel reaches the same Agent through `ctx.agents.get(sessionId)`. When that
 * lookup fails the panel says so instead of pretending the toggle worked.
 *
 * @module dsh-i-have-adhd/dsh-go/panel
 */

import { buildView } from './view.js';
import { tr } from './text.js';

const MAX_TEXT = 160;

/**
 * Bound one string to the panel's display width.
 * @param value - raw value.
 * @param limit - maximum scalar count.
 * @returns the possibly truncated string.
 */
function truncate(value, limit = MAX_TEXT) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return [...text].length <= limit ? text : `${[...text].slice(0, Math.max(1, limit - 1)).join('')}…`;
}

/**
 * Resolve the live Agent of one panel session.
 * @param ctx - host context.
 * @param scope - bridge scope carrying `sessionId`.
 * @returns the live Agent, or undefined when the registry cannot answer.
 */
function resolveAgent(ctx, scope) {
  const sessionId = scope?.sessionId;
  if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined;
  try {
    return ctx?.agents?.get?.(sessionId);
  } catch {
    return undefined;
  }
}

/**
 * Create the panel registered as `ctx.dshGo.panel('adhd', ...)`.
 *
 * @param {object} options - host context plus the section's switch state.
 * @param {object} options.ctx - host context exposing `agents`.
 * @param {boolean} options.enabled - `enabled` from the profile entry.
 * @param {boolean} options.includeSubagents - `subagents` from the profile entry.
 * @param {(agent: object) => boolean} options.isSubagent - delegated-session test.
 * @param {(agent: object) => boolean} options.isMuted - per-Agent mute test.
 * @param {(agent: object, muted: boolean) => void} options.setMuted - per-Agent switch.
 */
export function createDshGoPanel({ ctx, enabled, includeSubagents, isSubagent, isMuted, setMuted }) {
  function stateOf(agent) {
    if (!enabled) return 'disabled';
    if (agent === undefined) return 'unknown';
    if (!includeSubagents && isSubagent(agent)) return 'child';
    return isMuted(agent) ? 'off' : 'on';
  }

  function buildData(scope, locale) {
    const agent = resolveAgent(ctx, scope);
    const state = stateOf(agent);
    const noticeKey = {
      on: 'notice.on',
      off: 'notice.off',
      child: 'notice.child',
      disabled: 'notice.disabled',
      unknown: 'notice.noAgent'
    }[state];
    return {
      state,
      stats: [
        { label: tr(locale, 'stats.plugin'), value: tr(locale, enabled ? 'stats.pluginOn' : 'stats.pluginOff') },
        { label: tr(locale, 'stats.subagents'), value: tr(locale, includeSubagents ? 'stats.subagentsOn' : 'stats.subagentsOff') },
        { label: tr(locale, 'stats.session'), value: tr(locale, `session.${state === 'disabled' ? 'unknown' : state}`) },
        { label: tr(locale, 'stats.section'), value: truncate(enabled ? 'dsh-i-have-adhd · order 50' : '—') }
      ],
      notice: tr(locale, noticeKey)
    };
  }

  function patchFor(scope, locale) {
    return { patch: buildData(scope, locale) };
  }

  function toggle(scope, event, mute) {
    const locale = event?.locale;
    if (!enabled) return { toast: truncate(tr(locale, 'toast.disabled')), ...patchFor(scope, locale) };
    const agent = resolveAgent(ctx, scope);
    if (agent === undefined) return { toast: truncate(tr(locale, 'notice.noAgent')), ...patchFor(scope, locale) };
    if (!includeSubagents && isSubagent(agent)) {
      return { toast: truncate(tr(locale, 'notice.child')), ...patchFor(scope, locale) };
    }
    setMuted(agent, mute);
    return { toast: truncate(tr(locale, mute ? 'toast.off' : 'toast.on')), ...patchFor(scope, locale) };
  }

  return {
    view(scope, caps) {
      return buildView(caps);
    },

    data(scope, emit, caps) {
      if (typeof emit === 'function') emit(buildData(scope, caps?.locale));
      return () => {};
    },

    actions: {
      on(scope, event) {
        return toggle(scope, event, false);
      },
      off(scope, event) {
        return toggle(scope, event, true);
      },
      refresh(scope, event) {
        return patchFor(scope, event?.locale);
      }
    }
  };
}
