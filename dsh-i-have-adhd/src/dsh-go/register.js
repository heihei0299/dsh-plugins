/**
 * Register the ADHD native panel once the dsh-go bridge is available.
 *
 * @module dsh-i-have-adhd/dsh-go/register
 */

import { createDshGoPanel } from './panel.js';

/**
 * @param bridgeCtx - host context that may expose `dshGo`.
 * @param options - `{hostCtx, enabled, includeSubagents, isSubagent, isMuted, setMuted}`.
 * @returns the bridge registration disposer, or undefined when no bridge is present.
 */
export function registerDshGo(bridgeCtx, options) {
  if (typeof bridgeCtx?.dshGo?.panel !== 'function') return undefined;
  const { hostCtx, ...rest } = options ?? {};
  const panel = createDshGoPanel({ ...rest, ctx: hostCtx ?? bridgeCtx });
  return bridgeCtx.dshGo.panel('adhd', panel);
}
