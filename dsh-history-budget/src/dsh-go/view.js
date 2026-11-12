/**
 * Declarative dsh-go view for the history-budget status panel. The app renders;
 * this module only builds bounded JSON from the controller's data object.
 *
 * Uses protocol v1 components only (stack, text, keyValue, callout, actions).
 *
 * @module @local/dsh-history-budget/dsh-go/view
 */

import { tr } from "./text.js";

const STATS = { $: "data.stats" };
const NOTICE = { $: "data.notice" };

/**
 * Build the panel view.
 * @param {{locale?: string}} [caps] - app capabilities; only the locale is used.
 * @returns the v1 view tree.
 */
export function buildView(caps = {}) {
	const locale = caps.locale;
	return {
		v: 1,
		type: "stack",
		children: [
			{ type: "text", text: tr(locale, "panel.description") },
			{ type: "keyValue", items: STATS },
			{ type: "divider" },
			{ type: "callout", tone: "info", text: NOTICE },
			{
				type: "actions",
				items: [
					{ label: tr(locale, "action.reset"), action: { id: "reset" } },
					{ label: tr(locale, "action.refresh"), action: { id: "refresh" } }
				]
			}
		]
	};
}
