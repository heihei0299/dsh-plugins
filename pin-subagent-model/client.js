/**
 * Browser half: show the model route a subagent session actually used, inline
 * in the composer's model row (where the native model selector sits for a
 * parent session), and provide the plugin manager's row configuration page for
 * the pinned child route and agent preset.
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
 *
 * The configuration page is a `plugins.row.config` entry keyed by the bundle
 * package name and the `pin-subagent-model` row id. The plugin manager draws
 * the page chrome; this module renders the form over the Host ConfigForm for
 * the entry and writes volatile fields only. `provider`, `model`,
 * `reasoningEffort`, and `agentPreset` are editable; the ordinary
 * `providers` and `onConflict` fields stay in the profile patch.
 */

window.__ModuleLoader__.load({
	id: "dsh-plugin-pin-subagent-model",
	factory(require) {
		const React = require("react");

		/** Locale namespace for the read-only model label. */
		const NS = "pin-subagent-model";
		/** Additive composer slot rendered just before the native model seat. */
		const SLOT = "conversation.input.right";
		/** Plugin manager slot and key for this row's configuration page. */
		const ROW_CONFIG_SLOT = "plugins.row.config";
		const ROW_CONFIG_KEY = "dsh-plugin-pin-subagent-model#pin-subagent-model";
		/** Host entry id, which is also the ConfigForm namespace. */
		const SETTINGS_ENTRY = "pin-subagent-model";
		/** Volatile fields the configuration page edits, in render order. */
		const EDITABLE_FIELDS = ["provider", "model", "reasoningEffort", "agentPreset"];
		/** Frozen empty window used before a retained binding exposes its source. */
		const EMPTY_WINDOW = Object.freeze({
			entries: Object.freeze([]),
			hasMore: false,
			revision: 0,
			change: Object.freeze({ kind: "replace", entries: Object.freeze([]) })
		});
		/** Small inline dictionaries; the plugin card uses locale/*.json. */
		const DICTIONARIES = {
			en: {
				"model.label": "Subagent model",
				"settings.summary": "Pinned child route and agent preset",
				"settings.caption": "Every delegated child Agent uses this route and preset instead of inheriting the parent's.",
				"settings.route": "Model route",
				"settings.provider": "Provider",
				"settings.model": "Model",
				"settings.effort": "Reasoning effort",
				"settings.effort.hint": "Empty keeps the inherited or requested effort",
				"settings.preset": "Agent preset",
				"settings.preset.inherit": "Inherit the parent preset",
				"settings.preset.loading": "Loading presets…",
				"settings.preset.error": "Preset list unavailable; the current value is kept",
				"settings.preset.missing": "(not declared)",
				"settings.preset.broken": "(broken)",
				"settings.advanced": "providers and onConflict stay in the profile patch (cordis.patch.yml).",
				"settings.save": "Save",
				"settings.reset": "Discard changes",
				"settings.saving": "Saving…",
				"settings.saved": "Saved. The next delegation uses the new values.",
				"settings.unchanged": "No changes to save.",
				"settings.refused": "The Host refused the write (another editor changed the entry). Your draft is kept.",
				"settings.error": "The write failed. Your draft is kept.",
				"settings.loading": "Loading configuration…",
				"settings.unavailable": "This entry is not configurable right now. Enable the plugin row and reopen this page.",
				"settings.readonly": "This profile does not accept configuration writes.",
				"settings.invalidRoute": "Provider and model must be set together.",
				"settings.invalidPreset": "Choose a declared preset or inherit the parent preset."
			},
			zh: {
				"model.label": "子代理模型",
				"settings.summary": "子代理的固定路由与预设",
				"settings.caption": "每个被委派的子 Agent 都使用这里的路由与预设，而不是继承父会话的。",
				"settings.route": "模型路由",
				"settings.provider": "Provider",
				"settings.model": "Model",
				"settings.effort": "Reasoning effort",
				"settings.effort.hint": "留空则沿用继承或请求里的 effort",
				"settings.preset": "子代理预设",
				"settings.preset.inherit": "继承父会话预设",
				"settings.preset.loading": "正在读取预设…",
				"settings.preset.error": "预设列表不可用；保留当前值",
				"settings.preset.missing": "（未声明）",
				"settings.preset.broken": "（不可用）",
				"settings.advanced": "providers 与 onConflict 仍只在 profile patch（cordis.patch.yml）里配置。",
				"settings.save": "保存",
				"settings.reset": "放弃修改",
				"settings.saving": "保存中…",
				"settings.saved": "已保存。下一次委派即使用新值。",
				"settings.unchanged": "没有需要保存的修改。",
				"settings.refused": "Host 拒绝了写入（条目已被其他编辑器修改），草稿已保留。",
				"settings.error": "写入失败，草稿已保留。",
				"settings.loading": "正在读取配置…",
				"settings.unavailable": "当前条目不可配置。启用该插件行后重新打开此页。",
				"settings.readonly": "当前 profile 不接受配置写入。",
				"settings.invalidRoute": "Provider 与 Model 必须同时填写或同时留空。",
				"settings.invalidPreset": "请选择已声明的预设，或改为继承父会话预设。"
			}
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

		/** Form layout, kept inline: the bundle ships no stylesheet. */
		const FORM_STYLE = { display: "grid", gap: "12px", maxWidth: "640px", padding: "4px 0 8px" };
		const GROUP_STYLE = { display: "grid", gap: "10px", padding: "12px", border: "1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12))", borderRadius: "8px" };
		const LABEL_STYLE = { display: "grid", gap: "4px", fontSize: "13px", color: "var(--dsw-alias-label-secondary)" };
		const INPUT_STYLE = {
			width: "100%",
			boxSizing: "border-box",
			padding: "6px 8px",
			borderRadius: "6px",
			border: "1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12))",
			background: "var(--dsw-alias-bg-base)",
			color: "var(--dsw-alias-label-primary)",
			fontSize: "13px"
		};
		const CAPTION_STYLE = { margin: 0, fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-tertiary)" };
		const ROW_STYLE = { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" };
		const PRIMARY_BUTTON_STYLE = {
			padding: "6px 14px",
			borderRadius: "6px",
			border: "1px solid transparent",
			background: "var(--dsw-alias-button-primary-fill)",
			color: "var(--dsw-alias-label-primary-inverted)",
			fontSize: "13px",
			cursor: "pointer"
		};
		const SECONDARY_BUTTON_STYLE = {
			padding: "6px 14px",
			borderRadius: "6px",
			border: "1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12))",
			background: "transparent",
			color: "var(--dsw-alias-label-primary)",
			fontSize: "13px",
			cursor: "pointer"
		};
		/** Stand-in used when the page is rendered without a settings service. */
		const UNAVAILABLE_FORM = {
			getSnapshot: () => ({ status: "unavailable", writable: false }),
			subscribe: () => () => {},
			mutate: async () => false
		};

		/**
		 * Reduce a form value to the four editable strings.
		 * @param value - resolved config section, or undefined while loading.
		 * @returns a complete draft.
		 */
		function draftFromConfig(value) {
			const section = value !== null && typeof value === "object" ? value : {};
			const draft = {};
			for (const field of EDITABLE_FIELDS) draft[field] = typeof section[field] === "string" ? section[field] : "";
			return draft;
		}

		/**
		 * Unwrap one `agentPresets.list()` answer.
		 *
		 * Remote calls resolve to a `{ ok, value }` envelope; tests and older
		 * stubs may hand over the raw roster. A refused call is an error state,
		 * not an empty roster, so the page can tell the user why the list is
		 * missing instead of silently offering only "inherit".
		 * @param result - Remote envelope or raw roster.
		 * @returns roster state for the select.
		 */
		function rosterFromResult(result) {
			if (result !== null && typeof result === "object" && result.ok === false) {
				return { status: "error", presets: [] };
			}
			const value = result !== null && typeof result === "object" && result.ok === true ? result.value : result;
			return { status: "ready", presets: Array.isArray(value?.presets) ? value.presets : [] };
		}

		/**
		 * Build the preset choices: inherit, every declared preset, and the
		 * current value when it is no longer declared.
		 * @param roster - `agentPresets.list()` rows, or undefined.
		 * @param current - value the draft currently holds.
		 * @returns ordered choices.
		 */
		function presetOptions(roster, current) {
			const options = [{ id: "", label: undefined, missing: false, broken: false }];
			const seen = new Set();
			for (const row of Array.isArray(roster) ? roster : []) {
				if (row === null || typeof row !== "object" || typeof row.id !== "string" || row.id.length === 0 || seen.has(row.id)) continue;
				seen.add(row.id);
				options.push({
					id: row.id,
					label: typeof row.name === "string" && row.name.length > 0 ? row.name : undefined,
					missing: false,
					broken: typeof row.broken === "string" && row.broken.length > 0
				});
			}
			if (typeof current === "string" && current.length > 0 && !seen.has(current)) options.push({ id: current, label: undefined, missing: true, broken: false });
			return options;
		}

		/**
		 * Validate one draft before it reaches the Host.
		 * @param draft - edited values.
		 * @param options - preset choices this page could offer.
		 * @returns a locale key, or null when the draft is submittable.
		 */
		function validateDraft(draft, options) {
			const provider = draft.provider.trim();
			const model = draft.model.trim();
			if ((provider.length === 0) !== (model.length === 0)) return "settings.invalidRoute";
			if (draft.agentPreset.length > 0 && !options.some((option) => option.id === draft.agentPreset)) return "settings.invalidPreset";
			return null;
		}

		/**
		 * Build the ordered ConfigForm operations for the changed fields.
		 * Clearing a field unsets it, so the schema default resolves again.
		 * @param draft - edited values.
		 * @param accepted - last accepted values.
		 * @returns operations; empty when nothing changed.
		 */
		function buildOps(draft, accepted) {
			const ops = [];
			for (const field of EDITABLE_FIELDS) {
				const next = draft[field];
				if (next === accepted[field]) continue;
				ops.push(next.length === 0 ? { op: "unset", path: [field] } : { op: "set", path: [field], value: next });
			}
			return ops;
		}

		/**
		 * Label one preset choice.
		 * @param option - a `presetOptions` row.
		 * @param t - locale lookup.
		 * @returns display text.
		 */
		function presetLabel(option, t) {
			if (option.id === "") return t("settings.preset.inherit");
			const base = option.label === undefined ? option.id : option.label;
			return base + (option.missing ? ` ${t("settings.preset.missing")}` : "") + (option.broken ? ` ${t("settings.preset.broken")}` : "");
		}

		/**
		 * Row configuration entry: a static one-liner for the summary view and
		 * the editable form for the page view.
		 * @param props - slot owner props plus the injected form face and `t`.
		 * @returns summary text or the form element.
		 */
		function RowConfigEntry(props) {
			return props.view === "summary"
				? props.t("settings.summary")
				: React.createElement(RowConfigPage, props);
		}

		/**
		 * Edit the volatile pin fields over the Host ConfigForm.
		 *
		 * `provider`/`model`/`reasoningEffort`/`agentPreset` are volatile, so a
		 * save commits into the running Host references and the next delegation
		 * uses the new values. The page never writes `providers`/`onConflict`.
		 * @param props - `t`, the injected ConfigForm, and the preset loader.
		 * @returns the form surface.
		 */
		function RowConfigPage({ t, configForm, listPresets }) {
			const form = configForm === undefined ? UNAVAILABLE_FORM : configForm;
			const snapshot = React.useSyncExternalStore(
				React.useCallback((listener) => form.subscribe(listener), [form]),
				React.useCallback(() => form.getSnapshot(), [form]),
				React.useCallback(() => form.getSnapshot(), [form])
			);
			const accepted = React.useMemo(() => draftFromConfig(snapshot.value), [snapshot]);
			const [draft, setDraft] = React.useState(accepted);
			const [dirty, setDirty] = React.useState(false);
			const [status, setStatus] = React.useState(null);
			const [roster, setRoster] = React.useState({ status: "loading", presets: [] });
			// Keep the value and revision the draft was based on together. A later
			// Host snapshot must not silently rebase an already edited draft.
			const baseline = React.useRef({ value: accepted, revision: snapshot.revision });
			const saving = React.useRef(false);
			React.useEffect(() => {
				if (dirty || snapshot.status !== "ready" || snapshot.revision === undefined
					|| baseline.current.revision === snapshot.revision) return;
				baseline.current = { value: accepted, revision: snapshot.revision };
				setDraft(accepted);
			}, [accepted, dirty, snapshot.status, snapshot.revision]);
			React.useEffect(() => {
				let cancelled = false;
				let pending;
				try {
					pending = listPresets();
				} catch {
					setRoster({ status: "error", presets: [] });
					return undefined;
				}
				Promise.resolve(pending).then((result) => {
					if (!cancelled) setRoster(rosterFromResult(result));
				}, () => {
					if (!cancelled) setRoster({ status: "error", presets: [] });
				});
				return () => {
					cancelled = true;
				};
			}, [listPresets]);
			const options = presetOptions(roster.presets, draft.agentPreset);
			const writable = snapshot.status === "ready" && snapshot.writable === true && snapshot.revision !== undefined;
			const busy = status !== null && status.kind === "saving";
			const disabled = !writable || busy;
			function edit(field, value) {
				setDraft((current) => ({ ...current, [field]: value }));
				setDirty(true);
				setStatus(null);
			}
			function reset() {
				baseline.current = { value: accepted, revision: snapshot.revision };
				setDraft(accepted);
				setDirty(false);
				setStatus(null);
			}
			async function save() {
				if (!writable || saving.current || baseline.current.revision === undefined) return;
				const problem = validateDraft(draft, options);
				if (problem !== null) {
					setStatus({ kind: "invalid", key: problem });
					return;
				}
				const ops = buildOps(draft, baseline.current.value);
				if (ops.length === 0) {
					setStatus({ kind: "unchanged" });
					return;
				}
				saving.current = true;
				setStatus({ kind: "saving" });
				try {
					const acceptedWrite = await form.mutate(ops, baseline.current.revision);
					if (acceptedWrite) {
						// ConfigForm normally publishes the accepted snapshot before it
						// resolves. If another queued write superseded it, keep the old
						// fence rather than inventing a revision for the next edit.
						const current = form.getSnapshot();
						if (current.status === "ready" && current.revision !== undefined
							&& current.revision !== baseline.current.revision) {
							const value = draftFromConfig(current.value);
							baseline.current = { value, revision: current.revision };
							setDraft(value);
						}
						setDirty(false);
						setStatus({ kind: "saved" });
					} else setStatus({ kind: "refused" });
				} catch {
					setStatus({ kind: "error" });
				} finally {
					saving.current = false;
				}
			}
			if (snapshot.status !== "ready") {
				return React.createElement("p", { style: CAPTION_STYLE, role: "status" },
					t(snapshot.status === "loading" ? "settings.loading" : "settings.unavailable"));
			}
			const message = (() => {
				if (status === null) return !writable ? t("settings.readonly") : null;
				if (status.kind === "invalid") return t(status.key);
				if (status.kind === "saving") return t("settings.saving");
				if (status.kind === "saved") return t("settings.saved");
				if (status.kind === "unchanged") return t("settings.unchanged");
				if (status.kind === "refused") return t("settings.refused");
				return t("settings.error");
			})();
			const field = (name, label, hint, placeholder) => React.createElement("label", { key: name, style: LABEL_STYLE },
				React.createElement("span", null, label),
				React.createElement("input", {
					type: "text",
					value: draft[name],
					placeholder,
					disabled,
					"data-field": name,
					style: INPUT_STYLE,
					onChange: (event) => edit(name, event.currentTarget.value)
				}),
				hint === undefined ? null : React.createElement("span", { style: CAPTION_STYLE }, hint)
			);
			return React.createElement("div", { style: FORM_STYLE, "data-plugin": "pin-subagent-model", "data-settings": "row" },
				React.createElement("p", { style: CAPTION_STYLE }, t("settings.caption")),
				React.createElement("div", { style: GROUP_STYLE },
					React.createElement("strong", { style: { fontSize: "13px", color: "var(--dsw-alias-label-primary)" } }, t("settings.route")),
					field("provider", t("settings.provider"), undefined, "cpa"),
					field("model", t("settings.model"), undefined, "cline-pass/deepseek-v4.1-flash"),
					field("reasoningEffort", t("settings.effort"), t("settings.effort.hint"), "max")
				),
				React.createElement("div", { style: GROUP_STYLE },
					React.createElement("label", { style: LABEL_STYLE },
						React.createElement("span", null, t("settings.preset")),
						React.createElement("select", {
							value: draft.agentPreset,
							disabled: disabled || roster.status !== "ready",
							"data-field": "agentPreset",
							style: INPUT_STYLE,
							onChange: (event) => edit("agentPreset", event.currentTarget.value)
						}, ...options.map((option) => React.createElement("option", { key: option.id, value: option.id, disabled: option.broken }, presetLabel(option, t))))
					),
					roster.status === "loading" ? React.createElement("span", { style: CAPTION_STYLE }, t("settings.preset.loading")) : null,
					roster.status === "error" ? React.createElement("span", { style: CAPTION_STYLE, role: "status" }, t("settings.preset.error")) : null
				),
				React.createElement("p", { style: CAPTION_STYLE }, t("settings.advanced")),
				React.createElement("div", { style: ROW_STYLE },
					React.createElement("button", {
						type: "button",
						style: PRIMARY_BUTTON_STYLE,
						disabled: disabled || !dirty,
						onClick: () => { void save(); }
					}, t("settings.save")),
					React.createElement("button", {
						type: "button",
						style: SECONDARY_BUTTON_STYLE,
						disabled: disabled || !dirty,
						onClick: reset
					}, t("settings.reset"))
				),
				message === null ? null : React.createElement("p", { style: CAPTION_STYLE, role: "status", "data-status": status === null ? "readonly" : status.kind }, message)
			);
		}

		/** Services the browser half needs before it registers. */
		const inject = ["slots", "locale", "sessions", "configForms", "remote", "remote.agentPresets"];

		/**
		 * Register the locale dictionary, the composer-row entry, and the
		 * plugin-page configuration page.
		 * @param ctx - client root context with slots, locale, sessions, settings and preset services.
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
			const configForm = ctx.configForms.get(SETTINGS_ENTRY);
			ctx.slots.inject(ROW_CONFIG_SLOT, () => ctx.slots.register({
				name: ROW_CONFIG_SLOT,
				key: ROW_CONFIG_KEY,
				locale: NS,
				inject: () => ({
					configForm,
					listPresets: () => ctx.remote.agentPresets.list()
				})
			}, RowConfigEntry));
		}

		return {
			apply,
			inject,
			// Test seams; the client loader only consumes apply/inject.
			buildOps,
			draftFromConfig,
			lastOwnRequestHeader,
			presetLabel,
			presetOptions,
			rosterFromResult,
			routeText,
			selectActualRoute,
			shortModelName,
			validateDraft
		};
	}
});
