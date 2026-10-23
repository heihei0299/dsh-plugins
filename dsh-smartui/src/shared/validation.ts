import { LIMITS, type SmartUIDocument, type SmartUIMeta } from './types.js';

type Obj = Record<string, unknown>;
export class SmartUIValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid SmartUI document: ${issues.join('; ')}`);
    this.name = 'SmartUIValidationError';
  }
}
const fail = (path: string, message: string): never => {
  throw new SmartUIValidationError([`${path}: ${message}`]);
};
const own = (value: Obj, key: string) => Object.hasOwn(value, key);
function object(value: unknown, path: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(path, 'expected object');
  return value as Obj;
}
function keys(value: Obj, allowed: string[], path: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key}`, 'unknown field');
}
function string(value: unknown, path: string, max: number = LIMITS.label, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max) {
    return fail(path, `expected ${empty ? '' : 'nonblank '}string, at most ${max} characters`);
  }
  return value;
}
function id(value: unknown, path: string): string {
  const text = string(value, path, 64);
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(text) || ['constructor', 'prototype'].includes(text)) fail(path, 'id must start with a letter, contain only letters, digits, _ or -, and not be a reserved property');
  return text;
}
function array(value: unknown, path: string, max: number, min = 1): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) return fail(path, `expected ${min}..${max} items`);
  return value;
}
function number(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) return fail(path, 'expected finite number in [-1e12, 1e12]');
  return value;
}
function optionalString(value: Obj, key: string, path: string, max: number = LIMITS.label): void {
  if (own(value, key)) string(value[key], `${path}.${key}`, max);
}
function optionalBoolean(value: Obj, key: string, path: string): void {
  if (own(value, key) && typeof value[key] !== 'boolean') fail(`${path}.${key}`, 'expected boolean');
}
function enumValue(value: unknown, path: string, allowed: readonly string[]): void {
  if (typeof value !== 'string' || !allowed.includes(value)) fail(path, `expected ${allowed.join(', ')}`);
}
function optionalTone(value: Obj, path: string): void {
  if (own(value, 'tone')) enumValue(value.tone, `${path}.tone`, ['neutral', 'success', 'warning', 'error']);
}
function unique(values: string[], path: string): void {
  if (new Set(values).size !== values.length) fail(path, 'duplicate ids or values');
}
function options(value: unknown, path: string): void {
  const values = array(value, path, LIMITS.options).map((item, i) => {
    const p = `${path}[${i}]`; const option = object(item, p);
    keys(option, ['value', 'label'], p);
    string(option.label, `${p}.label`);
    return string(option.value, `${p}.value`, 160);
  });
  unique(values, path);
}
/** Guard before stringify: reject cycles, accessors, non-JSON values and excessive work. */
function jsonBoundary(value: unknown): void {
  const ancestors = new Set<object>(); let visited = 0;
  function visit(item: unknown, depth: number): void {
    if (++visited > 15_000 || depth > 10) fail('$', 'JSON complexity limit exceeded');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') {
      if (item.length > LIMITS.bytes) fail('$', 'string exceeds document budget');
      return;
    }
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item !== 'object') fail('$', 'only lossless JSON values are allowed');
    const obj = item as object;
    if (ancestors.has(obj)) fail('$', 'cyclic input');
    const proto = Object.getPrototypeOf(obj);
    if (Array.isArray(obj) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail('$', 'expected plain JSON object or array');
    ancestors.add(obj);
    for (const key of Reflect.ownKeys(obj)) {
      if (Array.isArray(obj) && key === 'length') continue;
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)) fail('$', 'unsafe property');
      const descriptor = Object.getOwnPropertyDescriptor(obj, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return fail('$', 'accessors and hidden properties are not JSON');
      visit(descriptor.value, depth + 1);
    }
    if (Array.isArray(obj) && Object.keys(obj).length !== obj.length) fail('$', 'sparse or decorated array');
    ancestors.delete(obj);
  }
  visit(value, 0);
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > LIMITS.bytes) fail('$', `document exceeds ${LIMITS.bytes} UTF-8 bytes`);
}
export function validateDocument(value: unknown): SmartUIDocument {
  jsonBoundary(value);
  const doc = object(value, '$');
  keys(doc, ['schemaVersion', 'title', 'summary', 'blocks'], '$');
  if (doc.schemaVersion !== 1) fail('$.schemaVersion', 'only version 1 is supported');
  optionalString(doc, 'title', '$'); string(doc.summary, '$.summary', 1_000);
  const blocks = array(doc.blocks, '$.blocks', LIMITS.blocks);
  const blockIds: string[] = [];
  const groups: { id: string; blockIds: string[]; path: string }[] = [];
  blocks.forEach((item, i) => {
    const path = `$.blocks[${i}]`; const block = object(item, path);
    const blockId = id(block.id, `${path}.id`);
    blockIds.push(blockId); optionalString(block, 'title', path);
    switch (block.type) {
      case 'card':
        keys(block, ['type', 'id', 'title', 'body', 'value', 'caption'], path);
        string(block.body, `${path}.body`, LIMITS.text);
        optionalString(block, 'value', path); optionalString(block, 'caption', path, 500);
        break;
      case 'table': {
        keys(block, ['type', 'id', 'title', 'columns', 'rows'], path);
        const columns = array(block.columns, `${path}.columns`, LIMITS.columns);
        unique(columns.map((col, j) => {
          const p = `${path}.columns[${j}]`; const column = object(col, p);
          keys(column, ['id', 'label'], p); string(column.label, `${p}.label`);
          return id(column.id, `${p}.id`);
        }), `${path}.columns`);
        array(block.rows, `${path}.rows`, LIMITS.rows, 0).forEach((row, j) => {
          const p = `${path}.rows[${j}]`;
          const cells = array(row, p, columns.length, columns.length);
          cells.forEach((cell, k) => {
            if (cell === null || typeof cell === 'boolean') return;
            if (typeof cell === 'number') { number(cell, `${p}[${k}]`); return; }
            string(cell, `${p}[${k}]`, 2_000, true);
          });
        });
        break;
      }
      case 'chart': {
        keys(block, ['type', 'id', 'title', 'chartType', 'series'], path);
        if (!['bar', 'line'].includes(String(block.chartType))) fail(`${path}.chartType`, 'expected bar or line');
        let total = 0; let expectedLabels: string[] | undefined;
        unique(array(block.series, `${path}.series`, LIMITS.series).map((item, j) => {
          const p = `${path}.series[${j}]`; const series = object(item, p);
          keys(series, ['id', 'label', 'points'], p); string(series.label, `${p}.label`);
          const points = array(series.points, `${p}.points`, LIMITS.points);
          total += points.length;
          const labels = points.map((item, k) => {
            const q = `${p}.points[${k}]`; const point = object(item, q);
            keys(point, ['label', 'value'], q); number(point.value, `${q}.value`);
            return string(point.label, `${q}.label`);
          });
          unique(labels, `${p}.points`);
          if (expectedLabels && (labels.length !== expectedLabels.length || labels.some((label, k) => label !== expectedLabels?.[k]))) fail(p, 'all series must use the same ordered labels');
          expectedLabels = labels;
          return id(series.id, `${p}.id`);
        }), `${path}.series`);
        if (total > LIMITS.points) fail(path, `at most ${LIMITS.points} total points`);
        break;
      }
      case 'form': {
        keys(block, ['type', 'id', 'title', 'fields', 'actionId'], path);
        id(block.actionId, `${path}.actionId`);
        unique(array(block.fields, `${path}.fields`, LIMITS.fields).map((item, j) => {
          const p = `${path}.fields[${j}]`; const field = object(item, p);
          keys(field, ['id', 'label', 'type', 'required', 'placeholder', 'options', 'min', 'max'], p);
          string(field.label, `${p}.label`); optionalBoolean(field, 'required', p); optionalString(field, 'placeholder', p);
          if (!['text', 'textarea', 'number', 'select', 'checkbox'].includes(String(field.type))) fail(`${p}.type`, 'unsupported field type');
          if (field.type === 'select') options(field.options, `${p}.options`);
          else if (own(field, 'options')) fail(`${p}.options`, 'options only apply to select fields');
          for (const bound of ['min', 'max']) {
            if (own(field, bound)) {
              if (field.type !== 'number') fail(`${p}.${bound}`, 'bounds only apply to number fields');
              number(field[bound], `${p}.${bound}`);
            }
          }
          if (typeof field.min === 'number' && typeof field.max === 'number' && field.min > field.max) fail(p, 'min exceeds max');
          return id(field.id, `${p}.id`);
        }), `${path}.fields`);
        break;
      }
      case 'choices':
        keys(block, ['type', 'id', 'title', 'options', 'multiple', 'actionId'], path);
        options(block.options, `${path}.options`); optionalBoolean(block, 'multiple', path);
        id(block.actionId, `${path}.actionId`);
        break;
      case 'stat':
        keys(block, ['type', 'id', 'title', 'value', 'caption', 'delta', 'tone', 'spark'], path);
        string(block.value, `${path}.value`);
        optionalString(block, 'caption', path, 500); optionalString(block, 'delta', path);
        optionalTone(block, path);
        if (own(block, 'spark')) array(block.spark, `${path}.spark`, LIMITS.sparkPoints, 2).forEach((point, j) => number(point, `${path}.spark[${j}]`));
        break;
      case 'progress': {
        keys(block, ['type', 'id', 'title', 'value', 'caption', 'variant'], path);
        const value = number(block.value, `${path}.value`);
        if (value < 0 || value > 100) fail(`${path}.value`, 'expected percentage in [0, 100]');
        optionalString(block, 'caption', path, 500);
        if (own(block, 'variant')) enumValue(block.variant, `${path}.variant`, ['bar', 'ring']);
        break;
      }
      case 'callout':
        keys(block, ['type', 'id', 'title', 'body', 'tone'], path);
        string(block.body, `${path}.body`, LIMITS.text); optionalTone(block, path);
        break;
      case 'group': {
        keys(block, ['type', 'id', 'title', 'layout', 'blockIds'], path);
        enumValue(block.layout, `${path}.layout`, ['row', 'column', 'tabs']);
        const references = array(block.blockIds, `${path}.blockIds`, LIMITS.blocks).map((reference, j) => id(reference, `${path}.blockIds[${j}]`));
        unique(references, `${path}.blockIds`);
        groups.push({ id: blockId, blockIds: references, path });
        break;
      }
      default: fail(`${path}.type`, 'unsupported block type');
    }
  });
  unique(blockIds, '$.blocks');
  const knownBlockIds = new Set(blockIds);
  const groupIds = new Set(groups.map(group => group.id));
  const groupedLeaves = new Set<string>();
  for (const group of groups) group.blockIds.forEach((reference, i) => {
    const path = `${group.path}.blockIds[${i}]`;
    if (reference === group.id) fail(path, 'group cannot reference itself');
    if (!knownBlockIds.has(reference)) fail(path, 'unknown block id');
    if (groupIds.has(reference)) fail(path, 'groups may reference only leaf blocks, not groups');
    if (groupedLeaves.has(reference)) fail(path, 'leaf block may belong to at most one group');
    groupedLeaves.add(reference);
  });
  // The complete JSON and every shape has been checked. Detach caller-owned objects.
  return JSON.parse(JSON.stringify(value)) as SmartUIDocument;
}
export function readPresentationMeta(value: unknown): SmartUIDocument {
  const meta = object(value, '$meta');
  keys(meta, ['smartui'], '$meta');
  return validateDocument(meta.smartui);
}
export function presentationMeta(document: SmartUIDocument): SmartUIMeta {
  return { smartui: validateDocument(document) };
}
