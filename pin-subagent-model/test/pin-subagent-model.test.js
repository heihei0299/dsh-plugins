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
function recordingService() {
	const seen = [];
	return {
		seen,
		async startActivation(spec) {
			seen.push(spec);
			return { childId: "child-1" };
		}
	};
}

const PIN = { provider: "cpa", model: "cline-pass/deepseek-v4.1-flash", reasoningEffort: "max" };

test("rewrites an inherited route onto the pin", async () => {
	const service = recordingService();
	plugin.apply(fakeCtx(service), PIN);
	await service.startActivation({ provider: "spawn", request: { parent: "parent", agentOptions: { provider: "cpa", model: "gpt-6.1-sol", reasoningEffort: "xhigh" } } });
	assert.deepEqual(service.seen[0].request.agentOptions, { provider: "cpa", model: "cline-pass/deepseek-v4.1-flash", reasoningEffort: "max" });
});

test("pins a request that names no route at all", async () => {
	const service = recordingService();
	plugin.apply(fakeCtx(service), PIN);
	await service.startActivation({ provider: "spawn", request: { parent: "parent" } });
	assert.deepEqual(service.seen[0].request.agentOptions, { provider: "cpa", model: "cline-pass/deepseek-v4.1-flash", reasoningEffort: "max" });
});

test("overrides a differing explicit request and warns", async () => {
	const ctx = fakeCtx(recordingService());
	plugin.apply(ctx, PIN);
	await ctx.subagents.startActivation({ provider: "spawn", request: { agentOptions: { provider: "cpa", model: "gpt-6-luna", reasoningEffort: "low" } } });
	assert.equal(ctx.subagents.seen[0].request.agentOptions.model, "cline-pass/deepseek-v4.1-flash");
	assert.equal(ctx.warnings.length, 1);
});

test("rejects a differing request when onConflict is reject", () => {
	const ctx = fakeCtx(recordingService());
	plugin.apply(ctx, { ...PIN, onConflict: "reject" });
	assert.throws(
		() => ctx.subagents.startActivation({ provider: "spawn", request: { agentOptions: { provider: "cpa", model: "gpt-6-luna" } } }),
		/pins child Agents to cpa\/cline-pass\/deepseek-v4.1-flash/
	);
});

test("leaves unlisted subagent backends untouched", async () => {
	const service = recordingService();
	plugin.apply(fakeCtx(service), { ...PIN, providers: ["spawn"] });
	const spec = { provider: "fork", request: { agentOptions: { provider: "cpa", model: "gpt-6.1-sol" } } };
	await service.startActivation(spec);
	assert.equal(service.seen[0], spec);
});

test("keeps the incoming effort when no effort is pinned", async () => {
	const service = recordingService();
	plugin.apply(fakeCtx(service), { provider: "cpa", model: "cline-pass/deepseek-v4.1-flash" });
	await service.startActivation({ provider: "spawn", request: { agentOptions: { provider: "cpa", model: "gpt-6.1-sol", reasoningEffort: "xhigh" } } });
	assert.deepEqual(service.seen[0].request.agentOptions, { provider: "cpa", model: "cline-pass/deepseek-v4.1-flash", reasoningEffort: "xhigh" });
});

test("restores the original method on dispose", async () => {
	const service = recordingService();
	const original = service.startActivation;
	const ctx = fakeCtx(service);
	plugin.apply(ctx, PIN);
	assert.notEqual(service.startActivation, original);
	ctx.disposeAll();
	assert.equal(service.startActivation, original);
});

test("stays inactive and warns when no route is configured", () => {
	const service = recordingService();
	const original = service.startActivation;
	const ctx = fakeCtx(service);
	plugin.apply(ctx, { model: "x" });
	assert.equal(service.startActivation, original);
	assert.match(ctx.warnings[0], /no `provider`\/`model` configured/);
});

test("rejects an unusable onConflict value even without a route", () => {
	assert.throws(() => plugin.apply(fakeCtx(recordingService()), { ...PIN, onConflict: "merge" }), /`onConflict` must be 'override' or 'reject'/);
});
