/**
 * Byte-budgeted trimming of one wire frame's `records`.
 *
 * The Harness pages history by message COUNT: `maxMessages` defaults to 50 and
 * the Web client asks for 500, so a single oversized tool result or a long goal
 * turn still crosses as one multi-megabyte frame. This module answers the other
 * question: given an already-built frame, which NEWEST suffix of its records
 * fits one encoded byte budget?
 *
 * The budget is measured on the exact bytes the client receives — the
 * `JSON.stringify` of the frame it is handed — because that is the quantity a
 * slow link pays for. It is the same rule `dsh-remote-bridge`'s
 * `session.snapshot.page.v1` states for its own pages, so a snapshot and a
 * history page can never disagree about what "fits".
 *
 * Trimming keeps the newest records and never rewrites one: a record larger
 * than the whole budget stays whole and becomes the page by itself (`minRecords`
 * is honoured before the budget). Splitting or truncating a record would hand
 * the client content the session does not say.
 */

/**
 * JSON bytes of one value on the wire.
 * @param value - any JSON-serializable value.
 * @returns its UTF-8 byte length once serialized.
 */
export function encodedBytes(value) {
	return Buffer.byteLength(JSON.stringify(value));
}

/**
 * Keep the newest suffix of `container.records` that fits `maxBytes`.
 *
 * A trimmed frame always reports `hasMore: true`: the dropped records are older
 * entries of the same window and stay reachable through the native history
 * pager, which is why the opening frame's cursor is left untouched.
 *
 * @param container - frame or page value carrying a `records` array.
 * @param maxBytes - encoded byte budget for the whole container.
 * @param minRecords - newest records kept even when one of them alone exceeds the budget.
 * @returns the value to hand the client, how many records were dropped, and its encoded size.
 */
export function trimRecords(container, maxBytes, minRecords = 1) {
	const records = container?.records;
	if (!Array.isArray(records) || records.length === 0) {
		return { value: container, trimmed: 0, bytes: 0 };
	}
	const full = encodedBytes(container);
	if (full <= maxBytes) return { value: container, trimmed: 0, bytes: full };

	// Size the container once per record, then walk backwards from the newest
	// one. `overhead` is everything except the array brackets and its elements:
	// stringify({ ...container, records: [] }) is `overhead + 2` for "[]".
	const sizes = records.map(encodedBytes);
	const overhead = encodedBytes({ ...container, records: [] }) - 2;
	const keepAtLeast = Math.min(Math.max(minRecords, 1), records.length);
	let kept = 0;
	let payload = 0;
	for (let index = records.length - 1; index >= 0; index -= 1) {
		const added = kept === 0 ? sizes[index] : sizes[index] + 1;
		if (kept >= keepAtLeast && overhead + 2 + payload + added > maxBytes) break;
		payload += added;
		kept += 1;
	}

	const value = {
		...container,
		records: records.slice(records.length - kept),
		hasMore: true,
	};
	return { value, trimmed: records.length - kept, bytes: encodedBytes(value) };
}
