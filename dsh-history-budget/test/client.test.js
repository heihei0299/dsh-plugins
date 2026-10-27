import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Run the build-free client loader bundle in a sandbox and return its factory.
 * @param globals - extra browser globals the bundle may read.
 * @returns the exported `{ apply, createReveal }`.
 */
function loadClient(globals = {}) {
	const loaded = [];
	vm.runInNewContext(readFileSync(path.join(root, "client.js"), "utf8"), {
		window: { __ModuleLoader__: { load: (definition) => loaded.push(definition) } },
		...globals,
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

test("wires the pager click to one reveal and stands down on user input", () => {
	const clock = fakeClock();
	const listeners = new Map();
	const document = {
		documentElement: { dataset: {} },
		addEventListener: (type, handler) => {
			if (!listeners.has(type)) listeners.set(type, []);
			listeners.get(type).push(handler);
		},
		removeEventListener: () => {},
	};
	const client = loadClient({
		document,
		requestAnimationFrame: clock.raf,
		cancelAnimationFrame: clock.cancel,
		performance: { now: clock.now },
	});
	const scroller = { scrollTop: 0, scrollHeight: 100 };
	const button = {
		textContent: "加载更早",
		closest: (selector) => (selector === "button" ? button : selector === "[data-conversation-scroll]" ? scroller : null),
	};
	let disposer;
	const ctx = { effect: (callback) => { disposer = callback(); } };
	client.apply(ctx);
	assert.deepEqual([...listeners.keys()].sort(), ["click", "keydown", "touchstart", "wheel"]);

	listeners.get("click")[0]({ target: button });
	scroller.scrollHeight = 160;
	scroller.scrollTop = 60;
	clock.runFrame();
	assert.equal(scroller.scrollTop, 0, "the click must reveal the page it loaded");

	// User input during the wait cancels the pending reveal instead of fighting it.
	listeners.get("click")[0]({ target: button });
	scroller.scrollHeight = 200;
	listeners.get("wheel")[0]();
	scroller.scrollTop = 90;
	clock.runFrame();
	assert.equal(scroller.scrollTop, 90);

	disposer();
});

test("ignores clicks that are not the native pager", () => {
	const clock = fakeClock();
	const listeners = new Map();
	const document = { documentElement: { dataset: {} }, addEventListener: (type, handler) => listeners.set(type, handler), removeEventListener: () => {} };
	const client = loadClient({
		document,
		requestAnimationFrame: clock.raf,
		cancelAnimationFrame: clock.cancel,
		performance: { now: clock.now },
	});
	const scroller = { scrollTop: 0, scrollHeight: 100 };
	const other = { textContent: "复制", closest: (selector) => (selector === "button" ? other : null) };
	const ctx = { effect: (callback) => callback() };
	client.apply(ctx);
	listeners.get("click")({ target: other });
	scroller.scrollHeight = 200;
	scroller.scrollTop = 90;
	clock.runFrame();
	assert.equal(scroller.scrollTop, 90);
});

test("retries one empty click, once", () => {
	const clock = fakeClock();
	const reveal = loadClient().createReveal({ raf: clock.raf, cancel: clock.cancel, now: clock.now, windowMs: 3000 });
	const scroller = { scrollTop: 0, scrollHeight: 100 };
	let retries = 0;
	reveal.arm(scroller, { retry: () => { retries += 1; } });
	clock.advance(1300);
	clock.runFrame();
	assert.equal(retries, 1, "a click that applied nothing is asked again once");
	clock.advance(100);
	clock.runFrame();
	assert.equal(retries, 1, "the retry must not repeat");
});

test("the wired retry clicks the live button once and skips a detached one", () => {
	const clock = fakeClock();
	const listeners = new Map();
	const document = { documentElement: { dataset: {} }, addEventListener: (type, handler) => listeners.set(type, handler), removeEventListener: () => {} };
	const client = loadClient({
		document,
		requestAnimationFrame: clock.raf,
		cancelAnimationFrame: clock.cancel,
		performance: { now: clock.now },
	});
	const scroller = { scrollTop: 0, scrollHeight: 100 };
	let clicks = 0;
	const button = {
		textContent: "加载更早",
		disabled: false,
		isConnected: true,
		click: () => { clicks += 1; },
		closest: (selector) => (selector === "button" ? button : selector === "[data-conversation-scroll]" ? scroller : null),
	};
	client.apply({ effect: (callback) => callback() });
	listeners.get("click")({ target: button });
	clock.advance(1300);
	clock.runFrame();
	assert.equal(clicks, 1, "the empty click is retried through the button itself");

	// A second gesture on the same button inside the guard window is not retried.
	listeners.get("click")({ target: button });
	clock.advance(1300);
	clock.runFrame();
	assert.equal(clicks, 1);

	button.isConnected = false;
	listeners.get("click")({ target: button });
	clock.advance(1300);
	clock.runFrame();
	assert.equal(clicks, 1, "a detached button is never clicked");
});

test("holds the offset while the client re-anchors, then lets go", () => {
	const clock = fakeClock();
	const reveal = loadClient().createReveal({ raf: clock.raf, cancel: clock.cancel, now: clock.now, windowMs: 3000, settleMs: 900 });
	const scroller = { scrollTop: 0, scrollHeight: 100 };
	reveal.arm(scroller);
	scroller.scrollHeight = 160;
	scroller.scrollTop = 60;
	clock.runFrame();
	assert.equal(scroller.scrollTop, 0, "the first growth restores the click offset");
	scroller.scrollTop = 60;
	clock.advance(100);
	clock.runFrame();
	assert.equal(scroller.scrollTop, 0, "a re-anchor inside the settle window is undone");
	clock.advance(1000);
	clock.runFrame();
	scroller.scrollTop = 30;
	clock.runFrame();
	assert.equal(scroller.scrollTop, 30, "after settling the plugin never fights the user again");
});
