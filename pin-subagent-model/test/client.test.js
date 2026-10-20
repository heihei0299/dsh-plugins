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
const OWN_ROUTE = { provider: "cpa", model: "child-model", reasoningEffort: "max" };
const LATER_OWN_ROUTE = { provider: "cpa", model: "child-model-v2" };
const PENDING_ROUTE = { provider: "cpa", model: "pending-model" };
const CHILD_IDENTITY = { mode: "continuable", label: "task", seq: 10 };

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

/** Minimal client context capturing the registration and cleanup calls. */
function fakeCtx() {
	const ctx = {
		effects: [],
		locales: [],
		injected: [],
		registrations: [],
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
		},
		sessions: {
			binding() {
				return undefined;
			}
		}
	};
	return ctx;
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

/** Render the registered header component with explicit standard props. */
function renderBadge({ subagent, identity, window, projections = {}, sessionId = "child-1" }) {
	const { plugin, React } = loadClient();
	React.lastStop = undefined;
	const ctx = fakeCtx();
	plugin.apply(ctx);
	const component = ctx.registrations[0]?.component;
	assert.equal(typeof component, "function", "apply must register the header component");
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
	const sessions = {
		binding(id) {
			return id === sessionId && source !== undefined ? { eventSource: source } : undefined;
		}
	};
	const requested = [];
	const values = { subagent: identity, ...projections };
	const badge = component({
		sessionId,
		sessions,
		useSession: (selector) => selector({ subagent }),
		useProjection: (key) => {
			requested.push(key);
			return values[key];
		},
		t: (key) => key
	});
	return { badge, requested, source, stop: React.lastStop };
}

test("registers one lazy factory for the package and injects the client services", () => {
	const { registration, plugin, requires } = loadClient();
	assert.equal(registration.id, manifest.name);
	assert.equal(typeof registration.factory, "function");
	assert.deepEqual(requires, ["react"]);
	assert.equal(typeof plugin.apply, "function");
	// The plugin object comes from another vm realm; copy before strict deepEqual.
	assert.deepEqual(Array.from(plugin.inject), ["slots", "locale", "sessions"]);
});

test("registers the localized header action and tears the locale row down", () => {
	const { plugin } = loadClient();
	const ctx = fakeCtx();
	plugin.apply(ctx);
	assert.equal(ctx.effects.length, 1, "the locale registration must ride ctx.effect");
	assert.equal(ctx.locales.length, 1);
	assert.equal(ctx.locales[0].namespace, "pin-subagent-model");
	assert.equal(ctx.locales[0].dictionaries.en["model.label"], "Subagent model");
	assert.equal(ctx.locales[0].dictionaries.zh["model.label"], "子代理模型");
	assert.deepEqual(ctx.injected, ["conversation.session.header.actions"]);
	assert.equal(ctx.registrations.length, 1);
	const { options } = ctx.registrations[0];
	assert.equal(options.name, "conversation.session.header.actions");
	assert.equal(options.id, "pin-subagent-model");
	assert.equal(options.order, 0);
	assert.equal(options.locale, "pin-subagent-model");
	assert.equal(typeof options.inject, "function");
	const injected = options.inject();
	assert.equal(injected.sessions, ctx.sessions);
	ctx.effects[0]();
	assert.equal(ctx.locales[0].removed, true, "disposing the plugin must remove the locale row");
});

test("renders nothing on an ordinary root session, even with a request window", () => {
	const { badge, requested } = renderBadge({
		subagent: null,
		identity: CHILD_IDENTITY,
		window: eventWindow([requestHeader(11, OWN_ROUTE)]),
		projections: { modelSelection: { lastUsed: OWN_ROUTE, next: OWN_ROUTE } }
	});
	assert.equal(badge, null);
	assert.deepEqual(requested, ["subagent"]);
});

test("renders nothing without a child descriptor identity", () => {
	for (const identity of [null, undefined]) {
		const { badge } = renderBadge({
			subagent: { address: { parentSessionId: "parent", childSessionId: "child-1", mode: "unknown" } },
			identity,
			window: eventWindow([requestHeader(11, OWN_ROUTE)])
		});
		assert.equal(badge, null);
	}
});

test("does not treat a completed turn without its own request header as a model call", () => {
	const { badge, requested } = renderBadge({
		subagent: { address: { parentSessionId: "parent", childSessionId: "child-1", mode: "continuable" } },
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
		subagent: { address: { parentSessionId: "parent", childSessionId: "child-1", mode: "continuable" } },
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
		subagent: { address: { parentSessionId: "parent", childSessionId: "child-1", mode: "continuable" } },
		identity: CHILD_IDENTITY,
		window: eventWindow([
			requestHeader(5, PARENT_ROUTE),
			requestHeader(12, OWN_ROUTE)
		])
	});
	assert.ok(badge, "the own request header is sufficient evidence during the first turn");
	assert.equal(badge.props["data-subagent-model"], "cpa/child-model · max");
	assert.equal(badge.props.title, "cpa/child-model · max");
	assert.equal(badge.props["aria-label"], "model.label: cpa/child-model · max");
});

test("subscribes once to the retained event source and releases it on stop", () => {
	const { badge, source, stop } = renderBadge({
		subagent: { address: { parentSessionId: "parent", childSessionId: "child-1", mode: "continuable" } },
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
		subagent: { address: { parentSessionId: "parent", childSessionId: "child-1", mode: "continuable" } },
		identity: CHILD_IDENTITY,
		window: eventWindow([requestHeader(12, OWN_ROUTE)]),
		// The projection may still be on another frame, or may carry a pending
		// selection. Neither may override the request the child actually sent.
		projections: { modelSelection: { lastUsed: PENDING_ROUTE, next: PENDING_ROUTE } }
	});
	assert.ok(badge);
	assert.equal(badge.props["data-subagent-model"], "cpa/child-model · max");
});

test("follows the latest own request header as the session updates", () => {
	const { badge } = renderBadge({
		subagent: { address: { parentSessionId: "parent", childSessionId: "child-1", mode: "continuable" } },
		identity: CHILD_IDENTITY,
		window: eventWindow([
			requestHeader(12, OWN_ROUTE),
			requestHeader(15, LATER_OWN_ROUTE)
		], true)
	});
	assert.ok(badge);
	assert.equal(badge.props["data-subagent-model"], "cpa/child-model-v2");
});

test("renders nothing when no retained binding exposes an event window", () => {
	const { badge } = renderBadge({
		subagent: { address: { parentSessionId: "parent", childSessionId: "child-1", mode: "one-shot" } },
		identity: { mode: "one-shot", seq: 10 },
		window: undefined,
		projections: {
			modelSelection: { lastUsed: OWN_ROUTE, next: OWN_ROUTE },
			subagentTiming: { settledMs: 4_200, lastTurnCompleted: true }
		}
	});
	assert.equal(badge, null);
});

test("lastOwnRequestHeader ignores inherited and transient entries", () => {
	const { plugin } = loadClient();
	const window = eventWindow([
		requestHeader(5, PARENT_ROUTE),
		{ type: "transient", event: { type: "assistant/live-chunk", seq: 11, time: 11, data: {} } },
		requestHeader(12, OWN_ROUTE)
	]);
	assert.equal(plugin.lastOwnRequestHeader(window, CHILD_IDENTITY).model, "child-model");
	const unordered = eventWindow([
		requestHeader(15, LATER_OWN_ROUTE),
		requestHeader(12, OWN_ROUTE)
	]);
	assert.equal(plugin.lastOwnRequestHeader(unordered, CHILD_IDENTITY).model, "child-model-v2");
	assert.equal(plugin.lastOwnRequestHeader(window, { mode: "continuable", label: "task", seq: 12 }), null);
	assert.equal(plugin.lastOwnRequestHeader(undefined, CHILD_IDENTITY), null);
	assert.equal(plugin.lastOwnRequestHeader({ entries: undefined }, CHILD_IDENTITY), null);
});

test("selectActualRoute is the single display decision", () => {
	const { plugin } = loadClient();
	const child = { address: { parentSessionId: "parent", childSessionId: "child-1", mode: "continuable" } };
	assert.equal(plugin.selectActualRoute(null, CHILD_IDENTITY, OWN_ROUTE), null);
	assert.equal(plugin.selectActualRoute(child, null, OWN_ROUTE), null);
	assert.equal(plugin.selectActualRoute(child, CHILD_IDENTITY, null), null);
	assert.equal(plugin.selectActualRoute(child, CHILD_IDENTITY, OWN_ROUTE), OWN_ROUTE);
	assert.equal(plugin.routeText(OWN_ROUTE), "cpa/child-model · max");
	assert.equal(plugin.routeText({ provider: "cpa", model: "plain" }), "cpa/plain");
});
