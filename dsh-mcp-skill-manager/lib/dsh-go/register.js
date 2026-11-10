/**
 * Register the native dsh-go panel once the bridge is available.
 *
 * @module @local/dsh-mcp-skill-manager/dsh-go/register
 */

import { createDshGoPanel } from './panel.js';

/**
 * @param {object} ctx - host context that exposes `dshGo`.
 * @param {{manager: object, store: object, logger?: object}} options
 * @returns {(() => void) | undefined} bridge registration disposer.
 */
export function registerDshGo(bridgeCtx, options) {
  if (typeof bridgeCtx?.dshGo?.panel !== 'function') return undefined;
  const { hostCtx, ...rest } = options ?? {};
  const panel = createDshGoPanel({ ...rest, ctx: hostCtx ?? bridgeCtx });
  return bridgeCtx.dshGo.panel('policy', panel);
}
