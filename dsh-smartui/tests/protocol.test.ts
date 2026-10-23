import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateDocument, presentationMeta, readPresentationMeta, SmartUIValidationError } from '../src/shared/validation.js';
import { LIMITS, type GroupBlock, type SmartUIDocument, type SmartUILeafBlock, type StatBlock } from '../src/shared/types.js';
import { documentSchema } from '../src/shared/schema.js';
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
test('schema keeps all nine strict block variants flat and group references as IDs', () => {
  const variants = documentSchema.properties.blocks.items.oneOf;
  assert.deepEqual(variants.map(block => block.properties.type.const), ['card', 'table', 'chart', 'form', 'choices', 'stat', 'progress', 'callout', 'group']);
  for (const block of variants) {
    assert.equal(block.type, 'object'); assert.equal(block.additionalProperties, false);
    assert.equal(block.properties.type.required, true); assert.equal(block.properties.id.required, true);
  }
  assert.deepEqual(Object.keys(variants[8].properties), ['id', 'title', 'type', 'layout', 'blockIds']);
  assert.equal(variants[8].properties.blockIds.items.type, 'string');
  assert.equal(documentSchema.properties.schemaVersion.const, 1);
});
test('admits every leaf type with a forward-referencing group and replays detached metadata', () => {
  const stat: StatBlock = { type: 'stat', id: 'stat', title: 'Revenue', value: '$42', caption: 'This week', delta: '+5%', tone: 'success', spark: [-1e12, 0, 1e12] };
  const leaves: SmartUILeafBlock[] = [
    stat,
    { type: 'progress', id: 'progress', title: 'Completion', value: 42.5, caption: 'In progress', variant: 'ring' },
    { type: 'callout', id: 'callout', title: 'Notice', body: '<script>still inert</script>', tone: 'warning' },
    { type: 'card', id: 'card', body: 'Existing card' },
    { type: 'table', id: 'table', columns: [{ id: 'column', label: 'Column' }], rows: [[1]] },
    { type: 'chart', id: 'chart', chartType: 'bar', series: [{ id: 'series', label: 'Series', points: [{ label: 'Point', value: 1 }] }] },
    { type: 'form', id: 'form', actionId: 'review', fields: [{ id: 'field', label: 'Field', type: 'text' }] },
    { type: 'choices', id: 'choices', actionId: 'choose', options: [{ value: 'a', label: 'A' }] },
  ];
  const group: GroupBlock = { type: 'group', id: 'group', title: 'Dashboard', layout: 'tabs', blockIds: leaves.map(block => block.id) };
  const source: SmartUIDocument = { schemaVersion: 1, summary: 'Dashboard summary', blocks: [group, ...leaves, { type: 'card', id: 'ungrouped', body: 'Top level' }] };
  const doc = validateDocument(source); const meta = presentationMeta(doc);
  const replay = readPresentationMeta(JSON.parse(JSON.stringify(meta)));
  assert.deepEqual(replay, source); assert.notEqual(doc, source); assert.notEqual(doc.blocks, source.blocks);
  assert.notEqual(meta.smartui, doc); assert.notEqual(replay.blocks[0], meta.smartui.blocks[0]);
  stat.spark![0] = 7; group.blockIds.reverse();
  assert.deepEqual(doc, meta.smartui); assert.deepEqual(replay, doc);
  assert.equal(doc.blocks.at(-1)?.id, 'ungrouped');
});
test('admits optional new fields, all tones, variants and one-level layouts', () => {
  for (const tone of [undefined, 'neutral', 'success', 'warning', 'error']) {
    for (const block of [{ type: 'stat', id: 'stat', value: '0' }, { type: 'callout', id: 'callout', body: 'Notice' }]) {
      const withTone = tone === undefined ? block : { ...block, tone };
      assert.deepEqual(validateDocument({ ...basic(), blocks: [withTone] }).blocks, [withTone]);
    }
  }
  for (const variant of [undefined, 'bar', 'ring']) for (const value of [0, 0.5, 100]) {
    const block = { type: 'progress', id: 'progress', value, ...(variant === undefined ? {} : { variant }) };
    assert.deepEqual(validateDocument({ ...basic(), blocks: [block] }).blocks, [block]);
  }
  for (const layout of ['row', 'column', 'tabs']) {
    const blocks = [{ type: 'group', id: 'group', layout, blockIds: ['card'] }, ...basic().blocks];
    assert.deepEqual(validateDocument({ ...basic(), blocks }).blocks, blocks);
  }
});
test('rejects invalid tones, progress variants and new block shapes', () => {
  for (const tone of ['info', '', null, false, 0, [], {}]) {
    invalid({ ...basic(), blocks: [{ type: 'stat', id: 'stat', value: '1', tone }] });
    invalid({ ...basic(), blocks: [{ type: 'callout', id: 'callout', body: 'Notice', tone }] });
  }
  for (const variant of ['circle', '', null, false, 1, []]) invalid({ ...basic(), blocks: [{ type: 'progress', id: 'progress', value: 50, variant }] });
  for (const block of [
    { type: 'stat', id: 'stat' }, { type: 'stat', id: 'stat', value: 1 },
    { type: 'progress', id: 'progress' }, { type: 'callout', id: 'callout' },
    { type: 'stat', id: 'stat', value: '1', onClick: 'run()' },
    { type: 'progress', id: 'progress', value: 1, tone: 'success' },
    { type: 'callout', id: 'callout', body: 'Notice', html: '<b>bad</b>' },
  ]) invalid({ ...basic(), blocks: [block] });
});
test('enforces spark length, finite numeric points and inclusive magnitude limits', () => {
  assert.equal(LIMITS.sparkPoints, 60);
  for (const spark of [[-1e12, 1e12], Array.from({ length: LIMITS.sparkPoints }, (_, i) => i)]) {
    assert.deepEqual(validateDocument({ ...basic(), blocks: [{ type: 'stat', id: 'stat', value: '1', spark }] }).blocks[0], { type: 'stat', id: 'stat', value: '1', spark });
  }
  for (const spark of [[], [1], Array(LIMITS.sparkPoints + 1).fill(0), null, '1,2', [0, '1'], [0, null], [0, true], [0, NaN], [0, Infinity], [0, -Infinity], [0, 1e12 + 1], [0, -1e12 - 1]]) {
    invalid({ ...basic(), blocks: [{ type: 'stat', id: 'stat', value: '1', spark }] });
  }
});
test('enforces progress numeric range without coercion', () => {
  for (const value of [-0.01, 100.01, -1e12, 1e12, NaN, Infinity, -Infinity, '50', null, true]) invalid({ ...basic(), blocks: [{ type: 'progress', id: 'progress', value }] });
});
test('new blocks retain existing text limits', () => {
  const stat = { type: 'stat', id: 'stat', title: 't'.repeat(LIMITS.label), value: 'v'.repeat(LIMITS.label), caption: 'c'.repeat(500), delta: 'd'.repeat(LIMITS.label) };
  const progress = { type: 'progress', id: 'progress', value: 50, caption: 'c'.repeat(500) };
  const callout = { type: 'callout', id: 'callout', body: 'b'.repeat(LIMITS.text) };
  assert.equal(validateDocument({ ...basic(), blocks: [stat, progress, callout] }).blocks.length, 3);
  for (const [key, max] of [['title', LIMITS.label], ['value', LIMITS.label], ['caption', 500], ['delta', LIMITS.label]] as const) {
    for (const value of ['', ' ', 'x'.repeat(max + 1)]) invalid({ ...basic(), blocks: [{ ...stat, [key]: value }] });
  }
  invalid({ ...basic(), blocks: [{ ...progress, caption: 'c'.repeat(501) }] });
  for (const body of ['', ' ', 'b'.repeat(LIMITS.text + 1)]) invalid({ ...basic(), blocks: [{ ...callout, body }] });
  for (const block of [progress, callout, { type: 'group', id: 'group', layout: 'row', blockIds: ['card'] }]) {
    invalid({ ...basic(), blocks: [{ ...block, title: 't'.repeat(LIMITS.label + 1) }, ...basic().blocks] });
  }
});
test('rejects unknown, invalid, empty and duplicate group references', () => {
  const group = { type: 'group', id: 'group', layout: 'row', blockIds: ['card'] };
  for (const blockIds of [undefined, null, [], ['missing'], ['card', 'card'], ['bad id'], ['constructor'], [1], [{ id: 'card' }]]) {
    const block = blockIds === undefined ? { type: 'group', id: 'group', layout: 'row' } : { ...group, blockIds };
    invalid({ ...basic(), blocks: [block, ...basic().blocks] });
  }
  for (const layout of [undefined, null, '', 'grid', 1, []]) {
    const block = layout === undefined ? { type: 'group', id: 'group', blockIds: ['card'] } : { ...group, layout };
    invalid({ ...basic(), blocks: [block, ...basic().blocks] });
  }
  invalid({ ...basic(), blocks: [{ ...group, children: basic().blocks }, ...basic().blocks] });
  invalid({ ...basic(), blocks: [{ ...group, blocks: basic().blocks }, ...basic().blocks] });
});
test('rejects self references, nested groups and cross-group leaf ownership', () => {
  const group = { type: 'group', id: 'first', layout: 'column', blockIds: ['card'] };
  invalid({ ...basic(), blocks: [{ ...group, blockIds: ['first'] }, ...basic().blocks] });
  for (const groups of [
    [group, { ...group, id: 'second', blockIds: ['first'] }],
    [{ ...group, blockIds: ['second'] }, { ...group, id: 'second' }],
    [group, { ...group, id: 'second' }],
    [{ ...group, blockIds: ['second'] }, { ...group, id: 'second', blockIds: ['first'] }],
  ]) invalid({ ...basic(), blocks: [...groups, ...basic().blocks] });
  invalid({ ...basic(), blocks: [{ ...group, id: 'card' }, ...basic().blocks] });
  const blocks = [group, ...basic().blocks, { type: 'stat', id: 'stat', value: '1' }, { ...group, id: 'second', blockIds: ['stat'] }];
  assert.deepEqual(validateDocument({ ...basic(), blocks }).blocks, blocks);
});
test('groups count toward the existing total block limit', () => {
  const leaves = Array.from({ length: LIMITS.blocks - 1 }, (_, i) => ({ type: 'stat', id: `stat${i}`, value: String(i) }));
  const group = { type: 'group', id: 'group', layout: 'row', blockIds: leaves.map(block => block.id) };
  assert.equal(validateDocument({ ...basic(), blocks: [group, ...leaves] }).blocks.length, LIMITS.blocks);
  invalid({ ...basic(), blocks: [group, ...leaves, { type: 'callout', id: 'extra', body: 'Too many' }] });
});
test('new arrays retain lossless JSON boundaries and metadata revalidation', () => {
  const stat = { type: 'stat', id: 'stat', value: '1' };
  let read = false;
  const accessor = Object.defineProperty([0, 1], '0', { enumerable: true, get() { read = true; return 0; } });
  invalid({ ...basic(), blocks: [{ ...stat, spark: accessor }] }); assert.equal(read, false);
  const decorated = Object.assign([0, 1], { extra: 2 });
  for (const spark of [decorated, Array(2), new Float64Array([0, 1]), [0, undefined]]) invalid({ ...basic(), blocks: [{ ...stat, spark }] });
  const invalidDoc = { ...basic(), blocks: [{ type: 'group', id: 'group', layout: 'tabs', blockIds: ['unknown'] }, ...basic().blocks] };
  assert.throws(() => readPresentationMeta({ smartui: invalidDoc }), SmartUIValidationError);
  assert.throws(() => presentationMeta(invalidDoc as SmartUIDocument), SmartUIValidationError);
  const refs = Object.assign(['card'], { extra: 'card' });
  invalid({ ...basic(), blocks: [{ type: 'group', id: 'group', layout: 'row', blockIds: refs }, ...basic().blocks] });
});
