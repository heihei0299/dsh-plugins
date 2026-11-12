/**
 * dsh-go read-only panel for the subagent pin.
 *
 * The pin lives in the profile (or the WebUI configuration page); this panel
 * answers the one question the configuration page cannot: what was this process
 * actually pinned to, and what did the last delegation look like afterwards.
 *
 * @module dsh-plugin-pin-subagent-model/dsh-go/panel
 */

import { DEFAULT_PROVIDERS, readPin, supportsIndependentPreset } from "../pin.js";
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
 * Create the panel registered as `ctx.dshGo.panel('subagent-pin', ...)`.
 *
 * @param {{config: object, stats: object, service?: object}} options - the live
 *   profile config, the mount's counters, and the subagents service (for
 *   backend capability facts).
 */
export function createDshGoPanel({ config, stats, service }) {
	function readLive() {
		try {
			return { pin: readPin(config), error: "" };
		} catch (error) {
			return { pin: void 0, error: error instanceof Error ? error.message : String(error) };
		}
	}

	function backendOf(name) {
		try {
			return typeof service?.getProvider === "function" ? service.getProvider(name) : void 0;
		} catch {
			return void 0;
		}
	}

	function backendRows(locale, pin) {
		const names = pin === void 0 ? [...DEFAULT_PROVIDERS] : [...pin.providers];
		return names.map((name) => {
			const provider = backendOf(name);
			const registered = provider !== void 0 && provider !== null;
			const independent = registered && supportsIndependentPreset(provider);
			const pinned = pin !== void 0 && pin.providers.has(name);
			const subtitle = !registered
				? tr(locale, "backend.unregistered")
				: independent
					? tr(locale, "backend.preset")
					: tr(locale, "backend.inherit");
			return {
				title: name,
				subtitle: truncate(subtitle, 60),
				trailing: pinned ? "✓" : "—",
				tone: !pinned ? "neutral" : pin.preset !== void 0 && !independent ? "warn" : "good"
			};
		});
	}

	function buildData(locale) {
		const { pin, error } = readLive();
		const route = pin?.route === void 0
			? tr(locale, "stats.none")
			: `${pin.route.provider}/${pin.route.model}`;
		const last = stats.lastAt > 0
			? tr(locale, "stats.lastValue", {
				time: formatTime(stats.lastAt, locale),
				backend: stats.lastBackend,
				route: stats.lastRoute || tr(locale, "stats.none")
			})
			: tr(locale, "stats.never");
		const skipped = [...(stats.presetSkipped ?? [])];
		let notice;
		if (error) notice = tr(locale, "notice.invalid", { message: truncate(error) });
		else if (pin === void 0) notice = tr(locale, "notice.unconfigured");
		else if (pin.onConflict === "reject") notice = tr(locale, "notice.reject");
		else notice = tr(locale, "notice.ok");
		if (error === "" && skipped.length > 0) notice = `${notice} ${tr(locale, "notice.skipped", { providers: skipped.join(", ") })}`;

		return {
			configured: pin !== void 0,
			stats: [
				{ label: tr(locale, "stats.route"), value: route },
				{ label: tr(locale, "stats.preset"), value: pin?.preset ?? tr(locale, "stats.none") },
				{ label: tr(locale, "stats.effort"), value: pin?.route?.effort ?? tr(locale, "stats.none") },
				{
					label: tr(locale, "stats.providers"),
					value: pin === void 0 ? tr(locale, "stats.notConfigured") : [...pin.providers].join(", ")
				},
				{ label: tr(locale, "stats.onConflict"), value: pin?.onConflict ?? tr(locale, "stats.none") },
				{ label: tr(locale, "stats.applied"), value: String(stats.applied) },
				{ label: tr(locale, "stats.conflicts"), value: String(stats.conflicts) },
				{ label: tr(locale, "stats.last"), value: last }
			],
			backends: backendRows(locale, pin),
			notice
		};
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
			refresh(scope, event) {
				return { patch: buildData(event?.locale) };
			}
		}
	};
}
