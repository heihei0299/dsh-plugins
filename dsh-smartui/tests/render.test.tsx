import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile } from 'node:fs/promises';
import en from '../locale/en.json' with { type: 'json' };
import zh from '../locale/zh.json' with { type: 'json' };
import { EnvironmentContext, type Environment } from '../src/client/environment.js';
import { BlockView } from '../src/client/components.js';
import { DocumentNode } from '../src/client/DocumentNode.js';
import { DocumentView } from '../src/client/DocumentView.js';
import { ToolView } from '../src/client/ToolView.js';
import { validateDocument } from '../src/shared/validation.js';
import type { ChatNodeProps, ClientContext, ConfigSnapshot, ToolViewProps } from '../src/client/contracts.js';
import type { ChartBlock } from '../src/shared/types.js';
const settings = { status: 'ready' as const, value: { appearance: 'chatgpt' as const, enableComponents: true }, writable: true, revision: 1 };
const locale = { active: 'en', revision: 0 };
const environment: Environment = {
  ctx: { locale: { getSnapshot: () => locale, subscribe: () => () => {} } } as unknown as ClientContext,
  form: { getSnapshot: () => settings, subscribe: () => () => {}, set: async () => false },
  t: (key, values) => {
    let text = en.ui[key as keyof typeof en.ui] ?? key;
    for (const [name, value] of Object.entries(values ?? {})) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  },
};
function render(children: React.ReactNode) { return renderToStaticMarkup(<EnvironmentContext.Provider value={environment}>{children}</EnvironmentContext.Provider>); }
test('renders every example through the real component code without executing markup', async () => {
  for (const name of ['comparison', 'chart', 'form']) {
    const doc = validateDocument(JSON.parse(await readFile(new URL(`../examples/${name}.json`, import.meta.url), 'utf8')));
    const html = render(<>{doc.blocks.map(block => <BlockView key={block.id} block={block} callId="call" disabled={false} onFill={() => { throw new Error('Render must never submit'); }} />)}</>);
    assert.ok(html.length > 100); assert.ok(!/\b(?:NaN|Infinity)\b/.test(html));
    if (name === 'chart') { assert.match(html, /<svg/); assert.match(html, /<table/); }
    if (name === 'form') { assert.match(html, /<form/); assert.match(html, /aria-required/); }
  }
});
test('model-provided HTML remains escaped text in cards, tables and fields', () => {
  const payload = '<img src=x onerror="alert(1)"><script>alert(1)</script>';
  const html = render(<BlockView block={{ id: 'card', type: 'card', body: payload }} callId="call" disabled={false} onFill={() => {}} />);
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img ')); assert.match(html, /&lt;script&gt;/);
});
test('a settled tool reports the recorded document without repeating the card', () => {
  const props: ToolViewProps = {
    sessionId: 'session', callId: 'call', toolName: 'render_smart_ui', phase: 'result',
    block: { meta: { smartui: { schemaVersion: 1, summary: 'Recorded summary', blocks: [{ id: 'card', type: 'card', body: 'Real card' }] } }, content: [{ type: 'text', text: 'Text fallback' }] },
    inputActions: { captureInsertion: () => ({ start: 0, end: 0, draftRev: 0 }), insertText: () => { throw new Error('Rendering must not mutate input'); } },
    useInput: selector => selector({ phase: 'plain', draft: '' }),
  };
  const compact = render(<ToolView {...props} />);
  assert.ok(!compact.includes('Real card'));
  assert.match(compact, /Card shown in the conversation \(1 blocks\)/);
  const failed = render(<ToolView {...props} block={{ ...props.block, isError: true }} />);
  assert.ok(!failed.includes('Real card')); assert.match(failed, /Text fallback/);
  const unsupported = render(<ToolView {...props} block={{ ...props.block, meta: { smartui: { schemaVersion: 2 } } }} />);
  assert.ok(!unsupported.includes('Real card')); assert.match(unsupported, /Text fallback/);
});
function settingsWith(enableComponents: boolean): Environment {
  return {
    ...environment,
    form: {
      ...environment.form,
      getSnapshot: (): ConfigSnapshot => ({ status: 'ready', value: { appearance: 'chatgpt', enableComponents }, writable: true, revision: 1 }),
    },
  };
}
test('the Turn-level row renders the card outside the fold and follows the settings gate', () => {
  const document = validateDocument({ schemaVersion: 1, summary: 'Recorded summary', blocks: [{ id: 'card', type: 'card', body: 'Real card' }] });
  const props: ChatNodeProps = {
    sessionId: 'session',
    node: { key: 'smartui:call', kind: 'smartui-document', id: 'call', data: { callId: 'call', document } },
    inputActions: { captureInsertion: () => ({ start: 0, end: 0, draftRev: 0 }), insertText: () => { throw new Error('Rendering must not mutate input'); } },
    useInput: selector => selector({ phase: 'plain', draft: '' }),
  };
  const html = renderToStaticMarkup(<EnvironmentContext.Provider value={settingsWith(true)}><DocumentNode {...props} /></EnvironmentContext.Provider>);
  assert.match(html, /Real card/); assert.match(html, /data-smartui-call="call"/); assert.match(html, /smartui-document/);
  const disabled = renderToStaticMarkup(<EnvironmentContext.Provider value={settingsWith(false)}><DocumentNode {...props} /></EnvironmentContext.Provider>);
  assert.equal(disabled, '');
  const malformed = renderToStaticMarkup(<EnvironmentContext.Provider value={settingsWith(true)}><DocumentNode {...props} node={{ ...props.node, data: { callId: 'call' } }} /></EnvironmentContext.Provider>);
  assert.equal(malformed, '');
  const direct = render(<DocumentView document={document} callId="call" editable inputActions={props.inputActions} />);
  assert.match(direct, /Real card/); assert.match(direct, /View recorded UI document/);
});
function chart(values: number[], chartType: ChartBlock['chartType'] = 'line') {
  return render(<BlockView block={{ id: 'chart', type: 'chart', title: 'Trend', chartType, series: [{
    id: 'series', label: 'Example', points: values.map((value, index) => ({ label: `Day ${index + 1}`, value })),
  }] }} callId="call" disabled={false} onFill={() => {}} />);
}
test('chart coordinates stay finite for zero, negative, fractional and extreme valid values', () => {
  for (const values of [[0, 0], [0.01, 0.02], [-3, -1], [-2, 4], [1e12, -1e12], [1e-300, 2e-300], [Number.MIN_VALUE, 0]]) {
    for (const type of ['line', 'bar'] as const) {
      const html = chart(values, type);
      assert.ok(!/\b(?:NaN|Infinity)\b/.test(html), `${type}: ${values.join(', ')}`);
      assert.match(html, /<svg/); assert.match(html, /<table/);
    }
  }
});
test('fractional charts expose distinct axis labels instead of repeated zeroes', () => {
  const labels = Array.from(chart([0.01, 0.02]).matchAll(/<g class="smartui-grid">[\s\S]*?<text\b[^>]*>(.*?)<\/text>/g), match => match[1]);
  assert.ok(labels.length >= 2);
  assert.equal(new Set(labels).size, labels.length);
  assert.ok(labels.some(label => label?.includes('0.01')));
});
test('charts retain the last category label and keep a single bar compact', () => {
  const labels = Array.from(chart(Array.from({ length: 8 }, (_, index) => index)).matchAll(/<text class="smartui-axis-label"[^>]*>(.*?)<\/text>/g), match => match[1]);
  assert.ok(labels.some(label => label?.startsWith('Day 1'))); assert.ok(labels.some(label => label?.startsWith('Day 8')));
  const html = chart([4], 'bar');
  const widths = Array.from(html.matchAll(/<rect\b[^>]*\bwidth="([\d.e+-]+)"/g), match => Number(match[1]));
  assert.equal(widths.length, 1); assert.ok(widths.every(width => width > 0 && width <= 48));
  assert.match(html, /class="smartui-chart-scroll"[^>]*role="region"/);
  assert.match(html, /class="smartui-chart-scroll"[^>]*tabindex="0"/);
  assert.match(html, /smartui-chart-hint/);
  assert.ok(html.includes(en.ui.chartScroll));
});
test('numeric table columns are aligned semantically without treating mixed text as numbers', () => {
  const html = render(<BlockView block={{ id: 'table', type: 'table', title: 'Comparison',
    columns: [{ id: 'name', label: 'Name' }, { id: 'amount', label: 'Amount' }, { id: 'mixed', label: 'Mixed' }],
    rows: [['A', 10, '10'], ['B', null, 2]],
  }} callId="call" disabled={false} onFill={() => {}} />);
  assert.equal(Array.from(html.matchAll(/class="smartui-num"/g)).length, 3);
  assert.match(html, /aria-label="[^\"]*Amount[^\"]*"/);
  const heading = html.match(/<h3\b[^>]*id="([^"]+)"/);
  assert.ok(heading); assert.ok(html.includes(`aria-labelledby="${heading[1]}"`));
});
test('multi-series lines remain distinguishable without relying only on color', () => {
  const html = render(<BlockView block={{ id: 'lines', type: 'chart', chartType: 'line', series: [
    { id: 'first', label: 'First', points: [{ label: 'One', value: 1 }] },
    { id: 'second', label: 'Second', points: [{ label: 'One', value: 2 }] },
  ] }} callId="call" disabled={false} onFill={() => {}} />);
  assert.match(html, /stroke-dasharray="7 4"/);
  assert.match(html, /<title[^>]*>[^<]*First, Second/);
});
test('form controls have stable names for focusing the first invalid field', () => {
  const html = render(<BlockView block={{ id: 'form', type: 'form', actionId: 'details', fields: [
    { id: 'goal', type: 'text', label: 'Goal', required: true },
    { id: 'size', type: 'select', label: 'Size', options: [{ value: 'small', label: 'Small' }] },
  ] }} callId="call" disabled={false} onFill={() => {}} />);
  assert.match(html, /<input\b[^>]*name="goal"/);
  assert.match(html, /<select\b[^>]*name="size"/);
});
test('empty tables show a dedicated empty state without numeric column styling', () => {
  const html = render(<BlockView block={{ id: 'empty', type: 'table', columns: [{ id: 'name', label: 'Name' }], rows: [] }} callId="call" disabled={false} onFill={() => {}} />);
  assert.match(html, /class="smartui-table-empty"/); assert.match(html, /No rows/);
  assert.ok(!html.includes('class="smartui-num"'));
});
test('translations have matching keys and interpolation placeholders', () => {
  assert.deepEqual(Object.keys(en.ui).sort(), Object.keys(zh.ui).sort());
  for (const key of Object.keys(en.ui) as (keyof typeof en.ui)[]) {
    assert.deepEqual(en.ui[key].match(/\{[^}]+\}/g), zh.ui[key].match(/\{[^}]+\}/g));
  }
  assert.ok(en.meta.title && zh.meta.title && en.meta.description && zh.meta.description);
});
