/**
 * Declarative dsh-go view for the subagent-pin panel.
 *
 * Uses protocol v1 components only (stack, text, keyValue, list, callout,
 * actions) so an older App still renders the whole panel.
 *
 * @module dsh-plugin-pin-subagent-model/dsh-go/view
 */

import { tr } from "./text.js";

const STATS = { $: "data.stats" };
const BACKENDS = { $: "data.backends" };
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
			{ type: "list", items: BACKENDS },
			{ type: "callout", tone: "info", text: NOTICE },
			{
				type: "actions",
				items: [{ label: tr(locale, "action.refresh"), action: { id: "refresh" } }]
			}
		]
	};
}
