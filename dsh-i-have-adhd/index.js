/**
 * Shape DSH's user-facing replies for a reader with ADHD.
 *
 * One dynamic system-prompt section carries the ruleset (./src/rules.js);
 * the text provider returns it only for the reader's own Agent, so delegated
 * subagent reports keep their structured form. /adhd on|off|status mutes or
 * restores the section per live session; the durable switch is the profile
 * entry's enabled config.
 *
 * The section registers through systemPrompt.section, so a toggle takes
 * effect on the next model step - no restart, no page refresh. The idea and
 * name come from ayghri/i-have-adhd (MIT); the ruleset is an original rewrite.
 *
 * @module dsh-i-have-adhd
 */

import { RULES } from './src/rules.js'

export const name = 'dsh-i-have-adhd'

// The section is the whole plugin; commands only control it. A profile that
// lacks the command service still gets the style.
export const inject = ['systemPrompt']

const SECTION_NAME = 'dsh-i-have-adhd'
// Persona prefix is order 0 and plan policy is 500 in DSH's placement table.
// Output style belongs directly after the persona, before policy guidance.
const SECTION_ORDER_OFFSET = 50

/**
 * Read one boolean option, defaulting when the profile entry omits it.
 * @param value - configured value.
 * @param fallback - value used when absent.
 * @returns the effective boolean.
 */
function booleanOption(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * Whether a session is a subagent child.
 * @param agent - live agent from the prompt assembly or command invocation.
 * @returns true for delegated child sessions.
 */
function isSubagent(agent) {
  const meta = agent?.session?.meta
  return meta?.origin === 'subagent' || (meta?.delegationDepth ?? 0) > 0
}

/**
 * Apply the output style and its session switch.
 * @param ctx - plugin context; systemPrompt is required, commands optional.
 * @param config - profile entry config: { enabled?, subagents? }.
 */
export function apply(ctx, config) {
  const enabled = booleanOption(config?.enabled, true)
  const includeSubagents = booleanOption(config?.subagents, false)
  if (!enabled) return

  // Keyed by live Agent, not session id: a resumed session composes a new
  // Agent and starts from the profile default, which is the documented behavior.
  const muted = new WeakSet()

  const appliesTo = (agent) =>
    agent !== undefined && !muted.has(agent) && (includeSubagents || !isSubagent(agent))

  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: SECTION_NAME,
        order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') + SECTION_ORDER_OFFSET,
        // Dynamic text: DSH assembles prompts for diagnostics and subagents
        // too, and those callers must not inherit the reader's style.
        text: (context) => (appliesTo(context?.agent) ? RULES : ''),
      }),
    'dsh-i-have-adhd.section()',
  )

  const status = (agent) => {
    if (!includeSubagents && isSubagent(agent)) {
      return 'ADHD output mode does not apply to subagent sessions.'
    }
    if (muted.has(agent)) {
      return 'ADHD output mode is off for this session. /adhd on restores it.'
    }
    return 'ADHD output mode is on for this session. /adhd off mutes it until the session ends.'
  }

  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'adhd',
      description: 'Show or change ADHD-friendly output shaping for this session',
      input: { hint: '[on|off|status]' },
      handler: ({ agent, rawInput }) => {
        const action = rawInput.trim().toLowerCase()
        if (action === '' || action === 'status') {
          return { kind: 'success', text: status(agent) }
        }
        if (action === 'on') {
          muted.delete(agent)
          return { kind: 'success', text: 'ADHD output mode on for this session. Applies from the next reply.' }
        }
        if (action === 'off') {
          muted.add(agent)
          return { kind: 'success', text: 'ADHD output mode off for this session. Applies from the next reply.' }
        }
        return { kind: 'error', text: 'Usage: /adhd [on|off|status]' }
      },
    })
  })
}
