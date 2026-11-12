/**
 * Native-panel copy for dsh-go. The manifest carries its own locale maps; this
 * module covers the text the panel controller assembles.
 *
 * @module dsh-plugin-pin-subagent-model/dsh-go/text
 */

const COPY = {
	zh: {
		"panel.description": "只读展示当前 profile 固定给子代理的路由与预设，以及本进程最近一次改写。配置仍由 profile 或 WebUI 配置页修改。",
		"stats.route": "固定路由",
		"stats.preset": "固定预设",
		"stats.effort": "推理强度",
		"stats.providers": "生效后端",
		"stats.onConflict": "冲突处理",
		"stats.applied": "改写次数",
		"stats.conflicts": "冲突改写",
		"stats.last": "最近一次",
		"stats.lastValue": "{time} · {backend} → {route}",
		"stats.lastPresetValue": "{time} · {backend} → 预设 {preset}",
		"stats.never": "尚未发生",
		"stats.none": "未设置",
		"stats.notConfigured": "未配置",
		"backend.preset": "支持独立预设",
		"backend.inherit": "继承父预设",
		"backend.unregistered": "后端未注册",
		"notice.unconfigured": "没有配置 provider/model 或 agentPreset，子代理继续继承父 Agent 的路由与预设。",
		"notice.reject": "onConflict 为 reject：委派显式请求其它路由或预设时会直接报错，而不是改写。",
		"notice.ok": "委派进入这些后端时，子代理会被改写到上面固定的路由与预设。",
		"notice.invalid": "配置无效：{message}",
		"notice.skipped": "这些后端无法选择独立预设，保持继承父预设：{providers}",
		"action.refresh": "刷新"
	},
	en: {
		"panel.description": "Read-only view of the route and preset this profile pins for child Agents, plus the most recent rewrite in this process. Change configuration in the profile or the WebUI configuration page.",
		"stats.route": "Pinned route",
		"stats.preset": "Pinned preset",
		"stats.effort": "Reasoning effort",
		"stats.providers": "Backends",
		"stats.onConflict": "On conflict",
		"stats.applied": "Rewrites",
		"stats.conflicts": "Conflicts",
		"stats.last": "Last rewrite",
		"stats.lastValue": "{time} · {backend} → {route}",
		"stats.lastPresetValue": "{time} · {backend} → preset {preset}",
		"stats.never": "None yet",
		"stats.none": "Not set",
		"stats.notConfigured": "Not configured",
		"backend.preset": "Independent preset",
		"backend.inherit": "Inherits parent preset",
		"backend.unregistered": "Backend not registered",
		"notice.unconfigured": "No provider/model or agentPreset is configured, so child Agents keep inheriting the parent's route and preset.",
		"notice.reject": "onConflict is reject: a delegation that explicitly requests another route or preset throws instead of being rewritten.",
		"notice.ok": "Delegations into these backends are rewritten to the pinned route and preset above.",
		"notice.invalid": "Invalid configuration: {message}",
		"notice.skipped": "These backends cannot select an independent preset and keep inheriting the parent's: {providers}",
		"action.refresh": "Refresh"
	}
};

/**
 * Resolve the copy table for a BCP-47-ish locale.
 * @param locale - current app locale.
 * @returns the zh or en table.
 */
export function copyFor(locale) {
	return typeof locale === "string" && locale.toLowerCase().startsWith("en") ? COPY.en : COPY.zh;
}

/**
 * Translate one key and interpolate `{name}` placeholders.
 * @param locale - current app locale.
 * @param key - copy key.
 * @param values - interpolation values.
 * @returns the rendered string, or the key when unknown.
 */
export function tr(locale, key, values) {
	const table = copyFor(locale);
	let text = table[key] ?? COPY.en[key] ?? key;
	if (values && typeof values === "object") {
		for (const [name, value] of Object.entries(values)) {
			text = text.split(`{${name}}`).join(String(value));
		}
	}
	return text;
}
