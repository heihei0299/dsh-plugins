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

const DEFAULT_PROVIDERS = ["spawn", "fork"];

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

/**
 * Read one configuration field, which may be a live volatile reference.
 * @param field - raw or `{ get() }` configuration value.
 * @returns the current plain value, or undefined.
 */
function readValue(field) {
	return field !== null && typeof field === "object" && typeof field.get === "function" ? field.get() : field;
}

/**
 * Normalize an optional string field.
 * @param value - raw field value.
 * @returns the trimmed string, or "" when unusable.
 */
function text(value) {
	return typeof value === "string" ? value.trim() : "";
}

/**
 * Validate the plugin config.
 * @param config - raw loader config, possibly holding live volatile references.
 * @returns the normalized pin, or undefined while no route and no preset are set.
 * @throws when a supplied field has an unusable shape.
 */
function readPin(config) {
	const onConflict = readValue(config?.onConflict);
	if (onConflict !== void 0 && onConflict !== "override" && onConflict !== "reject") throw new Error("pin-subagent-model: `onConflict` must be 'override' or 'reject'");
	const provider = text(readValue(config?.provider));
	const model = text(readValue(config?.model));
	const preset = text(readValue(config?.agentPreset));
	const route = provider.length > 0 && model.length > 0 ? {
		provider,
		model,
		effort: text(readValue(config?.reasoningEffort)) || void 0
	} : void 0;
	if (route === void 0 && preset.length === 0) return void 0;
	const configured = readValue(config?.providers);
	const providers = Array.isArray(configured) && configured.length > 0 ? configured.map((name) => String(name)) : DEFAULT_PROVIDERS;
	return {
		route,
		preset: preset.length === 0 ? void 0 : preset,
		providers: new Set(providers),
		onConflict: onConflict ?? "override"
	};
}

/**
 * Whether one registered backend accepts an independently selected preset.
 * Mirrors the runtime capability gate in `SubagentRuntime.assertCapabilities`.
 * @param provider - registered provider, or undefined when it is not registered.
 * @returns true when `request.agentPreset` is accepted by this backend.
 */
function supportsIndependentPreset(provider) {
	return provider !== void 0
		&& provider !== null
		&& provider.capabilities?.agentPreset === true
		&& provider.inheritsParentContext !== true;
}

/**
 * Rewrite one delegation spec onto the pinned route and preset.
 * @param spec - the activation spec handed to the subagents service.
 * @param pin - normalized pin.
 * @param warn - conflict sink.
 * @param canPinPreset - whether the target backend accepts an independent preset.
 * @returns the original spec when it needs no rewrite, else a detached copy.
 */
function pinnedSpec(spec, pin, warn, canPinPreset) {
	if (spec?.request === void 0) return spec;
	const request = spec.request;
	const current = request.agentOptions;
	const wantsRoute = pin.route !== void 0;
	const wantsPreset = pin.preset !== void 0 && canPinPreset;
	if (wantsRoute && current?.provider !== void 0 && (current.provider !== pin.route.provider || current.model !== pin.route.model)) {
		if (pin.onConflict === "reject") throw new Error(`pin-subagent-model: delegation requested ${current.provider}/${current.model}, but this profile pins child Agents to ${pin.route.provider}/${pin.route.model}`);
		warn(`pin-subagent-model: overriding requested child route ${current.provider}/${current.model} with ${pin.route.provider}/${pin.route.model}`);
	}
	if (wantsPreset && request.agentPreset !== void 0 && request.agentPreset !== pin.preset) {
		if (pin.onConflict === "reject") throw new Error(`pin-subagent-model: delegation requested child agent preset "${request.agentPreset}", but this profile pins child Agents to preset "${pin.preset}"`);
		warn(`pin-subagent-model: overriding requested child agent preset "${request.agentPreset}" with "${pin.preset}"`);
	}
	if (!wantsRoute && !wantsPreset) return spec;
	return {
		...spec,
		request: {
			...request,
			...wantsPreset ? { agentPreset: pin.preset } : {},
			...wantsRoute ? {
				agentOptions: {
					...current,
					provider: pin.route.provider,
					model: pin.route.model,
					...pin.route.effort === void 0 ? {} : { reasoningEffort: pin.route.effort }
				}
			} : {}
		}
	};
}

const name = "pin-subagent-model";
const inject = ["subagents"];

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
	const presetSkipped = new Set();
	ctx.effect(() => {
		service.startActivation = function pinnedStartActivation(spec) {
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
		return () => {
			service.startActivation = startActivation;
		};
	}, "pin-subagent-model: decorate subagents.startActivation");
}

export { apply, inject, name };
export default { apply, Config, inject, name };
