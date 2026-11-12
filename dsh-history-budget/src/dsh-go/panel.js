/**
 * dsh-go status panel for the history byte budget.
 *
 * The wrapper owns the counters; this controller only renders them and says why
 * the budget may not be active. Nothing here changes configuration: the budget
 * comes from the profile entry, so the panel stays read-only except for a local
 * counter reset.
 *
 * @module @local/dsh-history-budget/dsh-go/panel
 */

import { buildView } from "./view.js";
import { tr } from "./text.js";

const MAX_TEXT = 160;

/**
 * Bound one string to the panel's display width.
 * @param value - raw value.
 * @param limit - maximum scalar count.
 * @returns the possibly truncated string.
 */
function truncate(value, limit = MAX_TEXT) {
	const text = typeof value === "string" ? value : String(value ?? "");
	return [...text].length <= limit ? text : `${[...text].slice(0, Math.max(1, limit - 1)).join("")}…`;
}

/**
 * Format one byte count for display.
 * @param bytes - encoded bytes.
 * @returns a short human-readable size.
 */
export function formatBytes(bytes) {
	if (!Number.isFinite(bytes) || bytes < 0) return "—";
	if (bytes < 1024) return `${String(bytes)} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * Format one epoch timestamp as a short clock time.
 * @param epoch - milliseconds since the epoch; 0 means "never".
 * @param locale - current app locale.
 * @returns the clock time, or the localized "never" copy.
 */
function formatTime(epoch, locale) {
	if (!Number.isFinite(epoch) || epoch <= 0) return tr(locale, "stats.never");
	const date = new Date(epoch);
	const pad = (value) => String(value).padStart(2, "0");
	return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Create the panel registered as `ctx.dshGo.panel('history-budget', ...)`.
 *
 * @param {{status: object}} options - the live mount status owned by apply().
 */
export function createDshGoPanel({ status }) {
	function buildData(locale) {
		const yes = tr(locale, "yes");
		const no = tr(locale, "no");
		const historyBound = status.eventsBound || status.pageBound;
		const notice = status.mounted
			? tr(locale, "notice.ok")
			: tr(locale, "notice.reason", { reason: truncate(status.reason || no) });
		return {
			mounted: status.mounted,
			stats: [
				{
					label: tr(locale, "stats.budget"),
					value: tr(locale, "stats.budgetValue", {
						bytes: formatBytes(status.maxBytes),
						records: String(status.minRecords)
					})
				},
				{
					label: tr(locale, "stats.mount"),
					value: status.mounted ? tr(locale, "stats.mounted") : tr(locale, "stats.unmounted")
				},
				{
					label: tr(locale, "stats.entries"),
					value: tr(locale, "stats.entriesValue", {
						follow: status.followBound ? yes : no,
						page: historyBound ? yes : no
					})
				},
				{
					label: tr(locale, "stats.trimmed"),
					value: tr(locale, "stats.trimmedValue", {
						frames: String(status.openingTrims),
						pages: String(status.pageTrims)
					})
				},
				{
					label: tr(locale, "stats.dropped"),
					value: tr(locale, "stats.droppedValue", { records: String(status.recordsDropped) })
				},
				{
					label: tr(locale, "stats.last"),
					value: tr(locale, "stats.lastValue", {
						time: formatTime(status.lastAt, locale),
						bytes: formatBytes(status.lastBytes)
					})
				},
				{
					label: tr(locale, "stats.bypassed"),
					value: tr(locale, "stats.bypassedValue", { count: String(status.bypassed) })
				}
			],
			notice
		};
	}

	function patchFor(locale) {
		return { patch: buildData(locale) };
	}

	return {
		view(scope, caps) {
			return buildView(caps);
		},

		data(scope, emit, caps) {
			if (typeof emit === "function") emit(buildData(caps?.locale));
			return () => {};
		},

		actions: {
			reset(scope, event) {
				status.openingTrims = 0;
				status.pageTrims = 0;
				status.recordsDropped = 0;
				status.bypassed = 0;
				status.lastAt = 0;
				status.lastBytes = 0;
				return { toast: truncate(tr(event?.locale, "toast.reset")), ...patchFor(event?.locale) };
			},
			refresh(scope, event) {
				return patchFor(event?.locale);
			}
		}
	};
}
