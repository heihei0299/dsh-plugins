import { LIMITS, type Cell, type ChoicesBlock, type FormBlock, type FormValues, type SmartUIAction } from './types.js';
export type FieldError = 'required' | 'number' | 'range' | 'option' | 'length';
export function validateForm(block: FormBlock, values: FormValues): Record<string, FieldError> {
  const errors: Record<string, FieldError> = Object.create(null) as Record<string, FieldError>;
  for (const field of block.fields) {
    const value = values[field.id];
    const empty = value === undefined || value === null || (typeof value === 'string' && !value.trim());
    if (empty) { if (field.required) errors[field.id] = 'required'; continue; }
    if (field.type === 'checkbox') {
      if (typeof value !== 'boolean' || (field.required && value !== true)) errors[field.id] = 'required';
    } else if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) errors[field.id] = 'number';
      else if ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) errors[field.id] = 'range';
    } else if (typeof value !== 'string' || value.length > LIMITS.text) errors[field.id] = 'length';
    else if (field.type === 'select' && !field.options?.some(option => option.value === value)) errors[field.id] = 'option';
  }
  return errors;
}
export function createAction(sourceCallId: string, block: FormBlock | ChoicesBlock, values: FormValues | { selected: string[] }): SmartUIAction {
  if (!sourceCallId || sourceCallId.length > 512) throw new Error('Invalid source call identity');
  let admitted: SmartUIAction['values'];
  if (block.type === 'form') {
    const formValues = values as FormValues;
    if (Object.keys(validateForm(block, formValues)).length) throw new Error('Form values are invalid');
    if (Object.keys(formValues).some(key => !block.fields.some(field => field.id === key))) throw new Error('Unknown form field');
    admitted = Object.fromEntries(block.fields.map(field => [field.id, formValues[field.id] ?? null]));
  } else {
    const selected = (values as { selected: string[] }).selected;
    if (!Array.isArray(selected) || !selected.length || (!block.multiple && selected.length !== 1)
      || new Set(selected).size !== selected.length || selected.some(value => !block.options.some(option => option.value === value))) throw new Error('Invalid choice');
    admitted = { selected };
  }
  const action: SmartUIAction = { schemaVersion: 1, sourceCallId, blockId: block.id, actionId: block.actionId, values: admitted };
  if (new TextEncoder().encode(JSON.stringify(action)).byteLength > LIMITS.actionBytes) throw new Error('Action exceeds size limit');
  return action;
}
export type ActionTranslate = (key: string, values?: Record<string, string | number>) => string;
/** Validate internal provenance, but insert a human reply, not an implementation envelope. */
export function formatActionReply(sourceCallId: string, block: FormBlock | ChoicesBlock, values: FormValues | { selected: string[] }, t: ActionTranslate): string {
  const action = createAction(sourceCallId, block, values);
  const title = (block.title ?? t(`type.${block.type}`)).replaceAll('\n', ' ').replaceAll('\r', ' ');
  let text: string;
  if (block.type === 'choices') {
    const selected = action.values.selected as string[];
    const labels = selected.map(value => block.options.find(option => option.value === value)?.label ?? value);
    text = t('reply.choices', { title, values: labels.join(t('reply.separator')) });
  } else {
    const lines = block.fields.map(field => {
      const raw = action.values[field.id];
      const value = raw === null || raw === undefined || raw === '' ? t('reply.empty')
        : typeof raw === 'boolean' ? t(raw ? 'reply.yes' : 'reply.no')
          : field.type === 'select' ? field.options?.find(option => option.value === raw)?.label ?? String(raw) : String(raw);
      return `- ${t('reply.field', { label: field.label.replaceAll('\n', ' ').replaceAll('\r', ' '), value: value.replaceAll('\n', '\n  ') })}`;
    });
    text = `${t('reply.formHeading', { title })}\n${lines.join('\n')}`;
  }
  if (new TextEncoder().encode(text).byteLength > LIMITS.actionBytes) throw new Error('Reply exceeds size limit');
  return text;
}
export function cellText(value: Cell): string { return value === null ? '—' : String(value); }
/** Spreadsheet apps evaluate text starting with =, +, - or @ (even after whitespace) as a formula. */
const FORMULA_PREFIX = /^\s*[=+\-@]/;
/** Neutralize formula-leading text only; typed numbers, booleans and null are data, never formulas. */
export function spreadsheetSafeText(text: string): string { return FORMULA_PREFIX.test(text) ? `'${text}` : text; }
/** Clipboard cell text shared by TSV and CSV: protection applies to strings, typed values keep their form. */
export function spreadsheetSafeCell(value: Cell): string {
  const text = cellText(value);
  return typeof value === 'string' ? spreadsheetSafeText(text) : text;
}
export function compareCells(a: Cell, b: Cell): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return typeof a === 'number' && typeof b === 'number' ? a - b : cellText(a).localeCompare(cellText(b));
}
export function tableText(columns: readonly string[], rows: readonly Cell[][]): string {
  // TSV is also pasted into spreadsheets: flatten line breaks, then apply the shared text-only protection.
  const flatten = (text: string) => text.replaceAll('\t', ' ').replaceAll('\r', ' ').replaceAll('\n', ' ');
  const cell = (value: Cell) => spreadsheetSafeCell(typeof value === 'string' ? flatten(value) : value);
  return [columns.map(column => spreadsheetSafeText(flatten(column))), ...rows.map(row => row.map(cell))].map(row => row.join('\t')).join('\n');
}
