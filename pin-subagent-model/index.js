/**
 * Pin every delegated child Agent to one LLM route and, optionally, one Agent
 * preset.
 *
 * Why this exists: omitting `provider`/`model` in a delegation tool call makes
 * the child inherit the parent Agent's live route (`resolveChildAgentOptions`
 * in `@deepseek-ai/dsh-subagent`), and `subagent-model-selection-settings`
 * only gates *explicit* selections — `assertAllowedModelSelection` returns
 * early when the call names no route. The same hole exists for the child's
 * composition: omitting `agentPreset` makes the child join the parent's
 * current preset (`applyChildComposition`), and the preset-owned
 * `tool-subagent` row cannot be given `agentPreset` from the profile layer.
 * So a profile that wants every child on one route and one composition cannot
 * express that with settings or preset tool config alone.
 *
 * The seam: `SubagentRuntime.startActivation(spec)` runs before `startLocal`,
 * which is where `resolveChildAgentOptions` reads `spec.request.agentOptions`
 * and where `applyChildComposition` reads `spec.request.agentPreset`. Writing
 * those fields here converges inherited choices and explicit requests on the
 * configured pin, without touching the agent preset that owns the
 * `subagent`/`subagent_fork` tool rows.
 *
 * Config, normally an id-targeted override of the `pin-subagent-model` entry in
 * the profile's `cordis.patch.yml`:
 * - `provider` (volatile) — LLM provider id for children; empty leaves the
 *   route inherited.
 * - `model` (volatile) — model id for children; empty leaves it inherited.
 * - `reasoningEffort` (volatile, optional) — pin the adapter effort too.
 * - `agentPreset` (volatile, optional) — Agent preset every child with an
 *   independent composition mounts; empty keeps inheriting the parent preset.
 * - `providers` (ordinary) — subagent backends to pin; default
 *   `['spawn', 'fork']`. Drop `fork` to keep forked children on the parent
 *   route so the inherited conversation prefix stays cache-eligible. Fork and
 *   any other context-inheriting backend never take an independent preset.
 * - `onConflict` (ordinary) — `'override'` (default) rewrites a differing
 *   explicit request and logs it; `'reject'` throws instead.
 *
 * The four volatile fields are also the WebUI configuration page's fields: the
 * settings service writes them through the profile patch without remounting
 * this entry, so `apply` must not snapshot them — every activation reads the
 * live Config references.
 *
 * The bundle layer registers the entry without a route, so enabling it in the
 * plugin manager before configuring it is safe: it logs one warning, pins
 * nothing, and still decorates `startActivation` so a later live configuration
 * write takes effect on the next delegation.
 */

import z from "@deepseek-ai/schemastery";

import { DEFAULT_PROVIDERS, pinnedSpec, readPin, supportsIndependentPreset } from "./src/pin.js";

/**
 * Live entry configuration.
 *
 * Volatile fields are projected into the WebUI configuration page and committed
 * into the running references without remounting the entry; the other fields
 * are ordinary configuration edited in the profile patch.
 */
export const Config = z.object({
	provider: z.string().default("").description("LLM provider id every delegated child Agent is pinned to; empty leaves the route inherited").volatile(),
	model: z.string().default("").description("Model id every delegated child Agent is pinned to; empty leaves the route inherited").volatile(),
	reasoningEffort: z.string().default("").description("Adapter reasoning effort pinned for delegated child Agents; empty keeps the inherited or requested effort").volatile(),
	agentPreset: z.string().default("").description("Agent preset every independently composed child Agent mounts; empty keeps inheriting the parent preset").volatile(),
	providers: z.array(z.string()).default([...DEFAULT_PROVIDERS]).description("Subagent backends this entry pins; fork and other context-inheriting backends keep inheriting the parent preset"),
	onConflict: z.union(["override", "reject"]).default("override").description("override rewrites a differing explicit child route or preset and logs it; reject throws instead")
});

const name = "pin-subagent-model";
const inject = ["subagents"];

/** Non-enumerable mark on this plugin's decorator, used to detect a double mount. */
const PATCH_MARKER = Symbol.for("dsh-plugin-pin-subagent-model.startActivation");

/**
 * Find the property descriptor visible on an object, walking its prototypes.
 * @param target - object or service proxy.
 * @param key - property name.
 * @returns the first descriptor found, or undefined.
 */
function descriptorOn(target, key) {
	for (let current = target; current !== null; current = Object.getPrototypeOf(current)) {
		const descriptor = Object.getOwnPropertyDescriptor(current, key);
		if (descriptor !== undefined) return descriptor;
	}
	return undefined;
}

/**
 * Decorate the live `subagents` service so every child activation is pinned.
 * @param ctx - plugin context with `subagents` available.
 * @param config - pin config, whose volatile fields stay live.
 */
function apply(ctx, config) {
	const initial = readPin(config);
	const warn = (message) => {
		try {
			ctx.logger?.warn?.(message);
		} catch {}
	};
	if (initial === void 0) warn("pin-subagent-model: no `provider`/`model` or `agentPreset` configured, so no child route or preset is pinned. Set them on the `pin-subagent-model` entry in the profile's cordis.patch.yml or from the plugin's WebUI configuration page.");
	else {
		const parts = [];
		if (initial.route !== void 0) parts.push(`route ${initial.route.provider}/${initial.route.model}${initial.route.effort === void 0 ? "" : ` (${initial.route.effort})`}`);
		if (initial.preset !== void 0) parts.push(`agent preset "${initial.preset}"`);
		ctx.logger?.info?.(`pin-subagent-model: child Agents pinned to ${parts.join(" and ")} for ${[...initial.providers].join(", ")}`);
	}
	const service = ctx.subagents;
	const startActivation = service.startActivation;
	if (typeof startActivation !== "function") throw new Error("pin-subagent-model: `subagents.startActivation` is unavailable");
	if (startActivation[PATCH_MARKER] === true) throw new Error("pin-subagent-model: `subagents.startActivation` is already decorated; mount the plugin only once");
	// Capture the exact property shape before touching it. A service may expose
	// the method on its prototype (the normal Cordis shape) or through an accessor.
	const ownDescriptor = Object.getOwnPropertyDescriptor(service, "startActivation");
	const descriptor = ownDescriptor ?? descriptorOn(Object.getPrototypeOf(service), "startActivation");
	if (descriptor !== undefined) {
		const writable = "value" in descriptor ? descriptor.writable === true : typeof descriptor.set === "function";
		if (!writable) throw new Error("pin-subagent-model: `subagents.startActivation` is not writable");
	}
	const presetSkipped = new Set();
	ctx.effect(() => {
		// Stays true only while this decoration is mounted. A wrapper installed
		// after us may have captured this function and keep delegating to it, so
		// dispose has to neutralize the closure itself instead of relying on the
		// service property swap: a stale closure would otherwise keep re-pinning
		// delegations with the configuration this mount was created with, and
		// after a re-enable the older pin would overwrite the newer one.
		let active = true;
		const wrapper = function pinnedStartActivation(spec) {
			if (!active) return startActivation.call(this, spec);
			const pin = readPin(config);
			if (pin === void 0 || !pin.providers.has(spec?.provider)) return startActivation.call(this, spec);
			const provider = typeof service.getProvider === "function" ? service.getProvider(spec.provider) : void 0;
			const canPinPreset = pin.preset !== void 0 && supportsIndependentPreset(provider);
			if (pin.preset !== void 0 && !canPinPreset && !presetSkipped.has(spec.provider)) {
				presetSkipped.add(spec.provider);
				warn(`pin-subagent-model: provider "${spec.provider}" cannot select an independent agent preset; its children keep inheriting the parent preset`);
			}
			return startActivation.call(this, pinnedSpec(spec, pin, warn, canPinPreset));
		};
		Object.defineProperty(wrapper, PATCH_MARKER, { value: true });
		if (!Reflect.set(service, "startActivation", wrapper) || service.startActivation?.[PATCH_MARKER] !== true) {
			throw new Error("pin-subagent-model: could not decorate `subagents.startActivation`");
		}
		// A prototype method gets an own data property; an inherited accessor
		// with a setter may store the value elsewhere instead.
		const createdOwn = Object.hasOwn(service, "startActivation");
		return () => {
			// Invalidate this closure first so any delegating wrapper that still
			// references it immediately falls back to the undecorated method.
			active = false;
			// Never overwrite a wrapper someone else installed after us: restoring
			// our original would silently break that chain.
			if (service.startActivation?.[PATCH_MARKER] !== true) {
				warn("pin-subagent-model: `subagents.startActivation` was replaced after decoration; leaving the newer wrapper in place");
				return;
			}
			try {
				if (ownDescriptor !== undefined) Object.defineProperty(service, "startActivation", ownDescriptor);
				else if (createdOwn) {
					if (!Reflect.deleteProperty(service, "startActivation")) throw new Error("the decorated own property is not configurable");
				} else if (!Reflect.set(service, "startActivation", startActivation)) throw new Error("the inherited accessor refused the original method");
			} catch (error) {
				warn(`pin-subagent-model: could not restore \`subagents.startActivation\`: ${error.message}`);
				return;
			}
			if (service.startActivation?.[PATCH_MARKER] === true) warn("pin-subagent-model: `subagents.startActivation` still carries the pin decoration after restore");
		};
	}, "pin-subagent-model: decorate subagents.startActivation");
}

export { apply, inject, name };
export default { apply, Config, inject, name };
