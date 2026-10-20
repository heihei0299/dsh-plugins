import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateDocument, presentationMeta, readPresentationMeta, SmartUIValidationError } from '../src/shared/validation.js';
import { LIMITS, type SmartUIDocument } from '../src/shared/types.js';
const basic = (): SmartUIDocument => ({ schemaVersion: 1, summary: 'Summary', blocks: [{ id: 'card', type: 'card', body: 'Plain text' }] });
const invalid = (value: unknown) => assert.throws(() => validateDocument(value), SmartUIValidationError);
for (const example of ['comparison', 'chart', 'form']) test(`admits ${example} example and replays metadata`, async () => {
  const source: unknown = JSON.parse(await readFile(new URL(`../examples/${example}.json`, import.meta.url), 'utf8'));
  const doc = validateDocument(source);
  assert.deepEqual(readPresentationMeta(JSON.parse(JSON.stringify(presentationMeta(doc)))), doc);
  assert.notEqual(doc, source);
});
test('plain HTML and JavaScript strings remain inert data', () => {
  const doc = basic(); doc.blocks = [{ id: 'card', type: 'card', body: '<script>alert(1)</script>javascript:alert(1)' }];
  assert.equal(validateDocument(doc).blocks[0]?.type, 'card');
});
test('rejects unknown version, fields, blocks and executable fields', () => {
  invalid({ ...basic(), schemaVersion: 2 }); invalid({ ...basic(), html: '<b>bad</b>' });
  invalid({ ...basic(), blocks: [{ type: 'iframe', id: 'frame' }] });
  invalid({ ...basic(), blocks: [{ type: 'card', id: 'card', body: 'text', onClick: 'run()' }] });
});
test('rejects empty/too many blocks and duplicate ids', () => {
  invalid({ ...basic(), blocks: [] });
  invalid({ ...basic(), blocks: Array.from({ length: 21 }, (_, i) => ({ id: `c${i}`, type: 'card', body: 'text' })) });
  invalid({ ...basic(), blocks: [basic().blocks[0], basic().blocks[0]] });
});
test('rejects cycles, accessors, decorated and sparse arrays, and non-JSON values', () => {
  const cycle: Record<string, unknown> = {}; cycle.self = cycle; invalid(cycle);
  let read = false; const getter = Object.defineProperty({}, 'schemaVersion', { enumerable: true, get() { read = true; return 1; } });
  invalid(getter); assert.equal(read, false);
  invalid({ ...basic(), summary: undefined }); invalid({ ...basic(), summary: BigInt(1) });
  invalid({ ...basic(), blocks: Array(2) });
  invalid(JSON.parse('{"schemaVersion":1,"summary":"x","blocks":[],"__proto__":{}}'));
  invalid({ ...basic(), blocks: [{ id: 'constructor', type: 'card', body: 'text' }] });
});
test('rejects non-finite and out-of-bounds numbers', () => {
  for (const value of [NaN, Infinity, -Infinity, 1e13]) invalid({ schemaVersion: 1, summary: 'x', blocks: [{ id: 't', type: 'table', columns: [{ id: 'a', label: 'A' }], rows: [[value]] }] });
});
test('validates row widths and table limits', () => {
  const table = { id: 'table', type: 'table', columns: [{ id: 'name', label: 'Name' }], rows: [[null], [true], [1], ['']] };
  assert.equal(validateDocument({ ...basic(), blocks: [table] }).blocks.length, 1);
  invalid({ ...basic(), blocks: [{ ...table, rows: [['a', 'b']] }] });
  invalid({ ...basic(), blocks: [{ ...table, rows: Array.from({ length: 201 }, () => ['a']) }] });
  invalid({ ...basic(), blocks: [{ ...table, columns: [{ id: 'name', label: 'A' }, { id: 'name', label: 'B' }] }] });
});
test('enforces total chart point count and aligned series', () => {
  const points = Array.from({ length: 251 }, (_, i) => ({ label: `P${i}`, value: i }));
  const chart = { id: 'chart', type: 'chart', chartType: 'line', series: [{ id: 'a', label: 'A', points }, { id: 'b', label: 'B', points }] };
  invalid({ ...basic(), blocks: [chart] });
  invalid({ ...basic(), blocks: [{ ...chart, series: [{ id: 'a', label: 'A', points: [{ label: 'P1', value: 0 }] }, { id: 'b', label: 'B', points: [{ label: 'P2', value: 0 }] }] }] });
});
test('validates form type-specific constraints and options', () => {
  const form = (field: unknown) => ({ ...basic(), blocks: [{ id: 'form', type: 'form', actionId: 'review', fields: [field] }] });
  invalid(form({ id: 'n', type: 'text', label: 'Name', min: 1 }));
  invalid(form({ id: 'n', type: 'select', label: 'Name' }));
  invalid(form({ id: 'n', type: 'number', label: 'Name', min: 10, max: 1 }));
  invalid(form({ id: 'n', type: 'select', label: 'Name', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'a' }] }));
});
test('enforces UTF-8 bytes, not just string characters', () => {
  const doc = basic(); doc.blocks = Array.from({ length: 4 }, (_, i) => ({ id: `card${i}`, type: 'card', body: '字'.repeat(6_000) }));
  assert.ok(JSON.stringify(doc).length < LIMITS.bytes); invalid(doc);
});
test('metadata wrapper is versioned and narrow', () => {
  assert.throws(() => readPresentationMeta(null));
  assert.throws(() => readPresentationMeta({ smartui: basic(), execute: true }));
  const doc = basic(); const copy = validateDocument(doc); doc.summary = 'Changed'; assert.equal(copy.summary, 'Summary');
});
