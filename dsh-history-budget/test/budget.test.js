import assert from "node:assert/strict";
import test from "node:test";

import { encodedBytes, trimRecords } from "../src/budget.js";

/**
 * Build one wire record of a controlled size.
 * @param seq - durable sequence number.
 * @param size - bytes of filler text.
 * @returns the record.
 */
function record(seq, size = 120) {
	return { type: "event", event: { type: "tool/result", seq, time: seq, data: { text: "x".repeat(size) } } };
}

/**
 * Build a snapshot frame with `count` records.
 * @param count - record count.
 * @param size - filler bytes per record.
 * @param hasMore - the frame's own hasMore flag.
 * @returns the frame.
 */
function snapshot(count, size = 120, hasMore = false) {
	return {
		type: "snapshot",
		cursor: count,
		hasMore,
		records: Array.from({ length: count }, (_, index) => record(index + 1, size)),
	};
}

test("leaves a frame that already fits untouched", () => {
	const frame = snapshot(3);
	const result = trimRecords(frame, 1024 * 1024);
	assert.equal(result.value, frame, "the exact frame must be handed back");
	assert.equal(result.trimmed, 0);
	assert.equal(result.value.hasMore, false);
	assert.equal(result.bytes, encodedBytes(frame));
});

test("keeps the newest suffix inside the budget", () => {
	const frame = snapshot(6);
	const budget = Math.ceil(encodedBytes(frame) / 2);
	const result = trimRecords(frame, budget);
	assert.ok(result.trimmed > 0, "the fixture must be large enough to trim");
	assert.ok(encodedBytes(result.value) <= budget, "the encoded frame must fit the budget");
	assert.equal(result.value.hasMore, true);
	assert.equal(result.value.cursor, frame.cursor, "the cursor is the resume point and must not move");
	assert.equal(result.value.records.at(-1), frame.records.at(-1), "the newest record must survive");
	const kept = result.value.records.length;
	assert.equal(result.value.records[0], frame.records[frame.records.length - kept], "the suffix must stay contiguous");
	assert.equal(result.trimmed, frame.records.length - kept);
	assert.equal(result.bytes, encodedBytes(result.value));
});

test("keeps one record whole when that record alone exceeds the budget", () => {
	const frame = snapshot(4, 2000);
	const result = trimRecords(frame, 300);
	assert.equal(result.value.records.length, 1);
	assert.equal(result.trimmed, 3);
	assert.equal(result.value.records[0], frame.records.at(-1), "the oversized newest record stays whole");
	assert.ok(encodedBytes(result.value) > 300, "an oversized record is reported as is, never truncated");
});

test("honours minRecords before the budget", () => {
	const frame = snapshot(6, 400);
	const result = trimRecords(frame, 200, 3);
	assert.equal(result.value.records.length, 3);
	assert.equal(result.value.hasMore, true);
	assert.equal(result.value.records.at(-1), frame.records.at(-1));
});

test("trims a history page value with the same rule", () => {
	const value = { records: snapshot(5).records, hasMore: false };
	const budget = Math.ceil(encodedBytes(value) / 2);
	const result = trimRecords(value, budget);
	assert.ok(result.trimmed > 0);
	assert.ok(encodedBytes(result.value) <= budget);
	assert.equal(result.value.hasMore, true);
	assert.equal(result.value.records.at(-1), value.records.at(-1));
});

test("ignores containers without records", () => {
	const empty = { records: [], hasMore: false };
	assert.equal(trimRecords(empty, 1).value, empty);
	const missing = { hasMore: false };
	assert.equal(trimRecords(missing, 1).value, missing);
	assert.equal(trimRecords(undefined, 1).value, undefined);
});
