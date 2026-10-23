import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const clientSource = readFileSync(path.join(root, "client.js"), "utf8");

const PARENT_ROUTE = { provider: "cpa", model: "parent-model", reasoningEffort: "low" };
const OWN_ROUTE = { provider: "cpa", model: "cline-pass/deepseek-v4.1-flash", reasoningEffort: "max" };
const LATER_OWN_ROUTE = { provider: "cpa", model: "gpt-6.1-sol" };
const PATH_ROUTE = { provider: "cpa", model: "accounts/team/gpt-6.1-sol", reasoningEffort: "xhigh" };
const PENDING_ROUTE = { provider: "cpa", model: "pending-model" };
const CHILD = { address: { parentSessionId: "parent", childSessionId: "child-1", mode: "continuable" } };
const OTHER_CHILD = { address: { parentSessionId: "parent", childSessionId: "child-2", mode: "continuable" } };
const CHILD_IDENTITY = { mode: "continuable", label: "task", seq: 10 };
const OTHER_CHILD_IDENTITY = { mode: "continuable", label: "task", seq: 20 };

const FORBIDDEN_PROPS = new Set([
	"useInput",
	"inputActions",
	"useConversation",
	"useChat",
	"navigation",
	"editor",
	"setDraft",
	"setText",
	"selectModel",
	"retain",
	"send"
]);

let loaded;

/** Evaluate the browser loader once and materialize its factory with a React stub. */
function loadClient() {
	if (loaded !== undefined) return loaded;
	let registration;
	const sandbox = {
		window: {
			__ModuleLoader__: {
				load(value) {
					assert.equal(registration, undefined, "the client bundle must register exactly one factory");
					registration = value;
				}
			}
		}
	};
	vm.runInNewContext(clientSource, sandbox, { timeout: 2_000 });
	assert.ok(registration, "the client bundle must call window.__ModuleLoader__.load");
	const requires = [];
	const React = {
		lastStop: undefined,
		createElement(type, props, ...children) {
			return { type, props, children };
		},
		useCallback(callback) {
			return callback;
		},
		useEffect() {},
		useMemo(factory) {
			return factory();
		},
		useRef(initial) {
			return { current: initial };
		},
		useState(initial) {
			return [typeof initial === "function" ? initial() : initial, () => {}];
		},
		useSyncExternalStore(subscribe, getSnapshot) {
			React.lastStop = subscribe(() => {});
			return getSnapshot();
		}
	};
	const plugin = registration.factory((name) => {
		requires.push(name);
		assert.equal(name, "react", "the build-free client bundle may require only the host React table");
		return React;
	});
	loaded = { registration, plugin, requires, React };
	return loaded;
}

/** One Host ConfigForm stand-in. */
function fakeForm({ status = "ready", value = {}, writable = true, revision = 3 } = {}) {
	const listeners = new Set();
	const form = {
		writes: [],
		snapshot: { status, value, writable, revision },
		getSnapshot() {
			return form.snapshot;
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		async mutate(ops, expectedRevision) {
			form.writes.push({ ops, expectedRevision });
			return true;
		}
	};
	return form;
}

/** Minimal client context capturing registration and cleanup calls. */
function fakeCtx(sessions = { binding() {} }, form = fakeForm()) {
	const ctx = {
		effects: [],
		locales: [],
		injected: [],
		registrations: [],
		sessions,
		form,
		formIds: [],
		configForms: {
			get(id) {
				ctx.formIds.push(id);
				return form;
			}
		},
		remote: {
			agentPresets: {
				async list() {
					return { presets: [{ id: "standard", name: "Standard", isDefault: true }, { id: "minimal" }] };
				}
			}
		},
		effect(factory) {
			const dispose = factory();
			ctx.effects.push(dispose);
			return dispose;
		},
		locale: {
			register(namespace, dictionaries) {
				const row = { namespace, dictionaries, removed: false };
				ctx.locales.push(row);
				return () => {
					row.removed = true;
				};
			}
		},
		slots: {
			inject(name, factory) {
				ctx.injected.push(name);
				return factory();
			},
			register(options, component) {
				ctx.registrations.push({ options, component });
				return () => {};
			}
		}
	};
	// The plugin must never reach for navigation or editor services. These getters
	// turn any such access during apply into a test failure.
	for (const name of ["navigation", "editor", "inputActions"]) {
		Object.defineProperty(ctx, name, {
			enumerable: false,
			get() {
				throw new Error(`plugin must not read ctx.${name}`);
			}
		});
	}
	return ctx;
}

/** Read one registration by slot name. */
function registrationOf(ctx, name) {
	const registration = ctx.registrations.find((entry) => entry.options.name === name);
	assert.ok(registration, `the plugin must register the ${name} slot`);
	return registration;
}

/** One durable request/header window entry. */
function requestHeader(seq, route) {
	return {
		type: "event",
		event: {
			type: "request/header",
			seq,
			time: seq,
			data: { header: { config: { ...route } } }
		}
	};
}

/** One current Session event window around the supplied entries. */
function eventWindow(entries, hasMore = false) {
	return {
		entries,
		hasMore,
		revision: 1,
		change: { kind: "replace", entries: [] }
	};
}

/** Props that fail the test if the component reaches outside its read-only contract. */
function guardedProps(values) {
	return new Proxy(values, {
		get(target, key, receiver) {
			if (typeof key === "string" && FORBIDDEN_PROPS.has(key)) {
				throw new Error(`component must not read ${key}`);
			}
			return Reflect.get(target, key, receiver);
		}
	});
}

/** Render the registered composer entry with explicit standard and injected props. */
function renderBadge({ subagent, identity, window, projections = {}, sessionId = "child-1" }) {
	const { plugin, React } = loadClient();
	React.lastStop = undefined;
	let source;
	if (window !== undefined) {
		source = {
			subscribes: 0,
			stops: 0,
			snapshots: 0,
			listener: undefined,
			subscribe(listener) {
				source.subscribes += 1;
				source.listener = listener;
				return () => {
					source.stops += 1;
				};
			},
			getSnapshot() {
				source.snapshots += 1;
				return window;
			}
		};
	}
	const sessions = new Proxy({
		bindingCalls: [],
		binding(id) {
			sessions.bindingCalls.push(id);
			return id === sessionId && source !== undefined ? { eventSource: source } : undefined;
		}
	}, {
		get(target, key, receiver) {
			if (key !== "binding" && typeof key === "string" && !key.startsWith("binding")) {
				throw new Error(`component must not read sessions.${key}`);
			}
			return Reflect.get(target, key, receiver);
		}
	});
	const ctx = fakeCtx(sessions);
	plugin.apply(ctx);
	const registration = registrationOf(ctx, "conversation.input.right");
	assert.equal(typeof registration.component, "function");
	const injected = registration.options.inject();
	assert.equal(injected.sessions, sessions, "the entry must use the injected sessions face");
	const requested = [];
	const values = { subagent: identity, ...projections };
	const badge = registration.component(guardedProps({
		sessionId,
		sessions: injected.sessions,
		useSession: (selector) => selector({ subagent }),
		useProjection: (key) => {
			requested.push(key);
			return values[key];
		},
		t: (key) => key
	}));
	return { badge, requested, source, sessions, stop: React.lastStop };
}

test("registers one lazy factory for the package and injects the client services", () => {
	const { registration, plugin, requires } = loadClient();
	assert.equal(registration.id, manifest.name);
	assert.equal(typeof registration.factory, "function");
	assert.deepEqual(requires, ["react"]);
	assert.equal(typeof plugin.apply, "function");
	// The plugin object comes from another vm realm; copy before strict deepEqual.
	assert.deepEqual(Array.from(plugin.inject), ["slots", "locale", "sessions", "configForms", "remote", "remote.agentPresets"]);
});

test("registers the additive composer entry and the row configuration page", async () => {
	const { plugin } = loadClient();
	const ctx = fakeCtx();
	plugin.apply(ctx);
	assert.equal(ctx.effects.length, 1, "the locale registration must ride ctx.effect");
	assert.equal(ctx.locales.length, 1);
	assert.equal(ctx.locales[0].namespace, "pin-subagent-model");
	assert.equal(ctx.locales[0].dictionaries.en["model.label"], "Subagent model");
	assert.equal(ctx.locales[0].dictionaries.zh["model.label"], "子代理模型");
	assert.equal(ctx.locales[0].dictionaries.en["settings.preset.inherit"], "Inherit the parent preset");
	assert.equal(ctx.locales[0].dictionaries.zh["settings.preset.inherit"], "继承父会话预设");
	assert.deepEqual(ctx.injected, ["conversation.input.right", "plugins.row.config"]);
	assert.deepEqual(ctx.formIds, ["pin-subagent-model"]);
	const chip = registrationOf(ctx, "conversation.input.right");
	assert.equal(chip.options.id, "pin-subagent-model");
	assert.equal(chip.options.order, 100);
	assert.equal(chip.options.locale, "pin-subagent-model");
	assert.deepEqual(Object.keys(chip.options.inject()), ["sessions"]);
	const row = registrationOf(ctx, "plugins.row.config");
	assert.equal(row.options.key, "dsh-plugin-pin-subagent-model#pin-subagent-model");
	assert.equal(row.options.locale, "pin-subagent-model");
	const injected = row.options.inject();
	assert.equal(injected.configForm, ctx.form);
	assert.equal(typeof injected.listPresets, "function");
	const roster = await injected.listPresets();
	assert.deepEqual(roster.presets.map((preset) => preset.id), ["standard", "minimal"]);
	assert.equal(ctx.injected.includes("conversation.input.model"), false,
		"the native single model seat must never be registered or replaced");
	assert.equal(ctx.injected.some((name) => name.startsWith("conversation.session.header")), false,
		"the plugin must not contribute any header slot");
	assert.doesNotMatch(clientSource, /conversation\.session\.header/,
		"the client source must contain no header registration");
	ctx.effects[0]();
	assert.equal(ctx.locales[0].removed, true, "disposing the plugin must remove the locale row");
});

test("reduces the form value to the four editable strings", () => {
	const { plugin } = loadClient();
	assert.deepEqual({ ...plugin.draftFromConfig({ provider: "cpa", model: "m", reasoningEffort: "max", agentPreset: "minimal", providers: ["spawn"] }) },
		{ provider: "cpa", model: "m", reasoningEffort: "max", agentPreset: "minimal" });
	assert.deepEqual({ ...plugin.draftFromConfig(undefined) }, { provider: "", model: "", reasoningEffort: "", agentPreset: "" });
	assert.deepEqual({ ...plugin.draftFromConfig({ provider: 3, model: null }) }, { provider: "", model: "", reasoningEffort: "", agentPreset: "" });
});

test("lists inherit, every declared preset, and an undeclared current value", () => {
	const { plugin } = loadClient();
	const options = plugin.presetOptions([
		{ id: "standard", name: "Standard", isDefault: true },
		{ id: "minimal" },
		{ id: "standard", name: "Duplicate" },
		{ id: "" },
		null
	], "retired");
	assert.deepEqual(Array.from(options, (option) => option.id), ["", "standard", "minimal", "retired"]);
	assert.equal(options[1].label, "Standard");
	assert.equal(options[3].missing, true);
	assert.equal(options[2].label, void 0);
	const broken = plugin.presetOptions([{ id: "old", broken: "activation failed" }], "");
	assert.equal(broken[1].broken, true);
	assert.equal(plugin.presetLabel({ id: "", missing: false, broken: false }, (key) => key), "settings.preset.inherit");
	assert.equal(plugin.presetLabel({ id: "retired", missing: true, broken: false }, (key) => key), "retired settings.preset.missing");
	assert.equal(plugin.presetLabel({ id: "old", missing: false, broken: true }, (key) => key), "old settings.preset.broken");
});

test("unwraps the agentPresets list envelope and keeps refusals distinct from an empty roster", () => {
	const { plugin } = loadClient();
	const read = (result) => JSON.parse(JSON.stringify(plugin.rosterFromResult(result)));
	assert.deepEqual(read({ ok: true, value: { presets: [{ id: "standard", isDefault: true }] } }), { status: "ready", presets: [{ id: "standard", isDefault: true }] });
	assert.deepEqual(read({ ok: true, value: {} }), { status: "ready", presets: [] });
	assert.deepEqual(read({ ok: false, error: { code: "gateway/unavailable", message: "offline" } }), { status: "error", presets: [] });
	assert.deepEqual(read({ presets: [{ id: "minimal" }] }), { status: "ready", presets: [{ id: "minimal" }] });
	assert.deepEqual(read(undefined), { status: "ready", presets: [] });
});

test("validates the provider/model pair and the preset before saving", () => {
	const { plugin } = loadClient();
	const options = plugin.presetOptions([{ id: "standard" }, { id: "minimal" }], "");
	const draft = (values) => ({ provider: "", model: "", reasoningEffort: "", agentPreset: "", ...values });
	assert.equal(plugin.validateDraft(draft({ provider: "cpa" }), options), "settings.invalidRoute");
	assert.equal(plugin.validateDraft(draft({ model: "m" }), options), "settings.invalidRoute");
	assert.equal(plugin.validateDraft(draft({ provider: "cpa", model: "m", agentPreset: "gone" }), options), "settings.invalidPreset");
	assert.equal(plugin.validateDraft(draft({ provider: "cpa", model: "m", agentPreset: "minimal" }), options), null);
	assert.equal(plugin.validateDraft(draft({}), options), null);
});

test("builds set and unset operations only for changed fields", () => {
	const { plugin } = loadClient();
	const accepted = { provider: "cpa", model: "m", reasoningEffort: "max", agentPreset: "minimal" };
	assert.deepEqual(Array.from(plugin.buildOps({ ...accepted }, accepted)), []);
	const changed = { provider: "cpa", model: "m2", reasoningEffort: "", agentPreset: "standard" };
	assert.deepEqual(JSON.parse(JSON.stringify(plugin.buildOps(changed, accepted))), [
		{ op: "set", path: ["model"], value: "m2" },
		{ op: "unset", path: ["reasoningEffort"] },
		{ op: "set", path: ["agentPreset"], value: "standard" }
	]);
});

test("renders a one-line summary and the editable page", () => {
	const { plugin } = loadClient();
	const row = registrationOf(fakeCtxAfterApply(plugin), "plugins.row.config");
	const summary = row.component({ view: "summary", t: (key) => key });
	assert.equal(summary, "settings.summary");
	const entry = row.component({
		view: "page",
		t: (key) => key,
		configForm: fakeForm({ value: { provider: "cpa", model: "cline-pass/deepseek-v4.1-flash", reasoningEffort: "max", agentPreset: "minimal" } }),
		listPresets: async () => ({ presets: [{ id: "standard" }, { id: "minimal" }] })
	});
	const page = typeof entry?.type === "function" ? entry.type(entry.props) : entry;
	const fields = descendants(page).filter((node) => node !== null && typeof node === "object" && node.props !== undefined && node.props !== null && node.props["data-field"] !== undefined);
	assert.deepEqual(fields.map((field) => field.props["data-field"]), ["provider", "model", "reasoningEffort", "agentPreset"]);
	assert.equal(fields[0].props.value, "cpa");
	assert.equal(fields[3].props.value, "minimal");
	assert.equal(fields[3].type, "select");
	const buttons = descendants(page).filter((node) => node !== null && typeof node === "object" && node.type === "button");
	assert.deepEqual(buttons.map((button) => button.children[0]), ["settings.save", "settings.reset"]);
	assert.ok(textOf(page).includes("settings.advanced"), "the page explains where the ordinary fields live");
	const unavailableEntry = row.component({ view: "page", t: (key) => key, configForm: fakeForm({ status: "unavailable" }), listPresets: async () => ({ presets: [] }) });
	const unavailable = typeof unavailableEntry?.type === "function" ? unavailableEntry.type(unavailableEntry.props) : unavailableEntry;
	assert.equal(textOf(unavailable), "settings.unavailable");
});

test("saves edited fields with the revision read before editing, and keeps the draft on refusal", async () => {
	const { plugin, React } = loadClient();
	const row = registrationOf(fakeCtxAfterApply(plugin), "plugins.row.config");
	const form = fakeForm({ value: { provider: "cpa", model: "m", reasoningEffort: "", agentPreset: "standard" }, revision: 7 });
	const states = [];
	let cursor = 0;
	const original = React.useState;
	React.useState = (initial) => {
		const index = cursor++;
		if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
		return [states[index], (next) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
	};
	const render = () => {
		cursor = 0;
		const entry = row.component({
			view: "page",
			t: (key) => key,
			configForm: form,
			listPresets: async () => ({ presets: [{ id: "standard" }, { id: "minimal" }] })
		});
		return typeof entry?.type === "function" ? entry.type(entry.props) : entry;
	};
	try {
		const model = descendants(render()).find((node) => node?.props?.["data-field"] === "model");
		model.props.onChange({ currentTarget: { value: "m2" } });
		const save = descendants(render()).find((node) => node.type === "button" && node.children[0] === "settings.save");
		save.props.onClick();
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.deepEqual(JSON.parse(JSON.stringify(form.writes)), [{ ops: [{ op: "set", path: ["model"], value: "m2" }], expectedRevision: 7 }]);
		assert.deepEqual(JSON.parse(JSON.stringify(states[2])), { kind: "saved" });
		form.mutate = async () => false;
		states[0].model = "m3";
		states[1] = true;
		const refuse = descendants(render()).find((node) => node.type === "button" && node.children[0] === "settings.save");
		refuse.props.onClick();
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.deepEqual(JSON.parse(JSON.stringify(states[2])), { kind: "refused" });
	} finally {
		React.useState = original;
	}
});

/** Apply the plugin to a fresh fake context and return it. */
function fakeCtxAfterApply(plugin) {
	const ctx = fakeCtx();
	plugin.apply(ctx);
	return ctx;
}

/** Collect every rendered node, depth first. */
function descendants(node) {
	if (node === null || node === undefined || typeof node !== "object") return [];
	return [node, ...(Array.isArray(node.children) ? node.children : []).flatMap(descendants)];
}

/** Concatenate the text children of a rendered tree. */
function textOf(node) {
	if (typeof node === "string") return node;
	if (node === null || node === undefined || typeof node !== "object") return "";
	return (Array.isArray(node.children) ? node.children : []).map(textOf).join("");
}

test("renders nothing on an ordinary root session and does not borrow its event source", () => {
	const { badge, requested, source, sessions } = renderBadge({
		subagent: null,
		identity: CHILD_IDENTITY,
		window: eventWindow([requestHeader(11, OWN_ROUTE)]),
		projections: { modelSelection: { lastUsed: OWN_ROUTE, next: OWN_ROUTE } }
	});
	assert.equal(badge, null);
	assert.deepEqual(requested, ["subagent"]);
	assert.equal(source.subscribes, 0, "a root session must not subscribe to a child event window");
	assert.equal(source.snapshots, 0, "a root session must not read a child event window");
	assert.deepEqual(sessions.bindingCalls, [], "a root session must not look up a child binding");
});

test("renders nothing without a child descriptor identity", () => {
	for (const identity of [null, undefined]) {
		const { badge } = renderBadge({
			subagent: CHILD,
			identity,
			window: eventWindow([requestHeader(11, OWN_ROUTE)])
		});
		assert.equal(badge, null);
	}
});

test("does not treat a completed turn without its own request header as a model call", () => {
	const { badge, requested } = renderBadge({
		subagent: CHILD,
		identity: CHILD_IDENTITY,
		// A turn can end without any child request/header, and lastUsed can still
		// carry the fork seed's parent route. Hide rather than report the parent.
		window: eventWindow([requestHeader(5, PARENT_ROUTE)]),
		projections: {
			modelSelection: { lastUsed: PARENT_ROUTE, next: PARENT_ROUTE },
			subagentTiming: { settledMs: 4_200, lastTurnCompleted: true }
		}
	});
	assert.equal(badge, null);
	assert.deepEqual(requested, ["subagent"], "modelSelection and subagentTiming are not display evidence");
});

test("does not display a fork seed's inherited lastUsed without an own request", () => {
	const { badge } = renderBadge({
		subagent: CHILD,
		identity: CHILD_IDENTITY,
		window: eventWindow([
			requestHeader(3, PARENT_ROUTE),
			requestHeader(5, PARENT_ROUTE)
		]),
		projections: { modelSelection: { lastUsed: PARENT_ROUTE, next: PARENT_ROUTE } }
	});
	assert.equal(badge, null, "inherited seed headers sit before identity.seq and must stay invisible");
});

test("shows the child's own request header before the first turn completes", () => {
	const { badge } = renderBadge({
		subagent: CHILD,
		identity: CHILD_IDENTITY,
		window: eventWindow([
			requestHeader(5, PARENT_ROUTE),
			requestHeader(12, OWN_ROUTE)
		])
	});
	assert.ok(badge, "the own request header is sufficient evidence during the first turn");
	assert.equal(badge.type, "span");
	assert.equal(badge.props.role, "note");
	assert.equal(badge.props["data-subagent-model"], "cpa/cline-pass/deepseek-v4.1-flash · max");
	assert.equal(badge.props["data-subagent-model-short"], "deepseek-v4.1-flash");
	assert.equal(badge.props["data-subagent-effort"], "max");
	assert.equal(badge.props.title, "cpa/cline-pass/deepseek-v4.1-flash · max");
	assert.equal(badge.props["aria-label"], "model.label: cpa/cline-pass/deepseek-v4.1-flash · max");
	assert.match(String(badge.props.style.maxWidth), /vw/, "the chip must stay narrow on phones");
	assert.equal(badge.children.length, 2);
	assert.equal(badge.children[0].type, "span");
	assert.deepEqual(badge.children[0].children, ["deepseek-v4.1-flash"]);
	assert.equal(badge.children[0].props["aria-hidden"], true);
	assert.equal(badge.children[0].props.style.textOverflow, "ellipsis");
	assert.equal(badge.children[1].type, "span");
	assert.deepEqual(badge.children[1].children, ["max"]);
	assert.match(badge.children[1].props.style.color, /label-tertiary/);
	for (const key of ["onClick", "onKeyDown", "onMouseDown", "tabIndex", "href", "aria-haspopup"]) {
		assert.equal(badge.props[key], undefined, `the chip must have no ${key}`);
	}
	assert.equal(badge.children.some((child) => child?.props?.onClick !== undefined), false);
	assert.equal(badge.children.some((child) => child?.props?.role === "button"), false);
});

test("keeps the full route in the tooltip while showing only the last model segment", () => {
	const { badge } = renderBadge({
		subagent: CHILD,
		identity: CHILD_IDENTITY,
		window: eventWindow([requestHeader(12, PATH_ROUTE)])
	});
	assert.ok(badge);
	assert.equal(badge.props["data-subagent-model"], "cpa/accounts/team/gpt-6.1-sol · xhigh");
	assert.equal(badge.props["data-subagent-model-short"], "gpt-6.1-sol");
	assert.equal(badge.props.title, "cpa/accounts/team/gpt-6.1-sol · xhigh");
	assert.deepEqual(badge.children[0].children, ["gpt-6.1-sol"]);
	assert.deepEqual(badge.children[1].children, ["xhigh"]);
});

test("omits the effort span when the request carried no effort", () => {
	const { badge } = renderBadge({
		subagent: CHILD,
		identity: CHILD_IDENTITY,
		window: eventWindow([requestHeader(12, LATER_OWN_ROUTE)])
	});
	assert.ok(badge);
	assert.equal(badge.props["data-subagent-model"], "cpa/gpt-6.1-sol");
	assert.equal(badge.props["data-subagent-effort"], undefined);
	assert.equal(badge.children.length, 1);
});

test("subscribes once to the retained event source and releases it on stop", () => {
	const { badge, source, stop } = renderBadge({
		subagent: CHILD,
		identity: CHILD_IDENTITY,
		window: eventWindow([requestHeader(12, OWN_ROUTE)])
	});
	assert.ok(badge);
	assert.equal(typeof source.listener, "function");
	assert.equal(source.subscribes, 1, "the component must borrow exactly one event-source subscription");
	assert.equal(source.stops, 0);
	assert.equal(typeof stop, "function", "useSyncExternalStore must receive the source unsubscribe");
	stop();
	assert.equal(source.stops, 1);
});

test("uses the actual request header even when modelSelection has not caught up", () => {
	const { badge } = renderBadge({
		subagent: CHILD,
		identity: CHILD_IDENTITY,
		window: eventWindow([requestHeader(12, OWN_ROUTE)]),
		// The projection may still be on another frame, or may carry a pending
		// selection. Neither may override the request the child actually sent.
		projections: { modelSelection: { lastUsed: PENDING_ROUTE, next: PENDING_ROUTE } }
	});
	assert.ok(badge);
	assert.equal(badge.props["data-subagent-model"], "cpa/cline-pass/deepseek-v4.1-flash · max");
});

test("follows the latest own request header as the session updates", () => {
	const { badge } = renderBadge({
		subagent: CHILD,
		identity: CHILD_IDENTITY,
		window: eventWindow([
			requestHeader(12, OWN_ROUTE),
			requestHeader(15, LATER_OWN_ROUTE)
		], true)
	});
	assert.ok(badge);
	assert.equal(badge.props["data-subagent-model"], "cpa/gpt-6.1-sol");
});

test("renders nothing when no retained binding exposes an event window", () => {
	const { badge, sessions } = renderBadge({
		subagent: CHILD,
		identity: CHILD_IDENTITY,
		window: undefined,
		projections: {
			modelSelection: { lastUsed: OWN_ROUTE, next: OWN_ROUTE },
			subagentTiming: { settledMs: 4_200, lastTurnCompleted: true }
		}
	});
	assert.equal(badge, null);
	assert.deepEqual(sessions.bindingCalls, ["child-1"]);
});

test("child, parent, and another child never share a previous route", () => {
	const first = renderBadge({
		subagent: CHILD,
		identity: CHILD_IDENTITY,
		window: eventWindow([requestHeader(12, OWN_ROUTE)]),
		sessionId: "child-1"
	});
	assert.equal(first.badge.props["data-subagent-model"], "cpa/cline-pass/deepseek-v4.1-flash · max");

	const parent = renderBadge({
		subagent: null,
		identity: CHILD_IDENTITY,
		window: eventWindow([requestHeader(12, OWN_ROUTE)]),
		sessionId: "parent"
	});
	assert.equal(parent.badge, null);
	assert.deepEqual(parent.sessions.bindingCalls, []);

	const otherEmpty = renderBadge({
		subagent: OTHER_CHILD,
		identity: OTHER_CHILD_IDENTITY,
		window: eventWindow([]),
		sessionId: "child-2"
	});
	assert.equal(otherEmpty.badge, null, "a different child must not inherit the previous child's route");

	const other = renderBadge({
		subagent: OTHER_CHILD,
		identity: OTHER_CHILD_IDENTITY,
		window: eventWindow([requestHeader(22, PATH_ROUTE)]),
		sessionId: "child-2"
	});
	assert.equal(other.badge.props["data-subagent-model"], "cpa/accounts/team/gpt-6.1-sol · xhigh");
});

test("lastOwnRequestHeader ignores inherited and transient entries", () => {
	const { plugin } = loadClient();
	const window = eventWindow([
		requestHeader(5, PARENT_ROUTE),
		{ type: "transient", event: { type: "assistant/live-chunk", seq: 11, time: 11, data: {} } },
		requestHeader(12, OWN_ROUTE)
	]);
	assert.equal(plugin.lastOwnRequestHeader(window, CHILD_IDENTITY).model, "cline-pass/deepseek-v4.1-flash");
	const unordered = eventWindow([
		requestHeader(15, LATER_OWN_ROUTE),
		requestHeader(12, OWN_ROUTE)
	]);
	assert.equal(plugin.lastOwnRequestHeader(unordered, CHILD_IDENTITY).model, "gpt-6.1-sol");
	assert.equal(plugin.lastOwnRequestHeader(window, { mode: "continuable", label: "task", seq: 12 }), null);
	assert.equal(plugin.lastOwnRequestHeader(undefined, CHILD_IDENTITY), null);
	assert.equal(plugin.lastOwnRequestHeader({ entries: undefined }, CHILD_IDENTITY), null);
});

test("selectActualRoute and the compact formatter are the single display decision", () => {
	const { plugin } = loadClient();
	assert.equal(plugin.selectActualRoute(null, CHILD_IDENTITY, OWN_ROUTE), null);
	assert.equal(plugin.selectActualRoute(CHILD, null, OWN_ROUTE), null);
	assert.equal(plugin.selectActualRoute(CHILD, CHILD_IDENTITY, null), null);
	assert.equal(plugin.selectActualRoute(CHILD, CHILD_IDENTITY, OWN_ROUTE), OWN_ROUTE);
	assert.equal(plugin.routeText(OWN_ROUTE), "cpa/cline-pass/deepseek-v4.1-flash · max");
	assert.equal(plugin.routeText({ provider: "cpa", model: "plain" }), "cpa/plain");
	assert.equal(plugin.shortModelName(OWN_ROUTE), "deepseek-v4.1-flash");
	assert.equal(plugin.shortModelName({ provider: "cpa", model: "plain" }), "plain");
	assert.equal(plugin.shortModelName({ provider: "cpa", model: "team/path/" }), "path");
});
