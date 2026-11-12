/**
 * Register the history-budget status panel once the dsh-go bridge is available.
 *
 * @module @local/dsh-history-budget/dsh-go/register
 */

import { createDshGoPanel } from "./panel.js";

/**
 * @param bridgeCtx - host context that may expose `dshGo`.
 * @param options - `{hostCtx, status}`.
 * @returns the bridge registration disposer, or undefined when no bridge is present.
 */
export function registerDshGo(bridgeCtx, options) {
	if (typeof bridgeCtx?.dshGo?.panel !== "function") return undefined;
	const { hostCtx, ...rest } = options ?? {};
	return bridgeCtx.dshGo.panel("history-budget", createDshGoPanel(rest));
}
