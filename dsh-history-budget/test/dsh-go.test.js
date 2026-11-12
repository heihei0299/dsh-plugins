/**
 * dsh-go adaptation for the history byte budget: the manifest stays inside the
 * bridge grammar, the panel reports the live mount state and counters, and a
 * missing bridge is a no-op rather than a failed mount.
 *
 * Run with: node --test test/
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { apply } from "../index.js";
import { createDshGoPanel, formatBytes } from "../src/dsh-go/panel.js";
import { buildView } from "../src/dsh-go/view.js";
import { registerDshGo } from "../src/dsh-go/register.js";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/;
const textLength = (value) => [...String(value)].length;
const localeLength = (value) => Math.max(...Object.values(value).map(textLength));

function statusOf(overrides = {}) {
	return {
		maxBytes: 512 * 1024,
		minRecords: 1,
		mounted: true,
		reason: "",
		followBound: true,
		eventsBound: true,
		pageBound: false,
		openingTrims: 2,
		pageTrims: 1,
		recordsDropped: 7,
		bypassed: 0,
		lastAt: Date.UTC(2026, 0, 2, 3, 4, 5),
		lastBytes: 480 * 1024,
		...overrides
	};
}

function record(seq, size = 120) {
	return { type: "event", event: { type: "tool/result", seq, time: seq, data: { text: "x".repeat(size) } } };
}

test("manifest uses protocol v1 and references its own panel", () => {
	const manifest = pkg.dshGo;
	assert.equal(manifest.v, 1);
	assert.ok(localeLength(manifest.title) <= 24);
	const panels = manifest.contributes.panels;
	assert.equal(panels.length, 1);
	assert.equal(panels[0].id, "history-budget");
	assert.deepEqual(panels[0].placement, ["session.tab", "features"]);
	assert.ok(localeLength(panels[0].title) <= 16);
	const [action] = manifest.contributes["composer.actions"];
	assert.equal(action.effect.type, "open");
	assert.equal(action.effect.page, "panel:history-budget");
	for (const rows of Object.values(manifest.contributes)) {
		for (const row of rows) assert.match(row.id, ID);
	}
	assert.ok(Buffer.byteLength(JSON.stringify(manifest), "utf8") < 16 * 1024);
});

test("the view is protocol v1 and the copy is localized", () => {
	const zh = buildView({ locale: "zh-CN" });
	const en = buildView({ locale: "en-US" });
	assert.equal(zh.v, 1);
	assert.equal(zh.type, "stack");
	assert.ok(zh.children.some((node) => node.type === "keyValue"));
	assert.ok(zh.children.some((node) => node.type === "actions"));
	assert.notDeepEqual(zh, en);
});

test("the panel reports mount state, counters, and a reset action", () => {
	const panel = createDshGoPanel({ status: statusOf() });
	const emitted = [];
	panel.data({ sessionId: "s1" }, (data) => emitted.push(data), { locale: "zh-CN" });
	const data = emitted.at(-1);
	assert.equal(data.mounted, true);
	assert.ok(data.stats.some((row) => row.value.includes("2")));
	assert.ok(data.stats.some((row) => row.value.includes("512.0 KiB")));
	assert.equal(formatBytes(1536), "1.5 KiB");

	const reset = panel.actions.reset({ sessionId: "s1" }, { locale: "zh-CN" });
	assert.match(reset.toast, /清零/);
	assert.equal(reset.patch.stats[3].value, "首帧 0 · 历史页 0");
	assert.equal(reset.patch.stats[4].value, "0 条");
});

test("an unmounted budget explains itself instead of showing success", () => {
	const panel = createDshGoPanel({ status: statusOf({ mounted: false, reason: "sessionController.follow unavailable" }) });
	const patch = panel.actions.refresh({ sessionId: "s1" }, { locale: "zh-CN" });
	assert.match(patch.patch.notice, /没有生效/);
	assert.match(patch.patch.notice, /follow unavailable/);
});

test("registerDshGo is a no-op without the bridge and registers the panel id with it", () => {
	assert.equal(registerDshGo({}, { status: statusOf() }), undefined);
	const calls = [];
	const bridge = { dshGo: { panel(id, controller) { calls.push([id, controller]); return () => {}; } } };
	const dispose = registerDshGo(bridge, { status: statusOf() });
	assert.equal(calls[0][0], "history-budget");
	assert.equal(calls[0][1].view({ locale: "zh-CN" }).v, 1);
	assert.equal(typeof dispose, "function");
});

test("apply registers the panel and counts the trims the wrapper performs", async () => {
	const proto = {
		async *follow() {
			yield { type: "snapshot", cursor: 4, hasMore: false, records: [record(1), record(2), record(3), record(4)] };
		},
		async page() {
			return { records: [], hasMore: false };
		}
	};
	const service = Object.create(proto);
	const disposers = [];
	let controller;
	const ctx = {
		sessionController: service,
		logger: { warn() {}, info() {} },
		effect: (callback) => {
			disposers.push(callback());
		},
		inject: (names, callback) => {
			if (!names.includes("dshGo")) return;
			callback({ dshGo: { panel(id, value) { controller = value; return () => {}; } } });
		}
	};

	apply(ctx, { maxBytes: 400 });
	const emitted = [];
	controller.data({ sessionId: "s1" }, (data) => emitted.push(data), { locale: "zh-CN" });
	assert.equal(emitted.at(-1).mounted, true);

	const frames = [];
	for await (const frame of service.follow({}, undefined)) frames.push(frame);
	assert.ok(frames[0].records.length < 4, "the wrapper must trim the opening frame");

	const after = controller.actions.refresh({ sessionId: "s1" }, { locale: "zh-CN" }).patch;
	assert.match(after.stats[3].value, /首帧 1/);
	assert.match(after.stats[4].value, /[1-9]/);

	disposers.reverse().forEach((dispose) => dispose?.());
	const unmounted = controller.actions.refresh({ sessionId: "s1" }, { locale: "zh-CN" }).patch;
	assert.equal(unmounted.mounted, false);
	assert.match(unmounted.notice, /没有生效/);
});
