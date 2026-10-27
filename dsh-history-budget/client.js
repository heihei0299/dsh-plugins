/**
 * Browser half: the client enhancements are disabled.
 *
 * The audit found no public seam that proves a clicked control is the native
 * 「加载更早」 pager, and no source that attributes a viewport change to that
 * gesture. Both behaviors this half used to ship are therefore off:
 *
 * 1. No synthetic click. The retry matched a button by its rendered text, which
 *    also matched unrelated controls — a SmartUI sortable header labelled
 *    `Load earlier` was clicked a second time 1.2 s after the user sorted once.
 * 2. No scroll write. The reveal undid the host's scroll anchoring on any
 *    transcript growth inside a 3 s window after such a click, so unrelated live
 *    output or a delayed image consumed the one chance the real prepend needed.
 *
 * Native manual paging and the host's own anchoring stay untouched: the
 * `session/page` request, the pager's own handler, the paging cursor and the
 * transcript's scroll behavior are exactly as shipped. A page that arrives
 * keeps the host's anchored reading position.
 *
 * `createReveal` is retained unwired, so the follow-up cleanup can remove the
 * state machine in one change; `apply` never arms it.
 *
 * Build-free loader bundle: DSH reads this file verbatim as
 * `window.__ModuleLoader__.load({ id, factory })`.
 */

window.__ModuleLoader__.load({
	id: "@local/dsh-history-budget",
	factory() {
		/** How long after a gesture a prepend is still attributed to it. */
		const WINDOW_MS = 3000;
		/** How long to wait before deciding a click applied nothing. */
		const RETRY_MS = 1200;

		/**
		 * Track one gesture's scroll anchoring and retry one empty click.
		 *
		 * Disabled: `apply` neither creates nor arms this state machine. It stays
		 * only until the cleanup removes it together with its tests.
		 *
		 * `raf`, `cancel` and `now` are injected so the state machine is testable
		 * without a browser.
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
					stableSince: 0,
					retryAt: gesture.retry === undefined ? Infinity : now() + RETRY_MS,
					retry: gesture.retry,
					onReveal: gesture.onReveal,
					frame: 0,
				};
				armed = state;
				const tick = () => {
					if (armed !== state) return;
					if (scroller.scrollHeight > state.height) {
						state.onReveal?.();
						// One correction only: the client owns this viewport and re-applies
						// its own reading anchor on its schedule, so holding the offset here
						// would be a fight it wins. A single restore is enough when the
						// client is not pinning; when it is, the anchor stands.
						scroller.scrollTop = state.top;
						armed = undefined;
						return;
					}
					if (now() >= state.retryAt) {
						state.retryAt = Infinity;
						// One bounded retry per gesture; the callback owns what "retry" means.
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

		/**
		 * Plugin entry: mark the mount and do nothing else.
		 *
		 * No document listener, no synthetic click, no scroll write. The marker
		 * reports `off`, so a page can tell a loaded bundle apart from an active
		 * fix; unmounting removes it.
		 *
		 * @param ctx - the client plugin context.
		 */
		function apply(ctx) {
			if (typeof document === "undefined") return;
			document.documentElement.dataset.dshHistoryBudget = "off";
			ctx.effect(() => () => {
				delete document.documentElement.dataset.dshHistoryBudget;
			});
		}

		// Test seams; the client loader consumes only `apply`.
		return { apply, createReveal };
	},
});
