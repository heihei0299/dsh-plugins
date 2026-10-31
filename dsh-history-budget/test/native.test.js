/**
 * Native compatibility regression for the `sessionController` seam.
 *
 * The unit tests in `plugin.test.js` drive a hand-written service object, so
 * they cannot fail when the host stops resolving `sessionController.follow`
 * the way this plugin assumes. This file mounts the plugin on the real runtime
 * instead: a real Cordis Context, the real Typert registry and protocol, the
 * real `remoteAccess` policy service, and the real `dsh-api-gateway`
 * dispatcher — the component whose `resolveDescriptor` validates the
 * `typertRemote` binding and then calls `Reflect.get(receiver, method)`. Every
 * frame and page below therefore travels through the gateway's own dispatch,
 * including its service discovery and binding validation, not a stand-in for it.
 *
 * What is deliberately NOT real:
 * - the Session log. Reading it needs a real session (disk history, credentials,
 *   or a live Agent), so the fixture's `history` object stands in for
 *   `SessionHistoryController`. The two controller methods under test are the
 *   real `SessionController.prototype.follow` / `.page` bodies, which only
 *   delegate to `this.history.*`; only the delegate is a stub.
 * - the Session Controller instance. Constructing a real `SessionController`
 *   demands a dozen live host services and a Session, so the fixture registers
 *   a stand-in Cordis service under the same key and namespace, decorated with
 *   the real protocol's `Remote` markers (`follow` a stream, `page` a unary
 *   read). The first test asserts those declarations still hold in the installed
 *   runtime, so a host that changes them fails here instead of diverging.
 * - the Client. Dispatch starts at `TypertGatewayService.stream()` / `.invoke()`,
 *   the in-process entry points the Web transport also uses; no WebSocket is
 *   opened, nothing listens on a port, and no session file is read or written.
 *
 * Opt-in: set `DSH_TEST_RUNTIME_ROOT` to a dsh installation root (a directory
 * holding `package.json` and `node_modules` — the `@deepseek-ai/dsh` package
 * directory, or a runtime overlay that maps those two names). Without it every
 * test here skips, so `npm test` stays runnable without a dsh install.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import budgetPlugin from "../index.js";
import { encodedBytes } from "../src/budget.js";

const RUNTIME_ROOT = process.env.DSH_TEST_RUNTIME_ROOT;
const SKIP =
	RUNTIME_ROOT === undefined || RUNTIME_ROOT.length === 0
		? "set DSH_TEST_RUNTIME_ROOT to a dsh installation root to run the native seam regression"
		: false;

/** Mark on a service this plugin already wrapped; mirrors the plugin's own ownership symbol. */
const INSTALLED = Symbol.for("dsh-history-budget.installed");

/** The loaded dsh runtime, shared by every test in this file. */
let loaded;

/**
 * Import one package from the configured dsh runtime.
 * @param spec - bare package specifier, resolved the way dsh itself resolves it.
 * @returns the module namespace.
 */
function load(spec) {
	const require = createRequire(pathToFileURL(join(resolve(RUNTIME_ROOT), "package.json")));
	return import(pathToFileURL(require.resolve(spec)).href);
}

/**
 * Load the runtime modules this file mounts.
 * @returns the Context class, the host plugins, the Typert protocol helpers, and the real Session Controller class.
 */
async function runtime() {
	if (loaded === undefined) {
		loaded = (async () => {
			const [cordis, registry, remoteAccess, gateway, protocol, controller] = await Promise.all([
				load("@deepseek-ai/cordis"),
				load("@deepseek-ai/dsh-typert-registry"),
				load("@deepseek-ai/dsh-api-remote-access"),
				load("@deepseek-ai/dsh-api-gateway"),
				load("@deepseek-ai/dsh-typert-protocol"),
				load("@deepseek-ai/dsh-api-session-controller"),
			]);
			return {
				Context: cordis.Context,
				TypertRegistry: registry.default,
				RemoteAccess: remoteAccess.default,
				Gateway: gateway.default,
				TypertRemoteService: protocol.TypertRemoteService,
				Remote: protocol.Remote,
				SessionController: controller.SessionController,
			};
		})();
	}
	return loaded;
}

/**
 * Build one wire record.
 * @param seq - durable sequence number.
 * @param type - event type; `turn/start` is the boundary the trimmer aligns its cut to.
 * @param size - filler bytes.
 * @returns the record.
 */
function record(seq, type, size = 200) {
	return { type: "event", event: { type, seq, time: seq, data: { text: "x".repeat(size) } } };
}

/**
 * Six records in two turns: the trimmer's byte cut lands inside the second
 * turn, so the fixture exercises the turn alignment as well as the budget.
 * @returns the records.
 */
function historyRecords() {
	return [
		record(1, "turn/start"),
		record(2, "tool/result"),
		record(3, "tool/result"),
		record(4, "tool/result"),
		record(5, "turn/start"),
		record(6, "tool/result"),
	];
}

/**
 * The snapshot the stand-in log opens with.
 * @returns the opening frame.
 */
function openingSnapshot() {
	return {
		type: "snapshot",
		cursor: 6,
		hasMore: false,
		header: { id: "native-seam" },
		projections: { title: "native seam" },
		records: historyRecords(),
	};
}

/**
 * One page of six records.
 * @returns the page value.
 */
function historyPageValue() {
	return { records: historyRecords(), hasMore: false };
}

/**
 * The byte budget that admits exactly the fixture's last turn: the window the
 * plugin must keep when it trims this fixture. Deriving it from the fixture
 * keeps the assertions independent of record sizes, which the host controls.
 * @param container - the snapshot or page value being bounded.
 * @returns the encoded bytes of its last turn, marked `hasMore: true`.
 */
function lastTurnBudget(container) {
	const start = container.records.findLastIndex((entry) => entry.event?.type === "turn/start");
	assert.ok(start > 0, "the fixture needs a turn boundary before its last record");
	return encodedBytes({ ...container, records: container.records.slice(start), hasMore: true });
}

/**
 * Build the peer a gateway call speaks for: the owner Peer every local call
 * uses, which the gateway lets through without an access decision.
 * @returns the peer.
 */
function ownerPeer() {
	return { principal: { kind: "owner" }, signal: new AbortController().signal };
}

/**
 * Read the addressed session id the real Controller's Remote markers derive
 * from a request. Copied from the host class so the stand-in service declares
 * the same resource reader.
 * @param request - the history request.
 * @returns the addressed session id.
 */
function addressedSession(request) {
	return request.address.kind === "session" ? request.address.sessionId : request.address.childSessionId;
}

/**
 * Build the stand-in `sessionController` service.
 *
 * Its `follow` and `page` are the real Session Controller bodies (they only
 * delegate to `this.history`), and its Remote markers are written by the real
 * protocol library's `Remote` decorator, so the gateway's SRC resolution sees
 * exactly what it sees for the real class.
 *
 * @param modules - the loaded runtime.
 * @param history - the session-log stand-in the real bodies delegate to.
 * @returns the service class to mount.
 */
function sessionControllerStandIn({ TypertRemoteService, Remote, SessionController }, history) {
	const real = SessionController.prototype;
	class StandInSessionController extends TypertRemoteService {
		/** @param ctx - owning Cordis Context. */
		constructor(ctx) {
			super(ctx, "sessionController", { namespace: "session" });
			this.history = history;
		}
	}
	for (const method of ["follow", "page"]) {
		const descriptor = Object.getOwnPropertyDescriptor(real, method);
		assert.equal(typeof descriptor?.value, "function", `the real SessionController has no ${method}() body`);
		Object.defineProperty(StandInSessionController.prototype, method, descriptor);
	}
	// A method decorator's initializer writes the marker onto the class
	// prototype once an instance exists; the host classes run it from their
	// instance field initializers, and the fixture runs it here.
	for (const [method, options] of [
		["follow", { mode: "stream", resources: { session: addressedSession } }],
		["page", { name: "page", resources: { session: addressedSession } }],
	]) {
		const initializers = [];
		Remote(options)(StandInSessionController.prototype[method], {
			kind: "method",
			name: method,
			static: false,
			private: false,
			addInitializer: (initializer) => initializers.push(initializer),
		});
		for (const initialize of initializers) initialize.call(Object.create(StandInSessionController.prototype));
	}
	return StandInSessionController;
}

/**
 * Mount a host with the real gateway in front of the stand-in Controller.
 * @param history - the session-log stand-in.
 * @returns the context, gateway, service, and mounted plugin fibers.
 */
async function openHost(history) {
	const modules = await runtime();
	const ctx = new modules.Context();
	const controller = sessionControllerStandIn(modules, history);
	const fibers = [
		ctx.plugin(modules.TypertRegistry),
		ctx.plugin(modules.RemoteAccess),
		ctx.plugin(modules.Gateway),
		ctx.plugin(controller),
	];
	await Promise.all(fibers);
	const gateway = ctx.get("typertGateway");
	const service = ctx.get("sessionController");
	assert.equal(typeof gateway?.stream, "function", "the real gateway did not register its service");
	assert.equal(typeof service?.follow, "function", "the stand-in sessionController is not resolvable");
	return { ctx, gateway, service, fibers };
}

/**
 * Mount this plugin on a host and return its own fiber, so a test can unmount
 * exactly one mount through the real Cordis lifecycle.
 * @param host - result of `openHost`.
 * @param maxBytes - encoded byte budget for one frame or page.
 * @returns the plugin fiber.
 */
async function mountBudget(host, maxBytes) {
	const fiber = host.ctx.plugin(budgetPlugin, { maxBytes });
	await fiber;
	return fiber;
}

/**
 * Drain one `session/follow` stream through the real gateway dispatcher.
 * @param gateway - the gateway service.
 * @param request - the follow request body.
 * @returns every frame the gateway delivered.
 */
async function followFrames(gateway, request) {
	const stream = await gateway.stream({
		namespace: "session",
		method: "follow",
		args: { request },
		peer: ownerPeer(),
	});
	const frames = [];
	for await (const frame of stream) frames.push(frame);
	return frames;
}

/**
 * Read one history page through the real gateway dispatcher.
 * @param gateway - the gateway service.
 * @param request - the page request body.
 * @returns the business result of `session/page`.
 */
function historyPage(gateway, request) {
	return gateway.invoke({ namespace: "session", method: "page", args: { request }, peer: ownerPeer() });
}

test("the real Session Controller still exposes the two methods this plugin shadows", { skip: SKIP }, async () => {
	const { SessionController } = await runtime();
	const follow = Function.prototype.toString.call(SessionController.prototype.follow);
	const page = Function.prototype.toString.call(SessionController.prototype.page);
	// The plugin does not rebuild history: it wraps what the controller returns.
	// That only works while both methods stay pure delegations.
	assert.match(follow, /this\.history\.follow\(request, signal\)/, "SessionController#follow no longer delegates to its history controller");
	assert.match(page, /this\.history\.page\(request, signal\)/, "SessionController#page no longer delegates to its history controller");

	const source = Function.prototype.toString.call(SessionController);
	// The gateway routes `session/*` by the service's binding, so the service key
	// and namespace the plugin's `inject` relies on must stay the same.
	assert.match(source, /super\(ctx, "sessionController", \{ namespace: "session" \}\)/, "the Session Controller moved to another service key or namespace");
	// `follow` must stay a stream Remote: it is what the client opens with
	// `session/follow`, and the plugin's override is an async generator.
	assert.match(source, /_follow_decorators = \[Remote\(\{\s*mode: "stream"/, "SessionController#follow is no longer a stream Remote method");
	// `page` must stay a unary Remote whose result is the page value itself.
	assert.match(source, /_page_decorators = \[Remote\(\{[\s\S]{0,160}?resources: \{ session: addressedSession \}/, "SessionController#page no longer declares its session resource");
});

test("gateway dispatch reaches the wrapped follow and page on a live Cordis service", { skip: SKIP }, async (t) => {
	const snapshot = openingSnapshot();
	const trailing = { type: "event", event: { type: "turn/end", seq: 7 } };
	const pageValue = historyPageValue();
	const seen = [];
	const host = await openHost({
		follow(request, signal) {
			seen.push({ request, signal });
			return (async function* frames() {
				yield snapshot;
				yield trailing;
			})();
		},
		async page(request) {
			seen.push({ request });
			return pageValue;
		},
	});
	t.after(async () => {
		await host.ctx.fiber?.dispose?.();
	});

	const request = { address: { kind: "session", sessionId: "native-seam" }, maxMessages: 500 };
	const budget = lastTurnBudget(snapshot);
	assert.ok(encodedBytes(snapshot) > budget, "the fixture snapshot must exceed the budget");

	// Baseline: before the mount the gateway hands the client the untouched
	// frame. Every later assertion is compared with it.
	assert.deepEqual(await followFrames(host.gateway, request), [snapshot, trailing], "the unmounted host must deliver the full frame");
	assert.equal(await historyPage(host.gateway, { address: request.address }), pageValue, "the unmounted host must deliver the full page");

	await mountBudget(host, budget);
	assert.equal(host.service.follow.name, "historyBudgetFollow", "the mount must shadow follow in place on the live service");
	assert.equal(host.service[INSTALLED], true, "the mount must mark the service it wrapped");

	const frames = await followFrames(host.gateway, request);
	const streams = seen.filter((call) => "signal" in call);
	assert.equal(streams.length, 2, "each gateway stream must reach the controller exactly once");
	assert.equal(streams[1].request, request, "the wrapper must hand the caller's request to the controller untouched");
	assert.ok(streams[1].signal instanceof AbortSignal, "the wrapper must hand the gateway's cancellation signal through");
	assert.equal(frames.length, 2, "the gateway must deliver the trimmed opening frame and the following event");
	const opening = frames[0];
	assert.ok(encodedBytes(opening) <= budget, "the opening frame must fit the budget");
	assert.equal(opening.hasMore, true, "a trimmed opening frame must offer the older records");
	assert.equal(opening.records.length, 2, "the opening frame must keep the newest turn");
	assert.equal(opening.records[0], snapshot.records.at(-2), "the window must open on the turn boundary");
	assert.equal(opening.records.at(-1), snapshot.records.at(-1), "the newest record must survive");
	assert.equal(opening.cursor, snapshot.cursor, "the cursor must not move");
	assert.equal(opening.header, snapshot.header, "the header must pass through untouched");
	assert.deepEqual(opening.projections, snapshot.projections);
	assert.equal(frames[1], trailing, "frames after the opening one must pass through untouched");

	const page = await historyPage(host.gateway, { address: request.address, beforeSeq: 6 });
	assert.ok(encodedBytes(page) <= budget, "the page must fit the budget");
	assert.equal(page.hasMore, true, "a trimmed page must offer the older records");
	assert.equal(page.records.length, 2, "the page must keep the newest turn");
	assert.equal(page.records.at(-1), pageValue.records.at(-1), "the newest page record must survive");

	// A caller that asks for its own budget is talking to a host that has one.
	const ownBudget = await followFrames(host.gateway, { ...request, maxBytes: 4096 });
	assert.equal(ownBudget[0], snapshot, "a request carrying maxBytes must not be bounded twice");
	const ownBudgetPage = await historyPage(host.gateway, { address: request.address, maxBytes: 4096 });
	assert.equal(ownBudgetPage, pageValue, "a page carrying maxBytes must not be bounded twice");
});

test("disposing the mount restores the real methods for live gateway dispatch", { skip: SKIP }, async (t) => {
	const snapshot = openingSnapshot();
	const host = await openHost({
		follow() {
			return (async function* frames() {
				yield snapshot;
			})();
		},
		async page() {
			return historyPageValue();
		},
	});
	t.after(async () => {
		await host.ctx.fiber?.dispose?.();
	});

	const request = { address: { kind: "session", sessionId: "native-seam" } };
	const budget = lastTurnBudget(snapshot);
	const bindingBefore = Reflect.get(host.service, "typertRemote");
	const fiber = await mountBudget(host, budget);
	assert.equal(host.service.follow.name, "historyBudgetFollow");
	assert.equal((await followFrames(host.gateway, request))[0].hasMore, true, "the mounted host must trim");

	await fiber.dispose();

	// Cordis fiber disposal is what a profile edit causes; the gateway must
	// dispatch to the controller's own method again afterwards.
	assert.equal(host.service.follow.name, "follow", "dispose must restore the controller's own method");
	assert.equal(Object.hasOwn(host.service, "follow"), false, "dispose must not leave a shadowing own property");
	assert.equal(host.service[INSTALLED], undefined, "dispose must clear its ownership mark");
	assert.equal(Reflect.get(host.service, "typertRemote"), bindingBefore, "the gateway's typertRemote binding must survive the mount untouched");

	const frames = await followFrames(host.gateway, request);
	assert.equal(frames[0], snapshot, "after dispose the gateway must deliver the full frame again");
	assert.equal(frames[0].hasMore, false, "after dispose the opening frame must not claim older records");
	const page = await historyPage(host.gateway, { address: request.address, beforeSeq: 6 });
	assert.equal(page.hasMore, false, "after dispose the gateway must deliver the full page again");

	// A second mount after disposal must work exactly like the first.
	await mountBudget(host, budget);
	assert.equal((await followFrames(host.gateway, request))[0].hasMore, true, "a remount must bound the stream again");
});
