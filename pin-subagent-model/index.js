/**
 * Pin every delegated child Agent to one LLM route.
 *
 * Why this exists: omitting `provider`/`model` in a delegation tool call makes
 * the child inherit the parent Agent's live route (`resolveChildAgentOptions`
 * in `@deepseek-ai/dsh-subagent`), and `subagent-model-selection-settings`
 * only gates *explicit* selections — `assertAllowedModelSelection` returns
 * early when the call names no route. So a profile that wants every child on
 * one model cannot express that with settings or preset tool config alone.
 *
 * The seam: `SubagentRuntime.startActivation(spec)` runs before `startLocal`,
 * which is where `resolveChildAgentOptions` reads `spec.request.agentOptions`.
 * Rewriting that field here converges inherited routes and explicit requests
 * on the pinned route, without touching the agent preset that owns the
 * `subagent`/`subagent_fork` tool rows.
 *
 * Config, normally an id-targeted override of the `pin-subagent-model` entry in
 * the profile's `cordis.patch.yml`:
 * - `provider` (required) — LLM provider id for children.
 * - `model` (required) — model id for children.
 * - `reasoningEffort` (optional) — pin the adapter effort too; omit to keep
 *   whatever effort the child would otherwise inherit or default to.
 * - `providers` (optional) — subagent backends to pin; default
 *   `['spawn', 'fork']`. Drop `fork` to keep forked children on the parent
 *   route so the inherited conversation prefix stays cache-eligible.
 * - `onConflict` (optional) — `'override'` (default) rewrites a differing
 *   explicit request and logs it; `'reject'` throws instead.
 *
 * The bundle layer registers the entry without a route, so enabling it in the
 * plugin manager before configuring it is safe: it logs one warning and pins
 * nothing instead of failing the profile.
 */

const DEFAULT_PROVIDERS = ["spawn", "fork"];

/**
 * Validate the plugin config.
 * @param config - raw loader config.
 * @returns the normalized pin, or undefined while `provider`/`model` are unset.
 * @throws when a supplied field has an unusable shape.
 */
function readPin(config) {
	const provider = typeof config?.provider === "string" ? config.provider.trim() : "";
	const model = typeof config?.model === "string" ? config.model.trim() : "";
	if (config?.onConflict !== void 0 && config.onConflict !== "override" && config.onConflict !== "reject") throw new Error("pin-subagent-model: `onConflict` must be 'override' or 'reject'");
	if (provider.length === 0 || model.length === 0) return void 0;
	const effort = typeof config?.reasoningEffort === "string" ? config.reasoningEffort.trim() : "";
	const providers = Array.isArray(config?.providers) && config.providers.length > 0 ? config.providers.map((name) => String(name)) : DEFAULT_PROVIDERS;
	return {
		provider,
		model,
		effort: effort.length === 0 ? void 0 : effort,
		providers: new Set(providers),
		onConflict: config?.onConflict ?? "override"
	};
}

/**
 * Rewrite one delegation spec onto the pinned route.
 * @param spec - the activation spec handed to the subagents service.
 * @param pin - validated pin.
 * @param warn - conflict sink.
 * @returns the original spec when it needs no rewrite, else a detached copy.
 */
function pinnedSpec(spec, pin, warn) {
	if (spec?.request === void 0) return spec;
	const request = spec.request;
	const current = request.agentOptions;
	if (current?.provider !== void 0 && (current.provider !== pin.provider || current.model !== pin.model)) {
		if (pin.onConflict === "reject") throw new Error(`pin-subagent-model: delegation requested ${current.provider}/${current.model}, but this profile pins child Agents to ${pin.provider}/${pin.model}`);
		warn(`pin-subagent-model: overriding requested child route ${current.provider}/${current.model} with ${pin.provider}/${pin.model}`);
	}
	return {
		...spec,
		request: {
			...request,
			agentOptions: {
				...current,
				provider: pin.provider,
				model: pin.model,
				...pin.effort === void 0 ? {} : { reasoningEffort: pin.effort }
			}
		}
	};
}

const name = "pin-subagent-model";
const inject = ["subagents"];

/**
 * Decorate the live `subagents` service so every child activation is pinned.
 * @param ctx - plugin context with `subagents` available.
 * @param config - pin config.
 */
function apply(ctx, config) {
	const pin = readPin(config);
	if (pin === void 0) {
		ctx.logger?.warn?.("pin-subagent-model: no `provider`/`model` configured, so no child route is pinned. Set them on the `pin-subagent-model` entry in the profile's cordis.patch.yml.");
		return;
	}
	const service = ctx.subagents;
	const startActivation = service.startActivation;
	if (typeof startActivation !== "function") throw new Error("pin-subagent-model: `subagents.startActivation` is unavailable");
	const warn = (message) => {
		try {
			ctx.logger?.warn?.(message);
		} catch {}
	};
	ctx.effect(() => {
		service.startActivation = function pinnedStartActivation(spec) {
			if (!pin.providers.has(spec?.provider)) return startActivation.call(this, spec);
			return startActivation.call(this, pinnedSpec(spec, pin, warn));
		};
		return () => {
			service.startActivation = startActivation;
		};
	}, "pin-subagent-model: decorate subagents.startActivation");
	ctx.logger?.info?.(`pin-subagent-model: child Agents pinned to ${pin.provider}/${pin.model}${pin.effort === void 0 ? "" : ` (${pin.effort})`} for ${[...pin.providers].join(", ")}`);
}

export { apply, inject, name };
export default { apply, inject, name };
