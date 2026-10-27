import assert from "node:assert/strict";
import test from "node:test";

import budgetPlugin, { apply, inject, name } from "../index.js";
import { encodedBytes } from "../src/budget.js";

/**
 * Build one wire record.
 * @param seq - durable sequence number.
 * @param size - filler bytes.
 * @returns the record.
 */
function record(seq, size = 120) {
	return { type: "event", event: { type: "tool/result", seq, time: seq, data: { text: "x".repeat(size) } } };
}

/**
 * Build a fake SessionController service whose methods live on its prototype,
 * the shape Cordis services normally have.
 * @param snapshot - the opening frame the fake stream yields.
 * @param pageResult - the value the fake page method returns.
 * @returns the service plus its prototype.
 */
function serviceOf(snapshot, pageResult) {
	const proto = {
		async *follow() {
			yield snapshot;
		},
		async page() {
			return pageResult;
		},
	};
	return { service: Object.create(proto), proto };
}

/**
 * Build a minimal plugin context that runs `effect` callbacks eagerly.
 * @param service - the fake service.
 * @returns the context, recorded logs, and a dispose helper.
 */
function contextOf(service) {
	const warnings = [];
	const infos = [];
	const disposers = [];
	const ctx = {
		sessionController: service,
		logger: { warn: (message) => warnings.push(message), info: (message) => infos.push(message) },
		effect: (callback) => {
			disposers.push(callback());
		},
	};
	return {
		ctx,
		warnings,
		infos,
		dispose: () => {
			for (const disposer of disposers.splice(0)) disposer?.();
		},
	};
}

/**
 * Build a promise that stays pending until its `release` is called.
 * @returns the pending promise plus the resolver that opens it.
 */
function gate() {
	let release;
	const opened = new Promise((resolve) => {
		release = resolve;
	});
	return { opened, release };
}

/**
 * Drain one follow stream.
 * @param service - the fake service.
 * @param request - the follow request.
 * @returns every yielded frame.
 */
async function drain(service, request = {}) {
	const frames = [];
	for await (const frame of service.follow(request, undefined)) frames.push(frame);
	return frames;
}

test("declares the seam and the default exports", () => {
	assert.equal(name, "history-budget");
	assert.deepEqual(inject, ["sessionController"]);
	assert.equal(budgetPlugin.apply, apply);
});

test("trims the opening frame and restores the exact method on dispose", async () => {
	const full = { type: "snapshot", cursor: 4, hasMore: false, records: [record(1), record(2), record(3), record(4)] };
	const { service, proto } = serviceOf(full, { records: [], hasMore: false });
	const { ctx, dispose } = contextOf(service);
	apply(ctx, { maxBytes: 500 });

	assert.notEqual(service.follow, proto.follow, "the method must be shadowed while mounted");
	assert.equal(service.follow.name, "historyBudgetFollow");

	const frames = await drain(service);
	assert.equal(frames.length, 1);
	assert.ok(encodedBytes(frames[0]) <= 500, "the opening frame must fit the budget");
	assert.equal(frames[0].hasMore, true);
	assert.equal(frames[0].cursor, 4, "the cursor must not move");
	assert.equal(frames[0].records.at(-1), full.records.at(-1));

	dispose();
	assert.equal(service.follow, proto.follow, "dispose must restore the prototype method");
});

test("leaves a frame that already fits byte-identical", async () => {
	const full = { type: "snapshot", cursor: 2, hasMore: false, records: [record(1), record(2)] };
	const { service } = serviceOf(full, { records: [], hasMore: false });
	const { ctx } = contextOf(service);
	apply(ctx, { maxBytes: 1024 * 1024 });

	const frames = await drain(service);
	assert.equal(frames[0], full);
});

test("trims history pages and keeps the page value", async () => {
	const records = [record(1), record(2), record(3), record(4)];
	const { service } = serviceOf({ type: "snapshot", cursor: 4, hasMore: false, records: [] }, { records, hasMore: false });
	const { ctx } = contextOf(service);
	apply(ctx, { maxBytes: 500 });

	// The service result is `{ records, hasMore }`; the gateway adds `{ ok, value }`.
	const result = await service.page({ beforeSeq: 4 }, undefined);
	assert.ok(encodedBytes(result) <= 500);
	assert.equal(result.hasMore, true);
	assert.equal(result.records.at(-1), records.at(-1));
});

test("leaves an empty page and a throwing page alone", async () => {
	const empty = { records: [], hasMore: false };
	const { service } = serviceOf({ type: "snapshot", cursor: 0, hasMore: false, records: [] }, empty);
	const { ctx } = contextOf(service);
	apply(ctx, { maxBytes: 100 });
	assert.equal(await service.page({}, undefined), empty);

	const failure = new Error("gateway/bad-request");
	const throwing = Object.create({
		async *follow() {
			yield { type: "snapshot", cursor: 0, hasMore: false, records: [] };
		},
		async page() {
			throw failure;
		},
	});
	const second = contextOf(throwing);
	apply(second.ctx, { maxBytes: 100 });
	await assert.rejects(() => throwing.page({}, undefined), failure);
});

test("stands down when the request carries its own budget", async () => {
	const full = { type: "snapshot", cursor: 6, hasMore: false, records: [record(1), record(2), record(3), record(4), record(5), record(6)] };
	const pageValue = { records: [record(1), record(2)], hasMore: false };
	const { service } = serviceOf(full, pageValue);
	const { ctx } = contextOf(service);
	apply(ctx, { maxBytes: 200 });

	const frames = await drain(service, { maxBytes: 4096 });
	assert.equal(frames[0], full, "a host-native budget must not be bounded twice");
	const result = await service.page({ maxBytes: 4096 }, undefined);
	assert.equal(result, pageValue);
});

test("refuses a second mount without wrapping twice", () => {
	const full = { type: "snapshot", cursor: 1, hasMore: false, records: [record(1)] };
	const { service } = serviceOf(full, { records: [], hasMore: false });
	const first = contextOf(service);
	const second = contextOf(service);
	apply(first.ctx, {});
	const mounted = service.follow;
	apply(second.ctx, {});

	assert.equal(service.follow, mounted, "the second mount must not stack a wrapper");
	assert.match(second.warnings.join("\n"), /already wrapped/);
	first.dispose();
	assert.equal(service.follow, Object.getPrototypeOf(service).follow);
});

test("does not clobber a wrapper installed after this mount", () => {
	const { service } = serviceOf({ type: "snapshot", cursor: 0, hasMore: false, records: [] }, { records: [], hasMore: false });
	const { ctx, dispose } = contextOf(service);
	apply(ctx, {});
	const later = function laterFollow() {};
	service.follow = later;
	dispose();
	assert.equal(service.follow, later);
});

test("hands on a first frame that arrives after the mount is gone", async () => {
	const waiting = gate();
	const full = { type: "snapshot", cursor: 9, hasMore: false, records: [record(1), record(2), record(3), record(4)] };
	const { service, proto } = serviceOf(full, { records: [], hasMore: false });
	proto.follow = async function* pausedFollow() {
		await waiting.opened;
		yield full;
	};
	const { ctx, dispose, infos } = contextOf(service);
	apply(ctx, { maxBytes: 100, log: true });
	assert.ok(encodedBytes(full) > 100, "the fixture must exceed the budget");

	const iterator = service.follow({}, undefined);
	const pending = iterator.next();
	dispose();
	waiting.release();
	const { value, done } = await pending;
	assert.equal(done, false);
	assert.equal(value, full, "a frame arriving after dispose must pass through untouched");
	assert.deepEqual(
		infos.filter((message) => /trimmed/.test(message)),
		[],
		"a disposed mount must not report a trim it no longer owns",
	);
	await iterator.return();
});

test("a wrapper that kept this mount's follow stops trimming after dispose", async () => {
	const waiting = gate();
	const full = { type: "snapshot", cursor: 5, hasMore: false, records: [record(1), record(2), record(3), record(4)] };
	const { service, proto } = serviceOf(full, { records: [], hasMore: false });
	proto.follow = async function* pausedFollow() {
		await waiting.opened;
		yield full;
	};
	const { ctx, dispose } = contextOf(service);
	apply(ctx, { maxBytes: 100 });

	// A later plugin captures this mount's wrapper; dispose cannot reach it.
	const retained = service.follow;
	service.follow = function thirdPartyFollow(request, signal) {
		return retained.call(this, request, signal);
	};
	const iterator = service.follow({}, undefined);
	const pending = iterator.next();
	dispose();
	waiting.release();
	const { value } = await pending;
	assert.equal(value, full, "a retained old closure must hand the frame on untouched");
	await iterator.return();
	assert.equal(service.follow.name, "thirdPartyFollow", "dispose must leave the later wrapper in place");
});

test("returns a history page untouched when the mount is gone before it arrives", async () => {
	const waiting = gate();
	const pageValue = { records: [record(1), record(2), record(3), record(4)], hasMore: false };
	const { service, proto } = serviceOf({ type: "snapshot", cursor: 4, hasMore: false, records: [] }, pageValue);
	proto.page = async function pausedPage() {
		await waiting.opened;
		return pageValue;
	};
	const { ctx, dispose } = contextOf(service);
	apply(ctx, { maxBytes: 100 });

	const pending = service.page({ beforeSeq: 9 }, undefined);
	dispose();
	waiting.release();
	assert.equal(await pending, pageValue, "a page arriving after dispose must be returned untouched");
});

test("keeps upstream failures and passes the request and signal through", async () => {
	const failure = new Error("session/gone");
	const full = { type: "snapshot", cursor: 4, hasMore: false, records: [record(1), record(2), record(3), record(4)] };
	const request = { maxMessages: 500 };
	const signal = { aborted: false };
	const seen = [];
	const { service, proto } = serviceOf(full, { records: [], hasMore: false });
	proto.follow = async function* failingFollow(args, token) {
		seen.push([args, token]);
		yield full;
		throw failure;
	};
	const { ctx } = contextOf(service);
	apply(ctx, { maxBytes: 500 });

	const frames = [];
	await assert.rejects(async () => {
		for await (const frame of service.follow(request, signal)) frames.push(frame);
	}, failure);
	assert.deepEqual(seen, [[request, signal]], "the upstream call must receive the caller's arguments");
	assert.equal(frames.length, 1);
	assert.ok(encodedBytes(frames[0]) <= 500, "the active mount must still trim before the failure");
});

test("closes the upstream iterator when the caller closes it", async () => {
	const full = { type: "snapshot", cursor: 4, hasMore: false, records: [record(1), record(2), record(3), record(4)] };
	const closed = [];
	const { service, proto } = serviceOf(full, { records: [], hasMore: false });
	proto.follow = async function* closingFollow() {
		try {
			yield full;
			yield { type: "event" };
		} finally {
			closed.push("upstream");
		}
	};
	const { ctx } = contextOf(service);
	apply(ctx, { maxBytes: 500 });

	const iterator = service.follow({}, undefined);
	const { value } = await iterator.next();
	assert.ok(encodedBytes(value) <= 500, "the active mount must still trim");
	assert.deepEqual(closed, [], "the upstream iterator must stay open until the caller closes it");
	await iterator.return();
	assert.deepEqual(closed, ["upstream"], "caller cancellation must close the upstream iterator");
});

test("leaves a real caller AbortSignal alone when the mount is disposed", async () => {
	const waiting = gate();
	const controller = new AbortController();
	const abortEvents = [];
	const received = [];
	const full = { type: "snapshot", cursor: 9, hasMore: false, records: [record(1), record(2), record(3), record(4)] };
	const { service, proto } = serviceOf(full, { records: [], hasMore: false });
	proto.follow = async function* abortAwareFollow(request, signal) {
		received.push(signal);
		const onAbort = () => abortEvents.push(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
		try {
			await waiting.opened;
			yield full;
		} finally {
			signal.removeEventListener("abort", onAbort);
		}
	};
	const { ctx, dispose } = contextOf(service);
	apply(ctx, { maxBytes: 100 });

	const iterator = service.follow({}, controller.signal);
	const pending = iterator.next();
	dispose();
	waiting.release();
	const { value } = await pending;
	assert.equal(received[0], controller.signal, "the caller's signal must reach the upstream stream");
	assert.equal(value, full, "the late frame must still pass through untouched");
	assert.equal(controller.signal.aborted, false, "dispose must not abort the caller's signal");
	assert.deepEqual(abortEvents, [], "dispose must not fire the signal's abort listeners");
	await iterator.return();
	assert.equal(controller.signal.aborted, false, "closing the iterator must not abort the caller's signal");
});

test("propagates a real caller abort to the upstream stream unchanged", async () => {
	const controller = new AbortController();
	const reason = new Error("user/cancelled");
	const abortEvents = [];
	const closed = [];
	const full = { type: "snapshot", cursor: 4, hasMore: false, records: [record(1), record(2), record(3), record(4)] };
	const { service, proto } = serviceOf(full, { records: [], hasMore: false });
	proto.follow = async function* cancellingFollow(request, signal) {
		// Listen from the start: the caller may abort while the generator is
		// suspended at a yield, when a listener added after the resume would
		// never see the event.
		const aborted = new Promise((_, reject) => {
			signal.addEventListener(
				"abort",
				() => {
					abortEvents.push(signal.reason);
					reject(signal.reason);
				},
				{ once: true },
			);
		});
		aborted.catch(() => {});
		try {
			yield full;
			await aborted;
			yield { type: "event" };
		} finally {
			closed.push("upstream");
		}
	};
	const { ctx } = contextOf(service);
	apply(ctx, { maxBytes: 500 });

	const iterator = service.follow({}, controller.signal);
	const first = await iterator.next();
	assert.ok(encodedBytes(first.value) <= 500, "the active mount must still trim the first frame");
	controller.abort(reason);
	await assert.rejects(iterator.next(), (error) => error === reason);
	assert.deepEqual(abortEvents, [reason], "the real abort must reach the upstream stream");
	assert.deepEqual(closed, ["upstream"], "the upstream iterator must close once the abort lands");
});
