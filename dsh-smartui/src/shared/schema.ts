import type { ValueSchemaSpec } from '@deepseek-ai/dsh-tools';
const text = { type: 'string' } as const;
const identity = { type: 'string', description: 'Unique ASCII id: starts with a letter, then letters, digits, _ or -. Max 64 chars.' } as const;
const base = { id: { ...identity, required: true }, title: text } as const;
const option = { type: 'object', additionalProperties: false, properties: {
  value: { ...text, required: true }, label: { ...text, required: true },
} } as const;
const card = { type: 'object', additionalProperties: false, properties: {
  ...base, type: { type: 'string', const: 'card', required: true }, body: { ...text, required: true }, value: text, caption: text,
} } as const;
const table = { type: 'object', additionalProperties: false, properties: {
  ...base, type: { type: 'string', const: 'table', required: true },
  columns: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
    id: { ...identity, required: true }, label: { ...text, required: true },
  } } },
  rows: { type: 'array', required: true, description: '0..200 rows, matching 1..12 columns.', items: { type: 'array', items: {
    oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }],
  } } },
} } as const;
const chart = { type: 'object', additionalProperties: false, properties: {
  ...base, type: { type: 'string', const: 'chart', required: true }, chartType: { type: 'string', enum: ['bar', 'line'], required: true },
  series: { type: 'array', required: true, description: '1..4 series; identical ordered labels; 500 points total. Use real or explicitly labelled example data.', items: {
    type: 'object', additionalProperties: false, properties: {
      id: { ...identity, required: true }, label: { ...text, required: true },
      points: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        label: { ...text, required: true }, value: { type: 'number', required: true },
      } } },
    },
  } },
} } as const;
const form = { type: 'object', additionalProperties: false, properties: {
  ...base, type: { type: 'string', const: 'form', required: true }, actionId: { ...identity, required: true },
  fields: { type: 'array', required: true, description: '1..20 fields; options only for select, min/max only for number. Never request passwords, API keys or credentials.', items: {
    type: 'object', additionalProperties: false, properties: {
      id: { ...identity, required: true }, label: { ...text, required: true },
      type: { type: 'string', enum: ['text', 'textarea', 'number', 'select', 'checkbox'], required: true },
      required: { type: 'boolean' }, placeholder: text, options: { type: 'array', items: option }, min: { type: 'number' }, max: { type: 'number' },
    },
  } },
} } as const;
const choices = { type: 'object', additionalProperties: false, properties: {
  ...base, type: { type: 'string', const: 'choices', required: true }, actionId: { ...identity, required: true },
  multiple: { type: 'boolean' }, options: { type: 'array', items: option, required: true },
} } as const;
export const documentSchema = {
  type: 'object', additionalProperties: false, properties: {
    schemaVersion: { type: 'integer', const: 1, required: true }, title: text,
    summary: { ...text, required: true, description: 'Plain-text fallback, max 1000 chars; remains readable without SmartUI.' },
    blocks: { type: 'array', required: true, description: '1..20 blocks. Complete document max 65536 UTF-8 bytes.', items: { oneOf: [card, table, chart, form, choices] } },
  },
} as const satisfies ValueSchemaSpec;
