import assert from "node:assert/strict";
import test from "node:test";
import plugin from "../index.js";

/** Minimal stand-in for the cordis context used by the plugin. */
function fakeCtx(service) {
	const disposers = [];
	const warnings = [];
	return {
		subagents: service,
		logger: {
			info() {},
			warn: (message) => warnings.push(message)
		},
		effect(execute) {
			disposers.push(execute());
		},
		warnings,
		disposeAll() {
			while (disposers.length > 0) disposers.pop()();
		}
	};
}

/** Service whose activations are recorded instead of executed. */
function recordingService(providers = {}) {
	const seen = [];
	return {
		seen,
		providers,
		getProvider(name) {
			return this.providers[name];
		},
		async startActivation(spec) {
			seen.push(spec);
			return { childId: "child-1" };
		}
	};
}

/** One live configuration reference, as the loader hands volatile fields over. */
function live(values) {
	const state = { ...values };
	return {
		state,
		config: {
			provider: { get: () => state.provider },
			model: { get: () => state.model },
			reasoningEffort: { get: () => state.reasoningEffort },
			agentPreset: { get: () => state.agentPreset },
			providers: state.providers,
			onConflict: state.onConflict
		}
	};
}

const PIN = { provider: "cpa", model: "cline-pass/deepseek-v4.1-flash", reasoningEffort: "max" };
const SPAWN = { name: "spawn", capabilities: { agentPreset: true }, inheritsParentContext: false };
const FORK = { name: "fork", capabilities: { agentPreset: false }, inheritsParentContext: true };

test("rewrites an inherited route onto the pin", async () => {
	const service = recordingService({ spawn: SPAWN });
	plugin.apply(fakeCtx(service), PIN);
	await service.startActivation({ provider: "spawn", request: { parent: "parent", agentOptions: { provider: "cpa", model: "gpt-6.1-sol", reasoningEffort: "xhigh" } } });
	assert.deepEqual(service.seen[0].request.agentOptions, { provider: "cpa", model: "cline-pass/deepseek-v4.1-flash", reasoningEffort: "max" });
});

test("pins a request that names no route at all", async () => {
	const service = recordingService({ spawn: SPAWN });
	plugin.apply(fakeCtx(service), PIN);
	await service.startActivation({ provider: "spawn", request: { parent: "parent" } });
	assert.deepEqual(service.seen[0].request.agentOptions, { provider: "cpa", model: "cline-pass/deepseek-v4.1-flash", reasoningEffort: "max" });
});

test("overrides a differing explicit request and warns", async () => {
	const ctx = fakeCtx(recordingService({ spawn: SPAWN }));
	plugin.apply(ctx, PIN);
	await ctx.subagents.startActivation({ provider: "spawn", request: { agentOptions: { provider: "cpa", model: "gpt-6-luna", reasoningEffort: "low" } } });
	assert.equal(ctx.subagents.seen[0].request.agentOptions.model, "cline-pass/deepseek-v4.1-flash");
	assert.equal(ctx.warnings.length, 1);
});

test("rejects a differing request when onConflict is reject", () => {
	const ctx = fakeCtx(recordingService({ spawn: SPAWN }));
	plugin.apply(ctx, { ...PIN, onConflict: "reject" });
	assert.throws(
		() => ctx.subagents.startActivation({ provider: "spawn", request: { agentOptions: { provider: "cpa", model: "gpt-6-luna" } } }),
		/pins child Agents to cpa\/cline-pass\/deepseek-v4.1-flash/
	);
});

test("leaves unlisted subagent backends untouched", async () => {
	const service = recordingService({ spawn: SPAWN, fork: FORK });
	plugin.apply(fakeCtx(service), { ...PIN, providers: ["spawn"] });
	const spec = { provider: "fork", request: { agentOptions: { provider: "cpa", model: "gpt-6.1-sol" } } };
	await service.startActivation(spec);
	assert.equal(service.seen[0], spec);
});

test("keeps the incoming effort when no effort is pinned", async () => {
	const service = recordingService({ spawn: SPAWN });
	plugin.apply(fakeCtx(service), { provider: "cpa", model: "cline-pass/deepseek-v4.1-flash" });
	await service.startActivation({ provider: "spawn", request: { agentOptions: { provider: "cpa", model: "gpt-6.1-sol", reasoningEffort: "xhigh" } } });
	assert.deepEqual(service.seen[0].request.agentOptions, { provider: "cpa", model: "cline-pass/deepseek-v4.1-flash", reasoningEffort: "xhigh" });
});

test("pins the configured agent preset on a capable backend", async () => {
	const service = recordingService({ spawn: SPAWN });
	plugin.apply(fakeCtx(service), { ...PIN, agentPreset: "minimal" });
	await service.startActivation({ provider: "spawn", request: { parent: "parent" } });
	assert.equal(service.seen[0].request.agentPreset, "minimal");
	assert.deepEqual(service.seen[0].request.agentOptions, { provider: "cpa", model: "cline-pass/deepseek-v4.1-flash", reasoningEffort: "max" });
});

test("supports a preset-only configuration", async () => {
	const service = recordingService({ spawn: SPAWN });
	plugin.apply(fakeCtx(service), { agentPreset: "minimal" });
	await service.startActivation({ provider: "spawn", request: { agentOptions: { provider: "cpa", model: "gpt-6.1-sol" } } });
	assert.equal(service.seen[0].request.agentPreset, "minimal");
	assert.deepEqual(service.seen[0].request.agentOptions, { provider: "cpa", model: "gpt-6.1-sol" });
});

test("keeps fork on the inherited preset and warns once", async () => {
	const ctx = fakeCtx(recordingService({ spawn: SPAWN, fork: FORK }));
	plugin.apply(ctx, { ...PIN, agentPreset: "minimal" });
	const spec = { provider: "fork", request: { agentOptions: { provider: "cpa", model: "gpt-6.1-sol" } } };
	await ctx.subagents.startActivation(spec);
	await ctx.subagents.startActivation(spec);
	assert.equal(ctx.subagents.seen[0].request.agentPreset, void 0);
	assert.equal(ctx.warnings.filter((message) => /cannot select an independent agent preset/.test(message)).length, 1);
});

test("overrides a requested preset and warns", async () => {
	const ctx = fakeCtx(recordingService({ spawn: SPAWN }));
	plugin.apply(ctx, { ...PIN, agentPreset: "minimal" });
	await ctx.subagents.startActivation({ provider: "spawn", request: { agentPreset: "standard" } });
	assert.equal(ctx.subagents.seen[0].request.agentPreset, "minimal");
	assert.match(ctx.warnings[0], /overriding requested child agent preset "standard" with "minimal"/);
});

test("accepts a request for the same preset without a warning", async () => {
	const ctx = fakeCtx(recordingService({ spawn: SPAWN }));
	plugin.apply(ctx, { ...PIN, agentPreset: "minimal" });
	await ctx.subagents.startActivation({ provider: "spawn", request: { agentPreset: "minimal" } });
	assert.equal(ctx.subagents.seen[0].request.agentPreset, "minimal");
	assert.equal(ctx.warnings.length, 0);
});

test("rejects a differing requested preset when onConflict is reject", () => {
	const ctx = fakeCtx(recordingService({ spawn: SPAWN }));
	plugin.apply(ctx, { ...PIN, agentPreset: "minimal", onConflict: "reject" });
	assert.throws(
		() => ctx.subagents.startActivation({ provider: "spawn", request: { agentPreset: "standard" } }),
		/pins child Agents to preset "minimal"/
	);
});

test("does not inject a preset when the backend is not registered", async () => {
	const ctx = fakeCtx(recordingService());
	plugin.apply(ctx, { agentPreset: "minimal" });
	await ctx.subagents.startActivation({ provider: "spawn", request: {} });
	assert.equal(ctx.subagents.seen[0].request.agentPreset, void 0);
	assert.match(ctx.warnings[0], /cannot select an independent agent preset/);
});

test("does not mutate the caller's activation spec", async () => {
	const service = recordingService({ spawn: SPAWN });
	plugin.apply(fakeCtx(service), { ...PIN, agentPreset: "minimal" });
	const spec = { provider: "spawn", request: { agentOptions: { provider: "cpa", model: "gpt-6.1-sol" } } };
	await service.startActivation(spec);
	assert.equal(spec.request.agentPreset, void 0);
	assert.deepEqual(spec.request.agentOptions, { provider: "cpa", model: "gpt-6.1-sol" });
});

test("follows a volatile configuration change on the next delegation", async () => {
	const { state, config } = live({ ...PIN, agentPreset: "minimal", providers: ["spawn"], onConflict: "override" });
	const service = recordingService({ spawn: SPAWN });
	plugin.apply(fakeCtx(service), config);
	await service.startActivation({ provider: "spawn", request: {} });
	assert.equal(service.seen[0].request.agentOptions.model, "cline-pass/deepseek-v4.1-flash");
	assert.equal(service.seen[0].request.agentPreset, "minimal");
	state.model = "gpt-6-luna";
	state.agentPreset = "standard";
	await service.startActivation({ provider: "spawn", request: {} });
	assert.equal(service.seen[1].request.agentOptions.model, "gpt-6-luna");
	assert.equal(service.seen[1].request.agentPreset, "standard");
});

test("enables a live configuration written after an unconfigured start", async () => {
	const { state, config } = live({ provider: "", model: "", reasoningEffort: "", agentPreset: "", providers: ["spawn"], onConflict: "override" });
	const service = recordingService({ spawn: SPAWN });
	const ctx = fakeCtx(service);
	plugin.apply(ctx, config);
	assert.match(ctx.warnings[0], /no `provider`\/`model` or `agentPreset` configured/);
	await service.startActivation({ provider: "spawn", request: {} });
	assert.equal(service.seen[0].request.agentOptions, void 0);
	state.provider = "cpa";
	state.model = "cline-pass/deepseek-v4.1-flash";
	state.agentPreset = "minimal";
	await service.startActivation({ provider: "spawn", request: {} });
	assert.equal(service.seen[1].request.agentPreset, "minimal");
	assert.equal(service.seen[1].request.agentOptions.model, "cline-pass/deepseek-v4.1-flash");
});

test("restores the original method on dispose", async () => {
	const service = recordingService({ spawn: SPAWN });
	const original = service.startActivation;
	const ctx = fakeCtx(service);
	plugin.apply(ctx, PIN);
	assert.notEqual(service.startActivation, original);
	ctx.disposeAll();
	assert.equal(service.startActivation, original);
});

test("stays enabled, warns, and pins nothing when nothing is configured", async () => {
	const service = recordingService({ spawn: SPAWN });
	const ctx = fakeCtx(service);
	plugin.apply(ctx, { model: "x" });
	assert.match(ctx.warnings[0], /no `provider`\/`model` or `agentPreset` configured/);
	const spec = { provider: "spawn", request: { agentOptions: { provider: "cpa", model: "gpt-6.1-sol" } } };
	await service.startActivation(spec);
	assert.equal(service.seen[0], spec);
});

test("rejects an unusable onConflict value even without a route", () => {
	assert.throws(() => plugin.apply(fakeCtx(recordingService()), { ...PIN, onConflict: "merge" }), /`onConflict` must be 'override' or 'reject'/);
});

test("declares the WebUI-editable fields as volatile and keeps policy fields ordinary", () => {
	const dict = plugin.Config.dict;
	for (const field of ["provider", "model", "reasoningEffort", "agentPreset"]) assert.equal(dict[field].meta.volatile, true, `${field} must be volatile`);
	assert.equal(dict.providers.meta.volatile, void 0, "providers must stay ordinary configuration");
	assert.equal(dict.onConflict.meta.volatile, void 0, "onConflict must stay ordinary configuration");
	assert.equal(dict.provider.meta.default, "");
	assert.equal(dict.agentPreset.meta.default, "");
	assert.deepEqual(dict.providers.meta.default, ["spawn", "fork"]);
	assert.equal(dict.onConflict.meta.default, "override");
});
