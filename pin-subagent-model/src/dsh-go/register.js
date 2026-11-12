/**
 * Register the subagent-pin panel once the dsh-go bridge is available.
 *
 * @module dsh-plugin-pin-subagent-model/dsh-go/register
 */

import { createDshGoPanel } from "./panel.js";

/**
 * @param bridgeCtx - host context that may expose `dshGo`.
 * @param options - `{hostCtx, config, stats, service}`.
 * @returns the bridge registration disposer, or undefined when no bridge is present.
 */
export function registerDshGo(bridgeCtx, options) {
	if (typeof bridgeCtx?.dshGo?.panel !== "function") return undefined;
	const { hostCtx, ...rest } = options ?? {};
	return bridgeCtx.dshGo.panel("subagent-pin", createDshGoPanel(rest));
}
