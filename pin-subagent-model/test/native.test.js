import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import plugin from "../index.js";

// Explicit opt-in to the installed runtime, not a user's profile or credentials.
const runtimeRoot = process.env.DSH_TEST_RUNTIME_ROOT;

test("installed Cordis service proxy accepts one guarded startActivation decoration", { skip: !runtimeRoot }, async () => {
	const requireRuntime = createRequire(join(runtimeRoot, "package.json"));
	const { Context, Service } = await import(pathToFileURL(requireRuntime.resolve("@deepseek-ai/cordis")).href);
	const { SubagentRuntime } = await import(pathToFileURL(requireRuntime.resolve("@deepseek-ai/dsh-subagent")).href);

	// The real seam is a prototype method on the installed runtime. Assert its
	// shape, then exercise the same Cordis Service proxy path the plugin patches.
	const prototypeDescriptor = Object.getOwnPropertyDescriptor(SubagentRuntime.prototype, "startActivation");
	assert.equal(typeof prototypeDescriptor?.value, "function");
	assert.equal(prototypeDescriptor.writable, true);

	class FixtureSubagents extends Service {
		seen = [];
		constructor(ctx) { super(ctx, "subagents"); }
		async startActivation(spec) { this.seen.push(spec); return spec; }
		getProvider() { return undefined; }
	}

	const root = new Context();
	const raw = new FixtureSubagents(root);
	const warnings = [];
	const disposers = [];
	const ctx = {
		subagents: root.subagents,
		logger: { info() {}, warn: message => warnings.push(message) },
		effect(factory) { disposers.push(factory()); },
	};
	plugin.apply(ctx, { provider: "cpa", model: "native-pin" });
	assert.equal(Object.hasOwn(raw, "startActivation"), true);
	assert.equal(root.subagents.startActivation[Symbol.for("dsh-plugin-pin-subagent-model.startActivation")], true);
	assert.throws(() => plugin.apply(ctx, { provider: "cpa", model: "native-pin" }), /already decorated/);

	const spec = { provider: "spawn", request: { parent: "parent" } };
	await root.subagents.startActivation(spec);
	assert.deepEqual(raw.seen[0].request.agentOptions, { provider: "cpa", model: "native-pin" });

	disposers.reverse().forEach(dispose => dispose());
	assert.equal(Object.hasOwn(raw, "startActivation"), false);
	assert.equal(typeof root.subagents.startActivation, "function");
	assert.doesNotMatch(warnings.join("\n"), /replaced after decoration/);
});
