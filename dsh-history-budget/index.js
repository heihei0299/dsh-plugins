/**
 * Bound the opening session frame by bytes, not by message count.
 *
 * What it fixes: the Web client opens a session with `session/follow` and asks
 * for `maxMessages: 500`. The host pages that opening window by COUNT, so one
 * long goal turn or one oversized tool result still arrives as a single
 * multi-megabyte frame — a 4 MB log measured ~629 KB of opening frame, and a
 * long turn can exceed several MB. Lowering `maxMessages` in the client only
 * moves the count, never the size.
 *
 * What it does: this host-only plugin replaces `sessionController.follow` and
 * `sessionController.page` for the life of the mount and hands the client the
 * newest suffix of `records` that fits `maxBytes` of encoded JSON, with
 * `hasMore: true`. The frame's `cursor`, `header`, `projections` and
 * `assistantStream` are untouched, so the live stream still resumes exactly
 * where it would have. The official client already renders a short opening
 * window: it offers 「加载更早」, and that button pages backwards through
 * `session/page` — the same method this plugin bounds — so no client change is
 * involved.
 *
 * The seam: `dsh-api-gateway` resolves the receiver per call
 * (`receiverContext.get(descriptor.service)`) and validates only the
 * `typertRemote` binding (service identity, serviceKey, namespace), then calls
 * `Reflect.get(receiver, 'follow')`. Replacing the method in place therefore
 * keeps dispatch valid; it does not touch the descriptor, the gateway, the
 * client, or the session log.
 *
 * Deliberate limits, all documented in README.md:
 * - a single record larger than the budget is still one oversized frame
 *   (`minRecords` wins over the budget, by design);
 * - a request that already carries `maxBytes` is passed through untouched, so a
 *   future host that grows its own budget support is not double-bounded;
 * - the wrapper is process-local and in-place, so it must be idempotent and
 *   must restore the exact property it shadowed on dispose.
 */

import { trimRecords } from "./src/budget.js";

const name = "history-budget";
const inject = ["sessionController"];

/** Default encoded-byte budget of one opening frame or history page (512 KiB). */
const DEFAULT_MAX_BYTES = 512 * 1024;
/** Newest records kept even when one record alone exceeds the budget. */
const DEFAULT_MIN_RECORDS = 1;

/** Mark on a service this module already wrapped; a service read may be bound, so the service carries it. */
const INSTALLED = Symbol.for("dsh-history-budget.installed");

/**
 * Read one positive-integer option, falling back on a fixed value.
 * @param value - the configured value.
 * @param fallback - value used when the option is absent or invalid.
 * @param label - option name for the warning.
 * @param warn - logger sink.
 * @returns the accepted value.
 */
function positiveInteger(value, fallback, label, warn) {
	if (value === undefined) return fallback;
	if (Number.isSafeInteger(value) && value > 0) return value;
	warn(`history-budget: \`${label}\` must be a positive integer; using ${String(fallback)}`);
	return fallback;
}

/**
 * Replace one service method in place and return an exact restore.
 *
 * A Cordis service read goes through a view that may hand back a bound
 * function, so `Reflect.get(service, key) !== wrapper` does NOT mean the write
 * failed: the gateway's own call arrives at the wrapper either way. Ownership
 * is therefore judged on the stored own property, and a mount never restores a
 * property a later wrapper took over.
 *
 * @param service - the Cordis service object (or its proxy).
 * @param key - method name.
 * @param wrapper - replacement function.
 * @param original - the function this mount captured, used as a last-resort restore.
 * @returns a restore function, or undefined when the property is not writable.
 */
function install(service, key, wrapper, original) {
	const own = Object.getOwnPropertyDescriptor(service, key);
	try {
		service[key] = wrapper;
	} catch {
		return undefined;
	}
	return () => {
		const current = Object.getOwnPropertyDescriptor(service, key);
		// A later mount may have replaced the property; leave its wrapper alone.
		if (current === undefined ? own !== undefined : current.value !== wrapper) return;
		try {
			if (own === undefined) Reflect.deleteProperty(service, key);
			else Object.defineProperty(service, key, own);
		} catch {
			try {
				service[key] = original;
			} catch {}
		}
	};
}

/**
 * Bound the opening frame and older history pages of one mounted profile.
 * @param ctx - plugin context with `sessionController` available.
 * @param config - `{ maxBytes?, minRecords?, log? }` from the profile entry.
 */
export function apply(ctx, config) {
	// Profiles differ in what `ctx.logger` is: a full logger, a scoped factory
	// with no level methods, or nothing at all. A failed in-place wrap must not
	// vanish into a no-op logger, so warnings fall back to stderr.
	const emit = (level, message) => {
		const logger = ctx.logger;
		const method = logger?.[level];
		if (typeof method === "function") {
			try {
				method.call(logger, message);
				return;
			} catch {}
		}
		console.error(message);
	};
	const warn = (message) => emit("warn", message);
	const verbose = config?.log === true;
	const info = (message) => {
		if (verbose) emit("info", message);
	};

	const maxBytes = positiveInteger(config?.maxBytes, DEFAULT_MAX_BYTES, "maxBytes", warn);
	const minRecords = positiveInteger(config?.minRecords, DEFAULT_MIN_RECORDS, "minRecords", warn);

	const service = ctx.sessionController;
	const follow = service?.follow;
	if (typeof follow !== "function") {
		warn("history-budget: `sessionController.follow` is unavailable, so nothing is bounded");
		return;
	}
	if (service[INSTALLED] === true) {
		warn("history-budget: `sessionController.follow` is already wrapped; mount this plugin once");
		return;
	}
	const page = service.page;
	const hasPage = typeof page === "function";

	ctx.effect(() => {
		// Stays true only while this mount owns the property. A wrapper installed
		// after us may keep this closure alive, and it must not keep trimming with
		// a configuration its mount no longer owns.
		let active = true;
		const report = (kind, result) => {
			info(`history-budget: ${kind} trimmed ${String(result.trimmed)} record(s) to ${String(result.bytes)} bytes`);
		};

		const wrappedFollow = async function* historyBudgetFollow(request, signal) {
			const stream = follow.call(this, request, signal);
			// A caller that asks for its own budget is talking to a host that
			// implements one; bounding it here as well would page the same stream twice.
			if (!active || request?.maxBytes !== undefined) {
				yield* stream;
				return;
			}
			let opening = true;
			for await (const frame of stream) {
				// `for await` is an async resume point: the mount may be disposed
				// while a frame is in flight, and a later wrapper may keep this
				// closure alive. A frame that arrives after dispose is handed on
				// untouched instead of being trimmed by a configuration its mount
				// no longer owns.
				if (!active) {
					yield frame;
					continue;
				}
				if (opening) {
					opening = false;
					if (frame?.type === "snapshot" && Array.isArray(frame.records)) {
						const result = trimRecords(frame, maxBytes, minRecords);
						if (result.trimmed > 0) {
							report("opening frame", result);
							yield result.value;
							continue;
						}
					}
				}
				yield frame;
			}
		};
		// `session/page`'s service result is the page value itself
		// (`{ records, hasMore }`); the gateway's `{ ok, value }` envelope is
		// added after the method returns, so it must not be looked for here.
		const wrappedPage = async function historyBudgetPage(request, signal) {
			const result = await page.call(this, request, signal);
			if (!active || request?.maxBytes !== undefined) return result;
			if (!result || !Array.isArray(result.records) || result.records.length === 0) return result;
			const trimmed = trimRecords(result, maxBytes, minRecords);
			if (trimmed.trimmed === 0) return result;
			report("history page", trimmed);
			return trimmed.value;
		};
		const restoreFollow = install(service, "follow", wrappedFollow, follow);
		if (restoreFollow === undefined) {
			warn("history-budget: `sessionController.follow` cannot be replaced in place; nothing is bounded");
			return;
		}
		const restorePage = hasPage ? install(service, "page", wrappedPage, page) : undefined;
		if (hasPage && restorePage === undefined) {
			warn("history-budget: `sessionController.page` cannot be replaced in place; only the opening frame is bounded");
		}

		service[INSTALLED] = true;
		info(`history-budget: opening frames bounded to ${String(maxBytes)} bytes, keeping at least ${String(minRecords)} record(s)`);
		return () => {
			active = false;
			restoreFollow();
			restorePage?.();
			if (service[INSTALLED] === true) {
				try {
					Reflect.deleteProperty(service, INSTALLED);
				} catch {}
			}
		};
	});
}

export { name, inject };
export default { name, inject, apply };
