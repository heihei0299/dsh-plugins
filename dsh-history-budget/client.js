/**
 * Browser half: make 「加载更早」 show what it loaded, and survive a no-op click.
 *
 * 1. Reveal. The host bounds the opening window by bytes, so older history is
 *    loaded on demand through `session/page`. The client prepends that page
 *    above the viewport, and Chrome's scroll anchoring keeps the *visual*
 *    position — the viewport still shows the same first message, the freshly
 *    loaded entries sit above it, and the button stays where it was. Measured
 *    here: a click at `scrollTop: 0` grew the transcript from 8612 to 8772 px
 *    and moved `scrollTop` to 160, so nothing on screen appeared to change.
 *    This module undoes that one anchoring step: when the transcript grows
 *    within a short window after the click, it puts `scrollTop` back where the
 *    click happened, so the newly loaded entries are what the user sees.
 *
 * 2. Retry. The first click after a Session opens can complete without any
 *    page being applied (the follow stream's opening generation is still
 *    settling, and a page read against it is dropped silently). If no growth
 *    arrives ~1.2 s after the click, the button is still connected and
 *    enabled, and the user has not scrolled, this fires the button's own click
 *    once more. One bounded retry per gesture, never more.
 *
 * It never touches the Session store, the request, or the button's own
 * behavior; user input (wheel/touch/key) disarms everything immediately.
 *
 * Build-free loader bundle: DSH reads this file verbatim as
 * `window.__ModuleLoader__.load({ id, factory })`.
 */

window.__ModuleLoader__.load({
	id: "@local/dsh-history-budget",
	factory() {
		/** The resident conversation scrollport the Web UI renders. */
		const SCROLLPORT = "[data-conversation-scroll]";
		/** The native pager's label, in the shipped locales. */
		const LOAD_EARLIER = /加载更早|load earlier/i;
		/** How long after the click a prepend is still attributed to it. */
		const WINDOW_MS = 3000;
		/** How long to wait before deciding the click applied nothing. */
		const RETRY_MS = 1200;
		/** A repeated retry on the same button is refused inside this window. */
		const RETRY_GUARD_MS = 5000;

		/**
		 * Track one click, undo its scroll anchoring, and retry one empty click.
		 *
		 * `raf`, `cancel` and `now` are injected so the state machine is testable
		 * without a browser; the loader wires the real ones in `apply`.
		 *
		 * @param options - `{ raf, cancel, now, windowMs? }`.
		 * @returns `{ arm(scroller, { retry? }), disarm() }`.
		 */
		function createReveal(options) {
			const raf = options.raf;
			const cancel = options.cancel;
			const now = options.now;
			const windowMs = options.windowMs ?? WINDOW_MS;
			let armed;

			const disarm = () => {
				if (armed === undefined) return;
				cancel(armed.frame);
				armed = undefined;
			};

			const arm = (scroller, gesture = {}) => {
				disarm();
				const state = {
					scroller,
					top: scroller.scrollTop,
					height: scroller.scrollHeight,
					until: now() + windowMs,
					retryAt: gesture.retry === undefined ? Infinity : now() + RETRY_MS,
					retry: gesture.retry,
					frame: 0,
				};
				armed = state;
				const tick = () => {
					if (armed !== state) return;
					if (scroller.scrollHeight > state.height) {
						// The page landed above the viewport. Restore the offset the click
						// started from, which is inside the newly prepended block.
						scroller.scrollTop = state.top;
						armed = undefined;
						return;
					}
					if (now() >= state.retryAt) {
						state.retryAt = Infinity;
						// The click may have raced the opening generation; ask once more.
						// The follow-up click re-arms through the same listener.
						state.retry?.();
					}
					if (now() > state.until) {
						armed = undefined;
						return;
					}
					state.frame = raf(tick);
				};
				state.frame = raf(tick);
			};

			return { arm, disarm };
		}

		/** Plugin entry: one reveal per pager click, one bounded retry, stand down on input. */
		function apply(ctx) {
			if (typeof document === "undefined") return;
			const reveal = createReveal({
				raf: (callback) => requestAnimationFrame(callback),
				cancel: (frame) => cancelAnimationFrame(frame),
				now: () => performance.now(),
			});
			// A retry is refused while the previous one is still fresh, so a button
			// that legitimately has nothing older cannot be clicked in a loop.
			const retriedAt = new WeakMap();

			const onClick = (event) => {
				const target = event.target;
				const button = target !== null && typeof target === "object" && typeof target.closest === "function"
					? target.closest("button")
					: null;
				if (button === null || !LOAD_EARLIER.test(String(button.textContent ?? ""))) return;
				const scroller = button.closest(SCROLLPORT);
				if (scroller === null) return;
				reveal.arm(scroller, {
					retry: () => {
						if (button.isConnected === false || button.disabled === true) return;
						const last = retriedAt.get(button) ?? -Infinity;
						if (performance.now() - last < RETRY_GUARD_MS) return;
						retriedAt.set(button, performance.now());
						button.click();
					},
				});
			};
			const standDown = () => reveal.disarm();

			ctx.effect(() => {
				document.addEventListener("click", onClick, true);
				document.addEventListener("wheel", standDown, { capture: true, passive: true });
				document.addEventListener("touchstart", standDown, { capture: true, passive: true });
				document.addEventListener("keydown", standDown, true);
				return () => {
					document.removeEventListener("click", onClick, true);
					document.removeEventListener("wheel", standDown, { capture: true, passive: true });
					document.removeEventListener("touchstart", standDown, { capture: true, passive: true });
					document.removeEventListener("keydown", standDown, true);
					reveal.disarm();
				};
			});
		}

		// Test seams; the client loader consumes only `apply`.
		return { apply, createReveal };
	},
});
