/**
 * dsh-go adaptation for the subagent pin: the manifest stays inside the bridge
 * grammar, the panel is read-only and reports the live pin plus the last
 * rewrite, and mounting never depends on the bridge being present.
 *
 * Run with: node --test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import plugin from "../index.js";
import { createDshGoPanel } from "../src/dsh-go/panel.js";
import { buildView } from "../src/dsh-go/view.js";
import { registerDshGo } from "../src/dsh-go/register.js";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/;
const textLength = (value) => [...String(value)].length;
const localeLength = (value) => Math.max(...Object.values(value).map(textLength));

function statsOf(overrides = {}) {
	return {
		applied: 3,
		conflicts: 1,
		lastAt: Date.UTC(2026, 0, 2, 3, 4, 5),
		lastBackend: "spawn",
		lastRoute: "cpa/pinned-model",
		lastPreset: "review",
		presetSkipped: new Set(["fork"]),
		...overrides
	};
}

const capableService = {
	getProvider(name) {
		return name === "spawn"
			? { capabilities: { agentPreset: true }, inheritsParentContext: false }
			: { capabilities: { agentPreset: false }, inheritsParentContext: true };
	}
};

test("manifest uses protocol v1 and references its own panel", () => {
	const manifest = pkg.dshGo;
	assert.equal(manifest.v, 1);
	assert.ok(localeLength(manifest.title) <= 24);
	const [panel] = manifest.contributes.panels;
	assert.equal(panel.id, "subagent-pin");
	assert.deepEqual(panel.placement, ["session.tab", "features"]);
	assert.ok(localeLength(panel.title) <= 16);
	const [action] = manifest.contributes["composer.actions"];
	assert.equal(action.effect.page, "panel:subagent-pin");
	for (const rows of Object.values(manifest.contributes)) {
		for (const row of rows) assert.match(row.id, ID);
	}
	assert.ok(Buffer.byteLength(JSON.stringify(manifest), "utf8") < 16 * 1024);
});

test("the view is protocol v1 and localized", () => {
	const zh = buildView({ locale: "zh-CN" });
	assert.equal(zh.v, 1);
	assert.ok(zh.children.some((node) => node.type === "list"));
	assert.notDeepEqual(zh, buildView({ locale: "en-US" }));
});

test("the panel reports the live pin, backend capability, and last rewrite", () => {
	const panel = createDshGoPanel({
		config: { provider: "cpa", model: "pinned-model", agentPreset: "review", providers: ["spawn", "fork"], onConflict: "reject" },
		stats: statsOf(),
		service: capableService
	});
	const patch = panel.actions.refresh({ sessionId: "s1" }, { locale: "zh-CN" }).patch;
	const row = (label) => patch.stats.find((item) => item.label === label)?.value;
	assert.equal(row("固定路由"), "cpa/pinned-model");
	assert.equal(row("固定预设"), "review");
	assert.equal(row("生效后端"), "spawn, fork");
	assert.equal(row("冲突改写"), "1");
	assert.match(row("最近一次"), /spawn → cpa\/pinned-model/);
	assert.equal(patch.backends[0].tone, "good");
	assert.equal(patch.backends[1].tone, "warn");
	assert.match(patch.notice, /reject/);
	assert.match(patch.notice, /fork/);
});

test("an unconfigured profile says so instead of implying a pin", () => {
	const panel = createDshGoPanel({ config: {}, stats: statsOf({ applied: 0, lastAt: 0 }), service: capableService });
	const data = panel.actions.refresh({ sessionId: "s1" }, { locale: "zh-CN" }).patch;
	assert.equal(data.configured, false);
	assert.match(data.notice, /没有配置/);
	assert.deepEqual(data.backends.map((item) => item.trailing), ["—", "—"]);
});

test("an invalid live config is reported, not thrown", () => {
	const panel = createDshGoPanel({ config: { onConflict: "maybe" }, stats: statsOf(), service: capableService });
	const data = panel.actions.refresh({ sessionId: "s1" }, { locale: "zh-CN" }).patch;
	assert.match(data.notice, /配置无效/);
});

test("registerDshGo is a no-op without the bridge and registers the panel id with it", () => {
	assert.equal(registerDshGo({}, {}), undefined);
	const calls = [];
	const bridge = { dshGo: { panel(id, controller) { calls.push([id, controller]); return () => {}; } } };
	const dispose = registerDshGo(bridge, { config: { provider: "cpa", model: "m" }, stats: statsOf(), service: capableService });
	assert.equal(calls[0][0], "subagent-pin");
	assert.equal(calls[0][1].view({}).v, 1);
	assert.equal(typeof dispose, "function");
});

test("apply pins a delegation and the panel reports it", async () => {
	const proto = {
		async startActivation(spec) {
			return spec;
		},
		getProvider() {
			return { capabilities: { agentPreset: true }, inheritsParentContext: false };
		}
	};
	const service = Object.create(proto);
	const seen = [];
	proto.startActivation = async function (spec) {
		seen.push(spec);
		return spec;
	};
	const disposers = [];
	let controller;
	const ctx = {
		subagents: service,
		logger: { info() {}, warn() {} },
		effect: (callback) => {
			disposers.push(callback());
		},
		inject: (names, callback) => {
			if (!names.includes("dshGo")) return;
			callback({ dshGo: { panel(id, value) { controller = value; return () => {}; } } });
		}
	};

	plugin.apply(ctx, { provider: "cpa", model: "pinned" });
	await service.startActivation({ provider: "spawn", request: { parent: "root" } });
	assert.deepEqual(seen[0].request.agentOptions, { provider: "cpa", model: "pinned" });

	const data = controller.actions.refresh({ sessionId: "s1" }, { locale: "zh-CN" }).patch;
	assert.equal(data.stats.find((item) => item.label === "改写次数").value, "1");
	assert.match(data.notice, /会被改写/);
	disposers.reverse().forEach((dispose) => dispose?.());
});
