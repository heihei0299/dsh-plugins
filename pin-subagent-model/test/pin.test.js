import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PROVIDERS, pinnedSpec, readPin, supportsIndependentPreset } from "../src/pin.js";

/** One live configuration reference, as the loader hands volatile fields over. */
function live(values) {
	const state = { ...values };
	return {
		config: {
			provider: { get: () => state.provider },
			model: { get: () => state.model },
			reasoningEffort: { get: () => state.reasoningEffort },
			agentPreset: { get: () => state.agentPreset },
			providers: state.providers,
			onConflict: state.onConflict,
		},
	};
}

test("readPin reads live values, trims text and falls back to the default providers", () => {
	const { config } = live({ provider: " cpa ", model: "pinned", reasoningEffort: "max", agentPreset: " ", providers: undefined });
	const pin = readPin(config);
	assert.deepEqual(pin.route, { provider: "cpa", model: "pinned", effort: "max" });
	assert.equal(pin.preset, undefined);
	assert.deepEqual([...pin.providers], DEFAULT_PROVIDERS);
	assert.equal(pin.onConflict, "override");
	assert.equal(readPin({ provider: "cpa" }), undefined, "a partial route pins nothing");
	assert.equal(readPin({ agentPreset: "minimal" }).preset, "minimal");
	assert.throws(() => readPin({ onConflict: "merge" }), /onConflict/);
});

test("supportsIndependentPreset mirrors the runtime capability gate", () => {
	assert.equal(supportsIndependentPreset({ capabilities: { agentPreset: true } }), true);
	assert.equal(supportsIndependentPreset({ capabilities: { agentPreset: true }, inheritsParentContext: true }), false);
	assert.equal(supportsIndependentPreset({ capabilities: { agentPreset: false } }), false);
	assert.equal(supportsIndependentPreset({}), false);
	assert.equal(supportsIndependentPreset(undefined), false);
	assert.equal(supportsIndependentPreset(null), false);
});

test("pinnedSpec rewrites a detached route and reports the conflict", () => {
	const pin = readPin({ provider: "cpa", model: "pinned", reasoningEffort: "max" });
	const spec = { provider: "spawn", request: { agentOptions: { provider: "cpa", model: "requested" } } };
	const warnings = [];
	const out = pinnedSpec(spec, pin, message => warnings.push(message), false);
	assert.notEqual(out, spec);
	assert.equal(out.request.agentOptions.model, "pinned");
	assert.equal(out.request.agentOptions.reasoningEffort, "max");
	assert.equal(spec.request.agentOptions.model, "requested");
	assert.equal(warnings.length, 1);
});

test("pinnedSpec leaves specs without a request or without a pin untouched", () => {
	const pin = readPin({ provider: "cpa", model: "pinned" });
	const noRequest = { provider: "spawn" };
	assert.equal(pinnedSpec(noRequest, pin, () => {}, false), noRequest);
	const spec = { provider: "spawn", request: {} };
	const emptyPin = { route: undefined, preset: undefined, providers: new Set(["spawn"]), onConflict: "override" };
	assert.equal(pinnedSpec(spec, emptyPin, () => {}, true), spec);
});

test("pinnedSpec pins a preset only when the backend can accept it", () => {
	const pin = readPin({ agentPreset: "minimal" });
	const spec = { provider: "spawn", request: {} };
	assert.equal(pinnedSpec(spec, pin, () => {}, false), spec);
	assert.equal(pinnedSpec(spec, pin, () => {}, true).request.agentPreset, "minimal");
});

test("pinnedSpec rejects conflicts when onConflict is reject", () => {
	const routePin = readPin({ provider: "cpa", model: "pinned", onConflict: "reject" });
	assert.throws(
		() => pinnedSpec({ request: { agentOptions: { provider: "cpa", model: "other" } } }, routePin, () => {}, false),
		/pins child Agents to cpa\/pinned/,
	);
	const presetPin = readPin({ agentPreset: "minimal", onConflict: "reject" });
	assert.throws(
		() => pinnedSpec({ request: { agentPreset: "standard" } }, presetPin, () => {}, true),
		/pins child Agents to preset "minimal"/,
	);
});
