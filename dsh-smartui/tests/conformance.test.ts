import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateArgs } from '@deepseek-ai/dsh-tools';
import { documentSchema } from '../src/shared/schema.js';
import { validateDocument, SmartUIValidationError } from '../src/shared/validation.js';

/**
 * The model-facing call schema wraps the document in the `document` argument.
 * `validateArgs` is the authoritative structural gate for model output; the
 * runtime validator is stricter because JSON Schema cannot express every rule.
 */
const argsSpec = { document: { ...documentSchema, required: true } } as const;
const schemaIssues = (document: unknown) => validateArgs(argsSpec, { document });
const runtimeRejects = (document: unknown) => assert.throws(() => validateDocument(document), SmartUIValidationError);

const leafSamples: Record<string, Record<string, unknown>> = {
  card: { id: 'card', type: 'card', body: 'Plain text', value: '42', caption: 'Caption' },
  table: { id: 'table', type: 'table', columns: [{ id: 'name', label: 'Name' }], rows: [['Ada'], [null]] },
  chart: { id: 'chart', type: 'chart', chartType: 'line', series: [{ id: 'series', label: 'Series', points: [{ label: 'P1', value: 1 }] }] },
  form: { id: 'form', type: 'form', actionId: 'review', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] },
  choices: { id: 'choices', type: 'choices', actionId: 'choose', options: [{ value: 'one', label: 'One' }] },
  stat: { id: 'stat', type: 'stat', value: '42', delta: '+5%', tone: 'success', spark: [-1, 0, 1] },
  progress: { id: 'progress', type: 'progress', value: 42, caption: 'In progress', variant: 'ring' },
  callout: { id: 'callout', type: 'callout', body: 'Notice', tone: 'warning' },
};
const typedDocument = (block: Record<string, unknown>) => ({ schemaVersion: 1, summary: 'Summary', blocks: [block] });

test('the model schema and runtime validator admit one sample per block type', () => {
  for (const [type, block] of Object.entries(leafSamples)) {
    const document = typedDocument(block);
    assert.deepEqual(schemaIssues(document), [], `${type} schema`);
    assert.equal(validateDocument(document).blocks[0]?.type, type);
  }
  const group = { id: 'group', type: 'group', layout: 'tabs', blockIds: ['card'] };
  const document = { schemaVersion: 1, summary: 'Summary', blocks: [group, leafSamples.card] };
  assert.deepEqual(schemaIssues(document), []);
  assert.equal(validateDocument(document).blocks.length, 2);
});

test('structural violations are rejected by both layers', () => {
  const structural: Record<string, Record<string, unknown>> = {
    card: { id: 'card', type: 'card' },
    table: { id: 'table', type: 'table', columns: [{ id: 'name', label: 'Name' }] },
    chart: { id: 'chart', type: 'chart', chartType: 'pie', series: [{ id: 'series', label: 'Series', points: [{ label: 'P1', value: 1 }] }] },
    form: { id: 'form', type: 'form', actionId: 'review', fields: [{ id: 'name', label: 'Name', type: 'password' }] },
    choices: { id: 'choices', type: 'choices', actionId: 'choose' },
    stat: { id: 'stat', type: 'stat', value: 42 },
    progress: { id: 'progress', type: 'progress', value: '42' },
    callout: { id: 'callout', type: 'callout' },
    group: { id: 'group', type: 'group', layout: 'grid', blockIds: ['card'] },
  };
  for (const [type, block] of Object.entries(structural)) {
    const document = type === 'group' ? { schemaVersion: 1, summary: 'Summary', blocks: [block, leafSamples.card] } : typedDocument(block);
    assert.ok(schemaIssues(document).length > 0, `${type} must fail the model schema`);
    runtimeRejects(document);
  }
  const unknownField = typedDocument({ ...leafSamples.card, onClick: 'run()' });
  assert.ok(schemaIssues(unknownField).length > 0);
  runtimeRejects(unknownField);
});

test('business rules stay in the runtime validator because JSON Schema cannot express them', () => {
  const card = leafSamples.card!;
  const businessOnly: Record<string, unknown>[] = [
    { schemaVersion: 1, summary: 'Summary', blocks: [card, card] }, // duplicate ids
    { schemaVersion: 1, summary: 'Summary', blocks: [{ id: 'group', type: 'group', layout: 'row', blockIds: ['missing'] }] }, // unresolved group reference
    { schemaVersion: 1, summary: 'Summary', blocks: [{ id: 'group', type: 'group', layout: 'row', blockIds: ['group'] }] }, // self reference
    { schemaVersion: 1, summary: 'Summary', blocks: [
      { id: 'first', type: 'group', layout: 'row', blockIds: ['card'] },
      { id: 'second', type: 'group', layout: 'row', blockIds: ['first'] },
      card,
    ] }, // nested group
    typedDocument({ id: 'chart', type: 'chart', chartType: 'bar', series: [
      { id: 'a', label: 'A', points: [{ label: 'P1', value: 1 }] },
      { id: 'b', label: 'B', points: [{ label: 'P2', value: 2 }] },
    ] }), // series labels must align
    typedDocument({ id: 'table', type: 'table', columns: [{ id: 'name', label: 'Name' }], rows: [['a', 'b']] }), // row width
    typedDocument({ id: 'form', type: 'form', actionId: 'review', fields: [{ id: 'name', label: 'Name', type: 'text', options: [{ value: 'a', label: 'A' }] }] }), // options only for select
    typedDocument({ id: 'form', type: 'form', actionId: 'review', fields: [{ id: 'age', label: 'Age', type: 'text', min: 1 }] }), // bounds only for number
    typedDocument({ id: 'progress', type: 'progress', value: 101 }), // percentage range
    typedDocument({ id: 'stat', type: 'stat', value: '1', spark: [1] }), // spark minimum
    typedDocument({ id: '1bad', type: 'card', body: 'Text' }), // id grammar
    typedDocument({ id: 'card', type: 'card', body: '   ' }), // nonblank text
    typedDocument({ id: 'card', type: 'card', body: 'x'.repeat(8_001) }), // text budget
    { schemaVersion: 1, summary: 'Summary', blocks: Array.from({ length: 21 }, (_, index) => ({ id: `card${index}`, type: 'card', body: 'Text' })) }, // total blocks
  ];
  for (const document of businessOnly) {
    assert.deepEqual(schemaIssues(document), [], 'the JSON Schema admits this structurally');
    runtimeRejects(document);
  }
});
