import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { join } from "node:path";
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

	const root = new Context();
	new FixtureAgents(root);
	const runtime = new SubagentRuntime(root, {
		maxDepth: { get: () => 1 },
		maxActiveSubagents: { get: () => 8 }
	});
	// The real providers are registered through the runtime's own registry, so
	// their capability flags and `prepareContinuable` presence are the ones the
	// activation gate and dispatch actually read.
	applySpawn({ subagents: runtime }, { providerName: "spawn" });
	applyFork({ subagents: runtime }, { providerName: "fork" });
	assert.deepEqual(runtime.list(), ["spawn", "fork"]);

	// Let the runtime's `agents` injection build its real manager, then replace
	// only the child-creation half: recording what the runtime dispatches avoids
	// persistence, a working directory, and any model call.
	await new Promise((resolve) => setImmediate(resolve));
	assert.notEqual(runtime.manager, void 0, "the real runtime must wire its own manager");
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
	const spawnSpec = { provider: "spawn", request: { parent, agentOptions: { provider: "cpa", model: "gpt-6-luna" } }, signal };
	assert.deepEqual(await root.subagents.startActivation(spawnSpec), { kind: "local" });
	const forkSpec = { provider: "fork", request: { parent }, signal };
	assert.deepEqual(await root.subagents.startActivation(forkSpec), { kind: "local" });

	assert.equal(dispatched.length, 2);
	const [spawn, fork] = dispatched;

	// Spawn: both the explicit route and the backend's independent preset.
	assert.deepEqual(spawn.request.agentOptions, { provider: PIN.provider, model: PIN.model, reasoningEffort: PIN.reasoningEffort });
	assert.equal(spawn.request.agentPreset, PIN.agentPreset);
	// Fork: the route is still pinned, but the preset is omitted so the child
	// joins the parent's composition.
	assert.deepEqual(fork.request.agentOptions, { provider: PIN.provider, model: PIN.model, reasoningEffort: PIN.reasoningEffort });
	assert.equal(fork.request.agentPreset, void 0);
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
	const spawnOptions = resolveChildAgentOptions(parent, spawn.request.agentOptions, 1);
	const forkOptions = resolveChildAgentOptions(parent, fork.request.agentOptions, 1);
	assert.equal(spawnOptions.provider, PIN.provider);
	assert.equal(spawnOptions.model, PIN.model);
	assert.equal(spawnOptions.reasoningEffort, PIN.reasoningEffort);
	assert.deepEqual(forkOptions, spawnOptions);
	assert.equal(childSessionMeta(parent, 1, false, spawn.request.agentPreset).agentPreset, PIN.agentPreset);
	assert.equal(childSessionMeta(parent, 1, false, fork.request.agentPreset).agentPreset, COMPOSED_PARENT_PRESET);

	// The caller's spec is untouched and disposal removes the decoration.
	assert.equal(spawnSpec.request.agentOptions.model, "gpt-6-luna");
	assert.equal(spawnSpec.request.agentPreset, void 0);
	assert.equal(Object.hasOwn(runtime, "startActivation"), true);
	disposeAll();
	assert.equal(Object.hasOwn(runtime, "startActivation"), false);
	assert.equal(typeof root.subagents.startActivation, "function");
});
