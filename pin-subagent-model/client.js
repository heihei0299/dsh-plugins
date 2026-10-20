/**
 * Browser half: show the model route a subagent session actually used, inline
 * in the composer's model row (where the native model selector sits for a
 * parent session).
 *
 * This file is a build-free DSH client loader bundle: the running DSH reads it
 * verbatim as `window.__ModuleLoader__.load({ id, factory })`, and the factory
 * may require only the host React table. Keep it plain JavaScript.
 *
 * Placement: `conversation.input.right` is an additive `list` slot that the
 * composer renders immediately before the native single-seat
 * `conversation.input.model`. A parent-session entry returns null, so the
 * native model selector stays completely untouched. This matters because a
 * `single` slot cannot be conditionally skipped: replacing the model seat and
 * returning null there would hide the native selector for parent sessions too.
 * On an addressed child the native selector renders null (it is unavailable),
 * leaving this read-only chip in the same model row.
 *
 * Data path (all read-only):
 * - `SessionSnapshot.subagent` tells a child session from an ordinary root
 *   session. Root sessions render nothing.
 * - `subagent` projection identity is the durable descriptor folded last-wins;
 *   `identity.seq` is the child's own descriptor seq after the projection's
 *   fork-seed reset. It is the boundary for request-header ownership.
 * - The Session event window supplies the child's own `request/header` events
 *   (`seq > identity.seq`). The latest one is the actual route the child sent;
 *   it is authoritative even when the `modelSelection` projection has not
 *   pushed its next frame yet. A fork seed's inherited request headers sit
 *   before the child descriptor and are ignored.
 * - `modelSelection.lastUsed` is deliberately not used: its fold also sees
 *   fork-seeded ancestor request headers, and a `turn/end` alone does not prove
 *   that the child itself sent a request. Unknown data hides the chip instead
 *   of risking a parent route.
 *
 * The chip is presentation only: no click target, no model picker, no Host
 * RPC, no navigation, and no draft/editor writes. It never falls back to the
 * parent route, the pin configuration, the descriptor's planned route, or a
 * global default.
 */

window.__ModuleLoader__.load({
	id: "dsh-plugin-pin-subagent-model",
	factory(require) {
		const React = require("react");

		/** Locale namespace for the read-only model label. */
		const NS = "pin-subagent-model";
		/** Additive composer slot rendered just before the native model seat. */
		const SLOT = "conversation.input.right";
		/** Frozen empty window used before a retained binding exposes its source. */
		const EMPTY_WINDOW = Object.freeze({
			entries: Object.freeze([]),
			hasMore: false,
			revision: 0,
			change: Object.freeze({ kind: "replace", entries: Object.freeze([]) })
		});
		/** Small inline dictionaries; the plugin card uses locale/*.json. */
		const DICTIONARIES = {
			en: { "model.label": "Subagent model" },
			zh: { "model.label": "子代理模型" }
		};

		/**
		 * Whether one value is a usable provider/model route.
		 * @param value - candidate route.
		 * @returns true when provider and model are non-empty strings.
		 */
		function isRoute(value) {
			return value !== null
				&& typeof value === "object"
				&& typeof value.provider === "string"
				&& value.provider.length > 0
				&& typeof value.model === "string"
				&& value.model.length > 0;
		}

		/**
		 * Normalize an optional reasoning effort for display.
		 * @param route - a route-like value.
		 * @returns the effort string, or undefined when absent.
		 */
		function effortOf(route) {
			return typeof route?.reasoningEffort === "string" && route.reasoningEffort.length > 0
				? route.reasoningEffort
				: undefined;
		}

		/**
		 * Compact model name for the composer row: the last path segment of the
		 * route's model id. The full route remains available in `title`, the
		 * accessible label, and data attributes.
		 * @param route - usable route.
		 * @returns the final non-empty `/` segment, or the whole model id.
		 */
		function shortModelName(route) {
			const segments = route.model.split("/").filter((segment) => segment.length > 0);
			return segments.length > 0 ? segments[segments.length - 1] : route.model;
		}

		/**
		 * Read the latest request/header after the child's own descriptor from
		 * the currently loaded Session event window.
		 * @param eventWindow - SessionEventWindow snapshot, or undefined.
		 * @param identity - `subagent` projection identity, or null/undefined.
		 * @returns the last own request config, or null when unknown.
		 */
		function lastOwnRequestHeader(eventWindow, identity) {
			if (eventWindow === undefined || eventWindow === null) return null;
			if (!Array.isArray(eventWindow.entries)) return null;
			if (identity === undefined || identity === null) return null;
			const boundary = identity.seq;
			if (typeof boundary !== "number") return null;
			let latest = null;
			let latestSeq = boundary;
			for (const entry of eventWindow.entries) {
				if (entry === null || typeof entry !== "object" || entry.type !== "event") continue;
				const event = entry.event;
				if (event === null || typeof event !== "object" || event.type !== "request/header") continue;
				if (typeof event.seq !== "number" || event.seq <= latestSeq) continue;
				const config = event.data?.header?.config;
				if (!isRoute(config)) continue;
				latest = config;
				latestSeq = event.seq;
			}
			return latest;
		}

		/**
		 * Pick the route to display, or null when the chip must render nothing.
		 * @param subagent - SessionSnapshot.subagent; null on root sessions.
		 * @param identity - `subagent` projection value.
		 * @param ownHeader - latest request/header after identity.seq, or null.
		 * @returns the actual request route, or null when unknown.
		 */
		function selectActualRoute(subagent, identity, ownHeader) {
			if (subagent === undefined || subagent === null) return null;
			if (identity === undefined || identity === null) return null;
			return isRoute(ownHeader) ? ownHeader : null;
		}

		/**
		 * Format the complete route for tooltips, accessible labels, and data
		 * attributes.
		 * @param route - usable route.
		 * @returns `provider/model`, with ` · effort` when present.
		 */
		function routeText(route) {
			const effort = effortOf(route);
			return `${route.provider}/${route.model}${effort === undefined ? "" : ` · ${effort}`}`;
		}

		/**
		 * Composer-row entry: a read-only, compact model chip on subagent
		 * sessions only. It has no click target and never calls a Host RPC, so
		 * it also works for ended and read-only child sessions. Root sessions
		 * render null and do not borrow the event source; the native model
		 * selector in the adjacent single seat is never replaced or hidden by
		 * this entry.
		 * @param props - standard Session props plus the sessions service and t.
		 * @returns the chip, or null on a root session / unknown data.
		 */
		function SubagentModelChip({ sessionId, sessions, useSession, useProjection, t }) {
			const subagent = useSession((session) => session.subagent);
			const identity = useProjection("subagent");
			const isChild = subagent !== undefined && subagent !== null;
			const source = isChild ? sessions.binding(sessionId)?.eventSource : undefined;
			const subscribe = React.useCallback((listener) => {
				if (!isChild || source === undefined) return () => {};
				return source.subscribe(listener);
			}, [isChild, source]);
			const getSnapshot = React.useCallback(
				() => (!isChild || source === undefined ? EMPTY_WINDOW : source.getSnapshot()),
				[isChild, source]
			);
			const eventWindow = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
			const route = selectActualRoute(subagent, identity, lastOwnRequestHeader(eventWindow, identity));
			if (route === null) return null;
			const fullText = routeText(route);
			const shortModel = shortModelName(route);
			const effort = effortOf(route);
			const label = typeof t === "function" ? t("model.label") : "Subagent model";
			const children = [
				React.createElement("span", {
					key: "model",
					"aria-hidden": true,
					style: {
						flex: "0 1 auto",
						minWidth: 0,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
						color: "var(--dsw-alias-label-secondary)",
						fontSize: "13px",
						lineHeight: "20px"
					}
				}, shortModel)
			];
			if (effort !== undefined) {
				children.push(React.createElement("span", {
					key: "effort",
					"aria-hidden": true,
					style: {
						flex: "none",
						color: "var(--dsw-alias-label-tertiary)",
						fontSize: "12px",
						lineHeight: "20px"
					}
				}, effort));
			}
			return React.createElement("span", {
				"data-plugin": "pin-subagent-model",
				"data-subagent-model": fullText,
				"data-subagent-model-short": shortModel,
				"data-subagent-effort": effort,
				role: "note",
				title: fullText,
				"aria-label": `${label}: ${fullText}`,
				style: {
					display: "inline-flex",
					alignItems: "center",
					gap: "4px",
					minWidth: 0,
					maxWidth: "min(220px, 50vw)",
					padding: "0 2px",
					whiteSpace: "nowrap",
					overflow: "hidden"
				}
			}, ...children);
		}

		/** Services the browser half needs before it registers. */
		const inject = ["slots", "locale", "sessions"];

		/**
		 * Register the locale dictionary and the composer-row entry.
		 * @param ctx - client root context with `slots`, `locale`, and `sessions`.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), "pin-subagent-model: composer locale");
			ctx.slots.inject(SLOT, () => ctx.slots.register({
				name: SLOT,
				id: "pin-subagent-model",
				order: 100,
				locale: NS,
				inject: () => ({ sessions: ctx.sessions })
			}, SubagentModelChip));
		}

		return {
			apply,
			inject,
			// Test seams; the client loader only consumes apply/inject.
			lastOwnRequestHeader,
			routeText,
			selectActualRoute,
			shortModelName
		};
	}
});
