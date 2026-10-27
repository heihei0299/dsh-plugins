import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Run the build-free client loader bundle in a sandbox and return its factory.
 * A caller-supplied `window` keeps the loader registration and whatever the
 * bundle publishes on it, so one test can inspect both.
 * @param globals - extra browser globals the bundle may read.
 * @returns the exported `{ apply, createReveal }`.
 */
function loadClient(globals = {}) {
	const loaded = [];
	const window = { ...(globals.window ?? {}), __ModuleLoader__: { load: (definition) => loaded.push(definition) } };
	vm.runInNewContext(readFileSync(path.join(root, "client.js"), "utf8"), {
		...globals,
		window,
	});
	assert.equal(loaded.length, 1, "the file must register exactly one loader bundle");
	assert.equal(loaded[0].id, "@local/dsh-history-budget");
	return loaded[0].factory();
}

/** Minimal frame/time harness. */
function fakeClock() {
	const frames = [];
	let time = 0;
	return {
		raf: (callback) => {
			frames.push(callback);
			return frames.length;
		},
		cancel: () => {},
		now: () => time,
		advance: (ms) => {
			time += ms;
		},
		runFrame: () => frames.shift()?.(),
	};
}

/**
 * Document fake that records its listeners and delivers an event the way the
 * browser delivers a click to `document` capture handlers.
 * @returns the document, its listener table, and a dispatcher.
 */
function fakeDocument() {
	const listeners = new Map();
	const document = {
		documentElement: { dataset: {} },
		addEventListener: (type, handler) => {
			if (!listeners.has(type)) listeners.set(type, []);
			listeners.get(type).push(handler);
		},
		removeEventListener: (type, handler) => {
			const registered = listeners.get(type) ?? [];
			const index = registered.indexOf(handler);
			if (index >= 0) registered.splice(index, 1);
		},
	};
	const dispatch = (type, event = {}) => {
		for (const handler of [...(listeners.get(type) ?? [])]) handler(event);
	};
	return { document, listeners, dispatch };
}

/**
 * Build one button inside the conversation scrollport.
 * @param text - its rendered label.
 * @param scroller - the resident scrollport it lives in.
 * @returns the fake element plus the count of synthetic clicks it received.
 */
function buttonOf(text, scroller) {
	const button = {
		textContent: text,
		clicks: 0,
		closest: (selector) => (selector === "button" ? button : selector === "[data-conversation-scroll]" ? scroller : null),
		click: () => {
			button.clicks += 1;
		},
	};
	return button;
}

/**
 * Load and apply the client half against a fake document.
 * @param clock - frame/time harness.
 * @returns the client factory, the fake document, and the applied disposer.
 */
function mountedClient(clock) {
	const { document, listeners, dispatch } = fakeDocument();
	const client = loadClient({
		document,
		requestAnimationFrame: clock.raf,
		cancelAnimationFrame: clock.cancel,
		performance: { now: clock.now },
	});
	let disposer;
	client.apply({
		effect: (callback) => {
			disposer = callback();
		},
	});
	return {
		client,
		document,
		listeners,
		dispatch,
		dispose: () => {
			disposer?.();
		},
	};
}

test("restores the scroll offset once the prepended page grows the transcript", () => {
	const clock = fakeClock();
	const reveal = loadClient().createReveal({ raf: clock.raf, cancel: clock.cancel, now: clock.now, windowMs: 1000 });
	const scroller = { scrollTop: 0, scrollHeight: 100 };
	reveal.arm(scroller);
	// A page landed above the viewport and scroll anchoring moved the offset.
	scroller.scrollHeight = 160;
	scroller.scrollTop = 60;
	clock.runFrame();
	assert.equal(scroller.scrollTop, 0, "the viewport must show the newly prepended entries");
});

test("does nothing when no page arrives inside the window", () => {
	const clock = fakeClock();
	const reveal = loadClient().createReveal({ raf: clock.raf, cancel: clock.cancel, now: clock.now, windowMs: 1000 });
	const scroller = { scrollTop: 40, scrollHeight: 100 };
	reveal.arm(scroller);
	clock.advance(1500);
	clock.runFrame();
	assert.equal(scroller.scrollTop, 40, "an unrelated layout change must not move the viewport");
});

test("disarm stops a pending reveal", () => {
	const clock = fakeClock();
	const reveal = loadClient().createReveal({ raf: clock.raf, cancel: clock.cancel, now: clock.now, windowMs: 1000 });
	const scroller = { scrollTop: 0, scrollHeight: 100 };
	reveal.arm(scroller);
	reveal.disarm();
	scroller.scrollHeight = 200;
	scroller.scrollTop = 80;
	clock.runFrame();
	assert.equal(scroller.scrollTop, 80);
});

test("retries one empty click, once (retained state machine)", () => {
	const clock = fakeClock();
	const reveal = loadClient().createReveal({ raf: clock.raf, cancel: clock.cancel, now: clock.now, windowMs: 3000 });
	const scroller = { scrollTop: 0, scrollHeight: 100 };
	let retries = 0;
	reveal.arm(scroller, {
		retry: () => {
			retries += 1;
		},
	});
	clock.advance(1300);
	clock.runFrame();
	assert.equal(retries, 1, "a click that applied nothing is asked again once");
	clock.advance(100);
	clock.runFrame();
	assert.equal(retries, 1, "the retry must not repeat");
});

test("never synthesizes a click on a third-party control labelled like the pager", () => {
	const clock = fakeClock();
	const mounted = mountedClient(clock);
	const scroller = { scrollTop: 0, scrollHeight: 100 };
	// A SmartUI sortable header renders the same words as the native pager.
	const header = buttonOf("Load earlier", scroller);
	mounted.dispatch("click", { target: header });
	// Nothing loads: a retry window elapses with no growth.
	clock.advance(1500);
	clock.runFrame();
	assert.equal(header.clicks, 0, "a control the plugin cannot own must never receive a synthetic click");
	mounted.dispose();
});

test("leaves a native page load to the host's own anchoring", () => {
	const clock = fakeClock();
	const mounted = mountedClient(clock);
	const scroller = { scrollTop: 0, scrollHeight: 100 };
	// The shipped pager: a plain button whose own handler pages backwards.
	const pager = buttonOf("加载更早", scroller);
	pager.click();
	mounted.dispatch("click", { target: pager });
	// The page landed, the host anchored the reading position, and the plugin
	// must not overwrite it.
	scroller.scrollHeight = 160;
	scroller.scrollTop = 60;
	clock.advance(1500);
	clock.runFrame();
	assert.equal(pager.clicks, 1, "the plugin must not re-issue the user's own page request");
	assert.equal(scroller.scrollTop, 60, "the disabled client half must not move the viewport");
	mounted.dispose();
});

test("registers no document-level gesture listener while the client half is disabled", () => {
	const clock = fakeClock();
	const mounted = mountedClient(clock);
	assert.deepEqual([...mounted.listeners.keys()], [], "the disabled client half must observe no user gesture");
	mounted.dispose();
});

test("reports the disabled state instead of a working fix", () => {
	const clock = fakeClock();
	const window = {};
	const { document, listeners } = fakeDocument();
	const client = loadClient({
		window,
		document,
		requestAnimationFrame: clock.raf,
		cancelAnimationFrame: clock.cancel,
		performance: { now: clock.now },
	});
	let disposer;
	client.apply({
		effect: (callback) => {
			disposer = callback();
		},
	});
	assert.equal(document.documentElement.dataset.dshHistoryBudget, "off", "the mount marker must not claim a working fix");
	assert.equal(window.__dshHistoryBudget, undefined, "a disabled client half publishes no click/retry/reveal counters");
	assert.deepEqual([...listeners.keys()], []);
	disposer?.();
	assert.equal(document.documentElement.dataset.dshHistoryBudget, undefined, "unmounting the client half restores the document");
});
