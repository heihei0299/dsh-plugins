/**
 * Pure pin policy: normalize configuration, describe backend capabilities and
 * rewrite an activation spec. Kept out of the entry so each rule is testable
 * without a Cordis context.
 */

export const DEFAULT_PROVIDERS = ["spawn", "fork"];

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
export function readPin(config) {
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
export function supportsIndependentPreset(provider) {
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
export function pinnedSpec(spec, pin, warn, canPinPreset) {
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
