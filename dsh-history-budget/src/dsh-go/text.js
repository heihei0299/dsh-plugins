/**
 * Native-panel copy for dsh-go. The manifest carries its own locale maps; this
 * module covers the text the panel controller assembles.
 *
 * @module @local/dsh-history-budget/dsh-go/text
 */

const COPY = {
	zh: {
		"panel.description": "按编码字节裁剪 Web 客户端的会话首帧与历史页。这里只展示生效状态与本地计数，不改配置。",
		"stats.budget": "预算",
		"stats.budgetValue": "{bytes}（至少保留 {records} 条）",
		"stats.mount": "挂载",
		"stats.mounted": "已生效",
		"stats.unmounted": "未生效",
		"stats.entries": "包装入口",
		"stats.entriesValue": "follow {follow} · 历史读 {page}",
		"stats.trimmed": "裁剪次数",
		"stats.trimmedValue": "首帧 {frames} · 历史页 {pages}",
		"stats.dropped": "丢弃记录",
		"stats.droppedValue": "{records} 条",
		"stats.last": "最近一次",
		"stats.lastValue": "{time} · {bytes}",
		"stats.bypassed": "宿主自带预算",
		"stats.bypassedValue": "{count} 次原样放行",
		"stats.never": "尚无",
		"yes": "是",
		"no": "否",
		"notice.reason": "没有生效：{reason}",
		"notice.ok": "首帧与历史页都按编码字节裁剪；客户端「加载更早」仍能取回被裁掉的部分。",
		"notice.limits": "单条记录超过预算时仍会整帧发送；请求自带 maxBytes 时原样放行。",
		"action.reset": "清零计数",
		"action.refresh": "刷新",
		"toast.reset": "本地计数已清零"
	},
	en: {
		"panel.description": "Bounds the Web client's opening frame and history pages by encoded bytes. This panel only reports state and local counters; it changes no config.",
		"stats.budget": "Budget",
		"stats.budgetValue": "{bytes} (keep at least {records})",
		"stats.mount": "Mount",
		"stats.mounted": "Active",
		"stats.unmounted": "Inactive",
		"stats.entries": "Wrapped entries",
		"stats.entriesValue": "follow {follow} · history {page}",
		"stats.trimmed": "Trims",
		"stats.trimmedValue": "{frames} frames · {pages} pages",
		"stats.dropped": "Records dropped",
		"stats.droppedValue": "{records}",
		"stats.last": "Last trim",
		"stats.lastValue": "{time} · {bytes}",
		"stats.bypassed": "Host budget",
		"stats.bypassedValue": "{count} passthrough",
		"stats.never": "None yet",
		"yes": "yes",
		"no": "no",
		"notice.reason": "Not active: {reason}",
		"notice.ok": "Opening frames and history pages are bounded by encoded bytes; the client's \"load earlier\" still reaches the trimmed entries.",
		"notice.limits": "A record larger than the budget is still one oversized frame; a request carrying its own maxBytes passes through untouched.",
		"action.reset": "Reset counters",
		"action.refresh": "Refresh",
		"toast.reset": "Local counters reset"
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
