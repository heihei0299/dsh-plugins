import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import plugin from "../index.js";

// Explicit opt-in to an installed runtime. Nothing here reads a profile,
// credentials, the network, or a port: the run is one in-memory activation
// against the real `SubagentRuntime`, with a fake parent and fake agents/
// manager seams, because creating a real child would need session persistence,
// a working directory and a model call.
const runtimeRoot = process.env.DSH_TEST_RUNTIME_ROOT;

const COMPOSED_PARENT_PRESET = "parent-preset";
const PIN = {
	provider: "cpa",
	model: "cline-pass/deepseek-v4.1-flash",
	reasoningEffort: "max",
	agentPreset: "minimal"
};

/** Load one module from the runtime under test, not from this package. */
async function runtimeModule(requireRuntime, specifier) {
	return import(pathToFileURL(requireRuntime.resolve(specifier)).href);
}

/**
 * The delegating parent. Only the fields the runtime's own resolution helpers
 * read are present: its live route (differing from the pin), its durable header
 * and the preset it is composed under.
 */
function fakeParent(id = "parent-1") {
	return {
		id,
		options: { provider: "cpa", model: "gpt-6.1-sol", reasoningEffort: "xhigh" },
		session: { header: { id, cwd: "/tmp" }, requestHeader: () => void 0 },
		ctx: {
			get: (name) => name === "agentPresets" ? { composedPreset: () => COMPOSED_PARENT_PRESET } : void 0
		}
	};
}

test("real SubagentRuntime pins spawn route+preset and keeps fork on the parent preset", { skip: !runtimeRoot }, async () => {
	const requireRuntime = createRequire(join(runtimeRoot, "package.json"));
	// The shape under test is the one the runtime itself declares: up to
	// 0.2.2-rc.1 the task fields sit under `spec.request`, and 0.2.2-rc.2
	// flattens `SubagentStartRequest` onto the activation spec.
	const subagentTypes = readFileSync(
		join(dirname(requireRuntime.resolve("@deepseek-ai/dsh-subagent/package.json")), "lib", "types", "types.d.ts"),
		"utf8"
	);
	const flattened = !/readonly request: Omit<SubagentStartRequest/.test(subagentTypes);
	const specFor = (provider, fields, signal) => flattened ? { provider, ...fields, signal } : { provider, request: fields, signal };
	const carrierOf = (spec) => flattened ? spec : spec.request;
	const { Context, Service } = await runtimeModule(requireRuntime, "@deepseek-ai/cordis");
	const { SubagentRuntime, resolveChildAgentOptions, childSessionMeta } = await runtimeModule(requireRuntime, "@deepseek-ai/dsh-subagent");
	const { apply: applySpawn } = await runtimeModule(requireRuntime, "@deepseek-ai/dsh-subagent-spawn-in-process");
	const { apply: applyFork } = await runtimeModule(requireRuntime, "@deepseek-ai/dsh-subagent-fork-in-process");

	const parent = fakeParent();

	// The real runtime's `startActivation` requires the exact live parent in the
	// agents registry before it dispatches, so the registry is a one-method fake.
	class FixtureAgents extends Service {
		constructor(ctx) {
			super(ctx, "agents");
		}
		get(id) {
			return id === parent.id ? parent : void 0;
		}
	}

	// The runtime declares `inject = ["workingDirectory", "sessionProjections"]` and,
	// from 0.2.2-rc.2 on, registers its projections in `Service.init`. Stubs that
	// answer only what that init touches keep the mount real without a profile.
	class FixtureProjections extends Service {
		constructor(ctx) {
			super(ctx, "sessionProjections");
		}
		async register() {
			return { stateOf: () => ({}) };
		}
	}

	class FixtureWorkingDirectory extends Service {
		constructor(ctx) {
			super(ctx, "workingDirectory");
		}
	}

	const root = new Context();
	await root.plugin(FixtureProjections);
	await root.plugin(FixtureWorkingDirectory);
	await root.plugin(FixtureAgents);
	// Mount the runtime as a service instead of calling its constructor: 0.2.2-rc.2
	// builds the manager in `Service.init`, which a bare construction never runs.
	await root.plugin(SubagentRuntime, { maxDepth: 1, maxActiveSubagents: 8 });
	const runtime = root.get("subagents");
	// The real providers are registered through the runtime's own registry, so
	// their capability flags and `prepareContinuable` presence are the ones the
	// activation gate and dispatch actually read.
	applySpawn({ subagents: runtime }, { providerName: "spawn" });
	applyFork({ subagents: runtime }, { providerName: "fork" });
	// `list()` disappeared in 0.2.2-rc.2; `getProvider` exists in both and proves
	// the same thing here: the providers went through the runtime's own registry.
	assert.equal(runtime.getProvider("spawn").name, "spawn");
	assert.equal(runtime.getProvider("fork").name, "fork");

	assert.notEqual(runtime.manager, void 0, "the real runtime must wire its own manager");
	// Replace only the child-creation half: recording what the runtime dispatches
	// avoids persistence, a working directory, and any model call.
	const dispatched = [];
	runtime.manager = {
		async startLocal(spec) {
			dispatched.push(spec);
			return { kind: "local" };
		},
		async startExternal(spec) {
			dispatched.push(spec);
			return { kind: "external" };
		}
	};

	const warnings = [];
	const disposers = [];
	const disposeAll = () => disposers.reverse().forEach((dispose) => dispose());
	plugin.apply({
		subagents: root.subagents,
		logger: { info() {}, warn: (message) => warnings.push(message) },
		effect(factory) {
			disposers.push(factory());
		}
	}, PIN);
	const signal = new AbortController().signal;

	// One explicit, differing route: the delegated request asks for
	// cpa/gpt-6-luna while the profile pins cpa/cline-pass/deepseek-v4.1-flash.
	const spawnSpec = specFor("spawn", { parent, agentOptions: { provider: "cpa", model: "gpt-6-luna" } }, signal);
	assert.deepEqual(await root.subagents.startActivation(spawnSpec), { kind: "local" });
	const forkSpec = specFor("fork", { parent }, signal);
	assert.deepEqual(await root.subagents.startActivation(forkSpec), { kind: "local" });

	assert.equal(dispatched.length, 2);
	const [spawn, fork] = dispatched;

	// Spawn: both the explicit route and the backend's independent preset.
	assert.deepEqual(carrierOf(spawn).agentOptions, { provider: PIN.provider, model: PIN.model, reasoningEffort: PIN.reasoningEffort });
	assert.equal(carrierOf(spawn).agentPreset, PIN.agentPreset);
	// Fork: the route is still pinned, but the preset is omitted so the child
	// joins the parent's composition.
	assert.deepEqual(carrierOf(fork).agentOptions, { provider: PIN.provider, model: PIN.model, reasoningEffort: PIN.reasoningEffort });
	assert.equal(carrierOf(fork).agentPreset, void 0);
	assert.match(warnings.join("\n"), /overriding requested child route cpa\/gpt-6-luna/);
	assert.match(warnings.join("\n"), /provider "fork" cannot select an independent agent preset/);

	// The real runtime's own capability gate is what forces the fork exception:
	// an injected preset on fork is refused, so the omission is not cosmetic.
	const forkGate = runtime.assertCapabilities.bind(runtime);
	assert.throws(
		() => forkGate(runtime.getProvider("fork"), { agentPreset: PIN.agentPreset }),
		(error) => error.code === "UNSUPPORTED_CAPABILITY" && /does not support independent agent preset selection/.test(error.message)
	);

	// And the pinned request lands where the local start reads it: the child
	// route survives parent inheritance, spawn selects the pinned preset, and
	// fork keeps the parent's composed preset.
	const spawnOptions = resolveChildAgentOptions(parent, carrierOf(spawn).agentOptions, 1);
	const forkOptions = resolveChildAgentOptions(parent, carrierOf(fork).agentOptions, 1);
	assert.equal(spawnOptions.provider, PIN.provider);
	assert.equal(spawnOptions.model, PIN.model);
	assert.equal(spawnOptions.reasoningEffort, PIN.reasoningEffort);
	assert.deepEqual(forkOptions, spawnOptions);
	assert.equal(childSessionMeta(parent, 1, false, carrierOf(spawn).agentPreset).agentPreset, PIN.agentPreset);
	assert.equal(childSessionMeta(parent, 1, false, carrierOf(fork).agentPreset).agentPreset, COMPOSED_PARENT_PRESET);

	// The caller's spec is untouched and disposal removes the decoration.
	assert.equal(carrierOf(spawnSpec).agentOptions.model, "gpt-6-luna");
	assert.equal(carrierOf(spawnSpec).agentPreset, void 0);
	assert.equal(Object.hasOwn(runtime, "startActivation"), true);
	disposeAll();
	assert.equal(Object.hasOwn(runtime, "startActivation"), false);
	assert.equal(typeof root.subagents.startActivation, "function");
});
