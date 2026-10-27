import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAction, formatActionReply, validateForm, compareCells, spreadsheetSafeCell, spreadsheetSafeText, tableText } from '../src/shared/actions.js';
import en from '../locale/en.json' with { type: 'json' };
import zh from '../locale/zh.json' with { type: 'json' };
const translator = (dict: Record<string, string>) => (key: string, values?: Record<string, string | number>) => {
  let text = dict[key] ?? key;
  for (const [name, value] of Object.entries(values ?? {})) text = text.replaceAll(`{${name}}`, String(value));
  return text;
};
import { insertReviewedText } from '../src/client/draft.js';
import type { FormBlock, ChoicesBlock } from '../src/shared/types.js';
import type { InputActions, InsertionSpan } from '../src/client/contracts.js';
const form: FormBlock = { id: 'form', type: 'form', actionId: 'review', fields: [
  { id: 'name', type: 'text', label: 'Name', required: true },
  { id: 'age', type: 'number', label: 'Age', min: 1, max: 120, required: true },
  { id: 'option', type: 'select', label: 'Option', options: [{ label: 'A', value: 'a' }] },
  { id: 'agree', type: 'checkbox', label: 'Agree', required: true },
] };
test('requires valid form values and preserves false/zero without coercion', () => {
  assert.deepEqual({ ...validateForm(form, {}) }, { name: 'required', age: 'required', agree: 'required' });
  const errors = validateForm(form, { name: ' ', age: '10', option: 'unlisted', agree: false });
  assert.equal(errors.name, 'required'); assert.equal(errors.age, 'number'); assert.equal(errors.option, 'option'); assert.equal(errors.agree, 'required');
  assert.equal(validateForm(form, { name: 'N', age: 121, agree: true }).age, 'range');
  assert.equal(Object.keys(validateForm(form, { name: 'N', age: 1, agree: true })).length, 0);
});
test('action envelope carries trusted tool identity and only admitted field ids', () => {
  const action = createAction('call-123', form, { name: '<script>not code</script>', age: 30, agree: true });
  assert.equal(action.sourceCallId, 'call-123'); assert.equal(action.blockId, 'form'); assert.equal(action.actionId, 'review');
  assert.equal(action.values.option, null); assert.equal(action.values.name, '<script>not code</script>');
  assert.throws(() => createAction('call', form, { name: 'N', age: 30, agree: true, unknown: 'x' }));
  assert.throws(() => createAction('', form, {}));
});
test('choice values cannot invent options or exceed single selection', () => {
  const choices: ChoicesBlock = { id: 'next', type: 'choices', actionId: 'next', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] };
  assert.deepEqual(createAction('call', choices, { selected: ['a'] }).values.selected, ['a']);
  for (const selected of [[], ['x'], ['a', 'b'], ['a', 'a']]) assert.throws(() => createAction('call', choices, { selected }));
  assert.deepEqual(createAction('call', { ...choices, multiple: true }, { selected: ['a', 'b'] }).values.selected, ['a', 'b']);
});
test('choice reply is human-readable and never exposes internal ids or JSON', () => {
  const choices: ChoicesBlock = { id: 'visibility_check', type: 'choices', title: '五类组件是否显示正常？', actionId: 'report_visibility', options: [{ value: 'all_visible', label: '卡片、表格、图表、表单、选项都正常' }] };
  const text = formatActionReply('call-internal-123', choices, { selected: ['all_visible'] }, translator(zh.ui));
  assert.equal(text, '关于「五类组件是否显示正常？」，我选择：卡片、表格、图表、表单、选项都正常。');
  for (const internal of ['sourceCallId', 'call-internal-123', 'actionId', 'report_visibility', 'all_visible', 'SmartUI action', 'schemaVersion']) assert.ok(!text.includes(internal));
});
test('form replies use visible option labels and localized booleans, not machine values', () => {
  const text = formatActionReply('call', form, { name: 'Alice', age: 30, option: 'a', agree: true }, translator(en.ui));
  assert.match(text, /Name: Alice/); assert.match(text, /Age: 30/); assert.match(text, /Option: A/); assert.match(text, /Agree: Yes/);
  assert.ok(!text.includes('sourceCallId')); assert.ok(!text.includes('"values"'));
  assert.throws(() => formatActionReply('call', form, { name: 'Alice', age: 30, agree: false }, translator(en.ui)));
});
function input(span: InsertionSpan = { start: 0, end: 0, draftRev: 1 }, accepted = true) {
  const writes: { text: string; span: InsertionSpan }[] = [];
  const actions: InputActions = { captureInsertion: () => span, insertText: (text, captured) => { writes.push({ text, span: captured }); return accepted; } };
  return { actions, writes };
}
test('draft insertion is revision-guarded and never calls submit or overwrites a selection', () => {
  const { actions, writes } = input(); assert.equal(insertReviewedText(actions, 'review me', true), 'inserted');
  assert.equal(writes.length, 1); assert.equal(writes[0]?.span.draftRev, 1); assert.equal(writes[0]?.text, '\n\nreview me\n');
  const selected = input({ start: 1, end: 5, draftRev: 2 }); assert.equal(insertReviewedText(selected.actions, 'x', true), 'selection'); assert.equal(selected.writes.length, 0);
});
test('locked, missing, stale and oversized insertions fail without fallback writes', () => {
  const locked = input(); assert.equal(insertReviewedText(locked.actions, 'x', false), 'unavailable'); assert.equal(locked.writes.length, 0);
  assert.equal(insertReviewedText(undefined, 'x', true), 'unavailable');
  const stale = input(undefined, false); assert.equal(insertReviewedText(stale.actions, 'x', true), 'changed'); assert.equal(stale.writes.length, 1);
  assert.equal(insertReviewedText(locked.actions, 'x'.repeat(20_000), true), 'tooLarge'); assert.equal(locked.writes.length, 0);
  assert.equal(insertReviewedText(input({ start: -1, end: -1, draftRev: 0 }).actions, 'x', true), 'unavailable');
});
test('table numeric sorting and clipboard export are deterministic and spreadsheet-safe', () => {
  assert.ok(compareCells(2, 10) < 0); assert.ok(compareCells(null, 10) > 0);
  assert.equal(spreadsheetSafeText(' =SUM(A1)'), "' =SUM(A1)");
  assert.equal(spreadsheetSafeText('-71'), "'-71");
  assert.equal(spreadsheetSafeCell(-71), '-71');
  assert.equal(spreadsheetSafeCell(false), 'false');
  assert.equal(spreadsheetSafeCell(null), '—');
  const text = tableText(['=header'], [['=SUM(A1)', '\t@unsafe', 'normal\ntext', -2, false, null]]);
  assert.equal(text, "'=header\n'=SUM(A1)\t' @unsafe\tnormal text\t-2\tfalse\t—");
});
