import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile } from 'node:fs/promises';
import en from '../locale/en.json' with { type: 'json' };
import zh from '../locale/zh.json' with { type: 'json' };
import { EnvironmentContext, type Environment } from '../src/client/environment.js';
import { BlockView } from '../src/client/components.js';
import { ToolView } from '../src/client/ToolView.js';
import { validateDocument } from '../src/shared/validation.js';
import type { ClientContext, ToolViewProps } from '../src/client/contracts.js';
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
test('a settled tool displays recorded document; failure and unknown schema preserve text only', () => {
  const props: ToolViewProps = {
    sessionId: 'session', callId: 'call', toolName: 'render_smart_ui', phase: 'result',
    block: { meta: { smartui: { schemaVersion: 1, summary: 'Recorded summary', blocks: [{ id: 'card', type: 'card', body: 'Real card' }] } }, content: [{ type: 'text', text: 'Text fallback' }] },
    inputActions: { captureInsertion: () => ({ start: 0, end: 0, draftRev: 0 }), insertText: () => { throw new Error('Rendering must not mutate input'); } },
    useInput: selector => selector({ phase: 'plain', draft: '' }),
  };
  assert.match(render(<ToolView {...props} />), /Real card/);
  const failed = render(<ToolView {...props} block={{ ...props.block, isError: true }} />);
  assert.ok(!failed.includes('Real card')); assert.match(failed, /Text fallback/);
  const unsupported = render(<ToolView {...props} block={{ ...props.block, meta: { smartui: { schemaVersion: 2 } } }} />);
  assert.ok(!unsupported.includes('Real card')); assert.match(unsupported, /Text fallback/);
});
test('translations have matching keys and interpolation placeholders', () => {
  assert.deepEqual(Object.keys(en.ui).sort(), Object.keys(zh.ui).sort());
  for (const key of Object.keys(en.ui) as (keyof typeof en.ui)[]) {
    assert.deepEqual(en.ui[key].match(/\{[^}]+\}/g), zh.ui[key].match(/\{[^}]+\}/g));
  }
  assert.ok(en.meta.title && zh.meta.title && en.meta.description && zh.meta.description);
});
